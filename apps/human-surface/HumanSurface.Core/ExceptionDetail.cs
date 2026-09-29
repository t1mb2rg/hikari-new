namespace HumanSurface.Core;

/// <summary>Turns a thrown exception into one line a human can read in a status bar.</summary>
/// <remarks>
/// Never a substitute for the exception's own text — only its first line, trimmed. A stack trace in a
/// label is unreadable, and a swallowed exception is worse than an unreadable one: what the Surface
/// owes the person looking at a disconnected window is the transport's own sentence, not a
/// paraphrase of it.
/// </remarks>
internal static class ExceptionDetail
{
    public static string Of(Exception exception)
    {
        var message = exception.Message;
        var newline = message.IndexOfAny(['\r', '\n']);
        return (newline >= 0 ? message[..newline] : message).Trim();
    }
}
