/* MISSION-GATED CCTV (owner, 2026-10-15): only a signed-in member who
   acknowledged the current Privacy Policy (location consent IS that
   acknowledgement) and completed an admin-verified, non-clip mission gets the
   camera list or a frame. Each check failing on its own; the proxy's server-to-server
   header; nothing leaks to anyone not eligible; never a fallback frame
   presented as live. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWorldCctv, resetRateLimits, cleanSource, LIMITS, HALO_DEFAULT_BASE, PRIVACY_VERSION, privacyAcknowledged } from '../src/world-cctv.js';
import { readFile, readdir } from 'node:fs/promises';
import { workersFetch } from './support/workers-fetch-semantics.mjs';

const UID = '11111111-1111-4111-8111-111111111111';
const ASSIGN = '22222222-2222-4222-8222-222222222222';
const MISSION = '33333333-3333-4333-8333-333333333333';
const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key', ALLOWED_ORIGINS: 'https://mccluster.org', HALO_INTERNAL_TOKEN: 'halo-secret-value' };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const req = (path, { token = 'member-token', method = 'GET', body } = {}) => new Request(`https://api.mccluster.org${path}`, {
  method, body: body ? JSON.stringify(body) : undefined,
  headers: { origin: 'https://mccluster.org', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }
});
const SOURCES = { sources: [
  { id: 'austin-1', name: 'Lamar & 5th', city: 'Austin', provider: 'City of Austin', lat: 30.27, lon: -97.75, feedType: 'image', sourceKind: 'snapshot', license: 'public', upstream: 'https://secret.example/cam1.jpg' },
  { id: 'nowhere', name: 'No position', provider: 'X', lat: null, lon: null },
  { id: 'null-island', name: 'Zero', provider: 'X', lat: 0, lon: 0 },
  { id: 'caltrans-7', name: 'I-405', provider: 'Caltrans', lat: 34.05, lon: -118.4 },
  { id: 'streetview-cam', name: 'Fallback', provider: 'Y', lat: 40.7, lon: -74 },
  { id: 'synthetic-cam', name: 'Synthetic', provider: 'Z', lat: 51.5, lon: -0.12 }
] };

/* one world: who the user is, what the database holds, and what Halo answers */
const ACK = { privacy_policy_version: '2026-09-26', privacy_acknowledged_at: '2026-10-01T00:00:00Z' };
function world({ user = true, privacy = 'current', assignment = 'verified', halo = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url instanceof Request ? url.url : url);
    const headers = new Headers(init.headers || {});
    calls.push({ url: u, method: init.method || 'GET', headers, body: init.body });
    if (u === 'https://sb.test/auth/v1/user') {
      const meta = privacy === 'current' ? ACK : privacy === 'old' ? { ...ACK, privacy_policy_version: '2026-01-01' } : privacy === 'no-date' ? { privacy_policy_version: PRIVACY_VERSION } : {};
      return user && headers.get('authorization') === 'Bearer member-token' ? json({ id: UID, user_metadata: meta }) : json({ msg: 'bad jwt' }, 401);
    }
    if (u.includes('world_location_consents') || u.includes('location-consent')) throw new Error('no location-consent table or route any more: ' + u);
    if (u.startsWith('https://sb.test/rest/v1/action_proofs') || u.startsWith('https://sb.test/rest/v1/action_missions')) throw new Error('the canonical definition reads assignments only: ' + u);
    if (u.startsWith('https://sb.test/rest/v1/action_mission_assignments')) {
      /* THE predicate (PR #444, action_member_verified_mission_count): a verified assignment on a non-clip mission */
      assert.match(u, /status=eq\.verified/); assert.match(u, new RegExp(`user_id=eq\\.${UID}`));
      assert.match(u, /select=id,action_missions!inner\(kind\)&action_missions\.or=\(kind\.is\.null,kind\.neq\.clip\)/);
      return json(assignment === 'verified' ? [{ id: ASSIGN }] : []);
    }
    if (u.startsWith('https://prime.mccluster.org/api/cctv/sources')) {
      if (halo.redirect) return new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/api/cctv/sources' } });
      return halo.sourcesStatus ? json({ error: 'x' }, halo.sourcesStatus) : json(SOURCES);
    }
    if (u.startsWith('https://prime.mccluster.org/api/cctv/frame/')) {
      const id = decodeURIComponent(u.split('/').pop());
      if (id === 'streetview-cam') return new Response('jpeg', { headers: { 'content-type': 'image/jpeg', 'x-cctv-source': 'streetview' } });
      if (id === 'synthetic-cam') return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'x-cctv-source': 'synthetic' } });
      return new Response('JPEGBYTES', { headers: { 'content-type': 'image/jpeg', 'x-cctv-source': 'upstream-image', 'last-modified': 'Thu, 15 Oct 2026 19:00:00 GMT', date: 'Thu, 15 Oct 2026 19:00:05 GMT', 'set-cookie': 'leak=1' } });
    }
    throw new Error('unexpected fetch ' + u);
  };
  return { fetchImpl, calls, haloCalls: () => calls.filter((c) => c.url.startsWith('https://prime.mccluster.org')) };
}

