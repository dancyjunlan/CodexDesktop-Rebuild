using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

internal static class Program
{
    private const string AppUserModelId = "studio.aigeek.desktop.v2";

    private static readonly Guid ShellLinkClassId = new Guid("00021401-0000-0000-C000-000000000046");
    private static readonly PROPERTYKEY AppUserModelIdKey = new PROPERTYKEY(
        new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
        5);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern void SHChangeNotify(uint wEventId, uint uFlags, string dwItem1, string dwItem2);

    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellLinkW
    {
        void GetPath([Out] StringBuilder pszFile, int cch, IntPtr pfd, uint fFlags);
        void GetIDList(out IntPtr ppidl);
        void SetIDList(IntPtr pidl);
        void GetDescription([Out] StringBuilder pszName, int cch);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetWorkingDirectory([Out] StringBuilder pszDir, int cch);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
        void GetArguments([Out] StringBuilder pszArgs, int cch);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
        void GetHotkey(out short pwHotkey);
        void SetHotkey(short wHotkey);
        void GetShowCmd(out int piShowCmd);
        void SetShowCmd(int iShowCmd);
        void GetIconLocation([Out] StringBuilder pszIconPath, int cch, out int piIcon);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
        void Resolve(IntPtr hwnd, uint fFlags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        void GetCount(out uint cProps);
        void GetAt(uint iProp, out PROPERTYKEY pkey);
        void GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
        void SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
        void Commit();
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct PROPERTYKEY
    {
        public Guid fmtid;
        public uint pid;

        public PROPERTYKEY(Guid fmtid, uint pid)
        {
            this.fmtid = fmtid;
            this.pid = pid;
        }
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct PROPVARIANT
    {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public IntPtr pointerValue;

        public static PROPVARIANT FromString(string value)
        {
            return new PROPVARIANT {
                vt = 31, // VT_LPWSTR
                pointerValue = Marshal.StringToCoTaskMemUni(value),
            };
        }

        public void Dispose()
        {
            if (pointerValue != IntPtr.Zero) Marshal.FreeCoTaskMem(pointerValue);
            pointerValue = IntPtr.Zero;
        }
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }

    private static int Main(string[] args)
    {
        SetCurrentProcessExplicitAppUserModelID(AppUserModelId);

        if (args.Length == 3 && string.Equals(args[0], "--create-shortcuts", StringComparison.OrdinalIgnoreCase))
        {
            CreateShortcut(args[1], args[2]);
            return 0;
        }

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

    private static void CreateShortcut(string shortcutPath, string targetPath)
    {
        var shellLink = (IShellLinkW)Activator.CreateInstance(Type.GetTypeFromCLSID(ShellLinkClassId));
        try
        {
            shellLink.SetPath(targetPath);
            shellLink.SetWorkingDirectory(Path.GetDirectoryName(targetPath));
            shellLink.SetDescription("AIGeek");
            shellLink.SetIconLocation(targetPath, 0);

            var propertyStore = (IPropertyStore)shellLink;
            var property = PROPVARIANT.FromString(AppUserModelId);
            var propertyKey = AppUserModelIdKey;
            try
            {
                propertyStore.SetValue(ref propertyKey, ref property);
                propertyStore.Commit();
            }
            finally
            {
                property.Dispose();
            }

            Directory.CreateDirectory(Path.GetDirectoryName(shortcutPath));
            ((IPersistFile)shellLink).Save(shortcutPath, true);
            // Tell Explorer to discard the old icon/property view immediately.
            SHChangeNotify(0x00002000, 0x00000005, shortcutPath, null);
        }
        finally
        {
            Marshal.ReleaseComObject(shellLink);
        }
    }
}
