/* LIVE MISSIONS (flagged off): stay live to complete a mission, "Live now"
   on the globe, live coverage bounties.

   Design: docs/control-plane/LIVE-MISSIONS.md. Database rules:
   supabase/pending/live_missions_v1.sql (pending; nothing here works until
   it is applied, and every route answers 503 until LIVE_MISSIONS_ENABLED is
   "true" in wrangler.toml [vars]).

   Routes, all under /v1/live:
     GET  /status                          anyone      is it on, how precise are pins
     GET  /now                             anyone      city cells + counts; members also get
                                                       watchable run ids (no names, no member ids)
     POST /sessions                        member      start a run for my assignment -> WHIP URL (once)
     POST /sessions/:id/heartbeat          streamer    "my publish connection is up"
     PUT  /sessions/:id/chunks/:seq        streamer    one recording chunk (WebM bytes)
     POST /sessions/:id/third-party        streamer    the helped person agreed on camera / kept off
     POST /sessions/:id/publishing         streamer    the 12 publishing opt-ins
     POST /sessions/:id/complete           streamer    "Mission complete" -> proof filed PENDING
     POST /sessions/:id/end                streamer    stop without completing
     POST /sessions/:id/watch              member      the WHEP playback URL (members only)
     POST /sessions/:id/report             member      report a run
     POST /sessions/:id/kill               desk        kill switch for one run
     POST /kill-all                        desk        kill every run and stop new ones
     GET  /sessions/:id/recording          desk        signed playback of the assembled recording
     POST /webhooks/live-input             Cloudflare  connected/disconnected (cf-webhook-auth)
     POST /webhooks/stream                 Cloudflare  video ready (Webhook-Signature HMAC)

   Never returned to anyone but its own streamer, once: the WHIP URL. Never
   returned to the public: run ids, member ids, names, Stream ids, playback
   URLs, coordinates finer than a 0.1-degree city cell. */
import { reply, fail, corsHeaders } from '../lib/http.js';
import { makeSupabaseStore } from './store.js';
import { makeStreamClient, streamConfigured } from './stream.js';
import { verifyNotificationSecret, parseLiveInputEvent, verifyStreamSignature } from './webhook.js';
import { cityCell, evaluateContinuity } from './continuity.js';
import { MAX_CHUNK_BYTES, chunkPath, sha256Hex, assembleRecording } from './recording.js';

export const LIVE_PREFIX = '/v1/live';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const isUuid = (v) => new RegExp(`^${UUID}$`, 'i').test(String(v || ''));
const ACTIVE = new Set(['starting', 'live', 'interrupted']);
const REPORT_REASONS = new Set(['minor_on_camera', 'no_consent', 'private_place', 'harassment', 'doxxing', 'violence', 'sexual_content', 'dangerous', 'misleading', 'other']);
const THIRD_PARTY = new Set(['none_present', 'consented_on_camera', 'kept_off_camera', 'audio_only']);

export function liveEnabled(env) {
  return String(env && env.LIVE_MISSIONS_ENABLED || '').trim().toLowerCase() === 'true';
}

function noStore(res) { res.headers.set('cache-control', 'private, no-store'); return res; }
async function body(request) { try { return await request.json(); } catch { return {}; } }
function errorReply(request, env, e) {
  const status = Number(e && e.status) || 500;
  return noStore(fail(request, env, (e && e.message) || 'Live mission request failed', status >= 400 && status < 600 ? status : 500));
}

