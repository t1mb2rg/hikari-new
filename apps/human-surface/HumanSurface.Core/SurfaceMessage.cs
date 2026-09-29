namespace HumanSurface.Core;

/// <summary>Whether the Surface currently holds a subscription to the delivery pipe.</summary>
public enum SurfaceConnection
{
    Disconnected,
    Connected,
}

/// <summary>Who wrote a transcript entry.</summary>
/// <remarks>
/// <para>
/// Three, and each one is a fact this process can establish rather than a judgement about what it is
/// holding. <see cref="Hikari"/> is anything that arrived over the delivery pipe or came back on the
/// language pipe. <see cref="Human"/> is the person's own line, which only this process knows about
/// because this process is where they typed it. <see cref="Surface"/> is this program's own sentence,
/// which it puts in the transcript only when there is no pipe to hear from.
/// </para>
/// <para>
/// What is deliberately <em>not</em> here is any distinction between a proactive delivery and an answer
/// to a question. Both are Hikari speaking, both are rendered the same way, and the difference between
/// them is Hikari's business — a third label would have the Surface asserting a distinction it did not
/// make. <see cref="Surface"/> is not that label: it marks text Hikari did not say at all.
/// </para>
/// </remarks>
public enum SurfaceOrigin
{
    Human,
    Hikari,
    Surface,
}

/// <summary>One transcript entry, as it arrived.</summary>
/// <remarks>
/// <para>
/// <see cref="Lines"/> is the decoded array exactly as it came off the pipe — not joined, not
/// re-wrapped, not trimmed. For a <see cref="SurfaceOrigin.Human"/> entry it is the one line the person
/// typed, unaltered. The Surface is not a party to what these lines say, and the only transformation it
/// is entitled to make is the one a text box makes to any string it displays.
/// </para>
/// <para>
/// <see cref="ReceivedAt"/> is when <em>this process</em> read the message, and the window labels it
/// that way. It is deliberately not called a timestamp: the moment the occurrence happened is
/// Language's to state and is already inside the text, and a second clock near it would invite
/// exactly the confusion that having two of them causes.
/// </para>
/// </remarks>
public sealed record SurfaceMessage(
    DateTimeOffset ReceivedAt,
    IReadOnlyList<string> Lines,
    SurfaceOrigin Origin);

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
    string? Detail,
    bool AskPending);
