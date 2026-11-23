using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

namespace McClusterDesktop
{
    // Self-contained per-user installer and uninstaller for McCluster for Windows, built with the
    // in-box compiler so the installer is reproducible wherever the app is. It mirrors
    // package/mccluster.nsi exactly: user scope, %LOCALAPPDATA%\McClusterDesktop\App, a Start Menu
    // shortcut, an HKCU uninstall entry, no admin, no services, no startup task. The payload is an
    // embedded zip with a manifest of SHA-256 hashes; every file is verified before it is written.
    // The same executable, copied as Uninstall.exe, removes exactly what its receipt lists.
    internal sealed class InstallerFile
    {
        public string Name;
        public string Sha256;
        public long Size;
    }

    internal sealed class InstallerManifest
    {
        public string Schema = "mccluster-install-manifest/1";
        public string Product = "McCluster";
        public string Version = "0.0.0";
        public string SourceCommit;
        public List<InstallerFile> Files = new List<InstallerFile>();

        public static InstallerManifest Parse(string text)
        {
            object parsed = Json.Parse(text);
            var m = new InstallerManifest();
            m.Schema = Json.Str(parsed, "schema") ?? m.Schema;
            m.Product = Json.Str(parsed, "product") ?? m.Product;
            m.Version = Json.Str(parsed, "version") ?? m.Version;
            m.SourceCommit = Json.Str(parsed, "source_commit");
            System.Collections.IList files = Json.List(parsed, "files");
            if (files != null)
                foreach (object f in files)
                    m.Files.Add(new InstallerFile { Name = Json.Str(f, "name"), Sha256 = Json.Str(f, "sha256"), Size = (long)Json.Num(f, "size") });
            return m;
        }

        public static InstallerManifest ReadEmbedded(string exePath)
        {
            try
            {
                using (ZipArchive zip = OpenPayload(exePath))
                {
                    ZipArchiveEntry entry = zip.GetEntry("manifest.json");
                    if (entry == null) return null;
                    using (var reader = new StreamReader(entry.Open(), Encoding.UTF8)) return Parse(reader.ReadToEnd());
                }
            }
            catch (Exception) { return null; }
        }

        // The payload zip is an embedded resource of the setup executable.
        public static ZipArchive OpenPayload(string exePath)
        {
            Assembly assembly = Assembly.LoadFile(exePath);
            Stream stream = assembly.GetManifestResourceStream("payload.zip");
            if (stream == null) throw new FileNotFoundException("The setup carries no payload.zip resource.");
            return new ZipArchive(stream, ZipArchiveMode.Read);
        }
    }

    internal static class SetupProgram
    {
        private const string DefaultRegistryKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\McClusterDesktop";

