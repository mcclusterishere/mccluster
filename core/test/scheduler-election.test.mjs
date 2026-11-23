import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SchedulerElection, assertActiveScheduler, createMemorySchedulerStore, createRpcStore, electionConfigFromEnv, isUnknownOrgError,
} from '../src/compute/scheduler-election.mjs';

const ORG = '00000000-0000-0000-0000-000000000011';
const baseTime = Date.parse('2026-11-23T07:00:00Z');

function harness() {
  let mono = 0; let wall = baseTime;
  const clock = () => ({ mono, wall });
  const timers = new Map(); let next = 1;
  // The server has its own clock: it follows the monotonic advance, never the client's wall jumps.
  const store = createMemorySchedulerStore(() => baseTime + mono);
  const events = [];
  const base = {
    orgId: ORG, ttlSeconds: 30, renewMs: 10_000, clock,
    setIntervalImpl: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; },
    clearIntervalImpl: (id) => timers.delete(id),
  };
  const onEvent = (who) => (event, detail) => events.push({ who, event, detail });
  // A store wrapper that can be cut off from the server (partition).
  const partitionable = (inner) => {
    const state = { down: false };
    const wrap = (name) => async (args) => { if (state.down) throw Object.assign(new Error(`${name}: network unreachable`), { code: 'ECONNRESET' }); return inner[name](args); };
    return { state, store: { acquire: wrap('acquire'), renew: wrap('renew'), release: wrap('release'), handover: wrap('handover'), status: wrap('status') } };
  };
  return {
    clock, store, timers, events, base, onEvent, partitionable,
    advance(ms, wallMs = ms) { mono += ms; wall += wallMs; },
    async fire() { for (const timer of [...timers.values()]) timer.fn(); await flush(); },
    now() { return baseTime + mono; },
  };
}
async function flush() { for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve)); }

test('primary becomes active with term 1; a standby stays inactive while the primary renews', async () => {
  const h = harness();
  const primary = new SchedulerElection({ ...h.base, holderId: 'core-primary', role: 'primary', store: h.store, onEvent: h.onEvent('primary') });
  const standby = new SchedulerElection({ ...h.base, holderId: 'core-standby', role: 'standby', store: h.store, onEvent: h.onEvent('standby') });
  assert.equal(await primary.start(), true);
  assert.equal(primary.term, 1);
  assert.equal(primary.isActive(), true);
  assert.equal(await standby.start(), false);
  assert.equal(standby.isActive(), false);
  assert.equal(standby.holder, 'core-primary');
  assert.equal(standby.term, null);
  assert.deepEqual(h.events.filter((e) => e.event === 'scheduler_active').map((e) => e.who), ['primary']);
  for (let i = 0; i < 6; i++) { h.advance(10_000); await h.fire(); assert.equal(primary.isActive(), true); assert.equal(standby.isActive(), false); }
  assert.equal(primary.term, 1);
  assert.equal(standby.snapshot().last_reason, 'held');
  assert.equal(h.events.filter((e) => e.event === 'scheduler_fenced').length, 0);
  await primary.stop(); await standby.stop();
  assert.equal(h.timers.size, 0);
  assert.equal((await h.store.status({ orgId: ORG })).live, false);
});

