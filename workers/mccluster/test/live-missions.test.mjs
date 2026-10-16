/* Live missions (src/live/*): continuity rules, city cells, webhooks,
   member-only playback, kill switch, completion stays pending, recording
   assembly. The database is a small in-memory double of the RPCs in
   supabase/pending/live_missions_v1.sql (their real behaviour is tested on
   Postgres by scripts/test-live-missions-db.sh); Cloudflare Stream is the
   real client against a Workers-semantics fetch double. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLiveMissions, runLiveMaintenance, liveEnabled } from '../src/live/index.js';
import { evaluateContinuity, windowCovered, cityCell, DEFAULT_LIVE_POLICY } from '../src/live/continuity.js';
import { makeStreamClient } from '../src/live/stream.js';
import { signStreamWebhook, parseLiveInputEvent, verifyStreamSignature } from '../src/live/webhook.js';
import { makeTusPacker, TUS_PART, sha256Hex } from '../src/live/recording.js';
import { workersFetch } from './support/workers-fetch-semantics.mjs';

const T0 = Date.parse('2026-10-17T15:00:00Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();
const ENV = { LIVE_MISSIONS_ENABLED: 'true', CF_ACCOUNT_ID: 'acct', CF_STREAM_TOKEN: 'stream-token', CF_LIVE_NOTIFICATION_SECRET: 'notif-secret', CF_STREAM_WEBHOOK_SECRET: 'whsec', SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const A = { id: 'aaaaaaaa-0000-4000-8000-00000000000a' }, B = { id: 'bbbbbbbb-0000-4000-8000-00000000000b' }, ADMIN = { id: 'adadadad-0000-4000-8000-0000000000ad' };
const TOKENS = { 'Bearer tok-a': A, 'Bearer tok-b': B, 'Bearer tok-admin': ADMIN };
const ASSIGN = '30000000-0000-4000-8000-00000000000a';

/* ---------- Stream double ---------- */
function streamDouble({ redirectCreate = false } = {}) {
  const state = { inputs: new Map(), deleted: [], tus: null, patches: [], n: 0 };
  const impl = workersFetch(async (url, init) => {
    assert.equal(init.redirect, 'manual');
    if (url.hostname !== 'api.cloudflare.com') return new Response('no', { status: 404 });
    assert.equal(init.headers.authorization, 'Bearer stream-token');
    const p = url.pathname.replace('/client/v4/accounts/acct/stream', '');
    if (p === '/live_inputs' && init.method === 'POST') {
      if (redirectCreate) return new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } });
      const b = JSON.parse(init.body);
      assert.deepEqual(b.recording, { mode: 'off' });
      const uid = `input${String(++state.n).padStart(4, '0')}`;
      state.inputs.set(uid, b);
      return Response.json({ success: true, result: { uid, webRTC: { url: `https://customer-x.cloudflarestream.com/SECRET${uid}/webRTC/publish` }, webRTCPlayback: { url: `https://customer-x.cloudflarestream.com/${uid}/webRTC/play` } } });
    }
    const del = p.match(/^\/live_inputs\/(\w+)$/);
    if (del && init.method === 'DELETE') {
      if (!state.inputs.has(del[1])) return Response.json({ success: false, errors: [{ message: 'not found' }] }, { status: 404 });
      state.inputs.delete(del[1]); state.deleted.push(del[1]);
      return Response.json({ success: true, result: null });
    }
    if (p === '' && init.method === 'POST') {
      assert.equal(init.headers['tus-resumable'], '1.0.0');
      assert.match(init.headers['upload-metadata'], /requiresignedurls/);
      state.tus = { length: Number(init.headers['upload-length']), offset: 0 };
      return new Response(null, { status: 201, headers: { location: 'https://api.cloudflare.com/client/v4/accounts/acct/stream/tus/vid123', 'stream-media-id': 'vid123' } });
    }
    if (p === '/tus/vid123' && init.method === 'PATCH') {
      const len = init.body.byteLength;
      assert.equal(Number(init.headers['upload-offset']), state.tus.offset);
      state.patches.push(len);
      state.tus.offset += len;
      return new Response(null, { status: 204, headers: { 'upload-offset': String(state.tus.offset) } });
    }
    if (p === '/vid123' && init.method === 'GET') return Response.json({ success: true, result: { uid: 'vid123', readyToStream: true, playback: { hls: 'https://customer-x.cloudflarestream.com/vid123/manifest/video.m3u8' } } });
    if (p === '/vid123/token' && init.method === 'POST') return Response.json({ success: true, result: { token: 'SIGNEDTOKEN' } });
    return new Response('unexpected', { status: 500 });
  });
  return { impl, state };
}

