import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SchedulerElection, assertActiveScheduler, createMemorySchedulerStore, createRpcStore, electionConfigFromEnv,
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
