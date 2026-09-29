using HumanSurface.Core;

namespace HumanSurface;

/// <summary>
/// Starts the Surface: work out which pipes to use, then hand the process to the tray.
/// </summary>
/// <remarks>
/// <para>
/// The data directory is required and has no default, because both pipe names are derived from it and
/// two Surfaces pointed at different directories are pointed at different Hikaris. Guessing would
/// produce a window that is silently connected to nothing, which is the one failure this program cannot
/// report — a process that is running and listening looks exactly like one that is connected to a
/// resident that has nothing to say.
/// </para>
/// <para>
/// The directory is not required to exist. A client may connect before anything has created the data
/// directory, and the derivation falls back to the lexical form for exactly that case — so checking
/// here would refuse a startup that works.
/// </para>
/// </remarks>
internal static class Program
{
    private const string DataDirOption = "--data-dir";

    private static readonly string Usage =
        $"""
         {SurfaceChrome.Title} — 在 Windows 上与 Hikari 对话，并接收它的主动消息。

         用法：
           HumanSurface.exe {DataDirOption} <数据目录>

         数据目录与 hikari 命令行使用的一致；两个管道名都由它推导，两侧必须相同。
         输入框里的一句话会送到该目录的语言入口，与 hikari ask 走的是同一个入口。
         """;

    [STAThread]
    private static int Main(string[] args)
    {
        if (!TryParse(args, out var dataDir, out var error))
        {
            MessageBox.Show(error, SurfaceChrome.Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 2;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        // Two pipes, one data directory, and no third name to configure: the surface asks the language
        // plugin and listens to the delivery transport, and both derivations come from the directory
        // the person already gave the resident.
        var session = new SurfaceSession(
            DeliveryEndpointPath.For(dataDir),
            new PipeDeliveryConnector(),
            LanguageEndpointPath.For(dataDir),
            new PipeLanguageAsker());

        using var application = new TrayApplication(session);
        Application.Run(application);

        return 0;
    }

    private static bool TryParse(string[] args, out string dataDir, out string error)
    {
        dataDir = string.Empty;
        error = string.Empty;

        for (var index = 0; index < args.Length; index++)
        {
            if (args[index] is "-h" or "--help" or "/?")
            {
                error = Usage;
                return false;
            }

            if (args[index] != DataDirOption)
            {
                error = $"无法识别的参数：{args[index]}\n\n{Usage}";
                return false;
            }

            if (index + 1 >= args.Length)
            {
                error = $"{DataDirOption} 需要一个数据目录。\n\n{Usage}";
                return false;
            }

            dataDir = args[++index];
        }

        if (dataDir.Length == 0)
        {
            error = Usage;
            return false;
        }

        return true;
    }
}
