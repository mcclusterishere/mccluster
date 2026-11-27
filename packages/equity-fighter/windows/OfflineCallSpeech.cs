using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace McClusterDesktop
{
    // Both engines consume local data. The authenticated pack is an optional, per-user install.
    internal sealed class OfflineCallSpeech : ICallSpeech, IDisposable
    {
        private const string PackDigest = "6980b9e730cb99f80a68eadbc60df3f9ad73993811abb84fa1a437f44c45c09e";
        private const string Voice = "en_US-ljspeech-medium.onnx";
        private const string Recognition = "vosk-model-small-en-us-0.15";
        private const int MaxFiles = 383;
        private const int VoiceRate = 22050;
        private readonly object sync = new object();
        private readonly List<FileStream> pinned = new List<FileStream>();
        private readonly string root;
        private List<string> verifiedNames;
        private bool disposed;
        private Vosk recognizer;
        private string validationError;

        internal OfflineCallSpeech()
        {
            string configured = Environment.GetEnvironmentVariable("MCCLUSTER_VOICE_PACK");
            if (String.IsNullOrWhiteSpace(configured))
                configured = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "McClusterDesktop", "voice");
            try
            {
                // Exclude network/device paths and relative path expansion.
                if (configured.Length >= 3 && Char.IsLetter(configured[0]) && configured[1] == ':' &&
                    (configured[2] == '\\' || configured[2] == '/') &&
                    new DriveInfo(configured.Substring(0, 3)).DriveType == DriveType.Fixed)
                    root = Path.GetFullPath(configured).TrimEnd(Path.DirectorySeparatorChar);
            }
            catch (Exception) { }
        }

        public string UnavailableReason
        {
            get
            {
                lock (sync)
                {
                    if (disposed) return "The local speech engine is closed.";
                    if (IntPtr.Size != 8) return "The offline voice pack requires the x64 EquityNet client.";
                    if (root == null || !File.Exists(Path.Combine(root, Voice)))
                        return "Install the offline English voice pack on this device to start a call.";
                    if (pinned.Count != 0 || validationError != null) return validationError;
                    try { VerifyPack(); }
                    catch (Exception)
                    {
                        Unpin();
                        validationError = "The offline voice pack failed its integrity check. Restore the verified pack and reopen chat.";
                    }
                    return validationError;
                }
            }
        }

        private static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }

        private void Collect(string directory, List<string> names, int depth, ref int directories)
        {
            if (++directories > 47 || depth > 12 || (File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException();
            foreach (string path in Directory.EnumerateFileSystemEntries(directory))
            {
                FileAttributes flags = File.GetAttributes(path);
                if ((flags & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException();
                if ((flags & FileAttributes.Directory) != 0) Collect(path, names, depth + 1, ref directories);
                else
                {
                    if (names.Count >= MaxFiles) throw new InvalidDataException();
                    names.Add(path.Substring(root.Length + 1).Replace('\\', '/'));
                }
            }
        }

        private List<string> Inventory()
        {
            for (DirectoryInfo d = new DirectoryInfo(root); d != null; d = d.Parent)
                if ((d.Attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException();
            var names = new List<string>();
            int directories = 0;
            Collect(root, names, 0, ref directories);
            if (names.Count != MaxFiles) throw new InvalidDataException();
            names.Sort(StringComparer.Ordinal);
            return names;
        }

        private void VerifyPack()
        {
            List<string> names = Inventory();
            var manifest = new StringBuilder();
            using (SHA256 sha = SHA256.Create())
            {
                long bytes = 0;
                foreach (string name in names)
                {
                    // Read sharing keeps verified content immutable while a native engine uses it.
                    var file = new FileStream(Path.Combine(root, name), FileMode.Open, FileAccess.Read, FileShare.Read);
                    pinned.Add(file);
                    bytes += file.Length;
                    if (bytes > 320000000) throw new InvalidDataException();
                    manifest.Append(Hex(sha.ComputeHash(file))).Append("  ").Append(name).Append('\n');
                }
                if (Hex(sha.ComputeHash(Encoding.UTF8.GetBytes(manifest.ToString()))) != PackDigest)
                    throw new InvalidDataException();
                verifiedNames = names;
            }
        }

        private void CheckRuntimeFiles()
        {
            // New files may be dropped next to a verified DLL after first use. Existing files
            // are still pinned against writes/deletion. Check the directory shape before loading code.
            List<string> names = Inventory();
            for (int i = 0; i < names.Count; i++)
                if (!String.Equals(names[i], verifiedNames[i], StringComparison.Ordinal)) throw new InvalidDataException();
        }

        private void RequireReady()
        {
            string reason = UnavailableReason;
            if (reason != null) throw new InvalidOperationException(reason);
        }

        public Task<string> TranscribeAsync(short[] pcm16Mono16k, CancellationToken cancellation)
        {
            if (pcm16Mono16k == null || pcm16Mono16k.Length == 0 || pcm16Mono16k.Length > 16000 * 120)
                throw new ArgumentException("Voice recognition accepts up to two minutes of mono PCM.");
            return Task.Run(delegate
            {
                lock (sync)
                {
                    cancellation.ThrowIfCancellationRequested();
                    RequireReady();
                    if (recognizer == null)
                    {
                        CheckRuntimeFiles();
                        recognizer = new Vosk(root, Recognition);
                    }
                    return recognizer.Read(pcm16Mono16k, cancellation);
                }
            }, cancellation);
        }

        public Task<CallPcm> SynthesizeAsync(string reply, CancellationToken cancellation)
        {
            if (String.IsNullOrWhiteSpace(reply) || reply.Length > 3200)
                throw new ArgumentException("The reply exceeds the offline voice limit or is empty.");
            return Task.Run(delegate
            {
                lock (sync)
                {
                    cancellation.ThrowIfCancellationRequested();
                    RequireReady();
                    CheckRuntimeFiles();
                    return Speak(reply, cancellation);
                }
            }, cancellation);
        }

        private CallPcm Speak(string reply, CancellationToken cancellation)
        {
            string piper = Path.Combine(root, "piper");
            // The fixed child binary reads one plain-text line. No user input becomes process arguments.
            var start = new ProcessStartInfo(Path.Combine(piper, "piper.exe"),
                "--quiet --output_raw --model \"" + Path.Combine(root, Voice) + "\" --espeak_data \"" + Path.Combine(piper, "espeak-ng-data") + "\"");
            start.WorkingDirectory = piper;
            start.CreateNoWindow = true;
            start.UseShellExecute = false;
            start.RedirectStandardInput = start.RedirectStandardOutput = start.RedirectStandardError = true;
            start.EnvironmentVariables.Clear();
            start.EnvironmentVariables["SystemRoot"] = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            start.EnvironmentVariables["PATH"] = Environment.SystemDirectory;
            using (var child = new Process { StartInfo = start })
            using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation))
            using (var buffer = new MemoryStream())
            {
                deadline.CancelAfter(TimeSpan.FromSeconds(45));
                if (!child.Start()) throw new InvalidOperationException("Local speech synthesis could not start.");
                using (deadline.Token.Register(delegate { try { if (!child.HasExited) child.Kill(); } catch (InvalidOperationException) { } }))
                {
                    try
                    {
                        Task errors = child.StandardError.BaseStream.CopyToAsync(Stream.Null);
                        var line = new StringBuilder(reply.Length + 1);
                        foreach (char c in reply) line.Append(Char.IsControl(c) ? ' ' : c);
                        line.Append('\n');
                        byte[] message = Encoding.UTF8.GetBytes(line.ToString());
                        child.StandardInput.BaseStream.Write(message, 0, message.Length);
                        child.StandardInput.Close();
                        var block = new byte[16384];
                        try
                        {
                            int n;
                            while ((n = child.StandardOutput.BaseStream.Read(block, 0, block.Length)) != 0)
                            {
                                deadline.Token.ThrowIfCancellationRequested();
                                if (buffer.Length + n > VoiceRate * 120 * 2)
                                    throw new InvalidDataException("The spoken reply exceeds two minutes.");
                                buffer.Write(block, 0, n);
                            }
                        }
                        finally { Array.Clear(block, 0, block.Length); }
                        if (!child.WaitForExit(3000) || !errors.Wait(3000)) throw new TimeoutException("Local speech synthesis timed out.");
                        deadline.Token.ThrowIfCancellationRequested();
                        if (child.ExitCode != 0 || buffer.Length == 0 || buffer.Length % 2 != 0)
                            throw new InvalidOperationException("The local voice produced no usable audio.");
                        var samples = new short[buffer.Length / 2];
                        Buffer.BlockCopy(buffer.GetBuffer(), 0, samples, 0, (int)buffer.Length);
                        return new CallPcm(samples, VoiceRate);
                    }
                    catch (Exception)
                    {
                        cancellation.ThrowIfCancellationRequested();
                        if (deadline.IsCancellationRequested) throw new TimeoutException("Local speech synthesis timed out.");
                        throw;
                    }
                    finally
                    {
                        try { if (!child.HasExited) { child.Kill(); child.WaitForExit(3000); } } catch (InvalidOperationException) { }
                        Array.Clear(buffer.GetBuffer(), 0, (int)buffer.Length);
                    }
                }
            }
        }

        private void Unpin() { foreach (FileStream file in pinned) file.Dispose(); pinned.Clear(); }
        public void Dispose()
        {
            lock (sync)
            {
                disposed = true;
                if (recognizer != null) { recognizer.Dispose(); recognizer = null; }
                Unpin();
            }
        }

        private sealed class Vosk : IDisposable
        {
            [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
            [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true)] private static extern IntPtr GetProcAddress(IntPtr library, string name);
            [DllImport("kernel32.dll")] private static extern bool FreeLibrary(IntPtr library);
            [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void LogLevel(int level);
            [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr ModelNew(byte[] path);
            [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr RecNew(IntPtr model, float rate);
            [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void Release(IntPtr pointer);
            [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int Accept(IntPtr rec, IntPtr samples, int count);
            [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr Result(IntPtr rec);
            private IntPtr library, model;
            private readonly RecNew create;
            private readonly Release freeModel, freeRec;
            private readonly Result result, final;
            private readonly Accept accept;
            private T Export<T>(string symbol) where T : class
            {
                IntPtr function = GetProcAddress(library, symbol);
                if (function == IntPtr.Zero) throw new EntryPointNotFoundException("The local recognition runtime is incomplete.");
                return (T)(object)Marshal.GetDelegateForFunctionPointer(function, typeof(T));
            }

            internal Vosk(string root, string name)
            {
                // Only dependencies next to this authenticated DLL or in System32 are eligible.
                library = LoadLibraryEx(Path.Combine(root, "vosk-win64-0.3.45", "libvosk.dll"), IntPtr.Zero, 0x100 | 0x800);
                if (library == IntPtr.Zero) throw new InvalidOperationException("The verified local recognition runtime could not load.");
                try
                {
                    Export<LogLevel>("vosk_set_log_level")(-1);
                    freeModel = Export<Release>("vosk_model_free");
                    freeRec = Export<Release>("vosk_recognizer_free");
                    create = Export<RecNew>("vosk_recognizer_new");
                    accept = Export<Accept>("vosk_recognizer_accept_waveform_s");
                    result = Export<Result>("vosk_recognizer_result");
                    final = Export<Result>("vosk_recognizer_final_result");
                    model = Export<ModelNew>("vosk_model_new")(Encoding.UTF8.GetBytes(Path.Combine(root, name) + "\0"));
                    if (model == IntPtr.Zero) throw new InvalidOperationException("The offline recognition model could not load.");
                }
                catch { Dispose(); throw; }
            }

            private static void AppendText(StringBuilder text, IntPtr pointer)
            {
                if (pointer == IntPtr.Zero) throw new InvalidDataException();
                int count = 0;
                while (count < 65536 && Marshal.ReadByte(pointer, count) != 0) count++;
                if (count == 65536) throw new InvalidDataException();
                var utf8 = new byte[count];
                Marshal.Copy(pointer, utf8, 0, count);
                var dict = Json.Parse(Encoding.UTF8.GetString(utf8)) as IDictionary<string, object>;
                object value;
                if (dict != null && dict.TryGetValue("text", out value) && value is string && ((string)value).Length != 0)
                {
                    if (text.Length != 0) text.Append(' ');
                    text.Append((string)value);
                }
            }

            internal string Read(short[] pcm, CancellationToken cancelled)
            {
                cancelled.ThrowIfCancellationRequested();
                IntPtr rec = create(model, 16000);
                if (rec == IntPtr.Zero) throw new InvalidOperationException("Local voice recognition could not start.");
                var handle = GCHandle.Alloc(pcm, GCHandleType.Pinned);
                try
                {
                    var text = new StringBuilder();
                    for (int i = 0; i < pcm.Length; i += 1600)
                    {
                        cancelled.ThrowIfCancellationRequested();
                        int status = accept(rec, IntPtr.Add(handle.AddrOfPinnedObject(), i * 2), Math.Min(1600, pcm.Length - i));
                        if (status < 0) throw new InvalidOperationException("Local voice recognition failed.");
                        if (status == 1) AppendText(text, result(rec));
                    }
                    cancelled.ThrowIfCancellationRequested();
                    AppendText(text, final(rec));
                    return text.ToString().Trim();
                }
                finally { handle.Free(); freeRec(rec); }
            }

            public void Dispose()
            {
                if (model != IntPtr.Zero) { freeModel(model); model = IntPtr.Zero; }
                if (library != IntPtr.Zero) { FreeLibrary(library); library = IntPtr.Zero; }
            }
        }
    }
}