test('partition: the primary fails closed before the server lease expires; the standby takes over after expiry; the old primary is fenced; failback only by handover', async () => {
  const h = harness();
  const link = h.partitionable(h.store);
  const primary = new SchedulerElection({ ...h.base, holderId: 'core-primary', role: 'primary', store: link.store, onEvent: h.onEvent('primary') });
  const standby = new SchedulerElection({ ...h.base, holderId: 'core-standby', role: 'standby', store: h.store, onEvent: h.onEvent('standby') });
  await primary.start(); await standby.start();
  h.advance(10_000); await h.fire(); // last successful renew at mono 10_000 -> server expiry at wall +40_000
  assert.equal(primary.isActive(), true);
  const serverExpiry = Date.parse((await h.store.status({ orgId: ORG })).expires_at);
  assert.equal(serverExpiry, baseTime + 40_000);

  link.state.down = true;
  h.advance(10_000); await h.fire(); // renew fails
  assert.equal(h.events.some((e) => e.who === 'primary' && e.event === 'scheduler_error'), true);
  assert.equal(primary.isActive(), true, 'a failed renew alone does not drop authority before the local deadline');
  h.advance(8_999); // mono 28_999: local deadline is 10_000 + 30_000 - 1_000 = 39_000
  await h.fire();
  assert.equal(primary.isActive(), true);
  h.advance(10_000); // mono 38_999
  assert.equal(primary.isActive(), true);
  h.advance(1); // mono 39_000 == deadline
  assert.equal(primary.isActive(), false, 'local deadline passed');
  assert.ok(h.now() < serverExpiry, 'the primary stepped down while the server lease was still live (fail closed)');
  assert.throws(() => assertActiveScheduler(primary), (error) => error.code === 'SCHEDULER_STANDBY' && error.status === 503);
  await h.fire(); // standby acquire at wall 39_000: still held
  assert.equal(standby.isActive(), false);
  assert.equal(standby.snapshot().last_reason, 'held');

  h.advance(1_000); // wall 40_000: expires_at <= now
  await h.fire();
  assert.equal(standby.isActive(), true);
  assert.equal(standby.term, 2);
  assert.equal(standby.snapshot().last_reason, 'expired_takeover');
  assert.deepEqual(h.events.filter((e) => e.who === 'standby' && e.event === 'scheduler_active').map((e) => e.detail.term), [2]);

  // The partitioned primary reconnects: its renew is fenced and it stays inactive.
  link.state.down = false;
  h.advance(10_000); await h.fire();
  assert.equal(primary.isActive(), false);
  assert.equal(primary.term, null);
  assert.equal(primary.holder, 'core-standby');
  assert.deepEqual(h.events.filter((e) => e.who === 'primary' && e.event === 'scheduler_fenced').map((e) => e.detail.holder_id), ['core-standby']);
  assert.equal(standby.isActive(), true);
  h.advance(10_000); await h.fire(); // primary now acquires as a candidate: held
  assert.equal(primary.isActive(), false);
  assert.equal(primary.snapshot().last_reason, 'held');
  assert.equal(standby.term, 2, 'a live standby is never preempted by the primary');

  // Controlled failback: the active standby names the primary; the primary takes over on its next acquire.
  const handover = await standby.requestHandover('core-primary');
  assert.equal(handover.ok, true);
  assert.equal(standby.snapshot().handover_to, 'core-primary');
  assert.equal(h.events.some((e) => e.who === 'standby' && e.event === 'scheduler_handover_pending'), true);
  h.advance(10_000); await h.fire();
  assert.equal(primary.isActive(), true);
  assert.equal(primary.term, 3);
  assert.equal(primary.snapshot().last_reason, 'handover');
  assert.equal(standby.isActive(), false);
  assert.equal(standby.snapshot().last_reason, 'fenced');
  assert.deepEqual(h.events.filter((e) => e.who === 'standby' && e.event === 'scheduler_fenced').map((e) => e.detail.holder_id), ['core-primary']);
  assert.throws(() => assertActiveScheduler(standby), (error) => error.code === 'SCHEDULER_STANDBY' && error.active_holder === 'core-primary' && error.retryable === true);
  assert.doesNotThrow(() => assertActiveScheduler(primary));
  const status = await h.store.status({ orgId: ORG });
  assert.equal(status.term, 3); assert.equal(status.handover_to, null); assert.equal(status.live, true);
  assert.deepEqual(status.history.map((e) => e.event), ['fresh', 'expired_takeover', 'handover_requested', 'handover']);
  await primary.stop(); await standby.stop();
});

test('handover is bounded: self, non-holder and expired grace windows never move the term', async () => {
  const h = harness();
  const primary = new SchedulerElection({ ...h.base, holderId: 'core-primary', role: 'primary', store: h.store, onEvent: h.onEvent('primary') });
  const standby = new SchedulerElection({ ...h.base, holderId: 'core-standby', role: 'standby', store: h.store, onEvent: h.onEvent('standby') });
  await primary.start(); await standby.start();
  await assert.rejects(primary.requestHandover('core-primary'), (error) => error.code === 'SCHEDULER_HANDOVER_INVALID');
  await assert.rejects(primary.requestHandover('Bad Holder'), (error) => error.code === 'SCHEDULER_HANDOVER_INVALID');
  await assert.rejects(standby.requestHandover('core-primary'), (error) => error.code === 'SCHEDULER_STANDBY');
  assert.equal((await h.store.handover({ orgId: ORG, holderId: 'core-standby', term: 1, toHolderId: 'core-primary', graceSeconds: 60 })).reason, 'fenced');
  assert.equal((await h.store.handover({ orgId: ORG, holderId: 'core-primary', term: 1, toHolderId: 'core-primary', graceSeconds: 60 })).reason, 'invalid');
  const granted = await primary.requestHandover('core-standby', 10);
  assert.equal(granted.ok, true);
  h.advance(10_001); // grace of 10 s elapsed before the standby's next tick
  await h.fire();
  assert.equal(standby.isActive(), false);
  assert.equal(primary.isActive(), true);
  assert.equal(primary.term, 1);
  assert.equal(primary.snapshot().handover_to, null, 'an expired handover is no longer reported as pending');
  await primary.stop(); await standby.stop();
});

