using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using McClusterDesktop;

// Deterministic PCM and transport; does not open a microphone, a speaker or a network connection.
internal static class CallSessionTests
{
    private static void Check(bool value, string message) { if (!value) throw new Exception("Voice call: " + message); }
    private static readonly short[] Silence = new short[CallVoiceGate.Frame];
    private static readonly short[] Voice = Enumerable.Range(0, CallVoiceGate.Frame)
        .Select(i => (short)(Math.Sin(i * Math.PI / 13) * 3600)).ToArray();

    private sealed class Context : SynchronizationContext
    {
        private readonly ConcurrentQueue<Action> messages = new ConcurrentQueue<Action>();
        internal readonly int ThreadId = Thread.CurrentThread.ManagedThreadId;
        public override void Post(SendOrPostCallback d, object state) { messages.Enqueue(() => d(state)); }
        internal void Pump() { Action work; while (messages.TryDequeue(out work)) work(); }
        internal void Until(Func<bool> test)
        {
            var clock = Stopwatch.StartNew();
            while (!test() && clock.ElapsedMilliseconds < 4000) { Pump(); Thread.Sleep(1); }
            Pump();
            Check(test(), "session did not reach expected state");
        }
    }

    private sealed class Mic : IDisposable
    {
        internal Action<short[]> Frame;
        internal bool Closed;
        public void Dispose() { Closed = true; }
    }

    private sealed class Audio : ICallAudio
    {
        internal Mic Mic;
        internal int Opens, Plays;
        internal CancellationToken PlaybackToken;
        internal TaskCompletionSource<bool> Playback;
        public IDisposable Capture(Action<short[]> frame, Action<Exception> fault)
        { Opens++; Mic = new Mic { Frame = frame }; return Mic; }
        public Task PlayAsync(CallPcm pcm, CancellationToken token)
        {
            Plays++; PlaybackToken = token; Playback = new TaskCompletionSource<bool>();
            var completion = Playback;
            token.Register(() => completion.TrySetCanceled());
            return Playback.Task;
        }
        internal void Talk()
        {
            for (int i = 0; i < 16; i++) Mic.Frame(Voice);
            for (int i = 0; i < 32; i++) Mic.Frame(Silence);
        }
    }

    private sealed class Speech : ICallSpeech
    {
        internal string Unavailable;
        internal TaskCompletionSource<string> Pending;
        internal int Transcriptions, Syntheses;
        internal short[] LastClip;
        public string UnavailableReason { get { return Unavailable; } }
        public Task<string> TranscribeAsync(short[] samples, CancellationToken token)
        {
            LastClip = samples;
            Interlocked.Increment(ref Transcriptions);
            return Pending == null ? Task.FromResult("synthetic words") : Pending.Task;
        }
        public Task<CallPcm> SynthesizeAsync(string reply, CancellationToken token)
        {
            Interlocked.Increment(ref Syntheses);
            return Task.FromResult(new CallPcm(new short[] { 20, 30, 40 }, 16000));
        }
    }

    internal static void Run()
    {
        var saved = SynchronizationContext.Current;
        var ui = new Context();
        SynchronizationContext.SetSynchronizationContext(ui);
        try { VerifySession(ui); VerifyStaleReply(ui); VerifyGate(); VerifyEcho(); }
        finally { SynchronizationContext.SetSynchronizationContext(saved); }
    }

