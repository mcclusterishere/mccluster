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
    // Self-contained per-user installer and uninstaller for EquityNet (published by McCluster Corp), built with the
    // in-box compiler so the installer is reproducible wherever the app is. It mirrors
    // package/mccluster.nsi: user scope, %LOCALAPPDATA%\McClusterDesktop\App, a Start Menu
    // shortcut, an HKCU uninstall entry, no admin, no services, no startup task. The payload is an
    // embedded zip with a manifest of SHA-256 hashes and sizes; every file is verified before it is
    // written. The same executable, copied as Uninstall.exe, removes exactly what its receipt lists,
    // and only from a per-user location.
    internal sealed class InstallerFile
    {
        public string Name;
        public string Sha256;
        public long Size;
    }

    internal sealed class InstallerManifest
    {
        public string Schema = "mccluster-install-manifest/1";
        public string Product = "EquityNet";
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

        // Tests read a foreign Setup.exe's manifest; the installer itself reads its own resource.
        public static InstallerManifest ReadEmbedded(string exePath)
        {
            try
            {
                using (ZipArchive zip = new ZipArchive(Assembly.LoadFile(exePath).GetManifestResourceStream("payload.zip"), ZipArchiveMode.Read))
                {
                    ZipArchiveEntry entry = zip.GetEntry("manifest.json");
                    if (entry == null) return null;
                    using (var reader = new StreamReader(entry.Open(), Encoding.UTF8)) return Parse(reader.ReadToEnd());
                }
            }
            catch (Exception) { return null; }
        }

        public static ZipArchive OpenOwnPayload()
        {
            Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip");
            if (stream == null) throw new FileNotFoundException("The setup carries no payload.zip resource.");
            return new ZipArchive(stream, ZipArchiveMode.Read);
        }
    }

    internal static class SetupProgram
    {
        // Compatibility: the uninstall key, the install folder (%LOCALAPPDATA%\McClusterDesktop\App) and
        // McCluster.exe keep their pre-rename names so an EquityNet setup upgrades an existing install in place.
        private const string DefaultRegistryKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\McClusterDesktop";
        internal const string ShortcutName = "EquityNet.lnk";
        internal const string LegacyShortcutName = "McCluster Desktop.lnk";
        private const string AllowedRegistryPrefix = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\";
        private const long MaxEntryBytes = 256L * 1024 * 1024;
        private static readonly HashSet<string> ReservedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9" };

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
                if (!InsideUserProfile(root))
                {
                    Report(silent, "EquityNet installs per user only. Refusing to touch a folder outside your user profile: " + root, MessageBoxIcon.Warning);
                    return 3;
                }
                if (uninstall) return Uninstall(root, startMenu, registryKey, silent);
                return Install(exe, root, startMenu, registryKey, silent);
            }
            catch (Exception ex)
            {
                Report(silent, ex.Message, MessageBoxIcon.Error);
                return 1;
            }
        }

        private static void Report(bool silent, string message, MessageBoxIcon icon)
        {
            if (!silent) MessageBox.Show(message, "EquityNet setup", MessageBoxButtons.OK, icon);
            else Console.Error.WriteLine(message);
        }

        private static bool InsideUserProfile(string path)
        {
            string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile).TrimEnd('\\') + "\\";
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData).TrimEnd('\\') + "\\";
            string full = Path.GetFullPath(path).TrimEnd('\\') + "\\";
            return full.StartsWith(profile, StringComparison.OrdinalIgnoreCase) || full.StartsWith(local, StringComparison.OrdinalIgnoreCase);
        }

        // Keys this installer may create or delete: the per-user uninstall hive, or the throwaway hive
        // the installer tests use (never a Run key, never anything outside Software).
        private static bool AllowedRegistryKey(string key)
        {
            if (string.IsNullOrWhiteSpace(key) || key.Contains("..")) return false;
            string trimmed = key.TrimEnd('\\');
            if (trimmed.Length <= AllowedRegistryPrefix.Length && trimmed.StartsWith(AllowedRegistryPrefix.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) return false; // the hive itself, never
            return trimmed.StartsWith(AllowedRegistryPrefix, StringComparison.OrdinalIgnoreCase) || trimmed.StartsWith(@"Software\McClusterDesktopInstallerTest\", StringComparison.OrdinalIgnoreCase);
        }

        private static bool SafeFileName(string name)
        {
            if (string.IsNullOrWhiteSpace(name) || name == "." || name == "..") return false;
            if (name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) return false;
            if (!string.Equals(Path.GetFileName(name), name, StringComparison.Ordinal)) return false;
            string stem = Path.GetFileNameWithoutExtension(name);
            return !ReservedNames.Contains(stem);
        }

        private static int Install(string exe, string root, string startMenu, string registryKey, bool silent)
        {
            if (!AllowedRegistryKey(registryKey))
                throw new ArgumentException("The uninstall registry key must live under HKCU\\" + AllowedRegistryPrefix);
            InstallerManifest manifest;
            using (ZipArchive zip = InstallerManifest.OpenOwnPayload())
            {
                ZipArchiveEntry manifestEntry = zip.GetEntry("manifest.json");
                if (manifestEntry == null) throw new InvalidDataException("payload has no manifest.json");
                using (var reader = new StreamReader(manifestEntry.Open(), Encoding.UTF8)) manifest = InstallerManifest.Parse(reader.ReadToEnd());
                if (!silent)
                {
                    DialogResult answer = MessageBox.Show("Install EquityNet " + manifest.Version + " for the current user?\n\nFolder: " + root + "\nAdds a Start Menu shortcut. No administrator rights, no services, no startup task. The app opens the live site; it does not enrol this computer as a worker.",
                        "Install EquityNet", MessageBoxButtons.OKCancel, MessageBoxIcon.Question);
                    if (answer != DialogResult.OK) return 2;
                }
                Directory.CreateDirectory(root);
                var written = new List<string>();
                foreach (InstallerFile file in manifest.Files)
                {
                    if (!SafeFileName(file.Name)) throw new InvalidDataException("manifest names an unsafe path: " + file.Name);
                    ZipArchiveEntry entry = zip.GetEntry(file.Name);
                    if (entry == null) throw new FileNotFoundException("payload lacks " + file.Name);
                    if (entry.Length > MaxEntryBytes || entry.Length != file.Size) throw new InvalidDataException("payload size mismatch for " + file.Name);
                    byte[] bytes;
                    using (Stream s = entry.Open()) using (var ms = new MemoryStream()) { s.CopyTo(ms); bytes = ms.ToArray(); }
                    if (bytes.LongLength != file.Size) throw new InvalidDataException("payload size mismatch for " + file.Name);
                    string hash;
                    using (var sha = SHA256.Create()) hash = Hex(sha.ComputeHash(bytes));
                    if (!string.Equals(hash, file.Sha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("payload hash mismatch for " + file.Name + "; the setup is damaged or altered");
                    File.WriteAllBytes(Path.Combine(root, file.Name), bytes);
                    written.Add(file.Name);
                }
                // The uninstaller is this very executable.
                File.Copy(exe, Path.Combine(root, "Uninstall.exe"), true);
                written.Add("Uninstall.exe");
                Directory.CreateDirectory(startMenu);
                string shortcut = Path.Combine(startMenu, ShortcutName);
                CreateShortcut(shortcut, Path.Combine(root, "McCluster.exe"), root);
                // Upgrade from a pre-rename install (0.4.0 and earlier): same folder and uninstall key,
                // only the Start Menu shortcut name changed, so the old one is removed here.
                string legacyShortcut = Path.Combine(startMenu, LegacyShortcutName);
                if (File.Exists(legacyShortcut)) File.Delete(legacyShortcut);
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(registryKey))
                {
                    key.SetValue("DisplayName", "EquityNet");
                    key.SetValue("Publisher", "McCluster Corp");
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
            if (!silent) MessageBox.Show("EquityNet " + manifest.Version + " is installed. Open it from the Start Menu.", "EquityNet setup", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }

        private static int Uninstall(string root, string startMenu, string registryKey, bool silent)
        {
            string receiptPath = Path.Combine(root, "install-receipt.json");
            if (!File.Exists(receiptPath)) throw new FileNotFoundException("No install receipt in " + root + "; nothing is removed without one.");
            object receipt = Json.Parse(File.ReadAllText(receiptPath));
            if (!silent)
            {
                if (MessageBox.Show("Remove EquityNet from " + root + "? Your WebView2 profile, local jobs, receipts and device keys under McClusterDesktop are kept.", "Uninstall EquityNet", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return 2;
            }
            // The receipt is data written by an earlier run; every path and key it names is checked
            // against what this uninstaller is allowed to remove before it is used.
            // The shortcut: only a .lnk inside this user's profile, else the default location.
            string shortcut = Json.Str(receipt, "start_menu_shortcut");
            if (shortcut == null || !shortcut.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase) || !InsideUserProfile(shortcut))
                shortcut = Path.Combine(startMenu, ShortcutName);
            // The registry key: only one this installer could have written (the uninstall hive or the test hive).
            string regFromReceipt = Json.Str(receipt, "registry_key");
            if (regFromReceipt != null && regFromReceipt.StartsWith("HKCU\\", StringComparison.OrdinalIgnoreCase))
            {
                string candidate = regFromReceipt.Substring(5);
                if (AllowedRegistryKey(candidate)) registryKey = candidate;
            }
            if (!AllowedRegistryKey(registryKey)) throw new ArgumentException("Refusing to remove registry key HKCU\\" + registryKey);
            System.Collections.IList files = Json.List(receipt, "files");
            string self = Process.GetCurrentProcess().MainModule.FileName;
            var deferred = new List<string>();
            if (files != null)
                foreach (object f in files)
                {
                    string name = Convert.ToString(f);
                    if (!SafeFileName(name)) continue;
                    string path = Path.Combine(root, name);
                    if (string.Equals(Path.GetFullPath(path), Path.GetFullPath(self), StringComparison.OrdinalIgnoreCase)) { deferred.Add(path); continue; }
                    if (File.Exists(path)) File.Delete(path);
                }
            if (File.Exists(shortcut)) File.Delete(shortcut);
            // A receipt written before the rename names the old shortcut; also clear whichever is left.
            foreach (string name in new[] { ShortcutName, LegacyShortcutName })
            {
                string candidate = Path.Combine(startMenu, name);
                if (File.Exists(candidate)) File.Delete(candidate);
            }
            try { Registry.CurrentUser.DeleteSubKeyTree(registryKey, false); } catch (Exception) { }
            File.Delete(receiptPath);
            // Remove ourselves after exit through a script file (paths never go on a command line),
            // then the folder only if it is empty.
            foreach (string path in deferred)
            {
                string script = Path.Combine(Path.GetTempPath(), "mccluster-uninstall-" + Guid.NewGuid().ToString("N") + ".cmd");
                File.WriteAllText(script, "@echo off\r\nping 127.0.0.1 -n 3 >nul\r\ndel /q \"" + path + "\"\r\nrmdir \"" + root + "\" 2>nul\r\ndel /q \"%~f0\"\r\n", Encoding.Default);
                Process.Start(new ProcessStartInfo("cmd.exe", "/c \"" + script + "\"") { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden });
            }
            if (deferred.Count == 0) { try { if (Directory.GetFileSystemEntries(root).Length == 0) Directory.Delete(root); } catch (Exception) { } }
            if (!silent) MessageBox.Show("EquityNet was removed.", "Uninstall EquityNet", MessageBoxButtons.OK, MessageBoxIcon.Information);
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
            linkType.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { "EquityNet by McCluster Corp" });
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