test('assertActiveScheduler passes with no election configured', () => {
  assert.doesNotThrow(() => assertActiveScheduler(null));
  assert.doesNotThrow(() => assertActiveScheduler(undefined));
});

test('a clock discontinuity makes the holder inactive until the server confirms again', async () => {
  const h = harness();
  const primary = new SchedulerElection({ ...h.base, holderId: 'core-primary', role: 'primary', store: h.store });
  await primary.start();
  h.advance(100, 60_000); // wall jumped forward a minute while the monotonic clock moved 100 ms
  assert.equal(primary.isActive(), false);
  assert.throws(() => assertActiveScheduler(primary), (error) => error.code === 'SCHEDULER_STANDBY');
  h.advance(100); // steady again, but still unconfirmed
  assert.equal(primary.isActive(), false);
  await h.fire(); // renew succeeds (the memory store follows the wall clock) and resets the local view
  assert.equal(primary.isActive(), true);
  const sleeper = new SchedulerElection({ ...h.base, holderId: 'core-standby', role: 'standby', store: createMemorySchedulerStore(() => h.now() + 1), orgId: '00000000-0000-0000-0000-000000000012' });
  await sleeper.start();
  assert.equal(sleeper.isActive(), true);
  h.advance(10, 180_000); // suspend
  assert.equal(sleeper.isActive(), false);
  await primary.stop(); await sleeper.stop();
});

test('store faults never flip an instance to active and never escape the loop', async () => {
  const h = harness();
  const broken = { acquire: async () => { throw new Error('boom'); }, renew: async () => { throw new Error('boom'); }, release: async () => ({ ok: true }), handover: async () => ({ ok: false }), status: async () => null };
  const events = [];
  const candidate = new SchedulerElection({ ...h.base, holderId: 'core-standby', role: 'standby', store: broken, onEvent: (e) => events.push(e) });
  assert.equal(await candidate.start(), false);
  h.advance(10_000); await h.fire();
  assert.equal(candidate.isActive(), false);
  assert.deepEqual(events, ['scheduler_error', 'scheduler_error']);
  assert.equal(candidate.snapshot().last_error, 'boom');
  const liar = { ...broken, acquire: async () => ({ active: true, holder_id: 'someone-else', term: 9 }), renew: async () => ({ ok: true, term: 9 }) };
  const fooled = new SchedulerElection({ ...h.base, holderId: 'core-standby', role: 'standby', store: liar });
  assert.equal(await fooled.start(), false, 'a receipt naming another holder grants nothing');
  await candidate.stop(); await fooled.stop();
});

test('createRpcStore posts the five RPCs with the SQL parameter names', async () => {
  const calls = [];
  const store = createRpcStore(async (name, payload) => { calls.push([name, payload]); return { ok: true }; });
  await store.acquire({ orgId: ORG, holderId: 'a', role: 'primary', ttlSeconds: 30 });
  await store.renew({ orgId: ORG, holderId: 'a', term: 2, ttlSeconds: 30 });
  await store.release({ orgId: ORG, holderId: 'a', term: 2 });
  await store.handover({ orgId: ORG, holderId: 'a', term: 2, toHolderId: 'b', graceSeconds: 60 });
  await store.status({ orgId: ORG });
  assert.deepEqual(calls, [
    ['compute_scheduler_acquire', { p_org_id: ORG, p_holder_id: 'a', p_holder_role: 'primary', p_ttl_seconds: 30 }],
    ['compute_scheduler_renew', { p_org_id: ORG, p_holder_id: 'a', p_term: 2, p_ttl_seconds: 30 }],
    ['compute_scheduler_release', { p_org_id: ORG, p_holder_id: 'a', p_term: 2 }],
    ['compute_scheduler_handover', { p_org_id: ORG, p_holder_id: 'a', p_term: 2, p_to_holder_id: 'b', p_grace_seconds: 60 }],
    ['compute_scheduler_status', { p_org_id: ORG }],
  ]);
});

