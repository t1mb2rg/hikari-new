using System.IO.Pipes;
using System.Text;

namespace HumanSurface.Core;

/// <summary>
/// Attaches to the resident's human-delivery pipe and reads framed messages off it.
/// </summary>
/// <remarks>
/// <para>
/// The reading half of what <c>src/cli/subscribe.ts</c> does on the Node side, with the same three
/// outcomes: a live stream, nothing listening (<c>Absent</c>), or something that answered without
/// speaking this protocol (<c>Unavailable</c>). No queue, no history, no retry — a message written
/// while nobody is attached is not delivered, and the Surface's reconnect is about the transport
/// being there, not about messages being owed.
/// </para>
/// <para>
/// <see cref="ConnectTimeout"/> is how long one attempt waits for the name to appear, and waiting is
/// the point rather than a delay to be minimised: a resident that starts two seconds after the
/// Surface does is connected on the first attempt instead of the second. A name nobody is serving
/// costs that full wait and then reports <c>Absent</c>; the session spaces attempts out from there.
/// </para>
/// </remarks>
public sealed class PipeDeliveryConnector : IDeliveryConnector
{
    public static readonly TimeSpan DefaultConnectTimeout = TimeSpan.FromSeconds(2);

    private const int ByteBufferSize = 8192;

    // A byte buffer can carry a partial UTF-8 sequence at its end, which the decoder holds over to
    // the next call. Those carried bytes are at most three and emit at most one character, so one
    // extra unit would do; four is that with room to not have to think about it again. Sizing this
    // buffer exactly would be a decoder failure that only shows up on a message whose text happens to
    // straddle a 8192-byte boundary — which, with CJK prose, is a matter of when.
    private const int CharBufferSize = ByteBufferSize + 4;

    private readonly TimeSpan _connectTimeout;

    public PipeDeliveryConnector(TimeSpan? connectTimeout = null)
    {
        _connectTimeout = connectTimeout ?? DefaultConnectTimeout;
    }

    public async Task<DeliveryConnectResult> ConnectAsync(string endpointPath, CancellationToken cancellationToken)
    {
        var pipe = new NamedPipeClientStream(".", DeliveryEndpointPath.ServerNameOf(endpointPath),
            PipeDirection.In, PipeOptions.Asynchronous);

        using var attempt = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        attempt.CancelAfter(_connectTimeout);

        try
        {
            await pipe.ConnectAsync(attempt.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // The Surface is shutting down. Not a connection outcome, so it is not reported as one.
            pipe.Dispose();
            throw;
        }
        catch (OperationCanceledException)
        {
            // The wait expired with nobody serving the name. Taking the time out of the token rather
            // than out of an argument is what makes this not a blocking call: `Connect(ms)` would hold
            // the caller's thread for the whole wait.
            pipe.Dispose();
            return DeliveryConnectResult.Absent();
        }
        catch (Exception exception)
        {
            pipe.Dispose();
            return DeliveryConnectResult.Unavailable(ExceptionDetail.Of(exception));
        }

        return DeliveryConnectResult.Connected(new PipeSubscription(pipe));
    }

    private sealed class PipeSubscription(NamedPipeClientStream pipe) : IDeliverySubscription
    {
        private readonly DeliveryLineReader _lines = new();
        private readonly Decoder _decoder = new UTF8Encoding(false).GetDecoder();
        private readonly byte[] _bytes = new byte[ByteBufferSize];
        private readonly char[] _chars = new char[CharBufferSize];

        public async Task<DeliveryRead> ReadAsync(CancellationToken cancellationToken)
        {
            while (true)
            {
                // A previous push can leave a whole line behind it, so the buffer is drained before
                // the pipe is touched again. Reading first would stall on a message that already
                // arrived, which is how a burst of deliveries turns into one rendered message.
                var buffered = _lines.Push(string.Empty);
                if (buffered.Kind == DeliveryLineReadKind.Line) return Decode(buffered.Line!);
                if (buffered.Kind == DeliveryLineReadKind.Overflow) return Overflow();

                int read;
                try
                {
                    read = await pipe.ReadAsync(_bytes.AsMemory(), cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return DeliveryRead.Ended();
                }
                catch (Exception exception) when (exception is IOException or ObjectDisposedException)
                {
                    return DeliveryRead.Unavailable(ExceptionDetail.Of(exception));
                }

                // Zero bytes is the far end closing the pipe. A resident that stopped is a resident
                // that stopped — an ending, not a failure.
                if (read == 0) return DeliveryRead.Ended();

                // Decoding through a stateful decoder rather than Encoding.UTF8.GetString, which would
                // silently replace any multi-byte character split across two reads with U+FFFD. The
                // message text this carries is natural language, so a chunk boundary landing mid
                // character is ordinary rather than exotic.
                var decoded = _decoder.GetChars(_bytes, 0, read, _chars, 0);
                var pushed = _lines.Push(new string(_chars, 0, decoded));
                if (pushed.Kind == DeliveryLineReadKind.Line) return Decode(pushed.Line!);
                if (pushed.Kind == DeliveryLineReadKind.Overflow) return Overflow();
            }
        }

        private static DeliveryRead Decode(string line)
        {
            var lines = DeliveryFraming.Decode(line);

            // A line that is not a framed message is not an empty message. Rendering nothing for it
            // would report that Hikari said nothing, when what happened is that something on the pipe
            // spoke this protocol wrong — so it ends the connection with the reason attached.
            return lines is null
                ? DeliveryRead.Unavailable("收到一行不是投递帧的数据")
                : DeliveryRead.Message(lines);
        }

        private static DeliveryRead Overflow() =>
            DeliveryRead.Unavailable($"一行超过了 {DeliveryFraming.MaxDeliveryMessageLine} 字节的上限");

        public void Dispose() => pipe.Dispose();
    }
}
