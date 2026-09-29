namespace HumanSurface.Core;

/// <summary>
/// The local endpoint a data directory's language plugin owns, and which the Surface now asks.
/// </summary>
/// <remarks>
/// <para>
/// Deliberately the same derivation as <see cref="DeliveryEndpointPath"/>, with the prefix
/// <c>src/language/endpoint-path.ts</c> uses. The two pipes are different pipes and are not
/// interchangeable; the fact that the same data directory produces both names is what lets one
/// process find them.
/// </para>
/// <para>
/// There is no parity test for this type's own name, and that is a decision rather than an omission.
/// The derivation is <see cref="PipeEndpointPath"/>'s, which the conformance suite already drives
/// against the real TypeScript functions; a second test asserting that a different constant reaches
/// the same function would be checking that C# can concatenate. What could drift here is the prefix,
/// and that is pinned where every other cross-language constant is pinned: the conformance helper
/// compares this type's output against <c>languageEndpointPath</c> out of <c>dist/</c>.
/// </para>
/// </remarks>
public static class LanguageEndpointPath
{
    /// <summary>The prefix <c>src/language/endpoint-path.ts</c> uses.</summary>
    public const string PipePrefix = "hikari-language-";

    /// <summary>The full <c>\\.\pipe\…</c> path for a data directory.</summary>
    public static string For(string rootDir) => PipeEndpointPath.Derive(PipePrefix, rootDir);

    /// <summary>The name to hand a pipe client, which takes a bare name rather than a device path.</summary>
    public static string ServerNameOf(string endpointPath) => PipeEndpointPath.ServerNameOf(endpointPath);
}
