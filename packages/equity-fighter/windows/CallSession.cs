using System;
using System.Threading;
using System.Threading.Tasks;

namespace McClusterDesktop
{
    internal interface ICallSpeech
    {
        string UnavailableReason { get; }
        Task<string> TranscribeAsync(short[] pcm16Mono16k, CancellationToken cancellation);
        Task<CallPcm> SynthesizeAsync(string reply, CancellationToken cancellation);
    }

    internal sealed class CallPcm
    {
        internal readonly short[] Samples;
        internal readonly int SampleRate;
        internal CallPcm(short[] samples, int sampleRate)
        {
            if (samples == null || samples.Length == 0 || sampleRate < 8000 || sampleRate > 48000 || samples.Length > sampleRate * 120)
                throw new ArgumentException("Voice playback requires up to two minutes of mono PCM.");
            Samples = samples;
            SampleRate = sampleRate;
        }
    }

    internal interface ICallAudio
    {
        IDisposable Capture(Action<short[]> frame, Action<Exception> fault);
        Task PlayAsync(CallPcm pcm, CancellationToken cancellation);
    }

    // Start, mute, end, Send, and status run on the form's UI thread. Capture delivers
    // 20 ms frames on a device thread. Keep at most one completed utterance awaiting UI.
    internal sealed class CallSession : IDisposable
    {
        private readonly ICallSpeech speech;
        private readonly ICallAudio audio;
        private readonly Func<string, CancellationToken, Task<string>> send;
        private readonly Action<string> status;
        private readonly SynchronizationContext ui;
        private readonly object input = new object();
        private readonly CallVoiceGate gate = new CallVoiceGate();
        private readonly SemaphoreSlim lane = new SemaphoreSlim(1, 1);
        private IDisposable microphone;
        private CancellationTokenSource current;
        private int captureEpoch, speechGeneration;
        private bool posted, interrupt, disposed;
        private short[] pending;
        internal bool Active { get; private set; }
        internal bool Muted { get; private set; }

        internal CallSession(ICallSpeech speech, Func<string, CancellationToken, Task<string>> sendToThisChat, Action<string> status)
            : this(speech, sendToThisChat, status, new WinMmCallAudio(), SynchronizationContext.Current) { }

        internal CallSession(ICallSpeech speech, Func<string, CancellationToken, Task<string>> sendToThisChat,
            Action<string> status, ICallAudio audio, SynchronizationContext context)
        {
            if (speech == null || sendToThisChat == null || status == null || audio == null || context == null)
                throw new ArgumentException("Open the call from the chat window.");
            this.speech = speech;
            this.audio = audio;
            send = sendToThisChat;
            this.status = status;
            ui = context;
        }

        internal void Start(bool microphoneConsent)
        {
            if (disposed) throw new ObjectDisposedException("CallSession");
            if (!microphoneConsent) throw new InvalidOperationException("Microphone permission is required for a voice call.");
            if (Active) return;
            string unavailable = speech.UnavailableReason;
            if (!String.IsNullOrEmpty(unavailable)) throw new InvalidOperationException(unavailable);
            Active = true;
            Muted = false;
            OpenMicrophone();
        }

        private void OpenMicrophone()
        {
            int epoch = captureEpoch;
            try
            {
                microphone = audio.Capture(frame => Frame(epoch, frame), error => ui.Post(delegate
                {
                    if (!Active || captureEpoch != epoch) return;
                    End();
                    status("The microphone disconnected. Reconnect it and start a new call.");
                }, null));
                status("Listening. Use a headset for clear interruptions.");
            }
            catch { End(); throw; }
        }

        private void Frame(int epoch, short[] frame)
        {
            lock (input)
            {
                if (epoch != captureEpoch) return;
                bool onset;
                short[] completed = gate.Push(frame, out onset);
                if (!onset && completed == null) return;
                if (onset)
                {
                    speechGeneration++;
                    interrupt = true;
                    Wipe(pending);
                    pending = null;
                }
                if (completed != null) { Wipe(pending); pending = completed; }
                if (posted) return;
                posted = true;
            }
            ui.Post(delegate { Drain(epoch); }, null);
        }

        private void Drain(int epoch)
        {
            short[] completed;
            bool barge;
            int generation;
            lock (input)
            {
                if (epoch != captureEpoch) return;
                posted = false;
                barge = interrupt;
                generation = speechGeneration;
                interrupt = false;
                completed = pending;
                pending = null;
            }
            if (barge) { CancelTurn(); status("Listening to you."); }
            if (completed != null && completed.Length == 0) { status("That utterance exceeded 20 seconds. Pause and try again."); return; }
            if (completed != null)
            {
                var turn = new CancellationTokenSource();
                current = turn;
                Run(completed, turn, generation);
            }
        }

        private void CheckCurrent(CancellationToken token, int generation)
        {
            token.ThrowIfCancellationRequested();
            lock (input) if (generation != speechGeneration) throw new OperationCanceledException();
        }

        private async void Run(short[] utterance, CancellationTokenSource turn, int generation)
        {
            bool acquired = false;
            CallPcm reply = null;
            var token = turn.Token;
            try
            {
                await lane.WaitAsync(token);
                acquired = true;
                CheckCurrent(token, generation);
                status("Transcribing on this device.");
                string words = await Task.Run(() => speech.TranscribeAsync(utterance, token), token);
                Wipe(utterance);
                CheckCurrent(token, generation);
                if (String.IsNullOrWhiteSpace(words)) { status("Listening. No words recognized."); return; }
                words = words.Trim();
                if (words.Length > 4096) { status("The utterance was too long. Say it in shorter parts."); return; }
                status("Waiting for the selected chat.");
                string answer = await send(words, token);
                CheckCurrent(token, generation);
                if (String.IsNullOrWhiteSpace(answer)) { status("No spoken reply. See this chat for its status."); return; }
                status("Preparing the voice reply.");
                reply = await Task.Run(() => speech.SynthesizeAsync(answer, token), token);
                CheckCurrent(token, generation);
                if (reply == null) throw new InvalidOperationException("The local voice returned no audio.");
                status("Speaking. You can interrupt.");
                await audio.PlayAsync(reply, token);
                CheckCurrent(token, generation);
                status("Listening.");
            }
            catch (OperationCanceledException) { }
            catch (Exception)
            {
                if (!token.IsCancellationRequested) status("The voice turn failed. Check the selected chat, speech pack and audio devices.");
            }
            finally
            {
                Wipe(utterance);
                if (reply != null) Wipe(reply.Samples);
                if (ReferenceEquals(current, turn)) current = null;
                if (acquired) lane.Release();
                turn.Dispose();
            }
        }

        private static void Wipe(short[] data) { if (data != null) Array.Clear(data, 0, data.Length); }
        private void CancelTurn()
        {
            var turn = current;
            current = null;
            if (turn != null) turn.Cancel();
        }

        private void StopCapture()
        {
            lock (input)
            {
                captureEpoch++;
                speechGeneration++;
                gate.Reset();
                Wipe(pending);
                pending = null;
                interrupt = posted = false;
            }
            try { CancelTurn(); }
            finally { if (microphone != null) { microphone.Dispose(); microphone = null; } }
        }

        internal void SetMuted(bool muted)
        {
            if (!Active || Muted == muted) return;
            Muted = muted;
            if (muted) { StopCapture(); status("Muted. Microphone closed."); }
            else OpenMicrophone();
        }

        internal void End()
        {
            if (!Active) return;
            Active = false;
            Muted = false;
            StopCapture();
            status("Call ended.");
        }

        public void Dispose() { End(); disposed = true; }
    }
}
