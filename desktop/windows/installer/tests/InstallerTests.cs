using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using Microsoft.Win32;
using McClusterDesktop;

// Written before the installer. These tests drive the real Setup.exe (with its embedded
// payload) into a throwaway per-user root, a throwaway Start Menu folder and a throwaway HKCU
// key, then drive its uninstaller, and assert the machine is left exactly as it was.
// Nothing here touches %LOCALAPPDATA%\McClusterDesktop\App or the real uninstall key.
internal static class InstallerTests
{
    private static int checks;
    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception("FAILED: " + message);
        checks++;
    }

    private sealed class RunResult { public int ExitCode; public string StdErr; public string StdOut; }

    private static RunResult Run(string exe, string args, int timeoutMs)
    {
        var psi = new ProcessStartInfo(exe, args) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true };
        using (Process p = Process.Start(psi))
        {
            string err = p.StandardError.ReadToEnd();
            string outText = p.StandardOutput.ReadToEnd();
            if (!p.WaitForExit(timeoutMs)) { try { p.Kill(); } catch (Exception) { } throw new Exception("FAILED: " + Path.GetFileName(exe) + " did not exit in time"); }
            return new RunResult { ExitCode = p.ExitCode, StdErr = err, StdOut = outText };
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

    private static bool WaitUntil(Func<bool> condition, int timeoutMs)
    {
        DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline) { if (condition()) return true; Thread.Sleep(250); }
        return condition();
    }

    private static int Main(string[] args)
    {
        if (args.Length < 1) { Console.Error.WriteLine("usage: InstallerTests <path to Setup.exe>"); return 2; }
        string setup = Path.GetFullPath(args[0]);
        string staged = args.Length > 1 ? Path.GetFullPath(args[1]) : null;
        // Always a per-user location, so the installer's own profile check is not what is under test here.
        string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "McClusterDesktopInstallerTest", Guid.NewGuid().ToString("N"));
        string app = Path.Combine(root, "App");
        string startMenu = Path.Combine(root, "StartMenu");
        string regParent = @"Software\McClusterDesktopInstallerTest";
        string regKey = regParent + @"\" + Guid.NewGuid().ToString("N");
        string installArgs = "--silent --root \"" + app + "\" --start-menu \"" + startMenu + "\" --registry-key \"" + regKey + "\"";
        try
        {
            Assert(File.Exists(setup), "Setup.exe exists: " + setup);
            InstallerManifest manifest = InstallerManifest.ReadEmbedded(setup);
            string loadProblem = "";
            if (manifest == null) { try { System.Reflection.Assembly.LoadFile(setup); } catch (Exception ex) { loadProblem = " (loading the candidate failed: " + ex.GetType().Name + ": " + ex.Message.Trim() + "; an Application Control policy blocking a fresh unsigned binary looks like this)"; } }
            Assert(manifest != null, "setup carries an embedded manifest" + loadProblem);
            Assert(manifest.Files.Count >= 4, "manifest lists the app and the three WebView2 files");
            Assert(manifest.Files.Exists(f => f.Name == "McCluster.exe"), "manifest names McCluster.exe");
            Assert(manifest.Version.Length > 0 && manifest.Version != "0.0.0", "manifest carries a version");

            // Silent install into the throwaway root.
            RunResult r = Run(setup, installArgs, 120000);
            Assert(r.ExitCode == 0, "install exits 0 (was " + r.ExitCode + "; stderr: " + r.StdErr.Trim() + ")");
            foreach (InstallerFile f in manifest.Files)
            {
                string path = Path.Combine(app, f.Name);
                Assert(File.Exists(path), "installed: " + f.Name);
                Assert(string.Equals(Sha256(path), f.Sha256, StringComparison.OrdinalIgnoreCase), "hash matches manifest: " + f.Name);
                if (staged != null) Assert(string.Equals(Sha256(path), Sha256(Path.Combine(staged, f.Name)), StringComparison.OrdinalIgnoreCase), "installed bytes match staged bytes: " + f.Name);
                Assert(new FileInfo(path).Length == f.Size, "size matches manifest: " + f.Name);
            }
            Assert(File.Exists(Path.Combine(app, "Uninstall.exe")), "uninstaller written");
            Assert(string.Equals(Sha256(Path.Combine(app, "Uninstall.exe")), Sha256(setup), StringComparison.OrdinalIgnoreCase), "installed uninstaller preserves the outer setup bytes");
            string receiptPath = Path.Combine(app, "install-receipt.json");
            Assert(File.Exists(receiptPath), "install receipt written");
            object receipt = Json.Parse(File.ReadAllText(receiptPath));
            Assert(Json.Str(receipt, "schema") == "mccluster-install-receipt/1", "receipt schema");
            Assert(Json.Str(receipt, "version") == manifest.Version, "receipt version");
            Assert(string.Equals(Json.Str(receipt, "root").TrimEnd('\\'), app.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase), "receipt records the install root");
            var receiptFiles = new List<string>();
            foreach (object o in Json.List(receipt, "files")) receiptFiles.Add(Convert.ToString(o));
            Assert(receiptFiles.Contains("Uninstall.exe"), "receipt lists Uninstall.exe (the uninstaller's self-removal depends on it)");
            foreach (InstallerFile f in manifest.Files) Assert(receiptFiles.Contains(f.Name), "receipt lists " + f.Name);
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
            r = Run(setup, installArgs, 120000);
            Assert(r.ExitCode == 0, "reinstall exits 0 (stderr: " + r.StdErr.Trim() + ")");
            foreach (InstallerFile f in manifest.Files) Assert(string.Equals(Sha256(Path.Combine(app, f.Name)), f.Sha256, StringComparison.OrdinalIgnoreCase), "hash still matches after reinstall: " + f.Name);

            // A foreign file in the app folder is never deleted by the uninstaller.
            string foreign = Path.Combine(app, "owner-note.txt");
            File.WriteAllText(foreign, "not ours");

            // Silent uninstall removes exactly what the receipt lists, including itself after exit.
            r = Run(Path.Combine(app, "Uninstall.exe"), "--silent --uninstall", 120000);
            Assert(r.ExitCode == 0, "uninstall exits 0 (was " + r.ExitCode + "; stderr: " + r.StdErr.Trim() + ")");
            foreach (InstallerFile f in manifest.Files) Assert(!File.Exists(Path.Combine(app, f.Name)), "removed: " + f.Name);
            Assert(!File.Exists(receiptPath), "receipt removed");
            Assert(!File.Exists(Path.Combine(startMenu, "McCluster Desktop.lnk")), "shortcut removed");
            Assert(Registry.CurrentUser.OpenSubKey(regKey) == null, "registry key removed");
            Assert(WaitUntil(() => !File.Exists(Path.Combine(app, "Uninstall.exe")), 15000), "uninstaller removed itself after exit");
            Assert(File.Exists(foreign), "foreign file kept");
            Assert(Directory.Exists(app), "folder kept because a foreign file remains");
            File.Delete(foreign);

            // A clean cycle without a foreign file leaves no folder behind.
            r = Run(setup, installArgs, 120000);
            Assert(r.ExitCode == 0, "second cycle install exits 0");
            r = Run(Path.Combine(app, "Uninstall.exe"), "--silent --uninstall", 120000);
            Assert(r.ExitCode == 0, "second cycle uninstall exits 0");
            Assert(WaitUntil(() => !Directory.Exists(app), 15000), "empty app folder removed after uninstall");

            // Refused unconditionally (exit 3): a root outside the user profile, for install and uninstall alike.
            string outside = @"C:\Windows\Temp\mccluster-refuse-" + Guid.NewGuid().ToString("N");
            r = Run(setup, "--silent --root \"" + outside + "\" --start-menu \"" + startMenu + "\" --registry-key \"" + regKey + "\"", 60000);
            Assert(r.ExitCode == 3, "install outside the user profile is refused with exit 3 (was " + r.ExitCode + ")");
            Assert(!Directory.Exists(outside), "nothing was written outside the profile");
            r = Run(setup, "--silent --uninstall --root \"" + outside + "\"", 60000);
            Assert(r.ExitCode == 3, "uninstall outside the user profile is refused with exit 3 (was " + r.ExitCode + ")");

            // A registry key outside the uninstall hive is refused.
            r = Run(setup, "--silent --root \"" + app + "\" --start-menu \"" + startMenu + "\" --registry-key \"Software\\Microsoft\\Windows\\CurrentVersion\\Run\"", 60000);
            Assert(r.ExitCode == 1 && !File.Exists(Path.Combine(app, "McCluster.exe")), "a registry key outside the uninstall hive is refused before anything is written");

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
            try { using (RegistryKey parent = Registry.CurrentUser.OpenSubKey(regParent)) if (parent != null && parent.SubKeyCount == 0 && parent.ValueCount == 0) Registry.CurrentUser.DeleteSubKey(regParent, false); } catch (Exception) { }
            try { if (Directory.Exists(root)) Directory.Delete(root, true); } catch (Exception) { }
        }
    }
}
