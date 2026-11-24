using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace McClusterDesktop
{
    // The device side of the compute contribution contract (docs/control-plane/COMPUTE-CONTRIBUTION-LEDGER.md
    // on branch prime/contribution-ledger; not in this tree until that branch is merged), without any UI: the consent
    // text, the limits the owner sets, the device state read from the node's state root (never the
    // identity file), where the doctor is, the exact switches the desktop drives it with, and the one
    // way it runs: powershell.exe -NoProfile -ExecutionPolicy Bypass -File <doctor> <switches>. The
    // desktop is a client: it never calls the Core, and the doctor is the only thing that writes the
    // state root. The enrolment credential travels in the child's environment only (MCCLUSTER_NODE_ENROLL_TOKEN):
    // never on a command line, never in a file, a log, a receipt or the clipboard.
    internal static class Contribution
    {
        internal const string EnrollTokenVariable = "MCCLUSTER_NODE_ENROLL_TOKEN";
        internal const string LimitsSchema = "mccluster-node-limits/1";
        internal const string HeartbeatSchema = "mccluster-node-heartbeat/1";
        internal const string DoctorRelativePath = "core\\windows\\mccluster-node.ps1";

        // The consent text the contract requires, shown before anything is enrolled. Plain words, exactly:
        // what runs, which workload class, the limits, what is never sent, and that Pause and Revoke are one click away.
        internal const string ConsentText =
            "Contributing makes this device a compute node of the McCluster fabric.\n" +
            "What runs here: only the approved model class (the local Ollama models this device's tier names), through the node adapter on loopback; nothing else is installed by enabling this.\n" +
            "Which work: workload class public only, by default for a community device: open or synthetic inputs, never another owner's data. Private work reaches a device only when its enrolment trust is owned by the requesting account or that account explicitly permits it; that is a claim-time fence on the Core, not a promise made here.\n" +
            "Your limits: idle only, AC power only, max concurrency (1 in the pilot), CPU busy ceiling, battery floor and a thermal limit (best effort: unsupported on this device when no thermal zone can be read, never silently off). The node agent enforces them before every claim and reports them in every heartbeat.\n" +
            "What is never sent to this device: no account credential and no tool permission beyond the executor contract. The one-time enrolment credential you type is handed to the doctor in the environment of that one process and is not stored by this app.\n" +
            "Pause and Revoke are one click away: Pause stops new claims within one poll (running work finishes); Revoke removes the tasks and the node's key from this device and names the node id you then revoke on the Core.";

        internal sealed class Limits
        {
            public bool IdleOnly;
            public bool OnACOnly;
            public int MaxConcurrency = 1;        // 1..4
            public int CpuBusyPercent;            // 0 = not set, else 10..100
            public int BatteryFloorPercent = -1;  // -1 = not set, else 0..100
            public int ThermalLimitC;             // 0 = not set

            public void Validate()
            {
                if (MaxConcurrency < 1 || MaxConcurrency > 4) throw new ArgumentException("Max concurrency must be 1 to 4.");
                if (CpuBusyPercent != 0 && (CpuBusyPercent < 10 || CpuBusyPercent > 100)) throw new ArgumentException("CPU busy percent must be 0 (not set) or 10 to 100.");
                if (BatteryFloorPercent != -1 && (BatteryFloorPercent < 0 || BatteryFloorPercent > 100)) throw new ArgumentException("Battery floor must be -1 (not set) or 0 to 100.");
                if (ThermalLimitC < 0 || ThermalLimitC > 150) throw new ArgumentException("Thermal limit must be 0 (not set) or 1 to 150 C.");
            }

            // The same words the doctor and the agent use; thermalSupported null = not reported yet.
            public string Summary(bool? thermalSupported)
            {
                var parts = new List<string>();
                parts.Add("idle only " + (IdleOnly ? "on" : "off"));
                parts.Add("AC only " + (OnACOnly ? "on" : "off"));
                parts.Add("max concurrency " + MaxConcurrency);
                parts.Add(CpuBusyPercent == 0 ? "CPU busy ceiling not set" : "CPU busy ceiling " + CpuBusyPercent + "%");
                parts.Add(BatteryFloorPercent == -1 ? "battery floor not set" : "battery floor " + BatteryFloorPercent + "%");
                if (ThermalLimitC == 0) parts.Add("thermal limit not set");
                else if (thermalSupported == false) parts.Add("thermal limit " + ThermalLimitC + " C (unsupported on this device: no readable thermal zone; the agent reports it as unsupported)");
                else if (thermalSupported == null) parts.Add("thermal limit " + ThermalLimitC + " C (support unknown until the agent reports)");
                else parts.Add("thermal limit " + ThermalLimitC + " C");
                return string.Join(", ", parts);
            }

            public static Limits FromJson(object parsed)
            {
                var limits = new Limits();
                if (parsed == null) return limits;
                limits.IdleOnly = Json.Get(parsed, "idle_only") is bool && (bool)Json.Get(parsed, "idle_only");
                limits.OnACOnly = Json.Get(parsed, "on_ac_only") is bool && (bool)Json.Get(parsed, "on_ac_only");
                int max = (int)Json.Num(parsed, "max_concurrency");
                limits.MaxConcurrency = max >= 1 && max <= 4 ? max : 1;
                int cpu = (int)Json.Num(parsed, "cpu_busy_percent");
                limits.CpuBusyPercent = Json.Get(parsed, "cpu_busy_percent") != null && cpu >= 10 && cpu <= 100 ? cpu : 0;
                limits.BatteryFloorPercent = Json.Get(parsed, "battery_floor_percent") != null ? (int)Json.Num(parsed, "battery_floor_percent") : -1;
                if (limits.BatteryFloorPercent < 0 || limits.BatteryFloorPercent > 100) limits.BatteryFloorPercent = -1;
                int thermal = (int)Math.Round(Json.Num(parsed, "thermal_limit_c"));
                limits.ThermalLimitC = thermal > 0 ? thermal : 0;
                return limits;
            }
        }

        // What the panel reads from the state root (the identity file is only tested for presence) and from this device's own job store.
        internal sealed class State
        {
            public string StateDir;
            public bool StateDirExists;
            public bool Installed;          // node.config.json present
            public bool Enrolled;           // identity.json present (never read)
            public bool Paused;
            public Limits Limits;           // null when no limits.json
            public string LimitsError;      // "invalid_json" / "schema_mismatch" when the file is unreadable
            public DateTime? LastHeartbeatAt;   // last-heartbeat.json: its "at", else the file time
            public string HeartbeatNodeId;
            public bool? ThermalSupported;  // from the heartbeat labels when present
            public string ClaimGate;        // from the heartbeat labels when present
            public string RevokedNodeId;
            public string RevokedAt;
            public int LocalDoneReceipts;   // this device's local jobs in state done
            public int? AcceptedWork;       // <state root>\accepted-work.json when the node writes one (nothing writes it today)
            public string DoctorPath;       // null when no doctor was found

            public string NodeIdForDisplay { get { return HeartbeatNodeId ?? RevokedNodeId; } }
        }

        internal static State ReadState(string stateDir, JobStore store)
        {
            var state = new State();
            state.StateDir = stateDir;
            state.StateDirExists = Directory.Exists(stateDir);
            state.Installed = File.Exists(Path.Combine(stateDir, "node.config.json"));
            state.Enrolled = File.Exists(Path.Combine(stateDir, "identity.json"));
            state.Paused = File.Exists(Path.Combine(stateDir, "paused"));
            string limitsPath = Path.Combine(stateDir, "limits.json");
            if (File.Exists(limitsPath))
            {
                try
                {
                    object parsed = Json.Parse(File.ReadAllText(limitsPath));
                    if (Json.Str(parsed, "schema") != LimitsSchema) state.LimitsError = "schema_mismatch";
                    else state.Limits = Limits.FromJson(parsed);
                }
                catch (Exception) { state.LimitsError = "invalid_json"; }
            }
            string heartbeatPath = Path.Combine(stateDir, "last-heartbeat.json");
            if (File.Exists(heartbeatPath))
            {
                try
                {
                    state.LastHeartbeatAt = File.GetLastWriteTimeUtc(heartbeatPath);
                    object parsed = Json.Parse(File.ReadAllText(heartbeatPath));
                    state.HeartbeatNodeId = Json.Str(parsed, "node_id");
                    DateTime at;
                    if (DateTime.TryParse(Json.Str(parsed, "at"), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out at)) state.LastHeartbeatAt = at;
                    object labels = Json.Get(parsed, "labels");
                    object thermal = Json.Get(labels, "thermal_supported");
                    if (thermal is bool) state.ThermalSupported = (bool)thermal;
                    state.ClaimGate = Json.Str(labels, "claim_gate");
                }
                catch (Exception) { }
            }
            string revokedPath = Path.Combine(stateDir, "revoked.json");
            if (File.Exists(revokedPath))
            {
                try
                {
                    object parsed = Json.Parse(File.ReadAllText(revokedPath));
                    state.RevokedNodeId = Json.Str(parsed, "node_id");
                    state.RevokedAt = Json.Str(parsed, "revoked_at");
                }
                catch (Exception) { }
            }
            string acceptedPath = Path.Combine(stateDir, "accepted-work.json");
            if (File.Exists(acceptedPath))
            {
                try
                {
                    object parsed = Json.Parse(File.ReadAllText(acceptedPath));
                    if (Json.Get(parsed, "accepted_attempts") != null) state.AcceptedWork = (int)Json.Num(parsed, "accepted_attempts");
                }
                catch (Exception) { }
            }
            if (store != null)
            {
                try { state.LocalDoneReceipts = store.List().Count(j => j.State == JobState.Done); }
                catch (Exception) { }
            }
            state.DoctorPath = FindDoctor(stateDir);
            return state;
        }

        // The node id the agent reported, for receipts; null when no heartbeat file exists. Never reads identity.json.
        internal static string ReportedNodeId(string stateDir)
        {
            try
            {
                string path = Path.Combine(stateDir, "last-heartbeat.json");
                if (!File.Exists(path)) return null;
                return Json.Str(Json.Parse(File.ReadAllText(path)), "node_id");
            }
            catch (Exception) { return null; }
        }

        // Where the doctor is, in this order: MCCLUSTER_DOCTOR_PATH; the checkout node.config.json names
        // (repo_path); a checkout above this executable (dist\app sits four levels under the repo root);
        // a copy beside the executable. Null when none exists: the panel then says so and disables the buttons.
        internal static string FindDoctor(string stateDir)
        {
            var candidates = new List<string>();
            string fromEnv = Environment.GetEnvironmentVariable("MCCLUSTER_DOCTOR_PATH");
            if (!string.IsNullOrWhiteSpace(fromEnv)) candidates.Add(fromEnv.Trim());
            try
            {
                string config = Path.Combine(stateDir, "node.config.json");
                if (File.Exists(config))
                {
                    string repo = Json.Str(Json.Parse(File.ReadAllText(config)), "repo_path");
                    if (!string.IsNullOrWhiteSpace(repo)) candidates.Add(Path.Combine(repo, DoctorRelativePath));
                }
            }
            catch (Exception) { }
            try
            {
                string dir = Path.GetDirectoryName(typeof(Contribution).Assembly.Location);
                for (int up = 0; up <= 6 && dir != null; up++)
                {
                    candidates.Add(Path.Combine(dir, DoctorRelativePath));
                    dir = Path.GetDirectoryName(dir);
                }
                candidates.Add(Path.Combine(Path.GetDirectoryName(typeof(Contribution).Assembly.Location), "mccluster-node.ps1"));
            }
            catch (Exception) { }
            foreach (string candidate in candidates)
                if (File.Exists(candidate)) return Path.GetFullPath(candidate);
            return null;
        }

        // The checkout a doctor path belongs to (<repo>\core\windows\mccluster-node.ps1), or null for an installed copy.
        internal static string RepoRootFromDoctor(string doctorPath)
        {
            if (string.IsNullOrWhiteSpace(doctorPath)) return null;
            string windows = Path.GetDirectoryName(doctorPath);
            if (windows == null || !string.Equals(Path.GetFileName(windows), "windows", StringComparison.OrdinalIgnoreCase)) return null;
            string core = Path.GetDirectoryName(windows);
            if (core == null || !string.Equals(Path.GetFileName(core), "core", StringComparison.OrdinalIgnoreCase)) return null;
            return Path.GetDirectoryName(core);
        }

        // The doctor's switches for one action. Explicit, one action per run, always -StateRoot so the doctor
        // touches the root the panel reads. The credential is never an argument.
        internal static List<string> DoctorArgs(string action, string stateDir, Limits limits, string repoPath, string orgId)
        {
            var args = new List<string>();
            switch (action)
            {
                case "install":
                    if (string.IsNullOrWhiteSpace(repoPath)) throw new ArgumentException("-Install needs the checkout the doctor lives in (RepoPath); an installed doctor copy cannot install.");
                    if (string.IsNullOrWhiteSpace(orgId)) throw new ArgumentException("-Install needs the organization id the first time.");
                    args.Add("-Install"); args.Add("-RepoPath"); args.Add(repoPath); args.Add("-OrgId"); args.Add(orgId);
                    break;
                case "limits":
                    if (limits == null) throw new ArgumentException("limits are required");
                    limits.Validate();
                    args.Add("-Limits");
                    if (limits.IdleOnly) args.Add("-IdleOnly");
                    if (limits.OnACOnly) args.Add("-OnACOnly");
                    args.Add("-MaxConcurrency"); args.Add(limits.MaxConcurrency.ToString(CultureInfo.InvariantCulture));
                    if (limits.CpuBusyPercent != 0) { args.Add("-CpuBusyPercent"); args.Add(limits.CpuBusyPercent.ToString(CultureInfo.InvariantCulture)); }
                    if (limits.BatteryFloorPercent != -1) { args.Add("-BatteryFloorPercent"); args.Add(limits.BatteryFloorPercent.ToString(CultureInfo.InvariantCulture)); }
                    if (limits.ThermalLimitC != 0) { args.Add("-ThermalLimitC"); args.Add(limits.ThermalLimitC.ToString(CultureInfo.InvariantCulture)); }
                    break;
                case "enroll": args.Add("-Enroll"); if (!string.IsNullOrWhiteSpace(repoPath)) { args.Add("-RepoPath"); args.Add(repoPath); } break;
                case "pause": args.Add("-Pause"); break;
                case "resume": args.Add("-Resume"); break;
                case "revoke": args.Add("-Revoke"); break;
                case "report": args.Add("-Report"); break;
                default: throw new ArgumentException("unknown doctor action: " + action);
            }
            args.Add("-StateRoot");
            args.Add(stateDir);
            return args;
        }

        // powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<doctor>" <switches>; values are quoted for the Windows command line.
        internal static string CommandLine(string doctorPath, IList<string> args)
        {
            var sb = new StringBuilder("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ");
            sb.Append(QuoteArg(doctorPath));
            foreach (string arg in args) sb.Append(' ').Append(QuoteArg(arg));
            return sb.ToString();
        }

        // One argument quoted by the Windows command-line rules (CommandLineToArgvW / the C runtime, which
        // powershell.exe uses): inside quotes, 2n backslashes followed by a quote mean n backslashes and the
        // end of the argument, 2n+1 mean n backslashes and a literal quote, and backslashes not followed by a
        // quote are literal. So every run of backslashes that precedes a quote (an embedded one, or the
        // closing one: a trailing backslash) is doubled, and an embedded quote gets one more. Without this a
        // state root such as "C:\McCluster Node\" swallows the closing quote and every argument after it.
        internal static string QuoteArg(string value)
        {
            string v = value ?? "";
            if (v.Length > 0 && v.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) return v;
            var sb = new StringBuilder("\"");
            int backslashes = 0;
            foreach (char c in v)
            {
                if (c == '\\') { backslashes++; continue; }
                if (c == '"') sb.Append('\\', backslashes * 2 + 1);
                else sb.Append('\\', backslashes);
                backslashes = 0;
                sb.Append(c);
            }
            sb.Append('\\', backslashes * 2);
            sb.Append('"');
            return sb.ToString();
        }

        internal sealed class DoctorResult
        {
            public string Action;
            public int ExitCode;
            public bool TimedOut;
            public string StdOut = "";
            public string StdErr = "";
            public string CommandLine;
            public long ElapsedMs;
        }

        // Runs the doctor once. The credential (when given) is set on the child process environment only;
        // the log line carries the action, the exit code and the duration, never an argument value.
        internal static Task<DoctorResult> RunDoctor(string doctorPath, IList<string> args, string enrollToken, int timeoutMs, JobStore store)
        {
            return Task.Run(delegate
            {
                var result = new DoctorResult();
                result.Action = args.Count > 0 ? args[0] : "";
                result.CommandLine = CommandLine(doctorPath, args);
                var sw = Stopwatch.StartNew();
                try
                {
                    var info = new ProcessStartInfo();
                    info.FileName = "powershell.exe";
                    info.Arguments = result.CommandLine;
                    info.UseShellExecute = false;
                    info.CreateNoWindow = true;
                    info.RedirectStandardOutput = true;
                    info.RedirectStandardError = true;
                    info.WorkingDirectory = Path.GetDirectoryName(doctorPath) ?? Environment.CurrentDirectory;
                    if (!string.IsNullOrEmpty(enrollToken)) info.EnvironmentVariables[EnrollTokenVariable] = enrollToken;
                    else info.EnvironmentVariables.Remove(EnrollTokenVariable);
                    using (Process process = Process.Start(info))
                    {
                        Task<string> stdout = process.StandardOutput.ReadToEndAsync();
                        Task<string> stderr = process.StandardError.ReadToEndAsync();
                        if (!process.WaitForExit(timeoutMs))
                        {
                            result.TimedOut = true;
                            try { process.Kill(); } catch (Exception) { }
                            process.WaitForExit();
                        }
                        result.StdOut = stdout.Result;
                        result.StdErr = stderr.Result;
                        result.ExitCode = process.ExitCode;
                    }
                }
                catch (Exception ex)
                {
                    result.ExitCode = -1;
                    result.StdErr = ex.GetType().Name + ": " + ex.Message;
                }
                result.ElapsedMs = sw.ElapsedMilliseconds;
                if (store != null) store.Log("doctor_run", new Dictionary<string, object> { { "action", result.Action }, { "exit_code", result.ExitCode }, { "timed_out", result.TimedOut }, { "elapsed_ms", result.ElapsedMs } });
                return result;
            });
        }
    }
}
