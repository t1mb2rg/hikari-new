using System.Text;
using HumanSurface.Core;

namespace HumanSurface;

/// <summary>
/// Every word this program puts on screen that Hikari did not say.
/// </summary>
/// <remarks>
/// <para>
/// The list is short on purpose, and keeping it in one file is how it stays short: a reader can see
/// the whole of what the Surface is allowed to assert, and a reviewer can check that none of it is a
/// claim about the world. These are interface state words — whether a connection exists, what time
/// this process read something — and they sit beside the message text rather than inside it.
/// </para>
/// <para>
/// What is absent is as deliberate as what is here: no summary, no lead-in, no persona prefix, no
/// label explaining what a message is about. A message is drawn exactly as Language wrote it, and the
/// only thing added around it is the one fact the message cannot carry — when this window received it.
/// </para>
/// </remarks>
internal static class SurfaceChrome
{
    public const string Title = "Hikari";

    public const string Connected = "已连接";
    public const string Disconnected = "未连接";
    public const string Waiting = "正在等待 Hikari…";

    /// <summary>Shown while a question is outstanding. A statement about this program, not about Hikari.</summary>
    public const string Replying = "Hikari 正在回复…";

    public const string Open = "打开";
    public const string Quit = "退出";
    public const string Send = "发送";

    /// <summary>The label on a message's arrival time, which is not the time the event happened.</summary>
    /// <remarks>
    /// "收到" rather than a bare timestamp, because a timestamp near a message reads as the message's
    /// own time. When the occurrence happened is Language's to say and is already in the text; this is
    /// the only clock the Surface has, and it is honest about being a different one.
    /// </remarks>
    public const string Received = "收到";

    /// <summary>The label on a line the person typed, which is the one entry they already know about.</summary>
    public const string Said = "你说";

    /// <summary>The label on this program's own sentence, which is the only text here Hikari did not say.</summary>
    /// <remarks>
    /// "提示" and not a fourth way of saying "收到". The two entries it marks are the ones where the
    /// Surface could not reach Hikari at all, so attributing them to Hikari would report a transport
    /// failure as something Hikari said — and <c>LanguageNotices</c> is deliberately worded as this
    /// program's observation rather than as one of the endpoint's four outcomes.
    /// </remarks>
    public const string Noted = "提示";

    /// <summary>The status line above the transcript.</summary>
    public static string Status(SurfaceSnapshot snapshot)
    {
        var parts = new List<string>(3);

        // First, because it is the thing that explains why the send button is disabled and it is only
        // ever true for as long as a question is outstanding.
        if (snapshot.AskPending) parts.Add(Replying);

        if (snapshot.Connection == SurfaceConnection.Connected)
        {
            parts.Add(Connected);
            if (snapshot.UnreadCount > 0) parts.Add($"{snapshot.UnreadCount} 条未读");
        }
        else
        {
            // A detail is only ever set for something abnormal — a frame that could not be read, a pipe
            // that failed. The ordinary absence has none, and gets the ordinary sentence.
            parts.Add(string.IsNullOrEmpty(snapshot.Detail)
                ? $"{Disconnected} · {Waiting}"
                : $"{Disconnected} · {snapshot.Detail}");
        }

        return string.Join(" · ", parts);
    }

    /// <summary>The tray tooltip, which carries the unread count where it can be seen without opening.</summary>
    public static string Tooltip(SurfaceSnapshot snapshot)
    {
        if (snapshot.Connection != SurfaceConnection.Connected) return $"{Title} — {Disconnected}";

        return snapshot.UnreadCount > 0
            ? $"{Title} — {snapshot.UnreadCount} 条未读"
            : $"{Title} — {Connected}";
    }

    /// <summary>The status line as a tray menu item.</summary>
    public static string TrayStatus(SurfaceSnapshot snapshot)
    {
        if (snapshot.Connection == SurfaceConnection.Connected) return Connected;
        return string.IsNullOrEmpty(snapshot.Detail) ? Disconnected : $"{Disconnected}（{snapshot.Detail}）";
    }

    /// <summary>The transcript: every entry this process holds, oldest first.</summary>
    /// <remarks>
    /// <para>
    /// CRLF, and that is not a preference. Windows' edit control breaks lines on a carriage return and
    /// treats a bare line feed as an ordinary character, so a transcript joined with <c>'\n'</c> is a
    /// single run-on paragraph on screen while looking perfectly correct in the source — measured, not
    /// assumed: the same three-line text reports one line with <c>'\n'</c> and three with <c>"\r\n"</c>.
    /// The line separator is this control's requirement, which is why it lives at the point the text is
    /// built for that control rather than in the snapshot the session hands over.
    /// </para>
    /// <para>
    /// The label is the whole of what the Surface says about an entry, and the lines under it are the
    /// entry's own text with nothing added. That is the same rule as before it could ask: a delivered
    /// message is drawn exactly as it arrived, and the only thing beside it is the one fact the text
    /// cannot carry — who wrote it and when this window heard it.
    /// </para>
    /// </remarks>
    public static string Transcript(SurfaceSnapshot snapshot)
    {
        var builder = new StringBuilder();
        const string NewLine = "\r\n";

        foreach (var message in snapshot.Messages)
        {
            if (builder.Length > 0) builder.Append(NewLine);

            builder.Append(Label(message.Origin)).Append(' ')
                .Append(message.ReceivedAt.ToString("HH:mm:ss"))
                .Append(NewLine);

            foreach (var line in message.Lines)
            {
                builder.Append(line).Append(NewLine);
            }
        }

        return builder.ToString();
    }

    private static string Label(SurfaceOrigin origin) => origin switch
    {
        SurfaceOrigin.Human => Said,
        SurfaceOrigin.Surface => Noted,
        _ => Received,
    };

    /// <summary>
    /// The one line a balloon shows.
    /// </summary>
    /// <remarks>
    /// The message's own first line, not a summary of it. A balloon is a fixed-size box in the shell
    /// and cannot hold a whole message, so when the line does not fit it is cut and marked with an
    /// ellipsis — the marker is what keeps the cut from reading as the end of the sentence, and the
    /// window is where the rest of it is.
    /// </remarks>
    public static string BalloonText(SurfaceMessage message)
    {
        if (message.Lines.Count == 0) return string.Empty;

        var first = message.Lines[0];
        return first.Length <= MaxBalloonLength ? first : first[..MaxBalloonLength] + "…";
    }

    // Chosen to be under what the shell renders in a standard balloon, so the visible cut and the mark
    // we add land in the same place rather than the shell truncating silently a second time.
    private const int MaxBalloonLength = 120;
}