export async function handleLiveMissions(request, env, deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== LIVE_PREFIX && !path.startsWith(`${LIVE_PREFIX}/`)) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  const sub = path.slice(LIVE_PREFIX.length) || '/';
  const on = liveEnabled(env);
  if (sub === '/status' && request.method === 'GET') {
    return noStore(reply(request, env, { ok: true, enabled: on, stream_configured: streamConfigured(env), pin_precision: 'city', recording: 'browser_chunks_to_stream', live_policy_default: 'required' }));
  }
  if (!on) return noStore(fail(request, env, 'Live missions are not switched on yet', 503, { enabled: false }));

  const db = deps.db || makeSupabaseStore(env, { fetchImpl: deps.fetchImpl });
  const stream = deps.stream || makeStreamClient(env, { fetchImpl: deps.fetchImpl });
  const now = deps.now || (() => Date.now());
  const authorization = request.headers.get('authorization') || '';

  try {
    if (sub === '/webhooks/live-input' && request.method === 'POST') return await liveInputWebhook(request, env, { db, now });
    if (sub === '/webhooks/stream' && request.method === 'POST') return await streamWebhook(request, env, { db, now });

    if (sub === '/now' && request.method === 'GET') {
      const pub = await db.serviceRpc('action_live_now_public', {});
      const user = authorization ? await db.authUser(authorization) : null;
      const out = { ok: true, precision: 'city', generated_at: pub && pub.generated_at, total_live: (pub && pub.total_live) || 0, cells: (pub && pub.cells) || [], members: Boolean(user) };
      if (user) out.runs = await watchableRuns(db, now());
      const res = reply(request, env, out);
      res.headers.set('cache-control', user ? 'private, no-store' : 'public, max-age=15');
      res.headers.set('vary', 'origin, authorization');
      return res;
    }

    const user = await db.authUser(authorization);
    if (!user) return noStore(fail(request, env, 'Sign in to do missions live', 401));
    const isAdmin = async () => (await db.userRpc(authorization, 'eu_is_admin', {}).catch(() => false)) === true;

    if (sub === '/sessions' && request.method === 'POST') return await startRun(request, env, { db, stream, user, authorization, cf: deps.cf || request.cf });

    if (sub === '/kill-all' && request.method === 'POST') {
      if (!(await isAdmin())) return noStore(fail(request, env, 'Not found', 404));
      const b = await body(request);
      await db.userPatch(authorization, 'action_live_controls?id=eq.true', { accepting_sessions: false, updated_at: new Date(now()).toISOString(), updated_by: user.id });
      const runs = await db.serviceGet('action_live_sessions?status=in.(starting,live,interrupted)&select=id,cf_input_uid&limit=500');
      let killed = 0;
      for (const r of runs || []) {
        await stream.deleteLiveInput(r.cf_input_uid).catch(() => false);
        await db.userRpc(authorization, 'action_live_kill', { p_session: r.id, p_reason: String(b.reason || 'kill-all').slice(0, 400) });
        killed++;
      }
      return noStore(reply(request, env, { ok: true, killed, accepting_sessions: false }));
    }

    const m = sub.match(new RegExp(`^/sessions/(${UUID})/([a-z-]+)(?:/(\\d{1,6}))?$`, 'i'));
    if (!m) return noStore(fail(request, env, 'Not found', 404));
    const [, id, action, seqText] = m;
    const rows = await db.serviceGet(`action_live_sessions?id=eq.${id}&select=id,user_id,mission_id,status,cf_input_uid,whep_url,globe_visibility,pin_delay_seconds,first_connected_at,recording_state,recording_video_uid,evidence&limit=1`);
    const run = rows && rows[0];
    if (!run) return noStore(fail(request, env, 'Live run not found', 404));
    const mine = run.user_id === user.id;

    if (action === 'watch' && request.method === 'POST') {
      const admin = !mine && (await isAdmin());
      const delayed = run.first_connected_at && now() - Date.parse(run.first_connected_at) < Number(run.pin_delay_seconds || 0) * 1000;
      if (run.status !== 'live' || !run.whep_url || (!mine && !admin && (run.globe_visibility !== 'city_pin' || delayed))) {
        return noStore(fail(request, env, 'That run is not live', 410));
      }
      return noStore(reply(request, env, { ok: true, whep_url: run.whep_url, protocol: 'whep' }));
    }
    if (action === 'report' && request.method === 'POST') {
      const b = await body(request);
      if (!REPORT_REASONS.has(b.reason)) return noStore(fail(request, env, 'Choose a reason', 400));
      const r = await db.userRpc(authorization, 'action_live_report', { p_session: id, p_reason: b.reason, p_note: String(b.note || '').slice(0, 500) });
      return noStore(reply(request, env, { ok: true, ...r }));
    }
    if (action === 'kill' && request.method === 'POST') {
      if (!(await isAdmin())) return noStore(fail(request, env, 'Not found', 404));
      const b = await body(request);
      /* the input first: the publish URL dies even if the write after fails */
      await stream.deleteLiveInput(run.cf_input_uid);
      const r = await db.userRpc(authorization, 'action_live_kill', { p_session: id, p_reason: String(b.reason || '').slice(0, 400) });
      return noStore(reply(request, env, { ok: true, ...r }));
    }
    if (action === 'recording' && request.method === 'GET') {
      if (!(await isAdmin())) return noStore(fail(request, env, 'Not found', 404));
      if (!run.recording_video_uid) return noStore(fail(request, env, 'No recording yet', 404, { recording_state: run.recording_state }));
      const [video, token] = await Promise.all([stream.getVideo(run.recording_video_uid), stream.videoToken(run.recording_video_uid)]);
      const hls = video && video.playback && video.playback.hls;
      if (!hls) return noStore(fail(request, env, 'The recording is still processing', 409, { ready: Boolean(video && video.readyToStream) }));
      return noStore(reply(request, env, { ok: true, hls: hls.replace(`/${run.recording_video_uid}/`, `/${token}/`), expires_in: 900, ready: Boolean(video.readyToStream) }));
    }

    /* everything below is the streamer's own */
    if (!mine) return noStore(fail(request, env, 'Live run not found', 404));

    if (action === 'heartbeat' && request.method === 'POST') {
      const b = await body(request);
      if (!ACTIVE.has(run.status)) return noStore(fail(request, env, 'This run has ended', 410, { status: run.status }));
      if (b.connected !== true) return noStore(reply(request, env, { ok: true, status: run.status, recorded: false }));
      const r = await db.serviceRpc('action_live_observe', { p_session: id, p_kind: 'heartbeat', p_at: new Date(now()).toISOString(), p_source: 'heartbeat', p_event_key: null });
      return noStore(reply(request, env, { ok: true, ...r }));
    }
    if (action === 'chunks' && request.method === 'PUT' && seqText) {
      const seq = Number(seqText);
      if (!ACTIVE.has(run.status) || run.recording_state !== 'capturing') return noStore(fail(request, env, 'This run is not recording', 409));
      const type = (request.headers.get('content-type') || '').split(';')[0].trim();
      if (!['video/webm', 'video/mp4'].includes(type)) return noStore(fail(request, env, 'Recording chunks are video/webm or video/mp4', 415));
      const declared = Number(request.headers.get('content-length') || 0);
      if (declared > MAX_CHUNK_BYTES) return noStore(fail(request, env, 'Chunk too large', 413));
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_CHUNK_BYTES) return noStore(fail(request, env, bytes.length ? 'Chunk too large' : 'Empty chunk', bytes.length ? 413 : 400));
      const sha = await sha256Hex(bytes);
      const objectPath = chunkPath(id, seq);
      await db.storagePut(objectPath, bytes, type);
      const r = await db.serviceRpc('action_live_record_chunk', { p_session: id, p_seq: seq, p_path: objectPath, p_bytes: bytes.length, p_sha256: sha });
      return noStore(reply(request, env, { ok: true, sha256: sha, bytes: bytes.length, ...r }));
    }
    if (action === 'third-party' && request.method === 'POST') {
      const b = await body(request);
      if (!THIRD_PARTY.has(b.mode)) return noStore(fail(request, env, 'Unknown choice', 400));
      return noStore(reply(request, env, { ok: true, ...(await db.userRpc(authorization, 'action_live_mark_third_party', { p_session: id, p_mode: b.mode })) }));
    }
    if (action === 'publishing' && request.method === 'POST') {
      const b = await body(request);
      if (!/^[0-9a-f]{64}$/.test(String(b.text_sha256 || ''))) return noStore(fail(request, env, 'Consent text hash missing', 400));
      return noStore(reply(request, env, { ok: true, ...(await db.userRpc(authorization, 'action_live_set_publishing_consent', { p_session: id, p_version: String(b.version || '').slice(0, 40), p_text_sha256: b.text_sha256, p_choices: b.choices || {} })) }));
    }
    if (action === 'complete' && request.method === 'POST') {
      const b = await body(request);
      const r = await db.userRpc(authorization, 'action_live_complete', { p_session: id, p_statement: String(b.statement || '').slice(0, 4000) });
      await stream.deleteLiveInput(run.cf_input_uid).catch(() => false);
      return noStore(reply(request, env, { ok: true, ...r, review: 'An admin reviews every live run before it counts.' }));
    }
    if (action === 'end' && request.method === 'POST') {
      const r = await db.userRpc(authorization, 'action_live_abandon', { p_session: id });
      await stream.deleteLiveInput(run.cf_input_uid).catch(() => false);
      return noStore(reply(request, env, { ok: true, ...r }));
    }
    return noStore(fail(request, env, 'Not found', 404));
  } catch (e) {
    return errorReply(request, env, e);
  }
}