test('memory store mirrors the SQL rules: term increments, bounded history, handover expiry, ttl clamp', async () => {
  let wall = baseTime;
  const store = createMemorySchedulerStore(() => wall);
  const p = { orgId: ORG, holderId: 'core-primary', role: 'primary', ttlSeconds: 1 };
  const fresh = await store.acquire(p);
  assert.equal(fresh.reason, 'fresh'); assert.equal(fresh.term, 1);
  assert.equal(Date.parse(fresh.expires_at) - Date.parse(fresh.server_time), 10_000, 'ttl floor is 10 s');
  assert.equal((await store.acquire({ ...p, ttlSeconds: 9999 })).reason, 'renewed');
  assert.equal(Date.parse((await store.status({ orgId: ORG })).expires_at) - wall, 300_000, 'ttl ceiling is 300 s');
  for (let i = 0; i < 15; i++) {
    const term = (await store.status({ orgId: ORG })).term;
    assert.equal((await store.release({ orgId: ORG, holderId: 'core-primary', term })).ok, true);
    assert.equal((await store.acquire(p)).reason, 'expired_takeover');
  }
  const status = await store.status({ orgId: ORG });
  assert.equal(status.term, 16); assert.equal(status.history.length, 20); assert.equal(status.history.at(-1).term, 16);
  assert.equal((await store.release({ orgId: ORG, holderId: 'core-primary', term: 15 })).reason, 'fenced');
  assert.equal((await store.renew({ orgId: ORG, holderId: 'core-primary', term: 16, ttlSeconds: 300 })).ok, true);
  assert.equal((await store.handover({ orgId: ORG, holderId: 'core-primary', term: 16, toHolderId: 'core-standby', graceSeconds: 1 })).ok, true);
  wall += 10_001; // grace floor (10 s) elapsed; the lease itself (300 s) is still live
  assert.equal((await store.acquire({ ...p, holderId: 'core-standby', role: 'standby' })).reason, 'held');
  assert.equal(await store.status({ orgId: '00000000-0000-0000-0000-0000000000ee' }), null);
  await assert.rejects(store.acquire({ ...p, holderId: 'Bad' }), /invalid holder id/);
  await assert.rejects(store.acquire({ ...p, role: 'leader' }), /invalid holder role/);
});

test('electionConfigFromEnv: disabled when unset; validates role, holder id, ttl and org', () => {
  assert.equal(electionConfigFromEnv({}), null);
  assert.equal(electionConfigFromEnv({ MCCLUSTER_SCHEDULER_ROLE: '' }), null);
  assert.throws(() => electionConfigFromEnv({ MCCLUSTER_SCHEDULER_ROLE: 'leader', MCCLUSTER_ORG_ID: ORG }), (e) => e.code === 'SCHEDULER_CONFIG' && e.variable === 'MCCLUSTER_SCHEDULER_ROLE');
  assert.throws(() => electionConfigFromEnv({ MCCLUSTER_SCHEDULER_ROLE: 'primary', MCCLUSTER_CORE_ID: 'core:host:123', MCCLUSTER_ORG_ID: ORG }), (e) => e.variable === 'MCCLUSTER_SCHEDULER_HOLDER_ID');
  assert.throws(() => electionConfigFromEnv({ MCCLUSTER_SCHEDULER_ROLE: 'primary', MCCLUSTER_SCHEDULER_HOLDER_ID: 'Ovh Core', MCCLUSTER_ORG_ID: ORG }), (e) => e.variable === 'MCCLUSTER_SCHEDULER_HOLDER_ID');
  assert.throws(() => electionConfigFromEnv({ MCCLUSTER_SCHEDULER_ROLE: 'standby' }), (e) => e.variable === 'MCCLUSTER_ORG_ID');
  assert.throws(() => electionConfigFromEnv({ MCCLUSTER_SCHEDULER_ROLE: 'standby', MCCLUSTER_ORG_ID: 'not-a-uuid' }), (e) => e.variable === 'MCCLUSTER_ORG_ID');
  assert.throws(() => electionConfigFromEnv({ MCCLUSTER_SCHEDULER_ROLE: 'standby', MCCLUSTER_ORG_ID: ORG, MCCLUSTER_SCHEDULER_TTL_SECONDS: '5' }), (e) => e.variable === 'MCCLUSTER_SCHEDULER_TTL_SECONDS');
  assert.throws(() => electionConfigFromEnv({ MCCLUSTER_SCHEDULER_ROLE: 'standby', MCCLUSTER_ORG_ID: ORG, MCCLUSTER_SCHEDULER_TTL_SECONDS: '301' }), (e) => e.variable === 'MCCLUSTER_SCHEDULER_TTL_SECONDS');
  assert.deepEqual(electionConfigFromEnv({ MCCLUSTER_SCHEDULER_ROLE: 'primary', MCCLUSTER_ORG_ID: ORG }),
    { role: 'primary', holderId: 'core-primary', ttlSeconds: 30, renewMs: 10_000, orgId: ORG });
  assert.deepEqual(electionConfigFromEnv({ MCCLUSTER_SCHEDULER_ROLE: 'standby', MCCLUSTER_ORG_ID: ORG, MCCLUSTER_CORE_ID: 'prime-standby', MCCLUSTER_SCHEDULER_TTL_SECONDS: '60', MCCLUSTER_SCHEDULER_RENEW_MS: '250' }),
    { role: 'standby', holderId: 'prime-standby', ttlSeconds: 60, renewMs: 1000, orgId: ORG });
  assert.throws(() => new SchedulerElection({ orgId: ORG, holderId: 'x', role: 'primary', store: {} }), TypeError);
});

