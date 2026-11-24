// Scheduler election for the McCluster Core compute gateway.
//
// Supabase (ops_compute_scheduler_leases, pending SQL compute_scheduler_lease_v1)
// is the authority: exactly one (holder_id, term) is live per org. This module
// keeps a Core instance's LOCAL view of that fact conservative, the way
// LeaseAuthority does for device leases: the instance counts itself active only
// while the server said so AND its own deadline, computed from the dispatch time
// of the call that earned the answer, has not passed. A network or clock fault
// never flips an instance to active; it can only let the local deadline expire.
//
// Receipts are confirmed only when they can be trusted: the server must state a
// positive duration, the reply must land before the deadline it earns, and the
// clocks must have moved consistently between dispatch and reply. A host that
// suspends while a renew is in flight therefore steps down instead of trusting
// a deadline on a monotonic clock that did not advance.
//
// A holder that asks for a handover yields at once: isActive() is false while
// its own handover is pending, its renews keep the row alive for the successor,
// and if the grace window lapses with no successor it resumes. The successor's
// takeover never overlaps a holder that still admits work.
//
// No election configured (MCCLUSTER_SCHEDULER_ROLE unset) keeps today's
// single-scheduler behaviour: assertActiveScheduler(null) is a no-op.

export const HOLDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,78}$/;
export const SCHEDULER_ROLES = Object.freeze(['primary', 'standby']);
export const TTL_MIN_SECONDS = 10;
export const TTL_MAX_SECONDS = 300;
export const GRACE_MIN_SECONDS = 10;
export const GRACE_MAX_SECONDS = 900;
export const DEFAULT_CALL_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MIN_MS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HISTORY_LIMIT = 20;
const UNKNOWN_ORG_SQLSTATE = 'P0002';

export const systemClock = () => ({ mono: performance.now(), wall: Date.now() });

function configError(message, variable) {
  return Object.assign(new Error(message), { code: 'SCHEDULER_CONFIG', variable });
}

export function clampTtlSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 30;
  return Math.max(TTL_MIN_SECONDS, Math.min(TTL_MAX_SECONDS, Math.trunc(n)));
}

// The SQL answers 'unknown org' (SQLSTATE P0002) for an org id that has no row;
// PostgREST relays it as {code, message} and core/src/supabase.mjs puts the
// body on error.detail. The memory store throws the same shape.
export function isUnknownOrgError(error) {
  if (!error) return false;
  if (error.code === UNKNOWN_ORG_SQLSTATE || error.detail?.code === UNKNOWN_ORG_SQLSTATE) return true;
  return /^unknown org\b/i.test(String(error.message || ''));
}

