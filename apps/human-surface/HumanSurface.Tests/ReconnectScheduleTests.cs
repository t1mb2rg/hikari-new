using HumanSurface.Core;

namespace HumanSurface.Tests;

internal static class ReconnectScheduleTests
{
    public static void Register(TestRun run)
    {
        run.Add("schedule: doubles to a ceiling and then stays there", () =>
        {
            var schedule = new ReconnectSchedule();

            TimeSpan[] expected =
            [
                TimeSpan.FromSeconds(1),
                TimeSpan.FromSeconds(2),
                TimeSpan.FromSeconds(4),
                TimeSpan.FromSeconds(8),
                TimeSpan.FromSeconds(10),
                TimeSpan.FromSeconds(10),
                TimeSpan.FromSeconds(10),
            ];

            var actual = expected.Select(_ => schedule.Next()).ToArray();
            Assert.SequenceEqual(expected, actual, "the delay sequence");
        });

        run.Add("schedule: a successful connection returns it to the first delay", () =>
        {
            // Without the reset, a Surface that had been disconnected overnight would take ten seconds
            // to notice a resident that came back — the ceiling is for a resident that is gone, not
            // for one that just returned.
            var schedule = new ReconnectSchedule();
            Assert.Equal(TimeSpan.FromSeconds(1), schedule.Next(), "first");
            Assert.Equal(TimeSpan.FromSeconds(2), schedule.Next(), "second");

            schedule.Reset();

            Assert.Equal(TimeSpan.FromSeconds(1), schedule.Next(), "after reset");
        });
    }
}
