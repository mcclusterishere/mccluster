/* Bounded owner-only practice adapter on the existing learning evidence tables.
 * Disabled unless explicitly configured. No news/ops feeds, credentials or mastery writes.
 * HMAC authenticates evaluator payloads because the existing evidence RLS also permits
 * learners to append self-reported evidence. A hash chain alone does not prove grading.
 */
import { readReviewedRelease, releaseBinding, routeReviewedReleases, releaseEnabled } from './reviewed-releases.js';
import { MissionLab, DAY, templates } from '../../../../PRIM3/game/halo/adaptive/engine.mjs';
export const ADAPTIVE_PACK = 'prim3-coordinate-practice';
export const ADAPTIVE_SCENARIO = 'PRIM3-RELAY-DISTANCE-V1';
const VERSION = '1.0.0', TEMPLATE = 'relay-distance-v1', MAX_STEPS = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enc = new TextEncoder();
const fail = (text, status = 400) => { throw Object.assign(new Error(text), { status }); };
const q = encodeURIComponent;
const canonical = v => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const bytes = hex => Uint8Array.from(hex.match(/.{2}/g) || [], x => parseInt(x, 16));
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
async function key(env) {
  if (env.PRIM3_ADAPTIVE_ENABLED !== 'true' || typeof env.PRIM3_ADAPTIVE_SIGNING_KEY !== 'string' || env.PRIM3_ADAPTIVE_SIGNING_KEY.length < 32)
    fail('Adaptive practice is not configured', 503);
  return crypto.subtle.importKey('raw', enc.encode(env.PRIM3_ADAPTIVE_SIGNING_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function seal(k, data) { return { ...data, signature: hex(await crypto.subtle.sign('HMAC', k, enc.encode(canonical(data)))) }; }
async function verify(k, payload) {
  if (!payload || !/^[a-f0-9]{64}$/.test(payload.signature || '')) return false;
  const { signature, ...data } = payload;
  return crypto.subtle.verify('HMAC', k, bytes(signature), enc.encode(canonical(data)));
}
export async function adaptiveEventId(sessionId, step) {
  const h = hex(await crypto.subtle.digest('SHA-256', enc.encode(`prim3-adaptive-v1:${sessionId}:${step}`)));
  return `${h.slice(0,8)}-${h.slice(8,12)}-8${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
}
function normalEvent(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) fail('Event required');
  return { id: e.id, seq: e.seq, type: e.type, questionId: e.questionId ?? null, answer: e.answer ?? null, outcome: e.outcome ?? null, ...(e.checkpointId !== undefined ? {checkpointId:e.checkpointId} : {}) };
}
async function bodyOf(req) {
  const reader = req.body?.getReader(); if (!reader) fail('JSON body required');
  let size = 0; const chunks = [];
  while (true) { const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > 4096) { await reader.cancel(); fail('Body too large', 413); } chunks.push(value); }
  const all = new Uint8Array(size); let at = 0; for (const c of chunks) { all.set(c, at); at += c.length; }
  try { const body = JSON.parse(new TextDecoder().decode(all)); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
  catch { fail('JSON object required'); }
}
function packSession(s) {
  if (!s || s.pack_id !== ADAPTIVE_PACK || s.pack_version !== VERSION || s.scenario_id !== ADAPTIVE_SCENARIO || s.mode !== 'SIMULATION' || s.execution_target !== 'SANDBOX') fail('Practice session not found', 404);
}
async function own(db, env, user, sid) {
  if (!UUID.test(sid)) fail('Session UUID required');
  const rows = await db(env, `learning_lab_sessions?id=eq.${q(sid)}&user_id=eq.${q(user.id)}&select=*&limit=1`);
  packSession(rows?.[0]); return rows[0];
}
async function eventRows(db, env, user, sid) {
  return (await db(env, `learning_evidence_events?session_id=eq.${q(sid)}&user_id=eq.${q(user.id)}&select=*&order=seq.asc&limit=${MAX_STEPS + 2}`)) || [];
}
async function rebuild(db, env, user, sid, k) {
  const session = await own(db, env, user, sid), events = await eventRows(db, env, user, sid);
  if (!events.length || events.length > MAX_STEPS + 1) fail('Practice evidence is incomplete', 409);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.seq !== i + 1 || e.id !== await adaptiveEventId(sid, i) || e.payload?.session_id !== sid ||
      e.payload?.user_id !== user.id || e.payload?.version !== VERSION || !await verify(k, e.payload)) fail('Practice evidence could not be verified', 409);
  }
  const release = events[0].payload;
  if (release.type !== 'release' || release.template_id !== TEMPLATE || !Number.isFinite(release.issued_at)) fail('Invalid release evidence', 409);
  let clock = release.issued_at;
  const lab = new MissionLab({ clock: () => clock, seed: release.seed, initialLevel: release.initial_level ?? 1 });
  const principal = { tenant: 'mccluster-house', user: user.id, role: 'owner' };
  const mission = lab.draft(principal, { country: 'US', region: 'Connecticut', templateId: TEMPLATE });
  lab.review(principal, mission.id, { fictionChecked: true, geographyChecked: true }); lab.release(principal, mission.id);
  const local = lab.start(principal, mission.id);
  for (const e of events.slice(1)) {
    if (e.payload.type !== 'event' || !Number.isFinite(e.payload.received_at) || e.payload.received_at < clock) fail('Invalid event evidence', 409);
    clock = e.payload.received_at;
    let result;
    try { result = lab.submit(principal, local.id, e.payload.action); } catch { fail('Practice replay failed validation', 409); }
    if (canonical(result) !== canonical(e.payload.result)) fail('Assessment result mismatch', 409);
  }
  return { session, events, lab, principal, localId: local.id, setClock: t => { clock = t; } };
}
// Bounded recent practice, not a mastery model or credential ledger. Only fully
// replayed, signed math evidence can seed another session; game outcome adds no points.
async function progression(db, env, user, k) {
  const rows = await db(env, `learning_lab_sessions?user_id=eq.${q(user.id)}&pack_id=eq.${ADAPTIVE_PACK}&pack_version=eq.${VERSION}&outcome=in.(completed,abandoned)&order=ended_at.desc,id.desc&limit=11`);
  const recent = [];
  for (const row of (rows || []).slice(0, 10)) {
    const state = await rebuild(db, env, user, row.id, k);
    const flow = state.lab.view(state.principal, state.localId);
    if (flow.phase !== 'debrief' || state.session.outcome !== flow.debrief.gameOutcome ||
      Date.parse(state.session.ended_at) !== state.events.at(-1).payload.received_at)
      fail('Practice history could not be verified', 409);
    const initial = state.events[0].payload.initial_level ?? 1;
    const next = flow.debrief.independent >= 2 ? flow.level : Math.min(initial, flow.level);
    recent.push({ session_id: row.id, ended_at: state.session.ended_at, next_level: next,
      attempts: flow.debrief.attempts, correct: flow.debrief.correct, independent: flow.debrief.independent });
  }
  return { skill: 'coordinate-distance', next_level: recent[0]?.next_level ?? 1,
    basis_session_id: recent[0]?.session_id ?? null, recent, window_limit: 10,
    has_older_sessions: (rows || []).length > 10, competency_credit: false,
    label: 'Verified recent practice; not a mastery rating or certification.' };
}
function response(state, result = null) {
  const flow = state.lab.view(state.principal, state.localId);
  flow.mission.id = state.session.id;
  const binding=state.events[0].payload.reviewed_release;
  if(binding) flow.mission.expiresAt=Date.parse(binding.expires_at);
  const solved=binding ? state.events.filter(e=>e.payload.action?.type==='answer'&&e.payload.result?.correct).length : 0;
  flow.debrief.label = 'Server-validated practice evidence. No Principles credit or certification.';
  return { ok: true, session_id: state.session.id, pack_id: ADAPTIVE_PACK, flow, result,
    ...(binding?{released_mission:{...binding,next_checkpoint_id:binding.checkpoint_ids[solved]??null,math_checkpoints_completed:solved,tactical_evidence:'browser-reported; not verified completion'}}:{}),
    evidence: { verified: true, event_count: state.events.length, closed: state.session.outcome !== 'in_progress' },
    tactical: { href: 'prim3-transit.html', title: 'Transit / Relay', outcome_source: 'learner-reported' } };
}
async function closeIfFinished(state, db, env) {
  const flow = state.lab.view(state.principal, state.localId);
  if (flow.phase === 'debrief' && state.session.outcome === 'in_progress') {
    const rows = await db(env, `learning_lab_sessions?id=eq.${q(state.session.id)}&user_id=eq.${q(state.session.user_id)}&outcome=eq.in_progress`, {
      method: 'PATCH', prefer: 'return=representation', body: { outcome: flow.debrief.gameOutcome,
        ended_at: new Date(state.events.at(-1).payload.received_at).toISOString() } });
    if (rows?.[0]) state.session = rows[0];
    else state.session = await own(db, env, { id: state.session.user_id }, state.session.id);
    if (state.session.outcome === 'in_progress') fail('Evidence saved; retry closing the session', 503);
  }
}
async function insertEvent(db, env, user, sid, step, payload) {
  await db(env, 'learning_evidence_events', { method: 'POST', prefer: 'return=representation', body: {
    id: await adaptiveEventId(sid, step), session_id: sid, user_id: user.id, seq: 1, event_hash: '0'.repeat(64),
    event_type: step === 0 ? 'start' : payload.action.type === 'finish' ? 'complete' : payload.action.type === 'hint' ? 'hint' : 'decision',
    status: payload.result?.correct === false ? 'incorrect' : payload.result?.correct === true ? 'success' : 'info',
    payload, occurred_at: new Date(step === 0 ? payload.issued_at : payload.received_at).toISOString(),
  } });
}

/** Called only after the existing house-owner gate; db is the existing service adapter. */
export async function routeAdaptive(request, env, user, parts, db) {
  if (!UUID.test(user?.id || '')) fail('Owner identity required', 403);
  const enabled = env.PRIM3_ADAPTIVE_ENABLED === 'true' && typeof env.PRIM3_ADAPTIVE_SIGNING_KEY === 'string' && env.PRIM3_ADAPTIVE_SIGNING_KEY.length >= 32;
  if (parts.length === 0 && request.method === 'GET') return { ok: true, enabled, audience: 'house-owner',
    owner_id: user.id, pack_id: ADAPTIVE_PACK, template_id: TEMPLATE, template: templates[TEMPLATE], mode: 'offline-practice',
    country: 'US', region: 'Connecticut', availability_hours: 24, max_events: MAX_STEPS, requires_owner_review: true, releases_enabled:releaseEnabled(env) };
  const k = await key(env);
  if(parts[0]==='releases') return routeReviewedReleases(request,env,user,parts,db,bodyOf);
  if (parts.length === 1 && parts[0] === 'progress' && request.method === 'GET')
    return { ok: true, progress: await progression(db, env, user, k) };
  if (parts[0] !== 'sessions') fail('Practice route not found', 404);
  if (parts.length === 1 && request.method === 'POST') {
    const body = await bodyOf(request), sid = String(body.session_id || '').toLowerCase();
    if (!UUID.test(sid) || body.template_id !== TEMPLATE || body.review?.fictionChecked !== true || body.review?.geographyChecked !== true)
      fail('Session ID, approved template and owner review required');
    let reviewedRelease=null;
    let rows;
    if(body.release_id!=null){
      reviewedRelease=await readReviewedRelease(db,env,user,body.release_id);
      const claimed=await db(env,'rpc/prim3_release_claim',{method:'POST',body:{p_owner:user.id,p_release:reviewedRelease.id,p_session:sid,p_seed:crypto.getRandomValues(new Uint32Array(1))[0]%2**31}});
      rows=[claimed];
    } else rows = await db(env, `learning_lab_sessions?id=eq.${q(sid)}&user_id=eq.${q(user.id)}&select=*&limit=1`);
    if (!rows?.length) {
      try { rows = await db(env, 'learning_lab_sessions', { method: 'POST', prefer: 'return=representation', body: {
        id: sid, user_id: user.id, pack_id: ADAPTIVE_PACK, pack_version: VERSION, scenario_id: ADAPTIVE_SCENARIO,
        mode: 'SIMULATION', execution_target: 'SANDBOX', difficulty: 'FOUNDATION', seed: crypto.getRandomValues(new Uint32Array(1))[0] % 2 ** 31,
      } }); } catch (error) {
        rows = await db(env, `learning_lab_sessions?id=eq.${q(sid)}&user_id=eq.${q(user.id)}&select=*&limit=1`);
        if (!rows?.length) throw error;
      }
    }
    packSession(rows?.[0]);
    const existing = await eventRows(db, env, user, sid);
    if (!existing.length) {
      const issued = Date.parse(rows[0].started_at);
      if (!Number.isSafeInteger(Number(rows[0].seed)) || Number(rows[0].seed) < 0 || Number(rows[0].seed) >= 2 ** 31) fail('Invalid session seed', 409);
      if (!Number.isFinite(issued) || issued > Date.now() || Date.now() - issued >= DAY) fail('Session release is unavailable', 409);
      const progress = await progression(db, env, user, k);
      const payload = await seal(k, { version: VERSION, type: 'release', session_id: sid, user_id: user.id,
        template_id: TEMPLATE, issued_at: issued, seed: Number(rows[0].seed), initial_level: progress.next_level, basis_session_id: progress.basis_session_id, review: { fictionChecked: true, geographyChecked: true }, scope: 'mccluster-house', ...(reviewedRelease?{reviewed_release:releaseBinding(reviewedRelease)}:{}) });
      try { await insertEvent(db, env, user, sid, 0, payload); }
      catch (error) { if (!(await eventRows(db, env, user, sid)).length) throw error; }
    }
    return response(await rebuild(db, env, user, sid, k));
  }
  const sid = String(parts[1] || '').toLowerCase();
  if (!UUID.test(sid)) fail('Session UUID required');
  if (parts.length === 2 && request.method === 'GET') return response(await rebuild(db, env, user, sid, k));
  if (parts.length !== 3 || parts[2] !== 'events' || request.method !== 'POST') fail('Practice route not found', 404);
  const action = normalEvent(await bodyOf(request));
  let state = await rebuild(db, env, user, sid, k);
  const prior = state.events.slice(1).find(e => e.payload.action.seq === action.seq || e.payload.action.id === action.id);
  if (prior) {
    if (canonical(prior.payload.action) !== canonical(action)) fail('Conflicting event retry', 409);
    await closeIfFinished(state, db, env); return response(state, prior.payload.result);
  }
  if (state.session.outcome !== 'in_progress') fail('Session is closed', 409);
  const binding=state.events[0].payload.reviewed_release;
  if(binding){
    const release=await readReviewedRelease(db,env,user,binding.id,{available:true});
    if(release.recipe_hash!==binding.recipe_hash)fail('Release identity mismatch',409);
    const solved=state.events.filter(e=>e.payload.action?.type==='answer'&&e.payload.result?.correct).length;
    if(['answer','hint'].includes(action.type)&&(!binding.checkpoint_ids[solved]||action.checkpointId!==binding.checkpoint_ids[solved]))fail('Current released checkpoint required',409);
    if(action.type==='finish'&&action.outcome==='completed'&&solved!==binding.checkpoint_ids.length)fail('Complete the math checkpoints or save an abandoned debrief',409);
  }
  if (!Number.isSafeInteger(action.seq) || action.seq < 1 || action.seq > MAX_STEPS || (action.seq === MAX_STEPS && action.type !== 'finish')) fail('Finish this bounded practice session', 409);
  if (['answer', 'hint', 'finish'].includes(action.type) && !state.lab.view(state.principal, state.localId).tacticalHandoff) fail('Record the tactical handoff before assessment', 409);
  const received = Date.now();
  if (received < (state.events.at(-1).payload.received_at ?? state.events[0].payload.issued_at)) fail('Server clock is unavailable', 503);
  state.setClock(received);
  let result;
  try { result = state.lab.submit(state.principal, state.localId, action); }
  catch (e) { fail(e.message, /expired|unavailable|order|replay/.test(e.message) ? 409 : 400); }
  const payload = await seal(k, { version: VERSION, type: 'event', session_id: sid, user_id: user.id, action, result, received_at: received });
  try { await insertEvent(db, env, user, sid, action.seq, payload); }
  catch (error) {
    // A duplicate PK rolls back the entire insert/chain trigger. Read before retrying uncertain I/O.
    state = await rebuild(db, env, user, sid, k);
    const stored = state.events.find(e => e.payload.type === 'event' && e.payload.action.seq === action.seq);
    if (!stored) throw error;
    if (canonical(stored.payload.action) !== canonical(action)) fail('Conflicting event retry', 409);
  }
  state = await rebuild(db, env, user, sid, k);
  await closeIfFinished(state, db, env);
  return response(state, state.events.find(e => e.payload.type === 'event' && e.payload.action.seq === action.seq).payload.result);
}