test.beforeEach(() => resetRateLimits());

test('only its own routes; everything else is null', async () => {
  const { fetchImpl } = world();
  assert.equal(await handleWorldCctv(req('/v1/world/cctv/other'), ENV, { fetchImpl }), null);
  assert.equal(await handleWorldCctv(req('/v1/world/layers/flights'), ENV, { fetchImpl }), null);
  assert.equal(HALO_DEFAULT_BASE, 'https://prime.mccluster.org');
});

test('eligibility: all three checks pass for a member who acknowledged the privacy policy and has a verified mission', async () => {
  const { fetchImpl } = world();
  const r = await handleWorldCctv(req('/v1/world/cctv/eligibility'), ENV, { fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.match(r.headers.get('vary'), /authorization/);
  const body = await r.json();
  assert.deepEqual(body.checks, { signed_in: true, privacy_acknowledged: true, mission_completed: true });
  assert.equal(body.eligible, true); assert.equal(body.reason, null);
  assert.equal(body.privacy_version, PRIVACY_VERSION);
  assert.equal(body.approximate_location.source, 'ip_approximate');
  assert.equal(body.consent_store, undefined);
});

const MATRIX = [
  ['signed out', { user: false }, { signed_in: false, privacy_acknowledged: false, mission_completed: false }, 'sign_in_required', 401],
  ['no privacy acknowledgement on record', { privacy: 'none' }, { signed_in: true, privacy_acknowledged: false, mission_completed: true }, 'privacy_acknowledgement_required', 403],
  ['an older privacy version', { privacy: 'old' }, { signed_in: true, privacy_acknowledged: false, mission_completed: true }, 'privacy_acknowledgement_required', 403],
  ['a version but no acknowledgement time', { privacy: 'no-date' }, { signed_in: true, privacy_acknowledged: false, mission_completed: true }, 'privacy_acknowledgement_required', 403],
  ['no verified non-clip mission (joined, submitted, rejected or clip only)', { assignment: 'submitted' }, { signed_in: true, privacy_acknowledged: true, mission_completed: false }, 'mission_required', 403]
];

for (const [name, opts, checks, reason, status] of MATRIX) {
  test(`eligibility matrix: ${name}`, async () => {
    const w = world(opts);
    const tokenless = opts.user === false;
    const e = await handleWorldCctv(req('/v1/world/cctv/eligibility', { token: tokenless ? null : 'member-token' }), ENV, { fetchImpl: w.fetchImpl });
    const body = await e.json();
    assert.deepEqual(body.checks, checks); assert.equal(body.eligible, false); assert.equal(body.reason, reason);

    /* and nothing leaks: no list, no frame, no call to Halo */
    resetRateLimits();
    const s = await handleWorldCctv(req('/v1/world/cctv/sources', { token: tokenless ? null : 'member-token' }), ENV, { fetchImpl: w.fetchImpl });
    assert.equal(s.status, status);
    assert.equal(s.headers.get('cache-control'), 'private, no-store');
    const sb = await s.json();
    assert.equal(sb.sources, undefined); assert.equal(sb.detail.reason, reason);
    const f = await handleWorldCctv(req('/v1/world/cctv/frame/austin-1', { token: tokenless ? null : 'member-token' }), ENV, { fetchImpl: w.fetchImpl });
    assert.equal(f.status, status);
    assert.match(f.headers.get('content-type'), /application\/json/);
    assert.equal(w.haloCalls().length, 0, 'Halo is never asked on behalf of someone not eligible');
  });
}

test('sources: proxied with the internal header (never the member bearer), trimmed, no 0,0 and no positionless cameras', async () => {
  const w = world();
  const r = await handleWorldCctv(req('/v1/world/cctv/sources'), ENV, { fetchImpl: w.fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  const body = await r.json();
  const ids = body.sources.map((s) => s.id);
  assert.deepEqual(ids, ['austin-1', 'caltrans-7', 'streetview-cam', 'synthetic-cam']);
  assert.equal(body.upstream_total, 6); assert.equal(body.dropped_without_position, 2);
  assert.equal(body.sources[0].upstream, undefined, 'Halo internals never leave');
  const [call] = w.haloCalls();
  assert.equal(call.url, 'https://prime.mccluster.org/api/cctv/sources');
  assert.equal(call.headers.get('x-halo-internal'), 'halo-secret-value');
  assert.equal(call.headers.get('authorization'), null, 'the member bearer is not forwarded');
});

test('HALO_API_BASE overrides the default; a non-https base is refused', async () => {
  const w = world();
  const env = { ...ENV, HALO_API_BASE: 'https://halo.internal.example/' };
  const fetchImpl = async (url, init) => String(url).startsWith('https://halo.internal.example/api/cctv/sources') ? json(SOURCES) : w.fetchImpl(url, init);
  assert.equal((await handleWorldCctv(req('/v1/world/cctv/sources'), env, { fetchImpl })).status, 200);
  resetRateLimits();
  const bad = await handleWorldCctv(req('/v1/world/cctv/sources'), { ...ENV, HALO_API_BASE: 'http://insecure.example' }, { fetchImpl: w.fetchImpl });
  assert.equal(bad.status, 502);
});

test('without HALO_INTERNAL_TOKEN an eligible member gets 503 and Halo is not called', async () => {
  const w = world();
  const env = { ...ENV }; delete env.HALO_INTERNAL_TOKEN;
  const r = await handleWorldCctv(req('/v1/world/cctv/sources'), env, { fetchImpl: w.fetchImpl });
  assert.equal(r.status, 503); assert.equal((await r.json()).detail.reason, 'halo_not_configured');
  assert.equal(w.haloCalls().length, 0);
});

test('frame: a live upstream snapshot passes through with provider, time and media type, privately', async () => {
  const w = world();
  const r = await handleWorldCctv(req('/v1/world/cctv/frame/austin-1'), ENV, { fetchImpl: w.fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'JPEGBYTES');
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal(r.headers.get('x-cctv-source'), 'upstream-image');
  assert.equal(r.headers.get('x-cctv-provider'), 'City of Austin');
  assert.equal(r.headers.get('last-modified'), 'Thu, 15 Oct 2026 19:00:00 GMT');
  assert.equal(r.headers.get('x-cctv-upstream-date'), 'Thu, 15 Oct 2026 19:00:05 GMT');
  assert.ok(Date.parse(r.headers.get('x-cctv-retrieved-at')));
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(r.headers.get('set-cookie'), null, 'only allowlisted headers pass');
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://mccluster.org');
  assert.match(r.headers.get('access-control-expose-headers'), /x-cctv-provider/);
  const frameCall = w.haloCalls().find((c) => c.url.includes('/frame/'));
  assert.equal(frameCall.headers.get('x-halo-internal'), 'halo-secret-value');
});

test('frame: Street View and synthetic fallbacks are never shown as live', async () => {
  for (const id of ['streetview-cam', 'synthetic-cam']) {
    resetRateLimits();
    const w = world();
    const r = await handleWorldCctv(req('/v1/world/cctv/frame/' + id), ENV, { fetchImpl: w.fetchImpl });
    assert.equal(r.status, 502, id);
    const body = await r.json();
    assert.equal(body.detail.reason, 'no_live_frame');
  }
});

test('frame: an id that is not in the catalogue, or malformed, is 404 without asking Halo for it', async () => {
  const w = world();
  for (const id of ['unknown-cam', '..%2F..%2Fapi%2Fruntime-config', 'null-island']) {
    const r = await handleWorldCctv(req('/v1/world/cctv/frame/' + id), ENV, { fetchImpl: w.fetchImpl });
    assert.equal(r.status, 404, id);
  }
  assert.equal(w.haloCalls().filter((c) => c.url.includes('/frame/')).length, 0);
});

test('rate limits per member: the sources list refuses past its window with retry-after', async () => {
  const w = world();
  let last;
  for (let n = 0; n <= LIMITS.sources; n++) last = await handleWorldCctv(req('/v1/world/cctv/sources'), ENV, { fetchImpl: w.fetchImpl });
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) >= 1);
  assert.equal(last.headers.get('cache-control'), 'private, no-store');
});

test('there is no location-consent route or table: the privacy acknowledgement is the consent', async () => {
  const w = world();
  for (const m of ['POST', 'DELETE', 'GET']) assert.equal(await handleWorldCctv(req('/v1/world/location-consent', { method: m }), ENV, { fetchImpl: w.fetchImpl }), null);
  const src = await readFile(new URL('../src/world-cctv.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /world_location_consents/);
  assert.equal(privacyAcknowledged({ user_metadata: ACK }), true);
  assert.equal(privacyAcknowledged({ user_metadata: { ...ACK, privacy_acknowledged_at: 'not a date' } }), false);
  assert.equal(privacyAcknowledged(null), false);
});

test("PRIVACY_VERSION is the site gate's version (js/live-content.js, js/analytics.js, js/action.js)", async () => {
  const gate = await readFile(new URL('../../../js/live-content.js', import.meta.url), 'utf8');
  const analytics = await readFile(new URL('../../../js/analytics.js', import.meta.url), 'utf8');
  const join = await readFile(new URL('../../../js/action.js', import.meta.url), 'utf8');
  assert.match(gate, new RegExp(`var VERSION = "${PRIVACY_VERSION}"`));
  assert.match(analytics, new RegExp(`MCC_PRIVACY_REQUIRED_VERSION = "${PRIVACY_VERSION}"`));
  assert.match(join, new RegExp(`privacy_policy_version: "${PRIVACY_VERSION}"`));
  assert.match(join, /privacy_acknowledged_at: new Date\(\)\.toISOString\(\)/);
});

test('cleanSource never invents a position', () => {
  assert.equal(cleanSource({ id: 'a', lat: 0, lon: 0 }), null);
  assert.equal(cleanSource({ id: 'a', lat: '', lon: '' }), null);
  assert.equal(cleanSource({ id: 'a', lat: 91, lon: 0 }), null);
  assert.equal(cleanSource({ id: 'bad id', lat: 1, lon: 1 }), null);
  assert.deepEqual(cleanSource({ id: 'a', lat: '1.5', lon: '2.5', upstream: 'https://x' }), { id: 'a', lat: 1.5, lon: 2.5 });
  /* the coordinate bug: a missing latitude (or longitude) used to become 0 and put the camera on the equator */
  assert.equal(cleanSource({ id: 'a', lat: null, lon: -97.75 }), null);
  assert.equal(cleanSource({ id: 'a', lat: 30.27, lon: null }), null);
  assert.equal(cleanSource({ id: 'a', lat: '', lon: -97.75 }), null);
  assert.equal(cleanSource({ id: 'a', lat: false, lon: -97.75 }), null);
  assert.deepEqual(cleanSource({ id: 'austin', lat: 30.27, lon: -97.75 }), { id: 'austin', lat: 30.27, lon: -97.75 }, 'lat stays lat, lon stays lon');
});

test('the Worker routes /v1/world/cctv/* through this module (index.js answers every preflight first)', async () => {
  const src = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ handleWorldCctv \} from '\.\/world-cctv\.js'/);
  assert.match(src, /if \(path\.startsWith\('\/v1\/world\/cctv\/'\)\) \{/);
  assert.doesNotMatch(src, /location-consent/);
  assert.ok(src.indexOf("request.method === 'OPTIONS'") < src.indexOf('handleWorldCctv(request'), 'the preflight is answered before the gate');
});

test('eligibility is re-checked on every request: a revoked proof stops the very next frame', async () => {
  let assignment = 'verified';
  const base = world();
  const fetchImpl = async (url, init) => {
    if (String(url).startsWith('https://sb.test/rest/v1/action_mission_assignments')) return world({ assignment }).fetchImpl(url, init);
    return base.fetchImpl(url, init);
  };
  assert.equal((await handleWorldCctv(req('/v1/world/cctv/frame/austin-1'), ENV, { fetchImpl })).status, 200);
  assignment = 'rejected';
  const r = await handleWorldCctv(req('/v1/world/cctv/frame/austin-1'), ENV, { fetchImpl });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).detail.reason, 'mission_required');
});

test("under Workers fetch semantics an eligible member gets the list and a frame (redirect: 'manual', never 'error')", async () => {
  const w = world();
  const fetchImpl = workersFetch((url, init) => w.fetchImpl(url.toString(), init));
  const s = await handleWorldCctv(req('/v1/world/cctv/sources'), ENV, { fetchImpl });
  assert.equal(s.status, 200, 'workerd would throw on redirect: error and this would be a 502');
  const f = await handleWorldCctv(req('/v1/world/cctv/frame/austin-1'), ENV, { fetchImpl });
  assert.equal(f.status, 200);
  const haloInits = fetchImpl.calls.filter((c) => c.url.startsWith('https://prime.mccluster.org')).map((c) => c.init.redirect);
  assert.ok(haloInits.length >= 2 && haloInits.every((r) => r === 'manual'), JSON.stringify(haloInits));
});

test('a Halo redirect is a typed failure and is never followed', async () => {
  const w = world({ halo: { redirect: true } });
  const fetchImpl = workersFetch((url, init) => w.fetchImpl(url.toString(), init));
  const r = await handleWorldCctv(req('/v1/world/cctv/sources'), ENV, { fetchImpl });
  assert.equal(r.status, 502);
  assert.equal((await r.json()).detail.reason, 'halo_redirect');
  assert.equal(fetchImpl.calls.filter((c) => c.url.startsWith('https://elsewhere.example')).length, 0);
});

test('Halo refusing the internal header (401) is a 502 to the member, with nothing of Halo\'s passed on', async () => {
  const w = world({ halo: { sourcesStatus: 401 } });
  const r = await handleWorldCctv(req('/v1/world/cctv/sources'), ENV, { fetchImpl: w.fetchImpl });
  assert.equal(r.status, 502);
  const body = await r.json();
  assert.equal(body.detail.reason, 'halo_unavailable');
  assert.equal(JSON.stringify(body).includes('halo-secret-value'), false);
});

test('the frame route is read by fetch() with the bearer and shown from a blob URL; no token ever rides in a URL', async () => {
  const page = await readFile(new URL('../../../js/action-globe.js', import.meta.url), 'utf8');
  assert.match(page, /cctvFetch\('\/v1\/world\/cctv\/frame\/'\+encodeURIComponent\(id\)/);
  assert.match(page, /URL\.createObjectURL\(blob\)/);
  assert.match(page, /URL\.revokeObjectURL\(cctv\.url\)/);
  assert.doesNotMatch(page, /cctv\/frame\/[^'"]*\?(token|access_token|sig)=/);
});
