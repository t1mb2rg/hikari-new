namespace HumanSurface.Core;

/// <summary>Whether the Surface currently holds a subscription to the delivery pipe.</summary>
public enum SurfaceConnection
{
    Disconnected,
    Connected,
}

/// <summary>One delivered message, as it arrived.</summary>
/// <remarks>
/// <para>
/// <see cref="Lines"/> is the decoded array exactly as it came off the pipe — not joined, not
/// re-wrapped, not trimmed. The Surface is not a party to what these lines say, and the only
/// transformation it is entitled to make is the one a text box makes to any string it displays.
/// </para>
/// <para>
/// <see cref="ReceivedAt"/> is when <em>this process</em> read the message, and the window labels it
/// that way. It is deliberately not called a timestamp: the moment the occurrence happened is
/// Language's to state and is already inside the text, and a second clock near it would invite
/// exactly the confusion that having two of them causes.
/// </para>
/// </remarks>
public sealed record SurfaceMessage(DateTimeOffset ReceivedAt, IReadOnlyList<string> Lines);

/// <summary>A consistent view of everything the window and the tray draw from.</summary>
/// <remarks>
/// A copy rather than a live view: the read loop mutates the message list on a thread-pool thread
/// while the UI thread renders, so the snapshot is taken under the lock and handed over whole. The
/// alternative — the window reaching into the session while it is being written — is the ordinary way
/// a list-backed UI tears.
/// </remarks>
public sealed record SurfaceSnapshot(
    SurfaceConnection Connection,
    IReadOnlyList<SurfaceMessage> Messages,
    int UnreadCount,
    string? Detail);