async function startRun(request, env, { db, stream, user, authorization, cf }) {
  if (!streamConfigured(env)) return noStore(fail(request, env, 'Live video is not configured yet', 503));
  const b = await body(request);
  if (!isUuid(b.assignment_id)) return noStore(fail(request, env, 'Choose the mission you are doing', 400));
  if (b.bounty_id != null && !isUuid(b.bounty_id)) return noStore(fail(request, env, 'Unknown bounty', 400));
  const attest = b.attest && typeof b.attest === 'object' ? b.attest : {};
  const opened = await db.userRpc(authorization, 'action_live_open', {
    p_assignment: b.assignment_id,
    p_consent_version: String(b.consent_version || '').slice(0, 40),
    p_attest: { adult: attest.adult === true, minors_rule: attest.minors_rule === true, recording_rules: attest.recording_rules === true },
    p_third_party_mode: THIRD_PARTY.has(b.third_party_mode) ? b.third_party_mode : 'none_present',
    p_globe_visibility: b.globe_visibility === 'hidden' ? 'hidden' : 'city_pin',
    p_bounty: b.bounty_id || null
  });
  const sessionId = opened && opened.session_id;
  if (!isUuid(sessionId)) return noStore(fail(request, env, 'Could not open the live run', 502));
  let input;
  try {
    input = await stream.createLiveInput(`live-mission ${sessionId}`);
    const place = cityCell(cf);
    await db.serviceRpc('action_live_attach', { p_session: sessionId, p_input_uid: input.uid, p_whep_url: input.whep_url, p_city: place.city, p_region: place.region, p_country: place.country, p_lat: place.lat, p_lng: place.lng });
  } catch (e) {
    if (input && input.uid) await stream.deleteLiveInput(input.uid).catch(() => false);
    await db.userRpc(authorization, 'action_live_abandon', { p_session: sessionId }).catch(() => null);
    return errorReply(request, env, e);
  }
  const place = cityCell(cf);
  return noStore(reply(request, env, {
    ok: true, session_id: sessionId, whip_url: input.whip_url, policy: opened.policy || null, live_mode: opened.live_mode,
    pin: place.city ? { city: place.city, region: place.region, country: place.country, precision: 'city' } : null,
    heartbeat_seconds: 15, chunk_seconds: 5
  }, 201));
}

