using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace McClusterDesktop
{
    // Local job store: one JSON file per job under %LOCALAPPDATA%\McClusterDesktop\jobs,
    // stable ids, reconnect-safe states, and a receipt that records what actually ran.
    // This is the device-side ledger for work that ran on THIS device. Work submitted
    // to the OVH Core is stored by the Core (ops_agent_jobs / ops_compute_tasks) and
    // shown by the site; the two ledgers are never merged.
    internal static class JobState
    {
        public const string Queued = "queued";
        public const string Running = "running";
        public const string Done = "done";
        public const string Failed = "failed";
        public const string Interrupted = "interrupted"; // found "running" with no live owner process at start-up
    }

    internal static class JobTarget
    {
        public const string LocalDevice = "local-device";        // this computer only
        public const string RemoteWorker = "remote-worker";      // one enrolled device through the OVH Core
        public const string VerifiedGroup = "verified-group";    // a verified shared-model group through the OVH Core
    }

    internal static class JobKind
    {
        public const string Inventory = "local.inventory"; // benign: hash the files of a sample folder
        public const string Chat = "ai.chat";              // local Ollama model on loopback
    }

    internal sealed class LocalJob
    {
        public string Id;
        public string Schema = "mccluster-desktop-job/1";
        public string Kind;
        public string Target;
        public string State;
        public string CreatedAt;
        public string UpdatedAt;
        public string StartedAt;
        public string FinishedAt;
        public int OwnerPid;
        public Dictionary<string, object> Input = new Dictionary<string, object>();
        public Dictionary<string, object> Result;
        public Dictionary<string, object> Receipt;
        public Dictionary<string, object> Progress;
        public string Error;

        public Dictionary<string, object> ToDictionary()
        {
            var d = new Dictionary<string, object>();
            d["schema"] = Schema;
            d["id"] = Id;
            d["kind"] = Kind;
            d["target"] = Target;
            d["state"] = State;
            d["created_at"] = CreatedAt;
            d["updated_at"] = UpdatedAt;
            d["started_at"] = StartedAt;
            d["finished_at"] = FinishedAt;
            d["owner_pid"] = OwnerPid;
            d["input"] = Input;
            d["progress"] = Progress;
            d["result"] = Result;
            d["receipt"] = Receipt;
            d["error"] = Error;
            return d;
        }

        public static LocalJob FromDictionary(object value)
        {
            var job = new LocalJob();
            job.Schema = Json.Str(value, "schema") ?? job.Schema;
            job.Id = Json.Str(value, "id");
            job.Kind = Json.Str(value, "kind");
            job.Target = Json.Str(value, "target");
            job.State = Json.Str(value, "state");
            job.CreatedAt = Json.Str(value, "created_at");
            job.UpdatedAt = Json.Str(value, "updated_at");
            job.StartedAt = Json.Str(value, "started_at");
            job.FinishedAt = Json.Str(value, "finished_at");
            job.OwnerPid = (int)Json.Num(value, "owner_pid");
            job.Input = Json.Obj(Json.Get(value, "input")) ?? new Dictionary<string, object>();
            job.Progress = Json.Obj(Json.Get(value, "progress"));
            job.Result = Json.Obj(Json.Get(value, "result"));
            job.Receipt = Json.Obj(Json.Get(value, "receipt"));
            job.Error = Json.Str(value, "error");
            return job;
        }
    }

    internal sealed class JobStore
    {
        public readonly string Root;
        public readonly string JobsDir;
        public readonly string DraftPath;
        public readonly string LogPath;
        private readonly object gate = new object();

        public JobStore(string root)
        {
            Root = root;
            JobsDir = Path.Combine(root, "jobs");
            DraftPath = Path.Combine(root, "drafts", "current.json");
            LogPath = Path.Combine(root, "logs", "desktop.log");
            Directory.CreateDirectory(JobsDir);
            Directory.CreateDirectory(Path.GetDirectoryName(DraftPath));
            Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
        }

        public static JobStore Default()
        {
            return new JobStore(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "McClusterDesktop"));
        }

        public static string Now()
        {
            return DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
        }

        public void Log(string eventName, Dictionary<string, object> fields)
        {
            var line = new Dictionary<string, object>();
            line["ts"] = Now();
            line["event"] = eventName;
            line["pid"] = System.Diagnostics.Process.GetCurrentProcess().Id;
            if (fields != null) foreach (var kv in fields) line[kv.Key] = kv.Value;
            lock (gate)
            {
                try { File.AppendAllText(LogPath, Json.Compact(line) + "\n", Encoding.UTF8); } catch (Exception) { }
            }
        }

        public void Log(string eventName, string key, object value)
        {
            var fields = new Dictionary<string, object>();
            fields[key] = value;
            Log(eventName, fields);
        }

        private string PathFor(string id)
        {
            return Path.Combine(JobsDir, id + ".json");
        }

        public void Save(LocalJob job)
        {
            job.UpdatedAt = Now();
            string text = Json.Pretty(job.ToDictionary());
            lock (gate)
            {
                // Atomic replace so a crash mid-write never leaves a half job file.
                string tmp = PathFor(job.Id) + ".tmp";
                File.WriteAllText(tmp, text, new UTF8Encoding(false));
                if (File.Exists(PathFor(job.Id))) File.Replace(tmp, PathFor(job.Id), null);
                else File.Move(tmp, PathFor(job.Id));
            }
        }

        public LocalJob Create(string kind, string target, Dictionary<string, object> input)
        {
            var job = new LocalJob();
            job.Id = "job_" + Guid.NewGuid().ToString("N");
            job.Kind = kind;
            job.Target = target;
            job.State = JobState.Queued;
            job.CreatedAt = Now();
            job.Input = input ?? new Dictionary<string, object>();
            Save(job);
            Log("job_created", new Dictionary<string, object> { { "job_id", job.Id }, { "kind", kind }, { "target", target } });
            return job;
        }

        public List<LocalJob> List()
        {
            var jobs = new List<LocalJob>();
            foreach (string file in Directory.GetFiles(JobsDir, "job_*.json"))
            {
                try { jobs.Add(LocalJob.FromDictionary(Json.Parse(File.ReadAllText(file)))); }
                catch (Exception) { }
            }
            return jobs.OrderByDescending(j => j.CreatedAt ?? "").ToList();
        }

        public LocalJob Get(string id)
        {
            string path = PathFor(id);
            if (!File.Exists(path)) return null;
            return LocalJob.FromDictionary(Json.Parse(File.ReadAllText(path)));
        }

        // Reconnect safety: a job left "running" by a process that no longer exists
        // becomes "interrupted". Its input, progress and partial receipt are kept so
        // the owner can see what was running and re-run it.
        public List<LocalJob> RecoverInterrupted()
        {
            var recovered = new List<LocalJob>();
            foreach (LocalJob job in List())
            {
                if (job.State != JobState.Running) continue;
                if (job.OwnerPid > 0 && ProcessAlive(job.OwnerPid)) continue;
                job.State = JobState.Interrupted;
                job.Error = "The desktop app closed while this job was running (owner pid " + job.OwnerPid + " is gone). Input and progress were kept; re-run to finish.";
                if (job.Receipt == null) job.Receipt = new Dictionary<string, object>();
                job.Receipt["interrupted_at"] = Now();
                Save(job);
                Log("job_interrupted_recovered", "job_id", job.Id);
                recovered.Add(job);
            }
            return recovered;
        }

        private static bool ProcessAlive(int pid)
        {
            try { System.Diagnostics.Process.GetProcessById(pid); return true; }
            catch (Exception) { return false; }
        }

        public void SaveDraft(string target, string text, string kind, string sample)
        {
            var d = new Dictionary<string, object>();
            d["schema"] = "mccluster-desktop-draft/1";
            d["saved_at"] = Now();
            d["target"] = target;
            d["kind"] = kind;
            d["text"] = text;
            d["sample_folder"] = sample;
            lock (gate) { File.WriteAllText(DraftPath, Json.Pretty(d), new UTF8Encoding(false)); }
        }

        public Dictionary<string, object> LoadDraft()
        {
            try { return File.Exists(DraftPath) ? Json.Obj(Json.Parse(File.ReadAllText(DraftPath))) : null; }
            catch (Exception) { return null; }
        }
    }

    internal sealed class JobRunner
    {
        private readonly JobStore store;
        private static readonly HttpClient Http = new HttpClient() { Timeout = TimeSpan.FromMinutes(10) };

        public JobRunner(JobStore store)
        {
            this.store = store;
        }

        public async Task<LocalJob> Run(LocalJob job, Action<LocalJob> progress, CancellationToken cancel)
        {
            if (job.Target != JobTarget.LocalDevice)
                throw new InvalidOperationException("Only local-device jobs run inside the desktop app. Remote and group jobs are submitted through the owner's signed-in site session and executed by the OVH Core.");
            job.State = JobState.Running;
            job.StartedAt = JobStore.Now();
            job.OwnerPid = System.Diagnostics.Process.GetCurrentProcess().Id;
            DeviceInventory device = DeviceInventory.Read();
            OllamaStatus ollama = await LocalRuntime.ProbeOllama().ConfigureAwait(false);
            job.Receipt = BaseReceipt(device, ollama);
            store.Save(job);
            store.Log("job_started", new Dictionary<string, object> { { "job_id", job.Id }, { "kind", job.Kind } });
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                if (job.Kind == JobKind.Inventory) await RunInventory(job, progress, cancel).ConfigureAwait(false);
                else if (job.Kind == JobKind.Chat) await RunChat(job, ollama, cancel).ConfigureAwait(false);
                else throw new InvalidOperationException("Unknown local job kind: " + job.Kind);
                job.State = JobState.Done;
            }
            catch (Exception ex)
            {
                job.State = JobState.Failed;
                job.Error = ex.GetType().Name + ": " + ex.Message;
            }
            sw.Stop();
            job.FinishedAt = JobStore.Now();
            job.Receipt["duration_ms"] = sw.ElapsedMilliseconds;
            job.Receipt["finished_at"] = job.FinishedAt;
            job.Receipt["state"] = job.State;
            if (job.Result != null) job.Receipt["output_sha256"] = Sha256Hex(Encoding.UTF8.GetBytes(Json.Compact(job.Result)));
            store.Save(job);
            store.Log("job_finished", new Dictionary<string, object> { { "job_id", job.Id }, { "state", job.State }, { "duration_ms", sw.ElapsedMilliseconds } });
            return job;
        }

        private static Dictionary<string, object> BaseReceipt(DeviceInventory device, OllamaStatus ollama)
        {
            var receipt = new Dictionary<string, object>();
            receipt["schema"] = "mccluster-desktop-receipt/1";
            receipt["executor"] = "mccluster-desktop/" + typeof(JobRunner).Assembly.GetName().Version.ToString(3);
            receipt["evidence_scope"] = "local_device_only";
            receipt["device"] = device.ToProtocolInventory(ollama.GpuEvidence);
            receipt["hardware_mode"] = device.HardwareMode(ollama.GpuEvidence);
            var runtime = new Dictionary<string, object>();
            runtime["ollama_reachable"] = ollama.Reachable;
            runtime["ollama_version"] = ollama.Version;
            runtime["ollama_url"] = ollama.Url;
            runtime["ollama_models_installed"] = ollama.Models.Select(m => m.Name).ToList();
            receipt["runtime"] = runtime;
            receipt["started_at"] = JobStore.Now();
            receipt["hosted_inference_used"] = false;
            return receipt;
        }

        private Task RunInventory(LocalJob job, Action<LocalJob> progress, CancellationToken cancel)
        {
            // Hashing is CPU and disk work: keep it off the UI thread.
            return Task.Run((Action)delegate { InventoryWork(job, progress, cancel); }, cancel);
        }

        private void InventoryWork(LocalJob job, Action<LocalJob> progress, CancellationToken cancel)
        {
            string folder = Json.Str(job.Input, "path");
            if (string.IsNullOrWhiteSpace(folder) || !Directory.Exists(folder)) throw new DirectoryNotFoundException("Sample folder not found: " + folder);
            var full = Path.GetFullPath(folder);
            var files = Directory.EnumerateFiles(full, "*", SearchOption.AllDirectories).OrderBy(f => f, StringComparer.Ordinal).ToList();
            var lines = new List<string>();
            long bytes = 0;
            var byExtension = new Dictionary<string, int>();
            int count = 0;
            DateTime lastSave = DateTime.UtcNow;
            using (var sha = SHA256.Create())
                foreach (string file in files)
                {
                    cancel.ThrowIfCancellationRequested();
                    byte[] hash;
                    long length;
                    using (FileStream fs = File.OpenRead(file))
                    {
                        length = fs.Length;
                        hash = sha.ComputeHash(fs);
                    }
                    bytes += length;
                    string rel = file.Substring(full.Length).TrimStart('\\', '/').Replace('\\', '/');
                    lines.Add(rel + "\t" + length.ToString(CultureInfo.InvariantCulture) + "\t" + Hex(hash));
                    string ext = (Path.GetExtension(file) ?? "").ToLowerInvariant();
                    if (ext == "") ext = "(none)";
                    int n;
                    byExtension[ext] = byExtension.TryGetValue(ext, out n) ? n + 1 : 1;
                    count++;
                    if ((DateTime.UtcNow - lastSave).TotalMilliseconds > 500)
                    {
                        job.Progress = new Dictionary<string, object> { { "files_done", count }, { "files_total", files.Count }, { "bytes", bytes } };
                        store.Save(job);
                        lastSave = DateTime.UtcNow;
                        if (progress != null) progress(job);
                    }
                }
            string manifest = string.Join("\n", lines);
            var result = new Dictionary<string, object>();
            result["sample_folder"] = full;
            result["file_count"] = count;
            result["total_bytes"] = bytes;
            result["manifest_sha256"] = Sha256Hex(Encoding.UTF8.GetBytes(manifest));
            result["by_extension"] = byExtension.OrderByDescending(kv => kv.Value).Take(12).ToDictionary(kv => kv.Key, kv => (object)kv.Value);
            result["first_entries"] = lines.Take(8).ToList();
            job.Progress = new Dictionary<string, object> { { "files_done", count }, { "files_total", files.Count }, { "bytes", bytes } };
            job.Result = result;
            job.Receipt["task"] = "Hash every file under the sample folder and record a content manifest (no file contents leave the device).";
        }

        private async Task RunChat(LocalJob job, OllamaStatus ollama, CancellationToken cancel)
        {
            string prompt = Json.Str(job.Input, "prompt");
            string model = Json.Str(job.Input, "model");
            if (string.IsNullOrWhiteSpace(prompt)) throw new ArgumentException("A prompt is required.");
            if (!ollama.Reachable) throw new InvalidOperationException("The local model runtime (Ollama on loopback) is not running. Local inference is unavailable; no hosted API is used instead.");
            if (string.IsNullOrWhiteSpace(model)) throw new InvalidOperationException("No local model selected. Install a model in Ollama first (ollama pull <model>); local inference is not claimed until one is installed.");
            if (!ollama.Models.Any(m => string.Equals(m.Name, model, StringComparison.OrdinalIgnoreCase)))
                throw new InvalidOperationException("Model '" + model + "' is not installed locally. Installed: " + (ollama.Models.Count == 0 ? "none" : string.Join(", ", ollama.Models.Select(m => m.Name))));
            var body = new Dictionary<string, object>();
            body["model"] = model;
            body["stream"] = false;
            body["think"] = false;
            body["messages"] = new List<object> { new Dictionary<string, object> { { "role", "user" }, { "content", prompt } } };
            // Some local models (qwen3-vl on Ollama 0.40) keep reasoning in message.thinking even
            // with think:false, so the budget must leave room for an answer after the reasoning.
            double numPredict = Json.Num(job.Input, "num_predict");
            if (numPredict < 64) numPredict = 1536;
            body["options"] = new Dictionary<string, object> { { "temperature", 0.2 }, { "num_predict", (int)numPredict } };
            using (var content = new StringContent(Json.Compact(body), Encoding.UTF8, "application/json"))
            using (HttpResponseMessage response = await Http.PostAsync(ollama.Url + "/api/chat", content, cancel).ConfigureAwait(false))
            {
                string text = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                if (!response.IsSuccessStatusCode) throw new HttpRequestException("Ollama HTTP " + (int)response.StatusCode + ": " + text);
                object parsed = Json.Parse(text);
                var result = new Dictionary<string, object>();
                result["model"] = Json.Str(parsed, "model");
                string answer = Json.Str(Json.Get(parsed, "message"), "content") ?? "";
                string thinking = Json.Str(Json.Get(parsed, "message"), "thinking") ?? "";
                string doneReason = Json.Str(parsed, "done_reason");
                result["content"] = answer;
                result["thinking_chars"] = thinking.Length;
                result["done_reason"] = doneReason;
                double evalCount = Json.Num(parsed, "eval_count");
                double evalNs = Json.Num(parsed, "eval_duration");
                double promptCount = Json.Num(parsed, "prompt_eval_count");
                double promptNs = Json.Num(parsed, "prompt_eval_duration");
                result["generation_tokens"] = evalCount;
                result["prompt_tokens"] = promptCount;
                result["generation_tokens_per_second"] = evalNs > 0 ? Math.Round(evalCount * 1e9 / evalNs, 2) : 0;
                result["prompt_tokens_per_second"] = promptNs > 0 ? Math.Round(promptCount * 1e9 / promptNs, 2) : 0;
                job.Result = result;
                OllamaStatus after = await LocalRuntime.ProbeOllama().ConfigureAwait(false);
                job.Receipt["model"] = result["model"];
                job.Receipt["gpu_evidence_after_run"] = after.GpuEvidence;
                job.Receipt["loaded_after_run"] = after.LoadedSummary;
                job.Receipt["hardware_mode"] = DeviceInventory.Read().HardwareMode(after.GpuEvidence);
                job.Receipt["task"] = "One chat completion on the local Ollama model on loopback.";
                // A run that spent its whole budget reasoning and produced no answer is not a result.
                if (answer.Trim().Length == 0)
                    throw new InvalidOperationException("The model produced no answer text (done_reason " + (doneReason ?? "unknown") + ", " + thinking.Length + " reasoning characters, " + evalCount + " tokens). Raise num_predict or pick a model that honours think:false.");
            }
        }

        internal static string Sha256Hex(byte[] data)
        {
            using (var sha = SHA256.Create()) return Hex(sha.ComputeHash(data));
        }

        private static string Hex(byte[] data)
        {
            var sb = new StringBuilder(data.Length * 2);
            foreach (byte b in data) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }
    }
}
