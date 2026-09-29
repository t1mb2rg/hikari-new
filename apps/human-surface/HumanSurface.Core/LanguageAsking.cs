namespace HumanSurface.Core;

/// <summary>Hikari's own verdict on a question, in the four words its protocol defines.</summary>
/// <remarks>
/// Carried through untouched. <c>src/cli/ask.ts:15-20</c> states the rule this type exists to obey:
/// those four "are the language plugin's statement about what happened and this file has no standing
/// to merge, rename or re-derive any of them." <c>chatted</c> in particular is not an error and not a
/// lesser <c>answered</c> — it is a conversation, and a Surface that drew it differently would be
/// drawing the one distinction this endpoint was split in four to keep.
/// </remarks>
public enum LanguageReplyOutcome
{
    Chatted,
    Answered,
    Refused,
    Failed,
}

/// <summary>The lines Hikari answered with, and which of the four things happened.</summary>
public sealed record LanguageReply(LanguageReplyOutcome Outcome, IReadOnlyList<string> Lines);

/// <summary>Why the endpoint did not answer a question.</summary>
public enum LanguageAskKind
{
    /// <summary>The endpoint served the request. What Hikari said is in the reply.</summary>
    Replied,

    /// <summary>
    /// Nothing is listening on the name — which is two facts that cannot be told apart from here: no
    /// resident at all, or a resident started without a model configuration and so never loaded this
    /// plugin. <c>src/cli/ask.ts:24-27</c> names them together rather than guessing between them.
    /// </summary>
    Absent,

    /// <summary>Something went wrong reaching the endpoint, or it answered unreadably.</summary>
    Unavailable,
}

/// <remarks>
/// <c>Absent</c> and <c>Unavailable</c> are separate for the reason <see cref="DeliveryConnectResult"/>
/// gives about the same pair: "Hikari is not running" and "Hikari answered wrong" are different
/// sentences, and collapsing them would make one of them unsayable.
/// </remarks>
public readonly record struct LanguageAskResult(LanguageAskKind Kind, LanguageReply? Reply, string? Detail)
{
    public static LanguageAskResult Replied(LanguageReply reply) =>
        new(LanguageAskKind.Replied, reply, null);

    /// <summary>Nothing is listening. No detail, because there is nothing to explain.</summary>
    public static LanguageAskResult Absent() => new(LanguageAskKind.Absent, null, null);

    public static LanguageAskResult Unavailable(string detail) =>
        new(LanguageAskKind.Unavailable, null, detail);
}

/// <summary>Asks the language endpoint one question. The seam that makes the ask testable.</summary>
/// <remarks>
/// Shaped after <see cref="IDeliveryConnector"/> and for the same reason: the outcomes worth testing —
/// an endpoint that is not there, that answers, that answers late, that answers with something that is
/// not this protocol — are timing-dependent against a real pipe and exactly reproducible against a
/// fake. It is a seam in the app's own code, not a public contract, and nothing beside the session and
/// its tests consumes it.
/// </remarks>
public interface ILanguageAsker
{
    /// <summary>
    /// One question, one answer. Never reports <c>Absent</c> for a question the endpoint processed.
    /// </summary>
    /// <exception cref="OperationCanceledException">The caller cancelled.</exception>
    Task<LanguageAskResult> AskAsync(string endpointPath, string text, CancellationToken cancellationToken);
}

/// <summary>
/// The sentences the Surface says when asking does not reach Hikari.
/// </summary>
/// <remarks>
/// <para>
/// These are this program's words, not Hikari's, and they are the only thing the Surface ever puts in
/// its own transcript. Every other line it shows arrived over a pipe; when there is no pipe to hear
/// from, saying nothing would leave a person who just typed a question looking at a window that did
/// not change. The alternative — attributing the sentence to Hikari — would report a transport failure
/// as something Hikari said, which is the one thing this window exists not to do.
/// </para>
/// <para>
/// They are deliberately not a copy of <c>askFailureLines</c> in <c>src/cli/ask.ts</c>. That function is
/// a command's operator guidance, complete with a hint about which command line to run; this is a
/// window stating what it observed. Two audiences, two sentences, and neither is the other's second
/// copy.
/// </para>
/// </remarks>
public static class LanguageNotices
{
    public const string Absent = "这个数据目录上没有正在提供语言入口的 Hikari 常驻。";

    public static string Unavailable(string detail) => $"无法访问 Hikari 语言入口：{OneLine(detail)}";

    // A detail is whatever an exception or an unreadable reply said, and an exception message can carry
    // a line break. The transcript is one entry per line, so a break inside one would render as two
    // entries — the second of which nothing ever wrote.
    private static string OneLine(string detail)
    {
        var builder = new System.Text.StringBuilder(detail.Length);
        var spaced = false;

        foreach (var character in detail)
        {
            if (character is '\r' or '\n' or '\t')
            {
                spaced = builder.Length > 0;
                continue;
            }

            if (spaced)
            {
                builder.Append(' ');
                spaced = false;
            }

            builder.Append(character);
        }

        return builder.ToString();
    }
}