/* members: runs they may watch, coarse place only, after the pin delay */
async function watchableRuns(db, nowMs) {
  const rows = await db.serviceGet('action_live_sessions?status=eq.live&globe_visibility=eq.city_pin&select=id,first_connected_at,pin_delay_seconds,city_label,region_label,country_code,cell_lat,cell_lng,mission:action_missions(title)&order=first_connected_at.asc&limit=200');
  return (rows || [])
    .filter((r) => r.first_connected_at && nowMs - Date.parse(r.first_connected_at) >= Number(r.pin_delay_seconds || 0) * 1000)
    .map((r) => ({ id: r.id, mission: (r.mission && r.mission.title) || '', city: r.city_label, region: r.region_label, country: r.country_code,
      lat: r.cell_lat == null ? null : Math.round(Number(r.cell_lat) * 10) / 10, lng: r.cell_lng == null ? null : Math.round(Number(r.cell_lng) * 10) / 10,
      live_since: r.first_connected_at }));
}

async function liveInputWebhook(request, env, { db, now }) {
  const auth = verifyNotificationSecret(request, env.CF_LIVE_NOTIFICATION_SECRET);
  if (!auth.ok) return noStore(fail(request, env, auth.error, auth.status));
  const payload = await request.json().catch(() => null);
  const ev = parseLiveInputEvent(payload, now());
  if (!ev.ok) return noStore(fail(request, env, ev.error, ev.status));
  const rows = await db.serviceGet(`action_live_sessions?cf_input_uid=eq.${encodeURIComponent(ev.inputId)}&select=id&limit=1`);
  const run = rows && rows[0];
  /* not ours (the account's other live rooms share the notification): accept and ignore */
  if (!run) return noStore(reply(request, env, { ok: true, ignored: true }, 202));
  const r = await db.serviceRpc('action_live_observe', { p_session: run.id, p_kind: ev.kind, p_at: ev.at, p_source: 'webhook', p_event_key: ev.eventKey });
  return noStore(reply(request, env, { ok: true, duplicate: Boolean(r && r.duplicate), status: r && r.status }));
}

