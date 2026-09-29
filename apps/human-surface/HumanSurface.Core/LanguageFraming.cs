using System.Text.Encodings.Web;
using System.Text.Json;

namespace HumanSurface.Core;

/// <summary>
/// The wire vocabulary of the language endpoint, as this client needs it: one request word, four reply
/// outcomes, and the bounds that keep either side from choosing how much the other buffers.
/// </summary>
/// <remarks>
/// <para>
/// The format is defined by <c>src/language/protocol.ts</c> and <c>src/language/types.ts</c>. This is a
/// second implementation of it, for the reason the paragraph at the top of that file gives: a .NET
/// process cannot import the first one. It is kept line-for-line equivalent so that a reviewer can read
/// the two side by side, and <c>HumanSurface.Tests</c> drives it with bytes the real TypeScript
/// functions produced.
/// </para>
/// <para>
/// <b>Only the two halves the Surface uses are here.</b> The Surface writes requests and reads replies,
/// so it has an encoder for the first and a decoder for the second — and no decoder for a request and
/// no encoder for a reply. <see cref="DeliveryFraming"/> made the same cut for the same reason and
/// called the alternative "dead code in the product wearing the costume of symmetry"; the sentence
/// applies exactly as well in this direction.
/// </para>
/// </remarks>
public static class LanguageFraming
{
    /// <summary>The only version this build speaks. A mismatch is unreadable, never guessed at.</summary>
    public const int ProtocolVersion = 1;

    /// <summary>The one word this endpoint answers.</summary>
    public const string AskWord = "ask";

    /// <summary>
    /// The longest question the plugin will answer, in characters. Enforced on the other side of the
    /// pipe: this client does not pre-check it, because "this build will not answer that" is a
    /// statement about the question and belongs to its owner.
    /// </summary>
    public const int MaxLanguageTextLength = 8 * 1024;

    /// <summary>The cap on one framed request, from <c>src/language/types.ts</c>.</summary>
    public const int MaxLanguageRequestLine = 64 * 1024;

    /// <summary>The cap on one framed reply, from <c>src/language/types.ts</c>.</summary>
    public const int MaxLanguageReplyLine = MaxLanguageRequestLine + 4096;

    private static readonly string[] ReplyKeys = ["protocol", "outcome", "lines"];

    // The four words, listed out rather than derived from the enum, mirroring the hand-written list in
    // `protocol.ts` — and for the same reason it is hand-written there: the union is a compile-time
    // fact about our own code, and this is the runtime boundary where a string we did not write
    // arrives. `Enum.TryParse` would accept "3" and "Chatted", which are not this protocol's words.
    private static readonly Dictionary<string, LanguageReplyOutcome> OutcomeWords = new(StringComparer.Ordinal)
    {
        ["chatted"] = LanguageReplyOutcome.Chatted,
        ["answered"] = LanguageReplyOutcome.Answered,
        ["refused"] = LanguageReplyOutcome.Refused,
        ["failed"] = LanguageReplyOutcome.Failed,
    };

    // The envelope is serialised from a record whose properties are declared in the protocol's order,
    // so the key order matches `JSON.stringify({ protocol, request, text })`.
    //
    // The relaxed encoder is what keeps a question readable on the wire: the default escapes every
    // non-ASCII character, so CJK prose would arrive as a run of \uXXXX where JavaScript sends the
    // characters themselves. It is *not* an exact match for `JSON.stringify`, and pretending otherwise
    // would be the wrong claim to build a test on. Measured: CJK goes out raw on both sides, while
    // .NET still escapes U+3000 and the surrogate pair of an emoji that JavaScript sends as themselves,
    // and writes control characters with upper-case hex where JavaScript uses lower. Every one of those
    // is valid JSON that `JSON.parse` reads back as the same string, which is what the protocol actually
    // requires — the server's decoder is the arbiter, and it is the real one the conformance run hands
    // these bytes to.
    private static readonly JsonSerializerOptions Wire =
        new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private sealed record RequestEnvelope(int protocol, string request, string text);

