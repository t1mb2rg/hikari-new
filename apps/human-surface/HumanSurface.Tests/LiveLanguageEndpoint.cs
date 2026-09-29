using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using HumanSurface.Core;

namespace HumanSurface.Tests;

/// <summary>
/// The repository's real language endpoint, running in its own process, driven from the test.
/// </summary>
/// <remarks>
/// The server is the shipping one; the answer is the test's. That is the most a machine without a model
/// can honestly show, and it is a lot: the request the Surface writes is framed and decoded by the real
/// code, the reply the Surface reads is encoded by the real code, and the connection's ending is the
/// real one. What it cannot show is that a model was reached, and no case below claims otherwise.
/// </remarks>
internal sealed class LiveLanguageEndpoint : IAsyncDisposable
{
    private readonly Process _process;
    private readonly StringBuilder _log = new();
    private readonly Channel<string> _lines = Channel.CreateUnbounded<string>();
    private readonly List<Task> _drains = [];

    private LiveLanguageEndpoint(Process process, string endpointPath)
    {
        _process = process;
        EndpointPath = endpointPath;
        _drains.Add(DrainAsync(process.StandardOutput, _lines.Writer));
        _drains.Add(DrainAsync(process.StandardError, null));
    }

    /// <summary>The pipe path the endpoint is listening on, as it reported it.</summary>
    public string EndpointPath { get; }

    // Lower case because that is what the protocol's keys are; the real encoder spreads this object
    // straight into the envelope, so a PascalCase property here would produce a reply the real decoder
    // would refuse — and the C# client would then be tested against a rejection rather than an answer.
    private static readonly JsonSerializerOptions WireOptions =
        new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    /// <param name="reply">
    /// The answer every question gets, or <c>null</c> for a connection that is taken and never answered.
    /// </param>
    public static async Task<LiveLanguageEndpoint> StartAsync(string rootDir, LanguageReply? reply)
    {
        if (NodeBridge.LanguageModule is null) throw new InvalidOperationException("the language module is not built");

        var process = NodeBridge.Start(
            "live-language-endpoint.mjs",
            rootDir,
            reply is null
                ? "hold"
                : JsonSerializer.Serialize(
                    new WireReply(reply.Outcome.ToString().ToLowerInvariant(), reply.Lines), WireOptions));

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

        return new LiveLanguageEndpoint(process, ready["READY ".Length..]);
    }

    /// <summary>Tells the endpoint to close, or to stop.</summary>
    public async Task SendAsync(string command)
    {
        await _process.StandardInput.WriteLineAsync(command).ConfigureAwait(false);
        await _process.StandardInput.FlushAsync().ConfigureAwait(false);
    }

    /// <summary>
    /// Waits for a line the endpoint has printed.
    /// </summary>
    /// <remarks>
    /// This is how a test states an ordering instead of racing one: `ASKED` means the request framed and
    /// reached the host, so a case about what happens next is about the next thing rather than about how
    /// long a sleep was.
    /// </remarks>
    public async Task<string> WaitForAsync(Func<string, bool> matches)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));

        try
        {
            await foreach (var line in _lines.Reader.ReadAllAsync(timeout.Token))
            {
                if (matches(line)) return line;
            }
        }
        catch (OperationCanceledException)
        {
            throw new AssertionException($"the endpoint never said what was waited for\n{Log}");
        }

        throw new AssertionException($"the endpoint stopped before saying what was waited for\n{Log}");
    }

    /// <summary>Everything the process has printed, for a failure message.</summary>
    public string Log
    {
        get
        {
            lock (_log) return _log.ToString();
        }
    }

    private async Task DrainAsync(StreamReader reader, ChannelWriter<string>? lines)
    {
        try
        {
            while (true)
            {
                var line = await reader.ReadLineAsync().ConfigureAwait(false);
                if (line is null) return;

                lock (_log) _log.AppendLine(line);
                lines?.TryWrite(line);
            }
        }
        catch (Exception)
        {
            // The process exiting closes the stream mid-read, which is the ordinary end of a drain.
        }
        finally
        {
            lines?.TryComplete();
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

    // The reply as the protocol spells it: the outcome word is lower case on the wire, and the enum's
    // own name is not. This is the test fixture writing a reply, not the client reading one, so the
    // translation belongs here rather than anywhere in the product.
    private sealed record WireReply(string Outcome, IReadOnlyList<string> Lines);
}
