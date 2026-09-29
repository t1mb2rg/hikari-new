using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace HumanSurface;

/// <summary>
/// The tray icon, drawn at startup.
/// </summary>
/// <remarks>
/// Drawn rather than shipped as a binary. An `.ico` in the repository would be a file nothing here can
/// review, whose only requirement is "a filled circle with an H in it" — and this way the shape is
/// legible in the source, changes with the code, and adds no asset pipeline to a project that has no
/// build steps of its own beyond the compiler.
/// </remarks>
internal static class TrayIconArt
{
    // The shell scales the tray icon to the notification area's own size, so this is drawn at the
    // largest size it is ever asked for rather than at whatever the current display reports. A single
    // icon that scales down is crisper than one drawn to a measurement taken before the tray exists.
    private const int Size = 32;

    private static Icon? _icon;

    public static Icon Icon => _icon ??= Create();

    private static Icon Create()
    {
        using var bitmap = new Bitmap(Size, Size);

        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.Clear(Color.Transparent);

            using var background = new SolidBrush(Color.FromArgb(0x2B, 0x6C, 0xB0));
            graphics.FillEllipse(background, 0, 0, Size - 1, Size - 1);

            using var font = new Font("Segoe UI", Size * 0.6f, FontStyle.Bold, GraphicsUnit.Pixel);
            using var foreground = new SolidBrush(Color.White);
            using var centred = new StringFormat
            {
                Alignment = StringAlignment.Center,
                LineAlignment = StringAlignment.Center,
            };

            graphics.DrawString("H", font, foreground, new RectangleF(0, 0, Size, Size), centred);
        }

        // The handle belongs to the bitmap, and Icon.FromHandle only borrows it — so the icon is
        // cloned into one that owns its own copy, and the borrowed handle is destroyed before the
        // bitmap is. Without the clone the icon would be pointing at freed memory the moment the
        // bitmap went out of scope, which is a crash minutes into a session rather than at startup.
        var borrowed = bitmap.GetHicon();
        try
        {
            using var temporary = Icon.FromHandle(borrowed);
            return (Icon)temporary.Clone();
        }
        finally
        {
            DestroyIcon(borrowed);
        }
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr handle);
}
