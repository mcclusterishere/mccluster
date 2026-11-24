/* GET /v1/eup/halo (src/eup/halo.js): the owner's read of Hitman's Halo as a MODULE. Synthetic fixtures only: no
   provider, no database and no production data is read. What is held:
     - guests (401) and members (403) get nothing and nothing is asked of the store;
     - the answer names the stable module id, the one route and its four deep links;
     - policy says exactly what the store said: available, unregistered (staged SQL unapplied), schema_not_applied,
       unavailable. A failed read is never completed with a guess and never reads as installed or enabled;
     - enforcement.policy_enforced is false: installed or enabled is never presented as ready or open;
     - every feed the Halo view declares is listed, with a boolean (or null: not checked here) and never a value;
     - no credential, token or feed row is in the answer. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleEup, EUP_PREFIX, EUP_SECTIONS } from '../src/eup/router.js';
import { HALO_DECLARED_FEED_IDS, HALO_MODULE_ID, HALO_ROUTE, HALO_VIEWS } from '../src/eup/halo.js';
import { MODULE_IDS } from '../src/eup/modules.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const BASE = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only' };
const owner = async () => ({ id: OWNER });
const guest = async () => { throw Object.assign(new Error('Authentication required'), { status: 401 }); };
const member = async () => { throw Object.assign(new Error('House owner required'), { status: 403 }); };
const unit = (rows) => ({ installationId: 'mccluster', commands: [], modules: rows });
const blank = (moduleId) => ({ moduleId, installed: false, state: null, revision: null, updated_at: null, updated_by: null, last_command: null });
const APPLIED = ['environment', 'league', 'intake'].map(blank);
function fake(reply) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), name: String(url).split('/rpc/')[1] || null, body: options.body ? JSON.parse(options.body) : null });
    const out = typeof reply === 'function' ? await reply() : reply;
    return out instanceof Response ? out : Response.json(out);
  };
  return { calls, fetchImpl };
}
const get = (f, { env = BASE, requireHouseOwner = owner, path = '/halo', method = 'GET' } = {}) =>
  handleEup(new Request(`https://fixture.invalid${EUP_PREFIX}${path}`, { method }), env, { requireHouseOwner, fetchImpl: f.fetchImpl, now: () => Date.parse('2026-11-23T12:00:00Z') });

test('halo is a registered module id and a registered owner section', () => {
  assert.equal(HALO_MODULE_ID, 'halo');
  assert.ok(MODULE_IDS.includes(HALO_MODULE_ID));
  assert.ok(EUP_SECTIONS.includes('halo'));
  assert.equal(HALO_ROUTE, 'action-globe.html?explore=1&halo=1', 'the existing full-screen route, not a second globe');
  assert.deepEqual(HALO_VIEWS.map((v) => [v.id, v.route]), [['world', 'action-globe.html?explore=1&halo=1'], ['missions', 'action-globe.html?explore=1&halo=missions'], ['people', 'action-globe.html?explore=1&halo=people'], ['intel', 'action-globe.html?explore=1&halo=intel']]);
});

test('a guest gets 401 and a member 403: no module state, no feed list, and the store is never asked', async () => {
  for (const [who, status, reason] of [[guest, 401, 'authentication_required'], [member, 403, 'owner_required']]) {
    const f = fake(unit(APPLIED));
    const r = await get(f, { requireHouseOwner: who });
    const b = await r.json();
    assert.equal(r.status, status); assert.equal(b.ok, false); assert.equal(b.reason, reason);
    assert.deepEqual(Object.keys(b).sort(), ['error', 'ok', 'reason'], 'nothing about the module leaks in a refusal');
    assert.equal(f.calls.length, 0);
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
  }
});

test('missing policy: a store without the staged halo SQL is said as unregistered, with the pending file, and nothing is enabled', async () => {
  const f = fake(unit(APPLIED));
  const r = await get(f); const b = await r.json();
  assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Object.keys(b), ['ok', 'scope', 'generated_at', 'module', 'access', 'policy', 'enforcement', 'feeds']);
  assert.equal(b.scope, 'house_owner'); assert.equal(b.generated_at, '2026-11-23T12:00:00.000Z');
  assert.deepEqual(b.module, { id: 'halo', label: 'Hitman’s Halo', route: HALO_ROUTE, views: HALO_VIEWS.map((v) => ({ ...v })) });
  assert.deepEqual(b.policy, { status: 'unregistered', reason: 'module_not_registered', registered: false, installed: false, state: null, revision: null, updated_at: null, last_command: null, pending_sql: 'supabase/pending/eup_module_policy_halo_v1.sql' });
  assert.equal(b.access.audience, 'house_owner'); assert.equal(b.access.decided_by, 'release_guard');
  assert.equal(b.enforcement.policy_enforced, false);
  assert.deepEqual(f.calls.map((c) => [c.name, c.body]), [['eup_module_control_read', { p_actor: OWNER, p_limit: 1 }]], 'one owner read with the verified user, nothing else');
});

test('installed is not ready: each persisted state is passed as read, and enforcement stays false', async () => {
  for (const [row, expect] of [
    [blank('halo'), { status: 'available', registered: true, installed: false, state: null, revision: null }],
    [{ ...blank('halo'), installed: true, state: 'disabled', revision: 0, updated_at: '2026-11-23T00:00:00Z' }, { status: 'available', registered: true, installed: true, state: 'disabled', revision: 0 }],
    [{ ...blank('halo'), installed: true, state: 'enabled', revision: 1, updated_at: '2026-11-23T00:00:00Z' }, { status: 'available', registered: true, installed: true, state: 'enabled', revision: 1 }],
    [{ ...blank('halo'), installed: true, state: 'draining', revision: 2, updated_at: '2026-11-23T00:00:00Z' }, { status: 'available', registered: true, installed: true, state: 'draining', revision: 2 }]
  ]) {
    const b = await (await get(fake(unit([...APPLIED, row])))).json();
    for (const [k, v] of Object.entries(expect)) assert.equal(b.policy[k], v, `${row.state} ${k}`);
    assert.equal(b.enforcement.policy_enforced, false, 'no state is presented as opening Halo');
    assert.doesNotMatch(JSON.stringify(b), /"ready"\s*:\s*true/);
  }
});

test('backend unavailable: every failed policy read is unknown, never installed or enabled, and the module and feeds are still described', async () => {
  const cases = [
    ['schema absent', () => Response.json({ code: 'PGRST202', message: 'x' }, { status: 404 }), 'schema_not_applied', 'schema_not_applied'],
    ['store error', () => Response.json({ code: 'XX000', message: 'database text' }, { status: 500 }), 'unavailable', 'storage_unavailable'],
    ['offline', () => { throw new Error('offline'); }, 'unavailable', 'storage_unavailable'],
    ['unreadable halo row', () => Response.json(unit([...APPLIED, { ...blank('halo'), installed: true, state: 'on', revision: 1 }])), 'unavailable', 'storage_unavailable'],
    ['not json', () => new Response('<html>', { status: 200 }), 'unavailable', 'storage_unavailable']
  ];
  for (const [label, reply, status, reason] of cases) {
    const r = await get(fake(reply)); const b = await r.json();
    assert.equal(r.status, 200, label);
    assert.deepEqual(b.policy, { status, reason, registered: null, installed: null, state: null, revision: null, updated_at: null, last_command: null, pending_sql: 'supabase/pending/eup_module_policy_halo_v1.sql' }, label);
    assert.equal(b.module.route, HALO_ROUTE, label); assert.equal(b.feeds.length, HALO_DECLARED_FEED_IDS.length, label);
    assert.doesNotMatch(JSON.stringify(b), /database text/, label);
  }
  /* no store configured at all */
  const none = await (await get(fake(unit(APPLIED)), { env: {} })).json();
  assert.equal(none.policy.status, 'unavailable'); assert.equal(none.policy.installed, null);
});