async function streamWebhook(request, env, { db, now }) {
  const raw = await request.text();
  const v = await verifyStreamSignature(request.headers.get('webhook-signature'), raw, env.CF_STREAM_WEBHOOK_SECRET, now());
  if (!v.ok) return noStore(fail(request, env, v.error, v.status));
  let payload = null; try { payload = JSON.parse(raw); } catch { payload = null; }
  const uid = payload && typeof payload.uid === 'string' ? payload.uid : null;
  if (!uid) return noStore(fail(request, env, 'No video', 400));
  /* readiness is read from Stream on review; this only acknowledges */
  const rows = await db.serviceGet(`action_live_sessions?recording_video_uid=eq.${encodeURIComponent(uid)}&select=id&limit=1`);
  return noStore(reply(request, env, { ok: true, known: Boolean(rows && rows[0]), ready: Boolean(payload.readyToStream) }));
}

/* Cron (every five minutes, only while switched on): the sweep, the Stream
   inputs it says to delete, and up to two recordings to assemble. */
export async function runLiveMaintenance(env, deps = {}) {
  if (!liveEnabled(env) || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { skipped: true };
  const db = deps.db || makeSupabaseStore(env, { fetchImpl: deps.fetchImpl });
  const stream = deps.stream || makeStreamClient(env, { fetchImpl: deps.fetchImpl });
  const out = { swept: 0, inputs_deleted: 0, assembled: [] };
  const swept = await db.serviceRpc('action_live_sweep', { p_now: new Date((deps.now || Date.now)()).toISOString() });
  for (const s of swept || []) {
    out.swept++;
    if (s.input_uid && streamConfigured(env) && (await stream.deleteLiveInput(s.input_uid).catch(() => false))) out.inputs_deleted++;
  }
  /* completed, ended and killed runs deleted their inputs on the way out; a
     finished run's input can no longer move it (observations are ignored and
     /watch needs status 'live') */
  if (!streamConfigured(env)) return out;
  const pending = await db.serviceGet('action_live_sessions?recording_state=eq.pending_assembly&select=id&order=completed_at.asc&limit=2');
  for (const s of pending || []) {
    if (!(await db.serviceRpc('action_live_set_recording', { p_session: s.id, p_state: 'assembling', p_video_uid: null }))) continue;
    try { out.assembled.push({ id: s.id, ...(await assembleRecording(s, { db, stream })) }); }
    catch (e) {
      await db.serviceRpc('action_live_set_recording', { p_session: s.id, p_state: 'failed', p_video_uid: null }).catch(() => null);
      out.assembled.push({ id: s.id, state: 'failed', reason: String(e && e.message || e).slice(0, 200) });
    }
  }
  return out;
}

export { evaluateContinuity };
