// Mission sources: the house owner's route over a mission catalog's source page (workers/mccluster/src/mission-sources.js),
// with a fake service REST. What is proven here: owner-only before anything is read (401, 403, 503 when the check cannot
// answer), private/no-store on every answer, the acting owner is always the verified session user, every body rule before
// any store call, every row of the store error table, honest answers while the store is not applied or unreachable, and
// that no PostgREST message, details or hint ever reaches a body. The SQL itself is proven against the real pending file
// in scripts/test/mission-catalog-sources.integration.mjs, and this route over it in
// scripts/test/mission-sources-owner.integration.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
/* index.js imports an .html module and cloudflare:workers, as world-release.test.mjs loads it */
registerHooks({ resolve(s, c, n) { if (s === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true }; return n(s, c); },
  load(u, c, n) { if (/\.html$/.test(u)) return { format: 'module', source: 'export default ' + JSON.stringify(readFileSync(new URL(u), 'utf8')) + ';', shortCircuit: true }; return n(u, c); } });
import {
  handleMissionSources, commandArgs, storeCode, MISSION_SOURCES_PREFIX, MISSION_SOURCE_MESSAGES, MISSION_SOURCE_STORE_ERRORS,
  MISSION_SOURCE_COMMANDS, MISSION_SOURCES_PENDING_FILE
} from '../src/mission-sources.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const KEY = '0f6b3a52-6a51-4d8e-9a3e-2b8d6f1e4c11';
const env = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only', ALLOWED_ORIGINS: 'https://matthew.mccluster.org' };
const owner = async () => ({ id: OWNER, email: 'ignored' });
const denied = async () => { throw Object.assign(new Error('McCluster house owner access required'), { status: 403 }); };
const anon = async () => { throw Object.assign(new Error('Authentication required'), { status: 401 }); };
const broken = async () => { throw Object.assign(new Error('McCluster house organization is not configured'), { status: 503 }); };
const offline = async () => { throw new TypeError('network'); };
const SECRET = 'database text that must never reach the owner';
const storeError = (code, message = SECRET, status = 400) => Response.json({ code, message, details: SECRET, hint: SECRET }, { status });
const state = (extra = {}) => ({ sources: [{ catalog: 'drawdown', state: 'draft', revision: 1, role_line: 'x', facts: [], organization: { slug: 'project-drawdown', name: 'Project Drawdown' }, open_missions: 0 }], history: [], ...extra });
const receipt = (extra = {}) => ({ ok: true, catalog: 'drawdown', command: 'hide', state: 'hidden', revision: 2, key: KEY, audit_id: 7, replayed: false, ...extra });
const body = (extra = {}) => ({ command: 'hide', catalog: 'drawdown', expected_revision: 1, key: KEY, reason: 'Test fixture: owner decision.', ...extra });
const get = (path = '') => new Request(`https://api.mccluster.org${MISSION_SOURCES_PREFIX}${path}`, { headers: { origin: 'https://matthew.mccluster.org' } });
const post = (b, path = '/commands') => new Request(`https://api.mccluster.org${MISSION_SOURCES_PREFIX}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://matthew.mccluster.org' }, body: typeof b === 'string' ? b : JSON.stringify(b)
});
function fake(store = () => receipt()) {
  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const u = new URL(String(input));
    assert.equal(u.origin, 'https://fixture.invalid', 'the route calls nothing but the store');
    const call = { name: u.pathname.split('/rpc/')[1] || null, path: u.pathname, method: options.method, headers: options.headers, redirect: options.redirect, body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    const out = await store(call.name, call.body, calls.length);
    return out instanceof Response ? out : Response.json(out);
  };
  return { calls, fetchImpl };
}
const run = async (request, f, requireHouseOwner = owner, extra = {}) => {
  const r = await handleMissionSources(request, env, { requireHouseOwner, fetchImpl: f.fetchImpl, ...extra });
  const text = await r.text();
  return { status: r.status, body: JSON.parse(text), text, headers: r.headers };
};

test('the route answers only its own prefix', async () => {
  assert.equal(MISSION_SOURCES_PREFIX, '/v1/mission-sources');
  assert.equal(await handleMissionSources(new Request('https://api.mccluster.org/v1/mission-sourcesx'), env, { requireHouseOwner: owner, fetchImpl: fake().fetchImpl }), null);
  assert.equal(await handleMissionSources(new Request('https://api.mccluster.org/v1/eup'), env, { requireHouseOwner: owner, fetchImpl: fake().fetchImpl }), null);
  assert.deepEqual([...MISSION_SOURCE_COMMANDS], ['show', 'hide', 'edit']);
  assert.equal(MISSION_SOURCES_PENDING_FILE, 'supabase/pending/20261119140000_mission_catalog_sources_v1.sql');
});

test('owner only before anything is read: 401, 403, and 503 when the owner check cannot answer', async () => {
  for (const [check, status, code] of [[anon, 401, 'authentication_required'], [denied, 403, 'owner_required'], [broken, 503, 'authorization_unavailable'],
    [offline, 503, 'authorization_unavailable'], [async () => null, 401, 'authentication_required'], [async () => ({ id: 'not-a-uuid' }), 401, 'authentication_required']]) {
    for (const req of [() => get(), () => post(body())]) {
      const f = fake();
      const r = await run(req(), f, check);
      assert.equal(r.status, status);
      assert.deepEqual(r.body, { ok: false, code, error: MISSION_SOURCE_MESSAGES[code] });
      assert.equal(r.headers.get('cache-control'), 'private, no-store');
      assert.equal(f.calls.length, 0, 'no store call before the owner is verified');
    }
  }
  const missing = await handleMissionSources(get(), env, { fetchImpl: fake().fetchImpl });
  assert.equal(missing.status, 503, 'no owner check wired: 503');
});

test('GET: the owner read as the function answers it, private and no-store, the actor the verified user', async () => {
  const f = fake((name, args) => { assert.equal(name, 'mission_catalog_source_owner_state'); assert.deepEqual(args, { p_actor: OWNER }); return state(); });
  const r = await run(get(), f, async () => ({ id: OWNER.toUpperCase() }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, store: 'applied', ...state() });
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://matthew.mccluster.org', 'the Worker\'s CORS allowlist');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff', 'the Worker\'s security headers');
  const [call] = f.calls;
  assert.equal(call.path, '/rest/v1/rpc/mission_catalog_source_owner_state');
  assert.equal(call.method, 'POST');
  assert.equal(call.redirect, 'manual');
  assert.equal(call.headers.apikey, 'fixture-only');
  assert.equal(call.headers.authorization, 'Bearer fixture-only');
  const slash = await run(get('/'), fake(() => state()));
  assert.equal(slash.body.store, 'applied', 'a trailing slash is the same route');
});

test('GET: honest while the store is not applied, unreachable or unreadable; 42501 is 403', async () => {
  for (const code of ['PGRST202', '42883', 'PGRST205', '42P01']) {
    const r = await run(get(), fake(() => storeError(code, SECRET, 404)));
    assert.equal(r.status, 200, code);
    assert.deepEqual(r.body, { ok: true, store: 'not_applied', sources: [], history: [] }, code);
  }
  for (const store of [() => storeError('XX000', SECRET, 500), () => storeError('55P03'), () => { throw new TypeError('down'); },
    () => new Response('not json', { status: 200 }), () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.invalid' } }),
    () => ({ sources: 'no' }), () => [1, 2]]) {
    const r = await run(get(), fake(store));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, store: 'unavailable', sources: [], history: [] });
  }
  const refused = await run(get(), fake(() => storeError('42501', SECRET, 403)));
  assert.equal(refused.status, 403);
  assert.deepEqual(refused.body, { ok: false, code: 'owner_required', error: MISSION_SOURCE_MESSAGES.owner_required });
  const unset = await handleMissionSources(get(), { ALLOWED_ORIGINS: env.ALLOWED_ORIGINS }, { requireHouseOwner: owner, fetchImpl: fake().fetchImpl });
  assert.equal((await unset.json()).store, 'unavailable', 'no store configured: unavailable');
});

test('a timeout is the store being unavailable, and the timer is bounded', async () => {
  const slow = { fetchImpl: (input, options) => new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); }) };
  const started = Date.now();
  const r = await run(get(), slow, owner, { rpcTimeoutMs: 30 });
  assert.equal(r.body.store, 'unavailable');
  assert.ok(Date.now() - started < 2000);
  const c = await run(post(body()), slow, owner, { rpcTimeoutMs: 30 });
  assert.equal(c.status, 503);
  assert.equal(c.body.code, 'storage_unavailable');
});

test('POST: the command goes to the one function with the verified actor; the receipt comes back unchanged', async () => {
  const f = fake((name, args) => {
    assert.equal(name, 'mission_catalog_source_command');
    assert.deepEqual(args, { p_actor: OWNER, p_catalog: 'drawdown', p_command: 'hide', p_expected_revision: 1, p_key: KEY, p_reason: 'Test fixture: owner decision.', p_payload: {} });
    return receipt();
  });
  const r = await run(post(body()), f);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, receipt: receipt() });
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  const show = fake((name, args) => { assert.deepEqual(args.p_payload, { permission_confirmed: true, permission_confirmed_on: '2026-11-19' }); return receipt({ command: 'show', state: 'shown' }); });
  assert.equal((await run(post(body({ command: 'show', payload: { permission_confirmed: true, permission_confirmed_on: '2026-11-19' } })), show)).status, 200);
  const edit = fake((name, args) => { assert.deepEqual(args.p_payload, { role_line: 'A line.', facts: [], facts_read_on: '2026-11-19' }); return receipt({ command: 'edit' }); });
  assert.equal((await run(post(body({ command: 'edit', payload: { role_line: 'A line.', facts: [], facts_read_on: '2026-11-19' } })), edit)).status, 200);
  const upper = fake((name, args) => { assert.equal(args.p_key, KEY); return receipt(); });
  assert.equal((await run(post(body({ key: KEY.toUpperCase() })), upper)).status, 200, 'the key is sent lower case');
});

test('POST: the actor is never taken from the body', async () => {
  for (const extra of [{ actor: '22222222-2222-4222-8222-222222222222' }, { p_actor: '22222222-2222-4222-8222-222222222222' }]) {
    const f = fake();
    const r = await run(post(body(extra)), f);
    assert.equal(r.status, 422, 'an extra key is refused');
    assert.equal(f.calls.length, 0);
  }
});

test('POST: every body rule refuses with 422 invalid before any store call', async () => {
  const cases = [
    'not json', '[]', '"x"', 'null', JSON.stringify({ ...body(), extra: 1 }),
    ...['command', 'catalog', 'expected_revision', 'key', 'reason'].map((k) => { const b = body(); delete b[k]; return b; }),
    body({ command: 'delete' }), body({ command: 'SHOW' }), body({ catalog: 'Drawdown' }), body({ catalog: 'd' }), body({ catalog: 'x'.repeat(41) }), body({ catalog: 'draw down' }),
    body({ expected_revision: 0 }), body({ expected_revision: -1 }), body({ expected_revision: 1.5 }), body({ expected_revision: '1' }), body({ expected_revision: 2147483648 }), body({ expected_revision: null }),
    body({ key: 'not-a-uuid' }), body({ key: 1 }), body({ key: KEY + 'x' }),
    body({ reason: '' }), body({ reason: 'x'.repeat(501) }), body({ reason: 'two\nlines' }), body({ reason: 'tab\there' }), body({ reason: 5 }),
    body({ payload: [] }), body({ payload: 'x' }), body({ payload: null }),
    body({ command: 'hide', payload: { x: 1 } }),
    body({ command: 'show' }), body({ command: 'show', payload: {} }), body({ command: 'show', payload: { permission_confirmed: 'true', permission_confirmed_on: '2026-11-19' } }),
    body({ command: 'show', payload: { permission_confirmed: true } }), body({ command: 'show', payload: { permission_confirmed: true, permission_confirmed_on: '2026-02-30' } }),
    body({ command: 'show', payload: { permission_confirmed: true, permission_confirmed_on: '19-11-2026' } }),
    body({ command: 'show', payload: { permission_confirmed: true, permission_confirmed_on: '2026-11-19', letter: 'x' } }),
    body({ command: 'edit' }), body({ command: 'edit', payload: {} }), body({ command: 'edit', payload: { state: 'shown' } }),
    body({ command: 'edit', payload: { role_line: 5 } }), body({ command: 'edit', payload: { role_line: 'x'.repeat(161) } }),
    body({ command: 'edit', payload: { facts: [] } }), body({ command: 'edit', payload: { facts: 'x', facts_read_on: '2026-11-19' } }),
    body({ command: 'edit', payload: { facts: Array(7).fill({}), facts_read_on: '2026-11-19' } }),
    body({ command: 'edit', payload: { role_line: 'ok', facts_read_on: 'yesterday' } }),
    JSON.stringify({ ...body(), reason: 'x'.repeat(4100) })
  ];
  for (const b of cases) {
    const f = fake();
    const r = await run(post(b), f);
    assert.equal(r.status, 422, JSON.stringify(b).slice(0, 120));
    assert.deepEqual(r.body, { ok: false, code: 'invalid', error: MISSION_SOURCE_MESSAGES.invalid });
    assert.equal(f.calls.length, 0, 'no store call');
  }
  assert.throws(() => commandArgs(body({ expected_revision: '2' })), /could not be read/);
});

test('POST: every store answer maps to its status and code, with a fixed sentence and no upstream text', async () => {
  const rows = [
    ['42501', null, 403, 'owner_required'],
    ['22023', null, 422, 'invalid'], ['22007', null, 422, 'invalid'], ['22008', null, 422, 'invalid'], ['22P02', null, 422, 'invalid'],
    ['23514', 'new row for relation "mission_catalog_sources" violates check constraint "mission_catalog_sources_words_check"', 422, 'words_refused'],
    ['23514', 'new row for relation "mission_catalog_sources" violates check constraint "mission_catalog_sources_facts_check"', 422, 'facts_refused'],
    ['23514', 'new row for relation "mission_catalog_sources" violates check constraint "mission_catalog_sources_read_on_check"', 422, 'facts_refused'],
    ['23514', 'new row for relation "mission_catalog_sources" violates check constraint "mission_catalog_sources_role_line_check"', 422, 'role_line_refused'],
    ['23514', 'new row for relation "mission_catalog_sources" violates check constraint "mission_catalog_sources_state_check"', 422, 'invalid'],
    ['23514', 'no constraint named', 422, 'invalid'],
    ['MCS01', null, 404, 'not_found'], ['MCS02', null, 409, 'moved'], ['MCS03', null, 409, 'key_reused'],
    ['55P03', null, 503, 'store_busy'], ['57014', null, 503, 'store_busy'],
    ['PGRST202', null, 503, 'store_not_applied'], ['42883', null, 503, 'store_not_applied'], ['PGRST205', null, 503, 'store_not_applied'], ['42P01', null, 503, 'store_not_applied'],
    ['XX000', null, 503, 'storage_unavailable'], ['23505', null, 503, 'storage_unavailable'], ['P0001', null, 503, 'storage_unavailable'], ['', null, 503, 'storage_unavailable']
  ];
  for (const [code, message, status, reason] of rows) {
    const r = await run(post(body()), fake(() => storeError(code, message ?? SECRET)));
    assert.equal(r.status, status, `${code} -> ${status}`);
    assert.deepEqual(r.body, { ok: false, code: reason, error: MISSION_SOURCE_MESSAGES[reason] }, code);
    assert.ok(!r.text.includes(SECRET) && !r.text.includes('violates'), `${code}: no upstream text`);
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
  }
  for (const [code, [status, reason]] of Object.entries(MISSION_SOURCE_STORE_ERRORS)) assert.deepEqual(storeCode({ code }), [status, reason]);
  assert.deepEqual(storeCode({ code: '23514', message: 'violates check constraint "mission_catalog_sources_words_check"' }), [422, 'words_refused']);
});

test('POST: a lost, unreadable, redirected or malformed answer is an unknown outcome (503 storage_unavailable)', async () => {
  for (const store of [() => { throw new TypeError('connection reset'); }, () => new Response('<html>', { status: 200 }),
    () => new Response(null, { status: 307, headers: { location: 'https://elsewhere.invalid' } }), () => ({ ok: true }), () => ({ ok: true, revision: '2' }),
    () => ({ ok: false, revision: 2 }), () => storeError('XX000', SECRET, 500)]) {
    const r = await run(post(body()), fake(store));
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'storage_unavailable');
    assert.match(r.body.error, /^Not known whether this was saved\./);
  }
});

test('only GET on the list and POST on commands; anything else under the prefix is refused after the owner check', async () => {
  assert.equal((await run(post(body(), ''), fake())).status, 405);
  assert.equal((await run(get('/commands'), fake())).status, 405);
  const other = await run(get('/other'), fake());
  assert.equal(other.status, 404);
  assert.equal(other.body.code, 'not_route');
  assert.equal((await run(get('/other'), fake(), denied)).status, 403, 'the owner check comes first');
});

test('the words the owner reads: fixed sentences, none of them names an organization as sponsor, partner or account holder of the platform', () => {
  for (const [code, sentence] of Object.entries(MISSION_SOURCE_MESSAGES)) {
    assert.ok(typeof sentence === 'string' && sentence.length > 10 && sentence.length < 400, code);
    assert.doesNotMatch(sentence, /Equity Uprise|Human Uprise/, code);
  }
  assert.equal(MISSION_SOURCE_MESSAGES.store_not_applied, 'The mission sources table is not applied yet (supabase/pending/20261119140000_mission_catalog_sources_v1.sql). Nothing can be shown, hidden or edited until it is approved and applied.');
});

test('the Worker entry sends /v1/mission-sources to this route (no bearer: 401 before anything is asked)', async () => {
  const { default: worker } = await import('../src/index.js');
  for (const path of ['/v1/mission-sources', '/v1/mission-sources/commands']) {
    const r = await worker.fetch(new Request(`https://api.mccluster.org${path}`, { method: path.endsWith('commands') ? 'POST' : 'GET', headers: { origin: 'https://matthew.mccluster.org' }, body: path.endsWith('commands') ? '{}' : undefined }), env);
    assert.equal(r.status, 401, path);
    assert.deepEqual(await r.json(), { ok: false, code: 'authentication_required', error: MISSION_SOURCE_MESSAGES.authentication_required });
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
  }
});