/* ---------- database double (the RPCs' contract, not their SQL) ---------- */
function dbDouble() {
  const s = { sessions: new Map(), events: new Set(), observed: [], chunks: [], objects: new Map(), attached: [], reports: [], killed: [], controls: { accepting_sessions: true }, n: 0, sweep: [] };
  const sid = () => `5e55a000-0000-4000-8000-${String(++s.n).padStart(12, '0')}`;
  const db = {
    state: s,
    async authUser(auth) { return TOKENS[auth] || null; },
    async userRpc(auth, name, args) {
      const u = TOKENS[auth];
      if (name === 'eu_is_admin') return u === ADMIN;
      if (name === 'action_live_open') {
        const id = sid();
        s.sessions.set(id, { id, user_id: u.id, mission_id: 'm1', status: 'starting', assignment_id: args.p_assignment, globe_visibility: args.p_globe_visibility, pin_delay_seconds: 120, recording_state: 'capturing', attest: args.p_attest });
        return { session_id: id, live_mode: 'required', policy: { ...DEFAULT_LIVE_POLICY } };
      }
      const run = s.sessions.get(args.p_session);
      if (name === 'action_live_abandon') { run.status = 'abandoned'; return { status: 'abandoned' }; }
      if (name === 'action_live_complete') {
        if (run.user_id !== u.id) throw Object.assign(new Error('session not found'), { status: 409 });
        run.status = 'completed'; run.recording_state = run.chunks ? 'pending_assembly' : 'capturing';
        return { status: 'completed', proof_status: 'pending' };
      }
      if (name === 'action_live_kill') { if (u !== ADMIN) throw Object.assign(new Error('only the desk can stop a live run'), { status: 409 }); run.status = 'killed'; s.killed.push(run.id); return { status: 'killed' }; }
      if (name === 'action_live_report') { s.reports.push({ ...args, by: u.id }); return { report_id: 'r1' }; }
      if (name === 'action_live_mark_third_party') { run.third_party_mode = args.p_mode; return { third_party_mode: args.p_mode }; }
      if (name === 'action_live_set_publishing_consent') return { ok: true };
      throw new Error(`unexpected userRpc ${name}`);
    },
    async serviceRpc(name, args) {
      if (name === 'action_live_now_public') {
        const cells = [...s.sessions.values()].filter((r) => r.status === 'live' && r.globe_visibility === 'city_pin')
          .map((r) => ({ city: r.city_label, region: r.region_label, country: r.country_code, lat: r.cell_lat, lng: r.cell_lng, live_count: 1, missions: ['Help a person'] }));
        return { generated_at: at(0), precision: 'city', cells, total_live: cells.length };
      }
      if (name === 'action_live_sweep') return s.sweep;
      const run = s.sessions.get(args.p_session);
      if (name === 'action_live_attach') { s.attached.push(args); Object.assign(run, { cf_input_uid: args.p_input_uid, whep_url: args.p_whep_url, city_label: args.p_city, region_label: args.p_region, country_code: args.p_country, cell_lat: args.p_lat, cell_lng: args.p_lng }); return null; }
      if (name === 'action_live_observe') {
        if (args.p_event_key && s.events.has(args.p_event_key)) return { duplicate: true, status: run.status };
        if (args.p_event_key) s.events.add(args.p_event_key);
        s.observed.push(args);
        if (['killed', 'completed'].includes(run.status)) return { ignored: true, status: run.status };
        if (args.p_kind !== 'disconnected') { run.status = 'live'; run.first_connected_at = run.first_connected_at || args.p_at; } else run.status = 'interrupted';
        return { status: run.status };
      }
      if (name === 'action_live_record_chunk') { s.chunks.push({ session_id: args.p_session, seq: args.p_seq, object_path: args.p_path, bytes: args.p_bytes, sha256: args.p_sha256 }); run.chunks = (run.chunks || 0) + 1; return { seq: args.p_seq, duplicate: false }; }
      if (name === 'action_live_set_recording') {
        if (args.p_state === 'assembling') { if (run.recording_state !== 'pending_assembly') return false; }
        run.recording_state = args.p_state; if (args.p_video_uid) run.recording_video_uid = args.p_video_uid; return true;
      }
      throw new Error(`unexpected serviceRpc ${name}`);
    },
    async serviceGet(path) {
      let m = path.match(/^action_live_sessions\?id=eq\.([0-9a-f-]+)/);
      if (m) return s.sessions.has(m[1]) ? [{ ...s.sessions.get(m[1]) }] : [];
      m = path.match(/^action_live_sessions\?cf_input_uid=eq\.(\w+)/);
      if (m) return [...s.sessions.values()].filter((r) => r.cf_input_uid === m[1]).map((r) => ({ id: r.id }));
      if (path.startsWith('action_live_sessions?status=eq.live')) return [...s.sessions.values()].filter((r) => r.status === 'live' && r.globe_visibility === 'city_pin').map((r) => ({ ...r, mission: { title: 'Help a person' } }));
      if (path.startsWith('action_live_sessions?status=in.(starting,live,interrupted)')) return [...s.sessions.values()].filter((r) => ['starting', 'live', 'interrupted'].includes(r.status)).map((r) => ({ id: r.id, cf_input_uid: r.cf_input_uid }));
      if (path.startsWith('action_live_sessions?recording_state=eq.pending_assembly')) return [...s.sessions.values()].filter((r) => r.recording_state === 'pending_assembly').map((r) => ({ id: r.id }));
      m = path.match(/^action_live_recording_chunks\?session_id=eq\.([0-9a-f-]+)/);
      if (m) return s.chunks.filter((c) => c.session_id === m[1]).sort((a, b) => a.seq - b.seq);
      if (path.startsWith('action_live_sessions?recording_video_uid=eq.')) return [];
      throw new Error(`unexpected serviceGet ${path}`);
    },
    async userPatch(auth, path, body) { if (TOKENS[auth] !== ADMIN) throw new Error('rls'); Object.assign(s.controls, body); return null; },
    async storagePut(path, bytes) { s.objects.set(path, bytes); return true; },
    async storageGet(path) { return s.objects.get(path); },
    async storageDelete(paths) { for (const p of paths) s.objects.delete(p); return true; }
  };
  return db;
}

