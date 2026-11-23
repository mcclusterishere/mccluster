using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace McClusterDesktop
{
    // The native "Compute" panel beside the web view. It shows what can still run
    // when the OVH Core is unreachable, keeps drafts and job receipts on this device,
    // and routes remote work to the site's own signed-in owner surface. It never
    // bridges the WebView2 session, never stores credentials, and never calls a
    // hosted inference API.
    internal sealed class StatusPanel : Panel
    {
        private readonly JobStore store;
        private readonly JobRunner runner;
        private readonly Action<string> navigate;
        private readonly Label coreLabel = new Label();
        private readonly Label deviceLabel = new Label();
        private readonly Label modelsLabel = new Label();
        private readonly Label nodeLabel = new Label();
        private readonly Label policyLabel = new Label();
        private readonly RadioButton targetLocal = new RadioButton();
        private readonly RadioButton targetRemote = new RadioButton();
        private readonly RadioButton targetGroup = new RadioButton();
        private readonly ComboBox kindBox = new ComboBox();
        private readonly ComboBox modelBox = new ComboBox();
        private readonly ComboBox deviceBox = new ComboBox();
        private readonly TextBox contextBox = new TextBox();
        private readonly TextBox draftBox = new TextBox();
        private readonly TextBox sampleBox = new TextBox();
        private readonly Button runButton = new Button();
        private readonly Button openChatButton = new Button();
        private readonly Button refreshButton = new Button();
        private readonly ListView jobsList = new ListView();
        private readonly TextBox receiptBox = new TextBox();
        private readonly System.Windows.Forms.Timer draftTimer = new System.Windows.Forms.Timer();
        private CoreStatus core;
        private OllamaStatus ollama;
        private NodeAgentStatus node;
        private AdapterStatus adapter;
        private DeviceInventory device;
        private bool draftDirty;
        private CancellationTokenSource running;

        internal StatusPanel(JobStore store, Action<string> navigate)
        {
            this.store = store;
            this.runner = new JobRunner(store);
            this.navigate = navigate;
            Width = 420;
            Dock = DockStyle.Right;
            AutoScroll = true;
            BackColor = Color.FromArgb(24, 22, 20);
            ForeColor = Color.FromArgb(235, 230, 222);
            Padding = new Padding(10);

            var layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Top;
            layout.AutoSize = true;
            layout.ColumnCount = 1;
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            Controls.Add(layout);

            layout.Controls.Add(Heading("Connection"));
            layout.Controls.Add(Prepare(coreLabel));
            layout.Controls.Add(Heading("This device"));
            layout.Controls.Add(Prepare(deviceLabel));
            layout.Controls.Add(Heading("Local models (by verified hardware)"));
            layout.Controls.Add(Prepare(modelsLabel));
            layout.Controls.Add(Heading("Enrolled worker on this device"));
            layout.Controls.Add(Prepare(nodeLabel));
            layout.Controls.Add(Heading("Fallback policy"));
            layout.Controls.Add(Prepare(policyLabel));
            policyLabel.Text = "When the OVH Core is unreachable only jobs for this device run. Drafts and receipts stay in %LOCALAPPDATA%\\McClusterDesktop. " +
                               "Nothing is queued for later automatic remote submission, and no hosted inference API is used in place of an owned device.";

            layout.Controls.Add(Heading("Run on"));
            targetLocal.Text = "This device";
            targetRemote.Text = "One remote worker (through the OVH Core)";
            targetGroup.Text = "Verified shared-model group (through the OVH Core)";
            foreach (RadioButton rb in new[] { targetLocal, targetRemote, targetGroup })
            {
                rb.AutoSize = true;
                rb.ForeColor = ForeColor;
                rb.CheckedChanged += delegate { UpdateTargetAvailability(); };
                layout.Controls.Add(rb);
            }
            targetLocal.Checked = true;

            kindBox.DropDownStyle = ComboBoxStyle.DropDownList;
            kindBox.Items.Add(JobKind.Inventory + " (hash a sample folder, no model needed)");
            kindBox.Items.Add(JobKind.Chat + " (local Ollama model)");
            kindBox.SelectedIndex = 0;
            kindBox.Width = 380;
            kindBox.SelectedIndexChanged += delegate { UpdateTargetAvailability(); MarkDraft(); };
            layout.Controls.Add(Heading("Job"));
            layout.Controls.Add(kindBox);

            modelBox.DropDownStyle = ComboBoxStyle.DropDownList;
            modelBox.Width = 380;
            layout.Controls.Add(modelBox);

            deviceBox.DropDownStyle = ComboBoxStyle.DropDownList;
            deviceBox.Items.Add("Auto (adapter if ready, else Ollama directly; failover is recorded)");
            deviceBox.Items.Add("Pick: this device via node adapter (no fallback)");
            deviceBox.Items.Add("Pick: this device via Ollama directly (no fallback)");
            deviceBox.SelectedIndex = 0;
            deviceBox.Width = 380;
            layout.Controls.Add(Caption("Device (Proof Mode: the receipt records requested, chosen and why)"));
            layout.Controls.Add(deviceBox);

            contextBox.Width = 380;
            layout.Controls.Add(Caption("Context routes, first-party only, one per line (read-only evidence, hashed into the receipt)"));
            contextBox.Multiline = true;
            contextBox.Height = 40;
            layout.Controls.Add(contextBox);

            sampleBox.Width = 380;
            sampleBox.Text = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            sampleBox.TextChanged += delegate { MarkDraft(); };
            layout.Controls.Add(Caption("Sample folder (for local.inventory)"));
            layout.Controls.Add(sampleBox);

            draftBox.Multiline = true;
            draftBox.Height = 90;
            draftBox.Width = 380;
            draftBox.ScrollBars = ScrollBars.Vertical;
            draftBox.TextChanged += delegate { MarkDraft(); };
            layout.Controls.Add(Caption("Draft (kept on this device until you clear it)"));
            layout.Controls.Add(draftBox);

            var buttons = new FlowLayoutPanel();
            buttons.AutoSize = true;
            runButton.Text = "Run on this device";
            runButton.AutoSize = true;
            runButton.Click += async delegate { await RunSelected(); };
            openChatButton.Text = "Open Ask McCluster (site)";
            openChatButton.AutoSize = true;
            openChatButton.Click += delegate { navigate(NavigationPolicy.OwnerChat); };
            refreshButton.Text = "Refresh";
            refreshButton.AutoSize = true;
            refreshButton.Click += async delegate { await Probe(); };
            buttons.Controls.Add(runButton);
            buttons.Controls.Add(openChatButton);
            buttons.Controls.Add(refreshButton);
            layout.Controls.Add(buttons);

            layout.Controls.Add(Heading("Jobs on this device"));
            jobsList.View = View.Details;
            jobsList.FullRowSelect = true;
            jobsList.Width = 380;
            jobsList.Height = 150;
            jobsList.Columns.Add("Created (UTC)", 130);
            jobsList.Columns.Add("Kind", 100);
            jobsList.Columns.Add("State", 80);
            jobsList.Columns.Add("Id", 60);
            jobsList.SelectedIndexChanged += delegate { ShowSelectedReceipt(); };
            layout.Controls.Add(jobsList);

            receiptBox.Multiline = true;
            receiptBox.ReadOnly = true;
            receiptBox.ScrollBars = ScrollBars.Both;
            receiptBox.WordWrap = false;
            receiptBox.Width = 380;
            receiptBox.Height = 220;
            receiptBox.Font = new Font(FontFamily.GenericMonospace, 8f);
            layout.Controls.Add(Caption("Receipt"));
            layout.Controls.Add(receiptBox);

            draftTimer.Interval = 1500;
            draftTimer.Tick += delegate { FlushDraft(); };
            draftTimer.Start();
            LoadDraft();
        }

        private Label Heading(string text)
        {
            var label = new Label();
            label.Text = text;
            label.AutoSize = true;
            label.Font = new Font(Font, FontStyle.Bold);
            label.Margin = new Padding(0, 10, 0, 2);
            return label;
        }

        private Label Caption(string text)
        {
            var label = new Label();
            label.Text = text;
            label.AutoSize = true;
            label.ForeColor = Color.FromArgb(180, 174, 165);
            return label;
        }

        private Label Prepare(Label label)
        {
            label.AutoSize = true;
            label.MaximumSize = new Size(380, 0);
            label.Text = "checking…";
            return label;
        }

        private void MarkDraft() { draftDirty = true; }

        private void FlushDraft()
        {
            if (!draftDirty) return;
            draftDirty = false;
            string target = targetRemote.Checked ? JobTarget.RemoteWorker : (targetGroup.Checked ? JobTarget.VerifiedGroup : JobTarget.LocalDevice);
            store.SaveDraft(target, draftBox.Text, SelectedKind(), sampleBox.Text);
        }

        private void LoadDraft()
        {
            Dictionary<string, object> draft = store.LoadDraft();
            if (draft == null) return;
            draftBox.Text = Json.Str(draft, "text") ?? "";
            string sample = Json.Str(draft, "sample_folder");
            if (!string.IsNullOrWhiteSpace(sample)) sampleBox.Text = sample;
            if (Json.Str(draft, "kind") == JobKind.Chat) kindBox.SelectedIndex = 1;
            string target = Json.Str(draft, "target");
            if (target == JobTarget.RemoteWorker) targetRemote.Checked = true;
            else if (target == JobTarget.VerifiedGroup) targetGroup.Checked = true;
            draftDirty = false;
        }

        private string SelectedKind()
        {
            return kindBox.SelectedIndex == 1 ? JobKind.Chat : JobKind.Inventory;
        }

        internal async Task Probe()
        {
            refreshButton.Enabled = false;
            try
            {
                Task<CoreStatus> coreTask = LocalRuntime.ProbeCore();
                Task<OllamaStatus> ollamaTask = LocalRuntime.ProbeOllama();
                Task<NodeAgentStatus> nodeTask = LocalRuntime.ProbeNodeAgent();
                Task<AdapterStatus> adapterTask = LocalRuntime.ProbeAdapter();
                device = await Task.Run(() => DeviceInventory.Read());
                core = await coreTask;
                ollama = await ollamaTask;
                node = await nodeTask;
                adapter = await adapterTask;
                Render();
                store.Log("status_probe", new Dictionary<string, object> {
                    { "api", core.Api.Detail }, { "deployment_sha", core.DeploymentSha }, { "compute_gateway", core.ComputeGateway.Detail },
                    { "ollama", ollama.Reachable ? ollama.Version : ollama.Detail }, { "models", ollama.Models.Count },
                    { "hardware_mode", device.HardwareMode(ollama.GpuEvidence) }, { "node_state_dir_exists", node.StateDirExists } });
            }
            finally { refreshButton.Enabled = true; }
            ReloadJobs();
        }

        private void Render()
        {
            coreLabel.Text = "Public API (api.mccluster.org): " + core.Api.Detail + (core.DeploymentSha != null ? " · deployed " + core.DeploymentSha.Substring(0, 12) : "") + "\n" +
                             "OVH Core compute gateway (compute.mccluster.org): " + core.ComputeGateway.Detail + "\n" +
                             (core.Reachable ? "Remote submission is possible from the signed-in site surface." : "OVH Core UNREACHABLE: remote worker and group jobs are unavailable. Local jobs still run.");
            coreLabel.ForeColor = core.Reachable ? Color.FromArgb(150, 220, 160) : Color.FromArgb(240, 180, 120);

            string gpus = device.Gpus.Where(g => !g.Ignored).Select(g => g.Name + " (" + g.Vendor + ", driver " + g.Driver + ")").DefaultIfEmpty("none found").Aggregate((a, b) => a + "; " + b);
            deviceLabel.Text = device.Hostname + " · " + device.Arch + " · " + device.CpuName + " · " + device.CpuCount + " logical CPUs\n" +
                               "Memory " + Gb(device.MemoryBytes) + " total, " + Gb(device.MemoryFreeBytes) + " free · disk free " + Gb(device.DiskFreeBytes) + "\n" +
                               "GPU: " + gpus + "\nhardware_mode: " + device.HardwareMode(ollama.GpuEvidence) +
                               (ollama.GpuEvidence ? " (a model is loaded in GPU memory)" : " (no model has been seen running on the GPU yet)");

            modelBox.Items.Clear();
            if (!ollama.Reachable)
                modelsLabel.Text = "Local model runtime (Ollama, loopback): not running (" + ollama.Detail + "). Local inference unavailable.";
            else if (ollama.Models.Count == 0)
                modelsLabel.Text = "Ollama " + ollama.Version + " on " + ollama.Url + ": no model installed. Local inference is NOT available until a model is pulled; this panel does not claim otherwise.";
            else
            {
                var lines = new List<string>();
                lines.Add("Ollama " + ollama.Version + " · loaded: " + ollama.LoadedSummary);
                lines.Add("Group: this device [" + device.HardwareMode(ollama.GpuEvidence) + "]");
                foreach (OllamaModel m in ollama.Models)
                {
                    lines.Add("  • " + m.Name + " · " + (m.ParameterSize ?? "?") + " " + (m.Quantization ?? "") + " · " + Gb(m.SizeBytes));
                    modelBox.Items.Add(m.Name);
                }
                if (adapter != null && adapter.Reachable && adapter.Ready)
                    lines.Add("Execution path: node adapter " + adapter.Url + " (" + adapter.Implementations.Count + " implementation(s); the same executor a Core lease calls)");
                else
                    lines.Add("Execution path: direct Ollama (node adapter " + (adapter == null || !adapter.Reachable ? "not running" : "not ready") + ")");
                lines.Add("Remote groups: not reported here. Enrolled devices and verified pairs are listed by the owner's site surface once the Core is reachable.");
                modelsLabel.Text = string.Join("\n", lines);
                if (modelBox.Items.Count > 0) modelBox.SelectedIndex = 0;
            }

            var n = new List<string>();
            n.Add("State dir: " + node.StateDir + (node.StateDirExists ? "" : " (absent)"));
            n.Add("capabilities.json " + (node.ManifestPresent ? "present" : "absent") + " · node.config.json " + (node.ConfigPresent ? "present" : "absent") + " · identity key " + (node.IdentityPresent ? "present (kept local, never shown)" : "absent"));
            if (node.NodeName != null) n.Add("Node " + node.NodeName + (node.Tier != null ? " · tier " + node.Tier : "") + " → " + node.ComputeUrl);
            foreach (string impl in node.AdvertisedImplementations) n.Add("  advertises " + impl);
            n.Add("Loopback adapter 127.0.0.1:" + (Environment.GetEnvironmentVariable("MCCLUSTER_OLLAMA_ADAPTER_PORT") ?? "4790") + ": " + node.Adapter.Detail);
            if (!node.StateDirExists) n.Add("This device is a client only. To make it a worker, run core\\windows\\mccluster-node.ps1 -Install then -Enroll (owner-run; nothing here installs it).");
            nodeLabel.Text = string.Join("\n", n);

            UpdateTargetAvailability();
        }

        private void UpdateTargetAvailability()
        {
            bool online = core != null && core.Reachable;
            targetRemote.Enabled = online;
            // Never selectable here: a verified group needs two verified members and a pair
            // benchmark on the owner surface, which no desktop build can show today (matches --status-json).
            targetGroup.Enabled = false;
            targetRemote.Text = "One remote worker (through the OVH Core)" + (online ? "" : " — unavailable: Core unreachable");
            targetGroup.Text = "Verified shared-model group — unavailable: needs two verified members and a pair benchmark on the owner surface" + (online ? "" : "; Core unreachable");
            if (!online && !targetLocal.Checked) targetLocal.Checked = true;
            bool chat = SelectedKind() == JobKind.Chat;
            modelBox.Visible = chat;
            deviceBox.Visible = chat;
            contextBox.Visible = chat;
            sampleBox.Enabled = !chat;
            if (targetLocal.Checked)
            {
                runButton.Text = "Run on this device";
                runButton.Enabled = !chat || (ollama != null && ollama.Reachable && modelBox.Items.Count > 0);
                openChatButton.Enabled = online;
            }
            else
            {
                runButton.Text = "Submit via signed-in site";
                runButton.Enabled = online;
                openChatButton.Enabled = online;
            }
        }

        private async Task RunSelected()
        {
            FlushDraft();
            if (!targetLocal.Checked)
            {
                // Remote and group work is owned by the OVH Core and submitted by the
                // owner's authenticated site session (core.ai.turn.submit). The native
                // shell deliberately has no token bridge, so it opens that surface.
                store.Log("remote_submission_routed_to_site", "target", targetRemote.Checked ? JobTarget.RemoteWorker : JobTarget.VerifiedGroup);
                try { Clipboard.SetText(draftBox.Text ?? ""); } catch (Exception) { }
                navigate(NavigationPolicy.OwnerChat);
                MessageBox.Show(this, "Remote and group jobs are submitted from the signed-in Ask McCluster surface, which the Core stores and streams back. Your draft was copied to the clipboard.", "Submit via the site", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            if (running != null) { running.Cancel(); return; }
            var input = new Dictionary<string, object>();
            string kind = SelectedKind();
            if (kind == JobKind.Inventory) input["path"] = sampleBox.Text;
            else
            {
                input["prompt"] = draftBox.Text;
                input["model"] = modelBox.SelectedItem as string;
                input["device"] = deviceBox.SelectedIndex == 1 ? DeviceChoice.Adapter : (deviceBox.SelectedIndex == 2 ? DeviceChoice.Ollama : DeviceChoice.Auto);
                var routes = contextBox.Lines.Select(l => l.Trim()).Where(l => l.Length > 0).Cast<object>().ToList();
                if (routes.Count > 0) input["context_routes"] = routes;
            }
            LocalJob job = store.Create(kind, JobTarget.LocalDevice, input);
            running = new CancellationTokenSource();
            runButton.Text = "Cancel";
            try
            {
                await runner.Run(job, j => BeginInvoke((Action)ReloadJobs), running.Token);
            }
            catch (Exception ex)
            {
                store.Log("panel_run_error", "error", ex.GetType().Name + ": " + ex.Message);
            }
            finally
            {
                running = null;
                UpdateTargetAvailability();
                ReloadJobs();
                SelectJob(job.Id);
            }
        }

        internal void ReloadJobs()
        {
            string selected = jobsList.SelectedItems.Count > 0 ? jobsList.SelectedItems[0].Tag as string : null;
            jobsList.BeginUpdate();
            jobsList.Items.Clear();
            foreach (LocalJob job in store.List().Take(50))
            {
                var item = new ListViewItem(new[] { (job.CreatedAt ?? "").Replace("T", " ").Substring(0, Math.Min(19, (job.CreatedAt ?? "").Length)), job.Kind, job.State, job.Id.Substring(4, 8) });
                item.Tag = job.Id;
                jobsList.Items.Add(item);
            }
            jobsList.EndUpdate();
            if (selected != null) SelectJob(selected);
        }

        private void SelectJob(string id)
        {
            foreach (ListViewItem item in jobsList.Items)
                if ((item.Tag as string) == id) { item.Selected = true; item.EnsureVisible(); break; }
            ShowSelectedReceipt();
        }

        private void ShowSelectedReceipt()
        {
            if (jobsList.SelectedItems.Count == 0) { receiptBox.Text = ""; return; }
            LocalJob job = store.Get(jobsList.SelectedItems[0].Tag as string);
            receiptBox.Text = job == null ? "" : Json.Pretty(job.ToDictionary()).Replace("\n", "\r\n");
        }

        private static string Gb(long bytes)
        {
            return (bytes / 1073741824.0).ToString("0.0") + " GiB";
        }
    }
}
