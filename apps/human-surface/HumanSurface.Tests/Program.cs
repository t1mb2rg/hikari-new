namespace HumanSurface.Tests;

/// <summary>
/// The whole runner: build the list, run it, exit on the count.
/// </summary>
/// <remarks>
/// No discovery, no attributes, no framework. The list is explicit so that what this suite covers can
/// be read in one screen, and so that a case which cannot run here is something a person registered
/// deliberately rather than something a framework quietly filtered out.
/// </remarks>
internal static class Program
{
    private static async Task<int> Main()
    {
        Console.WriteLine("HumanSurface tests");
        Console.WriteLine();

        var run = new TestRun();

        DeliveryFramingTests.Register(run);
        ReconnectScheduleTests.Register(run);
        SurfaceSessionTests.Register(run);
        await DeliveryEndpointPathTests.RegisterAsync(run);
        await LivePipeTests.RegisterAsync(run);

        return await run.ExecuteAsync();
    }
}
