using System.Text.Json;
using HumanSurface.Core;

namespace HumanSurface.Tests;

internal static class DeliveryEndpointPathTests
{
    private const string Prefix = @"\\.\pipe\hikari-human-delivery-";

    public static async Task RegisterAsync(TestRun run)
    {
        Also(run, "endpoint: the same directory always gives the same name", () =>
        {
            var directory = NodeBridge.RepositoryRoot ?? Directory.GetCurrentDirectory();
            Assert.Equal(DeliveryEndpointPath.For(directory), DeliveryEndpointPath.For(directory),
                "the derived path");
        });

        Also(run, "endpoint: different directories give different names", () =>
        {
            var directory = NodeBridge.RepositoryRoot ?? Directory.GetCurrentDirectory();
            Assert.False(
                DeliveryEndpointPath.For(directory) == DeliveryEndpointPath.For(directory + "-other"),
                "two directories sharing a pipe name");
        });

        Also(run, "endpoint: the name is the documented shape", () =>
        {
            var directory = NodeBridge.RepositoryRoot ?? Directory.GetCurrentDirectory();
            var path = DeliveryEndpointPath.For(directory);

            Assert.True(path.StartsWith(Prefix, StringComparison.Ordinal), $"a path under {Prefix}");
            Assert.Equal(Prefix.Length + 16, path.Length, "the path length");
        });

        Also(run, "endpoint: the client name is the path without its device prefix", () =>
        {
            Assert.Equal("hikari-human-delivery-abc", DeliveryEndpointPath.ServerNameOf(Prefix + "abc"),
                "the client-side name");
        });

        Also(run, "endpoint: a path that is not a pipe path is refused", () =>
        {
            try
            {
                DeliveryEndpointPath.ServerNameOf(@"C:\not-a-pipe");
                throw new AssertionException("a non-pipe path was accepted");
            }
            catch (ArgumentException)
            {
                // The expected outcome: this is a programming error, not a runtime condition.
            }
        });

        await RegisterConformanceAsync(run);
    }

    private static void Also(TestRun run, string name, Action body)
    {
        // Wrapped so a case whose only Windows-specific step is the kernel32 call reports the same
        // fact as the others rather than failing on a runner it was never meant for.
        if (OperatingSystem.IsWindows()) run.Add(name, body);
        else run.Skip(name, "the endpoint path is derived from a Windows filesystem and a Windows pipe namespace");
    }

    private static async Task RegisterConformanceAsync(TestRun run)
    {
        const string PathName = "conformance: the endpoint path agrees with the TypeScript derivation";
        const string EncodeName = "conformance: the decoder accepts what the TypeScript encoder produced";
        const string DecodeName = "conformance: the decoder accepts and rejects exactly what the TypeScript one does";

        if (!NodeBridge.Available)
        {
            run.Skip(PathName, NodeBridge.UnavailableReason);
            run.Skip(EncodeName, NodeBridge.UnavailableReason);
            run.Skip(DecodeName, NodeBridge.UnavailableReason);
            return;
        }

        var result = await NodeBridge.RunToCompletionAsync("conformance.mjs", NodeBridge.RepositoryRoot!);
        if (result.ExitCode != 0)
        {
            throw new AssertionException(
                $"the conformance helper failed with exit code {result.ExitCode}\n{result.StandardError}");
        }

        var conformance = JsonSerializer.Deserialize<Conformance>(result.StandardOutput,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new AssertionException($"the conformance helper printed nothing readable: {result.StandardOutput}");

        if (!OperatingSystem.IsWindows())
        {
            // The TypeScript side answers `undefined` off Windows, so there is nothing to compare the
            // C# derivation against there; the framing cases below still run.
            run.Skip(PathName, "the endpoint derivation is Windows-only on both sides");
        }
        else
        {
            run.Add(PathName, () =>
            {
                foreach (var pathCase in conformance.Paths)
                {
                    Assert.Equal(pathCase.Node, DeliveryEndpointPath.For(pathCase.Input),
                        $"the derived path for {pathCase.Input}");
                }
            });
        }

        run.Add(EncodeName, () =>
        {
            foreach (var encodeCase in conformance.Encodes)
            {
                var decoded = DeliveryFraming.Decode(encodeCase.Wire);
                Assert.NotNull(decoded, $"decoding the wire form of {Show(encodeCase.Lines)}");
                Assert.SequenceEqual(encodeCase.Lines, decoded!,
                    $"the lines of {Show(encodeCase.Lines)}");

                // The trailing newline is the frame and not part of the content, on both sides.
                Assert.True(encodeCase.Wire.EndsWith('\n'), "the wire form ends with the frame");
            }
        });

        run.Add(DecodeName, () =>
        {
            foreach (var decodeCase in conformance.Decodes)
            {
                var ours = DeliveryFraming.Decode(decodeCase.Wire);

                if (decodeCase.Node is null)
                {
                    Assert.Null(ours, $"decoding {Show(decodeCase.Wire)}, which TypeScript rejects");
                }
                else
                {
                    Assert.NotNull(ours, $"decoding {Show(decodeCase.Wire)}, which TypeScript accepts");
                    Assert.SequenceEqual(decodeCase.Node, ours!, $"the lines of {Show(decodeCase.Wire)}");
                }
            }
        });
    }

    private static string Show<T>(T value) => JsonSerializer.Serialize(value);

    private sealed record Conformance(
        IReadOnlyList<PathCase> Paths,
        IReadOnlyList<EncodeCase> Encodes,
        IReadOnlyList<DecodeCase> Decodes);

    private sealed record PathCase(string Input, string? Node);

    private sealed record EncodeCase(IReadOnlyList<string> Lines, string Wire);

    private sealed record DecodeCase(string Wire, IReadOnlyList<string>? Node);
}