    private static void VerifySession(Context ui)
    {
        var audio = new Audio();
        var speech = new Speech();
        var sends = new List<string>();
        int callbacksOnUi = 0;
        var statuses = new List<string>();
        using (var call = new CallSession(speech, delegate(string words, CancellationToken token)
        {
            if (Thread.CurrentThread.ManagedThreadId == ui.ThreadId) callbacksOnUi++;
            token.ThrowIfCancellationRequested(); sends.Add(words);
            return Task.FromResult("Synthetic answer");
        }, statuses.Add, audio, ui))
        {
            try { call.Start(false); throw new Exception("consent bypassed"); } catch (InvalidOperationException) { }
            speech.Unavailable = "Missing local voice";
            try { call.Start(true); throw new Exception("speech readiness bypassed"); } catch (InvalidOperationException) { }
            Check(audio.Opens == 0, "no microphone before consent and pack readiness");
            speech.Unavailable = null; call.Start(true); call.Start(true);
            Check(call.Active && !call.Muted && audio.Opens == 1, "single input stream");
            audio.Talk(); ui.Until(() => audio.Plays == 1);
            Check(sends.Count == 1 && callbacksOnUi == 1 && sends[0] == "synthetic words", "one chat submit on UI");
            Check(speech.LastClip.All(x => x == 0), "capture PCM erased after transcription");
            Check(!audio.Mic.Closed, "mic stays available during playback");

            var firstPlayback = audio.PlaybackToken;
            audio.Talk(); ui.Until(() => audio.Plays == 2);
            Check(firstPlayback.IsCancellationRequested && sends.Count == 2, "speech interrupts playback and starts one new turn");
            var oldInput = audio.Mic; call.SetMuted(true);
            Check(oldInput.Closed && call.Muted && audio.PlaybackToken.IsCancellationRequested, "mute closes microphone and stops playback");
            for (int i = 0; i < 40; i++) oldInput.Frame(Voice);
            ui.Pump(); Check(sends.Count == 2, "closed capture cannot submit");
            call.SetMuted(false); Check(audio.Opens == 2 && !call.Muted, "unmute opens fresh microphone");
            speech.Pending = new TaskCompletionSource<string>();
            audio.Talk(); ui.Until(() => speech.Transcriptions == 3);
            call.End();
            speech.Pending.SetResult("late transcript"); ui.Until(() => speech.LastClip.All(x => x == 0));
            Check(sends.Count == 2 && audio.Mic.Closed && !call.Active, "discard late recognition after End");
            speech.Pending = null;
            call.Start(true); audio.Talk(); call.End(); ui.Pump();
            Check(sends.Count == 2 && speech.Transcriptions == 3, "discard callback queued before end");
        }
    }

    private static void VerifyStaleReply(Context ui)
    {
        var speech = new Speech();
        var audio = new Audio();
        var waiting = new TaskCompletionSource<string>();
        var first = new CancellationToken();
        int submits = 0;
        using (var call = new CallSession(speech, delegate(string words, CancellationToken token) {
            submits++;
            if (submits == 1) { first = token; return waiting.Task; }
            return Task.FromResult("Current reply");
        }, delegate { }, audio, ui))
        {
            call.Start(true); audio.Talk(); ui.Until(() => submits == 1);
            audio.Talk(); ui.Until(() => first.IsCancellationRequested);
            Check(submits == 1, "second request waits for the existing chat lane");
            waiting.SetResult("Late answer from cancelled backend");
            ui.Until(() => audio.Plays == 1);
            Check(speech.Syntheses == 1 && submits == 2, "stale model answer cannot reach the speaker");
            call.End();
        }
    }

    private static void VerifyGate()
    {
        var gate = new CallVoiceGate();
        bool on;
        for (int i = 0; i < 200; i++) Check(gate.Push(Silence, out on) == null && !on, "silence stays closed");
        for (int i = 0; i < 2; i++) Check(gate.Push(Voice, out on) == null && !on, "short impulse filtered");
        gate.Push(Silence, out on);
        int starts = 0, clips = 0;
        for (int i = 0; i < 1200; i++)
        {
            var data = gate.Push(Voice, out on);
            if (on) starts++;
            if (data != null) { Check(data.Length == 0, "overlong continuous speech must not submit a fragment"); clips++; }
        }
        Check(starts == 1 && clips == 1, "bounded capture drops the long utterance once");
    }

    private static void VerifyEcho()
    {
        var random = new Random(29);
        var speaker = Enumerable.Range(0, 16000).Select(i => (short)random.Next(-9000, 9000)).ToArray();
        var echo = new CallEchoReference(new CallPcm(speaker, 16000));
        var pureEcho = new short[CallVoiceGate.Frame];
        for (int i = 0; i < pureEcho.Length; i++) pureEcho[i] = (short)(speaker[5000 + i] * 0.7);
        echo.Clean(pureEcho, 6320);
        Check(pureEcho.All(x => Math.Abs((int)x) <= 2), "attenuated delayed speaker echo removed");
        var mixed = new short[CallVoiceGate.Frame];
        for (int i = 0; i < mixed.Length; i++) mixed[i] = (short)(speaker[5000 + i] * 0.7 + Voice[i]);
        echo.Clean(mixed, 6320);
        Check(mixed.Select((x, i) => Math.Abs(x - Voice[i])).Average() < 850, "near-end speech survives cancellation");
        echo.Clear();
    }
}
