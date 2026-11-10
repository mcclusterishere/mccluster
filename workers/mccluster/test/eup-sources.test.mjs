import test from 'node:test';
import assert from 'node:assert/strict';
import { handleEup, EUP_PREFIX } from '../src/eup/router.js';
import { sourcesSummary, listSources } from '../src/eup/sources.js';
import { FEED_REGISTRY } from '../src/eup/registry.js';
import { asWorkerFetch } from './support/eup-league-storage-double.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'server-secret', ALLOWED_ORIGINS: 'https://matthew.mccluster.org' };
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
const owner = async () => ({ id: OWNER });

function fake({ states = [], review = { items: [], corrections: [] }, runs = [], civic = null, command = (a, p) => ({ action: a, params: p }), storageDown = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url); const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: u, body });
    if (storageDown) throw new Error('offline');
    if (u.includes('/rest/v1/civic_source_registry')) return civic ? json(civic) : json({ message: 'denied' }, 403);
    if (u.includes('/rpc/eup_sources_read')) return json(body.p_action === 'list' ? states : body.p_action === 'review' ? review : runs);
    if (u.includes('/rpc/eup_sources_command')) { const out = command(body.p_action, body.p_params, body.p_actor); return out instanceof Response ? out : json(out); }
    throw new Error(`unexpected ${u}`);
  };
  return { fetchImpl, calls };
}
const call = (path, f, init = {}) => handleEup(new Request(`https://api.mccluster.org${EUP_PREFIX}/sources${path}`, init), env, { requireHouseOwner: owner, fetchImpl: f.fetchImpl, now: () => Date.parse('2026-11-09T12:00:00Z') });
const post = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('every registered source lists as not configured; held sources are held; nothing is ingesting', async () => {
  const f = fake({ civic: [{ source_key: 'congress_gov', enabled: false, last_checked_at: null }] });
  const r = await call('', f); const b = await r.json();
  assert.equal(r.status, 200); assert.equal(b.sources.length, FEED_REGISTRY.length);
  assert.ok(b.sources.every((s) => s.configured === false && s.availability === 'unavailable' && s.records === null));
  for (const id of ['openfec', 'market_prices', 'legiscan_secondary', 'congressional_financial_disclosures']) assert.equal(b.sources.find((s) => s.id === id).access, 'held');
  assert.equal(b.sources.find((s) => s.id === 'congress_gov').civic_registry.enabled, false);
  assert.equal(b.ingestion_enabled, false); assert.equal(b.retired_dependencies.length, 2);
  assert.doesNotMatch(JSON.stringify(b), /server-secret/);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
});

test('storage outage lists sources as unknown, not as zero records or as disabled', async () => {
  const f = fake({ storageDown: true });
  const r = await call('', f); const b = await r.json();
  assert.equal(r.status, 200); assert.equal(b.storage, 'unavailable'); assert.equal(b.civic_registry, 'unavailable');
  assert.ok(b.sources.every((s) => s.records === null && s.last_success_at === null));
});

test('refresh answers 503 not_configured for every source before any command is sent', async () => {
  for (const feed of FEED_REGISTRY) {
    const f = fake();
    const r = await call(`/${feed.id}/refresh`, f, post({ idempotency_key: 'refresh-0001' }));
    assert.equal(r.status, feed.access === 'held' ? 403 : 503, feed.id);
    assert.ok(!f.calls.some((c) => c.url.includes('eup_sources_command')), `${feed.id} must not queue a run`);
  }
});

test('approved + configured + binding present queues one bounded run; a repeat with the same key replays it', async () => {
  const seen = [];
  const f = fake({ states: [{ source_id: 'sec_edgar', configured: true, access: 'approved', paused: false }], command: (a, p) => { seen.push(p.idempotency_key); return { run_id: 'run-1', status: 'queued', created: seen.length === 1 }; } });
  const e2 = { ...env, SEC_USER_AGENT: 'McCluster test agent' };
  const go = () => handleEup(new Request(`https://api.mccluster.org${EUP_PREFIX}/sources/sec_edgar/refresh`, post({ idempotency_key: 'refresh-0001' })), e2, { requireHouseOwner: owner, fetchImpl: f.fetchImpl, now: Date.now });
  const a = await (await go()).json(); const b = await (await go()).json();
  assert.equal(a.run_id, 'run-1'); assert.equal(a.created, true); assert.equal(b.created, false); assert.equal(a.bounded, true);
  assert.deepEqual(seen, ['refresh-0001', 'refresh-0001']);
  const missingBinding = await handleEup(new Request(`https://api.mccluster.org${EUP_PREFIX}/sources/sec_edgar/refresh`, post({ idempotency_key: 'refresh-0002' })), env, { requireHouseOwner: owner, fetchImpl: f.fetchImpl, now: Date.now });
  assert.equal(missingBinding.status, 503); assert.equal((await missingBinding.json()).reason, 'not_configured');
  const badKey = await handleEup(new Request(`https://api.mccluster.org${EUP_PREFIX}/sources/sec_edgar/refresh`, post({ idempotency_key: 'x' })), e2, { requireHouseOwner: owner, fetchImpl: f.fetchImpl, now: Date.now });
  assert.equal(badKey.status, 400);
});

