using HumanSurface.Core;

namespace HumanSurface.Tests;

/// <summary>
/// Waits for a session to reach a state, driven by its own event rather than by polling.
/// </summary>
/// <remarks>
/// Driven by <see cref="SurfaceSession.Changed"/> so that a test waiting for a state change is not also
/// asserting a speed: the session raises the event on whichever thread caused the change, and the check
/// runs once immediately in case the state was already reached before the subscription. The timeout is
/// a failure backstop, not a schedule.
/// </remarks>
internal static class SessionAwait
{
    public static Task Connection(SurfaceSession session, SurfaceConnection wanted) =>
        Until(session, () => session.Snapshot().Connection == wanted);

    public static async Task Until(SurfaceSession session, Func<bool> condition)
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
            await reached.Task.WaitAsync(TimeSpan.FromSeconds(10)).ConfigureAwait(false);
        }
        finally
        {
            session.Changed -= Handler;
        }
    }
}
