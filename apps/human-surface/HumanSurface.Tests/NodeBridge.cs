using System.Diagnostics;
using System.Text;

namespace HumanSurface.Tests;

/// <summary>
/// Where the repository's built TypeScript lives, and how to run a helper against it.
/// </summary>
/// <remarks>
/// The conformance cases are the reason this exists: they compare the C# implementation against the
/// real JavaScript one, which means the suite has to find `dist/` and a node binary. When either is
/// missing the cases skip with that as the stated reason, rather than passing on an assumption that
/// the two agree.
/// </remarks>
internal static class NodeBridge
{
    private static readonly Lazy<Environment> Probed = new(Probe);

    public static bool Available => Probed.Value.Module is not null && Probed.Value.NodeWorks;

    public static string UnavailableReason =>
        Probed.Value.NodeWorks ? "the built dist/human-delivery is missing — run npm run build" : "no node on PATH";

    public static string? DeliveryModule => Probed.Value.Module;

    public static string? RepositoryRoot => Probed.Value.Root;

    public static string HelperPath(string name) =>
        Path.Combine(AppContext.BaseDirectory, "node-helpers", name);

    /// <summary>Runs a helper to completion and returns everything it wrote.</summary>
    public static async Task<NodeResult> RunToCompletionAsync(string helperName, params string[] args)
    {
        using var process = Start(helperName, args);

        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();

        await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(60));

        return new NodeResult(process.ExitCode, await stdout, await stderr);
    }

    public static Process Start(string helperName, params string[] args)
    {
        var start = new ProcessStartInfo("node")
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            // Without this the CJK in a payload comes back as mojibake, and a test comparing message
            // text would be comparing the console's encoding rather than the transport's.
            StandardOutputEncoding = new UTF8Encoding(false),
            StandardErrorEncoding = new UTF8Encoding(false),
        };

        start.ArgumentList.Add(HelperPath(helperName));
        foreach (var arg in args) start.ArgumentList.Add(arg);

        return Process.Start(start) ?? throw new InvalidOperationException($"could not start node for {helperName}");
    }

    private static Environment Probe()
    {
        var root = FindRepositoryRoot();
        var module = root is null ? null : Path.Combine(root, "dist", "human-delivery", "index.js");

        return new Environment(
            root,
            module is not null && File.Exists(module) ? module : null,
            NodeRuns());
    }

    // Walks up from the test assembly's own directory. A depth count would be a second statement of
    // where the build output lives, and would break the first time the target framework is renamed.
    private static string? FindRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "package.json")) &&
                Directory.Exists(Path.Combine(directory.FullName, "src", "human-delivery")))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        return null;
    }

    private static bool NodeRuns()
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo("node")
            {
                ArgumentList = { "--version" },
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            });

            if (process is null) return false;

            process.StandardOutput.ReadToEnd();
            process.StandardError.ReadToEnd();
            process.WaitForExit(15_000);
            return process.ExitCode == 0;
        }
        catch (Exception)
        {
            return false;
        }
    }

    private sealed record Environment(string? Root, string? Module, bool NodeWorks);
}

internal readonly record struct NodeResult(int ExitCode, string StandardOutput, string StandardError);