test('pause and resume go to the store; review lists items and a correction needs key and revision', async () => {
  const f = fake({ review: { items: [{ id: 'i1', kind: 'geography', status: 'open', revision: 1 }], corrections: [] }, command: (a, p) => a === 'correct' ? { correction_id: 'c1', review_item_id: p.review_item_id, revision: 2, status: 'resolved', replayed: false } : { source_id: p.source_id, paused: a === 'pause', revision: 2 } });
  assert.equal((await (await call('/gleif/pause', f, { method: 'POST' })).json()).paused, true);
  assert.equal((await (await call('/gleif/resume', f, { method: 'POST' })).json()).paused, false);
  const review = await (await call('/review', f)).json(); assert.equal(review.items.length, 1);
  const c = await call('/review/i1/correct', f, post({ idempotency_key: 'correct-0001', expected_revision: 1, correction: { parent_external_id: 'ct-bridgeport' } }));
  assert.equal(c.status, 200); assert.equal((await c.json()).status, 'resolved');
  assert.equal((await call('/review/i1/correct', f, post({ expected_revision: 1 }))).status, 400);
  assert.equal((await call('/review?status=weird', f)).status, 400);
  assert.equal((await call('/nope', f)).status, 404);
});

test('store conflicts and not-found map to 409 and 404 without leaking the store', async () => {
  const f = fake({ command: () => json({ message: 'revision_conflict', code: 'P0001' }, 400) });
  const r = await call('/review/i1/correct', f, post({ idempotency_key: 'correct-0001', expected_revision: 1 }));
  assert.equal(r.status, 409); assert.equal((await r.json()).reason, 'revision_conflict');
  const g = fake({ command: () => json({ message: 'review_item_not_found', code: 'P0002' }, 400) });
  assert.equal((await call('/review/i2/correct', g, post({ idempotency_key: 'correct-0002', expected_revision: 1 }))).status, 404);
});

// Module policy: refresh, resume and correct are guarded writes of module intake. The store refuses them in
// its own transaction (supabase/pending/eup_module_policy_v1.sql); the Worker says which refusal it was.
const refusal = (code, message) => json({ code, message, details: null, hint: null }, 400);
const READY = { states: [{ source_id: 'sec_edgar', configured: true, access: 'approved', paused: false }] };
const withAgent = (path, f, init) => handleEup(new Request(`https://api.mccluster.org${EUP_PREFIX}/sources${path}`, init), { ...env, SEC_USER_AGENT: 'McCluster test agent' }, { requireHouseOwner: owner, fetchImpl: f.fetchImpl, now: () => Date.parse('2026-11-09T12:00:00Z') });

test('a guarded intake write refused by module policy answers the shared module reasons, not storage_unavailable', async () => {
  const table = [
    ['EUM00', 'module_policy_unavailable', 503, 'module_policy_unavailable'], ['EUM01', 'module_not_installed', 503, 'module_not_installed'],
    ['42883', 'function public.eup_module_guard(unknown) does not exist', 503, 'module_not_installed'],
    ['EUM02', 'module_draining', 503, 'module_draining'], ['EUM03', 'module_disabled', 409, 'module_disabled'], ['EUM04', 'module_policy_changed', 409, 'module_policy_changed'],
    ['55P03', 'canceling statement due to lock timeout', 503, 'module_busy'], ['57014', 'canceling statement due to statement timeout', 503, 'module_busy']
  ];
  for (const [code, message, status, reason] of table) {
    const writes = [
      ['refresh', (f) => withAgent('/sec_edgar/refresh', f, post({ idempotency_key: 'refresh-0001' }))],
      ['resume', (f) => call('/gleif/resume', f, { method: 'POST' })],
      ['correct', (f) => call('/review/i1/correct', f, post({ idempotency_key: 'correct-0001', expected_revision: 1 }))]
    ];
    for (const [label, go] of writes) {
      const f = fake({ ...READY, command: () => refusal(code, message) });
      const r = await go(f); const b = await r.json();
      assert.equal(r.status, status, `${code} ${label}`); assert.equal(b.reason, reason, `${code} ${label}`); assert.equal(b.ok, false);
      assert.doesNotMatch(JSON.stringify(b), /server-secret|does not exist|canceling statement/, `${code} ${label}`);
      assert.equal(f.calls.filter((c) => c.url.includes('eup_sources_command')).length, 1, `${code} ${label}: one attempt, no retry`);
    }
  }
});