    /// <summary>One framed request, ready to write to the pipe.</summary>
    public static string EncodeRequest(string text) =>
        JsonSerializer.Serialize(new RequestEnvelope(ProtocolVersion, AskWord, text), Wire) + "\n";

    /// <summary>
    /// One framed reply, decoded, or the reason this build would not read it.
    /// </summary>
    /// <remarks>
    /// The reasons are this implementation's own prose and are not compared against TypeScript's when
    /// the two disagree about a line — what has to agree is which lines are replies at all, and what
    /// they say. A rejection here is a diagnostic the Surface prints about something that was not this
    /// protocol; it is not part of the protocol, and two languages wording it differently is not drift.
    /// </remarks>
    public static DecodedLanguageReply DecodeReply(string line)
    {
        var fields = ReadObject(line, out var failure);
        if (fields is null) return DecodedLanguageReply.FromFailure(failure!);

        // `protocol.ts` checks the three names it wants and then that there are exactly three keys.
        // Both halves are kept, so a reply missing `lines` is refused for the same reason here as
        // there rather than for having two keys.
        if (!fields.ContainsKey("protocol") || !fields.ContainsKey("outcome") || !fields.ContainsKey("lines"))
        {
            return DecodedLanguageReply.FromFailure($"应答的字段必须恰好是 {string.Join('、', ReplyKeys)}。");
        }

        if (fields.Count != ReplyKeys.Length)
        {
            return DecodedLanguageReply.FromFailure($"应答的字段必须恰好是 {string.Join('、', ReplyKeys)}。");
        }

        // Compared as a number rather than read as an integer, because JavaScript compares it with
        // `!==` against a number: `1` and `1.0` are the same value there and would be two different
        // answers here. A string `"1"` is not the number and is refused on both sides.
        var protocol = fields["protocol"];
        if (protocol.ValueKind != JsonValueKind.Number ||
            !protocol.TryGetDouble(out var version) ||
            version != ProtocolVersion)
        {
            return DecodedLanguageReply.FromFailure(
                $"协议版本不匹配：本机使用 {ProtocolVersion}，应答使用 {Describe(fields, "protocol")}。");
        }

        var outcome = fields["outcome"];
        if (outcome.ValueKind != JsonValueKind.String ||
            !OutcomeWords.TryGetValue(outcome.GetString()!, out var kind))
        {
            return DecodedLanguageReply.FromFailure($"未知应答结果：{Describe(fields, "outcome")}。");
        }

        var lines = fields["lines"];
        if (lines.ValueKind != JsonValueKind.Array)
        {
            return DecodedLanguageReply.FromFailure("应答的 lines 不是一个字符串数组。");
        }

        var read = new List<string>();
        foreach (var entry in lines.EnumerateArray())
        {
            // A permissive decoder would call `1` a line by rendering it. It is not one, and the
            // difference only shows up on a reply nobody wrote on purpose.
            if (entry.ValueKind != JsonValueKind.String)
            {
                return DecodedLanguageReply.FromFailure("应答的 lines 不是一个字符串数组。");
            }

            read.Add(entry.GetString()!);
        }

        return DecodedLanguageReply.Read(new LanguageReply(kind, read));
    }

    /// <summary>
    /// The line as an object, or <c>null</c> and the reason it is not one.
    /// </summary>
    /// <remarks>
    /// Collected into a dictionary rather than read through <see cref="JsonElement.TryGetProperty"/>
    /// so that a repeated key collapses the way <c>JSON.parse</c> collapses it — last one wins, one
    /// entry in the key count. The two only differ on a line nobody's encoder produces, which is
    /// exactly the kind of difference a conformance suite exists to not have to reason about.
    /// </remarks>
    private static Dictionary<string, JsonElement>? ReadObject(string line, out string? failure)
    {
        failure = null;

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(line);
        }
        catch (JsonException)
        {
            failure = "应答不是一个 JSON 对象。";
            return null;
        }

