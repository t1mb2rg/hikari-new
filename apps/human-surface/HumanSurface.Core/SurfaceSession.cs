namespace HumanSurface.Core;

/// <summary>
/// The Surface's whole relationship with the resident: try to attach, read while attached, notice when
/// that ends, wait, try again.
/// </summary>
/// <remarks>
/// <para>
/// Two states, one schedule, and no memory of what happened while disconnected. That last part is a
/// decision rather than an omission: the transport has no queue and no history, so a Surface that
/// pretended otherwise would be inventing deliveries. Reconnecting restores the ability to hear the
/// next thing Hikari says; it does not ask for the things it missed, and it cannot produce them.
/// </para>
/// <para>
/// Nothing here knows what a message says. It stores the lines it was handed and reports that they
/// arrived — no parsing, no salience, no decision about whether a person should be interrupted. The
/// Surface is a place messages land; deciding which ones matter is not its job and never becomes it.
/// </para>
/// <para>
/// The loop is written as <see cref="ConnectOnceAsync"/> plus a delay so that the states that matter —
/// a resident that is absent, that disappears, that comes back — can be driven one step at a time in
/// a test, with no real elapsed time and no pipe.
/// </para>
/// </remarks>
public sealed class SurfaceSession
{
    /// <summary>How many messages the window can hold before the oldest is dropped.</summary>
    /// <remarks>
    /// A bound rather than a policy. Nothing here is persisted and the list dies with the process, so
    /// this exists only so that a long-running Surface cannot grow without limit; it is not a
    /// retention window anyone is promised.
    /// </remarks>
    public const int MessageLimit = 200;

    private readonly string _endpointPath;
    private readonly IDeliveryConnector _connector;
    private readonly Func<TimeSpan, CancellationToken, Task> _delay;
    private readonly ReconnectSchedule _schedule = new();
    private readonly LinkedList<SurfaceMessage> _messages = new();
    private readonly object _gate = new();

    private SurfaceConnection _connection = SurfaceConnection.Disconnected;
    private string? _detail;
    private int _unread;

    public SurfaceSession(string endpointPath, IDeliveryConnector connector,
        Func<TimeSpan, CancellationToken, Task>? delay = null)
    {
        _endpointPath = endpointPath;
        _connector = connector;
        _delay = delay ?? Task.Delay;
    }

    /// <summary>Any change to the connection, the messages, or the unread count.</summary>
    /// <remarks>
    /// Fires on whichever thread caused the change — the read loop for arrivals, the UI thread for
    /// <see cref="MarkRead"/>. A UI subscriber is responsible for marshalling, which is why the shell
    /// is the only thing that subscribes.
    /// </remarks>
    public event Action? Changed;

    /// <summary>One message arrived. Separate from <see cref="Changed"/> for the tray's hint.</summary>
    /// <remarks>
    /// A second event rather than an inference from the first, because the message list is bounded:
    /// once it is full the count stops moving while messages keep arriving, so "the count changed" and
    /// "something arrived" are not the same fact and the tray must not confuse them.
    /// </remarks>
    public event Action<SurfaceMessage>? MessageReceived;

    /// <summary>A consistent copy of everything the window and tray draw.</summary>
    public SurfaceSnapshot Snapshot()
    {
        lock (_gate)
        {
            return new SurfaceSnapshot(_connection, _messages.ToArray(), _unread, _detail);
        }
    }

    /// <summary>Clears the unread count. Called when a person opens the window.</summary>
    public void MarkRead()
    {
        lock (_gate)
        {
            if (_unread == 0) return;
            _unread = 0;
        }

        Changed?.Invoke();
    }

    /// <summary>
    /// One attempt: attach, read until the connection ends, and report how long to wait before trying
    /// again.
    /// </summary>
    /// <exception cref="OperationCanceledException">The caller cancelled.</exception>
    public async Task<TimeSpan> ConnectOnceAsync(CancellationToken cancellationToken)
    {
        DeliveryConnectResult result;
        try
        {
            result = await _connector.ConnectAsync(_endpointPath, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            // The transport is a boundary, and a boundary that can take the window down with it is not
            // a boundary. Anything that escapes the connector is one failed attempt, not a crash.
            result = DeliveryConnectResult.Unavailable(ExceptionDetail.Of(exception));
        }

        var subscription = result.Kind == DeliveryConnectKind.Connected ? result.Subscription : null;
        if (subscription is null)
        {
            // Absent is the ordinary case — nothing is running — and carries no detail, because a
            // window saying "未连接" does not need to be told why nobody is home. Unavailable is not
            // ordinary, and its reason is the only diagnostic this process will ever have.
            SetDisconnected(result.Kind == DeliveryConnectKind.Unavailable ? result.Detail : null);
            return _schedule.Next();
        }

        _schedule.Reset();
        SetConnected();

        using (subscription)
        {
            var ending = await PumpAsync(subscription, cancellationToken).ConfigureAwait(false);

            // Cancelled leaves the state alone: the process is going away and there is nobody left to
            // report a disconnection to.
            if (ending.Kind == StreamEndingKind.Ended) SetDisconnected(null);
            if (ending.Kind == StreamEndingKind.Unavailable) SetDisconnected(ending.Detail);
        }

        return _schedule.Next();
    }

    /// <summary>Connect, wait, connect again, until cancelled.</summary>
    public async Task RunAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            TimeSpan delay;
            try
            {
                delay = await ConnectOnceAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }

            try
            {
                await _delay(delay, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    private async Task<StreamEnding> PumpAsync(IDeliverySubscription subscription,
        CancellationToken cancellationToken)
    {
        while (true)
        {
            DeliveryRead read;
            try
            {
                read = await subscription.ReadAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return new StreamEnding(StreamEndingKind.Cancelled, null);
            }
            catch (Exception exception)
            {
                return new StreamEnding(StreamEndingKind.Unavailable, ExceptionDetail.Of(exception));
            }

            switch (read.Kind)
            {
                case DeliveryReadKind.Message:
                    Accept(read.Lines!);
                    break;
                case DeliveryReadKind.Ended:
                    return new StreamEnding(StreamEndingKind.Ended, null);
                default:
                    return new StreamEnding(StreamEndingKind.Unavailable, read.Detail);
            }
        }
    }

    private void Accept(IReadOnlyList<string> lines)
    {
        var message = new SurfaceMessage(DateTimeOffset.Now, lines);

        lock (_gate)
        {
            _messages.AddLast(message);
            while (_messages.Count > MessageLimit) _messages.RemoveFirst();
            _unread++;
        }

        MessageReceived?.Invoke(message);
        Changed?.Invoke();
    }

    private void SetConnected() => SetState(SurfaceConnection.Connected, null);

    private void SetDisconnected(string? detail) => SetState(SurfaceConnection.Disconnected, detail);

    private void SetState(SurfaceConnection connection, string? detail)
    {
        bool changed;
        lock (_gate)
        {
            changed = _connection != connection || _detail != detail;
            _connection = connection;
            _detail = detail;
        }

        // Outside the lock: a handler that called back into Snapshot would otherwise be waiting on
        // the lock this thread is still holding.
        if (changed) Changed?.Invoke();
    }

    private enum StreamEndingKind
    {
        Cancelled,
        Ended,
        Unavailable,
    }

    private readonly record struct StreamEnding(StreamEndingKind Kind, string? Detail);
}