test('refresh while the intake module is draining queues nothing and says module_draining; pause still goes through', async () => {
  const f = fake({ ...READY, command: (action, params) => action === 'pause' ? { source_id: params.source_id, paused: true, revision: 2 } : refusal('EUM02', 'module_draining') });
  const refresh = await withAgent('/sec_edgar/refresh', f, post({ idempotency_key: 'refresh-0001' }));
  assert.equal(refresh.status, 503); assert.deepEqual(await refresh.json(), { ok: false, error: 'The intake module is draining', reason: 'module_draining' });
  const pause = await call('/sec_edgar/pause', f, { method: 'POST' });
  assert.equal(pause.status, 200); assert.equal((await pause.json()).paused, true);
  /* the rights and configuration gate still decides first: an unconfigured source never reaches the store */
  const g = fake({ command: () => refusal('EUM02', 'module_draining') });
  const unconfigured = await call('/sec_edgar/refresh', g, post({ idempotency_key: 'refresh-0002' }));
  assert.equal(unconfigured.status, 503); assert.equal((await unconfigured.json()).reason, 'not_configured');
  assert.ok(!g.calls.some((c) => c.url.includes('eup_sources_command')));
});

test('reads are never module refusals: a slow or broken read is storage, and the registry still lists', async () => {
  for (const [code, message] of [['57014', 'canceling statement due to statement timeout'], ['55P03', 'canceling statement due to lock timeout'], ['42883', 'function does not exist']]) {
    const f = fake();
    const fetchImpl = async (url, opts) => String(url).includes('/rpc/eup_sources_read') ? refusal(code, message) : f.fetchImpl(url, opts);
    const list = await call('', { fetchImpl }); const b = await list.json();
    assert.equal(list.status, 200, code); assert.equal(b.storage, 'unavailable', code); assert.ok(b.sources.every((s) => s.records === null));
    const review = await call('/review', { fetchImpl });
    assert.equal(review.status, 503, code); assert.equal((await review.json()).reason, 'storage_unavailable', code);
  }
});

test('sourcesSummary gives the overview one honest status line per source', async () => {
  const f = fake({ states: [{ source_id: 'gleif', configured: true, access: 'approved', last_success_at: '2026-11-08T00:00:00Z', records: 12 }] });
  const rows = await sourcesSummary(env, { fetchImpl: f.fetchImpl, now: () => Date.parse('2026-11-09T12:00:00Z') });
  assert.equal(rows.length, FEED_REGISTRY.length);
  assert.deepEqual(rows.find((r) => r.source === 'gleif'), { source: 'gleif', status: 'available', fetched_at: '2026-11-08T00:00:00Z', upstream_updated_at: null, storage: 'available' });
  assert.equal(rows.find((r) => r.source === 'openfec').status, 'held');
  assert.equal(rows.find((r) => r.source === 'sec_edgar').status, 'not_configured');
  const stale = await listSources(env, { fetchImpl: fake({ states: [{ source_id: 'gleif', configured: true, access: 'approved', last_success_at: '2026-10-01T00:00:00Z', records: 12 }] }).fetchImpl, now: () => Date.parse('2026-11-09T12:00:00Z') });
  assert.equal(stale.sources.find((s) => s.id === 'gleif').availability, 'stale');
  assert.equal(stale.sources.find((s) => s.id === 'gleif').records, 12, 'stale data stays visible, not zeroed');
});

test('the civic registry is read with the Worker runtime\'s fetch: called bare, never as a method of ctx', async () => {
  /* The Worker's fetch refuses a foreign `this` ("Illegal invocation"); a plain double accepts it, which hid that
     sources.js called ctx.fetchImpl(...) as a method, so the Overview always said civic_registry 'unavailable'. */
  const f = fake({ civic: [{ source_key: 'congress_gov', enabled: true, last_checked_at: null }] });
  const r = await call('', { fetchImpl: asWorkerFetch(f.fetchImpl) });
  const b = await r.json();
  assert.equal(r.status, 200);
  assert.equal(b.civic_registry, 'available');
  assert.equal(b.sources.find((s) => s.id === 'congress_gov').civic_registry.enabled, true);
});
