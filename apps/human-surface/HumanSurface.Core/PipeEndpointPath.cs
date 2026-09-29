using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace HumanSurface.Core;

/// <summary>
/// The one derivation both of this app's endpoints share, parameterised by the name prefix.
/// </summary>
/// <remarks>
/// <para>
/// This is <b>a second implementation of a derivation that already exists</b>, and that is a real cost
/// rather than a design. <c>src/human-delivery/protocol.ts</c> warns about exactly this shape: "a
/// client that wrote its own decoder would be a second statement of what this pipe means, and the
/// second one is the copy nobody re-reads when the first changes." A .NET process cannot import that
/// file, so the copy is unavoidable; what is avoidable is the copy going unchecked. The mitigation
/// lives in <c>HumanSurface.Tests</c>, which runs the real TypeScript function and asserts this one
/// agrees with it byte for byte — on the six spellings in the parity probe, including the ones that
/// differ only in case, a trailing separator, or a <c>..</c> segment.
/// </para>
/// <para>
/// The derivation is reproduced from <c>src/human-delivery/endpoint-path.ts</c> and
/// <c>src/language/endpoint-path.ts</c>: hash the canonical directory lowercased, take the first 16 hex
/// characters, prefix the pipe name. Both ends call their own copy of the same rule, so they agree by
/// construction; the canonicalisation is where they could silently disagree, which is why it is
/// reproduced rather than approximated.
/// </para>
/// <para>
/// The body lives here rather than in each endpoint type because the two derivations differ in one
/// string and nothing else. Writing the sixty lines below twice would be a copy with no owner to keep
/// the halves honest, and the first thing to drift would be the canonicalisation — the part whose
/// whole purpose is that the two sides cannot disagree about it.
/// </para>
/// </remarks>
public static class PipeEndpointPath
{
    /// <summary>The prefix every named pipe on Windows lives under.</summary>
    public const string DevicePrefix = @"\\.\pipe\";

    /// <summary>How much of the digest becomes the name.</summary>
    public const int HashLength = 16;

    /// <summary>The full <c>\\.\pipe\…</c> path for a data directory and a prefix.</summary>
    public static string Derive(string pipePrefix, string rootDir)
    {
        var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(CanonicalRootDir(rootDir))))
            .ToLowerInvariant();
        return DevicePrefix + pipePrefix + digest[..HashLength];
    }

    /// <summary>
    /// The name to hand <see cref="System.IO.Pipes.NamedPipeClientStream"/>, which takes a bare name
    /// rather than the device path it lives under.
    /// </summary>
    public static string ServerNameOf(string endpointPath)
    {
        if (!endpointPath.StartsWith(DevicePrefix, StringComparison.Ordinal))
        {
            throw new ArgumentException($"{endpointPath} is not a pipe path.", nameof(endpointPath));
        }

        return endpointPath[DevicePrefix.Length..];
    }

    // The lowercasing is the whole reason the lexical fallback is safe to reach for: the filesystem
    // answer and the lexical answer differ in ways that do not matter here, and case is taken out of
    // the comparison so that the two spellings a human might type for the same directory meet.
    private static string CanonicalRootDir(string rootDir)
    {
        var canonical = ReadCanonicalPath(rootDir) ?? Path.GetFullPath(rootDir);
        return canonical.ToLowerInvariant();
    }

    // The filesystem's own answer, and it fails when the directory does not exist — an ordinary case
    // rather than an error, since a client may connect before anything has created the data
    // directory. `GetFinalPathNameByHandleW` is what `realpathSync.native` calls underneath, which is
    // why the two agree; a purely lexical normalisation would not, because it would leave a `..`
    // segment unresolved through a junction.
    private static string? ReadCanonicalPath(string rootDir)
    {
        // This assembly targets a neutral framework so that its logic can be tested on any runner, but
        // the call below is kernel32. The guard makes the fallback the whole answer elsewhere rather
        // than a DllNotFoundException climbing out of a path helper.
        if (!OperatingSystem.IsWindows()) return null;

        const uint FileFlagBackupSemantics = 0x0200_0000;
        const uint FileShareAll = 0x1 | 0x2 | 0x4;
        const uint OpenExisting = 3;
        const uint VolumeNameDos = 0x0;

        var handle = CreateFileW(rootDir, 0, FileShareAll, IntPtr.Zero, OpenExisting,
            FileFlagBackupSemantics, IntPtr.Zero);
        if (handle == new IntPtr(-1)) return null;

        try
        {
            var buffer = new StringBuilder(4096);
            var length = GetFinalPathNameByHandleW(handle, buffer, buffer.Capacity, VolumeNameDos);
            if (length == 0 || length >= buffer.Capacity) return null;

            // The device form is an implementation detail of the call; the DOS form is what the rest
            // of the derivation hashes. Node's binding strips this too, which is why the byte
            // comparison in the tests can be exact.
            var path = buffer.ToString();
            const string deviceQueryPrefix = @"\\?\";
            return path.StartsWith(deviceQueryPrefix, StringComparison.Ordinal)
                ? path[deviceQueryPrefix.Length..]
                : path;
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFileW(string lpFileName, uint dwDesiredAccess, uint dwShareMode,
        IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes,
        IntPtr hTemplateFile);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(IntPtr hFile, StringBuilder lpszFilePath,
        int cchFilePath, uint dwFlags);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);
}
