using System;
using System.Drawing;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace McClusterDesktop
{
    internal sealed partial class PrimeChatForm
    {
        private readonly Button startCall = new Button();
        private readonly Button muteCall = new Button();
        private readonly Button endCall = new Button();
        private readonly Label callStatus = new Label();
        private CallSession call;
        private ThreadView callThread;
        private string callRoute, callModel, packError = "Checking the offline voice pack…";
        private OwnerChatTarget callBinding;
        private bool voiceInFlight;

        private void ConfigureCall(TableLayoutPanel layout, ICallSpeech speech, ICallAudio audio)
        {
            var area = new TableLayoutPanel { ColumnCount = 1, RowCount = 2, Dock = DockStyle.Fill, AutoSize = true, Margin = Padding.Empty };
            var buttons = Row();
            ButtonStyle(startCall, "startCall", "Start call with mic");
            ButtonStyle(muteCall, "muteCall", "Mute");
            ButtonStyle(endCall, "endCall", "End call");
            buttons.Controls.AddRange(new Control[] { startCall, muteCall, endCall });
            area.Controls.Add(buttons, 0, 0);
            callStatus.Name = "callStatus";
            callStatus.AccessibleName = "Voice call status";
            callStatus.AutoSize = true;
            callStatus.Dock = DockStyle.Fill;
            callStatus.ForeColor = muted;
            callStatus.Text = packError;
            callStatus.Margin = new Padding(0, 2, 0, 0);
            area.Controls.Add(callStatus, 0, 1);
            layout.Controls.Add(area, 0, 8);
            Shown += async delegate {
                try { packError = await Task.Run(() => speech.UnavailableReason); }
                catch (Exception) { packError = "The local voice pack could not be opened."; }
                if (!IsDisposed)
                {
                    callStatus.Text = packError ?? "Start opens the microphone. Recognized speech goes to this chat.";
                    UpdateControls();
                }
            };
            startCall.Click += delegate
            {
                if (!startCall.Enabled || current == null) return;
                callThread = current;
                callRoute = current.Route;
                callModel = current.LocalModel;
                callBinding = current.Binding;
                try
                {
                    if (call == null) call = new CallSession(speech, SendVoiceTurn, CallStatus, audio, SynchronizationContext.Current);
                    // The owner explicitly chose “Start call with mic” on this chat.
                    call.Start(true);
                }
                catch (Exception ex) { EndVoiceCall(); CallStatus(ex.Message); }
                UpdateControls();
            };
            muteCall.Click += delegate {
                if (call == null || !call.Active) return;
                try { call.SetMuted(!call.Muted); }
                catch (Exception ex) { EndVoiceCall(); CallStatus(ex.Message); }
                UpdateControls();
            };
            endCall.Click += delegate { EndVoiceCall(); UpdateControls(); };
            FormClosed += delegate {
                var disposable = speech as IDisposable;
                if (call != null) call.Dispose();
                if (disposable != null) Task.Run(() => disposable.Dispose());
            };
        }

        private void CallStatus(string message)
        {
            if (IsDisposed) return;
            callStatus.Text = message;
            UpdateControls();
        }

        private void UpdateCallControls(bool canStart)
        {
            bool live = call != null && call.Active;
            startCall.Enabled = canStart && !live && string.IsNullOrEmpty(packError);
            muteCall.Enabled = live;
            muteCall.Text = live && call.Muted ? "Unmute" : "Mute";
            endCall.Enabled = live;
        }

        private void EndVoiceCall()
        {
            if (call != null) call.End();
            callThread = null;
            callBinding = null;
        }

        private async Task<string> SendVoiceTurn(string words, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            if (call == null || !call.Active || call.Muted || current != callThread || current.Route != callRoute ||
                (IsLocal ? current.LocalModel != callModel : !SameBinding(current.Binding, callBinding)) ||
                Pending != null || active != null || checking)
            {
                EndVoiceCall();
                CallStatus("Call ended. Check the selected chat and its last turn before starting again.");
                return null;
            }
            // No speech transcript channel or automatic route exists: both composer
            // and microphone submit through SendSelected and the same receipt checks.
            string answer = await SendSelected(words, token, true);
            token.ThrowIfCancellationRequested();
            return answer;
        }
    }
}
