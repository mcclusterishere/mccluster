using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace McClusterDesktop
{
    internal sealed class PrimeChatForm : Form
    {
        private static readonly string[] Routes = { "local", "prime", "ovh", "connected" };
        private static readonly string[] RouteNames = { "Prime (local only)", "Prime via OVH", "OVH CPU", "Connected inference" };
        private sealed class RemoteTurn
        {
            internal string MessageId = Guid.NewGuid().ToString("D");
            internal string Question;
            internal OwnerChatRun Run;
        }
        private sealed class ThreadView
        {
            internal LocalConversation Local = new LocalConversation();
            internal string CoreId = Guid.NewGuid().ToString("D");
            internal string Route = "local";
            internal string LocalModel;
            internal OwnerChatTarget Binding;
            internal readonly List<RemoteTurn> Remote = new List<RemoteTurn>();
            internal string Draft = "";
            internal bool Started { get { return Local.Turns.Count > 0 || Remote.Count > 0; } }
            public override string ToString()
            {
                if (Route == "local") return Local.Label;
                string title = Remote.Count == 0 ? "New chat" : Remote[0].Question.Replace('\r', ' ').Replace('\n', ' ');
                return (title.Length <= 46 ? title : title.Substring(0, 45) + "…") + " · " + RouteNames[Array.IndexOf(Routes, Route)];
            }
        }
        private sealed class Endpoint
        {
            internal OwnerChatTarget Value;
            public override string ToString() { return Value.Name + " · " + Value.Model; }
        }
        private readonly JobStore store;
        private readonly JobRunner runner;
        private readonly IOwnerChatTransport core;
        private readonly List<string> localModels = new List<string>();
        private List<OwnerChatTarget> endpoints = new List<OwnerChatTarget>();
        private readonly List<ThreadView> threads = new List<ThreadView>();
        private ThreadView current;
        private readonly ComboBox threadPicker = Picker("threadPicker", "Chat", 196);
        private readonly ComboBox targets = Picker("targetPicker", "Run on", 150);
        private readonly ComboBox models = Picker("modelPicker", "Model or worker", 176);
        private readonly RichTextBox transcript = new RichTextBox();
        private readonly TextBox prompt = new TextBox();
        private readonly Label status = new Label();
        private readonly Button send = new Button();
        private readonly Button stop = new Button();
        private readonly Button receipt = new Button();
        private readonly Button refresh = new Button();
        private readonly Button newChat = new Button();
        private readonly Button ownerWorkspace = new Button();
        private readonly Button projects = new Button();
        private readonly Font speakerFont;
        private readonly Color muted = Color.FromArgb(188, 194, 193);
        private readonly Color accent = Color.FromArgb(139, 226, 194);
        private CancellationTokenSource active;
        private bool checking, rebinding, closeAfterStop;
        private bool firstShown;
        private string coreFailure = "Open the owner workspace to sign in, then refresh.";
        private string localState = "Checking local Ollama…";
        private string latestReceipt;
        private string account;

        internal PrimeChatForm(JobStore store, Action openOwnerWorkspace)
            : this(store, openOwnerWorkspace, null, null) { }

        internal PrimeChatForm(JobStore store, Action openOwnerWorkspace, Action openProjects, IOwnerChatTransport transport)
        {
            this.store = store;
            runner = new JobRunner(store);
            core = transport;
            Text = "Equity Fighter · EquityNet";
            Name = "primeChat";
            AutoScaleMode = AutoScaleMode.Dpi;
            Size = new Size(752, 708);
            MinimumSize = new Size(374, 535);
            StartPosition = FormStartPosition.CenterParent;
            BackColor = Color.FromArgb(27, 31, 31);
            ForeColor = Color.WhiteSmoke;
            Font = new Font("Segoe UI", 10f);
            speakerFont = new Font(Font, FontStyle.Bold);
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(14), ColumnCount = 1, RowCount = 8 };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            for (int i = 0; i < layout.RowCount; i++)
                layout.RowStyles.Add(i == 4 ? new RowStyle(SizeType.Percent, 100) : new RowStyle(SizeType.AutoSize));
            Controls.Add(layout);

            var header = Row();
            header.Controls.Add(new Label { Text = "Equity Fighter", AutoSize = true, Font = new Font(Font.FontFamily, 20, FontStyle.Bold), Margin = new Padding(0, 0, 16, 4) });
            ButtonStyle(ownerWorkspace, "ownerWorkspace", "Owner workspace");
            ownerWorkspace.Click += delegate { Visit(openOwnerWorkspace); };
            header.Controls.Add(ownerWorkspace);
            layout.Controls.Add(header, 0, 0);

            var chatRow = Row();
            chatRow.Controls.Add(Caption("Chats"));
            threadPicker.SelectedIndexChanged += delegate {
                var selected = threadPicker.SelectedItem as ThreadView;
                if (!rebinding && selected != null && selected != current) SelectThread(selected);
            };
            chatRow.Controls.Add(threadPicker);
            ButtonStyle(newChat, "newChat", "New chat");
            newChat.Click += delegate { var added = new ThreadView(); threads.Insert(0, added); SelectThread(added); prompt.Focus(); };
            chatRow.Controls.Add(newChat);
            ButtonStyle(projects, "projects", "Projects");
            projects.Click += delegate { Visit(openProjects); };
            projects.Tag = openProjects;
            chatRow.Controls.Add(projects);
            layout.Controls.Add(chatRow, 0, 1);

            var targetRow = Row();
            targetRow.Controls.Add(Caption("Run on"));
            targets.Items.AddRange(RouteNames);
            targets.SelectedIndexChanged += delegate {
                if (rebinding || current == null || targets.SelectedIndex < 0) return;
                current.Route = Routes[targets.SelectedIndex];
                current.Binding = null;
                BindModels();
                RenderHistory();
                ShowAvailability();
            };
            targetRow.Controls.Add(targets);
            targetRow.Controls.Add(models);
            models.SelectedIndexChanged += delegate {
                if (rebinding || current == null) return;
                if (IsLocal) current.LocalModel = models.SelectedItem as string;
                else { var endpoint = models.SelectedItem as Endpoint; current.Binding = endpoint == null ? null : endpoint.Value; }
                ShowAvailability();
            };
            ButtonStyle(refresh, "refreshModels", "Refresh");
            refresh.Click += async delegate { await Probe(); };
            targetRow.Controls.Add(refresh);
            layout.Controls.Add(targetRow, 0, 2);

            var note = new Label { AutoSize = true, Dock = DockStyle.Fill, ForeColor = muted, Margin = new Padding(0, 3, 0, 5),
                Text = "Local chats stay on this device. Sign in to use Core projects and dispatch. Check Prime pairing in the owner workspace." };
            layout.Controls.Add(note, 0, 3);
            transcript.Name = "conversation";
            transcript.AccessibleName = "Conversation";
            transcript.ReadOnly = true;
            transcript.Multiline = true;
            transcript.DetectUrls = false;
            transcript.BackColor = Color.FromArgb(19, 23, 23);
            transcript.ForeColor = ForeColor;
            transcript.BorderStyle = BorderStyle.None;
            transcript.Dock = DockStyle.Fill;
            transcript.Margin = new Padding(0, 6, 0, 8);
            layout.Controls.Add(transcript, 0, 4);

            status.Name = "chatStatus";
            status.AccessibleName = "Chat status";
            status.AutoSize = true;
            status.Dock = DockStyle.Fill;
            status.ForeColor = muted;
            layout.Controls.Add(status, 0, 5);
            prompt.Name = "prompt";
            prompt.AccessibleName = "Message";
            prompt.Multiline = true;
            prompt.AcceptsReturn = true;
            prompt.ScrollBars = ScrollBars.Vertical;
            prompt.MaxLength = LocalConversation.MaxPrompt;
            prompt.Height = 62;
            prompt.Dock = DockStyle.Fill;
            prompt.Margin = new Padding(0, 6, 0, 4);
            prompt.TextChanged += delegate { if (!rebinding && current != null) current.Draft = prompt.Text; UpdateControls(); };
            prompt.KeyDown += async delegate(object sender, KeyEventArgs e) {
                if (e.Control && e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; if (send.Enabled) await Send(); }
            };
            layout.Controls.Add(prompt, 0, 6);
            var actions = Row();
            ButtonStyle(send, "send", "Send locally");
            send.BackColor = accent; send.ForeColor = Color.Black;
            send.Click += async delegate { await Send(); };
            actions.Controls.Add(send);
            ButtonStyle(stop, "stop", "Stop");
            stop.Click += delegate { StopTurn(); };
            actions.Controls.Add(stop);
            ButtonStyle(receipt, "receipt", "View receipt");
            receipt.Click += delegate { ShowReceipt(); };
            actions.Controls.Add(receipt);
            layout.Controls.Add(actions, 0, 7);

            Shown += async delegate {
                try { foreach (var saved in await Task.Run(() => LocalConversation.Restore(store))) threads.Add(new ThreadView { Local = saved,
                    LocalModel = saved.Turns.Count == 0 ? null : Json.Str(saved.Turns.Last().Input, "model") }); }
                catch (Exception) { localState = "Local chat history could not be verified."; }
                if (IsDisposed) return;
                if (threads.Count == 0) threads.Add(new ThreadView());
                SelectThread(threads[0]);
                firstShown = true;
                await Probe();
                if (!IsDisposed) prompt.Focus();
            };
            VisibleChanged += async delegate { if (Visible && firstShown && active == null && !checking) await Probe(); };
            FormClosing += delegate(object sender, FormClosingEventArgs e) {
                if (active != null && e.CloseReason == CloseReason.UserClosing)
                { e.Cancel = true; closeAfterStop = true; StopTurn(); }
                else if (active != null) active.Cancel();
            };
            FormClosed += delegate { speakerFont.Dispose(); };
            UpdateControls();
        }

        private bool IsLocal { get { return current == null || current.Route == "local"; } }
        private RemoteTurn Pending { get { return current == null || current.Remote.Count == 0 ? null :
            current.Remote.LastOrDefault(t => t.Run == null || t.Run.Status == "pending"); } }

        private static FlowLayoutPanel Row() { return new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, WrapContents = true, Margin = Padding.Empty }; }
        private static Label Caption(string text) { return new Label { Text = text, AutoSize = true, Margin = new Padding(0, 7, 7, 0) }; }
        private static ComboBox Picker(string name, string label, int width)
        {
            return new ComboBox { Name = name, AccessibleName = label, DropDownStyle = ComboBoxStyle.DropDownList, Width = width };
        }
        private void ButtonStyle(Button button, string name, string caption)
        {
            button.Name = name; button.Text = caption; button.AutoSize = true;
            button.FlatStyle = FlatStyle.Flat; button.BackColor = BackColor; button.ForeColor = ForeColor;
            button.FlatAppearance.BorderColor = Color.DimGray; button.Margin = new Padding(0, 2, 6, 2);
        }

        private void Visit(Action open)
        {
            if (open == null || active != null) return;
            if (!IsLocal) transcript.Clear();
            Hide();
            open();
        }

        private void SelectThread(ThreadView next)
        {
            rebinding = true;
            current = next;
            BindThreads();
            targets.SelectedIndex = Array.IndexOf(Routes, current.Route);
            prompt.Text = current.Draft;
            rebinding = false;
            BindModels();
            RenderHistory();
            ShowAvailability();
        }

        private void BindThreads()
        {
            bool wasBinding = rebinding;
            rebinding = true;
            threadPicker.Items.Clear();
            threadPicker.Items.AddRange(threads.Cast<object>().ToArray());
            threadPicker.SelectedItem = current;
            rebinding = wasBinding;
        }

        private static bool SameBinding(OwnerChatTarget a, OwnerChatTarget b)
        {
            return a != null && b != null && a.SessionId == b.SessionId && a.Target == b.Target && a.NodeId == b.NodeId &&
                a.Implementation == b.Implementation && a.Model == b.Model;
        }

        private void BindModels()
        {
            if (current == null) return;
            rebinding = true;
            models.Items.Clear();
            if (IsLocal)
            {
                models.Items.AddRange(localModels.Cast<object>().ToArray());
                if (current.LocalModel == null && models.Items.Count > 0) current.LocalModel = models.Items[0] as string;
                models.SelectedItem = current.LocalModel;
            }
            else
            {
                foreach (OwnerChatTarget value in endpoints.Where(x => x.Target == current.Route))
                {
                    var item = new Endpoint { Value = value };
                    models.Items.Add(item);
                    if (SameBinding(current.Binding, value)) { models.SelectedItem = item; current.Binding = value; }
                }
                if (current.Binding == null && models.Items.Count == 1)
                { models.SelectedIndex = 0; current.Binding = ((Endpoint)models.SelectedItem).Value; }
            }
            rebinding = false;
            UpdateControls();
        }

        private void ClearRemoteViews()
        {
            foreach (ThreadView t in threads.Where(x => x.Route != "local").ToList())
            {
                t.Remote.Clear(); t.Binding = null; t.Draft = ""; t.CoreId = Guid.NewGuid().ToString("D");
                if (t != current) threads.Remove(t);
            }
            if (current != null && !IsLocal) { latestReceipt = null; transcript.Clear(); prompt.Clear(); }
        }

        private async Task Probe()
        {
            if (checking || active != null || current == null) return;
            checking = true; UpdateControls();
            if (!IsLocal) transcript.Clear();
            try
            {
                var local = LocalRuntime.ProbeOllama();
                if (core != null)
                {
                    try
                    {
                        var found = await core.DiscoverAsync();
                        if (IsDisposed) return;
                        var sessionId = found.Select(x => x.SessionId).FirstOrDefault();
                        if (account != null && sessionId != account) ClearRemoteViews();
                        account = sessionId;
                        endpoints = found;
                        coreFailure = "";
                    }
                    catch (Exception ex)
                    {
                        if (IsDisposed) return;
                        endpoints.Clear();
                        if (account != null) ClearRemoteViews();
                        account = null; coreFailure = ex.Message;
                    }
                }
                var observed = await local;
                if (IsDisposed) return;
                localModels.Clear();
                localModels.AddRange(observed.Models.Select(x => x.Name).Where(x => !string.IsNullOrEmpty(x)));
                localState = !observed.Reachable ? "Local Ollama is offline. Start it and refresh." :
                    localModels.Count == 0 ? "Ollama has no installed models." : "Local Ollama is ready. Receipts are saved in Compute.";
            }
            catch (Exception ex) { localModels.Clear(); localState = "Local model check failed. " + ex.Message; }
            finally
            {
                checking = false;
                if (!IsDisposed) SelectThread(current);
            }
        }

        private void ShowAvailability()
        {
            if (current == null) return;
            if (IsLocal) status.Text = models.SelectedIndex < 0 && localModels.Count > 0 ? "Select an installed local model." : localState;
            else if (!string.IsNullOrEmpty(coreFailure)) status.Text = coreFailure;
            else if (models.Items.Count == 0) status.Text = current.Route == "prime" ? "Prime is unavailable through OVH. Check pairing, worker availability and the advertised model." :
                current.Route == "ovh" ? "OVH CPU has no verified model available for this account." : "No connected worker is verified for this account.";
            else if (models.SelectedIndex < 0) status.Text = "Select an available worker and model.";
            else status.Text = Pending == null ? "Owner workspace · durable Core chat" : "Core turn pending. Check its status to reconnect.";
            UpdateControls();
        }

        private void UpdateControls()
        {
            bool idle = current != null && active == null && !checking;
            bool ready = IsLocal ? models.SelectedIndex >= 0 : core != null && models.SelectedItem is Endpoint && SameBinding(current.Binding, ((Endpoint)models.SelectedItem).Value);
            bool pending = !IsLocal && Pending != null;
            prompt.Enabled = idle && !pending;
            models.Enabled = idle && models.Items.Count > 0 && (IsLocal || !current.Started);
            targets.Enabled = idle && !current.Started;
            threadPicker.Enabled = idle;
            newChat.Enabled = idle;
            bool canCheckSaved = pending && Pending.Run != null && core != null && current.Binding != null &&
                current.Binding.SessionId == account && string.IsNullOrEmpty(coreFailure);
            send.Enabled = idle && (canCheckSaved || (ready && (pending || !string.IsNullOrWhiteSpace(prompt.Text))));
            send.Text = pending ? (Pending.Run == null ? "Retry same turn" : "Check Core turn") : (IsLocal ? "Send locally" : "Send via OVH");
            stop.Enabled = active != null && !active.IsCancellationRequested;
            stop.Text = IsLocal ? "Stop" : "Stop waiting";
            receipt.Enabled = active == null && latestReceipt != null;
            refresh.Enabled = idle;
            ownerWorkspace.Enabled = active == null;
            projects.Enabled = projects.Tag != null && active == null;
        }

        private void StopTurn()
        {
            if (active == null) return;
            active.Cancel();
            status.Text = IsLocal ? "Stopping the local turn…" : "Stopped waiting. Core keeps any accepted turn.";
            UpdateControls();
        }

        private void Append(string speaker, string message, Color color)
        {
            transcript.Select(transcript.TextLength, 0);
            transcript.SelectionFont = speakerFont; transcript.SelectionColor = color;
            transcript.AppendText(speaker + Environment.NewLine);
            transcript.SelectionFont = Font; transcript.SelectionColor = ForeColor;
            transcript.AppendText(message + Environment.NewLine + Environment.NewLine);
            transcript.SelectionStart = transcript.TextLength; transcript.ScrollToCaret();
        }

        private void RenderHistory()
        {
            latestReceipt = null;
            transcript.Clear();
            if (current == null) return;
            if (IsLocal)
            {
                var turns = current.Local.Turns;
                if (turns.Count == 0) return;
                using (DeviceKey key = DeviceKey.Load(store.Root))
                {
                    foreach (LocalJob j in turns)
                    {
                        Append("You", Json.Str(j.Input, "prompt"), muted);
                        if (j.State == JobState.Running || j.State == JobState.Queued) continue;
                        bool valid = LocalConversation.Verifies(j, key.KeyId);
                        if (j.State == JobState.Done && valid)
                        {
                            Append("McCluster", Json.Str(j.Result, "content"), accent);
                            Append("Receipt verified", "Selected " + Json.Str(j.Input, "model") + " · Served by local Ollama · " +
                                Json.Str(j.Receipt, "model") + " · " + Json.Str(j.Receipt, "hardware_mode") + Environment.NewLine + j.Id, muted);
                        }
                        else Append("Turn ended", j.Error ?? "The local answer could not be verified.", muted);
                        latestReceipt = j.Receipt == null ? null : Json.Pretty(j.Receipt);
                    }
                }
            }
            else
            {
                if (current.Binding == null || current.Binding.SessionId != account || !string.IsNullOrEmpty(coreFailure)) return;
                foreach (var t in current.Remote)
                {
                    Append("You", t.Question, muted);
                    if (t.Run == null) continue;
                    if (t.Run.Status == "done")
                    {
                        Append("McCluster", t.Run.Content, accent);
                        latestReceipt = "Selected " + RouteNames[Array.IndexOf(Routes, current.Route)] + " · " + current.Binding.Model +
                            Environment.NewLine + "Served by " + t.Run.NodeName + " · " + t.Run.Model + " · " + t.Run.HardwareMode +
                            Environment.NewLine + "Node " + t.Run.NodeId + Environment.NewLine + "Thread " + t.Run.ThreadId +
                            Environment.NewLine + "Turn " + t.Run.TurnId + Environment.NewLine + "Compute task " + t.Run.ComputeTaskId;
                        Append("Core execution receipt", latestReceipt, muted);
                    }
                    else if (t.Run.Status == "failed") Append("Turn ended", t.Run.Error, muted);
                }
            }
        }

        private async Task Send()
        {
            if (!send.Enabled || active != null) return;
            string question = prompt.Text.Trim();
            active = new CancellationTokenSource();
            UpdateControls();
            try
            {
                if (IsLocal)
                {
                    string selected = models.SelectedItem as string;
                    LocalJob job = current.Local.Create(store, selected, question);
                    prompt.Clear(); Append("You", question, muted);
                    status.Text = "Running " + selected + " on this device…";
                    await runner.Run(job, null, active.Token);
                    if (!IsDisposed) { RenderHistory(); status.Text = job.State == JobState.Done ? "Local turn complete." : "Local turn " + job.State + "."; }
                }
                else await SendCore(question);
            }
            catch (OwnerChatAuthorityException ex)
            {
                if (!IsDisposed)
                {
                    ClearRemoteViews();
                    account = null; endpoints.Clear(); coreFailure = ex.Message;
                    SelectThread(current);
                }
            }
            catch (OperationCanceledException) { if (!IsDisposed) status.Text = IsLocal ? "Local turn stopped." : "Stopped waiting. Check this turn again to reconnect."; }
            catch (Exception ex)
            {
                if (!IsDisposed)
                {
                    // Re-authorize before any cached Core answer can render after a failed call.
                    if (!IsLocal) { transcript.Clear(); latestReceipt = null; endpoints.Clear(); coreFailure = ex.Message; BindModels(); }
                    status.Text = ex.Message;
                }
            }
            finally
            {
                active.Dispose(); active = null;
                if (!IsDisposed)
                {
                    BindThreads();
                    UpdateControls();
                    if (closeAfterStop) Close(); else prompt.Focus();
                }
            }
        }

        private async Task SendCore(string question)
        {
            var endpoint = current.Binding;
            var turn = Pending;
            if (turn == null)
            {
                turn = new RemoteTurn { Question = question };
                current.Remote.Add(turn);
                prompt.Clear();
                Append("You", question, muted);
            }
            status.Text = "Waiting for Core…";
            if (turn.Run == null)
                turn.Run = await core.SubmitAsync(endpoint, current.CoreId, turn.MessageId, turn.Question);
            for (int reads = 0; reads < 90 && turn.Run.Status == "pending"; reads++)
            {
                active.Token.ThrowIfCancellationRequested();
                // A stopped wait can reconnect through Get without submitting again.
                if (reads != 0) await Task.Delay(2000, active.Token);
                turn.Run = await core.GetAsync(endpoint, current.CoreId, turn.Run.TurnId);
            }
            if (IsDisposed) return;
            RenderHistory();
            status.Text = turn.Run.Status == "pending" ? "Core is still running. Check this turn again." : "Core turn " + turn.Run.Status + ".";
        }

        private void ShowReceipt()
        {
            if (latestReceipt == null) return;
            using (var dialog = new Form { Text = IsLocal ? "Local job receipt" : "Core execution receipt", Size = new Size(650, 480), StartPosition = FormStartPosition.CenterParent })
            using (var details = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both, WordWrap = false, Dock = DockStyle.Fill, Text = latestReceipt.Replace("\r\n", "\n").Replace("\n", Environment.NewLine) })
            { dialog.Controls.Add(details); dialog.ShowDialog(this); }
        }
    }
}
