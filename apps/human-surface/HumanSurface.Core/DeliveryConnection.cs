namespace HumanSurface.Core;

/// <summary>Why there is no live subscription.</summary>
public enum DeliveryConnectKind
{
    /// <summary>The pipe accepted this client.</summary>
    Connected,

    /// <summary>Nothing is listening on the name. The ordinary case when no resident is running.</summary>
    Absent,

    /// <summary>Something answered, and the subscription could not be established.</summary>
    Unavailable,
}

/// <summary>
/// The outcome of one attempt to subscribe.
/// </summary>
/// <remarks>
/// <c>Absent</c> and <c>Unavailable</c> are separate because the Surface says different things about
/// them, and because collapsing them would make "Hikari is not running" and "Hikari answered wrong"
/// the same sentence in a diagnostic trail.
/// </remarks>
public readonly record struct DeliveryConnectResult(
    DeliveryConnectKind Kind,
    IDeliverySubscription? Subscription,
    string? Detail)
{
    public static DeliveryConnectResult Connected(IDeliverySubscription subscription) =>
        new(DeliveryConnectKind.Connected, subscription, null);

    /// <summary>Nothing is listening. No detail, because there is nothing to explain.</summary>
    public static DeliveryConnectResult Absent() => new(DeliveryConnectKind.Absent, null, null);

    public static DeliveryConnectResult Unavailable(string detail) =>
        new(DeliveryConnectKind.Unavailable, null, detail);
}

/// <summary>What one read from a live subscription produced.</summary>
public enum DeliveryReadKind
{
    /// <summary>One framed message, decoded.</summary>
    Message,

    /// <summary>The far end closed. Not an error: a resident that stopped is a resident that stopped.</summary>
    Ended,

    /// <summary>The stream is not speaking this protocol, or the transport failed.</summary>
    Unavailable,
}

public readonly record struct DeliveryRead(DeliveryReadKind Kind, IReadOnlyList<string>? Lines, string? Detail)
{
    public static DeliveryRead Message(IReadOnlyList<string> lines) =>
        new(DeliveryReadKind.Message, lines, null);

    public static DeliveryRead Ended() => new(DeliveryReadKind.Ended, null, null);

    public static DeliveryRead Unavailable(string detail) =>
        new(DeliveryReadKind.Unavailable, null, detail);
}

/// <summary>A live subscription: messages arrive until the connection ends.</summary>
public interface IDeliverySubscription : IDisposable
{
    /// <summary>
    /// The next framed message, or a statement that the connection is over.
    /// </summary>
    /// <remarks>
    /// Cancellation is reported as <see cref="DeliveryReadKind.Ended"/> rather than as an exception:
    /// shutting the Surface down and losing the resident are the same event as far as the read loop is
    /// concerned, and a caller that had to catch to learn it would need a second path for the ordinary
    /// case of closing a window.
    /// </remarks>
    Task<DeliveryRead> ReadAsync(CancellationToken cancellationToken);
}

/// <summary>Attaches to the delivery pipe. The seam that makes the state machine testable.</summary>
/// <remarks>
/// This interface exists to be faked, and the fake is not hypothetical: every connection-state test in
/// <c>HumanSurface.Tests</c> drives the real <see cref="SurfaceSession"/> through one, because the
/// states that matter — a resident that appears, disappears, or never was — are timing-dependent in
/// reality and deterministic here. It is a seam in the app's own code, not a public contract, and
/// nothing beside the session and its tests consumes it.
/// </remarks>
public interface IDeliveryConnector
{
    Task<DeliveryConnectResult> ConnectAsync(string endpointPath, CancellationToken cancellationToken);
}
