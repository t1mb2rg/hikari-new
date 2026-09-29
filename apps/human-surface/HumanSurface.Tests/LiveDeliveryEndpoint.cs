using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace HumanSurface.Tests;

/// <summary>
/// The repository's real delivery endpoint, running in its own process, driven from the test.
/// </summary>
/// <remarks>
/// Not a stub of the server and not a reimplementation of it: this loads `dist/human-delivery` and
/// calls <c>listenDeliveryEndpoint</c>, so a live case that passes is a statement about the module the
/// resident actually loads. The process boundary is the point as well — a client that goes away is
/// what the Surface has to survive, and an in-process server could not demonstrate that.
/// </remarks>
internal sealed class LiveDeliveryEndpoint : IAsyncDisposable
{
    private readonly Process _process;
    private readonly StringBuilder _log = new();
    private readonly List<Task> _drains = [];

    private LiveDeliveryEndpoint(Process process, string endpointPath)
    {
        _process = process;
        EndpointPath = endpointPath;
        _drains.Add(DrainAsync(process.StandardOutput));
        _drains.Add(DrainAsync(process.StandardError));
    }

    /// <summary>The pipe path the endpoint is listening on, as it reported it.</summary>
    public string EndpointPath { get; }

    public static async Task<LiveDeliveryEndpoint> StartAsync(string rootDir, IReadOnlyList<string> payload)
    {
        var module = NodeBridge.DeliveryModule
            ?? throw new InvalidOperationException("the delivery module is not built");

        var process = NodeBridge.Start("live-endpoint.mjs", module, rootDir, JsonSerializer.Serialize(payload));

        string? ready;
        try
        {
            ready = await process.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(30));
        }
        catch (Exception)
        {
            process.Kill(entireProcessTree: true);
            throw;
        }

        if (ready is null || !ready.StartsWith("READY ", StringComparison.Ordinal))
        {
            process.Kill(entireProcessTree: true);
            throw new InvalidOperationException($"the endpoint did not start (first line: {ready ?? "<none>"})");
        }

        return new LiveDeliveryEndpoint(process, ready["READY ".Length..]);
    }

    /// <summary>Tells the endpoint to write the payload, or to stop.</summary>
    public async Task SendAsync(string command)
    {
        await _process.StandardInput.WriteLineAsync(command).ConfigureAwait(false);
        await _process.StandardInput.FlushAsync().ConfigureAwait(false);
    }

    /// <summary>Everything the process has printed, for a failure message.</summary>
    public string Log
    {
        get
        {
            lock (_log) return _log.ToString();
        }
    }

    private async Task DrainAsync(StreamReader reader)
    {
        try
        {
            while (true)
            {
                var line = await reader.ReadLineAsync().ConfigureAwait(false);
                if (line is null) return;
                lock (_log) _log.AppendLine(line);
            }
        }
        catch (Exception)
        {
            // The process exiting closes the stream mid-read, which is the ordinary end of a drain.
        }
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            _process.StandardInput.Close();
        }
        catch (Exception)
        {
            // Already gone.
        }

        try
        {
            await _process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10)).ConfigureAwait(false);
        }
        catch (Exception)
        {
            _process.Kill(entireProcessTree: true);
        }

        await Task.WhenAll(_drains).ConfigureAwait(false);
        _process.Dispose();
    }
}
