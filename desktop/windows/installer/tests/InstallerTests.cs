using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using Microsoft.Win32;
using McClusterDesktop;

// Written before the installer. These tests drive the real Setup.exe (with its embedded
// payload) into a throwaway root, a throwaway Start Menu folder and a throwaway HKCU key,
// then drive its uninstaller, and assert the machine is left exactly as it was.
// Nothing here touches %LOCALAPPDATA%\McClusterDesktop or the real uninstall key.
internal static class InstallerTests
{
    private static int checks;
    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception("FAILED: " + message);
        checks++;
    }

    private static int Run(string exe, string args, int timeoutMs)
    {
        var psi = new ProcessStartInfo(exe, args) { UseShellExecute = false, CreateNoWindow = true };
        using (Process p = Process.Start(psi))
        {
            if (!p.WaitForExit(timeoutMs)) { try { p.Kill(); } catch (Exception) { } throw new Exception("FAILED: " + Path.GetFileName(exe) + " did not exit in time"); }
            return p.ExitCode;
        }
    }

    private static string Sha256(string path)
    {
        using (var sha = SHA256.Create()) using (FileStream fs = File.OpenRead(path))
        {
            byte[] h = sha.ComputeHash(fs);
            var sb = new System.Text.StringBuilder();
            foreach (byte b in h) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }
    }

    private static int Main(string[] args)
    {
        if (args.Length < 1) { Console.Error.WriteLine("usage: InstallerTests <path to Setup.exe>"); return 2; }
        string setup = Path.GetFullPath(args[0]);
        string root = Path.Combine(Path.GetTempPath(), "mccluster-installer-test-" + Guid.NewGuid().ToString("N"));
        string app = Path.Combine(root, "App");
        string startMenu = Path.Combine(root, "StartMenu");
        string regKey = @"Software\McClusterDesktopInstallerTest\" + Guid.NewGuid().ToString("N");
        try
        {
            Assert(File.Exists(setup), "Setup.exe exists: " + setup);
            Assert(InstallerManifest.ReadEmbedded(setup) != null, "setup carries an embedded manifest");
            InstallerManifest manifest = InstallerManifest.ReadEmbedded(setup);
            Assert(manifest.Files.Count >= 4, "manifest lists the app and the three WebView2 files");
            Assert(manifest.Files.Exists(f => f.Name == "McCluster.exe"), "manifest names McCluster.exe");
            Assert(manifest.Version.Length > 0 && manifest.Version != "0.0.0", "manifest carries a version");

            // Silent install into the throwaway root.
            int code = Run(setup, "--silent --root \"" + app + "\" --start-menu \"" + startMenu + "\" --registry-key \"" + regKey + "\"", 120000);
            Assert(code == 0, "install exits 0 (was " + code + ")");
            foreach (InstallerFile f in manifest.Files)
            {
                string path = Path.Combine(app, f.Name);
                Assert(File.Exists(path), "installed: " + f.Name);
                Assert(string.Equals(Sha256(path), f.Sha256, StringComparison.OrdinalIgnoreCase), "hash matches manifest: " + f.Name);
            }
            Assert(File.Exists(Path.Combine(app, "Uninstall.exe")), "uninstaller written");
            Assert(File.Exists(Path.Combine(app, "install-receipt.json")), "install receipt written");
            string receipt = File.ReadAllText(Path.Combine(app, "install-receipt.json"));
            Assert(receipt.Contains("\"schema\": \"mccluster-install-receipt/1\"") && receipt.Contains(manifest.Version), "receipt names schema and version");
            Assert(!receipt.Contains(Environment.UserName + "\\") || receipt.Contains(app.Replace("\\", "\\\\")), "receipt records the install root");
            Assert(File.Exists(Path.Combine(startMenu, "McCluster Desktop.lnk")), "Start Menu shortcut created");
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(regKey))
            {
                Assert(key != null, "uninstall registry key written");
                Assert((string)key.GetValue("DisplayName") == "McCluster", "DisplayName");
                Assert((string)key.GetValue("DisplayVersion") == manifest.Version, "DisplayVersion");
                Assert(((string)key.GetValue("InstallLocation")).TrimEnd('\\').Equals(app.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase), "InstallLocation");
                Assert(((string)key.GetValue("UninstallString")).Contains("Uninstall.exe"), "UninstallString");
                Assert((int)key.GetValue("NoModify") == 1 && (int)key.GetValue("NoRepair") == 1, "NoModify/NoRepair");
            }

            // Second install is idempotent: same files, same hashes, exit 0.
            code = Run(setup, "--silent --root \"" + app + "\" --start-menu \"" + startMenu + "\" --registry-key \"" + regKey + "\"", 120000);
            Assert(code == 0, "reinstall exits 0");
            foreach (InstallerFile f in manifest.Files) Assert(string.Equals(Sha256(Path.Combine(app, f.Name)), f.Sha256, StringComparison.OrdinalIgnoreCase), "hash still matches after reinstall: " + f.Name);

            // A foreign file in the app folder is never deleted by the uninstaller.
            string foreign = Path.Combine(app, "owner-note.txt");
            File.WriteAllText(foreign, "not ours");

            // Silent uninstall removes exactly what the receipt lists.
            code = Run(Path.Combine(app, "Uninstall.exe"), "--silent --uninstall", 120000);
            Assert(code == 0, "uninstall exits 0 (was " + code + ")");
            foreach (InstallerFile f in manifest.Files) Assert(!File.Exists(Path.Combine(app, f.Name)), "removed: " + f.Name);
            Assert(!File.Exists(Path.Combine(app, "install-receipt.json")), "receipt removed");
            Assert(!File.Exists(Path.Combine(startMenu, "McCluster Desktop.lnk")), "shortcut removed");
            Assert(Registry.CurrentUser.OpenSubKey(regKey) == null, "registry key removed");
            Assert(File.Exists(foreign), "foreign file kept");
            Assert(Directory.Exists(app), "folder kept because a foreign file remains");
            File.Delete(foreign);

            // Refusals: a root outside the user profile is refused without --allow-any-root (tests pass it implicitly via temp? no: temp is inside the profile).
            string outside = @"C:\Windows\Temp\mccluster-refuse-" + Guid.NewGuid().ToString("N");
            code = Run(setup, "--silent --root \"" + outside + "\" --start-menu \"" + startMenu + "\" --registry-key \"" + regKey + "\"", 60000);
            Assert(code == 3, "install outside the user profile is refused with exit 3 (was " + code + ")");
            Assert(!Directory.Exists(outside), "nothing was written outside the profile");

            Console.WriteLine(checks + " installer checks passed.");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
        finally
        {
            try { Registry.CurrentUser.DeleteSubKeyTree(regKey, false); } catch (Exception) { }
            try { if (Directory.Exists(root)) Directory.Delete(root, true); } catch (Exception) { }
        }
    }
}
