// E=UP event timeline slice S2 (2026-11-19): the owner controls, proven on the in-process environment OWNER plane, the REAL
// Worker router (/v1/eup/environment, workers/mccluster/src/eup/environment/owner.js) over the REAL SQL in PGlite: the applied
// module policy and the five PENDING store parts (supabase/pending/20261119100000_eup_environment_events_v1_01.sql to _05.sql),
// with PostgREST bound by argument name and declared type (scripts/test/support/eup-environment-owner-plane.mjs says exactly
// what is emulated). It is the local stand-in for "staging" (decision D1, default adopted pending Matthew's confirmation).
//   before the store is applied   every read answers 200 and says store not_applied; a command is 503 store_not_applied and
//                                 records nothing; the module and the providers are still reported, off to the public
//   owner only                    signed out 401, a plain member 403, an account outside the house 403, before any store call;
//                                 the store itself refuses a non-owner actor (42501)
//   commands                      idempotent by key (the stored receipt, one decision row), 409 on a moved revision, 409 on a
//                                 key reused for another command; hold, release, withdraw (retract) and restore logged
//   rollback                      restoring revision N makes its content a NEW revision (cause owner_rollback), linked to its
//                                 decision, with the change old -> new; the history keeps every revision
//   provider switches             the rule (D7 default), pause and resume the ingest, hide and show on the timeline
//   preview (D11)                 readable while the module is off; equal, field for field, to the public read once the module
//                                 is on, and still answering when the module is disabled again
//   source health                 off (module not installed, disabled; FIRMS without its key), outage (provider down, policy
//                                 unreadable) and no data (provider answered with nothing) per source; the store's last run
//   PGLITE_MODULE=<PGlite 0.3.x dist/index.js> node scripts/test/eup-environment-owner.integration.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEnvironmentOwnerPlane, usgsEvent, DEFAULT_USGS_RULE, OWNER, PEER } from './support/eup-environment-owner-plane.mjs';

const P = '/v1/eup/environment';
const key = (label) => `owner-plane-${label}-${randomUUID().slice(0, 8)}`;
const REASON = 'Integration fixture: an owner decision.';
const cmd = (plane, body, as = 'owner') => plane.call(as, 'POST', `${P}/commands`, { reason: REASON, idempotency_key: key(body.command), ...body });
const decisions = async (plane) => (await plane.db.query('select count(*)::int as n from public.eup_environment_decisions')).rows[0].n;
const event = async (plane, id) => (await plane.call('owner', 'GET', `${P}/events/${encodeURIComponent(id)}`)).body.event;
const noStore = (r, label) => assert.equal(r.headers.get('cache-control'), 'private, no-store', label);

test('before the store is applied: reads say not_applied, a command records nothing, and the owner still sees the module and the providers', async () => {
  const plane = await createEnvironmentOwnerPlane({ apply: false });
  try {
    const h = await plane.call('owner', 'GET', `${P}/health`);
    assert.equal(h.status, 200); noStore(h, 'health');
    assert.equal(h.body.store.status, 'not_applied');
    assert.equal(h.body.store.parts.length, 5);
    assert.equal(h.body.module.installed, false); assert.equal(h.body.module.gate, 'off');
    for (const s of h.body.sources) assert.deepEqual(s.public, { state: 'off', reason: 'module_not_installed' }, s.provider);
    const now = Object.fromEntries(h.body.sources.map((s) => [s.provider, s.provider_now.state]));
    assert.equal(now.usgs, 'reporting'); assert.equal(now.eonet, 'reporting'); assert.equal(now.nws, 'no_data'); assert.equal(now.nhc, 'no_data');
    assert.equal(now.wfigs, 'no_data'); assert.equal(now.firms, 'off', 'FIRMS without its key is off, never asked'); assert.equal(now.coops, 'reporting');
    assert.ok(!plane.providerCalls.includes('firms.modaps.eosdis.nasa.gov'));
    for (const path of ['/review', '/preview', `/events/${encodeURIComponent('usgs:us7000none')}`]) {
      const r = await plane.call('owner', 'GET', P + path);
      assert.equal(r.status, 200, path); assert.equal(r.body.store.status, 'not_applied', path); noStore(r, path);
    }
    const c = await cmd(plane, { command: 'set_rule', target: 'usgs', expected_revision: 0 });
    assert.equal(c.status, 503); assert.equal(c.body.reason, 'store_not_applied'); noStore(c, 'command');
    assert.equal((await plane.db.query("select to_regclass('public.eup_environment_decisions') as t")).rows[0].t, null, 'nothing exists to record into');
    /* the owner applies the parts (Matthew's go, emulated here) and PostgREST reloads its schema cache: the same routes answer */
    await plane.store.apply();
    plane.reloadSchema();
    const after = await plane.call('owner', 'GET', `${P}/review`);
    assert.equal(after.status, 200); assert.deepEqual(after.body.store, { status: 'applied' });
  } finally { await plane.close(); }
});

