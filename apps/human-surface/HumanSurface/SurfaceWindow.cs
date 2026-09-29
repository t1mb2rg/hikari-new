using HumanSurface.Core;

namespace HumanSurface;

/// <summary>
/// The window: a status line, everything this process has heard, and a box to type into.
/// </summary>
/// <remarks>
/// <para>
/// Four decisions worth naming. It is a text box rather than a list of cards, because a delivered
/// message is several lines of prose and the reader's only need is to read it — a list would add a
/// per-message widget, a selection model and a scroll policy to serve no one. It renders the whole
/// transcript from a snapshot on every change rather than appending, so what is on screen is always a
/// function of the session's state and never a second copy of it that can drift. And closing it hides
/// it, because a person closing a window is dismissing a view, not ending the thing that listens.
/// </para>
/// <para>
/// The fourth is what the input row does while a question is outstanding. It disables the send button
/// and nothing else: the transcript still scrolls, the tray still opens, the window still closes, and
/// the box stays editable so the next question can be composed while this one is being answered. A
/// window that froze would be spending the person's whole attention on a wait they did not choose, and
/// the one thing that actually has to be prevented — a second question overtaking the first — is
/// prevented here by one disabled button and in the session by the rule that button reflects.
/// </para>
/// <para>
/// The time beside each entry is this process's arrival time and says so. There is exactly one clock
/// here and it is not the one the occurrence happened on; labelling it "收到" is the whole of what
/// keeps that from reading as a claim about when Hikari noticed something.
/// </para>
/// </remarks>
internal sealed class SurfaceWindow : Form
{
    private readonly Label _status = new();
    private readonly TextBox _transcript = new();
    private readonly TextBox _input = new();
    private readonly Button _send = new();

    public SurfaceWindow()
    {
        Text = SurfaceChrome.Title;
        MinimumSize = new Size(360, 280);
        Size = new Size(520, 440);
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

        _input.Dock = DockStyle.Fill;
        _input.Multiline = false;
        _input.AcceptsReturn = false;
        _input.BorderStyle = BorderStyle.FixedSingle;

        _send.Dock = DockStyle.Right;
        _send.Text = SurfaceChrome.Send;
        _send.Width = 84;
        _send.Click += (_, _) => Submit();

        // Enter sends, from anywhere in the window. A disabled button is not the accept button, so this
        // is also what keeps a second Enter from going out while the first question is outstanding —
        // the same rule as the button, not a second one.
        AcceptButton = _send;

        var composer = new Panel
        {
            Dock = DockStyle.Bottom,
            Height = 40,
            Padding = new Padding(12, 6, 12, 6),
            BackColor = SystemColors.Control,
        };

        composer.Controls.Add(_input);
        composer.Controls.Add(_send);

        // Added in the order docking resolves them: the status strip and the composer take their edges
        // first, and the transcript fills whatever is left between them.
        Controls.Add(_transcript);
        Controls.Add(composer);
        Controls.Add(_status);
    }

    /// <summary>Raised with the text a person submitted, on the UI thread.</summary>
    /// <remarks>
    /// An event rather than a reference to the session: the window draws what it is handed and owns no
    /// state of its own, which is what keeps the tray the only thing that talks to the session.
    /// </remarks>
    public event Action<string>? AskRequested;

    /// <summary>Draws the given state. Must be called on the UI thread.</summary>
    public void Render(SurfaceSnapshot snapshot)
    {
        _status.Text = SurfaceChrome.Status(snapshot);

        // Rebuilt rather than appended: a bounded list can drop its oldest entry while the window is
        // looking at it, and an appending view would then be showing something the session no longer
        // holds.
        _transcript.Text = SurfaceChrome.Transcript(snapshot);

        if (_transcript.TextLength > 0)
        {
            _transcript.SelectionStart = _transcript.TextLength;
            _transcript.SelectionLength = 0;
            _transcript.ScrollToCaret();
        }

        // The input box is deliberately not touched. Whatever is in it is the person's, and a render
        // that cleared or rewrote it would be overwriting something they are in the middle of typing —
        // and renders happen on every arrival, not only on the ones they caused.
        _send.Enabled = !snapshot.AskPending;
    }

    /// <summary>Puts the caret where a person who just opened the window expects it.</summary>
    public void FocusInput()
    {
        if (!_input.CanFocus) return;

        _input.Focus();
        _input.SelectionStart = _input.TextLength;
    }

    private void Submit()
    {
        // Belt and braces behind `AcceptButton`: a disabled button is not invoked, and this is the one
        // line that keeps that from being a property of the framework rather than of this window.
        if (!_send.Enabled) return;

        var text = _input.Text;

        // Whitespace is not a question, and submitting it would spend a round trip to be told so. This
        // is not the plugin's length rule arriving early — the Surface has no opinion about what makes
        // a question answerable, only about whether anything was typed at all.
        if (text.Trim().Length == 0) return;

        // Cleared before the event, so the box cannot keep a copy of a line the transcript is about to
        // hold. The session records it before its first await, so nothing is lost if the endpoint never
        // answers.
        _input.Clear();
        AskRequested?.Invoke(text);
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
