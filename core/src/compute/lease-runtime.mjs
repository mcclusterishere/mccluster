// Local safeguards supplement the database fence; they never grant authority.
// Durations come from the server's receipt, not the requested renewal period.
export const systemClock = () => ({ mono: performance.now(), wall: Date.now() });

export function leaseError(message, code = 'LEASE_AUTHORITY_LOST') {
  return Object.assign(new Error(message), { code, retryable: false });
}

export class LeaseAuthority {
  constructor({ lease, nodeId, sentAt, clock = systemClock, marginMs = 1000, clockToleranceMs = 1000 }) {
    this.clock = clock;
    this.marginMs = marginMs;
    this.clockToleranceMs = clockToleranceMs;
    this.controller = new AbortController();
    this.identity = { lease_id: lease.lease_id, task_id: lease.task?.id, org_id: lease.task?.org_id, node_id: nodeId, attempt: lease.attempt };
    this.lastSample = sentAt;
    this.deadline = null;
    this.lastServerTime = null;
    this.lastExpires = null;
    this.lastStatus = null;
    this.confirm(lease, sentAt, true);
  }

  lose(reason) {
    if (!this.controller.signal.aborted) this.controller.abort(reason instanceof Error ? reason : leaseError(reason));
    return this.controller.signal.reason;
  }

  assertCurrent() {
    if (this.controller.signal.aborted) throw this.controller.signal.reason;
    const sample = this.clock();
    const monoElapsed = sample.mono - this.lastSample.mono;
    const wallElapsed = sample.wall - this.lastSample.wall;
    // Some host monotonic clocks pause during suspend. Clock jumps and suspend
    // both require fresh work, rather than guessing that an old lease survived.
    if (monoElapsed < 0 || Math.abs(wallElapsed - monoElapsed) > this.clockToleranceMs) {
      throw this.lose('Clock discontinuity or host suspension invalidated the local lease');
    }
    this.lastSample = sample;
    if (this.deadline !== null && sample.mono >= this.deadline) throw this.lose('Last confirmed lease deadline passed');
    return sample;
  }

  confirm(receipt, sentAt, initial = false) {
    const sample = this.assertCurrent();
    const serverTime = Date.parse(receipt?.server_time);
    const expires = Date.parse(receipt?.expires_at);
    const sameIdentity = Object.entries(this.identity).every(([key, value]) => value != null && receipt?.[key] === value);
    const duration = expires - serverTime;
    if (!sameIdentity || !Number.isInteger(receipt?.attempt) || receipt.attempt < 1 ||
        !['leased', 'running'].includes(receipt?.status) || (!initial && receipt.status !== 'running') ||
        !Number.isFinite(serverTime) || !Number.isFinite(expires) || duration <= 0 || duration > 900_000 ||
        !Number.isFinite(sentAt?.mono) || sentAt.mono > sample.mono ||
        (this.lastServerTime !== null && (serverTime < this.lastServerTime ||
          (serverTime === this.lastServerTime && expires <= this.lastExpires && receipt.status === this.lastStatus)))) {
      throw this.lose('Invalid, stale or mismatched lease authority receipt');
    }
    // Starting at request dispatch subtracts ALL round-trip latency and is
    // conservative even when client/server wall clocks disagree.
    const deadline = sentAt.mono + duration - this.marginMs;
    if (sample.mono >= deadline) throw this.lose('Lease response arrived without usable authority');
    this.deadline = deadline;
    this.lastServerTime = serverTime;
    this.lastExpires = expires;
    this.lastStatus = receipt.status;
    return this;
  }
}

// request(path, body, signal) returns the decoded gateway response. Its caller
// must enforce a network timeout, including reading the response body.
export async function runLease({ lease, nodeId, sentAt, request, execute, signal, clock = systemClock,
  renewMs = 30_000, watchMs = 250, marginMs = 1000, onEvent = () => {},
  setIntervalImpl = setInterval, clearIntervalImpl = clearInterval }) {
  const authority = new LeaseAuthority({ lease, nodeId, sentAt, clock, marginMs });
  const leaseSignal = authority.controller.signal;
  const base = `/v1/compute/leases/${lease.lease_id}`;
  const body = { lease_token: lease.lease_token };
  const abort = () => authority.lose(signal.reason || leaseError('Node shutdown'));
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  let renewing = false;
  let finishing = false;
  let completing = false;
  let renewal = Promise.resolve();
  let watcher;
  let heartbeat;
  const current = () => { try { authority.assertCurrent(); } catch (error) { onEvent('lease_authority_lost', error); } };
  try {
    authority.assertCurrent();
    // The watchdog also covers a hung start and executor ignoring cancellation.
    watcher = setIntervalImpl(current, watchMs);
    watcher?.unref?.();
    const startedAt = clock();
    const started = await request(`${base}/start`, { ...body, extend_seconds: 120 }, leaseSignal);
    if (started?.ok !== true) throw authority.lose('Lease start was not acknowledged');
    authority.confirm(started.result, startedAt);
    heartbeat = setIntervalImpl(() => {
      if (renewing || finishing || leaseSignal.aborted) return;
      renewing = true;
      const renewedAt = clock();
      renewal = (async () => {
        try {
          authority.assertCurrent();
          const reply = await request(`${base}/heartbeat`, { ...body, extend_seconds: 120, progress: { state: 'running' } }, leaseSignal);
          if (reply?.ok !== true) throw authority.lose('Lease renewal was not acknowledged');
          authority.confirm(reply.result, renewedAt);
        } catch (error) {
          if ([401, 403, 409].includes(error.status)) authority.lose(error);
          onEvent('lease_heartbeat_failed', error);
        } finally { renewing = false; }
      })();
    }, renewMs);
    heartbeat?.unref?.();
    const result = await execute(lease.task, leaseSignal);
    finishing = true;
    clearIntervalImpl(heartbeat);
    // No in-flight renewal may race completion or resurrect local authority.
    await renewal;
    authority.assertCurrent();
    completing = true;
    const completed = await request(`${base}/complete`, { ...body, result }, leaseSignal);
    if (completed?.ok !== true || completed.result !== true) throw leaseError('Completion was not acknowledged', 'COMPLETION_UNCONFIRMED');
    return { status: 'committed', task_id: lease.task.id, lease_id: lease.lease_id, attempt: lease.attempt };
  } catch (error) {
    finishing = true;
    clearIntervalImpl(heartbeat);
    // After authority loss or ambiguous completion, leave recovery to the
    // durable server. Reporting failure must never undo a committed result.
    if (!leaseSignal.aborted && !completing) {
      try {
        authority.assertCurrent();
        await request(`${base}/fail`, { ...body, error: error.message, retry: error.retryable !== false }, leaseSignal);
      } catch (reportError) { onEvent('lease_failure_report_failed', reportError); }
    }
    onEvent('lease_execution_stopped', error);
    return { status: leaseSignal.aborted ? 'authority_lost' : 'unconfirmed', task_id: lease.task.id, lease_id: lease.lease_id, attempt: lease.attempt };
  } finally {
    clearIntervalImpl(watcher);
    clearIntervalImpl(heartbeat);
    signal?.removeEventListener('abort', abort);
    authority.lose('Lease execution finished');
  }
}
