// The house owner's mission sources route, proven on the in-process MISSION SOURCES plane: the REAL Worker route
// (/v1/mission-sources, workers/mccluster/src/mission-sources.js) over the REAL pending SQL in PGlite (the production-shaped
// stub, one Drawdown mission published, supabase/pending/20261119140000_mission_catalog_sources_v1.sql), with PostgREST
// bound by argument name and declared type (scripts/test/support/mission-sources-plane.mjs says exactly what is emulated).
//   before the SQL is applied   the read says store not_applied; a command is 503 store_not_applied and records nothing
//   owner only                  signed out 401, staff, a viewer and a member 403 before any store call; with the route's
//                               own check broken on purpose, the SQL still refuses them (42501 -> 403), writing nothing
//   commands                    Show refused without the dated confirmation, then Show, Hide, Edit; the same key replays
//                               the receipt; a moved revision 409 moved; a reused key 409 key_reused; an unknown catalog 404
//   words and facts             every deny-list entry and each bad fact through HTTP, each with its code, nothing recorded
//   the receipt                 its revision round-trips as an integer and matches the owner's read and the audit
//   PGLITE_MODULE=<PGlite 0.3.x dist/index.js> node scripts/test/mission-sources-owner.integration.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMissionSourcesPlane, OWNER, STAFF, VIEWER, MEMBER } from './support/mission-sources-plane.mjs';
import { WORDS, sentenceFor, FACTS, CONFIRM } from './support/mission-catalog-sources-database.mjs';

const P = '/v1/mission-sources';
const REASON = 'Integration fixture: an owner decision.';
const command = (plane, body, as = 'owner') => plane.call(as, 'POST', `${P}/commands`, { catalog: 'drawdown', key: randomUUID(), reason: REASON, ...body });
const noStore = (r, label) => assert.equal(r.headers.get('cache-control'), 'private, no-store', label);
/* what a signed-out visitor's PostgREST read of the table returns (the anon key, RLS deciding) */
const anonRows = async (plane) => (await plane.league.handle(new Request(`${plane.league.supabase}/rest/v1/mission_catalog_sources?select=catalog,state`, { headers: { apikey: plane.league.anonKey } }))).json();

test('before the SQL is applied: the read says not_applied and a command records nothing; once applied, the same routes answer', async () => {
  const plane = await createMissionSourcesPlane({ apply: false });
  try {
    const r = await plane.call('owner', 'GET', P);
    assert.equal(r.status, 200); noStore(r, 'read');
    assert.deepEqual(r.body, { ok: true, store: 'not_applied', sources: [], history: [] });
    const c = await command(plane, { command: 'hide', expected_revision: 1 });
    assert.equal(c.status, 503); noStore(c, 'command');
    assert.equal(c.body.code, 'store_not_applied');
    assert.equal((await plane.db.query("select to_regclass('public.mission_catalog_sources') as t")).rows[0].t, null, 'nothing exists to record into');
    await plane.applyForward();
    const after = await plane.call('owner', 'GET', P);
    assert.equal(after.body.store, 'applied');
    assert.equal(after.body.sources.length, 1);
    assert.equal(after.body.sources[0].state, 'draft');
  } finally { await plane.close(); }
});

const plane = await createMissionSourcesPlane();
test.after(() => plane.close());

test('owner only: signed out 401; staff, a viewer and a member 403; private and no-store; no store call for a refused caller', async () => {
  const before = plane.rpcLog.length;
  for (const [method, path, body] of [['GET', P], ['POST', `${P}/commands`, { command: 'hide', catalog: 'drawdown', expected_revision: 1, key: randomUUID(), reason: REASON }]]) {
    const a = await plane.call(null, method, path, body);
    assert.equal(a.status, 401, path); noStore(a, path);
    assert.equal(a.body.code, 'authentication_required');
    for (const who of ['staff', 'viewer', 'member']) {
      const d = await plane.call(who, method, path, body);
      assert.equal(d.status, 403, `${who} ${path}`); noStore(d, path);
      assert.equal(d.body.code, 'owner_required');
    }
  }
  assert.equal(plane.rpcLog.length, before, 'no store call');
  assert.equal(await plane.audits(), 0);
});

