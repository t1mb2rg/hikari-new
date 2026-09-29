using HumanSurface.Core;

namespace HumanSurface;

/// <summary>
/// The tray presence: an icon that says whether Hikari is reachable, a window, and an exit.
/// </summary>
/// <remarks>
/// <para>
/// Three menu items and no more. The status line is the thing that makes the Surface worth having
/// without its window open — a person can see that Hikari is connected, and that something arrived,
/// without bringing anything to the front. 退出 ends this process and only this process: it does not
/// ask the resident to stop, does not touch the Runtime, and does not know how to. The Surface and the
/// resident are two lifetimes that happen to be talking, and neither owns the other.
/// </para>
/// <para>
/// The session's events arrive on whichever thread caused them, so everything that touches a control
/// goes through <see cref="OnUi"/>. The window's handle is created before the loop starts, which is
/// what makes posting to it safe from a background thread.
/// </para>
/// </remarks>
internal sealed class TrayApplication : ApplicationContext
{
    // Long enough to be noticed by someone at the machine, short enough not to sit there. The balloon
    // is a hint and the tray state is the record, so nothing depends on this number.
    private const int BalloonMilliseconds = 6000;

    private readonly SurfaceSession _session;
    private readonly SurfaceWindow _window = new();
    private readonly NotifyIcon _tray = new();
    private readonly ToolStripMenuItem _statusItem = new();
    private readonly CancellationTokenSource _cancellation = new();
    private readonly Task _loop;
    private bool _stopping;

    public TrayApplication(SurfaceSession session)
    {
        _session = session;

        // Created now rather than at first Show: the session's first state change can arrive before
        // anyone has opened the window, and a post to a control without a handle throws.
        _ = _window.Handle;

        _statusItem.Enabled = false;

        var menu = new ContextMenuStrip();
        menu.Items.Add(_statusItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(SurfaceChrome.Open, null, (_, _) => ShowWindow());
        menu.Items.Add(SurfaceChrome.Quit, null, (_, _) => Quit());

        _tray.Icon = TrayIconArt.Icon;
        _tray.Text = SurfaceChrome.Title;
        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => ShowWindow();
        _tray.Visible = true;

        _session.Changed += OnSessionChanged;
        _session.MessageReceived += OnMessageReceived;

        Render();

        // Shown once, now. A Surface that started as an icon alone would leave the person who just
        // launched it looking at a tray with nothing to say whether Hikari is reachable — the whole
        // point of the window is that it answers that without anything being asked of it. Closing it
        // still returns to the tray, and 打开 still brings it back.
        ShowWindow();

        _loop = Task.Run(() => _session.RunAsync(_cancellation.Token));
    }

    private void ShowWindow()
    {
        // Opening the window is what clears the unread count. Nothing else does, so the count means
        // "since you last looked" rather than "since some rule decided this was important".
        _session.MarkRead();

        _window.Show();
        if (_window.WindowState == FormWindowState.Minimized) _window.WindowState = FormWindowState.Normal;
        _window.Activate();
    }

    private void Quit()
    {
        _stopping = true;
        _tray.Visible = false;

        _cancellation.Cancel();

        // Bounded: the read loop is either waiting on a delay or blocked in a pipe read, both of
        // which the token ends. The wait is for tidiness, not for correctness — leaving the process
        // is what actually closes the connection, and it happens either way.
        try
        {
            _loop.Wait(TimeSpan.FromSeconds(2));
        }
        catch (Exception)
        {
            // Already finished, or finished badly. Either way the process is about to end.
        }

        ExitThread();
    }

    private void OnSessionChanged() => OnUi(Render);

    private void OnMessageReceived(SurfaceMessage message) => OnUi(() =>
    {
        // The balloon is the hint and the tray state is the record. Both happen on every message:
        // whether a person should be interrupted is not a question this process is entitled to
        // answer, so it never decides not to.
        var text = SurfaceChrome.BalloonText(message);
        if (text.Length > 0) _tray.ShowBalloonTip(BalloonMilliseconds, SurfaceChrome.Title, text, ToolTipIcon.Info);
    });

    private void Render()
    {
        var snapshot = _session.Snapshot();

        _window.Render(snapshot);
        _statusItem.Text = SurfaceChrome.TrayStatus(snapshot);
        _tray.Text = SurfaceChrome.Tooltip(snapshot);
    }

    private void OnUi(Action action)
    {
        if (_stopping || _window.IsDisposed) return;

        if (_window.InvokeRequired) _window.BeginInvoke(action);
        else action();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _session.Changed -= OnSessionChanged;
            _session.MessageReceived -= OnMessageReceived;
            _cancellation.Dispose();
            _tray.Dispose();
            _window.Dispose();
        }

        base.Dispose(disposing);
    }
}