export function electionConfigFromEnv(env = process.env) {
  const role = String(env.MCCLUSTER_SCHEDULER_ROLE || '').trim();
  if (!role) return null;
  if (!SCHEDULER_ROLES.includes(role)) {
    throw configError(`MCCLUSTER_SCHEDULER_ROLE must be one of ${SCHEDULER_ROLES.join(', ')}`, 'MCCLUSTER_SCHEDULER_ROLE');
  }
  // The holder id is the identity on the lease row. Two processes that share
  // one are one holder to the SQL, so the default is per role, never a single
  // constant: an unconfigured primary and standby pair must not collide.
  const holderId = String(env.MCCLUSTER_SCHEDULER_HOLDER_ID || env.MCCLUSTER_CORE_ID || `core-${role}`).trim();
  if (!HOLDER_ID_PATTERN.test(holderId)) {
    throw configError('MCCLUSTER_SCHEDULER_HOLDER_ID (or MCCLUSTER_CORE_ID) must match ^[a-z0-9][a-z0-9._-]{0,78}$', 'MCCLUSTER_SCHEDULER_HOLDER_ID');
  }
  const ttlRaw = env.MCCLUSTER_SCHEDULER_TTL_SECONDS === undefined || env.MCCLUSTER_SCHEDULER_TTL_SECONDS === '' ? 30 : Number(env.MCCLUSTER_SCHEDULER_TTL_SECONDS);
  if (!Number.isInteger(ttlRaw) || ttlRaw < TTL_MIN_SECONDS || ttlRaw > TTL_MAX_SECONDS) {
    throw configError(`MCCLUSTER_SCHEDULER_TTL_SECONDS must be an integer ${TTL_MIN_SECONDS}..${TTL_MAX_SECONDS}`, 'MCCLUSTER_SCHEDULER_TTL_SECONDS');
  }
  const renewRaw = env.MCCLUSTER_SCHEDULER_RENEW_MS === undefined || env.MCCLUSTER_SCHEDULER_RENEW_MS === '' ? Math.floor(ttlRaw * 1000 / 3) : Number(env.MCCLUSTER_SCHEDULER_RENEW_MS);
  if (!Number.isFinite(renewRaw)) throw configError('MCCLUSTER_SCHEDULER_RENEW_MS must be a number of milliseconds', 'MCCLUSTER_SCHEDULER_RENEW_MS');
  const renewMs = Math.max(1000, Math.trunc(renewRaw));
  const orgId = String(env.MCCLUSTER_ORG_ID || '').trim();
  if (!UUID.test(orgId)) throw configError('MCCLUSTER_ORG_ID is required (uuid) when MCCLUSTER_SCHEDULER_ROLE is set', 'MCCLUSTER_ORG_ID');
  return { role, holderId, ttlSeconds: ttlRaw, renewMs, orgId };
}

// rpc(name, payload) posts to Supabase rpc/<name> and resolves the decoded body.
export function createRpcStore(rpc) {
  if (typeof rpc !== 'function') throw new TypeError('createRpcStore needs an rpc(name, payload) function');
  return {
    acquire: ({ orgId, holderId, role, ttlSeconds }) => rpc('compute_scheduler_acquire', { p_org_id: orgId, p_holder_id: holderId, p_holder_role: role, p_ttl_seconds: ttlSeconds }),
    renew: ({ orgId, holderId, term, ttlSeconds }) => rpc('compute_scheduler_renew', { p_org_id: orgId, p_holder_id: holderId, p_term: term, p_ttl_seconds: ttlSeconds }),
    release: ({ orgId, holderId, term }) => rpc('compute_scheduler_release', { p_org_id: orgId, p_holder_id: holderId, p_term: term }),
    handover: ({ orgId, holderId, term, toHolderId, graceSeconds }) => rpc('compute_scheduler_handover', { p_org_id: orgId, p_holder_id: holderId, p_term: term, p_to_holder_id: toHolderId, p_grace_seconds: graceSeconds }),
    status: ({ orgId }) => rpc('compute_scheduler_status', { p_org_id: orgId }),
  };
}

// Production store over the Core's Supabase client. The rest function is
// injected or imported lazily so unit tests and staging fixtures need no env.
// Every call carries a network timeout: a black-holed renew must fail, not
// wedge the election loop (the loop also abandons a call older than its own
// callTimeoutMs, so the two bounds back each other up).
export async function createSupabaseSchedulerStore(restImpl, { timeoutMs = DEFAULT_CALL_TIMEOUT_MS } = {}) {
  const rest = restImpl || (await import('../supabase.mjs')).rest;
  const timeout = Math.max(CALL_TIMEOUT_MIN_MS, Math.trunc(Number(timeoutMs) || DEFAULT_CALL_TIMEOUT_MS));
  return createRpcStore(async (name, payload) => (await rest(`rpc/${name}`, {
    method: 'POST', body: JSON.stringify(payload), signal: AbortSignal.timeout(timeout),
  })).body);
}

export function assertActiveScheduler(election) {
  if (election == null) return;
  if (election.isActive()) return;
  // A yielding holder points callers at the successor it named; anyone else
  // points at the last known live holder.
  const target = election.yielding ? (election.handoverTo || election.holder) : election.holder;
  throw Object.assign(new Error('This Core instance is a standby scheduler; submit to the active scheduler'), {
    status: 503, code: 'SCHEDULER_STANDBY', retryable: true, active_holder: target || null,
  });
}

