using HumanSurface.Core;

namespace HumanSurface.Tests;

internal static class SurfaceSessionTests
{
    private const string AnyPath = @"\\.\pipe\hikari-human-delivery-0000000000000000";

    private static TimeSpan S(double seconds) => TimeSpan.FromSeconds(seconds);

    private static SurfaceSession Session(FakeDeliveryConnector connector,
        Func<TimeSpan, CancellationToken, Task>? delay = null) => new(AnyPath, connector, delay);

    /// <summary>
    /// Resolves when the session reports the given connection state, driven by its own event rather
    /// than by polling — so a test that waits for a state change is not also asserting a speed.
    /// </summary>
    private static Task AwaitConnection(SurfaceSession session, SurfaceConnection wanted) =>
        Await(session, () => session.Snapshot().Connection == wanted);

    private static async Task Await(SurfaceSession session, Func<bool> condition)
    {
        var reached = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        void Handler()
        {
            if (condition()) reached.TrySetResult();
        }

        session.Changed += Handler;
        Handler();

        try
        {
            await reached.Task.WaitAsync(S(10)).ConfigureAwait(false);
        }
        finally
        {
            session.Changed -= Handler;
        }
    }

    public static void Register(TestRun run)
    {
        run.Add("session: before anything is attempted it is disconnected", () =>
        {
            var snapshot = Session(new FakeDeliveryConnector()).Snapshot();

            Assert.Equal(SurfaceConnection.Disconnected, snapshot.Connection, "the connection");
            Assert.Equal(0, snapshot.Messages.Count, "the message count");
            Assert.Null(snapshot.Detail, "the detail");
        });

        run.Add("session: nothing listening backs off one, two, four, eight, then ten seconds", async () =>
        {
            var connector = new FakeDeliveryConnector();
            var session = Session(connector);

            var delays = new List<TimeSpan>();
            for (var attempt = 0; attempt < 5; attempt++)
            {
                delays.Add(await session.ConnectOnceAsync(CancellationToken.None));
            }

            Assert.SequenceEqual(new[] { S(1), S(2), S(4), S(8), S(10) }, delays, "the retry delays");
            Assert.Equal(5, connector.ConnectCount, "the attempt count");
        });

        run.Add("session: an absent resident carries no detail, because there is nothing to explain", async () =>
        {
            var session = Session(new FakeDeliveryConnector());
            await session.ConnectOnceAsync(CancellationToken.None);

            var snapshot = session.Snapshot();
            Assert.Equal(SurfaceConnection.Disconnected, snapshot.Connection, "the connection");
            Assert.Null(snapshot.Detail, "the detail");
        });

        run.Add("session: a resident that appears is connected, and the pace starts over", async () =>
        {
            var connector = new FakeDeliveryConnector();
            connector.Absent().Absent().Connect(Reads.Ended()).Absent();
            var session = Session(connector);

            Assert.Equal(S(1), await session.ConnectOnceAsync(CancellationToken.None), "after the first absence");
            Assert.Equal(S(2), await session.ConnectOnceAsync(CancellationToken.None), "after the second absence");

            // The third attempt attaches and the connection then ends: the delay that follows is the
            // first one again, not the fourth, because a connection happened in between.
            Assert.Equal(S(1), await session.ConnectOnceAsync(CancellationToken.None), "after a connection");
            Assert.Equal(S(2), await session.ConnectOnceAsync(CancellationToken.None), "after the next absence");
        });

        run.Add("session: a live subscription reports connected while it lasts", async () =>
        {
            var connector = new FakeDeliveryConnector();
            connector.ConnectAndWait();
            var session = Session(connector);

            using var cancellation = new CancellationTokenSource();
            var loop = session.RunAsync(cancellation.Token);

            await AwaitConnection(session, SurfaceConnection.Connected);
            Assert.Equal(SurfaceConnection.Connected, session.Snapshot().Connection, "the connection");

            await cancellation.CancelAsync();
            await loop;
        });

        run.Add("session: a resident that disappears returns it to disconnected", async () =>
        {
            // Held open deliberately. Scripting `Message, Ended` instead would spend a few
            // microseconds connected and then assert the state it had already left — which is a test
            // about scheduling, not about what the Surface reports.
            var subscription = new FakeSubscription([], live: true);
            var connector = new FakeDeliveryConnector().Accepts(subscription).ConnectAndWait();
            var session = Session(connector);

            using var cancellation = new CancellationTokenSource();
            var loop = session.RunAsync(cancellation.Token);

            await AwaitConnection(session, SurfaceConnection.Connected);

            subscription.Deliver("hello");
            await Await(session, () => session.Snapshot().Messages.Count == 1);

            subscription.End();
            await AwaitConnection(session, SurfaceConnection.Disconnected);

            var snapshot = session.Snapshot();
            Assert.Equal(SurfaceConnection.Disconnected, snapshot.Connection, "the connection");
            Assert.Null(snapshot.Detail, "a resident that stops is not an error");
            Assert.Equal(1, snapshot.Messages.Count, "the message from before it stopped");

            await AwaitConnection(session, SurfaceConnection.Connected);
            Assert.Equal(2, connector.ConnectCount, "the attempt count");

            await cancellation.CancelAsync();
            await loop;
        });

        run.Add("session: a delivered message is stored once, in order, exactly as it arrived", async () =>
        {
            var connector = new FakeDeliveryConnector();
            connector.Connect(
                Reads.Message("Desktop return attention：", "  观察时间：15:34:55", "  全角　空格"),
                Reads.Message("second message"),
                Reads.Ended());

            var session = Session(connector);
            await session.ConnectOnceAsync(CancellationToken.None);

            var snapshot = session.Snapshot();
            Assert.Equal(2, snapshot.Messages.Count, "the message count");
            Assert.SequenceEqual(
                new[] { "Desktop return attention：", "  观察时间：15:34:55", "  全角　空格" },
                snapshot.Messages[0].Lines,
                "the first message's lines");
            Assert.SequenceEqual(new[] { "second message" }, snapshot.Messages[1].Lines,
                "the second message's lines");
        });

        run.Add("session: messages are bounded and the oldest is dropped", async () =>
        {
            var connector = new FakeDeliveryConnector();
            var reads = Enumerable.Range(0, SurfaceSession.MessageLimit + 3)
                .Select(index => Reads.Message($"m{index}"))
                .Append(Reads.Ended())
                .ToArray();
            connector.Connect(reads);

            var session = Session(connector);
            await session.ConnectOnceAsync(CancellationToken.None);

            var snapshot = session.Snapshot();
            Assert.Equal(SurfaceSession.MessageLimit, snapshot.Messages.Count, "the stored count");
            Assert.SequenceEqual(new[] { "m3" }, snapshot.Messages[0].Lines, "the oldest kept message");
            Assert.SequenceEqual(
                new[] { $"m{SurfaceSession.MessageLimit + 2}" },
                snapshot.Messages[^1].Lines,
                "the newest message");
        });

        run.Add("session: unread counts arrivals and opening the window clears it", async () =>
        {
            var connector = new FakeDeliveryConnector();
            connector.Connect(Reads.Message("one"), Reads.Message("two"), Reads.Ended());
            var session = Session(connector);

            await session.ConnectOnceAsync(CancellationToken.None);
            Assert.Equal(2, session.Snapshot().UnreadCount, "the unread count after two arrivals");

            session.MarkRead();
            Assert.Equal(0, session.Snapshot().UnreadCount, "the unread count after opening the window");

            // The messages themselves stay: clearing the count is about the tray's hint, not about the
            // window's contents, and a person who opens the window late still sees what was said.
            Assert.Equal(2, session.Snapshot().Messages.Count, "the stored count after marking read");
        });

        run.Add("session: a message raised exactly one event per arrival", async () =>
        {
            var connector = new FakeDeliveryConnector();
            connector.Connect(Reads.Message("one"), Reads.Message("two"), Reads.Ended());
            var session = Session(connector);

            var arrived = new List<SurfaceMessage>();
            session.MessageReceived += arrived.Add;

            await session.ConnectOnceAsync(CancellationToken.None);

            Assert.Equal(2, arrived.Count, "the arrival count");
            Assert.SequenceEqual(new[] { "one" }, arrived[0].Lines, "the first arrival");
        });

        run.Add("session: a frame that cannot be read disconnects without being rendered", async () =>
        {
            var connector = new FakeDeliveryConnector();
            connector.Connect(
                Reads.Message("a real message"),
                Reads.Unavailable("收到一行不是投递帧的数据"),
                Reads.Ended());

            var session = Session(connector);
            var arrived = new List<SurfaceMessage>();
            session.MessageReceived += arrived.Add;

            await session.ConnectOnceAsync(CancellationToken.None);

            var snapshot = session.Snapshot();
            Assert.Equal(1, arrived.Count, "the arrival count");
            Assert.Equal(1, snapshot.Messages.Count, "the stored count");
            Assert.Equal(SurfaceConnection.Disconnected, snapshot.Connection, "the connection");
            Assert.Equal("收到一行不是投递帧的数据", snapshot.Detail, "the detail");
        });

        run.Add("session: a refused subscription leaves the Surface running", async () =>
        {
            // What a second subscriber sees when someone else already holds the pipe: the server
            // destroys the new connection. The Surface must report it and keep trying, never exit.
            var connector = new FakeDeliveryConnector();
            connector.Unavailable("管道已被占用").Absent();
            var session = Session(connector);

            Assert.Equal(S(1), await session.ConnectOnceAsync(CancellationToken.None), "after the refusal");

            var snapshot = session.Snapshot();
            Assert.Equal(SurfaceConnection.Disconnected, snapshot.Connection, "the connection");
            Assert.Equal("管道已被占用", snapshot.Detail, "the detail");

            Assert.Equal(S(2), await session.ConnectOnceAsync(CancellationToken.None), "the next attempt");
        });

        run.Add("session: a connector that throws does not escape the state machine", async () =>
        {
            var connector = new FakeDeliveryConnector();
            connector.Throws(new IOException("pipe is broken"));
            var session = Session(connector);

            var delay = await session.ConnectOnceAsync(CancellationToken.None);

            Assert.Equal(S(1), delay, "the delay after a thrown connector");
            Assert.Equal(SurfaceConnection.Disconnected, session.Snapshot().Connection, "the connection");
            Assert.Equal("pipe is broken", session.Snapshot().Detail, "the detail");
        });

        run.Add("session: reconnecting does not replay what was missed", async () =>
        {
            var connector = new FakeDeliveryConnector();
            connector.Connect(Reads.Message("before the resident stopped"), Reads.Ended());
            connector.Absent();
            connector.Connect(Reads.Message("after it came back"), Reads.Ended());

            var session = Session(connector);
            await session.ConnectOnceAsync(CancellationToken.None);
            await session.ConnectOnceAsync(CancellationToken.None);
            await session.ConnectOnceAsync(CancellationToken.None);

            var snapshot = session.Snapshot();
            Assert.Equal(2, snapshot.Messages.Count, "the stored count");
            Assert.SequenceEqual(new[] { "before the resident stopped" }, snapshot.Messages[0].Lines,
                "the message from before");
            Assert.SequenceEqual(new[] { "after it came back" }, snapshot.Messages[1].Lines,
                "the message from after");
        });

        run.Add("session: the subscription is released when the connection ends", async () =>
        {
            var subscription = new FakeSubscription([Reads.Message("hi"), Reads.Ended()], live: false);
            var connector = new FakeDeliveryConnector().Accepts(subscription);

            var session = Session(connector);
            await session.ConnectOnceAsync(CancellationToken.None);

            Assert.Equal(1, subscription.Disposals, "the disposal count");
        });

        run.Add("session: a snapshot does not change underneath its reader", async () =>
        {
            var subscription = new FakeSubscription([], live: true);
            var session = Session(new FakeDeliveryConnector().Accepts(subscription));

            using var cancellation = new CancellationTokenSource();
            var loop = session.RunAsync(cancellation.Token);
            await AwaitConnection(session, SurfaceConnection.Connected);

            subscription.Deliver("first");
            await Await(session, () => session.Snapshot().Messages.Count == 1);
            var before = session.Snapshot();

            subscription.Deliver("second");
            await Await(session, () => session.Snapshot().Messages.Count == 2);

            Assert.Equal(1, before.Messages.Count, "the earlier snapshot's count");
            Assert.Equal(2, session.Snapshot().Messages.Count, "the current count");

            subscription.End();
            await cancellation.CancelAsync();
            await loop;
        });
    }
}