const plane = await createEnvironmentOwnerPlane();
test.after(() => plane.close());

test('owner only: signed out 401, a plain member and an outsider 403, private and no-store, before any store call; the store refuses a non-owner actor too', async () => {
  const before = plane.rpcLog.length;
  const routes = [['GET', '/health'], ['GET', '/review'], ['GET', '/preview'], ['GET', `/events/${encodeURIComponent('usgs:us7000none')}`], ['POST', '/commands']];
  for (const [method, path] of routes) {
    const body = method === 'POST' ? { command: 'set_rule', target: 'usgs', expected_revision: 0, idempotency_key: key('denied'), reason: REASON } : undefined;
    const a = await plane.call(null, method, P + path, body);
    assert.equal(a.status, 401, path); noStore(a, path);
    for (const who of ['peer', 'tester']) {
      const d = await plane.call(who, method, P + path, body);
      assert.equal(d.status, 403, `${who} ${path}`); assert.equal(d.body.reason, 'owner_required'); noStore(d, path);
    }
  }
  assert.equal(plane.rpcLog.length, before, 'no store call for a refused caller');
  assert.equal(await decisions(plane), 0);
  await assert.rejects(plane.store.preview({}, PEER), (e) => e.code === '42501', 'the SQL refuses a plain member as actor');
  await assert.rejects(plane.store.ownerRead(null, PEER), (e) => e.code === '42501');
});

test('the rule: the D7 default by the owner, idempotent by key, 409 on a moved revision, 409 on a key reused for another command', async () => {
  const k = key('rule');
  const first = await plane.call('owner', 'POST', `${P}/commands`, { command: 'set_rule', target: 'usgs', expected_revision: 0, idempotency_key: k, reason: REASON });
  assert.equal(first.status, 200); assert.equal(first.body.receipt.changed, true);
  assert.deepEqual(first.body.receipt.result.rule, DEFAULT_USGS_RULE); assert.equal(first.body.receipt.result.revision, 1);
  const again = await plane.call('owner', 'POST', `${P}/commands`, { command: 'set_rule', target: 'usgs', expected_revision: 0, idempotency_key: k, reason: REASON });
  assert.equal(again.status, 200); assert.deepEqual(again.body.receipt, first.body.receipt, 'the same key answers the stored receipt');
  assert.equal(await decisions(plane), 1, 'recorded once');
  const stale = await cmd(plane, { command: 'set_rule', target: 'usgs', expected_revision: 0 });
  assert.equal(stale.status, 409); assert.equal(stale.body.reason, 'revision_conflict');
  const reused = await plane.call('owner', 'POST', `${P}/commands`, { command: 'pause_provider', target: 'usgs', expected_revision: 1, idempotency_key: k, reason: REASON });
  assert.equal(reused.status, 409); assert.equal(reused.body.reason, 'idempotency_conflict');
  const gdelt = await cmd(plane, { command: 'set_rule', target: 'gdelt', expected_revision: 0 });
  assert.equal(gdelt.status, 422); assert.equal(gdelt.body.reason, 'provider_refused');
  const nws = await cmd(plane, { command: 'set_rule', target: 'nws', expected_revision: 0 });
  assert.equal(nws.status, 422); assert.equal(nws.body.reason, 'provider_not_supported', 'only USGS has an ingest so far');
  const log = (await plane.call('owner', 'GET', `${P}/review`)).body.decisions;
  assert.equal(log.length, 1); assert.equal(log[0].actor, OWNER); assert.equal(log[0].idempotency_key, k); assert.equal(log[0].reason, REASON);
});

