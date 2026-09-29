using HumanSurface.Core;

namespace HumanSurface.Tests;

/// <summary>
/// The half of the session that asks: one question at a time, everything landing in one transcript, and
/// the listening loop carrying on regardless.
/// </summary>
/// <remarks>
/// The case that matters most here is the one the mandate names: a proactive message has to be able to
/// reach the window while a question is outstanding. It is tested against a real session driven by a
/// fake endpoint that holds its answer open, so the overlapping is stated by the test rather than won
/// by timing.
/// </remarks>
internal static class AskSessionTests
{
    private const string DeliveryPath = @"\\.\pipe\hikari-human-delivery-0000000000000000";
    private const string LanguagePath = @"\\.\pipe\hikari-language-0000000000000000";

    private static SurfaceSession Session(FakeLanguageAsker asker, IDeliveryConnector? connector = null) =>
        new(DeliveryPath, connector ?? new FakeDeliveryConnector(), LanguagePath, asker);

    public static void Register(TestRun run)
    {
        run.Add("ask: a question is recorded, answered, and the session returns to idle", async () =>
        {
            var asker = new FakeLanguageAsker().Replies("桌面没有变化。");
            var session = Session(asker);

            Assert.False(session.Snapshot().AskPending, "pending before anything is asked");

            var accepted = await session.AskAsync("现在怎么样？", CancellationToken.None);

            Assert.True(accepted, "the question was accepted");
            Assert.False(session.Snapshot().AskPending, "pending after the answer arrived");
            Assert.SequenceEqual(new[] { "现在怎么样？" }, asker.Asked, "the questions put to the endpoint");

            // The language pipe and the delivery pipe are different pipes, and asking must reach the
            // first without touching the second.
            Assert.SequenceEqual(new[] { LanguagePath }, asker.Endpoints, "the endpoint the ask reached");

            var messages = session.Snapshot().Messages;
            Assert.Equal(2, messages.Count, "the transcript length");
            Assert.Equal(SurfaceOrigin.Human, messages[0].Origin, "the question's origin");
            Assert.SequenceEqual(new[] { "现在怎么样？" }, messages[0].Lines, "the question's lines");
            Assert.Equal(SurfaceOrigin.Hikari, messages[1].Origin, "the answer's origin");
            Assert.SequenceEqual(new[] { "桌面没有变化。" }, messages[1].Lines, "the answer's lines");
        });

        run.Add("ask: a second question is refused while the first is outstanding", async () =>
        {
            var asker = new FakeLanguageAsker().Holds();
            var session = Session(asker);

            var first = session.AskAsync("第一句", CancellationToken.None);
            await SessionAwait.Until(session, () => session.Snapshot().AskPending);

            // Refused by the session, not by a disabled button: the rule has to hold for any caller,
            // and the button is only how a person finds out.
            Assert.False(await session.AskAsync("第二句", CancellationToken.None), "the second question");

            asker.Release();
            Assert.True(await first, "the first question");

            Assert.SequenceEqual(new[] { "第一句" }, asker.Asked, "the questions that reached the endpoint");
            Assert.False(session.Snapshot().AskPending, "pending after both settled");
        });

        run.Add("ask: a proactive delivery still lands while a question is outstanding", async () =>
        {
            var asker = new FakeLanguageAsker().Holds();
            var subscription = new FakeSubscription([], live: true);
            var connector = new FakeDeliveryConnector().Accepts(subscription).ConnectAndWait();
            var session = Session(asker, connector);

            using var cancellation = new CancellationTokenSource();
            var loop = session.RunAsync(cancellation.Token);
            await SessionAwait.Connection(session, SurfaceConnection.Connected);

            var asking = session.AskAsync("现在怎么样？", CancellationToken.None);
            await SessionAwait.Until(session, () => session.Snapshot().AskPending);

            // The resident speaks while the question is still outstanding. Nothing about the ask may
            // hold this up, and nothing about it may reorder the transcript.
            subscription.Deliver("桌面回到了非空焦点。");
            await SessionAwait.Until(session, () => session.Snapshot().Messages.Count == 2);

            Assert.True(session.Snapshot().AskPending, "pending while the delivery was landing");
            Assert.Equal(SurfaceConnection.Connected, session.Snapshot().Connection,
                "the connection while the delivery was landing");

            asker.Release();
            await asking;

            var messages = session.Snapshot().Messages;
            Assert.Equal(3, messages.Count, "the transcript length");
            Assert.SequenceEqual(new[] { "现在怎么样？" }, messages[0].Lines, "the question");
            Assert.SequenceEqual(new[] { "桌面回到了非空焦点。" }, messages[1].Lines,
                "the proactive line, in the place it arrived");
            Assert.Equal(SurfaceOrigin.Hikari, messages[1].Origin, "the proactive line's origin");
            Assert.SequenceEqual(new[] { "the answer that was held" }, messages[2].Lines,
                "the answer, after it");

            subscription.End();
            await cancellation.CancelAsync();
            await loop;
        });

        run.Add("ask: neither the person's line nor the Surface's own notice counts as an arrival", async () =>
        {
            var asker = new FakeLanguageAsker().Absent();
            var session = Session(asker);

            var arrived = new List<SurfaceMessage>();
            session.MessageReceived += arrived.Add;

            await session.AskAsync("有人吗", CancellationToken.None);

            // Unread, the balloon and the tray hint are all claims about a person's attention. A
            // sentence they just typed, and this program's answer about its own failure to reach
            // Hikari, are not things they need to be told about.
            Assert.Equal(0, session.Snapshot().UnreadCount, "the unread count");
            Assert.Equal(0, arrived.Count, "the arrival count");
            Assert.Equal(2, session.Snapshot().Messages.Count, "the transcript length");
        });

        run.Add("ask: an endpoint that is not there is said in the Surface's own words", async () =>
        {
            var session = Session(new FakeLanguageAsker().Absent());

            await session.AskAsync("有人吗", CancellationToken.None);

            var messages = session.Snapshot().Messages;
            Assert.Equal(2, messages.Count, "the transcript length");
            Assert.Equal(SurfaceOrigin.Surface, messages[1].Origin, "the notice's origin");
            Assert.SequenceEqual(new[] { LanguageNotices.Absent }, messages[1].Lines, "the notice");

            // Not one of the endpoint's four words, and not a sentence Hikari said: `absent` means
            // nothing was reached, so there is nothing of Hikari's to report.
            Assert.False(session.Snapshot().AskPending, "pending after an absence");
        });

        run.Add("ask: an endpoint that answered wrong is reported with its reason", async () =>
        {
            var session = Session(new FakeLanguageAsker().Unavailable("应答不是一个 JSON 对象。"));

            await session.AskAsync("有人吗", CancellationToken.None);

            var messages = session.Snapshot().Messages;
            Assert.Equal(SurfaceOrigin.Surface, messages[1].Origin, "the notice's origin");
            Assert.SequenceEqual(
                new[] { LanguageNotices.Unavailable("应答不是一个 JSON 对象。") },
                messages[1].Lines,
                "the notice");
        });

        run.Add("ask: a refusal is Hikari's, and is carried through unchanged", async () =>
        {
            var asker = new FakeLanguageAsker()
                .RepliesWith(LanguageReplyOutcome.Refused, "这个问题我答不了。");
            var session = Session(asker);

            await session.AskAsync("帮我删掉那个文件", CancellationToken.None);

            // A refusal is something Hikari said. The Surface does not reword it, does not fold it into
            // its own voice, and does not treat it as a transport problem.
            var messages = session.Snapshot().Messages;
            Assert.Equal(SurfaceOrigin.Hikari, messages[1].Origin, "the refusal's origin");
            Assert.SequenceEqual(new[] { "这个问题我答不了。" }, messages[1].Lines, "the refusal's lines");
        });

        run.Add("ask: a conversation is carried through as one, like any other outcome", async () =>
        {
            var asker = new FakeLanguageAsker()
                .RepliesWith(LanguageReplyOutcome.Chatted, "你好。", "今天想聊点什么？");
            var session = Session(asker);

            await session.AskAsync("在吗", CancellationToken.None);

            // `chatted` is not an error and not a lesser `answered`. It is drawn exactly like one.
            var messages = session.Snapshot().Messages;
            Assert.Equal(SurfaceOrigin.Hikari, messages[1].Origin, "the chat's origin");
            Assert.SequenceEqual(new[] { "你好。", "今天想聊点什么？" }, messages[1].Lines, "the chat's lines");
        });

        run.Add("ask: an asker that throws does not escape the session and does not wedge it", async () =>
        {
            var asker = new FakeLanguageAsker()
                .Throws(new IOException("pipe is broken"))
                .Replies("第二次好了。");
            var session = Session(asker);

            Assert.True(await session.AskAsync("第一句", CancellationToken.None), "the first question");

            var messages = session.Snapshot().Messages;
            Assert.Equal(2, messages.Count, "the transcript length after the failure");
            Assert.Equal(SurfaceOrigin.Surface, messages[1].Origin, "the notice's origin");

            // The point of the one-in-flight rule being state rather than a counter: a question that
            // failed still has to clear it, or the Surface would never be able to ask again.
            Assert.False(session.Snapshot().AskPending, "pending after the asker threw");
            Assert.True(await session.AskAsync("第二句", CancellationToken.None), "the second question");
            Assert.SequenceEqual(new[] { "第二次好了。" }, session.Snapshot().Messages[^1].Lines,
                "the answer to the second question");
        });

        run.Add("ask: a question is asked on a disconnected session, and the delivery loop is untouched", async () =>
        {
            // No resident on the delivery pipe at all. The two pipes are independent, so this is an
            // ordinary state to ask from — and the answer says what happened rather than being refused
            // by the Surface for a connection state that has nothing to do with it.
            var asker = new FakeLanguageAsker().Replies("在。");
            var session = Session(asker);

            Assert.Equal(SurfaceConnection.Disconnected, session.Snapshot().Connection, "the connection");

            await session.AskAsync("在吗", CancellationToken.None);

            Assert.SequenceEqual(new[] { "在。" }, session.Snapshot().Messages[^1].Lines, "the answer");
            Assert.Equal(SurfaceConnection.Disconnected, session.Snapshot().Connection,
                "the connection after asking");
        });
    }
}
