namespace HumanSurface.Core;

/// <summary>
/// The local endpoint a data directory's delivery transport owns.
/// </summary>
/// <remarks>
/// The derivation itself — canonicalise, hash, truncate, prefix — lives in <see cref="PipeEndpointPath"/>,
/// because <see cref="LanguageEndpointPath"/> is the same derivation with a different prefix. This type
/// is the name the rest of the app uses, and it stays a name rather than becoming a parameter so that
/// no caller can pass the wrong prefix by accident.
/// </remarks>
public static class DeliveryEndpointPath
{
    /// <summary>The prefix <c>src/human-delivery/endpoint-path.ts</c> uses.</summary>
    public const string PipePrefix = "hikari-human-delivery-";

    /// <summary>The full <c>\\.\pipe\…</c> path for a data directory.</summary>
    public static string For(string rootDir) => PipeEndpointPath.Derive(PipePrefix, rootDir);

    /// <summary>The name to hand a pipe client, which takes a bare name rather than a device path.</summary>
    public static string ServerNameOf(string endpointPath) => PipeEndpointPath.ServerNameOf(endpointPath);
}
