using System;

namespace McClusterDesktop
{
    // 16 kHz mono, signed 16-bit, 20 ms frames. Three voiced frames open the gate.
    // Keep the onset, end on a pause, and discard overlong continuous speech entirely.
    internal sealed class CallVoiceGate
    {
        internal const int Rate = 16000, Frame = 320;
        private const int LeadFrames = 8, EndSilence = 30, MaxFrames = 1000;
        private readonly short[] lead = new short[LeadFrames * Frame];
        private readonly short[] turn = new short[MaxFrames * Frame];
        private int cursor, leadCount, consecutive, voiced, quiet, length;
        private bool recording, overflow;
        private double floor = 80;

        internal short[] Push(short[] frame, out bool onset)
        {
            onset = false;
            if (frame == null || frame.Length != Frame) return null;
            double sum = 0, squares = 0;
            foreach (short sample in frame) { sum += sample; squares += (double)sample * sample; }
            double rms = Math.Sqrt(Math.Max(0, squares / Frame - sum * sum / Frame / Frame));
            bool voice = rms >= Math.Max(260, floor * 3.2);
            if (!voice && !recording) floor = Math.Max(35, Math.Min(1800, floor * 0.98 + rms * 0.02));
            if (overflow)
            {
                quiet = voice ? 0 : quiet + 1;
                if (quiet >= EndSilence) Reset();
                return null;
            }
            if (!recording)
            {
                Array.Copy(frame, 0, lead, cursor * Frame, Frame);
                cursor = (cursor + 1) % LeadFrames;
                leadCount = Math.Min(leadCount + 1, LeadFrames);
                consecutive = voice ? consecutive + 1 : 0;
                if (consecutive < 3) return null;
                recording = onset = true;
                voiced = consecutive;
                for (int i = 0; i < leadCount; i++)
                {
                    int slot = (cursor - leadCount + i + LeadFrames) % LeadFrames;
                    Array.Copy(lead, slot * Frame, turn, length, Frame);
                    length += Frame;
                }
                return null;
            }
            if (length + Frame > turn.Length)
            {
                Reset();
                overflow = true;
                return new short[0];
            }
            Array.Copy(frame, 0, turn, length, Frame);
            length += Frame;
            quiet = voice ? 0 : quiet + 1;
            if (voice) voiced++;
            if (quiet < EndSilence) return null;
            short[] clip = null;
            if (voiced >= 7)
            {
                // Preserve 100 ms of trailing silence for the offline recognizer.
                clip = new short[length - (EndSilence - 5) * Frame];
                Array.Copy(turn, clip, clip.Length);
            }
            Reset();
            return clip;
        }

        internal void Reset()
        {
            Array.Clear(lead, 0, lead.Length);
            Array.Clear(turn, 0, length);
            recording = overflow = false;
            cursor = leadCount = consecutive = voiced = quiet = length = 0;
            floor = 80;
        }
    }

    // Subtract a scaled copy of the actual speaker PCM from correlated microphone
    // frames. Uncorrelated near-end speech stays available to the voice gate.
    internal sealed class CallEchoReference
    {
        private readonly short[] spoken;
        internal CallEchoReference(CallPcm pcm)
        {
            spoken = new short[(int)((long)pcm.Samples.Length * CallVoiceGate.Rate / pcm.SampleRate)];
            for (int i = 0; i < spoken.Length; i++) spoken[i] = pcm.Samples[(long)i * pcm.SampleRate / CallVoiceGate.Rate];
        }

        internal void Clean(short[] frame, int position)
        {
            const int width = CallVoiceGate.Frame;
            int start = Math.Max(0, position - 4096);
            int end = Math.Min(spoken.Length - width, position + width);
            if (end < start || frame.Length != width) return;
            double energy = 0;
            for (int i = 0; i < width; i += 4) energy += (double)frame[i] * frame[i];
            if (energy < 80 * 80 * (width / 4)) return;
            double best = 0, gain = 0;
            int match = start;
            for (int pos = start; pos <= end; pos++)
            {
                double dot = 0, power = 0;
                for (int i = 0; i < width; i += 4)
                {
                    double reference = spoken[pos + i];
                    dot += frame[i] * reference;
                    power += reference * reference;
                }
                if (power < 1) continue;
                double score = dot * dot / power;
                if (score > best) { best = score; gain = dot / power; match = pos; }
            }
            if (best < 0.45 * energy || Math.Abs(gain) > 4) return;
            for (int i = 0; i < width; i++)
                frame[i] = (short)Math.Max(short.MinValue, Math.Min(short.MaxValue, frame[i] - gain * spoken[match + i]));
        }

        internal void Clear() { Array.Clear(spoken, 0, spoken.Length); }
    }
}