// Regressions for the 2026-11-23 review of the scheduler-election slice.

// A store whose next reply of one method is held back until the test lets it go.
function gate(inner, method) {
  let release = null; let pendingReply = null; let armed = false;
  const store = { ...inner };
  store[method] = async (args) => {
    const reply = await inner[method](args); // the server processes the call at dispatch time
    if (!armed) return reply;
    armed = false;
    pendingReply = reply;
    return new Promise((resolve) => { release = () => resolve(pendingReply); });
  };
  return { store, arm() { armed = true; }, open() { const r = release; release = null; r?.(); } };
}

test('suspend while a renew is in flight is never confirmed: the holder steps down and only the standby is active after takeover', async () => {
  const h = harness();
  let serverSkew = 0; // the real server clock keeps running while the laptop sleeps
  const server = createMemorySchedulerStore(() => h.now() + serverSkew);
  const gated = gate(server, 'renew');
  const primary = new SchedulerElection({ ...h.base, holderId: 'core-primary', role: 'primary', store: gated.store, onEvent: h.onEvent('primary') });
  const standby = new SchedulerElection({ ...h.base, holderId: 'core-standby', role: 'standby', store: server, onEvent: h.onEvent('standby') });
  assert.equal(await primary.start(), true);
  assert.equal(await standby.start(), false);
  h.advance(10_000);
  gated.arm();
  const inFlight = primary.tick(); // renew dispatched at mono 10 s; the server stamps expires_at = +40 s
  await flush();
  // Suspend: the monotonic clock moves 100 ms, the wall clock and the server move 5 minutes.
  h.advance(100, 300_000); serverSkew += 300_000 - 100;
  gated.open(); await inFlight;
  assert.equal(primary.isActive(), false, 'a receipt consumed across a clock discontinuity grants nothing');
  assert.equal(primary.snapshot().last_reason, 'clock_discontinuity');
  assert.equal(primary.term, null);
  assert.deepEqual(h.events.filter((e) => e.who === 'primary' && e.event === 'scheduler_unconfirmed').map((e) => e.detail.reason), ['clock_discontinuity']);
  assert.equal((await server.status({ orgId: ORG })).live, false, 'the server lease really did expire during the sleep');
  await standby.tick();
  assert.equal(standby.isActive(), true);
  assert.equal(standby.term, 2);
  assert.equal([primary, standby].filter((e) => e.isActive()).length, 1, 'never two active instances');
  await primary.tick(); // the woken primary asks again and is held
  assert.equal(primary.isActive(), false);
  assert.equal(primary.snapshot().last_reason, 'held');
  assert.throws(() => assertActiveScheduler(primary), (error) => error.code === 'SCHEDULER_STANDBY' && error.active_holder === 'core-standby');
  await primary.stop(); await standby.stop();
});