export class SchedulerElection {
  constructor({ orgId, holderId, role, ttlSeconds = 30, renewMs, store, clock = systemClock, marginMs = 1000,
    clockToleranceMs = 1000, callTimeoutMs, onEvent = () => {}, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
    if (!UUID.test(String(orgId || ''))) throw configError('orgId must be a uuid', 'MCCLUSTER_ORG_ID');
    if (!HOLDER_ID_PATTERN.test(String(holderId || ''))) throw configError('holderId must match the scheduler holder pattern', 'MCCLUSTER_SCHEDULER_HOLDER_ID');
    if (!SCHEDULER_ROLES.includes(role)) throw configError('role must be primary or standby', 'MCCLUSTER_SCHEDULER_ROLE');
    if (!store || ['acquire', 'renew', 'release', 'handover', 'status'].some((m) => typeof store[m] !== 'function')) {
      throw new TypeError('store must implement acquire, renew, release, handover and status');
    }
    this.orgId = orgId;
    this.holderId = holderId;
    this.role = role;
    this.ttlSeconds = clampTtlSeconds(ttlSeconds);
    this.renewMs = Math.max(1000, Math.trunc(Number(renewMs) || Math.floor(this.ttlSeconds * 1000 / 3)));
    // A store call older than this is abandoned by the loop (its late reply is
    // ignored) so one hung request cannot stop every later renew or acquire.
    const defaultCallTimeout = Math.min(this.renewMs, Math.floor(this.ttlSeconds * 1000 / 2));
    this.callTimeoutMs = Math.max(CALL_TIMEOUT_MIN_MS, Math.trunc(Number(callTimeoutMs) || defaultCallTimeout));
    this.store = store;
    this.clock = clock;
    this.marginMs = marginMs;
    this.clockToleranceMs = clockToleranceMs;
    this.onEvent = onEvent;
    this.setIntervalImpl = setIntervalImpl;
    this.clearIntervalImpl = clearIntervalImpl;
    // Server-confirmed state.
    this.serverActive = false;
    this.heldTerm = null;
    this.liveHolder = null;
    this.liveTerm = null;
    this.expiresAt = null;
    this.lastServerTime = null;
    this.handoverTo = null;
    this.yielding = false;
    this.roleConflict = false;
    this.lastError = null;
    this.lastReason = null;
    this.configFault = null;
    // Local safeguards.
    this.deadline = null;
    this.lastSample = null;
    this.clockSuspect = false;
    this.discontinuities = 0;
    this.timer = null;
    this.inFlight = null;
    this.inFlightSince = null;
    this.generation = 0;
    this.stopped = true;
    this.halted = false;
  }

  get term() { return this.serverActive ? this.heldTerm : null; }
  get holder() { return this.liveHolder; }

  emit(event, detail) {
    try { this.onEvent(event, detail, this.snapshot()); } catch { /* listeners never break the loop */ }
  }

  sample() {
    const now = this.clock();
    if (this.lastSample) {
      const monoElapsed = now.mono - this.lastSample.mono;
      const wallElapsed = now.wall - this.lastSample.wall;
      // Suspend, wall jumps and paused monotonic clocks all make the local
      // deadline untrustworthy until a call dispatched afterwards confirms.
      if (monoElapsed < 0 || Math.abs(wallElapsed - monoElapsed) > this.clockToleranceMs) {
        this.clockSuspect = true;
        this.discontinuities += 1;
      }
    }
    this.lastSample = now;
    return now;
  }

  // Holds the lease by its own conservative view (server said so, deadline not
  // passed, clocks consistent). Yielding is layered on top in isActive().
  holdsLease() {
    if (!this.serverActive || this.deadline === null) return false;
    const now = this.sample();
    if (this.clockSuspect) return false;
    return now.mono < this.deadline;
  }

  isActive() {
    return this.holdsLease() && !this.yielding;
  }

  dispatch() {
    const sentAt = this.sample();
    return { sentAt, epoch: this.discontinuities };
  }

  // Deadline from the DISPATCH time: the whole round trip is subtracted, and
  // the server's own duration wins when it is shorter than what we asked for.
  // Returns true only when the receipt was adopted; otherwise the instance has
  // been dropped to candidate (reject) and the caller writes no active state.
  confirm(reply, sent) {
    const now = this.sample();
    const serverTime = Date.parse(reply?.server_time);
    const expires = Date.parse(reply?.expires_at);
    const serverDuration = expires - serverTime;
    if (!Number.isFinite(serverTime) || !Number.isFinite(expires) || !(serverDuration > 0) || serverDuration > TTL_MAX_SECONDS * 1000) {
      // No server-stated duration backs this receipt: LeaseAuthority's rule.
      this.reject(reply, 'bad_receipt');
      return false;
    }
    const duration = Math.min(this.ttlSeconds * 1000, serverDuration);
    const deadline = sent.sentAt.mono + duration - this.marginMs;
    if (sent.epoch !== this.discontinuities || sent.sentAt.mono > now.mono) {
      // The clocks jumped (suspend, wall step) between dispatch and reply: the
      // deadline would sit on a monotonic clock that may not have advanced.
      this.reject(reply, 'clock_discontinuity');
      return false;
    }
    if (now.mono >= deadline) {
      // The round trip ate the whole lease: nothing to be active on.
      this.reject(reply, 'late_reply');
      return false;
    }
    this.deadline = deadline;
    this.clockSuspect = false;
    this.lastServerTime = new Date(serverTime).toISOString();
    this.expiresAt = new Date(expires).toISOString();
    this.lastError = null;
    return true;
  }

  // Drop to candidate without trusting the receipt. The server may well still
  // hold us as the live holder; the next tick re-acquires (same holder, same
  // term: 'renewed') with a call dispatched after the fault, and confirms then.
  reject(reply, reason) {
    const wasActive = this.serverActive;
    this.serverActive = false;
    this.heldTerm = null;
    this.deadline = null;
    this.yielding = false;
    this.lastReason = reason;
    this.lastServerTime = typeof reply?.server_time === 'string' ? reply.server_time : this.lastServerTime;
    this.emit('scheduler_unconfirmed', { reason, holder_id: reply?.holder_id ?? null, term: reply?.term ?? null, was_active: wasActive });
  }

  noteHandover(reply) {
    const to = reply?.handover_to || null;
    if (this.yielding && to === null) {
      // The grace window lapsed with no successor: the server shows no pending
      // handover any more, so the holder resumes admitting work.
      const lapsed = this.handoverTo;
      this.yielding = false;
      this.handoverTo = null;
      this.emit('scheduler_handover_lapsed', { handover_to: lapsed });
      return;
    }
    const changed = to && to !== this.handoverTo;
    this.handoverTo = to;
    if (changed) this.emit('scheduler_handover_pending', { handover_to: to });
  }

  applyLoss(reply, cause) {
    const wasActive = this.serverActive;
    this.serverActive = false;
    this.heldTerm = null;
    this.deadline = null;
    this.handoverTo = null;
    this.yielding = false;
    this.liveHolder = reply?.holder_id ?? this.liveHolder;
    this.liveTerm = reply?.term ?? this.liveTerm;
    this.expiresAt = reply?.expires_at ?? this.expiresAt;
    this.lastReason = reply?.reason || cause;
    if (wasActive) this.emit('scheduler_fenced', { reason: this.lastReason, holder_id: this.liveHolder, term: this.liveTerm });
    // Another process holds our holder id with the other role: one identity,
    // two processes. A configuration fault, surfaced once per episode.
    const conflict = this.lastReason === 'role_conflict';
    if (conflict && !this.roleConflict) {
      this.emit('scheduler_error', configError(`holder id ${this.holderId} is live with role ${reply?.holder_role ?? 'unknown'}; this instance is ${this.role}. Give every Core process its own MCCLUSTER_SCHEDULER_HOLDER_ID`, 'MCCLUSTER_SCHEDULER_HOLDER_ID'));
    }
    this.roleConflict = conflict;
  }

  async acquireOnce(generation = this.generation) {
    const sent = this.dispatch();
    const reply = await this.store.acquire({ orgId: this.orgId, holderId: this.holderId, role: this.role, ttlSeconds: this.ttlSeconds });
    if (generation !== this.generation) return reply; // abandoned or stopped: a late reply changes nothing
    if (!reply || typeof reply !== 'object') throw Object.assign(new Error('scheduler acquire returned no receipt'), { code: 'SCHEDULER_BAD_REPLY' });
    this.lastReason = reply.reason || null;
    this.liveHolder = reply.holder_id ?? null;
    this.liveTerm = reply.term ?? null;
    if (reply.active === true && reply.holder_id === this.holderId && Number.isInteger(Number(reply.term))) {
      const wasActive = this.serverActive;
      if (this.confirm(reply, sent)) {
        this.serverActive = true;
        this.heldTerm = Number(reply.term);
        this.noteHandover(reply);
        if (!wasActive) this.emit('scheduler_active', { term: this.heldTerm, reason: reply.reason });
      }
    } else {
      this.applyLoss(reply, 'held');
      this.lastServerTime = reply.server_time || this.lastServerTime;
    }
    return reply;
  }

  async renewOnce(generation = this.generation) {
    const sent = this.dispatch();
    const term = this.heldTerm;
    const reply = await this.store.renew({ orgId: this.orgId, holderId: this.holderId, term, ttlSeconds: this.ttlSeconds });
    if (generation !== this.generation) return reply;
    if (!reply || typeof reply !== 'object') throw Object.assign(new Error('scheduler renew returned no receipt'), { code: 'SCHEDULER_BAD_REPLY' });
    if (reply.ok === true && Number(reply.term) === term && this.heldTerm === term) {
      if (this.confirm(reply, sent)) {
        this.liveHolder = this.holderId;
        this.liveTerm = term;
        this.lastReason = reply.reason || 'renewed';
        this.noteHandover(reply);
      }
    } else {
      this.applyLoss(reply, 'fenced');
      this.lastServerTime = reply.server_time || this.lastServerTime;
    }
    return reply;
  }

  // A wrong MCCLUSTER_ORG_ID can never become right by retrying: stop the loop,
  // keep the fault on the snapshot (health shows it) and stay a candidate.
  halt(error) {
    this.halted = true;
    if (this.timer) { this.clearIntervalImpl(this.timer); this.timer = null; }
    this.configFault = configError(`MCCLUSTER_ORG_ID ${this.orgId} names no row of public.orgs (${error?.message || error}); the election loop stopped`, 'MCCLUSTER_ORG_ID');
    this.lastError = this.configFault.message;
    this.emit('scheduler_error', this.configFault);
  }

  // One loop step. Never throws: faults are events, and they only ever let the
  // local deadline run out (fail closed). A call that has not settled within
  // callTimeoutMs is abandoned: the loop moves on and its late reply is ignored.
  async tick() {
    if (this.halted) return;
    if (this.inFlight) {
      const now = this.sample();
      if (this.inFlightSince !== null && now.mono - this.inFlightSince < this.callTimeoutMs) return this.inFlight;
      this.emit('scheduler_call_abandoned', { after_ms: this.inFlightSince === null ? null : now.mono - this.inFlightSince });
      this.inFlight = null;
    }
    const generation = ++this.generation;
    this.inFlightSince = this.clock().mono;
    this.inFlight = (async () => {
      try {
        if (this.serverActive && this.heldTerm !== null) await this.renewOnce(generation);
        else await this.acquireOnce(generation);
      } catch (error) {
        if (generation !== this.generation) return;
        this.lastError = error?.message || String(error);
        if (isUnknownOrgError(error)) this.halt(error);
        else this.emit('scheduler_error', error);
      } finally {
        if (generation === this.generation) { this.inFlight = null; this.inFlightSince = null; }
      }
    })();
    return this.inFlight;
  }

  async start() {
    this.stopped = false;
    await this.tick();
    if (this.stopped || this.halted) return this.isActive();
    if (!this.timer) {
      this.timer = this.setIntervalImpl(() => { this.tick(); }, this.renewMs);
      this.timer?.unref?.();
    }
    return this.isActive();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) { this.clearIntervalImpl(this.timer); this.timer = null; }
    if (this.inFlight) {
      // Wait for a settling call, never for a hung one.
      const pending = this.inFlight.catch(() => {});
      await Promise.race([pending, new Promise((resolve) => { setTimeout(resolve, this.callTimeoutMs); })]);
    }
    this.generation += 1; // a reply that lands after this point changes nothing
    this.inFlight = null;
    this.inFlightSince = null;
    if (this.serverActive && this.heldTerm !== null) {
      const term = this.heldTerm;
      this.serverActive = false;
      this.deadline = null;
      this.yielding = false;
      try {
        const reply = await this.store.release({ orgId: this.orgId, holderId: this.holderId, term });
        this.lastReason = reply?.reason || 'released';
        this.emit('scheduler_released', { term, ok: reply?.ok === true });
      } catch (error) {
        this.lastError = error?.message || String(error);
        this.emit('scheduler_error', error);
      }
      this.heldTerm = null;
    }
  }

