using System.IO.Pipes;
using System.Text;

namespace HumanSurface.Core;

/// <summary>
/// Asks the language endpoint, over the same kind of named pipe the Surface listens on.
/// </summary>
/// <remarks>
/// <para>
/// The client end of what <c>src/cli/ask.ts</c> does on the Node side, with the same three outcomes: a
/// reply, nothing listening (<c>Absent</c>), or something that answered without speaking this protocol
/// (<c>Unavailable</c>). No queue, no retry, no history — one question, one answer, and the connection
/// is destroyed either way.
/// </para>
/// <para>
/// This asks the <em>language plugin's own pipe</em> and never the Resident's control channel. That is
/// not an implementation detail to be revisited: <c>src/cli/ask.ts:29-31</c> states the rule — "a
/// surface that reached for the Resident's own vocabulary to explain a domain plugin's absence would
/// be the first step toward routing domain questions through it, and that channel's whole design is
/// two words about the process."
/// </para>
/// </remarks>
public sealed class PipeLanguageAsker : ILanguageAsker
{
    /// <summary>The transport's own bound for one model call, from <c>src/language/model.ts</c>.</summary>
    public const int ModelTimeoutMilliseconds = 15_000;

    /// <summary>The reads, the focus read and the framing, as one budget, from <c>src/cli/ask.ts:100</c>.</summary>
    public const int ReadAndFramingBudgetMilliseconds = 90_000;

    /// <summary>
    /// How many capabilities the longest exposure list this build can offer holds.
    /// </summary>
    /// <remarks>
    /// The one number here that has to be kept in step with the other side by hand, and it is written
    /// down rather than derived because a .NET process cannot ask TypeScript how long an array is.
    /// Verified against the built module: <c>LANGUAGE_EXPOSURES</c> holds two and
    /// <c>LANGUAGE_REPOSITORY_EXPOSURES</c> holds three, so the longest list this build can be talking
    /// to is the repository one. This is the same number <c>cli/ask.ts:91-94</c> takes a maximum over,
    /// and the conformance suite asserts that the derivation below equals the real
    /// <c>REPLY_TIMEOUT_MS</c> out of <c>dist/cli/ask.js</c> — so the day a capability is added, this
    /// goes red instead of quietly timing out a question that was about to be answered.
    /// </remarks>
    public const int LongestExposureCount = 3;

    /// <summary>
    /// The client's whole budget for the exchange, computed from what the exchange can cost.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The same derivation as <c>src/cli/ask.ts:102-103</c>, and it is copied rather than shortened on
    /// purpose. A Surface that picked its own smaller number would kill legitimate questions — the
    /// interaction may make one model call per capability plus one more — and would report an answer
    /// that was on its way as one that never came. The human would be told the entry point did not
    /// answer while the thing that answers it was still working.
    /// </para>
    /// <para>
    /// Why the ceiling is <c>count + 1</c>: the server's loop cannot continue without consuming an
    /// unread capability, so it makes at most one model call per capability, and the call that ends the
    /// interaction carries no reads.
    /// </para>
    /// </remarks>
    public const int ReplyTimeoutMilliseconds =
        (LongestExposureCount + 1) * ModelTimeoutMilliseconds + ReadAndFramingBudgetMilliseconds;

    /// <summary>How long one attempt waits for the name to appear, matching the delivery connector.</summary>
    public static readonly TimeSpan DefaultConnectTimeout = TimeSpan.FromSeconds(2);

    private const int ByteBufferSize = 8192;

    // A byte buffer can carry a partial UTF-8 sequence at its end, which the decoder holds over to the
    // next call. Those carried bytes are at most three and emit at most one character, so one extra
    // unit would do; four is that with room to not have to think about it again. A question is natural
    // language, so a chunk boundary landing mid-character is ordinary rather than exotic.
    private const int CharBufferSize = ByteBufferSize + 4;

    private readonly TimeSpan _connectTimeout;

    public PipeLanguageAsker(TimeSpan? connectTimeout = null)
    {
        _connectTimeout = connectTimeout ?? DefaultConnectTimeout;
    }