test('a reply that lands after the deadline it earns, or without a server-stated duration, is rejected', async () => {
  const h = harness();
  const gated = gate(h.store, 'renew');
  const primary = new SchedulerElection({ ...h.base, holderId: 'core-primary', role: 'primary', store: gated.store, onEvent: h.onEvent('primary') });
  await primary.start();
  h.advance(10_000);
  gated.arm();
  const inFlight = primary.tick(); await flush();
  h.advance(29_500); // the round trip ate the lease: deadline would be 10_000 + 30_000 - 1_000 = 39_000 < 39_500
  gated.open(); await inFlight;
  assert.equal(primary.isActive(), false);
  assert.equal(primary.snapshot().last_reason, 'late_reply');
  assert.equal(h.events.filter((e) => e.event === 'scheduler_active').length, 1, 'no second scheduler_active for a receipt that was never adopted');
  await primary.tick(); // dispatched after the fault: the server still holds us, same term, and this one confirms
  assert.equal(primary.isActive(), true);
  assert.equal(primary.term, 1);
  assert.equal(primary.snapshot().last_reason, 'renewed');
  await primary.stop();

  const timeless = { ...h.store, acquire: async () => ({ active: true, holder_id: 'core-standby', term: 1 }) };
  const fooled = new SchedulerElection({ ...h.base, holderId: 'core-standby', role: 'standby', store: timeless, onEvent: h.onEvent('timeless') });
  assert.equal(await fooled.start(), false, 'a receipt without server_time/expires_at grants no local TTL');
  assert.equal(fooled.snapshot().last_reason, 'bad_receipt');
  assert.equal(h.events.some((e) => e.who === 'timeless' && e.event === 'scheduler_active'), false);
  const zero = { ...h.store, acquire: async () => ({ active: true, holder_id: 'core-standby', term: 1, server_time: '2026-11-23T07:00:00Z', expires_at: '2026-11-23T07:00:00Z' }) };
  const fooledZero = new SchedulerElection({ ...h.base, holderId: 'core-standby', role: 'standby', store: zero });
  assert.equal(await fooledZero.start(), false, 'a non-positive server duration grants nothing');
  await fooled.stop(); await fooledZero.stop();
});

test('handover yields at once: holder and successor are never active together, whichever ticks first; a lapsed handover resumes the holder', async () => {
  const h = harness();
  const primary = new SchedulerElection({ ...h.base, holderId: 'core-primary', role: 'primary', store: h.store, onEvent: h.onEvent('primary') });
  const standby = new SchedulerElection({ ...h.base, holderId: 'core-standby', role: 'standby', store: h.store, onEvent: h.onEvent('standby') });
  await primary.start(); await standby.start();
  const active = () => [primary, standby].filter((e) => e.isActive()).length;
  const granted = await primary.requestHandover('core-standby', 120);
  assert.equal(granted.ok, true);
  assert.equal(primary.isActive(), false, 'the requester yields the moment its handover is accepted');
  assert.equal(primary.yielding, true);
  assert.equal(primary.snapshot().active, false);
  assert.equal(primary.snapshot().yielding, true);
  assert.throws(() => assertActiveScheduler(primary), (error) => error.code === 'SCHEDULER_STANDBY' && error.active_holder === 'core-standby');
  assert.equal(active(), 0);
  h.advance(10_000);
  await primary.tick(); // the yielding holder renews FIRST (keeps the row alive for the successor)
  assert.equal(active(), 0);
  assert.equal(primary.yielding, true);
  assert.equal((await h.store.status({ orgId: ORG })).live, true);
  await standby.tick(); // then the successor takes over
  assert.equal(standby.isActive(), true);
  assert.equal(standby.term, 2);
  assert.equal(active(), 1);
  h.advance(10_000); await h.fire();
  assert.equal(active(), 1);
  assert.equal(primary.snapshot().last_reason, 'fenced');
  assert.equal(primary.yielding, false);
  // A yielding holder may re-request (new target or grace); after the lapse it resumes.
  await standby.requestHandover('core-primary', 10);
  assert.equal(standby.isActive(), false);
  const again = await standby.requestHandover('core-primary', 10);
  assert.equal(again.ok, true, 'a second request while yielding is allowed');
  h.advance(10_001);
  await standby.tick(); // grace lapsed with no successor: the renew shows no pending handover
  assert.equal(standby.isActive(), true);
  assert.equal(standby.yielding, false);
  assert.equal(standby.term, 2);
  assert.deepEqual(h.events.filter((e) => e.who === 'standby' && e.event === 'scheduler_handover_lapsed').map((e) => e.detail.handover_to), ['core-primary']);
  await primary.tick();
  assert.equal(primary.isActive(), false);
  assert.equal(active(), 1);
  await primary.stop(); await standby.stop();
});

