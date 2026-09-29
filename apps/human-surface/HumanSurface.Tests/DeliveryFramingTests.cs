using HumanSurface.Core;

namespace HumanSurface.Tests;

internal static class DeliveryFramingTests
{
    public static void Register(TestRun run)
    {
        run.Add("framing: a framed message decodes to its lines", () =>
        {
            var lines = DeliveryFraming.Decode("[\"header\",\"  indented\"]");
            Assert.NotNull(lines, "decoded lines");
            Assert.SequenceEqual(new[] { "header", "  indented" }, lines!, "decoded lines");
        });

        run.Add("framing: whitespace inside a line survives the round trip", () =>
        {
            // The renderer indents continuation lines, so leading spaces are content rather than
            // formatting, and a decoder that trimmed them would be editing what Hikari said.
            var lines = DeliveryFraming.Decode("[\"\\u3000\\u3000全角空格\",\"\\ttab\"]");
            Assert.NotNull(lines, "decoded lines");
            Assert.SequenceEqual(new[] { "\u3000\u3000全角空格", "\ttab" }, lines!, "decoded lines");
        });

        run.Add("framing: a line that is not a frame is not an empty message", () =>
        {
            // Each of these would render as "Hikari said nothing" if the decoder folded it into an
            // empty array, and every one of them actually means something else went wrong.
            string[] notFrames =
            [
                "not json",
                "{\"a\":1}",
                "[1,2]",
                "[\"ok\",1]",
                "[\"ok\",null]",
                "null",
                "",
                "\"a string\"",
                "[\"unterminated\"",
            ];

            foreach (var line in notFrames)
            {
                Assert.Null(DeliveryFraming.Decode(line), $"decoding {line}");
            }
        });

        run.Add("framing: an empty array is a frame, and decodes to nothing", () =>
        {
            // Distinct from the case above on purpose: `[]` is a well-formed message with no lines.
            // Whether that should ever be sent is the sender's question; that it is readable is this
            // one's.
            var lines = DeliveryFraming.Decode("[]");
            Assert.NotNull(lines, "decoded lines");
            Assert.Equal(0, lines!.Count, "decoded line count");
        });

        run.Add("framing: the reader holds a partial line until its newline arrives", () =>
        {
            var reader = new DeliveryLineReader();

            var first = reader.Push("[\"par");
            Assert.Equal(DeliveryLineReadKind.Pending, first.Kind, "first push");

            var second = reader.Push("tial\"]\n");
            Assert.Equal(DeliveryLineReadKind.Line, second.Kind, "second push");
            Assert.Equal("[\"partial\"]", second.Line, "the joined line");
        });

        run.Add("framing: a burst of frames is drained one at a time", () =>
        {
            // The failure this guards against is real and silent: a reader that kept reading the pipe
            // without first emptying its buffer would stall until the sender happened to write again,
            // turning two messages that arrived together into one that arrived and one that waited.
            var reader = new DeliveryLineReader();

            Assert.Equal("[\"a\"]", reader.Push("[\"a\"]\n[\"b\"]\n[\"c\"]").Line, "first line");
            Assert.Equal("[\"b\"]", reader.Push(string.Empty).Line, "second line");
            Assert.Equal(DeliveryLineReadKind.Pending, reader.Push(string.Empty).Kind, "third line is partial");
            Assert.Equal("[\"c\"]", reader.Push("\n").Line, "third line");
        });

        run.Add("framing: an unbounded line is refused rather than buffered", () =>
        {
            var reader = new DeliveryLineReader(limit: 16);

            Assert.Equal(DeliveryLineReadKind.Pending, reader.Push(new string('x', 16)).Kind, "at the limit");
            Assert.Equal(DeliveryLineReadKind.Overflow, reader.Push("x").Kind, "past the limit");
        });

        run.Add("framing: the limit applies to a completed line too", () =>
        {
            var reader = new DeliveryLineReader(limit: 16);
            Assert.Equal(DeliveryLineReadKind.Overflow, reader.Push(new string('x', 17) + "\n").Kind,
                "a line longer than the limit");
        });
    }
}
