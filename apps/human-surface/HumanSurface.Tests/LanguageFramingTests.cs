using System.Text.Json;
using HumanSurface.Core;

namespace HumanSurface.Tests;

/// <summary>
/// The language wire format, on its own, with no pipe and no server.
/// </summary>
/// <remarks>
/// These are the cases a conformance run cannot cover on a machine without a built <c>dist/</c>, and
/// they are worth having separately for that reason. What they cannot show is that the rules match
/// TypeScript's; that is <see cref="LanguageConformanceTests"/>'s job, and the two are deliberately not
/// merged.
/// </remarks>
internal static class LanguageFramingTests
{
    public static void Register(TestRun run)
    {
        run.Add("language: a request is the three-key envelope, in the protocol's order", () =>
        {
            var wire = LanguageFraming.EncodeRequest("你好");

            Assert.Equal("""{"protocol":1,"request":"ask","text":"你好"}""" + "\n", wire, "the wire form");

            // The trailing newline is the frame and not part of the content.
            Assert.True(wire.EndsWith('\n'), "the wire form ends with the frame");
        });

        run.Add("language: a request carries CJK and JSON's own escapes without mangling either", () =>
        {
            const string text = "引号 \" 和反斜杠 \\ 和制表符 \t 和全角　空格 和 emoji 🙂";

            var wire = LanguageFraming.EncodeRequest(text);
            using var document = JsonDocument.Parse(wire);

            Assert.Equal(text, document.RootElement.GetProperty("text").GetString(), "the text round-tripped");

            // CJK is on the wire as itself rather than as a run of \uXXXX, which is the whole reason
            // the encoder is configured the way it is; the default would have escaped every character
            // of it. This is the one wire-shape claim made here, and the exotic characters alongside it
            // are deliberately not asserted on: .NET escapes a wider set than `JSON.stringify` does,
            // both forms are valid JSON, and the difference is not a difference in meaning. What has to
            // hold is that the real decoder reads these bytes back as this text, which is the
            // conformance run's job rather than this case's.
            Assert.True(wire.Contains("和反斜杠", StringComparison.Ordinal),
                "CJK is on the wire as itself");
        });

        run.Add("language: a question containing a newline is still exactly one frame", () =>
        {
            // The failure this rules out is the one that would not look like one: a raw newline inside
            // the text would let the server's line reader frame the envelope up to that point and then
            // read the remainder as a second request. The question would arrive truncated, and something
            // the client never wrote would arrive after it.
            var wire = LanguageFraming.EncodeRequest("第一行\n第二行\r\n第三行");

            Assert.Equal(1, wire.Count(character => character == '\n'), "the newline count on the wire");
            Assert.True(wire.EndsWith('\n'), "the wire form ends with the frame");

            var framed = new LanguageLineReader(LanguageFraming.MaxLanguageRequestLine).Push(wire);
            Assert.Equal(DeliveryLineReadKind.Line, framed.Kind, "the read kind");
            Assert.Equal(wire[..^1], framed.Line, "the framed line");

            // And it still means what it said, newlines and all.
            using var document = JsonDocument.Parse(framed.Line!);
            Assert.Equal("第一行\n第二行\r\n第三行",
                document.RootElement.GetProperty("text").GetString(), "the text round-tripped");
        });

        run.Add("language: an empty question encodes, and is the plugin's to refuse", () =>
        {
            // The line between structural and semantic is drawn on the other side of the pipe. An empty
            // question is a well-formed ask; refusing it is a statement about the question, and this
            // client is not the thing that makes it.
            Assert.Equal("""{"protocol":1,"request":"ask","text":""}""" + "\n",
                LanguageFraming.EncodeRequest(string.Empty), "the wire form of an empty question");
        });

        run.Add("language: each of the four outcomes decodes to itself", () =>
        {
            foreach (var (word, expected) in new[]
                     {
                         ("chatted", LanguageReplyOutcome.Chatted),
                         ("answered", LanguageReplyOutcome.Answered),
                         ("refused", LanguageReplyOutcome.Refused),
                         ("failed", LanguageReplyOutcome.Failed),
                     })
            {
                var decoded = LanguageFraming.DecodeReply(
                    $$"""{"protocol":1,"outcome":"{{word}}","lines":["a","b"]}""");

                Assert.Equal(DecodedLanguageReplyKind.Reply, decoded.Kind, $"the kind for {word}");
                Assert.Equal(expected, decoded.Reply!.Outcome, $"the outcome for {word}");
                Assert.SequenceEqual(new[] { "a", "b" }, decoded.Reply!.Lines, $"the lines for {word}");
            }
        });

        run.Add("language: a reply with an empty line list is still a reply", () =>
        {
            // `{"lines":[]}` is a well-formed reply that says nothing. It is not the same fact as a
            // reply that could not be read, and the two must not collapse into one another.
            var decoded = LanguageFraming.DecodeReply("""{"protocol":1,"outcome":"answered","lines":[]}""");

            Assert.Equal(DecodedLanguageReplyKind.Reply, decoded.Kind, "the kind");
            Assert.Equal(0, decoded.Reply!.Lines.Count, "the line count");
        });

        run.Add("language: what is not this protocol's envelope does not decode", () =>
        {
            // Every one of these is a line something could put on the pipe, and none of them is a
            // reply. A permissive decoder would render `lines: [1]` by stringifying the 1, which is the
            // failure that only shows up on a reply nobody wrote on purpose.
            string[] rejected =
            [
                "not json",
                "",
                "null",
                "[]",
                "[1,2]",
                "\"a string\"",
                "42",
                """{"protocol":1,"outcome":"chatted"}""",
                """{"protocol":1,"outcome":"chatted","lines":["a"],"extra":1}""",
                """{"protocol":2,"outcome":"chatted","lines":["a"]}""",
                """{"protocol":"1","outcome":"chatted","lines":["a"]}""",
                """{"protocol":null,"outcome":"chatted","lines":["a"]}""",
                """{"protocol":1,"outcome":"chatting","lines":["a"]}""",
                """{"protocol":1,"outcome":null,"lines":["a"]}""",
                """{"protocol":1,"outcome":"chatted","lines":"a"}""",
                """{"protocol":1,"outcome":"chatted","lines":[1]}""",
                """{"protocol":1,"outcome":"chatted","lines":["ok",null]}""",
            ];

            foreach (var line in rejected)
            {
                var decoded = LanguageFraming.DecodeReply(line);
                Assert.Equal(DecodedLanguageReplyKind.Unreadable, decoded.Kind,
                    $"the kind for {JsonSerializer.Serialize(line)}");
                Assert.NotNull(decoded.Reason, $"the reason for {JsonSerializer.Serialize(line)}");
            }
        });

        run.Add("language: a numeric version that JavaScript would call equal is equal here too", () =>
        {
            // `protocol !== LANGUAGE_PROTOCOL_VERSION` in JavaScript is a numeric comparison, and
            // `1.0` is the number 1. Reading the field as an integer instead would refuse a line the
            // other side considers perfectly well-formed.
            Assert.Equal(DecodedLanguageReplyKind.Reply,
                LanguageFraming.DecodeReply("""{"protocol":1.0,"outcome":"chatted","lines":[]}""").Kind,
                "the kind for a version written 1.0");
        });

        run.Add("language: a repeated key collapses the way JSON.parse collapses it", () =>
        {
            // `JSON.parse` keeps the last of a repeated key and counts the key once. A decoder that
            // enumerated the object's properties would answer this differently, and the two would
            // disagree about a line that is otherwise a perfectly ordinary reply.
            var decoded = LanguageFraming.DecodeReply(
                """{"protocol":1,"protocol":1,"outcome":"chatted","lines":["last wins"]}""");

            Assert.Equal(DecodedLanguageReplyKind.Reply, decoded.Kind, "the kind");
            Assert.SequenceEqual(new[] { "last wins" }, decoded.Reply!.Lines, "the lines");
        });

        run.Add("language: the reply bound is the request bound plus slack", () =>
        {
            Assert.Equal(64 * 1024, LanguageFraming.MaxLanguageRequestLine, "the request bound");
            Assert.Equal(LanguageFraming.MaxLanguageRequestLine + 4096, LanguageFraming.MaxLanguageReplyLine,
                "the reply bound");
            Assert.Equal(8 * 1024, LanguageFraming.MaxLanguageTextLength, "the question bound");
        });

        run.Add("language: the line reader frames, bounds, and stays overflowed", () =>
        {
            var reader = new LanguageLineReader(8);

            Assert.Equal(DeliveryLineReadKind.Pending, reader.Push("abc").Kind, "a partial line");

            // "abcd" is the first line, not "d": the reader had "abc" pending and the newline did not
            // arrive until the fourth character. What it holds afterwards is "ef".
            var first = reader.Push("d\nef");
            Assert.Equal(DeliveryLineReadKind.Line, first.Kind, "the first complete line");
            Assert.Equal("abcd", first.Line, "the first line's text");

            var line = reader.Push("\n");
            Assert.Equal(DeliveryLineReadKind.Line, line.Kind, "the buffered second line");
            Assert.Equal("ef", line.Line, "the buffered line's text");

            // Exactly at the bound is fine; one past it is not.
            Assert.Equal(DeliveryLineReadKind.Line, new LanguageLineReader(3).Push("abc\n").Kind,
                "a line exactly at the bound");
            Assert.Equal(DeliveryLineReadKind.Overflow, new LanguageLineReader(3).Push("abcd\n").Kind,
                "a line one past the bound");

            var overflowing = new LanguageLineReader(3);
            Assert.Equal(DeliveryLineReadKind.Overflow, overflowing.Push("abcd").Kind, "the overflow");
            Assert.Equal(DeliveryLineReadKind.Overflow, overflowing.Push("a\n").Kind,
                "the reader after it overflowed, which does not recover");
        });
    }
}
