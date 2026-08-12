using System;
using System.Diagnostics;
using System.IO;
using System.Linq;

internal static class Program
{
    private static string Quote(string value)
    {
        return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }

    private static int Main(string[] args)
    {
        var directory = AppDomain.CurrentDomain.BaseDirectory;
        var host = Path.Combine(directory, "AIGeekHost.exe");
        if (!File.Exists(host)) return 1;

        var userData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "AIGeek");
        Directory.CreateDirectory(userData);

        var forwarded = string.Join(" ", args.Select(Quote));
        var commandLine = "--user-data-dir=" + Quote(userData);
        if (!string.IsNullOrWhiteSpace(forwarded)) commandLine += " " + forwarded;

        Process.Start(new ProcessStartInfo(host, commandLine) {
            UseShellExecute = false,
            WorkingDirectory = directory,
        });
        return 0;
    }
}
