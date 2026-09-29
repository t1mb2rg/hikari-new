namespace HumanSurface.Core;

/// <summary>The pace of reconnection attempts while the Surface is disconnected.</summary>
/// <remarks>
/// <para>
/// Doubling from one second to a ten-second ceiling, and back to one second the moment a connection
/// succeeds. The ceiling is what makes this not a spin: a resident that is off for the evening costs
/// the Surface one failed attempt every dozen seconds, and a resident that comes back is picked up
/// within one attempt of its return.
/// </para>
/// <para>
/// Its own type because it is the one part of the state machine with a schedule a person can be
/// wrong about, and because a test can then state the whole sequence as a fact rather than
/// reconstruct it from observed timings.
/// </para>
/// </remarks>
public sealed class ReconnectSchedule
{
    public static readonly TimeSpan First = TimeSpan.FromSeconds(1);
    public static readonly TimeSpan Ceiling = TimeSpan.FromSeconds(10);

    private TimeSpan _next = First;

    /// <summary>The delay to wait before the next attempt, and the advance past it.</summary>
    public TimeSpan Next()
    {
        var delay = _next;
        var doubled = _next * 2;
        _next = doubled > Ceiling ? Ceiling : doubled;
        return delay;
    }

    /// <summary>Back to the first delay. Called when a connection succeeds.</summary>
    public void Reset() => _next = First;
}