function req(method, path, { token, body, headers = {}, raw } = {}) {
  const h = { origin: 'https://mccluster.org', ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined && !raw) h['content-type'] = 'application/json';
  return new Request(`https://api.mccluster.org${path}`, { method, headers: h, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
}
const CF = { city: 'Hartford', region: 'Connecticut', country: 'US', latitude: '41.76371', longitude: '-72.68509' };
function rig(opts = {}) {
  const st = streamDouble(opts), db = dbDouble();
  let clock = T0;
  const deps = { db, stream: makeStreamClient(ENV, { fetchImpl: st.impl }), now: () => clock, cf: CF };
  return { st, db, deps, tick: (min) => { clock += min * 60000; }, call: async (r, env = ENV) => { const res = await handleLiveMissions(r, env, deps); return { status: res.status, json: await res.json().catch(() => null), res }; } };
}
const ATTEST = { adult: true, minors_rule: true, recording_rules: true };
async function startLive(r, token = 'tok-a') {
  const out = await r.call(req('POST', '/v1/live/sessions', { token, body: { assignment_id: ASSIGN, consent_version: 'live-v1', attest: ATTEST, third_party_mode: 'kept_off_camera' } }));
  assert.equal(out.status, 201, JSON.stringify(out.json));
  return out.json;
}
async function connect(r, sessionId, minAgo = 10) {
  const run = r.db.state.sessions.get(sessionId);
  const ev = { name: 'live', text: 'connected', data: { notification_name: 'Stream Live Input', input_id: run.cf_input_uid, event_type: 'live_input.connected', updated_at: new Date(T0).toISOString() }, ts: T0 / 1000 };
  const out = await r.call(req('POST', '/v1/live/webhooks/live-input', { body: ev, headers: { 'cf-webhook-auth': 'notif-secret' } }));
  run.first_connected_at = new Date(T0 - minAgo * 60000).toISOString();
  return out;
}

/* ---------- the flag ---------- */
test('flagged off: every route but /status answers 503, nothing reaches Stream or the database', async () => {
  const r = rig();
  const off = { ...ENV, LIVE_MISSIONS_ENABLED: 'false' };
  assert.equal(liveEnabled(off), false);
  const st = await r.call(req('GET', '/v1/live/status'), off);
  assert.equal(st.status, 200); assert.equal(st.json.enabled, false); assert.equal(st.json.pin_precision, 'city'); assert.equal(st.json.live_policy_default, 'required');
  for (const [m, p] of [['POST', '/v1/live/sessions'], ['GET', '/v1/live/now'], ['POST', '/v1/live/webhooks/live-input']]) {
    assert.equal((await r.call(req(m, p, { token: 'tok-a', body: m === 'GET' ? undefined : {} }), off)).status, 503);
  }
  assert.equal(r.st.impl.calls.length, 0);
  assert.equal(await handleLiveMissions(req('GET', '/v1/mnet/feed'), ENV, r.deps), null);
});

/* ---------- starting a run ---------- */
test('a member starts a run: Stream input made server-side with recording off; WHIP URL to the streamer once; place snapped to a city cell', async () => {
  const r = rig();
  assert.equal((await r.call(req('POST', '/v1/live/sessions', { body: { assignment_id: ASSIGN } }))).status, 401);
  const out = await startLive(r);
  assert.match(out.whip_url, /webRTC\/publish$/);
  assert.equal(out.live_mode, 'required');
  assert.deepEqual(out.pin, { city: 'Hartford', region: 'Connecticut', country: 'US', precision: 'city' });
  const att = r.db.state.attached[0];
  assert.equal(att.p_lat, 41.8); assert.equal(att.p_lng, -72.7);
  assert.equal(r.db.state.sessions.get(out.session_id).attest.adult, true);
  assert.ok(!JSON.stringify(out).includes('webRTC/play'), 'the start answer carries no playback URL');
});

test('a Stream redirect is refused (the token never follows it) and the run is abandoned', async () => {
  const r = rig({ redirectCreate: true });
  const out = await r.call(req('POST', '/v1/live/sessions', { token: 'tok-a', body: { assignment_id: ASSIGN, attest: ATTEST } }));
  assert.equal(out.status, 502);
  assert.equal([...r.db.state.sessions.values()][0].status, 'abandoned');
  assert.equal(r.st.impl.calls.filter((c) => c.url.includes('evil.example')).length, 0);
});

/* ---------- the globe ---------- */
test('Live now: the public gets city cells and counts only; members also get watchable run ids, still no playback URL or member id', async () => {
  const r = rig();
  const s = await startLive(r);
  await connect(r, s.session_id);
  const pub = await r.call(req('GET', '/v1/live/now'));
  assert.equal(pub.status, 200);
  assert.equal(pub.json.precision, 'city');
  assert.equal(pub.json.total_live, 1);
  assert.equal(pub.json.runs, undefined);
  assert.equal(pub.res.headers.get('cache-control'), 'public, max-age=15');
  const text = JSON.stringify(pub.json);
  for (const secret of [s.session_id, A.id, 'input0001', 'webRTC', 'SECRET']) assert.ok(!text.includes(secret), `public answer leaks ${secret}`);
  const cell = pub.json.cells[0];
  assert.deepEqual(Object.keys(cell).sort(), ['city', 'country', 'lat', 'live_count', 'lng', 'missions', 'region']);
  assert.equal(cell.lat, 41.8);
  const mem = await r.call(req('GET', '/v1/live/now', { token: 'tok-b' }));
  assert.equal(mem.json.runs.length, 1);
  assert.equal(mem.json.runs[0].id, s.session_id);
  assert.equal(mem.res.headers.get('cache-control'), 'private, no-store');
  const memText = JSON.stringify(mem.json);
  for (const secret of [A.id, 'input0001', 'webRTC']) assert.ok(!memText.includes(secret), `member list leaks ${secret}`);
  for (const p of mem.json.runs) assert.equal(Math.round(p.lat * 10) / 10, p.lat, 'one decimal at most');
});

test('cityCell never returns a point finer than 0.1 degree, and no city means no point', () => {
  const c = cityCell({ city: 'Lubumbashi', region: 'Haut-Katanga', country: 'CD', latitude: '-11.66412', longitude: '27.48247' });
  assert.deepEqual([c.lat, c.lng], [-11.7, 27.5]);
  for (let i = 0; i < 200; i++) {
    const x = cityCell({ city: 'X', country: 'US', latitude: String(Math.random() * 180 - 90), longitude: String(Math.random() * 360 - 180) });
    assert.equal(Math.round(x.lat * 10) / 10, x.lat); assert.equal(Math.round(x.lng * 10) / 10, x.lng);
  }
  assert.deepEqual([cityCell({ latitude: '41.7', longitude: '-72.6' }).lat, cityCell({}).lat, cityCell({ city: 'Z', latitude: null, longitude: null }).lat, cityCell({ city: 'Z', latitude: '', longitude: '' }).lng], [null, null, null, null], 'no invented (0,0)');
  assert.equal(cityCell({ city: 'Y', country: 'usa', latitude: '1', longitude: '1' }).country, null);
});

/* ---------- playback ---------- */
test('playback (WHEP) only for signed-in members, only while live, after the pin delay, never for hidden runs (desk excepted)', async () => {
  const r = rig();
  const s = await startLive(r);
  const watch = (token) => r.call(req('POST', `/v1/live/sessions/${s.session_id}/watch`, { token, body: {} }));
  assert.equal((await watch(null)).status, 401);
  assert.equal((await watch('tok-b')).status, 410, 'not live yet');
  await connect(r, s.session_id, 1); // live for 1 min < 120 s delay
  assert.equal((await watch('tok-b')).status, 410, 'pin delay applies to watching too');
  r.db.state.sessions.get(s.session_id).first_connected_at = new Date(T0 - 5 * 60000).toISOString();
  const ok = await watch('tok-b');
  assert.equal(ok.status, 200); assert.match(ok.json.whep_url, /webRTC\/play$/);
  r.db.state.sessions.get(s.session_id).globe_visibility = 'hidden';
  assert.equal((await watch('tok-b')).status, 410);
  assert.equal((await watch('tok-admin')).status, 200, 'the desk can watch a hidden run');
});

/* ---------- webhooks ---------- */
test('live-input webhook: wrong or missing secret refused; good event observed once; replay is a duplicate; stale event refused; foreign input ignored', async () => {
  const r = rig();
  const s = await startLive(r);
  const input = r.db.state.sessions.get(s.session_id).cf_input_uid;
  const ev = (type, t = T0) => ({ data: { input_id: input, event_type: type, updated_at: new Date(t).toISOString() }, ts: t / 1000 });
  const send = (payload, secret) => r.call(req('POST', '/v1/live/webhooks/live-input', { body: payload, headers: secret ? { 'cf-webhook-auth': secret } : {} }));
  assert.equal((await send(ev('live_input.connected'))).status, 401);
  assert.equal((await send(ev('live_input.connected'), 'notif-secreT')).status, 401);
  const first = await send(ev('live_input.connected'), 'notif-secret');
  assert.equal(first.status, 200); assert.equal(first.json.duplicate, false); assert.equal(first.json.status, 'live');
  const again = await send(ev('live_input.connected'), 'notif-secret');
  assert.equal(again.json.duplicate, true);
  assert.equal(r.db.state.observed.length, 1, 'a replay is counted once');
  assert.equal((await send(ev('live_input.disconnected', T0 - 10 * 60000), 'notif-secret')).status, 409, 'old event refused');
  assert.equal((await send(ev('live_input.disconnected', T0 + 10 * 60000), 'notif-secret')).status, 409, 'future event refused');
  const foreign = await send({ data: { input_id: 'someoneelse01', event_type: 'live_input.connected', updated_at: new Date(T0).toISOString() } }, 'notif-secret');
  assert.equal(foreign.status, 202);
  assert.equal(parseLiveInputEvent({ data: { input_id: input, event_type: 'video.ready', updated_at: new Date(T0).toISOString() } }, T0).ok, false);
  const noSecret = await r.call(req('POST', '/v1/live/webhooks/live-input', { body: ev('live_input.connected'), headers: { 'cf-webhook-auth': 'x' } }), { ...ENV, CF_LIVE_NOTIFICATION_SECRET: '' });
  assert.equal(noSecret.status, 503, 'fails closed without the secret');
});

test('Stream video webhook: HMAC good, bad, and replayed-old', async () => {
  const raw = JSON.stringify({ uid: 'vid123', readyToStream: true });
  const t = Math.floor(T0 / 1000);
  const good = await signStreamWebhook('whsec', raw, t);
  assert.equal((await verifyStreamSignature(good, raw, 'whsec', T0)).ok, true);
  assert.equal((await verifyStreamSignature(good, raw + ' ', 'whsec', T0)).status, 401, 'body tampered');
  assert.equal((await verifyStreamSignature(good, raw, 'other', T0)).status, 401, 'wrong secret');
  assert.equal((await verifyStreamSignature(good, raw, 'whsec', T0 + 20 * 60000)).status, 409, 'old signature (replay)');
  assert.equal((await verifyStreamSignature('', raw, 'whsec', T0)).status, 401);
  const r = rig();
  const ok = await r.call(req('POST', '/v1/live/webhooks/stream', { raw, headers: { 'webhook-signature': good, 'content-type': 'application/json' } }));
  assert.equal(ok.status, 200);
  const flipped = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0');
  const bad = await r.call(req('POST', '/v1/live/webhooks/stream', { raw, headers: { 'webhook-signature': flipped, 'content-type': 'application/json' } }));
  assert.equal(bad.status, 401);
});

/* ---------- kill switch ---------- */
test('kill switch: members cannot; the desk deletes the Stream input first, then the run is killed; kill-all stops new runs', async () => {
  const r = rig();
  const s = await startLive(r);
  await connect(r, s.session_id);
  const input = r.db.state.sessions.get(s.session_id).cf_input_uid;
  const k = (token) => r.call(req('POST', `/v1/live/sessions/${s.session_id}/kill`, { token, body: { reason: 'report' } }));
  assert.equal((await k('tok-b')).status, 404);
  assert.equal((await k('tok-a')).status, 404, 'not even the streamer');
  assert.deepEqual(r.st.state.deleted, []);
  const out = await k('tok-admin');
  assert.equal(out.status, 200); assert.equal(out.json.status, 'killed');
  assert.deepEqual(r.st.state.deleted, [input]);
  /* a later connected event cannot revive it */
  const ev = { data: { input_id: input, event_type: 'live_input.connected', updated_at: new Date(T0 + 1000).toISOString() } };
  r.tick(0);
  const back = await r.call(req('POST', '/v1/live/webhooks/live-input', { body: ev, headers: { 'cf-webhook-auth': 'notif-secret' } }));
  assert.equal(back.json.status, 'killed');
  const s2 = await startLive(r, 'tok-b');
  assert.equal((await r.call(req('POST', '/v1/live/kill-all', { token: 'tok-b', body: {} }))).status, 404);
  const all = await r.call(req('POST', '/v1/live/kill-all', { token: 'tok-admin', body: { reason: 'owner' } }));
  assert.equal(all.json.killed, 1); assert.equal(r.db.state.controls.accepting_sessions, false);
  assert.equal(r.db.state.sessions.get(s2.session_id).status, 'killed');
});

/* ---------- completion ---------- */
test('"Mission complete" files a pending proof (an admin still reviews), deletes the input; only the streamer can complete', async () => {
  const r = rig();
  const s = await startLive(r);
  await connect(r, s.session_id);
  assert.equal((await r.call(req('POST', `/v1/live/sessions/${s.session_id}/complete`, { token: 'tok-b', body: {} }))).status, 404);
  const out = await r.call(req('POST', `/v1/live/sessions/${s.session_id}/complete`, { token: 'tok-a', body: { statement: 'done' } }));
  assert.equal(out.status, 200);
  assert.equal(out.json.proof_status, 'pending');
  assert.match(out.json.review, /admin reviews/);
  assert.equal(r.st.state.deleted.length, 1);
});

test('the streamer marks the helped person (agreed on camera / kept off) and reports reach the desk', async () => {
  const r = rig();
  const s = await startLive(r);
  assert.equal((await r.call(req('POST', `/v1/live/sessions/${s.session_id}/third-party`, { token: 'tok-a', body: { mode: 'invented' } }))).status, 400);
  assert.equal((await r.call(req('POST', `/v1/live/sessions/${s.session_id}/third-party`, { token: 'tok-a', body: { mode: 'consented_on_camera' } }))).json.third_party_mode, 'consented_on_camera');
  assert.equal((await r.call(req('POST', `/v1/live/sessions/${s.session_id}/third-party`, { token: 'tok-b', body: { mode: 'kept_off_camera' } }))).status, 404);
  assert.equal((await r.call(req('POST', `/v1/live/sessions/${s.session_id}/report`, { token: 'tok-b', body: { reason: 'nope' } }))).status, 400);
  assert.equal((await r.call(req('POST', `/v1/live/sessions/${s.session_id}/report`, { token: 'tok-b', body: { reason: 'minor_on_camera' } }))).status, 200);
  assert.equal(r.db.state.reports[0].p_reason, 'minor_on_camera');
});

/* ---------- recording ---------- */
test('recording chunks are hashed on arrival; assembly uploads them in order over tus in valid part sizes; a tampered chunk fails', async () => {
  const r = rig();
  const s = await startLive(r);
  await connect(r, s.session_id);
  const put = (seq, bytes, type = 'video/webm') => r.call(req('PUT', `/v1/live/sessions/${s.session_id}/chunks/${seq}`, { token: 'tok-a', raw: bytes, headers: { 'content-type': type } }));
  assert.equal((await put(0, new Uint8Array([1, 2]), 'text/plain')).status, 415);
  const sizes = [3 * 1024 * 1024 + 7, 3 * 1024 * 1024 + 11, 1234];
  const parts = sizes.map((n, i) => new Uint8Array(n).fill(i + 1));
  for (const [i, p] of parts.entries()) {
    const out = await put(i, p);
    assert.equal(out.status, 200); assert.equal(out.json.sha256, await sha256Hex(p));
  }
  await r.call(req('POST', `/v1/live/sessions/${s.session_id}/complete`, { token: 'tok-a', body: {} }));
  const res = await runLiveMaintenance(ENV, r.deps);
  assert.equal(res.assembled[0].state, 'ready');
  const total = sizes.reduce((a, b) => a + b, 0);
  assert.equal(r.st.state.tus.length, total);
  assert.equal(r.st.state.tus.offset, total);
  for (const n of r.st.state.patches.slice(0, -1)) { assert.ok(n >= TUS_PART); assert.equal(n % (256 * 1024), 0); }
  assert.equal(r.db.state.sessions.get(s.session_id).recording_video_uid, 'vid123');
  assert.equal(r.db.state.objects.size, 0, 'chunks deleted only after Stream took every byte');
  const rec = await r.call(req('GET', `/v1/live/sessions/${s.session_id}/recording`, { token: 'tok-admin' }));
  assert.equal(rec.json.hls, 'https://customer-x.cloudflarestream.com/SIGNEDTOKEN/manifest/video.m3u8');
  assert.equal((await r.call(req('GET', `/v1/live/sessions/${s.session_id}/recording`, { token: 'tok-a' }))).status, 404, 'desk only');

  const r2 = rig();
  const s2 = await startLive(r2);
  await connect(r2, s2.session_id);
  await r2.call(req('PUT', `/v1/live/sessions/${s2.session_id}/chunks/0`, { token: 'tok-a', raw: new Uint8Array(10).fill(9), headers: { 'content-type': 'video/webm' } }));
  await r2.call(req('POST', `/v1/live/sessions/${s2.session_id}/complete`, { token: 'tok-a', body: {} }));
  r2.db.state.objects.set(r2.db.state.chunks[0].object_path, new Uint8Array(10).fill(8));
  const bad = await runLiveMaintenance(ENV, r2.deps);
  assert.equal(bad.assembled[0].state, 'failed');
  assert.equal(r2.db.state.objects.size, 1, 'a failed assembly keeps the chunks');
});

test('tus packer: parts are >= 5 MiB and 256 KiB aligned, the last carries the remainder', () => {
  const p = makeTusPacker();
  const out = [...p.push(new Uint8Array(4 * 1024 * 1024)), ...p.push(new Uint8Array(4 * 1024 * 1024 + 5)), ...p.flush()];
  assert.equal(out.reduce((a, b) => a + b.length, 0), 8 * 1024 * 1024 + 5);
  assert.equal(out[0].length % (256 * 1024), 0); assert.ok(out[0].length >= TUS_PART);
});

test('maintenance: the sweep\'s broken/abandoned inputs are deleted; nothing runs while flagged off', async () => {
  const r = rig();
  const s = await startLive(r);
  r.db.state.sweep = [{ session_id: s.session_id, input_uid: r.db.state.sessions.get(s.session_id).cf_input_uid, status: 'broken' }];
  const out = await runLiveMaintenance(ENV, r.deps);
  assert.equal(out.inputs_deleted, 1);
  assert.deepEqual(await runLiveMaintenance({ ...ENV, LIVE_MISSIONS_ENABLED: 'false' }, r.deps), { skipped: true });
});

/* ---------- continuity rules (mirror of action_live_eval) ---------- */
const seg = (a, b) => ({ connected_at: at(a), disconnected_at: b == null ? null : at(b) });
test('continuity: blips tolerated, one resume allowed, the rest break', () => {
  const now = T0 + 41 * 60000;
  assert.equal(evaluateContinuity([seg(0, 20), seg(20.5, 40)], {}, { now, finished: true }).state, 'continuous');
  assert.equal(evaluateContinuity([seg(0, 20), seg(22, 40)], {}, { now, finished: true }).state, 'resumed');
  assert.equal(evaluateContinuity([seg(0, 20), seg(22, 30), seg(32, 40)], {}, { now, finished: true }).reason, 'too_many_resumes');
  assert.equal(evaluateContinuity([seg(0, 20), seg(31, 40)], {}, { now, finished: true }).reason, 'gap_longer_than_resume_window');
  const blips = [0, 1, 2, 3, 4].map((n) => seg(n * 350 / 60, n * 350 / 60 + 5));
  assert.equal(evaluateContinuity(blips, {}, { now, finished: true }).reason, 'total_gap_over_tolerance');
  const many = Array.from({ length: 8 }, (_, n) => seg(n * 5, n * 5 + 4.9));
  assert.equal(evaluateContinuity(many, {}, { now, finished: true }).reason, 'too_many_reconnects');
  const dropped = evaluateContinuity([seg(0, 20)], {}, { now: T0 + 25 * 60000 });
  assert.equal(dropped.state, 'continuous'); assert.equal(dropped.seconds_until_broken, 300);
  assert.equal(evaluateContinuity([seg(0, 20)], {}, { now: T0 + 31 * 60000 }).reason, 'not_resumed_in_time');
  assert.equal(evaluateContinuity([seg(0, 3)], {}, { now, finished: true }).can_complete, false, 'shorter than five minutes');
  assert.equal(evaluateContinuity([seg(0, null)], { min_duration_seconds: 60 }, { now: T0 + 2 * 60000 }).can_complete, true);
  assert.equal(evaluateContinuity([], {}, { now }).state, 'not_started');
  assert.equal(evaluateContinuity([seg(0, 20), seg(22, 40)], { max_resumes: 0 }, { now, finished: true }).state, 'broken', 'per-mission data');
});

test('coverage bounty: a claim needs continuous coverage of the whole window', () => {
  const w = { from: at(10), to: at(40), start_grace_seconds: 120, max_single_gap_seconds: 30, max_total_gap_seconds: 60 };
  assert.equal(windowCovered([seg(5, 45)], w), true, 'start to end');
  assert.equal(windowCovered([seg(11.5, 45)], w), true, 'joined within the grace');
  assert.equal(windowCovered([seg(13, 45)], w), false, 'missed the start');
  assert.equal(windowCovered([seg(5, 39)], w), false, 'left before the end');
  assert.equal(windowCovered([seg(5, 20), seg(20.4, 45)], w), true, '24 s drop tolerated');
  assert.equal(windowCovered([seg(5, 20), seg(21, 45)], w), false, '60 s drop over the 30 s tolerance');
  assert.equal(windowCovered([seg(5, 20), seg(20.4, 30), seg(30.4, 45)], w), true, 'two 24 s drops = 48 s total');
  assert.equal(windowCovered([seg(5, 20), seg(20.4, 30), seg(30.4, 35), seg(35.4, 45)], w), false, 'three 24 s drops = 72 s > 60 s');
  assert.equal(windowCovered([seg(5, 20), seg(20.45, 25), seg(25.45, 30), seg(30.45, 45)], w), false, 'total drops over 60 s');
  assert.equal(windowCovered([seg(5, null)], w), false, 'an open run is not proof');
  assert.equal(windowCovered([], w), false);
});
