using System;
using System.Collections.Generic;
using System.Drawing;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace McClusterDesktop
{
    internal sealed class PrimeChatForm : Form
    {
        private readonly JobStore store;
        private readonly JobRunner runner;
        private LocalConversation session = new LocalConversation();
        private readonly ComboBox models = new ComboBox();
        private readonly RichTextBox transcript = new RichTextBox();
        private readonly TextBox prompt = new TextBox();
        private readonly Label status = new Label();
        private readonly Button send = new Button();
        private readonly Button stop = new Button();
        private readonly Button receipt = new Button();
        private readonly Button refresh = new Button();
        private readonly Button newChat = new Button();
        private readonly Button ownerWorkspace = new Button();
        private readonly Font speakerFont;
        private readonly Color muted = Color.FromArgb(191, 191, 192);
        private readonly Color accent = Color.FromArgb(137, 216, 190);
        private CancellationTokenSource active;
        private bool checking;
        private bool closeAfterStop;
        private LocalJob latest;

        internal PrimeChatForm(JobStore store, Action openOwnerWorkspace)
        {
            this.store = store;
            runner = new JobRunner(store);
            Text = "Equity Fighter · EquityNet";
            Name = "primeChat";
            AutoScaleMode = AutoScaleMode.Dpi;
            Size = new Size(720, 650);
            MinimumSize = new Size(374, 500);
            StartPosition = FormStartPosition.CenterParent;
            BackColor = Color.FromArgb(30, 31, 32);
            ForeColor = Color.WhiteSmoke;
            Font = new Font("Segoe UI", 10f);
            speakerFont = new Font(Font, FontStyle.Bold);

            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(14), ColumnCount = 1, RowCount = 7 };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            for (int i = 0; i < layout.RowCount; i++)
                layout.RowStyles.Add(i == 3 ? new RowStyle(SizeType.Percent, 100) : new RowStyle(SizeType.AutoSize));
            Controls.Add(layout);

            var heading = Row();
            var title = new Label { Text = "Equity Fighter", AutoSize = true, Font = new Font(Font.FontFamily, 19, FontStyle.Bold), Margin = new Padding(0, 0, 16, 4) };
            heading.Controls.Add(title);
            ButtonStyle(ownerWorkspace, "ownerWorkspace", "Owner workspace");
            ownerWorkspace.Click += delegate { openOwnerWorkspace(); Close(); };
            heading.Controls.Add(ownerWorkspace);
            layout.Controls.Add(heading, 0, 0);

            var explanation = new Label { AutoSize = true, Dock = DockStyle.Fill, ForeColor = muted, Margin = new Padding(0, 2, 0, 8),
                Text = "Chat locally on this device. Open the owner workspace to sign in, check Prime pairing and run through OVH." };
            layout.Controls.Add(explanation, 0, 1);
            var modelRow = Row();
            modelRow.Controls.Add(new Label { Text = "Local model", ForeColor = ForeColor, AutoSize = true, Margin = new Padding(0, 7, 6, 0) });
            models.Name = "modelPicker";
            models.AccessibleName = "Local model";
            models.DropDownStyle = ComboBoxStyle.DropDownList;
            models.Width = 166;
            models.SelectedIndexChanged += delegate { UpdateControls(); };
            modelRow.Controls.Add(models);
            ButtonStyle(refresh, "refreshModels", "Refresh");
            refresh.Click += async delegate { await ProbeModels(); };
            modelRow.Controls.Add(refresh);
            ButtonStyle(newChat, "newChat", "New chat");
            newChat.Click += delegate { session = new LocalConversation(); latest = null; transcript.Clear(); status.Text = "New local chat."; UpdateControls(); prompt.Focus(); };
            modelRow.Controls.Add(newChat);
            layout.Controls.Add(modelRow, 0, 2);

            transcript.Name = "conversation";
            transcript.AccessibleName = "Local conversation";
            transcript.ReadOnly = true;
            transcript.Multiline = true;
            transcript.DetectUrls = false;
            transcript.BackColor = Color.FromArgb(22, 23, 24);
            transcript.ForeColor = ForeColor;
            transcript.BorderStyle = BorderStyle.None;
            transcript.Dock = DockStyle.Fill;
            transcript.Margin = new Padding(0, 8, 0, 8);
            layout.Controls.Add(transcript, 0, 3);

            status.Name = "chatStatus";
            status.AccessibleName = "Chat status";
            status.AutoSize = true;
            status.Dock = DockStyle.Fill;
            status.ForeColor = muted;
            status.Text = "Checking local Ollama…";
            layout.Controls.Add(status, 0, 4);
            prompt.Name = "prompt";
            prompt.AccessibleName = "Message";
            prompt.Multiline = true;
            prompt.AcceptsReturn = true;
            prompt.ScrollBars = ScrollBars.Vertical;
            prompt.MaxLength = LocalConversation.MaxPrompt;
            prompt.Height = 65;
            prompt.Dock = DockStyle.Fill;
            prompt.Margin = new Padding(0, 8, 0, 4);
            prompt.TextChanged += delegate { UpdateControls(); };
            prompt.KeyDown += async delegate(object sender, KeyEventArgs e) {
                if (e.Control && e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; if (send.Enabled) await Send(); }
            };
            layout.Controls.Add(prompt, 0, 5);
            var actions = Row();
            ButtonStyle(send, "send", "Send locally");
            send.BackColor = accent;
            send.ForeColor = Color.Black;
            send.Click += async delegate { await Send(); };
            actions.Controls.Add(send);
            ButtonStyle(stop, "stop", "Stop");
            stop.Click += delegate { CancelTurn(); };
            actions.Controls.Add(stop);
            ButtonStyle(receipt, "receipt", "View receipt");
            receipt.Click += delegate { ShowReceipt(); };
            actions.Controls.Add(receipt);
            layout.Controls.Add(actions, 0, 6);

            Shown += async delegate { await ProbeModels(); if (!IsDisposed) prompt.Focus(); };
            FormClosing += delegate(object sender, FormClosingEventArgs e) {
                if (active != null && e.CloseReason == CloseReason.UserClosing)
                {
                    e.Cancel = true;
                    closeAfterStop = true;
                    CancelTurn();
                }
                else if (active != null) active.Cancel();
            };
            FormClosed += delegate { speakerFont.Dispose(); };
            UpdateControls();
        }

        private static FlowLayoutPanel Row()
        {
            return new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, WrapContents = true, Margin = Padding.Empty };
        }

        private void ButtonStyle(Button button, string name, string caption)
        {
            button.Name = name;
            button.Text = caption;
            button.AutoSize = true;
            button.FlatStyle = FlatStyle.Flat;
            button.BackColor = BackColor;
            button.ForeColor = ForeColor;
            button.FlatAppearance.BorderColor = Color.DimGray;
            button.Margin = new Padding(0, 2, 6, 2);
        }

        private async Task ProbeModels()
        {
            if (checking || active != null) return;
            checking = true;
            UpdateControls();
            string selected = models.SelectedItem as string;
            try
            {
                OllamaStatus observed = await LocalRuntime.ProbeOllama();
                if (IsDisposed) return;
                models.Items.Clear();
                foreach (OllamaModel model in observed.Models)
                    if (!string.IsNullOrEmpty(model.Name)) models.Items.Add(model.Name);
                if (selected != null && models.Items.Contains(selected)) models.SelectedItem = selected;
                else if (models.Items.Count > 0) models.SelectedIndex = 0;
                status.Text = !observed.Reachable ? "Local Ollama is offline. Start it and refresh." :
                    models.Items.Count == 0 ? "Ollama has no installed models. Refresh after installing a model." :
                    "Local Ollama is ready. Receipts are saved in Compute.";
            }
            catch (Exception ex)
            {
                if (!IsDisposed) { models.Items.Clear(); status.Text = "Local model check failed. " + ex.Message; }
            }
            finally { checking = false; if (!IsDisposed) UpdateControls(); }
        }

        private void UpdateControls()
        {
            bool idle = active == null;
            prompt.Enabled = idle;
            models.Enabled = idle && !checking && models.Items.Count > 0;
            send.Enabled = models.Enabled && !string.IsNullOrWhiteSpace(prompt.Text);
            stop.Enabled = !idle && !active.IsCancellationRequested;
            receipt.Enabled = latest != null && latest.Receipt != null && idle;
            refresh.Enabled = idle && !checking;
            newChat.Enabled = idle && !checking && session.Turns.Count > 0;
            ownerWorkspace.Enabled = idle;
        }

        private void CancelTurn()
        {
            if (active == null) return;
            active.Cancel();
            status.Text = "Stopping the local turn…";
            UpdateControls();
        }

        private void Append(string speaker, string message, Color color)
        {
            transcript.Select(transcript.TextLength, 0);
            transcript.SelectionFont = speakerFont;
            transcript.SelectionColor = color;
            transcript.AppendText(speaker + Environment.NewLine);
            transcript.SelectionFont = Font;
            transcript.SelectionColor = ForeColor;
            transcript.AppendText(message + Environment.NewLine + Environment.NewLine);
            transcript.SelectionStart = transcript.TextLength;
            transcript.ScrollToCaret();
        }

        private async Task Send()
        {
            if (!send.Enabled || active != null) return;
            string question = prompt.Text.Trim();
            string selected = models.SelectedItem as string;
            active = new CancellationTokenSource();
            UpdateControls();
            try
            {
                LocalJob job = session.Create(store, selected, question);
                latest = job;
                prompt.Clear();
                Append("You", question, muted);
                status.Text = "Running " + selected + " on this device…";
                await runner.Run(job, null, active.Token);
                if (IsDisposed) return;
                string verdict;
                using (DeviceKey key = DeviceKey.Load(store.Root))
                {
                    bool verified = LocalConversation.Verifies(job, key.KeyId);
                    verdict = verified ? "Receipt verified" : "Receipt unverified";
                    if (job.State == JobState.Done && verified)
                    {
                        Append("McCluster", Json.Str(job.Result, "content"), accent);
                        string served = Json.Str(job.Receipt, "model") ?? "unknown";
                        string hardware = Json.Str(job.Receipt, "hardware_mode") ?? "unknown";
                        Append(verdict, "Selected " + selected + " · Served by local Ollama · " + served + " · " + hardware + Environment.NewLine + job.Id, muted);
                    }
                    else Append("Turn ended", job.Error ?? "The local answer could not be verified.", muted);
                }
                status.Text = verdict + " · " + job.State;
            }
            catch (Exception ex) { if (!IsDisposed) { status.Text = "Local chat failed."; Append("Local chat", ex.Message, muted); } }
            finally
            {
                active.Dispose();
                active = null;
                if (!IsDisposed)
                {
                    UpdateControls();
                    if (closeAfterStop) Close();
                    else prompt.Focus();
                }
            }
        }

        private void ShowReceipt()
        {
            if (latest == null || latest.Receipt == null) return;
            using (var dialog = new Form { Text = "Local job receipt", Size = new Size(650, 480), StartPosition = FormStartPosition.CenterParent })
            using (var details = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both, WordWrap = false, Dock = DockStyle.Fill,
                Text = Json.Pretty(latest.Receipt).Replace("\n", Environment.NewLine) })
            {
                dialog.Controls.Add(details);
                dialog.ShowDialog(this);
            }
        }
    }
}
