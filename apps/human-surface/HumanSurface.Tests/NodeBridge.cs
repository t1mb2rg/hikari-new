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
    // Every module the suite reaches into. The probe checks all of them rather than the first, so that
    // a partially built `dist/` reports which part is missing instead of sending someone to rebuild
    // something that is already there.
    private const string DeliveryModulePath = "human-delivery/index.js";
    private const string LanguageModulePath = "language/index.js";
    private const string AskModulePath = "cli/ask.js";

    private static readonly Lazy<Environment> Probed = new(Probe);

    public static bool Available => Probed.Value.Missing.Count == 0 && Probed.Value.NodeWorks;

    public static string UnavailableReason => !Probed.Value.NodeWorks
        ? "no node on PATH"
        : $"the built dist/{string.Join(" and dist/", Probed.Value.Missing)} is missing — run npm run build";

    public static string? DeliveryModule => Module(DeliveryModulePath);

    public static string? LanguageModule => Module(LanguageModulePath);

    /// <summary>
    /// The module that owns the client's wait bound, which is not the language plugin.
    /// </summary>
    /// <remarks>
    /// `REPLY_TIMEOUT_MS` lives in `src/cli/ask.ts` beside the client it sizes, so reading the real one
    /// means reading a module the Surface does not otherwise care about. That is the point: the number
    /// being pinned is the *client's*, and asking the server's module for it would be asking the wrong
    /// file to agree with itself.
    /// </remarks>
    public static string? AskModule => Module(AskModulePath);

    public static string? RepositoryRoot => Probed.Value.Root;

    public static string HelperPath(string name) =>
        Path.Combine(AppContext.BaseDirectory, "node-helpers", name);

    /// <summary>Runs a helper to completion with nothing on its standard input.</summary>
    public static Task<NodeResult> RunToCompletionAsync(string helperName, params string[] args) =>
        RunToCompletionWithInputAsync(helperName, null, args);

    /// <summary>
    /// Runs a helper to completion, handing it this text and then closing its standard input.
    /// </summary>
    /// <remarks>
    /// A separate name rather than an overload taking the input where the arguments go, because the two
    /// calls differ by one argument and overload resolution between them is the kind of thing a reader
    /// should not have to work out. Standard input is closed either way, including when there is nothing
    /// to send: a helper that read until end-of-stream would otherwise wait for a close that a caller
    /// who never wrote anything has no reason to think it owes.
    /// </remarks>
    public static async Task<NodeResult> RunToCompletionWithInputAsync(string helperName, string? input,
        params string[] args)
    {
        using var process = Start(helperName, args);

        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();

        if (input is not null) await process.StandardInput.WriteAsync(input);
        process.StandardInput.Close();

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

    private static string? Module(string relative)
    {
        var root = Probed.Value.Root;
        if (root is null || !Probed.Value.NodeWorks) return null;

        var path = Path.Combine(root, "dist", relative.Replace('/', Path.DirectorySeparatorChar));
        return File.Exists(path) ? path : null;
    }

    private static Environment Probe()
    {
        var root = FindRepositoryRoot();
        var missing = new List<string>();

        if (root is null)
        {
            missing.AddRange([DeliveryModulePath, LanguageModulePath, AskModulePath]);
            return new Environment(null, missing, false);
        }

        foreach (var relative in new[] { DeliveryModulePath, LanguageModulePath, AskModulePath })
        {
            var path = Path.Combine(root, "dist", relative.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(path)) missing.Add(relative);
        }

        return new Environment(root, missing, NodeRuns());
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

    private sealed record Environment(string? Root, IReadOnlyList<string> Missing, bool NodeWorks);
}

internal readonly record struct NodeResult(int ExitCode, string StandardOutput, string StandardError);
