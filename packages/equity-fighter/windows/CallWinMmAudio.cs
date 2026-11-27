using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace McClusterDesktop
{
    // WinMM is used only for audio devices. The input device remains open during
    // transcription, inference and playback; muted/ended sessions close it.
    internal sealed class WinMmCallAudio : ICallAudio
    {
        [StructLayout(LayoutKind.Sequential, Pack = 2)]
        private struct Format
        {
            internal ushort Tag, Channels;
            internal uint Rate, BytesPerSecond;
            internal ushort Align, Bits, Extra;
            internal Format(int rate) : this()
            {
                Tag = 1; Channels = 1; Rate = (uint)rate; BytesPerSecond = (uint)(rate * 2);
                Align = 2; Bits = 16;
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct Header
        {
            internal IntPtr Data;
            internal uint Bytes, Recorded;
            internal UIntPtr User;
            internal uint Flags, Loops;
            internal IntPtr Next;
            internal UIntPtr Reserved;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MmTime { internal uint Kind, Value, Unused; }

        private const uint Mapper = unchecked((uint)-1);
        private static readonly uint HeaderSize = (uint)Marshal.SizeOf(typeof(Header));
        private static readonly int FlagsOffset = Marshal.OffsetOf(typeof(Header), "Flags").ToInt32();
        [DllImport("winmm.dll")] private static extern uint waveInOpen(out IntPtr device, uint id, ref Format format, IntPtr callback, IntPtr user, uint flags);
        [DllImport("winmm.dll")] private static extern uint waveInPrepareHeader(IntPtr device, IntPtr header, uint size);
        [DllImport("winmm.dll")] private static extern uint waveInUnprepareHeader(IntPtr device, IntPtr header, uint size);
        [DllImport("winmm.dll")] private static extern uint waveInAddBuffer(IntPtr device, IntPtr header, uint size);
        [DllImport("winmm.dll")] private static extern uint waveInStart(IntPtr device);
        [DllImport("winmm.dll")] private static extern uint waveInReset(IntPtr device);
        [DllImport("winmm.dll")] private static extern uint waveInClose(IntPtr device);
        [DllImport("winmm.dll")] private static extern uint waveOutOpen(out IntPtr device, uint id, ref Format format, IntPtr callback, IntPtr user, uint flags);
        [DllImport("winmm.dll")] private static extern uint waveOutPrepareHeader(IntPtr device, IntPtr header, uint size);
        [DllImport("winmm.dll")] private static extern uint waveOutUnprepareHeader(IntPtr device, IntPtr header, uint size);
        [DllImport("winmm.dll")] private static extern uint waveOutWrite(IntPtr device, IntPtr header, uint size);
        [DllImport("winmm.dll")] private static extern uint waveOutGetPosition(IntPtr device, ref MmTime time, uint size);
        [DllImport("winmm.dll")] private static extern uint waveOutReset(IntPtr device);
        [DllImport("winmm.dll")] private static extern uint waveOutClose(IntPtr device);

        private static void Check(uint result, string operation)
        {
            if (result != 0) throw new InvalidOperationException(operation + " (Windows audio error " + result + ").");
        }

        private sealed class NativeBuffer
        {
            internal readonly short[] Samples;
            internal readonly IntPtr Address;
            private GCHandle pin;
            internal bool Prepared;
            internal NativeBuffer(short[] samples)
            {
                Samples = samples;
                pin = GCHandle.Alloc(samples, GCHandleType.Pinned);
                try
                {
                    Address = Marshal.AllocHGlobal((int)HeaderSize);
                    Marshal.StructureToPtr(new Header { Data = pin.AddrOfPinnedObject(), Bytes = (uint)(samples.Length * 2) }, Address, false);
                }
                catch { if (Address != IntPtr.Zero) Marshal.FreeHGlobal(Address); pin.Free(); throw; }
            }
            internal bool Done { get { return (Marshal.ReadInt32(Address, FlagsOffset) & 1) != 0; } }
            internal void Free()
            {
                Marshal.FreeHGlobal(Address);
                pin.Free();
            }
        }

        private sealed class CaptureStream : IDisposable
        {
            private readonly NativeBuffer[] buffers = new NativeBuffer[8];
            private readonly ManualResetEvent stop = new ManualResetEvent(false);
            private readonly Action<short[]> frame;
            private readonly Action<Exception> fault;
            private IntPtr device;
            private Thread thread;
            internal CaptureStream(Action<short[]> frame, Action<Exception> fault)
            {
                this.frame = frame;
                this.fault = fault;
                try
                {
                    var format = new Format(CallVoiceGate.Rate);
                    Check(waveInOpen(out device, Mapper, ref format, IntPtr.Zero, IntPtr.Zero, 0), "Cannot open the default microphone");
                    for (int i = 0; i < buffers.Length; i++)
                    {
                        var buffer = buffers[i] = new NativeBuffer(new short[CallVoiceGate.Frame]);
                        Check(waveInPrepareHeader(device, buffer.Address, HeaderSize), "Cannot prepare microphone input");
                        buffer.Prepared = true;
                        Check(waveInAddBuffer(device, buffer.Address, HeaderSize), "Cannot queue microphone input");
                    }
                    Check(waveInStart(device), "Cannot start the microphone");
                    thread = new Thread(Pump) { IsBackground = true, Name = "EquityNet microphone" };
                    thread.Start();
                }
                catch { CloseDevice(); stop.Dispose(); throw; }
            }
            private void Pump()
            {
                int next = 0;
                try
                {
                    while (!stop.WaitOne(5))
                    {
                        while (buffers[next].Done && !stop.WaitOne(0))
                        {
                            var buffer = buffers[next];
                            if (Marshal.ReadInt32(buffer.Address, IntPtr.Size + sizeof(uint)) != buffer.Samples.Length * 2)
                                throw new InvalidOperationException("Microphone stream interrupted.");
                            frame(buffer.Samples);
                            Array.Clear(buffer.Samples, 0, buffer.Samples.Length);
                            Check(waveInAddBuffer(device, buffer.Address, HeaderSize), "Microphone stopped accepting input");
                            next = (next + 1) % buffers.Length;
                        }
                    }
                }
                catch (Exception e) { if (!stop.WaitOne(0)) fault(e); }
            }
            private void CloseDevice()
            {
                if (device != IntPtr.Zero) waveInReset(device);
                foreach (var buffer in buffers)
                {
                    if (buffer == null) continue;
                    // Never unpin memory that a failed driver still owns.
                    if (buffer.Prepared && waveInUnprepareHeader(device, buffer.Address, HeaderSize) != 0) continue;
                    Array.Clear(buffer.Samples, 0, buffer.Samples.Length);
                    buffer.Free();
                }
                if (device != IntPtr.Zero) waveInClose(device);
                device = IntPtr.Zero;
            }
            public void Dispose()
            {
                stop.Set();
                if (thread != null) thread.Join();
                CloseDevice();
                stop.Dispose();
            }
        }

        private readonly object echoLock = new object();
        private CallEchoReference echo;
        private int head;
        private long ended;
        private const int EchoTailMs = 250;

        public IDisposable Capture(Action<short[]> frame, Action<Exception> fault)
        {
            return new CaptureStream(samples =>
            {
                lock (echoLock)
                {
                    if (echo != null)
                    {
                        int tail = ended == 0 ? 0 : (int)((Stopwatch.GetTimestamp() - ended) * 1000 / Stopwatch.Frequency);
                        if (tail <= EchoTailMs) echo.Clean(samples, head + tail * 16);
                        else ClearEcho();
                    }
                }
                frame(samples);
            }, fault);
        }

        private void ClearEcho()
        {
            if (echo != null) echo.Clear();
            echo = null; head = 0; ended = 0;
        }

        public Task PlayAsync(CallPcm pcm, CancellationToken token)
        {
            return Task.Run(() =>
            {
                token.ThrowIfCancellationRequested();
                var format = new Format(pcm.SampleRate);
                IntPtr device;
                Check(waveOutOpen(out device, Mapper, ref format, IntPtr.Zero, IntPtr.Zero, 0), "Cannot open the default speaker");
                NativeBuffer buffer = null;
                try
                {
                    buffer = new NativeBuffer(pcm.Samples);
                    Check(waveOutPrepareHeader(device, buffer.Address, HeaderSize), "Cannot prepare playback");
                    buffer.Prepared = true;
                    token.ThrowIfCancellationRequested();
                    var reference = new CallEchoReference(pcm);
                    lock (echoLock) { ClearEcho(); echo = reference; }
                    token.ThrowIfCancellationRequested();
                    Check(waveOutWrite(device, buffer.Address, HeaderSize), "Cannot play the reply");
                    var clock = Stopwatch.StartNew();
                    while (!buffer.Done)
                    {
                        if (token.WaitHandle.WaitOne(8)) token.ThrowIfCancellationRequested();
                        var pos = new MmTime { Kind = 2 }; // TIME_SAMPLES
                        int samples = waveOutGetPosition(device, ref pos, 12) == 0 && pos.Kind == 2
                            ? (int)((long)pos.Value * CallVoiceGate.Rate / pcm.SampleRate)
                            : (int)(clock.ElapsedMilliseconds * 16);
                        lock (echoLock) head = samples;
                    }
                }
                finally
                {
                    waveOutReset(device);
                    if (buffer != null && (!buffer.Prepared || waveOutUnprepareHeader(device, buffer.Address, HeaderSize) == 0))
                        buffer.Free();
                    waveOutClose(device);
                    lock (echoLock) ended = Stopwatch.GetTimestamp();
                    // Also clear the tail when the call has closed its microphone.
                    var last = echo;
                    Task.Delay(EchoTailMs + 20).ContinueWith(delegate
                    {
                        lock (echoLock) { if (ReferenceEquals(echo, last)) ClearEcho(); }
                    }, TaskScheduler.Default);
                }
            }, token);
        }
    }
}
