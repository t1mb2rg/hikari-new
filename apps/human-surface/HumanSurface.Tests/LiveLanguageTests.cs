using HumanSurface.Core;

namespace HumanSurface.Tests;

/// <summary>
/// The language client against the repository's own endpoint, over a real named pipe.
/// </summary>
/// <remarks>
/// <para>
/// These assert the transport and the client's failure branches, not the state machine — that is covered
/// against a fake, where every timing is stated rather than observed. What only a live run can show is
/// that the bytes this client writes are framed and decoded by the real server, that the reply the real
/// server encodes is read back as the lines it meant, and that the three ways asking can fail are the
/// three that actually happen.
/// </para>
/// <para>
/// <b>No model is involved and none of this is evidence about one.</b> The endpoint's answer is chosen by
/// the test, which is the same seam the plugin uses to inject a model factory. A resident answering a
/// real question needs a model endpoint this machine does not have, so that case is not run here and is
/// not reported as passing.
/// </para>
/// </remarks>
internal static class LiveLanguageTests
{
    private const string VerbatimName = "live-language: the real endpoint's reply arrives verbatim";
    private const string RefusalName = "live-language: a refusal is carried through as the endpoint's own word";
    private const string AbsentName = "live-language: nothing listening is an absence, not a failure";
    private const string ClosingName = "live-language: an endpoint that goes away mid-question is not waited out";

    public static Task RegisterAsync(TestRun run)
    {
        var reason = !OperatingSystem.IsWindows()
            ? "the language endpoint is a Windows named pipe"
            : NodeBridge.UnavailableReason;

        if (!NodeBridge.Available || !OperatingSystem.IsWindows())
        {
            run.Skip(VerbatimName, reason);
            run.Skip(RefusalName, reason);
            run.Skip(AbsentName, reason);
            run.Skip(ClosingName, reason);
            return Task.CompletedTask;
        }

        var root = NodeBridge.RepositoryRoot!;

        run.Add(VerbatimName, async () =>
        {
            // Content chosen to fail loudly if anything on the path is lossy: CJK, a full-width space,
            // an emoji outside the basic plane, and JSON's own escape characters.
            string[] lines =
            [
                "桌面没有变化。",
                "  引号 \" 和反斜杠 \\ 和制表符 \t",
                "  全角　空格 和 emoji 🙂",
            ];

            await using var endpoint = await LiveLanguageEndpoint.StartAsync(
                root, new LanguageReply(LanguageReplyOutcome.Answered, lines));

            var asker = new PipeLanguageAsker();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            var result = await asker.AskAsync(endpoint.EndpointPath, "现在怎么样？", timeout.Token);

            Assert.Equal(LanguageAskKind.Replied, result.Kind,
                $"the ask outcome ({result.Detail ?? "no detail"})");
            Assert.Equal(LanguageReplyOutcome.Answered, result.Reply!.Outcome, "the outcome");
            Assert.SequenceEqual(lines, result.Reply.Lines, "the reply's lines");

            // The endpoint framed a request, which means the line the client wrote was one the real
            // decoder read as an ask. A client that wrote something else would have been answered
            // `failed` by the real server rather than by this assertion.
            await endpoint.WaitForAsync(line => line == "ASKED");
        });

        run.Add(RefusalName, async () =>
        {
            await using var endpoint = await LiveLanguageEndpoint.StartAsync(
                root, new LanguageReply(LanguageReplyOutcome.Refused, ["这个问题我答不了。"]));

            var asker = new PipeLanguageAsker();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            var result = await asker.AskAsync(endpoint.EndpointPath, "帮我删掉那个文件", timeout.Token);

            // The endpoint's own word, not the client's reading of it. `refused` and `failed` are
            // different things on the far side and the client has no standing to merge them.
            Assert.Equal(LanguageAskKind.Replied, result.Kind,
                $"the ask outcome ({result.Detail ?? "no detail"})");
            Assert.Equal(LanguageReplyOutcome.Refused, result.Reply!.Outcome, "the outcome");
        });

        run.Add(AbsentName, async () =>
        {
            // A data directory nothing has ever served, so the name is derived exactly as the Surface
            // would derive it and there is simply nobody there.
            var directory = Path.Combine(Path.GetTempPath(), $"hikari-surface-absent-{Guid.NewGuid():N}");
            var asker = new PipeLanguageAsker(TimeSpan.FromSeconds(1));

            var result = await asker.AskAsync(LanguageEndpointPath.For(directory), "有人吗",
                CancellationToken.None);

            Assert.Equal(LanguageAskKind.Absent, result.Kind,
                $"the outcome for a resident that is not running ({result.Detail ?? "no detail"})");
            Assert.Null(result.Detail, "the detail for an ordinary absence");
        });

        run.Add(ClosingName, async () =>
        {
            // `hold` is an endpoint that takes the request and never answers. Its going away is then the
            // only thing that can end the wait, which is what makes this a case about the branch that
            // reports it rather than about a timeout being generous enough to cover it.
            await using var endpoint = await LiveLanguageEndpoint.StartAsync(root, null);

            var asker = new PipeLanguageAsker();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            var asking = asker.AskAsync(endpoint.EndpointPath, "现在怎么样？", timeout.Token);

            await endpoint.WaitForAsync(line => line == "ASKED");
            await endpoint.SendAsync("close");
            await endpoint.WaitForAsync(line => line == "CLOSED");

            var result = await asking;

            // Not an absence: something was there, took the question, and stopped. The client's whole
            // budget is 150 seconds and this must not have spent it — the wait ends when the connection
            // does, and the wait on `asking` above is what would fail if it did not.
            Assert.Equal(LanguageAskKind.Unavailable, result.Kind, "the outcome after the endpoint went away");
            Assert.Equal("语言入口关闭了连接，但没有应答。", result.Detail, "the detail");
        });

        return Task.CompletedTask;
    }
}