const QUAKE = 'usgs:us7000own1', SMALL = 'usgs:us7000own2';
test('hold, release, withdraw and restore, each logged with its reason, none moving the content revision', async () => {
  await plane.store.ingest([usgsEvent({ provider_id: 'us7000own1', magnitude: 5.2 }), usgsEvent({ provider_id: 'us7000own2', magnitude: 3.1, significance: 150, observed_at: '2026-11-18T09:00:00.000Z' })]);
  const q = (await plane.call('owner', 'GET', `${P}/review`)).body.review;
  assert.deepEqual(q.candidates.map((e) => [e.id, e.qualifies]), [[SMALL, false]], 'the small quake waits as a candidate');
  let e = await event(plane, QUAKE);
  assert.deepEqual([e.summary.state, e.summary.revision], ['published', 1]);
  const steps = [['hold', 'held'], ['release', 'published'], ['retract', 'retracted'], ['restore', 'published']];
  for (const [command, state] of steps) {
    const r = await cmd(plane, { command, target: QUAKE, expected_revision: 1 });
    assert.equal(r.status, 200, command); assert.equal(r.body.receipt.result.state, state, command); assert.equal(r.body.receipt.result.revision, 1, command);
    e = await event(plane, QUAKE);
    assert.equal(e.summary.state, state, command);
    if (command === 'hold') {
      const preview = (await plane.call('owner', 'GET', `${P}/preview`)).body;
      assert.ok(!preview.events.some((x) => x.id === QUAKE), 'a held event is not in the public page');
    }
    if (command === 'retract') {
      const preview = (await plane.call('owner', 'GET', `${P}/preview`)).body;
      const tomb = preview.events.find((x) => x.id === QUAKE);
      assert.equal(tomb.state, 'retracted'); assert.equal(tomb.lon, undefined, 'a tombstone carries no coordinates, so no globe object');
    }
  }
  const mine = e.decisions.map((d) => d.command);
  assert.deepEqual(mine, ['restore', 'retract', 'release', 'hold']);
  assert.ok(e.decisions.every((d) => d.reason === REASON && d.actor === OWNER));
  const busy = await cmd(plane, { command: 'release', target: QUAKE, expected_revision: 1 });
  assert.equal(busy.status, 200); assert.equal(busy.body.receipt.changed, false, 'releasing what is not held changes nothing and is still logged');
  const missing = await cmd(plane, { command: 'hold', target: 'usgs:us7000nothere', expected_revision: 1 });
  assert.equal(missing.status, 404); assert.equal(missing.body.reason, 'not_found');
});

