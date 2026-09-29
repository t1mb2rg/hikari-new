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
/// <para>
/// This is also where a question is asked, and it is the same object as the listening loop for a reason
/// that is not tidiness: the person's line, Hikari's answer and a proactive delivery have to land in
/// <em>one</em> transcript in the order they happened. Two lists would make "a proactive message can
/// still arrive while a question is outstanding" a property somebody has to maintain; one list makes it
/// a property of the data structure. Nothing about the ask touches the delivery connection, and nothing
/// about the delivery connection gates the ask: the two pipes are independent, and a Surface that is
/// disconnected from one may still be answered on the other.
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
    private readonly string _languageEndpointPath;
    private readonly ILanguageAsker _asker;
    private readonly Func<TimeSpan, CancellationToken, Task> _delay;
    private readonly ReconnectSchedule _schedule = new();
    private readonly LinkedList<SurfaceMessage> _messages = new();
    private readonly object _gate = new();

    private SurfaceConnection _connection = SurfaceConnection.Disconnected;
    private string? _detail;
    private int _unread;
    private bool _asking;

    public SurfaceSession(string endpointPath, IDeliveryConnector connector, string languageEndpointPath,
        ILanguageAsker asker, Func<TimeSpan, CancellationToken, Task>? delay = null)
    {
        _endpointPath = endpointPath;
        _connector = connector;
        _languageEndpointPath = languageEndpointPath;
        _asker = asker;
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

    /// <summary>Whether a question is outstanding.</summary>
    public bool AskPending
    {
        get
        {
            lock (_gate) return _asking;
        }
    }

    /// <summary>A consistent copy of everything the window and tray draw.</summary>
    public SurfaceSnapshot Snapshot()
    {
        lock (_gate)
        {
            return new SurfaceSnapshot(_connection, _messages.ToArray(), _unread, _detail, _asking);
        }
    }

    /// <summary>
    /// Asks the language endpoint one question, on behalf of the person who typed it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Returns <c>false</c> when a question is already outstanding, and that refusal is enforced here
    /// rather than by a disabled button. The button is how the person finds out; this is what makes it
    /// true — a UI-only rule would be a second statement of the same rule, and the one that is not
    /// load-bearing is the one that drifts.
    /// </para>
    /// <para>
    /// Nothing here decides whether a question is a good one, whether it is too long, or which of
    /// Hikari's four outcomes should be shown. Every one of those belongs to the plugin on the other
    /// side of the pipe, and a second opinion here would be a second answer to a question that already
    /// has one.
    /// </para>
    /// <para>
    /// Partial in the same way <see cref="ConnectOnceAsync"/> is: the human's line is recorded before
    /// the first <c>await</c>, so a caller that clears its input box on this call cannot lose what was
    /// typed to a race, whatever the endpoint goes on to do.
    /// </para>
    /// </remarks>
    public async Task<bool> AskAsync(string text, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (_asking) return false;
            _asking = true;
        }

        // Not an arrival: the person is looking at the window they just typed into, and a tray that
        // reported "1 条未读" about their own sentence would be counting them as someone to be told.
        Append(new SurfaceMessage(DateTimeOffset.Now, [text], SurfaceOrigin.Human), isArrival: false);

        LanguageAskResult result;
        try
        {
            result = await _asker.AskAsync(_languageEndpointPath, text, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // The Surface is going away. There is nobody left to read a notice about it.
            EndAsk();
            return true;
        }
        catch (Exception exception)
        {
            // The asker is a boundary, and a boundary that can take the window down with it is not a
            // boundary. Anything that escapes it is one failed question, not a crash.
            result = LanguageAskResult.Unavailable(ExceptionDetail.Of(exception));
        }

        // A reply is Hikari's lines, carried through untouched — including a refusal and a failure,
        // which are things Hikari said. There is nothing for the Surface to add to any of them.
        if (result.Kind == LanguageAskKind.Replied)
        {
            Append(new SurfaceMessage(DateTimeOffset.Now, result.Reply!.Lines, SurfaceOrigin.Hikari),
                isArrival: true);
        }
        else
        {
            // No lines came back, so there is nothing of Hikari's to show. What the person needs is the
            // transport fact this process observed, in this process's own words — never attributed to
            // Hikari, and never dressed up as one of the four outcomes, which only the endpoint may
            // state.
            var notice = result.Kind == LanguageAskKind.Absent
                ? LanguageNotices.Absent
                : LanguageNotices.Unavailable(result.Detail ?? "没有说明原因。");

            Append(new SurfaceMessage(DateTimeOffset.Now, [notice], SurfaceOrigin.Surface), isArrival: false);
        }

        EndAsk();
        return true;
    }

    private void EndAsk()
    {
        lock (_gate) _asking = false;
        Changed?.Invoke();
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

    private void Accept(IReadOnlyList<string> lines) =>
        Append(new SurfaceMessage(DateTimeOffset.Now, lines, SurfaceOrigin.Hikari), isArrival: true);

    /// <summary>
    /// Adds one entry to the transcript, and says whether it is something the person has not seen.
    /// </summary>
    /// <remarks>
    /// <paramref name="isArrival"/> is what separates "Hikari said something while you were away" from
    /// "here is the line you just typed" and "here is this program telling you it could not reach
    /// Hikari". All three belong in the transcript, in order; only the first is news. A reason to
    /// interrupt, an unread count and a balloon are all claims about a person's attention, and the
    /// Surface makes them only for text that arrived without them being there.
    /// </remarks>
    private void Append(SurfaceMessage message, bool isArrival)
    {
        lock (_gate)
        {
            _messages.AddLast(message);
            while (_messages.Count > MessageLimit) _messages.RemoveFirst();
            if (isArrival) _unread++;
        }

        if (isArrival) MessageReceived?.Invoke(message);
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
