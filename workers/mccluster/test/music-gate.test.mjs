/* The listen ledger and the gated record, driven through the real entry.js
 * with Supabase faked at the fetch boundary. What matters here is what the
 * Worker refuses to trust: the browser never supplies a song's length, a
 * locked listener never gets a signed URL, and a play that could not be
 * signed is handed back. The counting itself lives in SQL
 * (music_gate_claim_sequence) and is exercised against the database.
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

/* What music_gate_rule_state answers (supabase/pending/gated_track_mission_identity_v1.sql),
   for a member with `have` admin-verified missions and identity verified or not. */
function ruleState(user, { have = 0, identity = false } = {}) {
  const missing = [];
  if (!user) missing.push('sign_in');
  if (have < 3) missing.push('missions');
  if (!identity) missing.push('identity_verification');
  const allowed = !!user && have >= 3 && identity;
  return {
    mode: 'rule', rule: 'gated_track_niggy_nigg', track: 'niggy-nigg', allowed, signed_in: !!user,
    missions: { have, need: 3 }, identity_verified: identity, missing,
    links: { missions: 'mnet.html?view=missions', identity: 'account.html#identity' }
  };
}

function fakeSupabase({ operator = false, claim = { claimed: false }, signStatus = 200, streamKey = 'niggy-nigg', state = {} } = {}) {
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
    if (url === `${SB}/rest/v1/rpc/music_listen_beat`) return json(45);
    if (url === `${SB}/rest/v1/rpc/music_stream_open`) return json(streamKey);
    if (url.startsWith(`${SB}/storage/v1/object/authenticated/`)) {
      return new Response('AUDIO', { status: init.headers?.range ? 206 : 200, headers: {
        'content-type': 'audio/mpeg', 'content-range': 'bytes 0-4/5', 'accept-ranges': 'bytes', 'x-secret': 'no' } });
    }
    if (url === `${SB}/rest/v1/rpc/music_gate_rule_state`) return json(ruleState(body.p_user, state));
    if (url === `${SB}/rest/v1/rpc/music_gate_claim_rule`) {
      const out = typeof claim === 'function' ? claim(body) : claim;
      return json(out);
    }
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
  assert.equal(data.gates['niggy-nigg'].mode, 'rule', 'listens no longer unlock the closer; the mission + identity rule does');
  assert.equal(data.gates['niggy-nigg'].missions.need, 3);
  assert.equal((await call('/v1/music/listens/not-a-uuid/finish', { method: 'POST' })).status, 404);
});

test('a locked listener gets progress and no URL', async () => {
  const calls = fakeSupabase({ claim: { ...ruleState('u1', { have: 1 }), claimed: false } });
  const res = await call('/v1/music/gates/niggy-nigg/play', { method: 'POST' });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.locked, true);
  assert.deepEqual(data.gate.missions, { have: 1, need: 3 });
  assert.deepEqual(data.gate.missing, ['missions', 'identity_verification']);
  assert.ok(data.gate.links.missions && data.gate.links.identity, 'the locked answer carries where to go next');
  assert.ok(!('url' in data), 'no URL of any kind');
  assert.ok(!calls.some((c) => c.url.includes('/storage/v1/object/sign/')), 'a locked listener must never cause a signature');
});

