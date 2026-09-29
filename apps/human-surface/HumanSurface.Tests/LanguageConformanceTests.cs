using System.Text.Json;
using HumanSurface.Core;

namespace HumanSurface.Tests;

/// <summary>
/// The C# language client against the real TypeScript one, out of the repository's own <c>dist/</c>.
/// </summary>
/// <remarks>
/// <para>
/// The point of the whole exercise is that the Surface is a second implementation of a protocol it does
/// not own. Neither side can be read as evidence that they agree; only running both can show it, and
/// these cases are what stand in for the reader who would otherwise have to hold two files in their
/// head and hope.
/// </para>
/// <para>
/// The two directions are not symmetric and are not tested as if they were. The Surface writes requests
/// and reads replies, so a request is checked by handing the bytes <em>it</em> produced to the real
/// decoder, and a reply by decoding the bytes the real encoder produced. The request case is the only
/// place in this repository where Node reads something C# wrote, which is why it goes through standard
/// input rather than being described in the helper.
/// </para>
/// </remarks>
internal static class LanguageConformanceTests
{
    private const string PathName = "conformance: the language endpoint path agrees with the TypeScript derivation";
    private const string RequestName = "conformance: the real decoder reads the client's request as the question it encoded";
    private const string FramingName = "conformance: the real line reader frames the client's request as one line";
    private const string ReplyName = "conformance: the reply decoder accepts and rejects exactly what the TypeScript one does";
    private const string TimeoutName = "conformance: the client's wait bound is the one the TypeScript client computes";
    private const string BoundName = "conformance: the framing bounds are the ones the protocol declares";

    /// <summary>
    /// Questions the real decoder is asked to read back, chosen so that a lossy encoder is caught.
    /// </summary>
    /// <remarks>
    /// The last entry is a whole question at the protocol's own maximum. It is here because it is the
    /// one length where two bounds meet — the text bound and the line bound — and an encoder that got
    /// the framing wrong would still pass every shorter case.
    /// </remarks>
    private static readonly JsonSerializerOptions Payload =
        new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static string[] Questions() =>
    [
        "你好",
        string.Empty,
        "引号 \" 和反斜杠 \\ 和制表符 \t 和换行 \n",
        "  全角　空格 和 emoji 🙂",
        "</script> & <html> 和 a/b",
        new string('问', LanguageFraming.MaxLanguageTextLength),
    ];