test('one holder id, two roles: the second process is refused with role_conflict and a config fault; the default holder id is per role', async () => {
  const h = harness();
  const a = new SchedulerElection({ ...h.base, holderId: 'core-shared', role: 'primary', store: h.store, onEvent: h.onEvent('a') });
  const b = new SchedulerElection({ ...h.base, holderId: 'core-shared', role: 'standby', store: h.store, onEvent: h.onEvent('b') });
  assert.equal(await a.start(), true);
  assert.equal(await b.start(), false, 'a second process sharing the holder id never becomes active');
  assert.equal(b.snapshot().last_reason, 'role_conflict');
  for (let i = 0; i < 3; i++) { h.advance(10_000); await h.fire(); assert.equal(a.isActive(), true); assert.equal(b.isActive(), false); }
  const status = await h.store.status({ orgId: ORG });
  assert.equal(status.holder_role, 'primary', 'the row keeps the role it was acquired with');
  assert.equal(status.term, 1);
  assert.deepEqual(status.history.map((e) => e.event), ['fresh']);
  const faults = h.events.filter((e) => e.who === 'b' && e.event === 'scheduler_error');
  assert.equal(faults.length, 1, 'the configuration fault is reported once per episode, not on every tick');
  assert.equal(faults[0].detail.code, 'SCHEDULER_CONFIG');
  assert.equal(faults[0].detail.variable, 'MCCLUSTER_SCHEDULER_HOLDER_ID');
  await a.stop(); await b.stop();
  assert.equal(electionConfigFromEnv({ MCCLUSTER_SCHEDULER_ROLE: 'standby', MCCLUSTER_ORG_ID: ORG }).holderId, 'core-standby');
  assert.equal(electionConfigFromEnv({ MCCLUSTER_SCHEDULER_ROLE: 'primary', MCCLUSTER_ORG_ID: ORG }).holderId, 'core-primary');
});

test('a store call that never settles is abandoned: later ticks still renew, and stop() does not wedge', async () => {
  const h = harness();
  let hang = 0; let renews = 0;
  const hanging = { ...h.store, renew: async (args) => { renews += 1; if (hang > 0) { hang -= 1; return new Promise(() => {}); } return h.store.renew(args); } };
  const primary = new SchedulerElection({ ...h.base, holderId: 'core-primary', role: 'primary', store: hanging, callTimeoutMs: 5_000, onEvent: h.onEvent('primary') });
  await primary.start();
  hang = 1;
  h.advance(10_000); await h.fire(); // this renew never settles
  assert.equal(renews, 1);
  h.advance(4_000); await h.fire(); // younger than callTimeoutMs: still waiting on it
  assert.equal(renews, 1);
  h.advance(6_000); await h.fire(); // 10 s old: abandoned, a fresh renew goes out and confirms
  assert.equal(renews, 2);
  assert.deepEqual(h.events.filter((e) => e.event === 'scheduler_call_abandoned').length, 1);
  assert.equal(primary.isActive(), true);
  h.advance(15_000); // mono 35 s: past the deadline the first renew would have left (29 s), inside the new one
  assert.equal(primary.isActive(), true, 'the loop recovered without waiting for the hung call');
  await primary.stop();
  assert.equal(h.timers.size, 0);

  const wedge = new SchedulerElection({ ...h.base, holderId: 'core-standby', role: 'standby', store: { ...h.store, renew: async () => new Promise(() => {}) }, callTimeoutMs: 100, onEvent: h.onEvent('wedge') });
  await wedge.start();
  h.advance(10_000); await h.fire(); // renew hangs
  const started = Date.now();
  await wedge.stop();
  assert.ok(Date.now() - started < 2_000, 'stop() waits at most callTimeoutMs for a hung call');
  assert.equal(h.events.some((e) => e.who === 'wedge' && e.event === 'scheduler_released'), true, 'the lease is still released on stop');
  assert.equal((await h.store.status({ orgId: ORG })).live, false);
});