  // The live holder names its successor and yields at once: from the ok reply
  // on, isActive() is false while this handover is pending. Renews keep the
  // row alive for the successor; a lapse (no successor inside the grace
  // window) resumes this holder on its next renew. A second request while
  // yielding (new target or longer grace) is allowed.
  async requestHandover(toHolderId, graceSeconds = 120) {
    if (!HOLDER_ID_PATTERN.test(String(toHolderId || ''))) {
      throw Object.assign(new Error('handover target must match the scheduler holder pattern'), { status: 400, code: 'SCHEDULER_HANDOVER_INVALID' });
    }
    if (toHolderId === this.holderId) {
      throw Object.assign(new Error('a scheduler cannot hand over to itself'), { status: 400, code: 'SCHEDULER_HANDOVER_INVALID' });
    }
    if (!this.holdsLease()) assertActiveScheduler(this);
    const grace = Math.max(GRACE_MIN_SECONDS, Math.min(GRACE_MAX_SECONDS, Math.trunc(Number(graceSeconds) || 120)));
    const reply = await this.store.handover({ orgId: this.orgId, holderId: this.holderId, term: this.heldTerm, toHolderId, graceSeconds: grace });
    if (reply?.ok === true) {
      this.handoverTo = reply.handover_to || toHolderId;
      this.yielding = true;
      this.emit('scheduler_handover_pending', { handover_to: this.handoverTo, handover_expires_at: reply.handover_expires_at || null, yielded: true });
    } else if (reply?.reason === 'fenced') {
      this.applyLoss(reply, 'fenced');
    }
    return reply;
  }

