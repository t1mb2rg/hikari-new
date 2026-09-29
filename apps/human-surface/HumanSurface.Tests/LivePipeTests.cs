using HumanSurface.Core;

namespace HumanSurface.Tests;

/// <summary>
/// The cases that need the real thing: the repository's own endpoint, a real named pipe, and a real
/// process that can stop.
/// </summary>
/// <remarks>
/// These assert the transport, not the state machine — the state machine is covered against a fake,
/// where every timing is stated rather than observed. What only a live run can show is that bytes
/// written by the real TypeScript encoder arrive through a real pipe as the same text, and that a
/// resident stopping looks like an ending rather than a failure.
/// </remarks>
internal static class LivePipeTests
{
    private const string VerbatimName = "live: a real endpoint's message arrives verbatim";
    private const string EndingName = "live: the resident stopping is an ordinary ending";
    private const string OccupiedName = "live: a second subscriber is refused and the first keeps working";
    private const string AbsentName = "live: nothing listening is an absence, not a failure";

    public static Task RegisterAsync(TestRun run)
    {
        var reason = !OperatingSystem.IsWindows()
            ? "the delivery endpoint is a Windows named pipe"
            : NodeBridge.UnavailableReason;

        if (!NodeBridge.Available || !OperatingSystem.IsWindows())
        {
            run.Skip(VerbatimName, reason);
            run.Skip(EndingName, reason);
            run.Skip(OccupiedName, reason);
            run.Skip(AbsentName, reason);
            return Task.CompletedTask;
        }

        var root = NodeBridge.RepositoryRoot!;

        run.Add(VerbatimName, async () =>
        {
            // Content chosen to fail loudly if anything on the path is lossy: CJK, a full-width space,
            // an emoji outside the basic plane, and JSON's own escape characters.
            string[] lines =
            [
                "Desktop return attention：",
                "  观察时间：15:34:55",
                "  引号 \" 和反斜杠 \\ 和制表符 \t",
                "  全角　空格 和 emoji 🙂",
            ];

            await using var endpoint = await LiveDeliveryEndpoint.StartAsync(root, lines);
            var connector = new PipeDeliveryConnector();

            var connected = await connector.ConnectAsync(endpoint.EndpointPath, CancellationToken.None);
            Assert.Equal(DeliveryConnectKind.Connected, connected.Kind,
                $"the connect outcome ({connected.Detail ?? "no detail"})");
            using var subscription = connected.Subscription!;

            await endpoint.SendAsync("write");

            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            var read = await subscription.ReadAsync(timeout.Token);

            Assert.Equal(DeliveryReadKind.Message, read.Kind, "the read outcome");
            Assert.SequenceEqual(lines, read.Lines!, "the delivered lines");
        });

        run.Add(EndingName, async () =>
        {
            await using var endpoint = await LiveDeliveryEndpoint.StartAsync(root, ["one message"]);
            var connector = new PipeDeliveryConnector();

            var connected = await connector.ConnectAsync(endpoint.EndpointPath, CancellationToken.None);
            Assert.Equal(DeliveryConnectKind.Connected, connected.Kind,
                $"the connect outcome ({connected.Detail ?? "no detail"})");
            using var subscription = connected.Subscription!;

            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));

            await endpoint.SendAsync("write");
            Assert.Equal(DeliveryReadKind.Message, (await subscription.ReadAsync(timeout.Token)).Kind,
                "the message before the resident stopped");

            await endpoint.SendAsync("exit");
            var after = await subscription.ReadAsync(timeout.Token);

            // An ending, not a failure: the Surface says "未连接" and tries again, which it could not
            // say if a resident going away were reported as a broken transport.
            Assert.Equal(DeliveryReadKind.Ended, after.Kind, "the ending after the resident stopped");
        });

        run.Add(OccupiedName, async () =>
        {
            await using var endpoint = await LiveDeliveryEndpoint.StartAsync(root, ["only the first hears this"]);
            var connector = new PipeDeliveryConnector();

            var first = await connector.ConnectAsync(endpoint.EndpointPath, CancellationToken.None);
            Assert.Equal(DeliveryConnectKind.Connected, first.Kind,
                $"the first connect outcome ({first.Detail ?? "no detail"})");
            using var firstSubscription = first.Subscription!;

            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));

            // The transport admits one subscriber and destroys a second rather than swapping it in. The
            // Surface's obligation is to survive that without taking the incumbent down with it.
            var second = await connector.ConnectAsync(endpoint.EndpointPath, CancellationToken.None);
            if (second.Kind == DeliveryConnectKind.Connected)
            {
                using var secondSubscription = second.Subscription!;
                var refused = await secondSubscription.ReadAsync(timeout.Token);
                Assert.NotEqual(DeliveryReadKind.Message, refused.Kind,
                    "a second subscriber receiving a message it was not entitled to");
            }

            await endpoint.SendAsync("write");
            var heard = await firstSubscription.ReadAsync(timeout.Token);

            Assert.Equal(DeliveryReadKind.Message, heard.Kind, "the first subscriber's read");
            Assert.SequenceEqual(new[] { "only the first hears this" }, heard.Lines!,
                "the first subscriber's message");
        });

        run.Add(AbsentName, async () =>
        {
            // A directory nothing has ever served, so the name is derived exactly as the Surface would
            // derive it and there is simply nobody there.
            var directory = Path.Combine(Path.GetTempPath(), $"hikari-surface-absent-{Guid.NewGuid():N}");
            var connector = new PipeDeliveryConnector(TimeSpan.FromSeconds(1));

            var result = await connector.ConnectAsync(DeliveryEndpointPath.For(directory), CancellationToken.None);

            Assert.Equal(DeliveryConnectKind.Absent, result.Kind,
                $"the outcome for a resident that is not running ({result.Detail ?? "no detail"})");
            Assert.Null(result.Detail, "the detail for an ordinary absence");
        });

        return Task.CompletedTask;
    }
}