test('an earned play is a one-play stream token, never a storage URL', async () => {
  const calls = fakeSupabase({ claim: { claimed: true, play_id: 'p1', allowed: false } });
  const res = await call('/v1/music/gates/niggy-nigg/play', { method: 'POST' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.url, /^https:\/\/api\.mccluster\.org\/v1\/music\/stream\/[0-9a-f]{64}$/);
  assert.doesNotMatch(data.url, /storage/);
  assert.ok(!calls.some((c) => c.url.includes('/storage/v1/object/sign/')), 'a listener play must not mint a reusable storage URL');
  const claim = calls.find((c) => c.url.endsWith('/rpc/music_gate_claim_rule'));
  assert.equal(claim.body.p_rule, 'gated_track_niggy_nigg');
  assert.equal(claim.body.p_token, data.url.split('/').pop(), 'the token handed out is the one the database holds');
  assert.equal(claim.body.p_stream_seconds, GATES['niggy-nigg'].stream_seconds);
  assert.ok(GATES['niggy-nigg'].stream_seconds <= 300, 'a play token must not outlive one sitting');
});

test('CIA Mind Control closer is governed by the data rule; the other two tracks are not gated', async () => {
  const albums = JSON.parse(readFileSync(new URL('../../../data/albums.json', import.meta.url), 'utf8')).albums;
  const album = albums.find((a) => a.slug === 'cia-mind-control');
  const keys = album.tracks.map((t) => t.gated ? String(t.gated.object).split('/')[0] : t.src.split('/').pop().replace(/\.[^.]+$/, ''));
  assert.equal(keys[keys.length - 1], 'niggy-nigg', 'the gated record closes the album');
  assert.deepEqual(album.tracks.filter((t) => t.gated).length, 1, 'only one track is gated');
  for (const k of keys.slice(0, -1)) assert.ok(!GATES[k] && !TRACKS[k].gated, `${k} stays freely playable`);
  assert.equal(GATES['niggy-nigg'].rule, 'gated_track_niggy_nigg');
  assert.equal(GATES['niggy-nigg'].any_of, undefined, 'the listen gate no longer applies');
  const gated = album.tracks.find((t) => t.gated).gated;
  assert.equal(gated.bucket, GATES['niggy-nigg'].bucket);
  assert.equal(gated.object, GATES['niggy-nigg'].object);
  assert.equal(gated.unlock_rule, 'gated_track_niggy_nigg', 'albums.json names the same rule row');
  const calls = fakeSupabase();
  await call('/v1/music/gates/niggy-nigg/play', { method: 'POST' });
  const claim = calls.find((c) => c.url.endsWith('/rpc/music_gate_claim_rule'));
  assert.deepEqual({ p_user: claim.body.p_user, p_track: claim.body.p_track, p_rule: claim.body.p_rule },
    { p_user: 'u1', p_track: 'niggy-nigg', p_rule: 'gated_track_niggy_nigg' });
});

/* The rule matrix as the Worker sees it: a fake database that applies the
   rule to fixture members. Only (3 missions, identity verified) is ever
   handed a stream token; nobody is ever handed a storage signature. */
for (const have of [0, 1, 2, 3]) {
  for (const identity of [false, true]) {
    test(`matrix: ${have}/3 missions, identity ${identity ? 'verified' : 'not verified'}`, async () => {
      const calls = fakeSupabase({
        state: { have, identity },
        claim: (body) => ({ ...ruleState(body.p_user, { have, identity }), claimed: have >= 3 && identity })
      });
      const state = await (await call('/v1/music/gates/niggy-nigg')).json();
      assert.equal(state.gate.allowed, have >= 3 && identity);
      assert.equal(state.gate.missing.includes('missions'), have < 3);
      assert.equal(state.gate.missing.includes('identity_verification'), !identity);
      const res = await call('/v1/music/gates/niggy-nigg/play', { method: 'POST' });
      const data = await res.json();
      if (have >= 3 && identity) {
        assert.equal(res.status, 200);
        assert.match(data.url, /\/v1\/music\/stream\/[0-9a-f]{64}$/);
      } else {
        assert.equal(res.status, 403);
        assert.equal(data.url, undefined, 'locked: no URL');
        assert.equal(data.locked, true);
      }
      assert.ok(!calls.some((c) => c.url.includes('/storage/')), 'a listener never causes a storage signature or fetch here');
    });
  }
}

test('signed out: the gate says what the full track takes, and play is refused without a token', async () => {
  const calls = fakeSupabase();
  const res = await call('/v1/music/gates/niggy-nigg', { token: null });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.gate.allowed, false);
  assert.deepEqual(data.gate.missing, ['sign_in', 'missions', 'identity_verification']);
  assert.equal(calls.find((c) => c.url.endsWith('/rpc/music_gate_rule_state')).body.p_user, null);
  const play = await call('/v1/music/gates/niggy-nigg/play', { method: 'POST', token: null });
  assert.equal(play.status, 401);
  assert.ok(!calls.some((c) => /music_gate_claim|\/storage\//.test(c.url)), 'signed out never reaches the claim or storage');
});

test('the stream serves the master with ranges while the token holds, and refuses after', async () => {
  const token = 'a'.repeat(64);
  let calls = fakeSupabase();
  let res = await call(`/v1/music/stream/${token}`, { token: null });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'AUDIO');
  assert.equal(res.headers.get('cache-control'), 'no-store, private');
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN, 'a crossorigin <audio> needs CORS');
  assert.equal(res.headers.get('x-secret'), null, 'only media headers pass through');
  assert.equal(calls.find((c) => c.url.endsWith('/rpc/music_stream_open')).body.p_token, token);

  calls = fakeSupabase();
  res = await entry.fetch(new Request(`https://api.mccluster.org/v1/music/stream/${token}`, {
    headers: { origin: ORIGIN, range: 'bytes=0-' } }), env, {});
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 0-4/5');

  calls = fakeSupabase({ streamKey: null });
  res = await call(`/v1/music/stream/${token}`, { token: null });
  assert.equal(res.status, 410, 'a used-up or stale play is gone');
  assert.ok(!calls.some((c) => c.url.includes('/storage/')), 'nothing is fetched for a dead token');
  assert.equal((await call('/v1/music/stream/not-a-token', { token: null })).status, 404);
});

test('beats credit the listen they belong to', async () => {
  const calls = fakeSupabase();
  const res = await call('/v1/music/listens/11111111-1111-4111-8111-111111111111/beat', { method: 'POST' });
  assert.equal((await res.json()).heard_seconds, 45);
  const beat = calls.find((c) => c.url.endsWith('/rpc/music_listen_beat'));
  assert.deepEqual(beat.body, { p_user: 'u1', p_listen: '11111111-1111-4111-8111-111111111111' });
  assert.equal((await call('/v1/music/listens/x/beat', { method: 'POST' })).status, 404);
  assert.equal((await call('/v1/music/listens/11111111-1111-4111-8111-111111111111/beat', { method: 'POST', token: null })).status, 401);
});

test('the owner plays the record without spending anything', async () => {
  const calls = fakeSupabase({ operator: true });
  const res = await call('/v1/music/gates/niggy-nigg/play', { method: 'POST' });
  assert.equal(res.status, 200);
  assert.ok(!calls.some((c) => /\/rpc\/music_gate_claim/.test(c.url)));
});

test('music preflight is answered before the sign-in gate', async () => {
  fakeSupabase();
  const res = await entry.fetch(new Request('https://api.mccluster.org/v1/music/gates/niggy-nigg/play', {
    method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' }
  }), env, {});
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
});