        // Disposed before returning, because nothing that leaves this method refers to the document:
        // the reply `DecodeReply` builds is made of strings, so a document kept alive past the call
        // would only be holding a pooled parse buffer open. `Clone` is what makes that safe — an
        // element that outlives its document owns its own copy of the text.
        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                failure = "应答不是一个 JSON 对象。";
                return null;
            }

            var fields = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
            foreach (var property in root.EnumerateObject()) fields[property.Name] = property.Value.Clone();
            return fields;
        }
    }

    // What went wrong, said the way JavaScript would say it: `protocol.ts` builds these reasons with
    // `JSON.stringify(value)`, and the value is whatever arrived — a string, a number, `null`, or
    // `undefined` for a key that was not there at all.
    private static string Describe(Dictionary<string, JsonElement> fields, string key)
    {
        if (!fields.TryGetValue(key, out var value)) return "undefined";

        return value.ValueKind switch
        {
            JsonValueKind.Undefined => "undefined",
            JsonValueKind.Null => "null",
            JsonValueKind.String => JsonSerializer.Serialize(value.GetString()),
            _ => value.GetRawText(),
        };
    }
}

/// <summary>What <see cref="LanguageFraming.DecodeReply"/> made of a line.</summary>
public enum DecodedLanguageReplyKind
{
    Reply,
    Unreadable,
}

/// <remarks>
/// Two outcomes rather than an exception, and the reason as a value rather than as a thrown message: a
/// line this build will not read is not an absent reply, and the Surface says something different
/// about each.
/// </remarks>
public readonly record struct DecodedLanguageReply(
    DecodedLanguageReplyKind Kind,
    LanguageReply? Reply,
    string? Reason)
{
    public static DecodedLanguageReply Read(LanguageReply reply) =>
        new(DecodedLanguageReplyKind.Reply, reply, null);

    public static DecodedLanguageReply FromFailure(string reason) =>
        new(DecodedLanguageReplyKind.Unreadable, null, reason);
}

/// <summary>
/// Reads a character stream into framed lines, and refuses to buffer without bound.
/// </summary>
/// <remarks>
/// The counterpart of <c>LanguageLineReader</c> in <c>src/language/protocol.ts</c>. It differs from
/// what it is a counterpart of in exactly one way, and from its sibling in this assembly in exactly
/// one other; both are named here rather than left for the next reader to find.
///
/// From <see cref="DeliveryLineReader"/>, it differs by latching: once it has overflowed it stays
/// overflowed. The TypeScript reader latches too, and a conformance suite that compared two readers
/// agreeing only until the first overflow would be comparing them on the easy half.
///
/// From the TypeScript reader itself, it differs by <em>consuming</em> the line it returns: the buffer
/// here advances past the newline, while <c>protocol.ts</c> leaves <c>#pending</c> untouched and would
/// hand the same line back on the next push. Consuming is what the sibling reader above does and is the
/// only behaviour that can serve a caller which keeps reading, so the behaviour stays and the
/// difference is written down instead of removed.
///
/// Neither difference is observable in the product, for the same reason: <c>endpoint.ts</c> sets
/// <c>served</c> after the first line, so a push never follows a push that produced a line.
/// </remarks>
public sealed class LanguageLineReader
{
    private readonly int _limit;
    private string _buffer = string.Empty;
    private bool _overflowed;

    public LanguageLineReader(int limit = LanguageFraming.MaxLanguageReplyLine)
    {
        _limit = limit;
    }

    public DeliveryLineRead Push(string chunk)
    {
        if (_overflowed) return new DeliveryLineRead(DeliveryLineReadKind.Overflow, null);

        _buffer += chunk;

        var newline = _buffer.IndexOf('\n');
        if (newline < 0)
        {
            if (_buffer.Length > _limit)
            {
                _overflowed = true;
                return new DeliveryLineRead(DeliveryLineReadKind.Overflow, null);
            }

            return new DeliveryLineRead(DeliveryLineReadKind.Pending, null);
        }

        var line = _buffer[..newline];
        if (line.Length > _limit)
        {
            _overflowed = true;
            return new DeliveryLineRead(DeliveryLineReadKind.Overflow, null);
        }

        _buffer = _buffer[(newline + 1)..];
        return new DeliveryLineRead(DeliveryLineReadKind.Line, line);
    }
}