    public async Task<LanguageAskResult> AskAsync(string endpointPath, string text,
        CancellationToken cancellationToken)
    {
        var pipe = new NamedPipeClientStream(".", LanguageEndpointPath.ServerNameOf(endpointPath),
            PipeDirection.InOut, PipeOptions.Asynchronous);

        using var attempt = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        attempt.CancelAfter(_connectTimeout);

        try
        {
            await pipe.ConnectAsync(attempt.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // The Surface is shutting down. Not an ask outcome, so it is not reported as one.
            pipe.Dispose();
            throw;
        }
        catch (OperationCanceledException)
        {
            // The wait expired with nobody serving the name. Taking the time out of the token rather
            // than out of an argument is what makes this not a blocking call.
            pipe.Dispose();
            return LanguageAskResult.Absent();
        }
        catch (Exception exception)
        {
            pipe.Dispose();
            return LanguageAskResult.Unavailable(ExceptionDetail.Of(exception));
        }

        using (pipe)
        {
            return await ExchangeAsync(pipe, text, cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task<LanguageAskResult> ExchangeAsync(NamedPipeClientStream pipe, string text,
        CancellationToken cancellationToken)
    {
        // The budget starts at the connection, not at the call, mirroring the client this copies: the
        // time spent waiting for the name to appear is the connect timeout's business and is reported
        // as an absence rather than as a slow answer.
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        budget.CancelAfter(ReplyTimeoutMilliseconds);

        try
        {
            var request = Encoding.UTF8.GetBytes(LanguageFraming.EncodeRequest(text));
            await pipe.WriteAsync(request, budget.Token).ConfigureAwait(false);
            await pipe.FlushAsync(budget.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            return TimedOut();
        }
        catch (Exception exception)
        {
            return LanguageAskResult.Unavailable(ExceptionDetail.Of(exception));
        }

        var lines = new LanguageLineReader();
        var decoder = new UTF8Encoding(false).GetDecoder();
        var bytes = new byte[ByteBufferSize];
        var chars = new char[CharBufferSize];

        while (true)
        {
            // A previous push can leave a whole line behind it, so the buffer is drained before the
            // pipe is touched again. Reading first would stall on an answer that already arrived.
            var buffered = lines.Push(string.Empty);
            if (buffered.Kind == DeliveryLineReadKind.Line) return Read(buffered.Line!);
            if (buffered.Kind == DeliveryLineReadKind.Overflow) return Overflow();

            int read;
            try
            {
                read = await pipe.ReadAsync(bytes.AsMemory(), budget.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (OperationCanceledException)
            {
                return TimedOut();
            }
            catch (Exception exception) when (exception is IOException or ObjectDisposedException)
            {
                return LanguageAskResult.Unavailable(ExceptionDetail.Of(exception));
            }

            // Zero bytes is the far end closing without answering. `ask.ts` reports the same situation
            // from its `close` handler, and it is not an absence: something was there and stopped.
            if (read == 0) return LanguageAskResult.Unavailable("语言入口关闭了连接，但没有应答。");

            var decoded = decoder.GetChars(bytes, 0, read, chars, 0);
            var pushed = lines.Push(new string(chars, 0, decoded));
            if (pushed.Kind == DeliveryLineReadKind.Line) return Read(pushed.Line!);
            if (pushed.Kind == DeliveryLineReadKind.Overflow) return Overflow();
        }
    }

    private static LanguageAskResult Read(string line)
    {
        var decoded = LanguageFraming.DecodeReply(line);

        // A line that is not a reply to this protocol is not an empty reply. Reporting nothing for it
        // would tell a person Hikari said nothing, when what happened is that something on the pipe
        // spoke this protocol wrong.
        return decoded.Kind == DecodedLanguageReplyKind.Reply
            ? LanguageAskResult.Replied(decoded.Reply!)
            : LanguageAskResult.Unavailable(decoded.Reason!);
    }

    private static LanguageAskResult TimedOut() =>
        LanguageAskResult.Unavailable($"语言入口在 {ReplyTimeoutMilliseconds}ms 内没有应答。");

    private static LanguageAskResult Overflow() =>
        LanguageAskResult.Unavailable("语言入口的应答超过了长度上限。");
}
