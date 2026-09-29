using HumanSurface.Core;

namespace HumanSurface.Tests;

/// <summary>
/// A delivery pipe whose behaviour each test states outright.
/// </summary>
/// <remarks>
/// The states worth testing — a resident that is not running, that disappears mid-evening, that comes
/// back — are timing-dependent against a real pipe and exactly reproducible against this. Each call to
/// <see cref="ConnectAsync"/> takes the next scripted attempt, so a test reads top to bottom as the
/// sequence of things that happened.
/// </remarks>
internal sealed class FakeDeliveryConnector : IDeliveryConnector
{
    private readonly Queue<Func<DeliveryConnectResult>> _attempts = new();

    /// <summary>How many attempts were made, including ones that failed to attach.</summary>
    public int ConnectCount { get; private set; }

    /// <summary>Nothing is listening. Also the default once the scripted attempts run out.</summary>
    public FakeDeliveryConnector Absent()
    {
        _attempts.Enqueue(DeliveryConnectResult.Absent);
        return this;
    }

    /// <summary>Something answered and the subscription could not be established.</summary>
    public FakeDeliveryConnector Unavailable(string detail)
    {
        _attempts.Enqueue(() => DeliveryConnectResult.Unavailable(detail));
        return this;
    }

    /// <summary>The connector itself fails — the case a state machine must survive, not model.</summary>
    public FakeDeliveryConnector Throws(Exception exception)
    {
        _attempts.Enqueue(() => throw exception);
        return this;
    }

    /// <summary>Attaches and then replays exactly these reads, in order.</summary>
    public FakeDeliveryConnector Connect(params DeliveryRead[] reads)
    {
        _attempts.Enqueue(() => DeliveryConnectResult.Connected(new FakeSubscription(reads, live: false)));
        return this;
    }

    /// <summary>Attaches a subscription the test itself feeds, later, from outside the loop.</summary>
    public FakeDeliveryConnector Accepts(FakeSubscription subscription)
    {
        _attempts.Enqueue(() => DeliveryConnectResult.Connected(subscription));
        return this;
    }

    /// <summary>Attaches a quiet subscription that is fed by the test.</summary>
    public FakeDeliveryConnector ConnectAndWait() => Accepts(new FakeSubscription([], live: true));

    public Task<DeliveryConnectResult> ConnectAsync(string endpointPath, CancellationToken cancellationToken)
    {
        ConnectCount++;
        var attempt = _attempts.Count > 0 ? _attempts.Dequeue() : DeliveryConnectResult.Absent;
        return Task.FromResult(attempt());
    }
}

/// <summary>
/// A subscription whose next read is either already scripted or delivered by the test while the
/// session is running.
/// </summary>
/// <remarks>
/// The live mode is what makes "what does the window show while a healthy resident is simply quiet"
/// testable. That is the transport's ordinary state — a subscriber is supposed to sit there for hours
/// saying nothing — so a fake that could only replay a fixed list would be testing the interesting
/// case by accident.
/// </remarks>
internal sealed class FakeSubscription(IReadOnlyList<DeliveryRead> reads, bool live) : IDeliverySubscription
{
    private readonly Queue<DeliveryRead> _delivered = new();
    private readonly SemaphoreSlim _signal = new(0);
    private int _position;
    private int _disposals;

    /// <summary>Asserted by the tests that care that a connection is not leaked.</summary>
    public int Disposals => _disposals;

    /// <summary>Hands the session one more message, as if the resident had just written it.</summary>
    public void Deliver(params string[] lines) => Push(Reads.Message(lines));

    /// <summary>Ends the connection, as if the resident had stopped.</summary>
    public void End() => Push(DeliveryRead.Ended());

    private void Push(DeliveryRead read)
    {
        lock (_delivered) _delivered.Enqueue(read);
        _signal.Release();
    }

    public async Task<DeliveryRead> ReadAsync(CancellationToken cancellationToken)
    {
        if (_position < reads.Count) return reads[_position++];

        if (!live) return DeliveryRead.Ended();

        while (true)
        {
            lock (_delivered)
            {
                if (_delivered.Count > 0) return _delivered.Dequeue();
            }

            // A release with nothing behind it costs one extra turn round this loop and then waits
            // again, so the queue stays the source of truth and the semaphore is only a wake-up.
            await _signal.WaitAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    public void Dispose() => Interlocked.Increment(ref _disposals);
}

/// <summary>Reads a test can script a subscription with, named after what they mean.</summary>
internal static class Reads
{
    public static DeliveryRead Message(params string[] lines) => DeliveryRead.Message(lines);

    public static DeliveryRead Ended() => DeliveryRead.Ended();

    public static DeliveryRead Unavailable(string detail) => DeliveryRead.Unavailable(detail);
}