test('feeds: every declared feed is listed once; configuration is a boolean or null, and no value is ever returned', async () => {
  const secret = 'fixture-firms-value-never-returned', ais = 'fixture-ais-value-never-returned';
  const bare = await (await get(fake(unit(APPLIED)))).json();
  assert.deepEqual(bare.feeds.map((f) => f.id), [...HALO_DECLARED_FEED_IDS]);
  assert.equal(new Set(bare.feeds.map((f) => f.id)).size, bare.feeds.length);
  const by = (b) => Object.fromEntries(b.feeds.map((f) => [f.id, f]));
  assert.equal(by(bare).fires.configured, false); assert.deepEqual(by(bare).fires.requires, ['FIRMS_MAP_KEY']);
  assert.equal(by(bare).vessels.configured, false); assert.deepEqual(by(bare).vessels.requires, ['AISSTREAM_API_KEY', 'HereTenantAgent']);
  for (const id of ['weather', 'natural', 'quakes', 'perimeters', 'cyclones', 'tides']) { assert.equal(by(bare)[id].configured, true, id); assert.equal(by(bare)[id].needs_map, false, id); }
  for (const id of ['flights', 'satellites', 'launches', 'cctv', 'regions', 'intel', 'markets']) { assert.equal(by(bare)[id].configured, null, `${id} is not checked here, which is not "configured"`); assert.equal(by(bare)[id].needs_map, true, id); }
  assert.equal(by(bare).military.configured, true);
  for (const id of ['military', 'vessels']) assert.equal(by(bare)[id].needs_map, true, id);
  assert.equal(by(bare).missions.configured, null); assert.equal(by(bare).missions.needs_map, false);
  assert.equal(by(bare).quakes.route, '/v1/world/layers/quakes'); assert.equal(by(bare).tides.route, '/v1/world/layers/tides');
  const env = { ...BASE, FIRMS_MAP_KEY: secret, AISSTREAM_API_KEY: ais, HereTenantAgent: { idFromName() {}, get() {} } };
  const full = await (await get(fake(unit(APPLIED)), { env })).json();
  assert.equal(by(full).fires.configured, true); assert.equal(by(full).vessels.configured, true);
  const text = JSON.stringify(full);
  assert.ok(!text.includes(secret) && !text.includes(ais) && !text.includes('fixture-only'), 'no credential value is in the answer');
  for (const f of full.feeds) assert.deepEqual(Object.keys(f), ['id', 'label', 'group', 'route', 'credit', 'requires', 'configured', 'needs_map'], 'no rows and no counts: configuration only');
});

test('the declared feed list is the Halo view’s own list (js/halo/halo.js GROUPS), in its order', async () => {
  const source = await readFile(new URL('../../../js/halo/halo.js', import.meta.url), 'utf8');
  const start = source.indexOf('const GROUPS = ['), end = source.indexOf('const ALL_ITEMS', start);
  assert.ok(start > 0 && end > start);
  const ids = [...source.slice(start, end).matchAll(/\{ id: '([a-z]+)', label: '/g)].map((m) => m[1]);
  assert.deepEqual([...HALO_DECLARED_FEED_IDS], ids);
});

test('only GET /v1/eup/halo exists: other methods and sub-paths are refused before the store', async () => {
  const f = fake(unit(APPLIED));
  assert.equal((await get(f, { method: 'POST' })).status, 405);
  assert.equal((await get(f, { method: 'DELETE' })).status, 405);
  assert.equal((await get(f, { path: '/halo/feeds' })).status, 404);
  assert.equal((await get(f, { path: '/halo/install', method: 'POST' })).status, 404);
  assert.equal(f.calls.length, 0);
});
