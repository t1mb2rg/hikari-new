using HumanSurface.Core;

namespace HumanSurface;

/// <summary>
/// The window: a status line and everything this process has heard.
/// </summary>
/// <remarks>
/// <para>
/// Three decisions worth naming. It is a text box rather than a list of cards, because a delivered
/// message is several lines of prose and the reader's only need is to read it — a list would add a
/// per-message widget, a selection model and a scroll policy to serve no one. It renders the whole
/// transcript from a snapshot on every change rather than appending, so what is on screen is always a
/// function of the session's state and never a second copy of it that can drift. And closing it hides
/// it, because a person closing a window is dismissing a view, not ending the thing that listens.
/// </para>
/// <para>
/// The time beside each message is this process's arrival time and says so. There is exactly one clock
/// here and it is not the one the occurrence happened on; labelling it "收到" is the whole of what
/// keeps that from reading as a claim about when Hikari noticed something.
/// </para>
/// </remarks>
internal sealed class SurfaceWindow : Form
{
    private readonly Label _status = new();
    private readonly TextBox _transcript = new();

    public SurfaceWindow()
    {
        Text = SurfaceChrome.Title;
        MinimumSize = new Size(360, 240);
        Size = new Size(520, 400);
        StartPosition = FormStartPosition.CenterScreen;
        ShowInTaskbar = true;

        _status.Dock = DockStyle.Top;
        _status.Height = 32;
        _status.TextAlign = ContentAlignment.MiddleLeft;
        _status.Padding = new Padding(12, 0, 12, 0);
        _status.BackColor = SystemColors.Control;
        _status.Font = new Font(Font, FontStyle.Bold);

        _transcript.Dock = DockStyle.Fill;
        _transcript.Multiline = true;
        _transcript.ReadOnly = true;
        _transcript.WordWrap = true;
        _transcript.ScrollBars = ScrollBars.Vertical;
        _transcript.BorderStyle = BorderStyle.None;
        _transcript.BackColor = SystemColors.Window;
        _transcript.Font = new Font("Consolas", 10f);
        _transcript.TabStop = false;

        Controls.Add(_transcript);
        Controls.Add(_status);
    }

    /// <summary>Draws the given state. Must be called on the UI thread.</summary>
    public void Render(SurfaceSnapshot snapshot)
    {
        _status.Text = SurfaceChrome.Status(snapshot);

        // Rebuilt rather than appended: a bounded list can drop its oldest message while the window
        // is looking at it, and an appending view would then be showing something the session no
        // longer holds.
        _transcript.Text = SurfaceChrome.Transcript(snapshot);

        if (_transcript.TextLength > 0)
        {
            _transcript.SelectionStart = _transcript.TextLength;
            _transcript.SelectionLength = 0;
            _transcript.ScrollToCaret();
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        // A close from the window's own chrome hides it and leaves the process running; only the tray
        // menu's 退出 ends the Surface. A close for any other reason — Windows shutting down, the
        // session ending — is allowed through, because refusing those would leave a process nobody
        // can get rid of.
        if (e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
        }

        base.OnFormClosing(e);
    }
}
