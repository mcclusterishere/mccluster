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
        // Owner-only: shown only while a staging profile exists (CoreJobs.cs). Never production.
        private readonly RadioButton targetStaging = new RadioButton();
        private readonly Label stagingCaption = new Label();
        private readonly ComboBox implementationBox = new ComboBox();
        private bool stagingProfilePresent;
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
        private readonly Label receiptVerdict = new Label();
        // Contribute: consent, device state from the state root, the limits, the doctor's output.
        private readonly Label consentLabel = new Label();
        private readonly Label contributeLabel = new Label();
        private readonly CheckBox idleOnlyBox = new CheckBox();
        private readonly CheckBox onAcBox = new CheckBox();
        private readonly NumericUpDown maxConcurrencyBox = new NumericUpDown();
        private readonly NumericUpDown cpuBusyBox = new NumericUpDown();
        private readonly CheckBox batteryFloorBox = new CheckBox();
        private readonly NumericUpDown batteryFloorValue = new NumericUpDown();
        private readonly NumericUpDown thermalBox = new NumericUpDown();
        private readonly Label limitsSummary = new Label();
        private readonly Button enableButton = new Button();
        private readonly Button pauseButton = new Button();
        private readonly Button revokeButton = new Button();
        private readonly Button applyLimitsButton = new Button();
        private readonly Button openLimitsButton = new Button();
        private readonly TextBox doctorOutput = new TextBox();
        private Contribution.State contribution;
        private bool limitsLoadedFromFile;
        private bool doctorBusy;
        private string deviceKeyId;
        private string deviceKeyError;
        private readonly System.Windows.Forms.Timer draftTimer = new System.Windows.Forms.Timer();
        private CoreStatus core;
        private OllamaStatus ollama;
        private NodeAgentStatus node;
        private AdapterStatus adapter;
        private DeviceInventory device;
        private bool draftDirty;
        // The local job runner and the staging wait each have their own cancellation (PanelRuns).
        private readonly PanelRuns runs = new PanelRuns();

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
            BuildContributeSection(layout);
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
            // Core (staging): its own option, never a relabelled production target. Visible only while
            // %LOCALAPPDATA%\McClusterDesktop\staging\profile.json exists; the profile decides the host,
            // the one CA trusted for it and the file the admin token is read from at call time.
            targetStaging.Text = "Core (staging): owner only, the staging profile's Core, never production";
            targetStaging.AutoSize = true;
            targetStaging.MaximumSize = new Size(380, 0);
            targetStaging.ForeColor = ForeColor;
            targetStaging.CheckedChanged += delegate { UpdateTargetAvailability(); };
            layout.Controls.Add(targetStaging);
            stagingCaption.AutoSize = true;
            stagingCaption.MaximumSize = new Size(380, 0);
            stagingCaption.ForeColor = Color.FromArgb(180, 174, 165);
            stagingCaption.Text = "Implementation the target device advertises (free text; the last one used is kept). The draft below is the prompt.";
            layout.Controls.Add(stagingCaption);
            implementationBox.DropDownStyle = ComboBoxStyle.DropDown;
            implementationBox.Width = 380;
            implementationBox.TextChanged += delegate { UpdateTargetAvailability(); };
            layout.Controls.Add(implementationBox);
            string lastImplementation = LoadLastImplementation();
            if (lastImplementation != null) { implementationBox.Items.Add(lastImplementation); implementationBox.Text = lastImplementation; }
            RefreshStagingProfile();

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
            // The verdict is computed here, by the same verifier the CLI uses, against this device's key.
            receiptVerdict.AutoSize = true;
            receiptVerdict.MaximumSize = new Size(380, 0);
            receiptVerdict.Font = new Font(Font, FontStyle.Bold);
            receiptVerdict.Margin = new Padding(0, 2, 0, 2);
            layout.Controls.Add(receiptVerdict);
            layout.Controls.Add(receiptBox);
            try { using (DeviceKey key = DeviceKey.Load(store.Root)) deviceKeyId = key.KeyId; }
            catch (Exception ex) { deviceKeyError = ex.Message; }

            draftTimer.Interval = 1500;
            draftTimer.Tick += delegate { FlushDraft(); };
            draftTimer.Start();
            LoadDraft();
        }

        // The Contribute section (device side of COMPUTE-CONTRIBUTION-LEDGER.md, which is on branch prime/contribution-ledger, not in this tree). Everything here is at most 380 px
        // wide and wraps, so nothing overflows the 420 px panel (hard rule 14, the WinForms way: no breakpoints,
        // no horizontal overflow at the panel width). The desktop never calls the Core; every action is a run of
        // the doctor with explicit switches, and the credential travels only in that child's environment.
        private void BuildContributeSection(TableLayoutPanel layout)
        {
            layout.Controls.Add(Heading("Contribute (this device as a compute node)"));
            consentLabel.AutoSize = true;
            consentLabel.MaximumSize = new Size(380, 0);
            consentLabel.Text = Contribution.ConsentText;
            layout.Controls.Add(consentLabel);
            layout.Controls.Add(Caption("Device state (read from the node's state root; the doctor is the only thing that writes it)"));
            layout.Controls.Add(Prepare(contributeLabel));

            layout.Controls.Add(Caption("Limits (the node agent enforces them before every claim and reports them in each heartbeat)"));
            var grid = new TableLayoutPanel();
            grid.AutoSize = true;
            grid.ColumnCount = 2;
            grid.MaximumSize = new Size(380, 0);
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 90));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 290));
            idleOnlyBox.Text = "Idle only: no claim while someone is using this device";
            onAcBox.Text = "AC power only: no claim and no start on battery";
            foreach (CheckBox box in new[] { idleOnlyBox, onAcBox, batteryFloorBox })
            {
                box.AutoSize = true;
                box.MaximumSize = new Size(290, 0);
                box.ForeColor = ForeColor;
            }
            batteryFloorBox.Text = "Battery floor (%): no claim under this charge";
            batteryFloorBox.CheckedChanged += delegate { batteryFloorValue.Enabled = batteryFloorBox.Checked; UpdateLimitsSummary(); };
            foreach (NumericUpDown box in new[] { maxConcurrencyBox, cpuBusyBox, batteryFloorValue, thermalBox })
            {
                box.Width = 70;
                box.ValueChanged += delegate { UpdateLimitsSummary(); };
            }
            maxConcurrencyBox.Minimum = 1; maxConcurrencyBox.Maximum = 4; maxConcurrencyBox.Value = 1;
            cpuBusyBox.Minimum = 0; cpuBusyBox.Maximum = 100; cpuBusyBox.Value = 0;
            batteryFloorValue.Minimum = 0; batteryFloorValue.Maximum = 100; batteryFloorValue.Value = 20; batteryFloorValue.Enabled = false;
            thermalBox.Minimum = 0; thermalBox.Maximum = 150; thermalBox.Value = 0;
            idleOnlyBox.CheckedChanged += delegate { UpdateLimitsSummary(); };
            onAcBox.CheckedChanged += delegate { UpdateLimitsSummary(); };
            grid.Controls.Add(new Label { AutoSize = true, Text = "" }, 0, 0); grid.Controls.Add(idleOnlyBox, 1, 0);
            grid.Controls.Add(new Label { AutoSize = true, Text = "" }, 0, 1); grid.Controls.Add(onAcBox, 1, 1);
            grid.Controls.Add(maxConcurrencyBox, 0, 2); grid.Controls.Add(GridCaption("Max concurrency (1 to 4; 1 in the pilot): leases at once"), 1, 2);
            grid.Controls.Add(cpuBusyBox, 0, 3); grid.Controls.Add(GridCaption("CPU busy ceiling (%): no claim while busier; 0 = not set, else 10 to 100"), 1, 3);
            grid.Controls.Add(batteryFloorValue, 0, 4); grid.Controls.Add(batteryFloorBox, 1, 4);
            grid.Controls.Add(thermalBox, 0, 5); grid.Controls.Add(GridCaption("Thermal limit (C): 0 = not set. Best effort: unsupported on this device when no thermal zone can be read, never silently off"), 1, 5);
            layout.Controls.Add(grid);
            layout.Controls.Add(Prepare(limitsSummary));
            limitsSummary.Text = "";

            var buttons = new FlowLayoutPanel();
            buttons.AutoSize = true;
            buttons.MaximumSize = new Size(380, 0);
            buttons.WrapContents = true;
            enableButton.Text = "Enable contribution"; enableButton.AutoSize = true; enableButton.Click += async delegate { await EnableContribution(); };
            pauseButton.Text = "Pause"; pauseButton.AutoSize = true; pauseButton.Click += async delegate { await RunDoctorStep(contribution != null && contribution.Paused ? "resume" : "pause", null, null, null, null); await Probe(); };
            revokeButton.Text = "Revoke"; revokeButton.AutoSize = true; revokeButton.Click += async delegate { await RevokeContribution(); };
            applyLimitsButton.Text = "Apply limits"; applyLimitsButton.AutoSize = true; applyLimitsButton.Click += async delegate { await ApplyLimits(); };
            openLimitsButton.Text = "Open limits"; openLimitsButton.AutoSize = true; openLimitsButton.Click += delegate { OpenLimits(); };
            buttons.Controls.Add(enableButton);
            buttons.Controls.Add(pauseButton);
            buttons.Controls.Add(revokeButton);
            buttons.Controls.Add(applyLimitsButton);
            buttons.Controls.Add(openLimitsButton);
            layout.Controls.Add(buttons);

            layout.Controls.Add(Caption("Doctor output (powershell.exe -NoProfile -ExecutionPolicy Bypass -File <doctor> <switches>; stdout and stderr, read-only)"));
            doctorOutput.Multiline = true;
            doctorOutput.ReadOnly = true;
            doctorOutput.ScrollBars = ScrollBars.Both;
            doctorOutput.WordWrap = false;
            doctorOutput.Width = 380;
            doctorOutput.Height = 120;
            doctorOutput.Font = new Font(FontFamily.GenericMonospace, 8f);
            layout.Controls.Add(doctorOutput);
            SetContributeButtons();
        }

        private Label GridCaption(string text)
        {
            Label label = Caption(text);
            label.MaximumSize = new Size(290, 0);
            label.Margin = new Padding(3, 6, 3, 3);
            return label;
        }

        private Contribution.Limits LimitsFromControls()
        {
            var limits = new Contribution.Limits();
            limits.IdleOnly = idleOnlyBox.Checked;
            limits.OnACOnly = onAcBox.Checked;
            limits.MaxConcurrency = (int)maxConcurrencyBox.Value;
            int cpu = (int)cpuBusyBox.Value;
            limits.CpuBusyPercent = cpu >= 10 ? cpu : 0;
            limits.BatteryFloorPercent = batteryFloorBox.Checked ? (int)batteryFloorValue.Value : -1;
            limits.ThermalLimitC = (int)thermalBox.Value;
            return limits;
        }

        private void LimitsToControls(Contribution.Limits limits)
        {
            idleOnlyBox.Checked = limits.IdleOnly;
            onAcBox.Checked = limits.OnACOnly;
            maxConcurrencyBox.Value = Math.Max(1, Math.Min(4, limits.MaxConcurrency));
            cpuBusyBox.Value = limits.CpuBusyPercent;
            batteryFloorBox.Checked = limits.BatteryFloorPercent != -1;
            batteryFloorValue.Value = limits.BatteryFloorPercent == -1 ? 20 : limits.BatteryFloorPercent;
            thermalBox.Value = Math.Max(0, Math.Min(150, limits.ThermalLimitC));
        }

        private void UpdateLimitsSummary()
        {
            bool? thermal = contribution == null ? null : contribution.ThermalSupported;
            limitsSummary.Text = "Will apply: " + LimitsFromControls().Summary(thermal) + ((int)cpuBusyBox.Value > 0 && (int)cpuBusyBox.Value < 10 ? " (a CPU ceiling under 10 counts as not set)" : "");
        }

        private void RenderContribution()
        {
            if (contribution == null) return;
            var c = contribution;
            var lines = new List<string>();
            lines.Add("Doctor: " + (c.DoctorPath ?? "not found (run from a checkout, or set MCCLUSTER_DOCTOR_PATH); the buttons stay disabled"));
            lines.Add("State root: " + c.StateDir + (c.StateDirExists ? "" : " (absent)"));
            lines.Add("Installed: " + (c.Installed ? "yes" : "no") + " · Enrolled: " + (c.Enrolled ? "yes (identity present, never read here)" : "no") + " · Paused: " + (c.Paused ? "YES (no new claims)" : "no"));
            string limitsText;
            if (c.LimitsError != null) limitsText = "limits.json unreadable (" + c.LimitsError + "): the agent applies the defaults (max concurrency 1, no other limit)";
            else if (c.Limits == null) limitsText = "defaults (no limits.json): max concurrency 1, no other limit";
            else limitsText = c.Limits.Summary(c.ThermalSupported);
            lines.Add("Limits on file: " + limitsText);
            lines.Add("Thermal zone: " + (c.ThermalSupported == null ? "unknown until the agent's first heartbeat" : (c.ThermalSupported == true ? "readable (a thermal limit is enforced)" : "unsupported on this device (a thermal limit is reported as unsupported, never silently off)")));
            lines.Add("Last heartbeat file: " + (c.LastHeartbeatAt.HasValue ? c.LastHeartbeatAt.Value.ToString("u") : "none recorded") + (c.ClaimGate != null ? " · claim gate " + c.ClaimGate : ""));
            lines.Add("Node id: " + (c.NodeIdForDisplay ?? "not reported yet (appears after the agent's first accepted heartbeat)"));
            lines.Add("Accepted work: " + c.LocalDoneReceipts + " local done receipt(s) on this device" + (c.AcceptedWork.HasValue ? " · node accepted-work file: " + c.AcceptedWork.Value : " · node accepted-work file: absent (the Core settles acceptance; the node writes none yet)"));
            if (c.RevokedNodeId != null) lines.Add("Revoked locally at " + c.RevokedAt + " (node " + c.RevokedNodeId + "): revoke it on the Core too.");
            contributeLabel.Text = string.Join("\n", lines);
            if (!limitsLoadedFromFile && c.Limits != null) { LimitsToControls(c.Limits); limitsLoadedFromFile = true; }
            UpdateLimitsSummary();
            SetContributeButtons();
        }

        private void SetContributeButtons()
        {
            bool doctor = contribution != null && contribution.DoctorPath != null && !doctorBusy;
            bool installed = contribution != null && contribution.Installed;
            enableButton.Enabled = doctor;
            pauseButton.Enabled = doctor && installed;
            pauseButton.Text = contribution != null && contribution.Paused ? "Resume" : "Pause";
            revokeButton.Enabled = doctor && installed;
            applyLimitsButton.Enabled = doctor && installed;
            openLimitsButton.Enabled = contribution != null && contribution.StateDirExists;
        }

        private void AppendDoctorOutput(string text)
        {
            doctorOutput.AppendText(text.Replace("\r\n", "\n").Replace("\n", "\r\n") + "\r\n");
        }

        // One doctor run: explicit switches, stdout and stderr into the read-only box, never the credential.
        private async Task<Contribution.DoctorResult> RunDoctorStep(string action, Contribution.Limits limits, string repoPath, string orgId, string enrollToken)
        {
            if (contribution == null || contribution.DoctorPath == null) { AppendDoctorOutput("no doctor found; nothing ran"); return null; }
            List<string> args;
            try { args = Contribution.DoctorArgs(action, contribution.StateDir, limits, repoPath, orgId); }
            catch (ArgumentException ex) { AppendDoctorOutput("refused before running: " + ex.Message); return null; }
            doctorBusy = true;
            SetContributeButtons();
            try
            {
                AppendDoctorOutput("> powershell.exe " + Contribution.CommandLine(contribution.DoctorPath, args));
                Contribution.DoctorResult result = await Contribution.RunDoctor(contribution.DoctorPath, args, enrollToken, action == "enroll" || action == "install" ? 240000 : 90000, store);
                if (result.StdOut.Trim().Length > 0) AppendDoctorOutput(result.StdOut.TrimEnd());
                if (result.StdErr.Trim().Length > 0) AppendDoctorOutput("[stderr] " + result.StdErr.TrimEnd());
                AppendDoctorOutput(result.TimedOut ? "timed out and was stopped" : "exit " + result.ExitCode);
                return result;
            }
            finally
            {
                doctorBusy = false;
                SetContributeButtons();
            }
        }

        private async Task EnableContribution()
        {
            if (contribution == null || contribution.DoctorPath == null) return;
            string repo = Contribution.RepoRootFromDoctor(contribution.DoctorPath);
            Contribution.Limits limits = LimitsFromControls();
            try { limits.Validate(); } catch (ArgumentException ex) { AppendDoctorOutput("limits refused: " + ex.Message); return; }
            string token = null;
            string orgId = null;
            using (var dialog = new EnableContributionDialog(limits.Summary(contribution.ThermalSupported), !contribution.Installed, repo != null))
            {
                DialogResult answer = dialog.ShowDialog(this);
                if (answer == DialogResult.OK) { token = dialog.Credential; orgId = dialog.OrgId; }
                dialog.ClearCredential();
                if (answer != DialogResult.OK || string.IsNullOrEmpty(token)) { AppendDoctorOutput("enable cancelled; nothing ran"); return; }
            }
            // C# 5 cannot await inside finally: the chain runs, the token reference is dropped, then the panel re-probes.
            try
            {
                store.Log("contribution_enable_started", new Dictionary<string, object> { { "install_needed", !contribution.Installed }, { "limits", limits.Summary(null) } });
                bool proceed = true;
                if (!contribution.Installed)
                {
                    Contribution.DoctorResult installed = await RunDoctorStep("install", null, repo, orgId, null);
                    if (installed == null || installed.ExitCode != 0) { AppendDoctorOutput("install did not finish; enrolment not attempted"); proceed = false; }
                    else limitsLoadedFromFile = true;
                }
                if (proceed)
                {
                    Contribution.DoctorResult limited = await RunDoctorStep("limits", limits, null, null, null);
                    if (limited == null || limited.ExitCode != 0) { AppendDoctorOutput("limits were not written; enrolment not attempted"); proceed = false; }
                }
                if (proceed) await RunDoctorStep("enroll", null, repo, null, token);
            }
            finally
            {
                token = null;
            }
            await Probe();
        }

        private async Task ApplyLimits()
        {
            Contribution.Limits limits = LimitsFromControls();
            try { limits.Validate(); } catch (ArgumentException ex) { AppendDoctorOutput("limits refused: " + ex.Message); return; }
            await RunDoctorStep("limits", limits, null, null, null);
            limitsLoadedFromFile = true;
            await Probe();
        }

        private async Task RevokeContribution()
        {
            if (contribution == null) return;
            string nodeId = contribution.NodeIdForDisplay;
            string question = "Revoke this device's node" + (nodeId != null ? " " + nodeId : " (node id not reported yet; the doctor prints it)") + "?\n\n" +
                              "The doctor stops and removes the McCluster Node tasks, writes revoked.json and deletes the node's key (identity.json). " +
                              "Afterwards revoke the same node id on the Core. Running work is not waited for.";
            if (MessageBox.Show(this, question, "Revoke contribution", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
            await RunDoctorStep("revoke", null, null, null, null);
            await Probe();
        }

        private void OpenLimits()
        {
            if (contribution == null) return;
            string limitsPath = System.IO.Path.Combine(contribution.StateDir, "limits.json");
            try
            {
                if (System.IO.File.Exists(limitsPath)) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("explorer.exe", "/select," + Contribution.QuoteArg(limitsPath)) { UseShellExecute = false });
                else if (contribution.StateDirExists) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("explorer.exe", Contribution.QuoteArg(contribution.StateDir)) { UseShellExecute = false });
                else AppendDoctorOutput("no state root to open");
            }
            catch (Exception ex) { AppendDoctorOutput("could not open Explorer: " + ex.Message); }
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
            string target = targetStaging.Checked ? JobTarget.CoreStaging : (targetRemote.Checked ? JobTarget.RemoteWorker : (targetGroup.Checked ? JobTarget.VerifiedGroup : JobTarget.LocalDevice));
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
            else if (target == JobTarget.CoreStaging && stagingProfilePresent) targetStaging.Checked = true;
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
                contribution = await Task.Run(() => Contribution.ReadState(LocalRuntime.NodeStateDir(), store));
                core = await coreTask;
                ollama = await ollamaTask;
                node = await nodeTask;
                adapter = await adapterTask;
                Render();
                RenderContribution();
                RefreshStagingProfile();
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
            // While a local job runs or a staging submission waits, the target stays what it was: the
            // radios are disabled until that work ends.
            bool selectable = runs.TargetsSelectable;
            targetLocal.Enabled = selectable;
            targetStaging.Enabled = selectable;
            targetRemote.Enabled = online && selectable;
            // Never selectable here: a verified group needs two verified members and a pair
            // benchmark on the owner surface, which no desktop build can show today (matches --status-json).
            targetGroup.Enabled = false;
            targetRemote.Text = "One remote worker (through the OVH Core)" + (online ? "" : " — unavailable: Core unreachable");
            targetGroup.Text = "Verified shared-model group — unavailable: needs two verified members and a pair benchmark on the owner surface" + (online ? "" : "; Core unreachable");
            if (selectable && !online && (targetRemote.Checked || targetGroup.Checked)) targetLocal.Checked = true;
            bool staging = (stagingProfilePresent || runs.StagingBusy) && targetStaging.Checked;
            stagingCaption.Visible = staging;
            implementationBox.Visible = staging;
            bool chat = SelectedKind() == JobKind.Chat;
            // A staging submission is always one ai.chat job on a device the Core picks: the local job
            // kind, model, device and context controls do not apply to it.
            kindBox.Enabled = !staging;
            modelBox.Visible = chat && !staging;
            deviceBox.Visible = chat && !staging;
            contextBox.Visible = chat && !staging;
            sampleBox.Enabled = !chat && !staging;
            if (staging)
            {
                runButton.Text = runs.StagingBusy ? "Stop waiting" : "Submit to Core (staging)";
                runButton.Enabled = runs.StagingBusy || implementationBox.Text.Trim().Length > 0;
                openChatButton.Enabled = online;
            }
            else if (targetLocal.Checked)
            {
                runButton.Text = runs.LocalBusy ? "Cancel" : "Run on this device";
                runButton.Enabled = runs.LocalBusy || !chat || (ollama != null && ollama.Reachable && modelBox.Items.Count > 0);
                openChatButton.Enabled = online;
            }
            else
            {
                runButton.Text = "Open owner workspace";
                runButton.Enabled = online;
                openChatButton.Enabled = online;
            }
        }

        private async Task RunSelected()
        {
            FlushDraft();
            if ((stagingProfilePresent || runs.StagingBusy) && targetStaging.Checked) { await RunStaging(); return; }
            if (!targetLocal.Checked)
            {
                // Remote and group work is owned by the OVH Core and submitted by the
                // owner's authenticated site session (core.ai.turn.submit). The native
                // shell deliberately has no token bridge, so it opens that surface.
                store.Log("owner_workspace_open_requested", "target", targetRemote.Checked ? JobTarget.RemoteWorker : JobTarget.VerifiedGroup);
                navigate(NavigationPolicy.OwnerChat);
                MessageBox.Show(this, "Sign in to the owner workspace, choose an available target, and send your message there. Your draft stays in the Compute panel.", "Open owner workspace", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            if (runs.LocalBusy) { runs.CancelLocal(); return; }
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
            CancellationToken localToken = runs.StartLocal();
            UpdateTargetAvailability();
            try
            {
                await runner.Run(job, j => BeginInvoke((Action)ReloadJobs), localToken);
            }
            catch (Exception ex)
            {
                store.Log("panel_run_error", "error", ex.GetType().Name + ": " + ex.Message);
            }
            finally
            {
                runs.FinishLocal();
                UpdateTargetAvailability();
                ReloadJobs();
                SelectJob(job.Id);
            }
        }

        // The staging profile can appear or disappear while the app is open (the staging serve script
        // writes it); the option follows the file.
        private void RefreshStagingProfile()
        {
            stagingProfilePresent = CoreProfile.DefaultExists();
            targetStaging.Visible = stagingProfilePresent || runs.StagingBusy;
            // Not while something runs: the target follows the file again when that work ends.
            if (!stagingProfilePresent && targetStaging.Checked && runs.TargetsSelectable) targetLocal.Checked = true;
            UpdateTargetAvailability();
        }

        private string LastImplementationPath()
        {
            return System.IO.Path.Combine(store.Root, "staging", "last-implementation.txt");
        }

        private string LoadLastImplementation()
        {
            try
            {
                if (!System.IO.File.Exists(LastImplementationPath())) return null;
                string text = System.IO.File.ReadAllText(LastImplementationPath()).Trim();
                return text.Length == 0 || text.Length > 200 ? null : text;
            }
            catch (Exception) { return null; }
        }

        private void SaveLastImplementation(string implementation)
        {
            try
            {
                System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(LastImplementationPath()));
                System.IO.File.WriteAllText(LastImplementationPath(), implementation, new System.Text.UTF8Encoding(false));
                if (!implementationBox.Items.Contains(implementation)) implementationBox.Items.Insert(0, implementation);
            }
            catch (Exception) { }
        }

        // One job through the staging Core, by the same client the headless --core-submit uses. The
        // document it returns is shown whole in the receipt box; the lines above it say which physical
        // device ran it, the model and digest, the compute mode, attempts, timing, and what was and was
        // not verified. The document is also kept under core-staging\ beside the local jobs.
        private async Task RunStaging()
        {
            if (runs.StagingBusy) { runs.CancelStaging(); return; }
            string implementation = implementationBox.Text.Trim();
            string prompt = draftBox.Text;
            if (implementation.Length == 0) return;
            if (string.IsNullOrWhiteSpace(prompt))
            {
                receiptVerdict.Text = "Core (staging): write the prompt in the draft box first. Nothing was submitted.";
                receiptVerdict.ForeColor = Color.FromArgb(240, 180, 120);
                return;
            }
            SaveLastImplementation(implementation);
            jobsList.SelectedItems.Clear();
            CancellationToken token = runs.StartStaging();
            UpdateTargetAvailability();
            receiptVerdict.ForeColor = ForeColor;
            receiptVerdict.Text = "Core (staging): submitted through the staging profile; waiting for a device to finish (up to " + CoreSubmit.DefaultTimeoutSeconds + " s)…";
            receiptBox.Text = "";
            string folder = System.IO.Path.Combine(store.Root, "core-staging");
            string file = System.IO.Path.Combine(folder, "core-submit-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + ".json");
            Dictionary<string, object> payload = null;
            string failure = null;
            try
            {
                payload = await Task.Run(() => CoreSubmit.Run(null, prompt, implementation, CoreSubmit.DefaultTimeoutSeconds, false, file, store, token, 1000));
            }
            catch (Exception ex) { failure = ex.GetType().Name + ": " + ex.Message; }
            runs.FinishStaging();
            if (IsDisposed) return;
            if (payload == null)
            {
                receiptVerdict.Text = "Core (staging): " + failure;
                receiptVerdict.ForeColor = Color.Firebrick;
            }
            else
            {
                string text = Json.Pretty(payload);
                try
                {
                    System.IO.Directory.CreateDirectory(folder);
                    System.IO.File.WriteAllText(file, text, new System.Text.UTF8Encoding(false));
                }
                catch (Exception ex) { store.Log("core_staging_document_not_saved", "error", ex.GetType().Name); }
                string state = payload["state"] as string;
                receiptVerdict.Text = CoreSubmit.Summary(payload);
                // Never green: the Core's signature is not checked by this app, and the line says so.
                receiptVerdict.ForeColor = state == "done" ? Color.FromArgb(240, 180, 120) : Color.Firebrick;
                receiptBox.Text = text.Replace("\n", "\r\n");
            }
            RefreshStagingProfile();
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
            if (jobsList.SelectedItems.Count == 0) { receiptBox.Text = ""; receiptVerdict.Text = ""; return; }
            LocalJob job = store.Get(jobsList.SelectedItems[0].Tag as string);
            if (job == null) { receiptBox.Text = ""; receiptVerdict.Text = ""; return; }
            Dictionary<string, object> file = job.ToDictionary();
            receiptBox.Text = Json.Pretty(file).Replace("\n", "\r\n");
            if (job.State == JobState.Running || job.State == JobState.Queued) { receiptVerdict.Text = "Receipt not final: job is " + job.State + "."; receiptVerdict.ForeColor = SystemColors.GrayText; return; }
            if (deviceKeyId == null) { receiptVerdict.Text = "Cannot verify: this device's key is unavailable (" + deviceKeyError + ")."; receiptVerdict.ForeColor = Color.Firebrick; return; }
            try
            {
                Dictionary<string, object> verdict = ReceiptVerifier.Verify(file, deviceKeyId, false);
                receiptVerdict.Text = ReceiptVerifier.Sentence(verdict);
                receiptVerdict.ForeColor = (bool)verdict["verified"] ? Color.DarkGreen : Color.Firebrick;
            }
            catch (Exception ex) { receiptVerdict.Text = "Cannot verify: " + ex.Message; receiptVerdict.ForeColor = Color.Firebrick; }
        }

        private static string Gb(long bytes)
        {
            return (bytes / 1073741824.0).ToString("0.0") + " GiB";
        }
    }

    // The small modal behind "Enable contribution": the masked one-time credential, the organization id when
    // this device is not installed yet, the limits that will apply, and an explicit consent box. The credential
    // is read once by the caller and the box is cleared; it goes to the doctor through the child process
    // environment only, never to a file, a log, a receipt or the clipboard.
    internal sealed class EnableContributionDialog : Form
    {
        private readonly TextBox credentialBox = new TextBox();
        private readonly TextBox orgIdBox = new TextBox();
        private readonly CheckBox consentBox = new CheckBox();
        private readonly Button okButton = new Button();

        internal EnableContributionDialog(string limitsSummary, bool needsInstall, bool repoAvailable)
        {
            Text = "Enable contribution";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterParent;
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;
            Padding = new Padding(12);
            var layout = new TableLayoutPanel();
            layout.AutoSize = true;
            layout.ColumnCount = 1;
            layout.Dock = DockStyle.Fill;
            Controls.Add(layout);

            layout.Controls.Add(Wrapped(Contribution.ConsentText, false));
            layout.Controls.Add(Wrapped("Limits that will apply: " + limitsSummary, true));
            if (needsInstall)
            {
                layout.Controls.Add(Wrapped(repoAvailable
                    ? "This device is not installed as a node yet: the doctor runs -Install first (it needs the organization id from the owner's Core), then -Limits, then -Enroll."
                    : "This device is not installed as a node yet and the doctor found is not inside a checkout, so -Install cannot run from here. Run core\\windows\\mccluster-node.ps1 -Install from a checkout first.", true));
                layout.Controls.Add(Wrapped("Organization id (uuid):", true));
                orgIdBox.Width = 380;
                orgIdBox.TextChanged += delegate { UpdateOk(); };
                layout.Controls.Add(orgIdBox);
            }
            layout.Controls.Add(Wrapped("One-time enrolment credential (shown once by the owner's Core; typed once, never stored by this app):", true));
            credentialBox.Width = 380;
            credentialBox.UseSystemPasswordChar = true;
            credentialBox.TextChanged += delegate { UpdateOk(); };
            layout.Controls.Add(credentialBox);
            consentBox.AutoSize = true;
            consentBox.MaximumSize = new Size(380, 0);
            consentBox.Text = "I have read what runs on this device, which work it accepts (public workload class), my limits, that no credential or tool permission beyond the executor contract is sent here, and that Pause and Revoke are one click away. Enable contribution.";
            consentBox.CheckedChanged += delegate { UpdateOk(); };
            layout.Controls.Add(consentBox);
            var buttons = new FlowLayoutPanel();
            buttons.AutoSize = true;
            okButton.Text = "OK: run the doctor";
            okButton.AutoSize = true;
            okButton.Enabled = false;
            okButton.DialogResult = DialogResult.OK;
            var cancel = new Button();
            cancel.Text = "Cancel";
            cancel.AutoSize = true;
            cancel.DialogResult = DialogResult.Cancel;
            buttons.Controls.Add(okButton);
            buttons.Controls.Add(cancel);
            layout.Controls.Add(buttons);
            AcceptButton = okButton;
            CancelButton = cancel;
            NeedsInstall = needsInstall;
        }

        private readonly bool NeedsInstall;

        private Label Wrapped(string text, bool dim)
        {
            var label = new Label();
            label.AutoSize = true;
            label.MaximumSize = new Size(380, 0);
            label.Text = text;
            label.Margin = new Padding(0, 4, 0, 4);
            if (dim) label.ForeColor = SystemColors.GrayText;
            return label;
        }

        private void UpdateOk()
        {
            okButton.Enabled = consentBox.Checked && credentialBox.Text.Trim().Length > 0 && (!NeedsInstall || orgIdBox.Text.Trim().Length > 0);
        }

        internal string Credential { get { return credentialBox.Text.Trim(); } }
        internal string OrgId { get { return orgIdBox.Text.Trim(); } }
        internal void ClearCredential() { credentialBox.Clear(); }
    }
}
