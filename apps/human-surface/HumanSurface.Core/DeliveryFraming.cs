using System.Text.Json;

namespace HumanSurface.Core;

/// <summary>
/// One message, on one line, and the rule that says so.
/// </summary>
/// <remarks>
/// <para>
/// The wire format is defined by <c>src/human-delivery/protocol.ts</c>. This is the second
/// implementation of it, and the paragraph at the top of that file is about this class: a client that
/// wrote its own decoder is a second statement of what the pipe means. A .NET process cannot import
/// the first one, so the class exists; it is kept line-for-line equivalent so that a reviewer can read
/// the two side by side, and <c>HumanSurface.Tests</c> drives it with bytes the real TypeScript
/// encoder produced.
/// </para>
/// <para>
/// Only the reading half is here. The Surface never writes to the pipe — a decoder is the whole of
/// what it needs, and an encoder that nothing calls would be dead code in the product wearing the
/// costume of symmetry.
/// </para>
/// </remarks>
public static class DeliveryFraming
{
    /// <summary>The cap on one framed message, from <c>src/human-delivery/types.ts</c>.</summary>
    public const int MaxDeliveryMessageLine = 64 * 1024;

    /// <summary>
    /// One framed message, decoded, or <c>null</c> if the line was not one.
    /// </summary>
    /// <remarks>
    /// <c>null</c> rather than an exception, and rather than an empty array. A line this build cannot
    /// read is not an empty message and must not be rendered as one — a window that printed nothing
    /// for it would be reporting that Hikari said nothing, when what happened is that something spoke
    /// this protocol wrong. Which of those the Surface reports is its own wording; that it can tell
    /// them apart is this method's job.
    /// </remarks>
    public static IReadOnlyList<string>? Decode(string line)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(line);
        }
        catch (JsonException)
        {
            return null;
        }

        using (document)
        {
            if (document.RootElement.ValueKind != JsonValueKind.Array) return null;

            var lines = new List<string>();
            foreach (var entry in document.RootElement.EnumerateArray())
            {
                if (entry.ValueKind != JsonValueKind.String) return null;
                lines.Add(entry.GetString()!);
            }

            return lines;
        }
    }
}

/// <summary>
/// Reads a character stream into framed lines, and refuses to buffer without bound.
/// </summary>
/// <remarks>
/// The bound is the reason this is a class rather than a split. A pipe hands over whatever happened to
/// arrive, so "one line" is not a property of a chunk and the accumulated partial line is memory the
/// far end chooses the size of. Past <see cref="DeliveryFraming.MaxDeliveryMessageLine"/> the read is
/// <see cref="DeliveryLineReadKind.Overflow"/> and the caller is expected to end the connection:
/// whoever is on the other end is not speaking this protocol, and answering an unbounded stream with
/// more buffering is answering a conversation that is not happening.
/// </remarks>
public sealed class DeliveryLineReader
{
    private readonly int _limit;
    private string _buffer = string.Empty;

    public DeliveryLineReader(int limit = DeliveryFraming.MaxDeliveryMessageLine)
    {
        _limit = limit;
    }

    public DeliveryLineRead Push(string chunk)
    {
        _buffer += chunk;

        var newline = _buffer.IndexOf('\n');
        if (newline >= 0)
        {
            var line = _buffer[..newline];
            if (line.Length > _limit) return new DeliveryLineRead(DeliveryLineReadKind.Overflow, null);
            _buffer = _buffer[(newline + 1)..];
            return new DeliveryLineRead(DeliveryLineReadKind.Line, line);
        }

        if (_buffer.Length > _limit) return new DeliveryLineRead(DeliveryLineReadKind.Overflow, null);
        return new DeliveryLineRead(DeliveryLineReadKind.Pending, null);
    }
}

public enum DeliveryLineReadKind
{
    Pending,
    Line,
    Overflow,
}

public readonly record struct DeliveryLineRead(DeliveryLineReadKind Kind, string? Line);