test('rollback: restoring revision 1 makes its content revision 3, logged and linked to its decision; the history keeps every revision', async () => {
  await plane.store.ingest([usgsEvent({ provider_id: 'us7000own1', magnitude: 5.6, source_updated_at: '2026-11-18T11:00:00.000Z' })]);
  let e = await event(plane, QUAKE);
  assert.equal(e.summary.revision, 2); assert.equal(e.revisions[0].cause, 'source_revised');
  assert.deepEqual(e.revisions[0].changes.magnitude, { from: 5.2, to: 5.6 });
  const stale = await cmd(plane, { command: 'rollback', target: QUAKE, expected_revision: 1, payload: { to_revision: 1 } });
  assert.equal(stale.status, 409); assert.equal(stale.body.reason, 'revision_conflict', 'a rollback against an old revision is refused');
  const forward = await cmd(plane, { command: 'rollback', target: QUAKE, expected_revision: 2, payload: { to_revision: 2 } });
  assert.equal(forward.status, 422, 'only an older revision can be restored');
  const k = key('rollback');
  const r = await plane.call('owner', 'POST', `${P}/commands`, { command: 'rollback', target: QUAKE, expected_revision: 2, payload: { to_revision: 1 }, idempotency_key: k, reason: REASON });
  assert.equal(r.status, 200); assert.equal(r.body.receipt.changed, true); assert.equal(r.body.receipt.result.revision, 3);
  e = await event(plane, QUAKE);
  assert.equal(e.summary.revision, 3); assert.equal(e.summary.magnitude, 5.2);
  assert.deepEqual(e.revisions.map((x) => [x.revision, x.cause]), [[3, 'owner_rollback'], [2, 'source_revised'], [1, 'source_first_seen']]);
  assert.deepEqual(e.revisions[0].snapshot, e.revisions[2].snapshot, 'revision 3 carries revision 1\'s content');
  assert.deepEqual(e.revisions[0].changes.magnitude, { from: 5.6, to: 5.2 });
  const decision = e.decisions.find((d) => d.command === 'rollback');
  assert.ok(decision, 'the rollback is in the decision log'); assert.equal(e.revisions[0].decision_seq, decision.seq, 'the revision names its decision');
  assert.equal(decision.expected_revision, 2);
  const replay = await plane.call('owner', 'POST', `${P}/commands`, { command: 'rollback', target: QUAKE, expected_revision: 2, payload: { to_revision: 1 }, idempotency_key: k, reason: REASON });
  assert.deepEqual(replay.body.receipt, r.body.receipt, 'a replay of the same key changes nothing');
  assert.equal((await event(plane, QUAKE)).summary.revision, 3);
  const corrected = (await plane.call('owner', 'GET', `${P}/review`)).body.review.corrected;
  assert.ok(corrected.some((x) => x.id === QUAKE && x.revision === 3));
});

test('provider switches: pause and resume the ingest, hide and show on the timeline, each a new provider revision', async () => {
  let rev = (await plane.call('owner', 'GET', `${P}/review`)).body.providers.find((p) => p.provider === 'usgs').revision;
  for (const [command, field, value] of [['pause_provider', 'ingest', 'paused'], ['resume_provider', 'ingest', 'active'], ['hide_provider', 'publication', 'hidden']]) {
    const r = await cmd(plane, { command, target: 'usgs', expected_revision: rev });
    assert.equal(r.status, 200, command); assert.equal(r.body.receipt.result[field], value, command); assert.equal(r.body.receipt.result.revision, rev + 1);
    rev += 1;
    if (command === 'pause_provider') {
      const h = (await plane.call('owner', 'GET', `${P}/health`)).body;
      assert.equal(h.sources.find((s) => s.provider === 'usgs').store.state, 'paused');
    }
  }
  const hidden = (await plane.call('owner', 'GET', `${P}/preview`)).body;
  assert.equal(hidden.events.length, 0, 'a hidden provider is out of the public page');
  const shown = await cmd(plane, { command: 'show_provider', target: 'usgs', expected_revision: rev });
  assert.equal(shown.body.receipt.result.publication, 'shown');
  assert.ok((await plane.call('owner', 'GET', `${P}/preview`)).body.events.some((x) => x.id === QUAKE));
});