test('with the route\'s owner check broken on purpose, the SQL still refuses every non-owner (42501 -> 403) and writes nothing', async () => {
  for (const [who, id] of [['staff', STAFF], ['viewer', VIEWER], ['member', MEMBER]]) {
    plane.setOwnerCheck(async () => ({ id }));
    try {
      const read = await plane.call(who, 'GET', P);
      assert.equal(read.status, 403, `${who} read`); assert.equal(read.body.code, 'owner_required');
      const c = await command(plane, { command: 'hide', expected_revision: 1 }, who);
      assert.equal(c.status, 403, `${who} command`); assert.equal(c.body.code, 'owner_required');
    } finally { plane.setOwnerCheck(plane.league.requireHouseOwner); }
  }
  const codes = plane.rpcLog.slice(-6).map((e) => e.code);
  assert.deepEqual(codes, Array(6).fill('42501'), 'the function itself refused');
  assert.equal(await plane.audits(), 0);
  assert.equal((await plane.source()).state, 'draft');
});

test('Show needs the dated confirmation; then Show, the replay, a moved revision, a reused key, an unknown catalog', async () => {
  const draft = await plane.call('owner', 'GET', P);
  assert.equal(draft.body.store, 'applied');
  const [src] = draft.body.sources;
  assert.equal(src.state, 'draft'); assert.equal(src.revision, 1);
  assert.equal(src.organization.slug, 'project-drawdown'); assert.equal(src.organization.verification_state, 'unverified');
  assert.equal(src.open_missions, 1);
  assert.ok(!draft.text.includes('created_by'), 'never created_by');
  assert.deepEqual(await anonRows(plane), [], 'a draft is not readable by a visitor');
  const calls = plane.rpcLog.length;
  const unconfirmed = await command(plane, { command: 'show', expected_revision: 1 });
  assert.equal(unconfirmed.status, 422); assert.equal(unconfirmed.body.code, 'invalid', 'the route refuses a Show without the confirmation');
  assert.equal(plane.rpcLog.length, calls, 'and calls nothing');
  const future = await command(plane, { command: 'show', expected_revision: 1, payload: { permission_confirmed: true, permission_confirmed_on: '2099-01-01' } });
  assert.equal(future.status, 422); assert.equal(future.body.code, 'invalid', 'a future date: the SQL refuses (22023)');
  assert.equal(plane.rpcLog.at(-1).code, '22023');
  const key = randomUUID();
  const shown = await command(plane, { command: 'show', expected_revision: 1, key, payload: CONFIRM });
  assert.equal(shown.status, 200); noStore(shown, 'show');
  const { receipt } = shown.body;
  assert.equal(receipt.state, 'shown'); assert.equal(receipt.replayed, false); assert.equal(receipt.key, key);
  assert.equal(typeof receipt.revision, 'number'); assert.ok(Number.isInteger(receipt.revision)); assert.equal(receipt.revision, 2);
  assert.ok(Number.isInteger(receipt.audit_id));
  const again = await command(plane, { command: 'show', expected_revision: 1, key, payload: CONFIRM });
  assert.equal(again.status, 200);
  assert.equal(again.body.receipt.replayed, true); assert.equal(again.body.receipt.audit_id, receipt.audit_id); assert.equal(again.body.receipt.revision, 2);
  assert.equal(await plane.audits(), 1, 'recorded once');
  const reused = await command(plane, { command: 'hide', expected_revision: 2, key });
  assert.equal(reused.status, 409); assert.equal(reused.body.code, 'key_reused');
  const moved = await command(plane, { command: 'hide', expected_revision: 1 });
  assert.equal(moved.status, 409); assert.equal(moved.body.code, 'moved');
  const missing = await command(plane, { command: 'hide', catalog: 'nosuch', expected_revision: 1 });
  assert.equal(missing.status, 404); assert.equal(missing.body.code, 'not_found');
  const read = await plane.call('owner', 'GET', P);
  assert.equal(read.body.sources[0].revision, receipt.revision, 'the receipt\'s revision is the stored one');
  assert.equal(read.body.history[0].key, key); assert.equal(read.body.history[0].audit_id, receipt.audit_id);
  assert.equal(read.body.history[0].permission_confirmed_on, '2026-11-19');
  assert.equal(read.body.history[0].revision, 2);
  assert.deepEqual(await anonRows(plane), [{ catalog: 'drawdown', state: 'shown' }], 'a shown page is readable by a visitor');
});