  snapshot() {
    const holds = this.serverActive && this.deadline !== null && !this.clockSuspect && this.lastSample !== null && this.lastSample.mono < this.deadline;
    return {
      role: this.role,
      holder_id: this.holderId,
      active: holds && !this.yielding,
      yielding: this.yielding,
      term: this.term,
      live_holder: this.liveHolder,
      live_term: this.liveTerm,
      expires_at: this.expiresAt,
      last_server_time: this.lastServerTime,
      last_reason: this.lastReason,
      last_error: this.lastError,
      handover_to: this.handoverTo,
      halted: this.halted,
      config_error: this.configFault ? { code: this.configFault.code, variable: this.configFault.variable, message: this.configFault.message } : null,
    };
  }
}

// In-memory implementation of the five RPC semantics with the SQL's exact
// rules, for unit tests and the staging harness. clockFn returns wall-clock ms.
// `orgs` (optional) is the set of known org ids: with it, acquire answers an
// unknown org the way the SQL does ('unknown org', SQLSTATE P0002).
export function createMemorySchedulerStore(clockFn = () => Date.now(), { orgs = null } = {}) {
  const rows = new Map();
  const known = orgs === null ? null : new Set(orgs);
  const iso = (ms) => new Date(ms).toISOString();
  const clampTtl = (v) => clampTtlSeconds(v) * 1000;
  // coalesce(p_grace_seconds, 120): null and undefined are the default, not zero.
  const clampGrace = (v) => {
    const n = v === null || v === undefined ? 120 : Number(v);
    return Math.max(GRACE_MIN_SECONDS, Math.min(GRACE_MAX_SECONDS, Math.trunc(Number.isFinite(n) ? n : 120))) * 1000;
  };
  const push = (history, entry) => [...history, entry].slice(-HISTORY_LIMIT);
  const expired = (row, now) => row.released_at !== null || row.expires_at <= now;
  const pendingHandover = (row, now) => (row.handover_to !== null && row.handover_expires_at !== null && row.handover_expires_at > now ? row.handover_to : null);
  const view = (row, now, extra) => ({ holder_id: row.holder_id, holder_role: row.holder_role, term: row.term, expires_at: iso(row.expires_at), server_time: iso(now), ...extra });
  function requireOrg(orgId) { if (typeof orgId !== 'string' || !UUID.test(orgId)) throw new Error('p_org_id is required'); }
  function requireIdentity(holderId, term) {
    if (holderId === null || holderId === undefined) throw new Error('invalid holder id');
    if (term === null || term === undefined) throw new Error('p_term is required');
  }
  return {
    rows,
    async acquire({ orgId, holderId, role, ttlSeconds }) {
      requireOrg(orgId);
      if (!HOLDER_ID_PATTERN.test(String(holderId || ''))) throw new Error('invalid holder id');
      if (!SCHEDULER_ROLES.includes(role)) throw new Error('invalid holder role');
      if (known !== null && !known.has(orgId)) throw Object.assign(new Error('unknown org'), { code: UNKNOWN_ORG_SQLSTATE, detail: { code: UNKNOWN_ORG_SQLSTATE, message: 'unknown org' } });
      const now = clockFn();
      const ttl = clampTtl(ttlSeconds);
      let row = rows.get(orgId);
      if (!row) {
        row = { org_id: orgId, holder_id: holderId, holder_role: role, term: 1, acquired_at: now, renewed_at: now, expires_at: now + ttl,
          handover_to: null, handover_requested_at: null, handover_expires_at: null, released_at: null, updated_at: now,
          history: [{ at: iso(now), event: 'fresh', from_holder: null, to_holder: holderId, term: 1 }] };
        rows.set(orgId, row);
        return view(row, now, { active: true, reason: 'fresh', handover_to: null });
      }
      const isExpired = expired(row, now);
      if (row.holder_id === holderId && !isExpired) {
        if (row.holder_role !== role) return view(row, now, { active: false, reason: 'role_conflict', handover_to: pendingHandover(row, now) });
        row.renewed_at = now; row.expires_at = now + ttl; row.updated_at = now;
        return view(row, now, { active: true, reason: 'renewed', handover_to: pendingHandover(row, now) });
      }
      let reason;
      if (isExpired) reason = 'expired_takeover';
      else if (pendingHandover(row, now) === holderId) reason = 'handover';
      else return view(row, now, { active: false, reason: 'held', handover_to: pendingHandover(row, now) });
      const from = row.holder_id;
      row.term += 1; row.holder_id = holderId; row.holder_role = role;
      row.acquired_at = now; row.renewed_at = now; row.expires_at = now + ttl;
      row.handover_to = null; row.handover_requested_at = null; row.handover_expires_at = null; row.released_at = null; row.updated_at = now;
      row.history = push(row.history, { at: iso(now), event: reason, from_holder: from, to_holder: holderId, term: row.term });
      return view(row, now, { active: true, reason, handover_to: null });
    },
    async renew({ orgId, holderId, term, ttlSeconds }) {
      requireOrg(orgId);
      requireIdentity(holderId, term);
      const now = clockFn();
      const row = rows.get(orgId);
      if (!row) return { ok: false, holder_id: null, term: null, expires_at: null, server_time: iso(now), reason: 'fenced', handover_to: null };
      if (row.holder_id === holderId && row.term === Number(term) && row.released_at === null && row.expires_at > now) {
        row.renewed_at = now; row.expires_at = now + clampTtl(ttlSeconds); row.updated_at = now;
        return { ok: true, holder_id: row.holder_id, term: row.term, expires_at: iso(row.expires_at), server_time: iso(now), reason: 'renewed', handover_to: pendingHandover(row, now) };
      }
      return { ok: false, holder_id: row.holder_id, term: row.term, expires_at: iso(row.expires_at), server_time: iso(now), reason: 'fenced', handover_to: null };
    },
    async release({ orgId, holderId, term }) {
      requireOrg(orgId);
      requireIdentity(holderId, term);
      const now = clockFn();
      const row = rows.get(orgId);
      if (!row || row.holder_id !== holderId || row.term !== Number(term)) {
        return { ok: false, reason: 'fenced', holder_id: row?.holder_id ?? null, term: row?.term ?? null, server_time: iso(now) };
      }
      if (row.released_at !== null) return { ok: true, reason: 'released', term: row.term, server_time: iso(now) };
      row.released_at = now; row.expires_at = now; row.updated_at = now;
      row.handover_to = null; row.handover_requested_at = null; row.handover_expires_at = null;
      row.history = push(row.history, { at: iso(now), event: 'released', from_holder: holderId, to_holder: null, term: row.term });
      return { ok: true, reason: 'released', term: row.term, server_time: iso(now) };
    },
    async handover({ orgId, holderId, term, toHolderId, graceSeconds }) {
      requireOrg(orgId);
      requireIdentity(holderId, term);
      const now = clockFn();
      const row = rows.get(orgId);
      if (!row || row.holder_id !== holderId || row.term !== Number(term) || row.released_at !== null || row.expires_at <= now) {
        return { ok: false, reason: 'fenced', handover_to: null, handover_expires_at: null, holder_id: row?.holder_id ?? null, term: row?.term ?? null, server_time: iso(now) };
      }
      if (!toHolderId || toHolderId === holderId || !HOLDER_ID_PATTERN.test(String(toHolderId))) {
        return { ok: false, reason: 'invalid', handover_to: null, handover_expires_at: null, holder_id: row.holder_id, term: row.term, server_time: iso(now) };
      }
      row.handover_to = toHolderId; row.handover_requested_at = now; row.handover_expires_at = now + clampGrace(graceSeconds); row.updated_at = now;
      row.history = push(row.history, { at: iso(now), event: 'handover_requested', from_holder: holderId, to_holder: toHolderId, term: row.term });
      return { ok: true, reason: 'handover_requested', handover_to: row.handover_to, handover_expires_at: iso(row.handover_expires_at), holder_id: row.holder_id, term: row.term, server_time: iso(now) };
    },
    async status({ orgId }) {
      requireOrg(orgId);
      const now = clockFn();
      const row = rows.get(orgId);
      if (!row) return null;
      const live = !expired(row, now);
      return {
        org_id: row.org_id, holder_id: row.holder_id, holder_role: row.holder_role, term: row.term,
        acquired_at: iso(row.acquired_at), renewed_at: iso(row.renewed_at), expires_at: iso(row.expires_at),
        handover_to: row.handover_to, handover_requested_at: row.handover_requested_at === null ? null : iso(row.handover_requested_at),
        handover_expires_at: row.handover_expires_at === null ? null : iso(row.handover_expires_at),
        released_at: row.released_at === null ? null : iso(row.released_at), updated_at: iso(row.updated_at),
        history: row.history.slice(), live, handover_pending: live && pendingHandover(row, now) !== null, server_time: iso(now),
      };
    },
  };
}
