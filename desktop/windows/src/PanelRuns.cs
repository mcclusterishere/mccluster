using System;
using System.Threading;

namespace McClusterDesktop
{
    // The panel's two long operations, each with its own cancellation: the local job runner and the wait
    // on a Core (staging) submission. Canceling one never cancels the other, and while either runs the
    // "Run on" target cannot be changed (the button would otherwise act on a target other than the one
    // that is busy). UI thread only: the panel reads and writes this from its own event handlers.
    internal sealed class PanelRuns
    {
        private CancellationTokenSource local;
        private CancellationTokenSource staging;

        internal bool LocalBusy { get { return local != null; } }
        internal bool StagingBusy { get { return staging != null; } }
        internal bool AnyBusy { get { return LocalBusy || StagingBusy; } }
        // The target radios are enabled only when this is true.
        internal bool TargetsSelectable { get { return !AnyBusy; } }

        internal CancellationToken StartLocal()
        {
            if (local != null) throw new InvalidOperationException("A local job is already running.");
            local = new CancellationTokenSource();
            return local.Token;
        }

        internal CancellationToken StartStaging()
        {
            if (staging != null) throw new InvalidOperationException("A Core (staging) submission is already waiting.");
            staging = new CancellationTokenSource();
            return staging.Token;
        }

        internal void CancelLocal() { if (local != null) local.Cancel(); }
        internal void CancelStaging() { if (staging != null) staging.Cancel(); }

        internal void FinishLocal()
        {
            CancellationTokenSource source = local;
            local = null;
            if (source != null) source.Dispose();
        }

        internal void FinishStaging()
        {
            CancellationTokenSource source = staging;
            staging = null;
            if (source != null) source.Dispose();
        }
    }
}