test('an unknown org is a configuration fault: the loop halts with SCHEDULER_CONFIG instead of retrying forever', async () => {
  const h = harness();
  const store = createMemorySchedulerStore(() => h.now(), { orgs: [ORG] });
  const events = [];
  const lost = new SchedulerElection({ ...h.base, orgId: '00000000-0000-0000-0000-0000000000ff', holderId: 'core-primary', role: 'primary', store, onEvent: (e, d) => events.push({ e, d }) });
  assert.equal(await lost.start(), false);
  assert.equal(lost.snapshot().halted, true);
  assert.equal(lost.snapshot().config_error?.variable, 'MCCLUSTER_ORG_ID');
  assert.equal(lost.snapshot().config_error?.code, 'SCHEDULER_CONFIG');
  assert.equal(h.timers.size, 0, 'no retry timer is installed');
  assert.deepEqual(events.map((x) => [x.e, x.d.code]), [['scheduler_error', 'SCHEDULER_CONFIG']]);
  h.advance(10_000); await h.fire(); await lost.tick();
  assert.equal(events.length, 1, 'no further attempts');
  await lost.stop();
  // The shape PostgREST relays for the SQL's raise (core/src/supabase.mjs puts the body on detail).
  assert.equal(isUnknownOrgError(Object.assign(new Error('unknown org'), { status: 404, detail: { code: 'P0002', message: 'unknown org', hint: 'MCCLUSTER_ORG_ID must name a row of public.orgs' } })), true);
  assert.equal(isUnknownOrgError(new Error('insert or update on table "ops_compute_scheduler_leases" violates foreign key constraint')), false);
  const fine = new SchedulerElection({ ...h.base, holderId: 'core-primary', role: 'primary', store });
  assert.equal(await fine.start(), true, 'a known org is unaffected');
  await fine.stop();
});

test('memory store parity with the SQL: null grace is 120 s, null identity is rejected, a dead row has no pending handover, role conflicts write nothing', async () => {
  let wall = baseTime;
  const store = createMemorySchedulerStore(() => wall);
  const p = { orgId: ORG, holderId: 'core-primary', role: 'primary', ttlSeconds: 30 };
  await store.acquire(p);
  const nullGrace = await store.handover({ orgId: ORG, holderId: 'core-primary', term: 1, toHolderId: 'core-standby', graceSeconds: null });
  assert.equal(Date.parse(nullGrace.handover_expires_at) - wall, 120_000, 'coalesce(p_grace_seconds, 120)');
  assert.equal(Date.parse((await store.handover({ orgId: ORG, holderId: 'core-primary', term: 1, toHolderId: 'core-standby', graceSeconds: 0 })).handover_expires_at) - wall, 10_000, 'zero clamps to the floor');
  await assert.rejects(store.release({ orgId: ORG, holderId: null, term: 1 }), /invalid holder id/);
  await assert.rejects(store.release({ orgId: ORG, holderId: 'core-primary', term: null }), /p_term is required/);
  await assert.rejects(store.handover({ orgId: ORG, holderId: undefined, term: 1, toHolderId: 'core-standby', graceSeconds: 60 }), /invalid holder id/);
  await assert.rejects(store.renew({ orgId: ORG, holderId: null, term: 1, ttlSeconds: 30 }), /invalid holder id/);
  assert.equal((await store.status({ orgId: ORG })).live, true, 'rejected inputs wrote nothing');
  const before = await store.status({ orgId: ORG });
  const conflict = await store.acquire({ ...p, role: 'standby' });
  assert.equal(conflict.active, false); assert.equal(conflict.reason, 'role_conflict'); assert.equal(conflict.holder_role, 'primary');
  const after = await store.status({ orgId: ORG });
  assert.equal(after.holder_role, 'primary');
  assert.equal(after.history.length, before.history.length, 'a role conflict writes no history');
  assert.equal(after.expires_at, before.expires_at, 'a role conflict renews nothing');
  // Lease lapses while a handover is pending: not pending any more, open to anyone.
  await store.handover({ orgId: ORG, holderId: 'core-primary', term: 1, toHolderId: 'core-standby', graceSeconds: 900 });
  wall += 31_000;
  const dead = await store.status({ orgId: ORG });
  assert.equal(dead.live, false); assert.equal(dead.handover_pending, false); assert.equal(dead.handover_to, 'core-standby');
  assert.equal((await store.acquire({ ...p, holderId: 'core-third', role: 'standby' })).reason, 'expired_takeover');
  assert.equal((await store.acquire({ ...p, holderId: 'core-standby', role: 'standby' })).reason, 'held');
});