        [STAThread]
        private static int Main(string[] args)
        {
            var options = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < args.Length; i++)
            {
                if (!args[i].StartsWith("--", StringComparison.Ordinal)) continue;
                string key = args[i].Substring(2);
                string value = (i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal)) ? args[++i] : "true";
                options[key] = value;
            }
            bool silent = options.ContainsKey("silent");
            string exe = Process.GetCurrentProcess().MainModule.FileName;
            bool uninstall = options.ContainsKey("uninstall") || string.Equals(Path.GetFileName(exe), "Uninstall.exe", StringComparison.OrdinalIgnoreCase);
            string root = options.ContainsKey("root") ? Path.GetFullPath(options["root"]) : (uninstall ? Path.GetDirectoryName(exe) : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "McClusterDesktop", "App"));
            string startMenu = options.ContainsKey("start-menu") ? Path.GetFullPath(options["start-menu"]) : Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            string registryKey = options.ContainsKey("registry-key") ? options["registry-key"] : DefaultRegistryKey;
            try
            {
                if (uninstall) return Uninstall(root, startMenu, registryKey, silent);
                return Install(exe, root, startMenu, registryKey, silent);
            }
            catch (Exception ex)
            {
                if (!silent) MessageBox.Show(ex.Message, "McCluster setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
                else Console.Error.WriteLine(ex.Message);
                return 1;
            }
        }

        private static bool InsideUserProfile(string path)
        {
            string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile).TrimEnd('\\') + "\\";
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData).TrimEnd('\\') + "\\";
            string full = Path.GetFullPath(path).TrimEnd('\\') + "\\";
            return full.StartsWith(profile, StringComparison.OrdinalIgnoreCase) || full.StartsWith(local, StringComparison.OrdinalIgnoreCase);
        }

        private static int Install(string exe, string root, string startMenu, string registryKey, bool silent)
        {
            // Per-user only: never outside the profile, never a protected system path.
            if (!InsideUserProfile(root))
            {
                string msg = "McCluster installs per user only. Refusing to install outside your user profile: " + root;
                if (!silent) MessageBox.Show(msg, "McCluster setup", MessageBoxButtons.OK, MessageBoxIcon.Warning); else Console.Error.WriteLine(msg);
                return 3;
            }
            InstallerManifest manifest;
            using (ZipArchive zip = InstallerManifest.OpenPayload(exe))
            {
                ZipArchiveEntry manifestEntry = zip.GetEntry("manifest.json");
                if (manifestEntry == null) throw new InvalidDataException("payload has no manifest.json");
                using (var reader = new StreamReader(manifestEntry.Open(), Encoding.UTF8)) manifest = InstallerManifest.Parse(reader.ReadToEnd());
                if (!silent)
                {
                    DialogResult answer = MessageBox.Show("Install McCluster for Windows " + manifest.Version + " for the current user?\n\nFolder: " + root + "\nAdds a Start Menu shortcut. No administrator rights, no services, no startup task. The app opens the live site; it does not enrol this computer as a worker.",
                        "Install McCluster", MessageBoxButtons.OKCancel, MessageBoxIcon.Question);
                    if (answer != DialogResult.OK) return 2;
                }
                Directory.CreateDirectory(root);
                var written = new List<string>();
                foreach (InstallerFile file in manifest.Files)
                {
                    if (file.Name.IndexOfAny(new[] { '\\', '/', ':' }) >= 0 || file.Name == "..") throw new InvalidDataException("manifest names an unsafe path: " + file.Name);
                    ZipArchiveEntry entry = zip.GetEntry(file.Name);
                    if (entry == null) throw new FileNotFoundException("payload lacks " + file.Name);
                    byte[] bytes;
                    using (Stream s = entry.Open()) using (var ms = new MemoryStream()) { s.CopyTo(ms); bytes = ms.ToArray(); }
                    string hash = Hex(SHA256.Create().ComputeHash(bytes));
                    if (!string.Equals(hash, file.Sha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("payload hash mismatch for " + file.Name + "; the setup is damaged or altered");
                    string target = Path.Combine(root, file.Name);
                    File.WriteAllBytes(target, bytes);
                    written.Add(file.Name);
                }
                // The uninstaller is this very executable.
                File.Copy(exe, Path.Combine(root, "Uninstall.exe"), true);
                written.Add("Uninstall.exe");
                Directory.CreateDirectory(startMenu);
                string shortcut = Path.Combine(startMenu, "McCluster Desktop.lnk");
                CreateShortcut(shortcut, Path.Combine(root, "McCluster.exe"), root);
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(registryKey))
                {
                    key.SetValue("DisplayName", "McCluster");
                    key.SetValue("DisplayVersion", manifest.Version);
                    key.SetValue("DisplayIcon", Path.Combine(root, "McCluster.exe"));
                    key.SetValue("UninstallString", "\"" + Path.Combine(root, "Uninstall.exe") + "\"");
                    key.SetValue("InstallLocation", root);
                    key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                }
                var receipt = new Dictionary<string, object>();
                receipt["schema"] = "mccluster-install-receipt/1";
                receipt["product"] = manifest.Product;
                receipt["version"] = manifest.Version;
                receipt["source_commit"] = manifest.SourceCommit;
                receipt["installed_at"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
                receipt["root"] = root;
                receipt["start_menu_shortcut"] = shortcut;
                receipt["registry_key"] = "HKCU\\" + registryKey;
                receipt["files"] = written;
                var hashes = new Dictionary<string, object>();
                foreach (InstallerFile f in manifest.Files) hashes[f.Name] = f.Sha256;
                receipt["sha256"] = hashes;
                File.WriteAllText(Path.Combine(root, "install-receipt.json"), Json.Pretty(receipt), new UTF8Encoding(false));
            }
            if (!silent) MessageBox.Show("McCluster " + manifest.Version + " is installed. Open it from the Start Menu.", "McCluster setup", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }

        private static int Uninstall(string root, string startMenu, string registryKey, bool silent)
        {
            string receiptPath = Path.Combine(root, "install-receipt.json");
            if (!File.Exists(receiptPath)) throw new FileNotFoundException("No install receipt in " + root + "; nothing is removed without one.");
            object receipt = Json.Parse(File.ReadAllText(receiptPath));
            if (!silent)
            {
                if (MessageBox.Show("Remove McCluster from " + root + "? Your WebView2 profile, local jobs and receipts under McClusterDesktop are kept.", "Uninstall McCluster", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return 2;
            }
            string shortcut = Json.Str(receipt, "start_menu_shortcut") ?? Path.Combine(startMenu, "McCluster Desktop.lnk");
            string regFromReceipt = Json.Str(receipt, "registry_key");
            if (regFromReceipt != null && regFromReceipt.StartsWith("HKCU\\")) registryKey = regFromReceipt.Substring(5);
            System.Collections.IList files = Json.List(receipt, "files");
            string self = Process.GetCurrentProcess().MainModule.FileName;
            var deferred = new List<string>();
            if (files != null)
                foreach (object f in files)
                {
                    string name = Convert.ToString(f);
                    if (name.IndexOfAny(new[] { '\\', '/', ':' }) >= 0) continue;
                    string path = Path.Combine(root, name);
                    if (string.Equals(Path.GetFullPath(path), Path.GetFullPath(self), StringComparison.OrdinalIgnoreCase)) { deferred.Add(path); continue; }
                    if (File.Exists(path)) File.Delete(path);
                }
            if (File.Exists(shortcut)) File.Delete(shortcut);
            try { Registry.CurrentUser.DeleteSubKeyTree(registryKey, false); } catch (Exception) { }
            File.Delete(receiptPath);
            // Remove ourselves after exit, then the folder only if it is empty.
            foreach (string path in deferred)
            {
                string script = "ping 127.0.0.1 -n 2 >nul & del /q \"" + path + "\" & rmdir \"" + root + "\" 2>nul";
                Process.Start(new ProcessStartInfo("cmd.exe", "/c " + script) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden });
            }
            if (deferred.Count == 0) { try { if (Directory.GetFileSystemEntries(root).Length == 0) Directory.Delete(root); } catch (Exception) { } }
            if (!silent) MessageBox.Show("McCluster was removed.", "Uninstall McCluster", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }

        // Windows Script Host shortcut, through late binding, so no COM interop assembly is needed.
        private static void CreateShortcut(string shortcutPath, string target, string workingDirectory)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            object link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
            Type linkType = link.GetType();
            linkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { target });
            linkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { workingDirectory });
            linkType.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { "McCluster for Windows" });
            linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
        }

        private static string Hex(byte[] data)
        {
            var sb = new StringBuilder(data.Length * 2);
            foreach (byte b in data) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }
    }
}