test('every deny-list entry and each bad fact or role line is refused through HTTP with its code, recording nothing', async () => {
  const before = await plane.audits();
  const { revision } = await plane.source();
  for (const entry of WORDS.DENY) {
    const r = await command(plane, { command: 'edit', expected_revision: revision, payload: { role_line: sentenceFor(entry) } });
    assert.equal(r.status, 422, entry[0]); assert.equal(r.body.code, 'words_refused', entry[0]);
    assert.ok(!r.text.includes('violates') && !r.text.includes('mission_catalog_sources_'), 'no database text');
  }
  const fact = (o) => ({ facts: [{ ...FACTS[0], ...o }], facts_read_on: '2026-11-19' });
  for (const [label, payload, code] of [
    ['a deny word in a fact', fact({ value: 'Official partner' }), 'words_refused'],
    ['an http source', fact({ source: 'http://drawdown.org/about' }), 'facts_refused'],
    ['a tab in the source', fact({ source: 'https://drawdown.org/\tabout' }), 'facts_refused'],
    ['a newline in a value', fact({ value: 'two\nlines' }), 'facts_refused'],
    ['a 41-character label', fact({ label: 'x'.repeat(41) }), 'facts_refused'],
    ['an extra key', fact({ icon: 'x' }), 'facts_refused'],
    ['a number for a value', fact({ value: 5 }), 'facts_refused'],
    ['a role line on two lines', { role_line: 'one\ntwo' }, 'role_line_refused'],
    ['an empty role line', { role_line: '' }, 'role_line_refused']
  ]) {
    const r = await command(plane, { command: 'edit', expected_revision: revision, payload });
    assert.equal(r.status, 422, label); assert.equal(r.body.code, code, label);
  }
  const noDate = await command(plane, { command: 'edit', expected_revision: revision, payload: { facts: [FACTS[0]] } });
  assert.equal(noDate.status, 422); assert.equal(noDate.body.code, 'invalid', 'facts without their read date: refused by the route');
  assert.equal(await plane.audits(), before, 'no refusal recorded anything');
  assert.equal((await plane.source()).revision, revision);
});

test('Edit and Hide: stored, audited, the revision moving by one each time; anon reads only a shown page', async () => {
  const { revision } = await plane.source();
  const e = await command(plane, { command: 'edit', expected_revision: revision, payload: { role_line: 'Missions written by McCluster Corp from Project Drawdown’s climate solutions, by area.', facts: FACTS, facts_read_on: '2026-11-19' } });
  assert.equal(e.status, 200); assert.equal(e.body.receipt.revision, revision + 1); assert.equal(e.body.receipt.state, 'shown');
  const stored = await plane.source();
  assert.ok(stored.role_line.endsWith('by area.')); assert.equal(stored.facts.length, 3);
  assert.deepEqual(await anonRows(plane), [{ catalog: 'drawdown', state: 'shown' }]);
  const h = await command(plane, { command: 'hide', expected_revision: revision + 1 });
  assert.equal(h.status, 200); assert.equal(h.body.receipt.state, 'hidden'); assert.equal(h.body.receipt.revision, revision + 2);
  const read = await plane.call('owner', 'GET', P);
  assert.equal(read.body.sources[0].state, 'hidden');
  assert.deepEqual(await anonRows(plane), [], 'Hide: gone for every new visit');
  assert.deepEqual(read.body.history.slice(0, 2).map((x) => x.event), ['mission_source.hide', 'mission_source.edit']);
  assert.equal(await plane.audits(), 3);
});

test('a lost answer: the command committed once; the same body with the same key is recorded at most once', async () => {
  const { revision } = await plane.source();
  const key = randomUUID();
  const body = { command: 'show', expected_revision: revision, key, payload: CONFIRM };
  const fault = plane.faults.add({ method: 'POST', path: `${P}/commands`, mode: 'drop' });
  await assert.rejects(command(plane, body), (e) => e.planeFault === 'drop');
  assert.equal(fault.hits, 1);
  const history = (await plane.call('owner', 'GET', P)).body.history;
  assert.equal(history[0].key, key, 'the read-back finds the key: it was recorded');
  const resent = await command(plane, body);
  assert.equal(resent.status, 200); assert.equal(resent.body.receipt.replayed, true);
  assert.equal(await plane.audits(), 4, 'one row for the lost answer, none for the resend');
});
