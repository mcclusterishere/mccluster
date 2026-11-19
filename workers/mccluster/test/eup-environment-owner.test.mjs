// E=Up › Environment: the owner controls of the E=UP event timeline (slice S2, docs/control-plane/EUP-EVENT-TIMELINE.md), with a
// fake service REST and fake providers. What is proven here: owner-only before anything is read (401, 403), private/no-store
// on every answer, the acting owner is always the verified session user, every body rule before any store call, every SQLSTATE
// of the three owner functions, honest answers while the store is not applied or unreachable and while the module is off,
// and the per-source off / outage / no data / reporting rule. The SQL itself (idempotency, 409, rollback as a new revision,
// the decision log, the preview's projection) is proven against the real pending parts in
// scripts/test/eup-environment-owner.integration.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleEup, EUP_PREFIX, EUP_SECTIONS } from '../src/eup/router.js';
import {
  COMMANDS, GOVERNMENT_PROVIDERS, ENVIRONMENT_STORE_ERRORS, ENVIRONMENT_STORE_PARTS, LIVE_SURFACES,
  surfaceState, providerState, publicState, receiptShape, storeProvider
} from '../src/eup/environment/owner.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only', ALLOWED_ORIGINS: 'https://matthew.mccluster.org' };
const owner = async () => ({ id: OWNER });
const denied = async () => { throw Object.assign(new Error('McCluster house owner access required'), { status: 403 }); };
const anon = async () => { throw Object.assign(new Error('Authentication required'), { status: 401 }); };
const url = (path) => `https://api.mccluster.org${EUP_PREFIX}/environment${path}`;
const get = (path) => new Request(url(path));
const post = (body, headers = { 'content-type': 'application/json' }) => new Request(url('/commands'), { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const KEY = 'environment-key-0001';
const REASON = 'Test fixture: owner decision.';
const EVENT = 'usgs:us7000test';
const NOW = Date.parse('2026-11-19T12:00:00Z');
const storeError = (code, message = 'database text that must not reach the owner', status = 400) => Response.json({ code, message, details: null, hint: null }, { status });
const policyOf = (state, revision = 1) => ({ schema: 'equity-uprise.module-policy/v1', installationId: 'mccluster', moduleId: 'environment', state, revision });
const providerRow = (provider, extra = {}) => ({ provider, configured: false, supported: provider === 'usgs', ingest: null, publication: null, rule: null, revision: 0,
  default_rule: provider === 'usgs' ? { min_magnitude: 4.5, include_automatic: true, significance_above: 600, pager_alert: true, tsunami: true } : null,
  updated_at: null, updated_by: null, last_run: null, last_success_at: null, events: {}, ...extra });
const ownerReadOf = (extra = {}) => ({ schema: 'mccluster.environment-owner/v1', module: { installed: false }, providers: GOVERNMENT_PROVIDERS.map((p) => providerRow(p)),
  health: [], review: { candidates: [], held: [], retracted: [], withdrawn: [], merged: [], corrected: [], coverage: [] }, decisions: [], ...extra });
const receiptOf = (command = 'hold', extra = {}) => ({ schema: 'mccluster.environment-decision/v1', command, target_kind: 'event', target: EVENT, changed: true,
  prior: { state: 'published', revision: 1 }, result: { state: 'held', revision: 1 }, recorded_at: '2026-11-19T12:00:00.000Z', ...extra });
const pageOf = (events = []) => ({ schema: 'mccluster.environment-events/v1', events, next_cursor: null, sources: [{ provider: 'usgs', status: 'ok', checked_at: '2026-11-19T11:55:00.000Z', last_success_at: '2026-11-19T11:55:00.000Z' }] });

/* the providers a visitor's page reads, as small built answers (labelled built): USGS one quake; NWS, NHC and NIFC nothing;
   EONET and NOAA CO-OPS down; FIRMS never asked (no key) */
const quake = () => ({ metadata: { generated: NOW }, features: [{ id: 'us7000test', geometry: { coordinates: [142.1, 38.3, 10] },
  properties: { place: '40 km E of a built test place', time: Date.now() - 1800e3, mag: 5.2, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000test' } }] });
function providers(mode = {}) {
  return (u) => {
    const host = u.hostname;
    const m = mode[host];
    if (m === 'down') throw new TypeError('provider unreachable');
    if (host === 'earthquake.usgs.gov') return Response.json(m === 'empty' ? { metadata: { generated: NOW }, features: [] } : quake());
    if (host === 'api.weather.gov') return Response.json({ features: [] });
    if (host === 'www.nhc.noaa.gov') return Response.json({ activeStorms: [] });
    if (host === 'services3.arcgis.com') return Response.json({ features: [] });
    if (host === 'eonet.gsfc.nasa.gov' || host === 'api.tidesandcurrents.noaa.gov') throw new TypeError('provider unreachable');
    if (host === 'firms.modaps.eosdis.nasa.gov') throw new Error('FIRMS must not be asked without its key');
    throw new Error('unexpected provider ' + u.href);
  };
}
/* store: (name, body) => value | Response; providerMode as above */
function fake({ store = () => ({}), live = providers() } = {}) {
  const calls = [], providerCalls = [];
  const fetchImpl = async (input, options = {}) => {
    const u = new URL(String(input instanceof Request ? input.url : input));
    if (u.origin === 'https://fixture.invalid') {
      const call = { url: u.href, name: u.pathname.split('/rpc/')[1] || null, method: options.method, headers: options.headers || {}, redirect: options.redirect, body: options.body ? JSON.parse(options.body) : null };
      calls.push(call);
      const out = await store(call.name, call.body, calls.length);
      return out instanceof Response ? out : Response.json(out);
    }
    providerCalls.push(u.href);
    return live(u);
  };
  return { calls, providerCalls, fetchImpl };
}
const run = (request, f, requireHouseOwner = owner) => handleEup(request, env, { requireHouseOwner, fetchImpl: f.fetchImpl, now: () => NOW });
const READS = [['GET /health', () => get('/health')], ['GET /review', () => get('/review')], ['GET /events/:id', () => get('/events/' + encodeURIComponent(EVENT))], ['GET /preview', () => get('/preview')]];
const ROUTES = [...READS, ['POST /commands', () => post({ command: 'hold', target: EVENT, expected_revision: 1, idempotency_key: KEY, reason: REASON })]];

test('environment is a registered E=Up section behind the same owner check as every other section', () => {
  assert.ok(EUP_SECTIONS.includes('environment'));
  assert.deepEqual([...GOVERNMENT_PROVIDERS], ['usgs', 'nws', 'nhc', 'eonet', 'firms', 'wfigs', 'coops']);
  assert.ok(!GOVERNMENT_PROVIDERS.includes('gdelt'), 'news is never a provider');
  assert.deepEqual([...COMMANDS], ['hold', 'release', 'retract', 'restore', 'rollback', 'set_rule', 'pause_provider', 'resume_provider', 'hide_provider', 'show_provider', 'attach_coverage', 'reject_coverage', 'retract_coverage']);
  assert.deepEqual(ENVIRONMENT_STORE_PARTS.map((p) => p.split('/').pop()), [1, 2, 3, 4, 5].map((i) => `20261119100000_eup_environment_events_v1_0${i}.sql`));
});

test('every environment route answers 401 signed out and 403 for a non-owner, private and no-store, and reaches neither the store nor a provider', async () => {
  for (const [label, make] of ROUTES) {
    const a = fake(); const r401 = await run(make(), a, anon);
    assert.equal(r401.status, 401, label); assert.equal((await r401.json()).reason, 'authentication_required');
    assert.equal(r401.headers.get('cache-control'), 'private, no-store', label);
    const d = fake(); const r403 = await run(make(), d, denied);
    assert.equal(r403.status, 403, label); assert.equal((await r403.json()).reason, 'owner_required');
    assert.equal(r403.headers.get('cache-control'), 'private, no-store', label);
    assert.equal(a.calls.length + d.calls.length, 0, `${label}: no store call`);
    assert.equal(a.providerCalls.length + d.providerCalls.length, 0, `${label}: no provider asked`);
    const none = await handleEup(make(), env, { fetchImpl: d.fetchImpl });
    assert.equal(none.status, 503, `${label}: no authorization function`);
    assert.equal(d.calls.length, 0);
  }
});

test('an unknown environment path is 404 and a known one with another method 405, both private', async () => {
  for (const [path, init, status] of [['/nope', {}, 404], ['/events', {}, 404], ['/events/a/b', {}, 404], ['', {}, 404], ['/health', { method: 'POST' }, 405], ['/commands', {}, 405], ['/preview', { method: 'DELETE' }, 405]]) {
    const f = fake();
    const r = await run(new Request(url(path), init), f);
    assert.equal(r.status, status, path); assert.equal(r.headers.get('cache-control'), 'private, no-store');
    assert.equal(f.calls.length, 0, path);
  }
});

/* ---------------------------------------------------------------- health */
test('health while the store is NOT applied and the module was never installed: 200, store not_applied, every source off to the public, the providers still checked', async () => {
  const f = fake({ store: (name) => name === 'eup_module_policy_read' ? storeError('EUM01', 'module_not_installed') : storeError('PGRST202', 'Could not find the function', 404) });
  const r = await run(get('/health'), f); const b = await r.json();
  assert.equal(r.status, 200); assert.equal(b.ok, true); assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(b.schema, 'mccluster.environment-owner-health/v1');
  assert.deepEqual(b.module, { status: 'read', installed: false, state: null, revision: null, gate: 'off', reason: null });
  assert.deepEqual(b.store, { status: 'not_applied', reason: 'store_not_applied', parts: [...ENVIRONMENT_STORE_PARTS] });
  assert.deepEqual(b.log, []);
  assert.deepEqual(b.sources.map((s) => s.provider), [...GOVERNMENT_PROVIDERS]);
  for (const s of b.sources) {
    assert.deepEqual(s.public, { state: 'off', reason: 'module_not_installed' }, s.provider);
    assert.equal(s.store, null, s.provider);
  }
  const now = Object.fromEntries(b.sources.map((s) => [s.provider, [s.provider_now.state, s.provider_now.reason]]));
  assert.deepEqual(now, {
    usgs: ['reporting', null], nws: ['no_data', null], nhc: ['no_data', null], eonet: ['outage', 'upstream_error'],
    firms: ['off', 'not_configured'], wfigs: ['no_data', null], coops: ['outage', 'upstream_error']
  });
  const usgs = b.sources[0].provider_now.surfaces;
  assert.deepEqual(usgs.map((s) => [s.id, s.items, s.state]), [['feed:usgs', 1, 'reporting']]);
  assert.ok(f.providerCalls.some((u) => u.startsWith('https://earthquake.usgs.gov/')), 'the provider is asked while the module is off');
  assert.ok(!f.providerCalls.some((u) => u.includes('firms.modaps')), 'FIRMS is never asked without its key');
  assert.deepEqual(f.calls.map((c) => c.name).sort(), ['eup_environment_owner_read', 'eup_module_policy_read']);
  assert.deepEqual(f.calls.find((c) => c.name === 'eup_environment_owner_read').body, { p_actor: OWNER, p_event_id: null, p_limit: 50 });
  assert.doesNotMatch(JSON.stringify(b), /database text|Could not find|fixture-only|provider unreachable/);
});

test('health with the store applied and the module enabled: the public state is the provider state; the store says what the ingest did', async () => {
  const rows = GOVERNMENT_PROVIDERS.map((p) => providerRow(p));
  rows[0] = providerRow('usgs', { configured: true, ingest: 'active', publication: 'shown', rule: rows[0].default_rule, revision: 2,
    last_run: { seq: 9, run_id: 'run-9', status: 'empty', reason: null, http_status: 200, fetched_at: '2026-11-19T11:55:00.000Z', upstream_generated_at: null, counts: {}, recorded_at: '2026-11-19T11:55:01.000Z' },
    last_success_at: '2026-11-19T11:55:00.000Z', events: { published: 3 } });
  const log = [{ seq: 9, provider: 'usgs', run_id: 'run-9', status: 'empty', reason: null, http_status: 200, fetched_at: '2026-11-19T11:55:00.000Z', counts: {}, refusals: null, recorded_at: '2026-11-19T11:55:01.000Z' }];
  const f = fake({ store: (name) => name === 'eup_module_policy_read' ? policyOf('enabled', 3) : ownerReadOf({ providers: rows, health: log }) });
  const b = await (await run(get('/health'), f)).json();
  assert.deepEqual(b.module, { status: 'read', installed: true, state: 'enabled', revision: 3, gate: 'on', reason: null });
  assert.deepEqual(b.store, { status: 'applied' });
  assert.deepEqual(b.log, log);
  const pub = Object.fromEntries(b.sources.map((s) => [s.provider, s.public.state]));
  assert.deepEqual(pub, { usgs: 'reporting', nws: 'no_data', nhc: 'no_data', eonet: 'outage', firms: 'off', wfigs: 'no_data', coops: 'outage' });
  assert.deepEqual(b.sources.find((s) => s.provider === 'firms').public, { state: 'off', reason: 'not_configured' });
  const usgs = b.sources[0].store;
  assert.equal(usgs.state, 'no_data', 'the last ingest run read nothing: no data, not an outage');
  assert.equal(usgs.revision, 2); assert.equal(usgs.ingest, 'active'); assert.deepEqual(usgs.events, { published: 3 });
  assert.equal(b.sources[1].store.state, 'not_configured');
});

test('health tells a module that cannot be read (outage) from one that is off, and a draining module still answers reads', async () => {
  const down = fake({ store: (name) => name === 'eup_module_policy_read' ? new Response('upstream', { status: 500 }) : ownerReadOf() });
  const b = await (await run(get('/health'), down)).json();
  assert.equal(b.module.gate, 'outage'); assert.equal(b.module.status, 'unreadable');
  for (const s of b.sources) assert.deepEqual(s.public, { state: 'outage', reason: 'module_policy_unreadable' });
  const missing = fake({ store: (name) => name === 'eup_module_policy_read' ? storeError('PGRST202', 'x', 404) : ownerReadOf() });
  assert.equal((await (await run(get('/health'), missing)).json()).module.gate, 'outage', 'a missing policy function is an outage, not off');
  const disabled = fake({ store: (name) => name === 'eup_module_policy_read' ? policyOf('disabled', 0) : ownerReadOf() });
  const d = await (await run(get('/health'), disabled)).json();
  assert.equal(d.module.gate, 'off'); assert.deepEqual(d.sources[0].public, { state: 'off', reason: 'module_disabled' });
  const draining = fake({ store: (name) => name === 'eup_module_policy_read' ? policyOf('draining', 4) : ownerReadOf() });
  assert.equal((await (await run(get('/health'), draining)).json()).sources[0].public.state, 'reporting');
});

test('health with the store unreachable still answers the module and the providers; a store that refuses the owner conceals everything', async () => {
  const f = fake({ store: (name) => { if (name === 'eup_module_policy_read') return policyOf('enabled'); throw new TypeError('store unreachable'); } });
  const r = await run(get('/health'), f); const b = await r.json();
  assert.equal(r.status, 200); assert.deepEqual(b.store, { status: 'unavailable', reason: 'storage_unavailable' });
  assert.equal(b.sources[0].provider_now.state, 'reporting');
  const malformed = fake({ store: (name) => name === 'eup_module_policy_read' ? policyOf('enabled') : { schema: 'something else' } });
  assert.deepEqual((await (await run(get('/health'), malformed)).json()).store, { status: 'unavailable', reason: 'storage_unavailable' });
  const refused = fake({ store: (name) => name === 'eup_module_policy_read' ? policyOf('enabled') : storeError('42501', 'House owner required') });
  const r403 = await run(get('/health'), refused);
  assert.equal(r403.status, 403); assert.equal((await r403.json()).reason, 'owner_required');
});

/* ---------------------------------------------------------------- review, events, preview */
test('review: the store applied answers the queue, the providers and the decisions; not applied is a state; unreachable or unreadable is 503', async () => {
  const decision = { seq: 1, command: 'set_rule', target_kind: 'provider', target_id: 'usgs', expected_revision: 0, reason: REASON, actor: OWNER, idempotency_key: KEY, payload: {}, prior: {}, receipt: receiptOf('set_rule'), created_at: '2026-11-19T11:00:00.000Z' };
  const held = { id: EVENT, state: 'held', revision: 2 };
  const f = fake({ store: () => ownerReadOf({ review: { ...ownerReadOf().review, held: [held] }, decisions: [decision] }) });
  const r = await run(get('/review?limit=20'), f); const b = await r.json();
  assert.equal(r.status, 200); assert.deepEqual(b.store, { status: 'applied' });
  assert.deepEqual(b.review.held, [held]); assert.deepEqual(b.decisions, [decision]);
  assert.deepEqual(b.providers.map((p) => [p.provider, p.state]), GOVERNMENT_PROVIDERS.map((p) => [p, 'not_configured']));
  assert.deepEqual(f.calls[0].body, { p_actor: OWNER, p_event_id: null, p_limit: 20 });
  const na = await (await run(get('/review'), fake({ store: () => storeError('42883', 'function does not exist', 404) }))).json();
  assert.deepEqual(na.store, { status: 'not_applied', reason: 'store_not_applied', parts: [...ENVIRONMENT_STORE_PARTS] }); assert.equal(na.review, null);
  for (const store of [() => { throw new TypeError('down'); }, () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.invalid/' } }), () => ({ schema: 'other' }), () => storeError('XX000')]) {
    const r5 = await run(get('/review'), fake({ store }));
    assert.equal(r5.status, 503); const b5 = await r5.json(); assert.equal(b5.reason, 'storage_unavailable');
    assert.match(b5.error, /nothing is shown as if it had/); assert.doesNotMatch(b5.error, /outcome|command|again/, 'a read is never told of an outcome or of sending again');
  }
  /* a busy store on a read: nothing was read, read again; never the command sentence about sending the same key again */
  for (const route of ['/review', '/events/' + encodeURIComponent(EVENT), '/preview']) {
    const busy = await run(get(route), fake({ store: () => storeError('57014', 'canceling statement due to statement timeout') }));
    const bb = await busy.json();
    assert.equal(busy.status, 503, route); assert.equal(bb.reason, 'store_busy', route);
    assert.equal(bb.error, 'The E=UP event store is busy; nothing was read. Read again', route); assert.doesNotMatch(JSON.stringify(bb), /statement timeout/, route);
  }
  for (const q of ['?limit=0', '?limit=201', '?limit=abc']) {
    const g = fake(); assert.equal((await run(get('/review' + q), g)).status, 400, q); assert.equal(g.calls.length, 0);
  }
});

test('events/:id: a bad id is refused before the store; unknown is 404; one event comes back in full', async () => {
  for (const bad of ['not-an-id', 'gdelt:123', 'usgs:', '%E0%A4%A']) {
    const g = fake(); const r = await run(get('/events/' + bad), g);
    assert.equal(r.status, 400, bad); assert.equal((await r.json()).reason, 'invalid_event'); assert.equal(g.calls.length, 0);
  }
  const missing = await run(get('/events/' + encodeURIComponent(EVENT)), fake({ store: () => ownerReadOf({ event: null }) }));
  assert.equal(missing.status, 404); assert.equal((await missing.json()).reason, 'event_not_found');
  const event = { summary: { id: EVENT, revision: 2 }, revisions: [{ revision: 2 }, { revision: 1 }] };
  const f = fake({ store: () => ownerReadOf({ event }) });
  const b = await (await run(get('/events/' + encodeURIComponent(EVENT)), f)).json();
  assert.deepEqual(b.event, event); assert.deepEqual(f.calls[0].body, { p_actor: OWNER, p_event_id: EVENT, p_limit: 1 });
  const na = await (await run(get('/events/' + encodeURIComponent(EVENT)), fake({ store: () => storeError('PGRST202', 'x', 404) }))).json();
  assert.equal(na.store.status, 'not_applied'); assert.equal(na.event, null);
});

test('preview: the owner reads the public projection while the module is off; the query is checked first; the actor is the session user', async () => {
  const events = [{ id: EVENT, revision: 1, state: 'published', title: 'M 5.2 - 40 km E of Example' }];
  const f = fake({ store: (name) => name === 'eup_module_policy_read' ? storeError('EUM01') : pageOf(events) });
  const r = await run(get('/preview?since=2026-11-18T00:00:00Z&limit=10&actor=' + '22222222-2222-4222-8222-222222222222'), f);
  const b = await r.json();
  assert.equal(r.status, 200); assert.equal(b.owner_preview, true); assert.equal(b.module.gate, 'off');
  assert.deepEqual(b.events, events); assert.equal(b.page_schema, 'mccluster.environment-events/v1'); assert.equal(b.next_cursor, null);
  const call = f.calls.find((c) => c.name === 'eup_environment_owner_preview');
  assert.deepEqual(call.body, { p_actor: OWNER, p_since: '2026-11-18T00:00:00.000Z', p_until: null, p_cursor: null, p_limit: 10 });
  for (const q of ['?since=yesterday', '?until=2026-13-40T00:00:00Z', '?since=2026-11-19T00:00:00Z&until=2026-11-18T00:00:00Z', '?cursor=1|gdelt:1', '?cursor=abc', '?limit=500']) {
    const g = fake(); const bad = await run(get('/preview' + q), g);
    assert.equal(bad.status, 400, q); assert.equal(g.calls.length, 0, q);
  }
  const na = await (await run(get('/preview'), fake({ store: (name) => name === 'eup_module_policy_read' ? storeError('EUM01') : storeError('PGRST202', 'x', 404) }))).json();
  assert.equal(na.store.status, 'not_applied'); assert.deepEqual(na.events, []);
  const invalid = await run(get('/preview'), fake({ store: (name) => name === 'eup_module_policy_read' ? policyOf('enabled') : storeError('22023') }));
  assert.equal(invalid.status, 422);
  const refused = await run(get('/preview'), fake({ store: (name) => name === 'eup_module_policy_read' ? policyOf('enabled') : storeError('42501') }));
  assert.equal(refused.status, 403);
});

/* ---------------------------------------------------------------- commands */
const ok = (extra = {}) => ({ command: 'hold', target: EVENT, expected_revision: 1, idempotency_key: KEY, reason: REASON, ...extra });
test('a command sends one service-key RPC with the session user as actor, a trimmed reason and the payload, whatever the body claims', async () => {
  const f = fake({ store: () => receiptOf('rollback', { result: { state: 'published', revision: 4 } }) });
  const r = await run(post(ok({ command: 'rollback', expected_revision: 3, payload: { to_revision: 1 }, reason: `  ${REASON}  `, actor: '22222222-2222-4222-8222-222222222222', p_actor: 'x' })), f);
  const b = await r.json();
  assert.equal(r.status, 200); assert.equal(b.ok, true); assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(f.calls.length, 1);
  const [call] = f.calls;
  assert.equal(call.url, 'https://fixture.invalid/rest/v1/rpc/eup_environment_owner_command'); assert.equal(call.method, 'POST'); assert.equal(call.redirect, 'manual');
  assert.equal(call.headers.apikey, 'fixture-only'); assert.equal(call.headers.authorization, 'Bearer fixture-only');
  assert.deepEqual(call.body, { p_actor: OWNER, p_command: 'rollback', p_target: EVENT, p_expected_revision: 3, p_key: KEY, p_reason: REASON, p_payload: { to_revision: 1 } });
  assert.equal(b.receipt.command, 'rollback'); assert.deepEqual(b.receipt.result, { state: 'published', revision: 4 });
  assert.equal(f.providerCalls.length, 0);
});

test('every body rule is enforced before the store is called', async () => {
  const cases = [
    [post(ok(), { 'content-type': 'text/plain' }), 415, 'json_required'],
    [post('x'.repeat(5000)), 413, 'body_too_large'],
    [post('{not json'), 400, 'invalid_json'],
    [post('[1]'), 400, 'invalid_json'],
    [post(ok({ idempotency_key: 'short' })), 400, 'idempotency_key_required'],
    [post(ok({ idempotency_key: 'has space in it' })), 400, 'idempotency_key_required'],
    [post(ok({ reason: '   ' })), 422, 'reason_required'],
    [post(ok({ reason: 'x'.repeat(501) })), 422, 'reason_required'],
    [post(ok({ reason: 'two\nlines' })), 422, 'reason_required'],
    [post(ok({ command: 'delete' })), 422, 'invalid_command'],
    [post(ok({ command: 'publish' })), 422, 'invalid_command'],
    [post(ok({ target: 'us7000test' })), 400, 'invalid_target'],
    [post(ok({ command: 'pause_provider', target: 'gdelt', expected_revision: 1 })), 422, 'provider_refused'],
    [post(ok({ command: 'set_rule', target: 'GDELT', expected_revision: 0 })), 400, 'invalid_target'],
    [post(ok({ command: 'attach_coverage', target: EVENT })), 400, 'invalid_target'],
    [post(ok({ expected_revision: -1 })), 400, 'expected_revision_required'],
    [post(ok({ expected_revision: '1' })), 400, 'expected_revision_required'],
    [post(ok({ command: 'rollback' })), 422, 'invalid_payload'],
    [post(ok({ command: 'rollback', payload: { to_revision: 0 } })), 422, 'invalid_payload'],
    [post(ok({ command: 'rollback', payload: { to_revision: 1, extra: true } })), 422, 'invalid_payload'],
    [post(ok({ payload: { to_revision: 1 } })), 422, 'invalid_payload'],
    [post(ok({ command: 'set_rule', target: 'usgs', expected_revision: 0, payload: { rule: 'loose' } })), 422, 'invalid_payload'],
    [post(ok({ payload: [] })), 422, 'invalid_payload']
  ];
  for (const [request, status, reason] of cases) {
    const f = fake();
    const r = await run(request, f); const b = await r.json();
    assert.equal(r.status, status, reason); assert.equal(b.reason, reason, `${reason}: ${JSON.stringify(b)}`);
    assert.equal(f.calls.length, 0, `${reason}: no store call`);
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
  }
  /* set_rule without a rule is the D7 default (the store stores it); with one it carries it */
  for (const payload of [undefined, {}, { rule: { min_magnitude: 5, include_automatic: false, significance_above: null, pager_alert: true, tsunami: true } }]) {
    const f = fake({ store: () => receiptOf('set_rule', { target_kind: 'provider', target: 'usgs' }) });
    const r = await run(post(ok({ command: 'set_rule', target: 'usgs', expected_revision: 0, payload })), f);
    assert.equal(r.status, 200); assert.deepEqual(f.calls[0].body.p_payload, payload || {});
  }
});

test('every SQLSTATE of the owner command is one fixed answer; store text never reaches the owner; anything else is an unknown outcome', async () => {
  const expected = {
    '42501': [403, 'owner_required'], '22023': [422, 'invalid'], '40001': [409, 'revision_conflict'], '55P03': [503, 'store_busy'], '57014': [503, 'store_busy'],
    EUE01: [409, 'provider_not_configured'], EUE03: [404, 'not_found'], EUE04: [409, 'invalid_transition'], EUE06: [409, 'idempotency_conflict'],
    EUE07: [422, 'provider_not_supported'], PGRST202: [503, 'store_not_applied'], '42883': [503, 'store_not_applied']
  };
  assert.deepEqual(Object.fromEntries(Object.entries(ENVIRONMENT_STORE_ERRORS).map(([k, v]) => [k, [...v]])), expected);
  for (const [code, [status, reason]] of Object.entries(expected)) {
    const r = await run(post(ok()), fake({ store: () => storeError(code, 'database text that must not reach the owner', 400) }));
    const b = await r.json();
    assert.equal(r.status, status, code); assert.equal(b.reason, reason, code);
    assert.doesNotMatch(JSON.stringify(b), /database text/, code);
  }
  const unknown = [() => storeError('XX000'), () => storeError('PGRST000'), () => { throw new TypeError('network'); }, () => new Response(null, { status: 307, headers: { location: 'https://x.invalid' } }),
    () => ({ ok: true }), () => receiptOf('hold', { schema: 'other' }), () => receiptOf('hold', { changed: 'yes' }), () => new Response('not json', { status: 200 })];
  for (const store of unknown) {
    const r = await run(post(ok()), fake({ store }));
    assert.equal(r.status, 503); assert.equal((await r.json()).reason, 'storage_unavailable');
  }
  const none = await handleEup(post(ok()), {}, { requireHouseOwner: owner, fetchImpl: fake().fetchImpl });
  assert.equal(none.status, 503, 'no store configured: unavailable, never a guess');
});

test('the same key and the same command answer the store\'s stored receipt unchanged (the store replays it)', async () => {
  const stored = receiptOf('hold');
  const seen = new Map();
  const f = fake({ store: (name, body) => { if (!seen.has(body.p_key)) seen.set(body.p_key, stored); return seen.get(body.p_key); } });
  const first = await (await run(post(ok()), f)).json();
  const again = await (await run(post(ok()), f)).json();
  assert.deepEqual(first.receipt, again.receipt);
  assert.equal(f.calls[0].body.p_key, f.calls[1].body.p_key);
});

/* ---------------------------------------------------------------- the per-source rule */
test('off, outage, no data and reporting per surface, per provider and for the public', () => {
  const rec = (status, reason = null) => ({ id: 'x', label: 'x', status, reason, fetched_at: null, last_success_at: null });
  assert.deepEqual(surfaceState([rec('available')], 3), { state: 'reporting', reason: null });
  assert.deepEqual(surfaceState([rec('available')], 0), { state: 'no_data', reason: null });
  assert.deepEqual(surfaceState([rec('unavailable', 'not_configured'), rec('unavailable', 'not_configured')], 0), { state: 'off', reason: 'not_configured' });
  assert.deepEqual(surfaceState([rec('unavailable', 'timeout')], 0), { state: 'outage', reason: 'timeout' });
  assert.deepEqual(surfaceState([rec('stale', 'upstream_error')], 7), { state: 'outage', reason: 'stale' }, 'a kept copy is still an outage of the provider');
  assert.deepEqual(surfaceState([rec('available'), rec('unavailable', 'invalid_data')], 4), { state: 'outage', reason: 'invalid_data' });
  assert.deepEqual(surfaceState([], 0), { state: 'outage', reason: 'no_answer' });
  assert.deepEqual(surfaceState([rec('available')], null), { state: 'outage', reason: 'unreadable' });
  const s = (state, reason = null) => ({ state, reason });
  assert.deepEqual(providerState([s('off', 'not_configured')]), s('off', 'not_configured'));
  assert.deepEqual(providerState([s('reporting'), s('outage', 'timeout')]), s('outage', 'timeout'));
  assert.deepEqual(providerState([s('no_data'), s('no_data')]), s('no_data'));
  assert.deepEqual(providerState([s('no_data'), s('reporting')]), s('reporting'));
  const on = { gate: 'on', installed: true }, off = { gate: 'off', installed: false }, disabled = { gate: 'off', installed: true }, down = { gate: 'outage', installed: null };
  assert.deepEqual(publicState(off, s('reporting')), s('off', 'module_not_installed'));
  assert.deepEqual(publicState(disabled, s('reporting')), s('off', 'module_disabled'));
  assert.deepEqual(publicState(down, s('reporting')), s('outage', 'module_policy_unreadable'));
  assert.deepEqual(publicState(on, s('no_data')), s('no_data'));
  assert.deepEqual(publicState(on, s('off', 'not_configured')), s('off', 'not_configured'));
  assert.deepEqual(storeProvider(providerRow('usgs')).state, 'not_configured');
  assert.deepEqual(storeProvider(providerRow('usgs', { configured: true, ingest: 'paused' })).state, 'paused');
  assert.deepEqual(storeProvider(providerRow('usgs', { configured: true, ingest: 'active' })).state, 'never_run');
  for (const [status, state] of [['ok', 'ok'], ['empty', 'no_data'], ['unavailable', 'outage'], ['paused', 'paused']]) {
    assert.equal(storeProvider(providerRow('usgs', { configured: true, ingest: 'active', last_run: { status } })).state, state, status);
  }
  assert.deepEqual(LIVE_SURFACES.map((x) => x.id), ['feed:usgs', 'feed:nws', 'layer:alerts', 'feed:nhc', 'feed:eonet', 'layer:eonet', 'layer:fires', 'layer:perimeters', 'layer:tides']);
  assert.ok(GOVERNMENT_PROVIDERS.every((p) => LIVE_SURFACES.some((x) => x.provider === p)), 'every provider has at least one live surface');
  assert.equal(receiptShape({ ...receiptOf(), extra: 'dropped' }).extra, undefined);
});