    public static async Task RegisterAsync(TestRun run)
    {
        var reason = NodeBridge.UnavailableReason;

        if (!NodeBridge.Available)
        {
            run.Skip(PathName, reason);
            run.Skip(RequestName, reason);
            run.Skip(FramingName, reason);
            run.Skip(ReplyName, reason);
            run.Skip(TimeoutName, reason);
            run.Skip(BoundName, reason);
            return;
        }

        // Lower-case keys because that is the shape the helper documents on its own standard input. The
        // two files are a contract, and a silent mismatch between their spellings would arrive as a
        // question with a null text rather than as an error — which is exactly what it did the first
        // time this ran, and why the helper's header states the shape rather than leaving it implied.
        var questions = Questions();
        var payload = JsonSerializer.Serialize(
            questions.Select(text => new SentQuestion(text, LanguageFraming.EncodeRequest(text))),
            Payload);

        var result = await NodeBridge.RunToCompletionWithInputAsync(
            "conformance.mjs", payload, NodeBridge.RepositoryRoot!);

        if (result.ExitCode != 0)
        {
            throw new AssertionException(
                $"the conformance helper failed with exit code {result.ExitCode}\n{result.StandardError}");
        }

        var conformance = JsonSerializer.Deserialize<Conformance>(result.StandardOutput,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new AssertionException(
                $"the conformance helper printed nothing readable: {result.StandardOutput}");

        RegisterPath(run, conformance);
        RegisterRequests(run, conformance, questions);
        RegisterReplies(run, conformance);
        RegisterTimeout(run, conformance);
    }

    private static void RegisterPath(TestRun run, Conformance conformance)
    {
        if (!OperatingSystem.IsWindows())
        {
            // The TypeScript side answers `undefined` off Windows, so there is nothing to compare the
            // C# derivation against there.
            run.Skip(PathName, "the endpoint derivation is Windows-only on both sides");
            return;
        }

        run.Add(PathName, () =>
        {
            foreach (var pathCase in conformance.LanguagePaths)
            {
                Assert.Equal(pathCase.Node, LanguageEndpointPath.For(pathCase.Input),
                    $"the derived path for {pathCase.Input}");
            }
        });
    }

    private static void RegisterRequests(TestRun run, Conformance conformance,
        IReadOnlyList<string> questions)
    {
        run.Add(RequestName, () =>
        {
            Assert.Equal(questions.Count, conformance.Requests.Count, "the questions the helper saw");

            for (var index = 0; index < questions.Count; index++)
            {
                var sent = conformance.Requests[index];
                var what = $"the question {index} ({Show(Shorten(sent.Text))})";

                // Not "TypeScript accepted it": the claim is that the server reads back exactly the
                // question that was asked. A decoder that accepted the line and found a different text
                // in it would be a request that arrived as something other than what was meant.
                Assert.NotNull(sent.Node, $"{what} decoding");
                Assert.Equal("ask", sent.Node!.Word, $"{what} word");
                Assert.Equal(questions[index], sent.Node.Text, $"{what} text");
            }
        });

        run.Add(FramingName, () =>
        {
            // A separate claim from the one above, and the two fail for unrelated reasons. A question
            // that decodes perfectly is still never served if it reaches the server as two frames: the
            // real endpoint hands the first line to the decoder and drops the rest on the floor, and it
            // does that without an error anyone would see. The maximum-length question is why this case
            // is not redundant — it is the one input where a bound and a frame meet.
            //
            // There is deliberately no case comparing the two encoders' bytes. They are not equal — .NET
            // escapes a wider set of characters than `JSON.stringify` does, and writes control characters
            // with upper-case hex — and they do not have to be, because what the protocol requires is
            // that the server reads the same question back. That is the case above.
            foreach (var sent in conformance.Requests)
            {
                var what = $"the frame for {Show(Shorten(sent.Text))}";

                Assert.Equal("line", sent.Framed.Kind, $"{what} being one line");
                Assert.Equal(LanguageFraming.EncodeRequest(sent.Text)[..^1], sent.Framed.Line,
                    $"{what}'s text");
            }
        });
    }

    private static void RegisterReplies(TestRun run, Conformance conformance)
    {
        run.Add(ReplyName, () =>
        {
            foreach (var replyCase in conformance.Replies)
            {
                var ours = LanguageFraming.DecodeReply(replyCase.Line);
                var what = $"decoding {Show(replyCase.Line)}";

                if (replyCase.Node is null)
                {
                    Assert.Equal(DecodedLanguageReplyKind.Unreadable, ours.Kind,
                        $"{what}, which TypeScript rejects");
                    continue;
                }

                Assert.Equal(DecodedLanguageReplyKind.Reply, ours.Kind,
                    $"{what}, which TypeScript accepts");

                // By name rather than by position: the four words are the protocol, and a mapping that
                // went by enum order would agree with a decoder that had shuffled them as long as both
                // sides shuffled the same way.
                Assert.Equal(Enum.Parse<LanguageReplyOutcome>(replyCase.Node.Outcome, ignoreCase: true),
                    ours.Reply!.Outcome, $"{what} outcome");
                Assert.SequenceEqual(replyCase.Node.Lines, ours.Reply.Lines, $"{what} lines");
            }
        });
    }

    private static void RegisterTimeout(TestRun run, Conformance conformance)
    {
        run.Add(TimeoutName, () =>
        {
            // Both halves matter and they are different claims. The first is that the C# client's number
            // is the TypeScript client's number; the second is that it is still the derivation, so that
            // a change to the constant that happened to leave today's value alone is still caught.
            Assert.Equal(conformance.Timeout.ReplyTimeoutMs, PipeLanguageAsker.ReplyTimeoutMilliseconds,
                "the client's whole wait bound");
            Assert.Equal(conformance.Timeout.LongestExposureCount, PipeLanguageAsker.LongestExposureCount,
                "the longest exposure count");
            Assert.Equal(
                (PipeLanguageAsker.LongestExposureCount + 1) * PipeLanguageAsker.ModelTimeoutMilliseconds +
                PipeLanguageAsker.ReadAndFramingBudgetMilliseconds,
                PipeLanguageAsker.ReplyTimeoutMilliseconds,
                "the bound, re-derived from its own terms");

            Assert.Equal(conformance.Timeout.ModelTimeoutMs, PipeLanguageAsker.ModelTimeoutMilliseconds,
                "the transport's per-call bound");
            Assert.Equal(conformance.Timeout.ReadAndFramingBudgetMs,
                PipeLanguageAsker.ReadAndFramingBudgetMilliseconds, "the read and framing budget");
        });

        run.Add(BoundName, () =>
        {
            Assert.Equal(conformance.Timeout.ProtocolVersion, LanguageFraming.ProtocolVersion, "the version");
            Assert.Equal(conformance.Timeout.MaxTextLength, LanguageFraming.MaxLanguageTextLength,
                "the question bound");
            Assert.Equal(conformance.Timeout.MaxRequestLine, LanguageFraming.MaxLanguageRequestLine,
                "the request line bound");
            Assert.Equal(conformance.Timeout.MaxReplyLine, LanguageFraming.MaxLanguageReplyLine,
                "the reply line bound");
        });
    }

    // A maximum-length question is 8192 characters and reading it back in a failure message helps
    // nobody. The length is what the case would be about; the head is what identifies it.
    private static string Shorten(string text) => text.Length <= 60 ? text : text[..60] + "…";

    private static string Show(string value) => JsonSerializer.Serialize(value);

    private sealed record SentQuestion(string Text, string Wire);

    private sealed record Conformance(
        IReadOnlyList<PathCase> LanguagePaths,
        TimeoutCase Timeout,
        IReadOnlyList<RequestCase> Requests,
        IReadOnlyList<ReplyCase> Replies);

    private sealed record PathCase(string Input, string? Node);

    private sealed record TimeoutCase(
        int LongestExposureCount,
        int ModelTimeoutMs,
        int ReadAndFramingBudgetMs,
        int ReplyTimeoutMs,
        int MaxTextLength,
        int MaxRequestLine,
        int MaxReplyLine,
        int ProtocolVersion);

    private sealed record RequestCase(string Text, string NodeWire, NodeRequest? Node, FramedCase Framed);

    private sealed record NodeRequest(string Word, string Text);

    private sealed record FramedCase(string Kind, string? Line);

    private sealed record ReplyCase(string Line, NodeReply? Node);

    private sealed record NodeReply(string Outcome, IReadOnlyList<string> Lines);
}
