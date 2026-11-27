using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace McClusterDesktop
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            // Headless modes write files and exit; they exist so a build can be verified
            // without driving the window. The window is the product.
            if (args.Length > 0 && args[0].StartsWith("--", StringComparison.Ordinal))
                return Headless.Run(args);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new DesktopWindow());
            return 0;
        }
    }

    internal static class Headless
    {
        private static string Option(string[] args, string name)
        {
            for (int i = 0; i + 1 < args.Length; i++) if (args[i] == name) return args[i + 1];
            return null;
        }

        // A positional value is only a value when it is not itself a flag.
        private static string Positional(string[] args, int index)
        {
            return index < args.Length && !args[index].StartsWith("--", StringComparison.Ordinal) ? args[index] : null;
        }

        private static int Number(string[] args, string name, int fallback, int min, int max)
        {
            string text = Option(args, name);
            if (text == null) return fallback;
            double value;
            if (!double.TryParse(text, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out value) || value < min || value > max)
                throw new ArgumentException(name + " must be a number between " + min + " and " + max);
            return (int)value;
        }

        private static List<string> Options(string[] args, string name)
        {
            var values = new List<string>();
            for (int i = 0; i + 1 < args.Length; i++) if (args[i] == name) values.Add(args[i + 1]);
            return values;
        }

        internal static int Run(string[] args)
        {
            JobStore store = JobStore.Default();
            string outPath = Option(args, "--out");
            try
            {
                switch (args[0])
                {
                    case "--status-json":
                        return Write(outPath, Status(store).Result);
                    case "--device-key":
                        {
                            // The key id a verifier on another machine pins; never the private key.
                            using (DeviceKey key = DeviceKey.Load(store.Root))
                                return Write(outPath, new Dictionary<string, object> { { "schema", "mccluster-device-key/1" }, { "key_id", key.KeyId }, { "public_key", key.PublicKeyBase64 }, { "alg", "ecdsa-p256-sha256" }, { "device", Environment.MachineName } });
                        }
                    case "--verify-receipt":
                        {
                            string filePath = Option(args, "--file") ?? Positional(args, 1);
                            if (filePath == null) { Write(outPath, new Dictionary<string, object> { { "error", "missing --file" } }); return 2; }
                            object file = Json.Parse(File.ReadAllText(filePath));
                            // Trust anchor: this device's own key id unless the verifier names another trusted id.
                            string trustedKeyId = Option(args, "--trusted-key-id");
                            bool anyKey = args.Contains("--any-key");
                            if (trustedKeyId == null && !anyKey) { using (DeviceKey key = DeviceKey.Load(store.Root)) trustedKeyId = key.KeyId; }
                            Dictionary<string, object> payload = ReceiptVerifier.Verify(file, trustedKeyId, anyKey);
                            payload["sentence"] = ReceiptVerifier.Sentence(payload);
                            bool ok = (bool)payload["verified"];
                            Write(outPath, payload);
                            return ok ? 0 : 1;
                        }
                    case "--image-diff":
                        {
                            string a = Option(args, "--a") ?? Positional(args, 1);
                            string b = Option(args, "--b") ?? Positional(args, 2);
                            if (a == null || b == null) { Write(outPath, new Dictionary<string, object> { { "error", "missing --a or --b" } }); return 2; }
                            int tolerance = Number(args, "--tolerance", 24, 0, 255);
                            return Write(outPath, ImageDiff.Compare(a, b, Option(args, "--diff"), tolerance));
                        }
                    case "--exo-rank-probe":
                        {
                            string url = Option(args, "--runtime-url") ?? "http://127.0.0.1:52415";
                            Dictionary<string, object> receipt = ExoProbe.RankReceipt(url, Option(args, "--node-id")).Result;
                            Write(outPath, receipt);
                            return receipt.ContainsKey("error") ? 1 : 0;
                        }
                    case "--parity-audit":
                        {
                            var routes = Options(args, "--route");
                            if (routes.Count == 0) routes.AddRange(new[] { "https://mccluster.org/", "https://mccluster.org/company", "https://mccluster.org/login.html", "https://mccluster.org/account.html", "https://mccluster.org/control.html", "https://mccluster.org/dashboard.html", "https://mccluster.org/help.html", "https://mccluster.org/does-not-exist-parity-check", "https://matthew.mccluster.org/", "https://humanuprise.com/", "https://example.com/" });
                            int width = Number(args, "--width", 1280, 200, 4096);
                            int height = Number(args, "--height", 800, 200, 4096);
                            string dir = Option(args, "--dir") ?? Path.Combine(store.Root, "parity");
                            Directory.CreateDirectory(dir);
                            // The revision under audit, read before and after so a deploy mid-run is visible.
                            ProbeResult before = LocalRuntime.GetJson(LocalRuntime.ApiHealth).Result;
                            Application.EnableVisualStyles();
                            var form = new ParityAuditForm(routes, dir, width, height);
                            Application.Run(form);
                            List<ParityResult> results = form.Completion.Result;
                            ProbeResult afterRun = LocalRuntime.GetJson(LocalRuntime.ApiHealth).Result;
                            var rows = new List<object>();
                            foreach (ParityResult r in results)
                                rows.Add(new Dictionary<string, object> { { "route", r.Route }, { "final_url", r.FinalUrl }, { "http_status", r.HttpStatus }, { "navigation_ok", r.NavigationOk }, { "web_error_status", r.WebErrorStatus }, { "title", r.Title }, { "scroll_width", r.ScrollWidth }, { "client_width", r.ClientWidth }, { "no_horizontal_overflow_at_viewport", r.ScrollWidth > 0 && r.ScrollWidth == r.ClientWidth }, { "document_height", r.DocumentHeight }, { "blocked_navigations", r.BlockedNavigations }, { "console_errors", r.ConsoleErrors }, { "screenshot", r.Screenshot }, { "elapsed_ms", r.ElapsedMs }, { "error", r.Error } });
                            var payload = new Dictionary<string, object> { { "schema", "mccluster-parity-audit/1" }, { "checked_at", JobStore.Now() }, { "viewport", width + "x" + height }, { "shell", "mccluster-desktop/" + typeof(Headless).Assembly.GetName().Version.ToString(3) }, { "webview2_runtime", WebView2Version() },
                                { "revision", new Dictionary<string, object> { { "source", LocalRuntime.ApiHealth }, { "deployment_sha_before", before.Body == null ? null : Json.Str(before.Body, "deployment_sha") }, { "deployment_sha_after", afterRun.Body == null ? null : Json.Str(afterRun.Body, "deployment_sha") }, { "observed_before", before.CheckedAt.ToString("o") }, { "observed_after", afterRun.CheckedAt.ToString("o") } } },
                                { "reference_capture", "supplied by the operator from a plain browser at the same revision; compare with --image-diff" }, { "routes", rows } };
                            return Write(outPath, payload);
                        }
                    case "--jobs-json":
                        {
                            List<LocalJob> recovered = store.RecoverInterrupted();
                            var all = new List<object>();
                            foreach (LocalJob job in store.List()) all.Add(job.ToDictionary());
                            var payload = new Dictionary<string, object> { { "recovered_interrupted", recovered.Count }, { "jobs", all } };
                            return Write(outPath, payload);
                        }
                    case "--run-local-inventory":
                        {
                            store.RecoverInterrupted();
                            string folder = Option(args, "--path") ?? Positional(args, 1);
                            if (folder == null) { Write(outPath, new Dictionary<string, object> { { "error", "missing --path" } }); return 2; }
                            var input = new Dictionary<string, object> { { "path", folder } };
                            LocalJob job = store.Create(JobKind.Inventory, JobTarget.LocalDevice, input);
                            job = new JobRunner(store).Run(job, null, CancellationToken.None).Result;
                            Write(outPath, job.ToDictionary());
                            return job.State == JobState.Done ? 0 : 1;
                        }
                    case "--run-local-chat":
                        {
                            store.RecoverInterrupted();
                            string prompt = Option(args, "--prompt") ?? Positional(args, 1);
                            if (prompt == null) { Write(outPath, new Dictionary<string, object> { { "error", "missing --prompt" } }); return 2; }
                            var input = new Dictionary<string, object> { { "prompt", prompt }, { "model", Option(args, "--model") }, { "device", Option(args, "--device") ?? DeviceChoice.Auto } };
                            if (Option(args, "--max-attempts") != null) input["max_attempts"] = Number(args, "--max-attempts", JobRunner.DefaultMaxAttempts, 1, 5);
                            List<string> contextRoutes = Options(args, "--context-route");
                            if (contextRoutes.Count > 0) input["context_routes"] = contextRoutes.Cast<object>().ToList();
                            LocalJob job = store.Create(JobKind.Chat, JobTarget.LocalDevice, input);
                            job = new JobRunner(store).Run(job, null, CancellationToken.None).Result;
                            Write(outPath, job.ToDictionary());
                            return job.State == JobState.Done ? 0 : 1;
                        }
                    case "--core-submit":
                        {
                            // Owner-only: one job through the staging Core the staging profile names (CoreJobs.cs).
                            // The admin token is read from the profile's token file inside the client; it is
                            // never an argument, never in the output file and never in the log.
                            string prompt = Option(args, "--prompt");
                            string implementation = Option(args, "--implementation");
                            if (prompt == null || implementation == null) { Write(outPath, new Dictionary<string, object> { { "error", "missing --prompt or --implementation" } }); return 2; }
                            int timeout = Number(args, "--timeout-seconds", CoreSubmit.DefaultTimeoutSeconds, 5, 3600);
                            Dictionary<string, object> payload = CoreSubmit.Run(Option(args, "--profile"), prompt, implementation, timeout, args.Contains("--expect-refusal"), outPath, store, CancellationToken.None, 1000);
                            Write(outPath, payload);
                            return CoreSubmit.ExitCode(payload);
                        }
                    default:
                        Write(outPath, new Dictionary<string, object> { { "error", "unknown option " + args[0] }, { "options", new[] { "--core-submit --prompt <text> --implementation <id> [--profile <path>] [--timeout-seconds n] [--expect-refusal] --out <file>", "--status-json --out <file>", "--jobs-json --out <file>", "--run-local-inventory <folder> --out <file>", "--run-local-chat <prompt> --model <name> [--device auto|adapter|ollama] [--max-attempts n] [--context-route <first-party url>]... --out <file>", "--verify-receipt --file <job.json> [--trusted-key-id <id> | --any-key] --out <file>", "--device-key --out <file>", "--image-diff --a <png> --b <png> [--diff <png>] [--tolerance n] --out <file>", "--exo-rank-probe --runtime-url http://127.0.0.1:52415 [--node-id node_...] --out <file>", "--parity-audit [--route <url>]... [--width 1280 --height 800] [--dir <folder>] --out <file>" } } });
                        return 2;
                }
            }
            catch (Exception ex)
            {
                store.Log("headless_error", "error", ex.ToString());
                Write(outPath, new Dictionary<string, object> { { "error", ex.GetType().Name + ": " + ex.Message } });
                return 1;
            }
        }

        internal static string WebView2Version()
        {
            try { return CoreWebView2Environment.GetAvailableBrowserVersionString(); }
            catch (Exception ex) { return "unavailable: " + ex.GetType().Name; }
        }

        private static int Write(string path, object payload)
        {
            string text = Json.Pretty(payload);
            if (string.IsNullOrWhiteSpace(path)) path = Path.Combine(JobStore.Default().Root, "last-headless-output.json");
            File.WriteAllText(path, text, new UTF8Encoding(false));
            return 0;
        }

        internal static async Task<Dictionary<string, object>> Status(JobStore store)
        {
            Task<CoreStatus> coreTask = LocalRuntime.ProbeCore();
            Task<OllamaStatus> ollamaTask = LocalRuntime.ProbeOllama();
            Task<NodeAgentStatus> nodeTask = LocalRuntime.ProbeNodeAgent();
            DeviceInventory device = DeviceInventory.Read();
            CoreStatus core = await coreTask;
            OllamaStatus ollama = await ollamaTask;
            NodeAgentStatus node = await nodeTask;
            var models = new List<object>();
            foreach (OllamaModel m in ollama.Models) models.Add(new Dictionary<string, object> { { "name", m.Name }, { "size_bytes", m.SizeBytes }, { "parameter_size", m.ParameterSize }, { "quantization", m.Quantization }, { "digest", m.Digest } });
            var payload = new Dictionary<string, object>();
            payload["schema"] = "mccluster-desktop-status/1";
            payload["checked_at"] = JobStore.Now();
            payload["client"] = "mccluster-desktop/" + typeof(Headless).Assembly.GetName().Version.ToString(3);
            payload["core"] = new Dictionary<string, object> {
                { "api_health", new Dictionary<string, object> { { "url", LocalRuntime.ApiHealth }, { "reachable", core.Api.Reachable }, { "detail", core.Api.Detail }, { "deployment_sha", core.DeploymentSha } } },
                { "compute_gateway_health", new Dictionary<string, object> { { "url", LocalRuntime.ComputeHealth }, { "reachable", core.ComputeGateway.Reachable }, { "status", core.ComputeGateway.StatusCode }, { "detail", core.ComputeGateway.Detail } } },
                { "reachable", core.Reachable } };
            payload["device"] = device.ToProtocolInventory(ollama.GpuEvidence);
            payload["hardware_mode"] = device.HardwareMode(ollama.GpuEvidence);
            payload["local_runtime"] = new Dictionary<string, object> { { "ollama_url", ollama.Url }, { "reachable", ollama.Reachable }, { "version", ollama.Version }, { "detail", ollama.Detail }, { "loaded", ollama.LoadedSummary }, { "gpu_evidence", ollama.GpuEvidence }, { "models", models }, { "local_inference_available", ollama.Reachable && models.Count > 0 } };
            payload["node_agent"] = new Dictionary<string, object> { { "state_dir", node.StateDir }, { "state_dir_exists", node.StateDirExists }, { "manifest_present", node.ManifestPresent }, { "config_present", node.ConfigPresent }, { "identity_present", node.IdentityPresent }, { "node_name", node.NodeName }, { "compute_url", node.ComputeUrl }, { "advertised", node.AdvertisedImplementations }, { "adapter_health", node.Adapter.Detail } };
            // The contribution state the Contribute panel shows (COMPUTE-CONTRIBUTION-LEDGER.md on branch prime/contribution-ledger, not in this tree), read from the state root only.
            Contribution.State contribution = Contribution.ReadState(node.StateDir, store);
            payload["contribution"] = new Dictionary<string, object> {
                { "doctor_found", contribution.DoctorPath != null }, { "installed", contribution.Installed }, { "enrolled", contribution.Enrolled }, { "paused", contribution.Paused },
                { "limits", contribution.Limits == null ? null : contribution.Limits.Summary(contribution.ThermalSupported) }, { "limits_error", contribution.LimitsError },
                { "thermal_supported", contribution.ThermalSupported }, { "claim_gate", contribution.ClaimGate },
                { "last_heartbeat_at", contribution.LastHeartbeatAt.HasValue ? contribution.LastHeartbeatAt.Value.ToString("o") : null }, { "node_id", contribution.NodeIdForDisplay },
                { "local_done_receipts", contribution.LocalDoneReceipts }, { "accepted_work_file", contribution.AcceptedWork }, { "revoked_at", contribution.RevokedAt } };
            payload["targets"] = new Dictionary<string, object> {
                { JobTarget.LocalDevice, new Dictionary<string, object> { { "available", true }, { "kinds", new[] { JobKind.Inventory, ollama.Reachable && models.Count > 0 ? JobKind.Chat : JobKind.Chat + " (unavailable: no local model)" } } } },
                { JobTarget.RemoteWorker, new Dictionary<string, object> { { "available", core.Reachable }, { "reason", core.Reachable ? "submit from the signed-in site surface" : "OVH Core unreachable" } } },
                { JobTarget.VerifiedGroup, new Dictionary<string, object> { { "available", false }, { "reason", core.Reachable ? "requires two verified members and a pair benchmark on the owner surface" : "OVH Core unreachable" } } } };
            payload["policy"] = "local jobs only while the Core is unreachable; drafts and receipts kept on device; no hosted inference fallback";
            store.Log("status_probe_headless", new Dictionary<string, object> { { "core_reachable", core.Reachable }, { "ollama", ollama.Reachable }, { "models", models.Count } });
            return payload;
        }
    }

    internal sealed class DesktopWindow : Form
    {
        private readonly WebView2 view = new WebView2();
        private readonly ToolStrip bar = new ToolStrip();
        private readonly ToolStripButton back = new ToolStripButton("Back");
        private readonly ToolStripButton forward = new ToolStripButton("Forward");
        private readonly ToolStripButton reload = new ToolStripButton("Reload");
        private readonly ToolStripButton home = new ToolStripButton("Home");
        private readonly ToolStripButton browser = new ToolStripButton("Open in browser");
        private readonly ToolStripButton compute = new ToolStripButton("Compute");
        private readonly ToolStripButton chat = new ToolStripButton("Chat");
        private PrimeChatForm chatWindow;
        private readonly ToolStripLabel origin = new ToolStripLabel("mccluster.org");
        private readonly JobStore store;
        private readonly StatusPanel panel;
        private bool noticePending;
        private string startupPage = NavigationPolicy.Home;
        private bool webViewUnavailable;
        private bool navigationReady;

        internal DesktopWindow() : this(JobStore.Default()) { }

        internal DesktopWindow(JobStore store)
        {
            this.store = store;
            Text = "EquityNet";
            Width = 1350;
            Height = 870;
            MinimumSize = new Size(520, 570);
            StartPosition = FormStartPosition.CenterScreen;
            view.Dock = DockStyle.Fill;
            view.DefaultBackgroundColor = Color.FromArgb(11, 9, 8);
            bar.Dock = DockStyle.Top;
            bar.GripStyle = ToolStripGripStyle.Hidden;
            compute.CheckOnClick = true;
            compute.Checked = true;
            bar.Items.AddRange(new ToolStripItem[] { back, forward, reload, home, new ToolStripSeparator(), browser, chat, compute, new ToolStripSeparator(), origin });
            panel = new StatusPanel(store, Navigate);
            Controls.Add(view);
            Controls.Add(panel);
            Controls.Add(bar);
            back.Click += delegate { if (view.CanGoBack) view.GoBack(); };
            forward.Click += delegate { if (view.CanGoForward) view.GoForward(); };
            reload.Click += delegate { if (view.CoreWebView2 != null) view.Reload(); else Close(); };
            home.Click += delegate { Navigate(NavigationPolicy.Home); };
            browser.Click += delegate { OpenBrowser(NavigationPolicy.BrowserPage(view.Source == null ? null : view.Source.AbsoluteUri)); };
            compute.CheckedChanged += delegate { panel.Visible = compute.Checked; };
            chat.Click += delegate
            {
                if (chatWindow != null && !chatWindow.IsDisposed) { chatWindow.Show(); chatWindow.Activate(); return; }
                chatWindow = new PrimeChatForm(store,
                    delegate { compute.Checked = false; Navigate(NavigationPolicy.OwnerChat); },
                    delegate { compute.Checked = false; Navigate(NavigationPolicy.OwnerProjects); },
                    new OwnerChatTransport(view));
                chatWindow.Show(this);
            };
            SetNavigationButtons();
            Shown += Initialize;
            FormClosed += delegate { store.Log("window_closed", null); };
        }

        private void Navigate(string url)
        {
            if (!NavigationPolicy.IsPanelDestination(url)) return;
            if (webViewUnavailable)
            {
                ShowNotice("The signed-in workspace needs WebView2. Reopen EquityNet after restoring the runtime. Your local chat is available in this app.");
                return;
            }
            // A panel click during startup must survive until navigation
            // protection and the first-party account profile are ready.
            startupPage = url;
            if (navigationReady) view.CoreWebView2.Navigate(url);
        }

        private async void Initialize(object sender, EventArgs args)
        {
            store.Log("window_opened", "version", typeof(DesktopWindow).Assembly.GetName().Version.ToString(3));
            List<LocalJob> recovered = store.RecoverInterrupted();
            if (recovered.Count > 0) store.Log("interrupted_jobs_recovered", "count", recovered.Count);
            Task status = panel.Probe();
            try
            {
                string userData = Path.Combine(store.Root, "Profile");
                Directory.CreateDirectory(userData);
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userData, null);
                if (IsDisposed) return;
                await view.EnsureCoreWebView2Async(env);
                if (IsDisposed) return;
                CoreWebView2 engine = view.CoreWebView2;
                // No host objects, no web messages: the site session never crosses into native code.
                engine.Settings.AreHostObjectsAllowed = false;
                engine.Settings.IsWebMessageEnabled = false;
                engine.Settings.AreDevToolsEnabled = false;
                engine.Settings.IsSwipeNavigationEnabled = true;
                view.AllowExternalDrop = false;
                engine.NavigationStarting += delegate(object s, CoreWebView2NavigationStartingEventArgs evt)
                {
                    Uri dest = NavigationPolicy.HttpsTarget(evt.Uri);
                    if (NavigationPolicy.IsFirstParty(dest)) return;
                    evt.Cancel = true;
                    store.Log("navigation_blocked", "host", dest == null ? "(invalid)" : dest.IdnHost);
                    if (dest != null && (evt.IsUserInitiated || NavigationPolicy.IsProviderLogin(dest)))
                        AskAboutExternal(dest);
                };
                engine.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs evt)
                {
                    evt.Handled = true;
                    Uri dest = NavigationPolicy.HttpsTarget(evt.Uri);
                    if (dest == null || !evt.IsUserInitiated) return;
                    if (NavigationPolicy.IsFirstParty(dest))
                        BeginInvoke((Action)delegate { if (!IsDisposed) engine.Navigate(dest.AbsoluteUri); });
                    else
                        AskAboutExternal(dest);
                };
                engine.PermissionRequested += delegate(object s, CoreWebView2PermissionRequestedEventArgs evt)
                {
                    if (!NavigationPolicy.IsFirstParty(NavigationPolicy.HttpsTarget(evt.Uri)))
                        evt.State = CoreWebView2PermissionState.Deny;
                };
                engine.SourceChanged += delegate
                {
                    Uri dest = view.Source;
                    origin.Text = "  " + (NavigationPolicy.IsFirstParty(dest) ? dest.IdnHost : "mccluster.org");
                    SetNavigationButtons();
                };
                engine.HistoryChanged += delegate { SetNavigationButtons(); };
                engine.NavigationCompleted += delegate(object s, CoreWebView2NavigationCompletedEventArgs evt)
                {
                    SetNavigationButtons();
                    Uri current = view.Source;
                    store.Log("navigation_completed", new Dictionary<string, object> { { "ok", evt.IsSuccess }, { "status", evt.WebErrorStatus.ToString() }, { "host", current == null ? null : current.IdnHost }, { "path", current == null ? null : current.AbsolutePath } });
                    if (!evt.IsSuccess && evt.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
                        ShowNotice("Could not load the site (" + evt.WebErrorStatus + "). The Compute panel shows what still runs on this device.");
                };
                navigationReady = true;
                engine.Navigate(startupPage);
                SetNavigationButtons();
            }
            catch (WebView2RuntimeNotFoundException)
            {
                if (IsDisposed) return;
                webViewUnavailable = true;
                store.Log("webview2_runtime_missing", null);
                MessageBox.Show(this, "The Microsoft Edge WebView2 Runtime is missing. Install the official Evergreen Runtime from Microsoft, then reopen EquityNet. Local jobs in the Compute panel still work.",
                    "Microsoft WebView2 required", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                webViewUnavailable = true;
                store.Log("webview2_error", "error", ex.GetType().Name);
                if (!IsDisposed)
                    MessageBox.Show(this, "EquityNet could not open its WebView2 session (" + ex.GetType().Name + "). You can still use Open in browser and the Compute panel.",
                        "EquityNet", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            await status;
        }

        private void SetNavigationButtons()
        {
            back.Enabled = view.CanGoBack;
            forward.Enabled = view.CanGoForward;
            reload.Enabled = view.CoreWebView2 != null;
            home.Enabled = view.CoreWebView2 != null;
        }

        private void AskAboutExternal(Uri uri)
        {
            if (noticePending || IsDisposed) return;
            noticePending = true;
            BeginInvoke((Action)delegate
            {
                try
                {
                    if (IsDisposed) return;
                    if (NavigationPolicy.IsProviderLogin(uri))
                    {
                        if (MessageBox.Show(this,
                            "Social sign-in uses your regular browser. Open the McCluster sign-in page there? That browser session does not sign you into this desktop window.",
                            "Open sign-in in browser", MessageBoxButtons.YesNo, MessageBoxIcon.Information,
                            MessageBoxDefaultButton.Button2) == DialogResult.Yes)
                            OpenBrowser(new Uri("https://mccluster.org/account.html"));
                    }
                    else if (MessageBox.Show(this, "Open " + uri.IdnHost + " in your default browser?", "External website",
                        MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) == DialogResult.Yes)
                        OpenBrowser(uri);
                }
                finally { noticePending = false; }
            });
        }

        private void ShowNotice(string text)
        {
            if (noticePending || IsDisposed) return;
            noticePending = true;
            BeginInvoke((Action)delegate
            {
                try { if (!IsDisposed) MessageBox.Show(this, text, "EquityNet", MessageBoxButtons.OK, MessageBoxIcon.Information); }
                finally { noticePending = false; }
            });
        }

        private void OpenBrowser(Uri value)
        {
            try { Process.Start(new ProcessStartInfo(value.AbsoluteUri) { UseShellExecute = true }); }
            catch (Exception) { ShowNotice("Windows could not open the default web browser."); }
        }
    }
}