test('the preview equals the public read field for field once the module is on, and answers while the module is off', async () => {
  const off = await plane.call('owner', 'GET', `${P}/preview?limit=50`);
  assert.equal(off.status, 200); assert.equal(off.body.module.gate, 'off', 'the module was never installed');
  await assert.rejects(plane.store.publicEvents({ limit: 50 }), (e) => e.code === 'EUM01', 'the public read refuses while the module is not installed');
  await plane.install(); await plane.enable();
  const pub = await plane.store.publicEvents({ limit: 50 });
  const on = (await plane.call('owner', 'GET', `${P}/preview?limit=50`)).body;
  assert.equal(on.module.gate, 'on');
  assert.deepEqual(on.events, pub.events); assert.deepEqual(on.sources, pub.sources); assert.equal(on.next_cursor, pub.next_cursor);
  assert.deepEqual(off.body.events, on.events, 'the owner saw before enabling exactly what the public now sees');
  const correction = on.events.find((x) => x.id === QUAKE).correction;
  assert.equal(correction.cause, 'owner_rollback'); assert.equal(correction.revision, 3);
  /* paging: one at a time, the cursor the route gave walks the page (a second published quake, older) */
  await plane.store.ingest([usgsEvent({ provider_id: 'us7000own3', magnitude: 4.8, observed_at: '2026-11-17T08:00:00.000Z' })]);
  const one = (await plane.call('owner', 'GET', `${P}/preview?limit=1`)).body;
  assert.equal(one.events.length, 1); assert.ok(one.next_cursor);
  const two = (await plane.call('owner', 'GET', `${P}/preview?limit=1&cursor=${encodeURIComponent(one.next_cursor)}`)).body;
  assert.deepEqual([one.events[0].id, two.events[0].id], [QUAKE, 'usgs:us7000own3']);
  assert.deepEqual(two.events, (await plane.store.publicEvents({ limit: 1, cursor: one.next_cursor })).events, 'page two equals the public page two');
  const all = (await plane.call('owner', 'GET', `${P}/preview?limit=50`)).body;
  await plane.drain(); await plane.disable();
  await assert.rejects(plane.store.publicEvents({}), (e) => e.code === 'EUM03', 'disabled: the public read refuses');
  const disabled = (await plane.call('owner', 'GET', `${P}/preview?limit=50`)).body;
  assert.equal(disabled.module.gate, 'off'); assert.deepEqual(disabled.events, all.events, 'the owner still reads it');
});

test('source health per source: off while disabled, the provider states when enabled, outage when a provider is down, no data when it is empty', async () => {
  let h = (await plane.call('owner', 'GET', `${P}/health`)).body;
  assert.equal(h.module.gate, 'off'); assert.equal(h.module.state, 'disabled');
  assert.ok(h.sources.every((s) => s.public.state === 'off' && s.public.reason === 'module_disabled'));
  const usgsStore = h.sources.find((s) => s.provider === 'usgs').store;
  assert.equal(usgsStore.state, 'ok', 'the last ingest run read events'); assert.equal(usgsStore.configured, true); assert.ok(usgsStore.last_success_at);
  assert.ok(h.log.length >= 2 && h.log.every((row) => row.provider === 'usgs'));
  await plane.enable();
  h = (await plane.call('owner', 'GET', `${P}/health`)).body;
  const pub = Object.fromEntries(h.sources.map((s) => [s.provider, s.public.state]));
  assert.deepEqual(pub, { usgs: 'reporting', nws: 'no_data', nhc: 'no_data', eonet: 'reporting', firms: 'off', wfigs: 'no_data', coops: 'reporting' });
  plane.down.add('eonet.gsfc.nasa.gov');
  h = (await plane.call('owner', 'GET', `${P}/health`)).body;
  const eonet = h.sources.find((s) => s.provider === 'eonet');
  assert.deepEqual(eonet.public, { state: 'outage', reason: 'upstream_error' });
  assert.ok(eonet.provider_now.surfaces.every((x) => x.state === 'outage'));
  plane.down.clear();
  plane.providers = 'empty';
  h = (await plane.call('owner', 'GET', `${P}/health`)).body;
  assert.deepEqual(h.sources.find((s) => s.provider === 'usgs').public, { state: 'no_data', reason: null }, 'no data is not an outage');
  plane.providers = 'rows';
  /* the store's own run log tells no data and an outage apart too (a successful read of nothing is recorded as empty) */
  await plane.store.ingest([], { health: { status: 'ok' } });
  h = (await plane.call('owner', 'GET', `${P}/health`)).body;
  assert.equal(h.sources.find((s) => s.provider === 'usgs').store.state, 'no_data');
  await plane.store.ingest([], { health: { status: 'unavailable', reason: 'timeout' } });
  h = (await plane.call('owner', 'GET', `${P}/health`)).body;
  assert.equal(h.sources.find((s) => s.provider === 'usgs').store.state, 'outage');
});
