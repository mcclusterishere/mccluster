/* The listen ledger and the earned record, driven through the real entry.js
 * with Supabase faked at the fetch boundary. What matters here is what the
 * Worker refuses to trust: the browser never supplies a song's length, a
 * locked listener never gets a signed URL, and a play that could not be
 * signed is handed back. The counting itself lives in SQL
 * (music_gate_claim) and is exercised against the database.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') {
      return { url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (/\.html$/.test(url)) {
      const text = readFileSync(new URL(url), 'utf8');
      return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
    }
    return next(url, context);
  }
});

const { default: entry } = await import('../src/entry.js');
const { TRACKS } = await import('../src/music/tracks.js');
const { GATES, COUNT_SHARE } = await import('../src/music/router.js');
const { __resetCapabilityCache } = await import('../src/lib/capabilities.js');

const SB = 'https://sb.test';
const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service' };
const ORIGIN = 'https://matthew.mccluster.org';

function fakeSupabase({ operator = false, claim = { claimed: false }, signStatus = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method || 'GET', body });
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (url === `${SB}/auth/v1/user`) {
      return init.headers?.authorization === 'Bearer good' ? json({ id: 'u1', email: 'fan@example.com' }) : json({}, 401);
    }
    if (url.startsWith(`${SB}/rest/v1/org_members?`)) {
      return json(operator ? [{ role: 'owner', orgs: { id: 'o1', slug: 'mccluster', name: 'McCluster', enabled: true } }] : []);
    }
    if (url.startsWith(`${SB}/rest/v1/control_role_capabilities`)) return json([{ role: 'owner', capability: 'ops.use', allowed: true }]);
    if (url === `${SB}/rest/v1/rpc/music_listen_start`) return json('11111111-1111-4111-8111-111111111111');
    if (url === `${SB}/rest/v1/rpc/music_listen_finish`) return json(true);
    if (url === `${SB}/rest/v1/rpc/music_gate_state`) return json({ distinct_songs: 2, need_first: 5, allowed: false });
    if (url === `${SB}/rest/v1/rpc/music_gate_claim`) return json(claim);
    if (url.startsWith(`${SB}/storage/v1/object/sign/`)) {
      return signStatus === 200 ? json({ signedURL: '/object/sign/mcc-gated-audio/niggy-nigg/niggy-nigg.mp3?token=t' }) : json({ error: 'x' }, signStatus);
    }
    if (url.startsWith(`${SB}/rest/v1/music_gated_plays?`) && init.method === 'DELETE') return new Response(null, { status: 204 });
    return json({ unexpected: url }, 500);
  };
  return calls;
}

function call(path, { method = 'GET', body, token = 'good' } = {}) {
  const headers = { origin: ORIGIN };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  return entry.fetch(new Request(`https://api.mccluster.org${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  }), env, {});
}

test.beforeEach(() => __resetCapabilityCache());

test('every catalogue song has a server-side length, and the gate names a real gated track', () => {
  const albums = JSON.parse(readFileSync(new URL('../../../data/albums.json', import.meta.url), 'utf8')).albums;
  for (const album of albums) {
    for (const track of album.tracks) {
      const key = track.gated ? String(track.gated.object).split('/')[0] : track.src.split('/').pop().replace(/\.[^.]+$/, '');
      assert.ok(TRACKS[key], `${track.title} (${key}) has no entry in src/music/tracks.js; run scripts/music-track-lengths.mjs`);
      if (!track.gated) assert.ok(TRACKS[key].seconds > 5, `${key} has no measured length`);
    }
  }
  for (const key of Object.keys(GATES)) assert.equal(TRACKS[key]?.gated, true, `${key} is gated on the server but not in data/albums.json`);
});

test('a listen needs a signed-in listener', async () => {
  fakeSupabase();
  const res = await call('/v1/music/listens', { method: 'POST', body: { track: 'here' }, token: null });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
});

test('the server, not the browser, sets how long a song must play to count', async () => {
  const calls = fakeSupabase();
  const res = await call('/v1/music/listens', { method: 'POST', body: { track: 'here', seconds: 1, min_seconds: 1 } });
  assert.equal(res.status, 200);
  const start = calls.find((c) => c.url.endsWith('/rpc/music_listen_start'));
  assert.equal(start.body.p_min_seconds, Math.floor(TRACKS.here.seconds * COUNT_SHARE));
  assert.equal(start.body.p_user, 'u1');
  assert.equal(start.body.p_track, 'here');
});

test('the gated record never counts toward its own gate, and unknown songs are refused', async () => {
  const calls = fakeSupabase();
  const gated = await (await call('/v1/music/listens', { method: 'POST', body: { track: 'niggy-nigg' } })).json();
  assert.equal(gated.counts, false);
  assert.equal(gated.listen_id, null);
  assert.equal((await call('/v1/music/listens', { method: 'POST', body: { track: 'not-a-song' } })).status, 404);
  assert.ok(!calls.some((c) => c.url.endsWith('/rpc/music_listen_start')));
});

test('finishing a listen reports whether it counted and the gate progress', async () => {
  fakeSupabase();
  const res = await call('/v1/music/listens/11111111-1111-4111-8111-111111111111/finish', { method: 'POST' });
  const data = await res.json();
  assert.equal(data.counted, true);
  assert.equal(data.gates['niggy-nigg'].need_first, 5);
  assert.equal((await call('/v1/music/listens/not-a-uuid/finish', { method: 'POST' })).status, 404);
});

test('a locked listener gets progress and no URL', async () => {
  const calls = fakeSupabase({ claim: { claimed: false, allowed: false, distinct_songs: 3, need_first: 5 } });
  const res = await call('/v1/music/gates/niggy-nigg/play', { method: 'POST' });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.locked, true);
  assert.equal(data.gate.distinct_songs, 3);
  assert.ok(!calls.some((c) => c.url.includes('/storage/v1/object/sign/')), 'a locked listener must never cause a signature');
});

test('an earned play gets one short-lived URL signed by the server', async () => {
  const calls = fakeSupabase({ claim: { claimed: true, play_id: 'p1', allowed: false } });
  const res = await call('/v1/music/gates/niggy-nigg/play', { method: 'POST' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.url, /^https:\/\/sb\.test\/storage\/v1\/object\/sign\/mcc-gated-audio\/niggy-nigg\/niggy-nigg\.mp3\?token=/);
  const sign = calls.find((c) => c.url.includes('/storage/v1/object/sign/'));
  assert.equal(sign.body.expiresIn, GATES['niggy-nigg'].url_seconds);
  assert.ok(GATES['niggy-nigg'].url_seconds <= 900, 'a signed link must not outlive one sitting');
});

test('a play that could not be signed is handed back', async () => {
  const calls = fakeSupabase({ claim: { claimed: true, play_id: 'p1' }, signStatus: 500 });
  const res = await call('/v1/music/gates/niggy-nigg/play', { method: 'POST' });
  assert.equal(res.status, 502);
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.includes('music_gated_plays?id=eq.p1')));
});

test('the owner plays the record without spending anything', async () => {
  const calls = fakeSupabase({ operator: true });
  const res = await call('/v1/music/gates/niggy-nigg/play', { method: 'POST' });
  assert.equal(res.status, 200);
  assert.ok(!calls.some((c) => c.url.endsWith('/rpc/music_gate_claim')));
});

test('music preflight is answered before the sign-in gate', async () => {
  fakeSupabase();
  const res = await entry.fetch(new Request('https://api.mccluster.org/v1/music/gates/niggy-nigg/play', {
    method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' }
  }), env, {});
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
});
