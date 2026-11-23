using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
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
                            var input = new Dictionary<string, object> { { "path", Option(args, "--path") ?? args[1] } };
                            LocalJob job = store.Create(JobKind.Inventory, JobTarget.LocalDevice, input);
                            job = new JobRunner(store).Run(job, null, CancellationToken.None).Result;
                            Write(outPath, job.ToDictionary());
                            return job.State == JobState.Done ? 0 : 1;
                        }
                    case "--run-local-chat":
                        {
                            store.RecoverInterrupted();
                            var input = new Dictionary<string, object> { { "prompt", Option(args, "--prompt") ?? args[1] }, { "model", Option(args, "--model") } };
                            LocalJob job = store.Create(JobKind.Chat, JobTarget.LocalDevice, input);
                            job = new JobRunner(store).Run(job, null, CancellationToken.None).Result;
                            Write(outPath, job.ToDictionary());
                            return job.State == JobState.Done ? 0 : 1;
                        }
                    default:
                        Write(outPath, new Dictionary<string, object> { { "error", "unknown option " + args[0] }, { "options", new[] { "--status-json --out <file>", "--jobs-json --out <file>", "--run-local-inventory <folder> --out <file>", "--run-local-chat <prompt> --model <name> --out <file>" } } });
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
        private readonly ToolStripLabel origin = new ToolStripLabel("mccluster.org");
        private readonly JobStore store = JobStore.Default();
        private readonly StatusPanel panel;
        private bool noticePending;

        internal DesktopWindow()
        {
            Text = "McCluster";
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
            bar.Items.AddRange(new ToolStripItem[] { back, forward, reload, home, new ToolStripSeparator(), browser, compute, new ToolStripSeparator(), origin });
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
            SetNavigationButtons();
            Shown += Initialize;
            FormClosed += delegate { store.Log("window_closed", null); };
        }

        private void Navigate(string url)
        {
            if (view.CoreWebView2 != null) view.CoreWebView2.Navigate(url);
        }

        private async void Initialize(object sender, EventArgs args)
        {
            store.Log("window_opened", "version", typeof(DesktopWindow).Assembly.GetName().Version.ToString(3));
            List<LocalJob> recovered = store.RecoverInterrupted();
            if (recovered.Count > 0) store.Log("interrupted_jobs_recovered", "count", recovered.Count);
            Task status = panel.Probe();
            try
            {
                string userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "McClusterDesktop", "Profile");
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
                engine.Navigate(NavigationPolicy.Home);
                SetNavigationButtons();
            }
            catch (WebView2RuntimeNotFoundException)
            {
                if (IsDisposed) return;
                store.Log("webview2_runtime_missing", null);
                MessageBox.Show(this, "The Microsoft Edge WebView2 Runtime is missing. Install the official Evergreen Runtime from Microsoft, then reopen McCluster. Local jobs in the Compute panel still work.",
                    "Microsoft WebView2 required", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                store.Log("webview2_error", "error", ex.GetType().Name + ": " + ex.Message);
                if (!IsDisposed)
                    MessageBox.Show(this, "McCluster could not open its WebView2 session (" + ex.GetType().Name + "). You can still use Open in browser and the Compute panel.",
                        "McCluster", MessageBoxButtons.OK, MessageBoxIcon.Warning);
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
                try { if (!IsDisposed) MessageBox.Show(this, text, "McCluster", MessageBoxButtons.OK, MessageBoxIcon.Information); }
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
