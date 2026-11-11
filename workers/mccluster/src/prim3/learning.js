/* PRIM3 LEARNING EVIDENCE (the LMS record on the shared data plane).

   What a learner did in the SANDBOX building, what they earned elsewhere, where
   they are in a pathway, and the FEMA HSEEP exercise record. Tables:
   supabase/migrations/20261103182544_learning_evidence_v1.sql (learning_*), the
   private bucket `learning-credentials`. Scenario packs, the federal and industry
   catalogs and the pathways are read from the repository at build time, so a
   session can only name a scenario and pack version that exist.

   Audience: owner, 2026-11-03: "the whole learning management system is going to
   be on my private account". LEARNING_AUDIENCE is the one switch. 'house-owner'
   (today) lets only the McCluster house owner in; 'learners' opens it to every
   signed-in M Account, each seeing only their own record, while review stays
   with the house owner and listed reviewers (learning_reviewers).

   Equity Uprise prepares and records. It never issues a FEMA, CISA, IRS, CompTIA
   or BICSI credential, never stores a FEMA SID, and simulation alone never rates
   a competency above Demonstrated.

   GET  /v1/prim3/learning                          registry: audience, packs, pathways version
   GET  /v1/prim3/learning/catalog                  official courses with "prepares you for" copy
   GET  /v1/prim3/learning/pathways                 the seven pathways
   GET  /v1/prim3/learning/pathways/:id             one pathway with this learner's status
   POST /v1/prim3/learning/pathways/:id/enroll
   GET  /v1/prim3/learning/sessions                 POST to start one
   GET  /v1/prim3/learning/sessions/:id             with its evidence chain
   POST /v1/prim3/learning/sessions/:id/events      append evidence (hash-chained in the database)
   POST /v1/prim3/learning/sessions/:id/complete    close; automated ratings capped at Demonstrated
   POST /v1/prim3/learning/credentials/upload-url   signed upload to the private bucket
   GET  /v1/prim3/learning/credentials              POST to record an uploaded certificate
   GET  /v1/prim3/learning/review/queue             reviewer
   POST /v1/prim3/learning/review/credentials/:id   reviewer: verify | reject
   GET  /v1/prim3/learning/review/credentials/:id/file   reviewer: short-lived download link
   POST /v1/prim3/learning/review/ratings           reviewer: human competency rating
   GET  /v1/prim3/learning/exercises                POST (reviewer) to plan one
   GET  /v1/prim3/learning/exercises/:id            PATCH (reviewer) status/dates
   POST /v1/prim3/learning/exercises/:id/participants | evaluations | improvements | ics214
   PUT  /v1/prim3/learning/exercises/:id/hotwash | aar
   PATCH /v1/prim3/learning/improvements/:id */
import { fail, reply } from '../lib/http.js';
import { routeAdaptive, ADAPTIVE_PACK } from './adaptive-learning.js';
import PATHWAYS from '../../../../docs/design/equity-uprise-development/LEARNING-PATHWAYS.json' with { type: 'json' };
import FEDERAL from '../../../../docs/design/equity-uprise-development/FEDERAL-TRAINING-CATALOG.json' with { type: 'json' };
import INDUSTRY from '../../../../docs/design/equity-uprise-development/INDUSTRY-CERTIFICATION-MAP.json' with { type: 'json' };
import OPS_PACK from '../../../../docs/design/equity-uprise-building/production/lab-runtime/fema-building-ops-scenario-pack-v1.json' with { type: 'json' };
import HSEEP_PACK from '../../../../docs/design/equity-uprise-building/production/lab-runtime/hseep-building-safety-scenario-pack-v1.json' with { type: 'json' };
import CISA_PACK from '../../../../docs/design/equity-uprise-building/production/lab-runtime/cisa-itot-scenario-pack-v1.json' with { type: 'json' };
import PSC_PACK from '../../../../docs/design/equity-uprise-building/production/lab-runtime/public-service-scenario-pack-v1.json' with { type: 'json' };
import DIST_PACK from '../../../../docs/design/equity-uprise-building/production/lab-runtime/distributed-building-scenario-pack-v1.json' with { type: 'json' };
import IT_LABS from '../../../../docs/design/equity-uprise-building/production/electronics/generated/equity-uprise-it-lab-catalog-v1.json' with { type: 'json' };

export const LEARNING_PATH = '/v1/prim3/learning';
/* THE SWITCH. 'house-owner' today; 'learners' opens the LMS to every signed-in account. */
export const LEARNING_AUDIENCE = 'house-owner';

export const CREDENTIAL_BUCKET = 'learning-credentials';
const MAX_EVENTS_PER_CALL = 50;
const MAX_PAYLOAD_BYTES = 8192;
const AUTOMATED_CEILING = ['Aware', 'Trained', 'Practicing', 'Demonstrated'];
const STATES = [...AUTOMATED_CEILING, 'Verified', 'Applied', 'Mentor'];
const EVENT_TYPES = new Set(['start', 'inspect', 'action', 'decision', 'hint', 'safety_violation', 'criterion', 'artifact', 'role_change', 'note', 'complete']);
const EVENT_STATUS = new Set(['success', 'incorrect', 'blocked', 'role_refused', 'error', 'info']);
const OUTCOMES = new Set(['completed', 'incomplete', 'abandoned', 'safety_stop']);
const DIFFICULTIES = new Set(['FOUNDATION', 'TECHNICIAN', 'ADMIN', 'ADVANCED', 'EXPERT']);
const EXERCISE_TYPES = new Set(['seminar', 'workshop', 'tabletop', 'game', 'drill', 'functional', 'full_scale']);
const EXERCISE_STATUS = new Set(['planned', 'conducted', 'evaluated', 'aar_draft', 'aar_final', 'closed']);
const EXERCISE_ROLES = new Set(['player', 'controller', 'evaluator', 'facilitator', 'observer']);
const ITEM_STATUS = new Set(['open', 'in_progress', 'closed', 'deferred']);
const UPLOAD_TYPES = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_UPLOAD = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ROLE_ID = /^[a-z][a-z_]{2,40}$/;
const COMPETENCY = /^(CORE|SHR|PSC|RSP|ENT|MED|OPS)-\d{2}$/;

/* ---------- registry built from the repository ---------- */
const PACK_SOURCES = {
  'fema-building-ops': OPS_PACK,
  'hseep-building-safety': HSEEP_PACK,
  'cisa-itot': CISA_PACK,
  'public-service': PSC_PACK,
  'distributed-building': DIST_PACK,
  'it-lab-catalog': IT_LABS,
};

function buildRegistry() {
  const packs = new Map();
  for (const [packId, spec] of Object.entries(PATHWAYS.packs)) {
    const data = PACK_SOURCES[packId];
    if (!data) throw new Error(`learning pack ${packId} is not bundled`);
    const items = data[spec.list_field || 'scenarios'] || [];
    const scenarios = new Map();
    for (const item of items) {
      const actions = (item.actions || []).map((a) => a.id || a.action_id).filter(Boolean);
      scenarios.set(item[spec.id_field], {
        title: item.title,
        actions: new Set(actions),
        competency_ids: item.competency_ids || [],
        federal_training_ids: item.federal_training_ids || [],
        exercise_type: item.hseep?.exercise_type || null,
        eeg: new Set((item.hseep?.eeg || []).map((c) => c.criterion_id)),
        objectives: (item.hseep?.objectives || []).map((o) => o.objective_id),
        core_capabilities: item.hseep?.core_capabilities || [],
      });
    }
    packs.set(packId, { pack_id: packId, pack_version: String(data[spec.version_field]), scenarios });
  }
  const roles = new Set([
    ...Object.keys(HSEEP_PACK.ics?.positions || {}),
    ...Object.keys(HSEEP_PACK.ics?.building_roles || {}),
    ...Object.keys(HSEEP_PACK.ics?.exercise_staff || {}),
  ]);
  const courses = new Map();
  for (const r of FEDERAL.records) {
    courses.set(r.catalog_id, { catalog_id: r.catalog_id, issuer: r.agency, course_code: r.course_code, title: r.official_title, official_url: r.official_url, kind: 'federal', refresh_due: r.refresh_due || null });
  }
  for (const p of FEDERAL.credential_programs || []) {
    courses.set(p.program_id, { catalog_id: p.program_id, issuer: p.agency, course_code: null, title: p.title, official_url: p.official_url, kind: 'federal-program' });
  }
  for (const c of INDUSTRY.certifications) {
    courses.set(c.cert_id, { catalog_id: c.cert_id, issuer: c.issuer, course_code: c.exams.map((e) => e.exam_code).join(' / '), title: c.title, official_url: c.official_url, kind: 'industry', exam_transition: c.exam_transition || null });
  }
  const pathways = new Map(PATHWAYS.pathways.map((p) => [p.pathway_id, p]));
  return { packs, roles, courses, pathways };
}
let REGISTRY = null;
export function registry() {
  REGISTRY ||= buildRegistry();
  return REGISTRY;
}

export function preparesCopy(course) {
  return `Prepares you for ${course.course_code ? course.course_code + ' ' : ''}${course.title} from ${course.issuer}. Take it with ${course.issuer}, then upload your certificate here.`;
}

/* ---------- database (service role; RLS still describes who may see what) ---------- */
function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
async function db(env, path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' };
  if (prefer) headers.prefer = prefer;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12_000) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    // Database guards (check constraints, the append-only and reviewer triggers) are the learner's answer, not an outage.
    if (res.status === 400 || res.status === 409) throw bad(data?.message || 'The learning record refused that change', 409);
    if (res.status === 403) throw bad('Not allowed', 403);
    throw bad('Learning record is unavailable right now', 503);
  }
  return data;
}
const q = encodeURIComponent;
async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object');
    return body;
  } catch { throw bad('A JSON object body is required'); }
}
function text(value, max, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`${field} is required`);
    return null;
  }
  const s = String(value).trim();
  if (!s && required) throw bad(`${field} is required`);
  if (s.length > max) throw bad(`${field} is too long`);
  return s;
}
function isoDate(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') { if (required) throw bad(`${field} is required`); return null; }
  if (!DATE.test(String(value)) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw bad(`${field} must be YYYY-MM-DD`);
  return String(value);
}
function isoTime(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const t = Date.parse(String(value));
  if (Number.isNaN(t)) throw bad(`${field} must be a timestamp`);
  return new Date(t).toISOString();
}
function uuid(value, field) {
  if (!UUID.test(String(value || ''))) throw bad(`${field} must be a UUID`);
  return String(value).toLowerCase();
}

/* ---------- access ---------- */
async function reviewerRow(env, userId) {
  const rows = await db(env, `learning_reviewers?user_id=eq.${q(userId)}&active=is.true&select=user_id,role&limit=1`);
  return rows?.[0] || null;
}
async function learner(request, env, options) {
  if (LEARNING_AUDIENCE === 'house-owner') {
    const user = await options.requireHouseOwner(request, env);
    return { ...user, is_house_owner: true };
  }
  const user = typeof options.authUser === 'function' ? await options.authUser(request, env) : null;
  if (!user?.id) throw bad('Authentication required', 401);
  return user;
}
async function reviewer(request, env, options) {
  if (LEARNING_AUDIENCE === 'house-owner') return learner(request, env, options);
  try {
    const owner = await options.requireHouseOwner(request, env);
    return { ...owner, is_house_owner: true };
  } catch (error) {
    if (error.status !== 403) throw error;
  }
  const user = await learner(request, env, options);
  if (!(await reviewerRow(env, user.id))) throw bad('Reviewer access required', 403);
  return user;
}

/* ---------- registry routes ---------- */
function registryBody() {
  const reg = registry();
  return {
    ok: true,
    audience: LEARNING_AUDIENCE,
    pathways_version: PATHWAYS.pathways_version,
    rule: PATHWAYS.rule,
    automated_ceiling: 'Demonstrated',
    credential_is_not_competency: true,
    packs: [...reg.packs.values()].map((p) => ({ pack_id: p.pack_id, pack_version: p.pack_version, scenario_count: p.scenarios.size })),
  };
}
function catalogBody() {
  return {
    ok: true,
    wording_rule: PATHWAYS.learner_wording_rule,
    courses: [...registry().courses.values()].map((c) => ({ ...c, learner_copy: preparesCopy(c) })),
    retired_do_not_cite: FEDERAL.retired_do_not_cite || [],
  };
}

/* ---------- sessions and evidence ---------- */
function scenarioFor(packId, packVersion, scenarioId) {
  const pack = registry().packs.get(String(packId || ''));
  if (!pack) throw bad('Unknown pack_id');
  if (String(packVersion || '') !== pack.pack_version) throw bad(`pack_version must be ${pack.pack_version} for ${pack.pack_id}`);
  const scenario = pack.scenarios.get(String(scenarioId || ''));
  if (!scenario) throw bad(`Unknown scenario_id for ${pack.pack_id}`);
  return { pack, scenario };
}

async function startSession(request, env, user) {
  const body = await readJson(request);
  const { pack } = scenarioFor(body.pack_id, body.pack_version, body.scenario_id);
  const mode = body.mode === undefined ? 'SIMULATION' : String(body.mode);
  if (!['SIMULATION', 'SANDBOX'].includes(mode)) throw bad('mode must be SIMULATION or SANDBOX; LIVE is never allowed');
  if (body.execution_target !== undefined && body.execution_target !== 'SANDBOX') throw bad('execution_target must be SANDBOX');
  const difficulty = body.difficulty === undefined || body.difficulty === null ? null : String(body.difficulty).toUpperCase();
  if (difficulty && !DIFFICULTIES.has(difficulty)) throw bad('Unknown difficulty');
  const seed = body.seed === undefined ? Math.floor(Math.random() * 2 ** 31) : Number(body.seed);
  if (!Number.isSafeInteger(seed) || seed < 0) throw bad('seed must be a non-negative integer');
  const icsRole = body.ics_role ? String(body.ics_role) : null;
  if (icsRole && !registry().roles.has(icsRole)) throw bad('Unknown ics_role');
  const exerciseId = body.exercise_id ? uuid(body.exercise_id, 'exercise_id') : null;
  const row = {
    user_id: user.id, pack_id: pack.pack_id, pack_version: pack.pack_version, scenario_id: String(body.scenario_id),
    mode, execution_target: 'SANDBOX', difficulty, seed, exercise_id: exerciseId, ics_role: icsRole,
  };
  const rows = await db(env, 'learning_lab_sessions', { method: 'POST', body: row, prefer: 'return=representation' });
  const session = rows?.[0] || row;
  await db(env, 'learning_evidence_events', { method: 'POST', prefer: 'return=minimal', body: {
    session_id: session.id, user_id: user.id, seq: 1, event_type: 'start', status: 'info', actor_role: icsRole,
    payload: { pack_id: pack.pack_id, pack_version: pack.pack_version, scenario_id: row.scenario_id, seed, mode, difficulty }, event_hash: '0'.repeat(64),
  } });
  return { ok: true, session };
}

async function ownSession(env, user, id) {
  const rows = await db(env, `learning_lab_sessions?id=eq.${q(uuid(id, 'session id'))}&user_id=eq.${q(user.id)}&select=*&limit=1`);
  if (!rows?.length) throw bad('Session not found', 404);
  return rows[0];
}

export function validateEvent(raw, scenario) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('Each event must be an object');
  const type = String(raw.event_type || '');
  if (!EVENT_TYPES.has(type) || type === 'start') throw bad(`Unknown event_type ${type || '(missing)'}`);
  const actionId = raw.action_id === undefined || raw.action_id === null ? null : String(raw.action_id);
  if (['inspect', 'action', 'decision'].includes(type) && scenario.actions.size && (!actionId || !scenario.actions.has(actionId))) {
    throw bad(`action_id ${actionId || '(missing)'} is not part of this scenario`);
  }
  const status = raw.status === undefined || raw.status === null ? null : String(raw.status);
  if (status && !EVENT_STATUS.has(status)) throw bad(`Unknown status ${status}`);
  const role = raw.actor_role ? String(raw.actor_role) : null;
  if (role && (!ROLE_ID.test(role) || !registry().roles.has(role))) throw bad(`Unknown actor_role ${role}`);
  const payload = raw.payload === undefined ? {} : raw.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw bad('payload must be an object');
  if (new TextEncoder().encode(JSON.stringify(payload)).length > MAX_PAYLOAD_BYTES) throw bad('payload is too large');
  return { event_type: type, action_id: actionId, status, actor_role: role, payload, occurred_at: isoTime(raw.occurred_at, 'occurred_at') || undefined };
}

async function appendEvents(request, env, user, id) {
  const session = await ownSession(env, user, id);
  if (session.pack_id === ADAPTIVE_PACK) throw bad('Use the validated adaptive practice endpoint', 409);
  if (session.outcome !== 'in_progress') throw bad('This session is closed; its evidence is final', 409);
  const body = await readJson(request);
  const list = Array.isArray(body.events) ? body.events : [body];
  if (!list.length || list.length > MAX_EVENTS_PER_CALL) throw bad(`Send 1 to ${MAX_EVENTS_PER_CALL} events`);
  const { scenario } = scenarioFor(session.pack_id, session.pack_version, session.scenario_id);
  const events = list.map((raw) => validateEvent(raw, scenario));
  const appended = [];
  // One at a time: the database assigns seq and the hash chain under a row lock.
  for (const event of events) {
    const rows = await db(env, 'learning_evidence_events', { method: 'POST', prefer: 'return=representation', body: {
      session_id: session.id, user_id: user.id, seq: 1, event_hash: '0'.repeat(64), ...event,
    } });
    const row = rows?.[0];
    if (row) appended.push({ seq: row.seq, event_type: row.event_type, action_id: row.action_id, event_hash: row.event_hash, prev_hash: row.prev_hash });
  }
  return { ok: true, session_id: session.id, appended };
}

async function completeSession(request, env, user, id) {
  const session = await ownSession(env, user, id);
  if (session.pack_id === ADAPTIVE_PACK) throw bad('Use the validated adaptive practice endpoint', 409);
  if (session.outcome !== 'in_progress') throw bad('This session is already closed', 409);
  const body = await readJson(request);
  const outcome = String(body.outcome || '');
  if (!OUTCOMES.has(outcome)) throw bad('outcome must be completed, incomplete, abandoned or safety_stop');
  const bundle = body.evidence_bundle_sha256 ? String(body.evidence_bundle_sha256).toLowerCase() : null;
  if (bundle && !SHA.test(bundle)) throw bad('evidence_bundle_sha256 must be 64 hex characters');
  const { scenario } = scenarioFor(session.pack_id, session.pack_version, session.scenario_id);
  const signals = Array.isArray(body.competency_signals) ? body.competency_signals : [];
  if (signals.length > 12) throw bad('Too many competency signals');
  const ratings = signals.map((s) => {
    const competency = String(s?.competency_id || '');
    const state = String(s?.state || '');
    if (!COMPETENCY.test(competency)) throw bad(`Unknown competency ${competency}`);
    if (scenario.competency_ids.length && !scenario.competency_ids.includes(competency)) throw bad(`${competency} is not assessed by this scenario`);
    if (!STATES.includes(state)) throw bad(`Unknown competency state ${state}`);
    if (!AUTOMATED_CEILING.includes(state)) throw bad('Simulation evidence alone never rates above Demonstrated; Verified and higher need a human reviewer');
    return { user_id: user.id, competency_id: competency, state, source: 'automated', session_id: session.id, evidence_sha256: bundle };
  });
  if (ratings.length && outcome !== 'completed') throw bad('Only a completed session can carry competency signals');
  await db(env, 'learning_evidence_events', { method: 'POST', prefer: 'return=minimal', body: {
    session_id: session.id, user_id: user.id, seq: 1, event_hash: '0'.repeat(64), event_type: 'complete', status: 'info',
    payload: { outcome, evidence_bundle_sha256: bundle, competency_signals: ratings.map((r) => ({ competency_id: r.competency_id, state: r.state })) },
  } });
  const closed = await db(env, `learning_lab_sessions?id=eq.${q(session.id)}&user_id=eq.${q(user.id)}&outcome=eq.in_progress`, {
    method: 'PATCH', prefer: 'return=representation', body: { outcome, ended_at: new Date().toISOString(), evidence_bundle_sha256: bundle },
  });
  if (!closed?.length) throw bad('This session was closed by another request', 409);
  if (ratings.length) await db(env, 'learning_competency_ratings', { method: 'POST', prefer: 'return=minimal', body: ratings });
  return { ok: true, session: closed[0], automated_ratings: ratings.map(({ competency_id, state }) => ({ competency_id, state })) };
}

/* ---------- credentials ---------- */
async function uploadUrl(request, env, user) {
  const body = await readJson(request);
  const ext = UPLOAD_TYPES[String(body.mime_type || '').toLowerCase()];
  if (!ext) throw bad('Upload a PDF, PNG, JPEG or WebP certificate');
  const size = Number(body.byte_size || 0);
  if (!(size > 0)) throw bad('byte_size is required');
  if (size > MAX_UPLOAD) throw bad('Certificates are limited to 10 MB', 413);
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/upload/sign/${CREDENTIAL_BUCKET}/${path}`, {
    method: 'POST', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }, signal: AbortSignal.timeout(12_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.url) throw bad('Could not create the upload', 502);
  return { ok: true, bucket: CREDENTIAL_BUCKET, storage_path: path, upload_url: `${env.SUPABASE_URL}/storage/v1${data.url}`, method: 'PUT', max_bytes: MAX_UPLOAD };
}

async function objectExists(env, path) {
  const [folder, name] = path.split('/');
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/${CREDENTIAL_BUCKET}`, {
    method: 'POST', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prefix: folder, search: name, limit: 1 }), signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw bad('Could not check the uploaded file', 503);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.some((r) => r?.name === name);
}

async function recordCredential(request, env, user) {
  const body = await readJson(request);
  if ('fema_sid' in body || 'sid' in body) throw bad('Do not send a FEMA SID; Equity Uprise never stores it');
  const catalogId = body.catalog_id ? String(body.catalog_id) : null;
  const course = catalogId ? registry().courses.get(catalogId) : null;
  if (catalogId && !course) throw bad('Unknown catalog_id');
  const external = text(body.external_program, 200, 'external_program');
  if (!course && !external) throw bad('catalog_id or external_program is required');
  const path = body.certificate_path ? String(body.certificate_path) : null;
  if (path) {
    const [folder, file] = path.split('/');
    if (folder !== user.id || !/^[0-9a-f-]{36}\.(pdf|png|jpg|webp)$/.test(file || '')) throw bad('certificate_path must be a file you uploaded');
    if (!(await objectExists(env, path))) throw bad('Upload the certificate first', 409);
  }
  const sha = body.certificate_sha256 ? String(body.certificate_sha256).toLowerCase() : null;
  if (sha && !SHA.test(sha)) throw bad('certificate_sha256 must be 64 hex characters');
  if (path && !sha) throw bad('certificate_sha256 is required with a file');
  const mime = body.mime_type ? String(body.mime_type).toLowerCase() : null;
  if (mime && !UPLOAD_TYPES[mime]) throw bad('Unsupported mime_type');
  const completion = isoDate(body.completion_date, 'completion_date', { required: true });
  if (Date.parse(`${completion}T00:00:00Z`) > Date.now() + 86_400_000) throw bad('completion_date cannot be in the future');
  const row = {
    user_id: user.id,
    issuer: course ? course.issuer : text(body.issuer, 120, 'issuer', { required: true }),
    catalog_id: course ? course.catalog_id : null,
    external_program: external,
    course_code: course ? course.course_code : text(body.course_code, 40, 'course_code'),
    title: course ? course.title : text(body.title, 300, 'title', { required: true }),
    completion_date: completion,
    expires_on: isoDate(body.expires_on, 'expires_on'),
    certificate_path: path,
    certificate_sha256: sha,
    mime_type: mime,
    byte_size: body.byte_size === undefined ? null : Number(body.byte_size),
    verification_status: 'self_reported',
  };
  const rows = await db(env, 'learning_external_credentials', { method: 'POST', prefer: 'return=representation', body: row });
  return { ok: true, credential: rows?.[0] || row, note: 'Recorded as self-reported until a reviewer checks it against the issuer.' };
}

/* ---------- pathway status ---------- */
export function pathwayStatus(pathway, evidence) {
  const { credentials = [], sessions = [], ratings = [], evaluatorExercises = 0, evaluations = 0 } = evidence;
  const credentialFor = (step) => {
    const ev = step.evidence_required;
    const matches = credentials.filter((c) => (ev.catalog_id ? c.catalog_id === ev.catalog_id : c.external_program === ev.external_program) && c.verification_status !== 'rejected');
    const ok = matches.find((c) => ev.min_verification !== 'reviewer_verified' || c.verification_status === 'reviewer_verified');
    return { ok, pending: matches.length > 0 };
  };
  const sessionDone = (s, role) => sessions.some((x) => x.pack_id === s.pack_id && x.scenario_id === s.scenario_id && x.outcome === 'completed' && (!role || x.ics_role === role));
  const latest = new Map();
  for (const r of [...ratings].sort((a, b) => String(a.rated_at).localeCompare(String(b.rated_at)))) latest.set(r.competency_id, r.state);
  const rank = (state) => STATES.indexOf(state);
  const satisfied = new Set();
  const steps = pathway.steps.map((step) => {
    const ev = step.evidence_required;
    let state = 'needed';
    let detail = null;
    if (ev.type === 'external_credential') {
      const c = credentialFor(step);
      if (c.ok) { state = 'satisfied'; detail = { credential_id: c.ok.id, verification_status: c.ok.verification_status }; }
      else if (c.pending) state = 'evidence_submitted';
    } else if (ev.type === 'lab_session') {
      const done = ev.scenarios.filter((s) => sessionDone(s, ev.ics_role));
      detail = { completed: done.length, of: ev.scenarios.length };
      if (done.length === ev.scenarios.length) state = 'satisfied';
      else if (done.length) state = 'in_progress';
    } else if (ev.type === 'exercise_role') {
      if (evaluatorExercises > 0 && evaluations >= (ev.min_eeg_observations || 1)) state = 'satisfied';
      detail = { exercises: evaluatorExercises, eeg_observations: evaluations };
    } else if (ev.type === 'competency_rating') {
      if (ev.competency_ids.every((c) => rank(latest.get(c)) >= rank(ev.min_state))) state = 'satisfied';
    }
    if (state === 'satisfied') satisfied.add(step.step_id);
    return { step, state, detail };
  });
  const unlocked = new Map((pathway.open_unlocks || []).map((u) => [`${u.pack_id}/${u.scenario_id}`, u]));
  const out = steps.map(({ step, state, detail }) => {
    const ready = step.requires.every((r) => satisfied.has(r));
    if (state === 'satisfied') for (const u of step.unlocks) unlocked.set(`${u.pack_id}/${u.scenario_id}`, u);
    return {
      step_id: step.step_id, kind: step.kind, title: step.title, optional: step.optional,
      issuer: step.issuer || null, official_url: step.official_url || null, learner_copy: step.learner_copy || null,
      evidence_required: step.evidence_required, unlocks: step.unlocks,
      status: state === 'satisfied' ? 'satisfied' : ready ? (state === 'needed' ? 'available' : state) : 'locked',
      detail,
    };
  });
  const required = out.filter((s) => !s.optional);
  return {
    steps: out,
    unlocked_scenarios: [...unlocked.values()],
    complete: required.every((s) => s.status === 'satisfied'),
  };
}

async function pathwayForUser(env, user, pathwayId) {
  const pathway = registry().pathways.get(pathwayId);
  if (!pathway) throw bad('Pathway not found', 404);
  const uid = q(user.id);
  const [credentials, sessions, ratings, roles, evaluations, enrollment] = await Promise.all([
    db(env, `learning_external_credentials?user_id=eq.${uid}&select=id,catalog_id,external_program,verification_status&limit=500`),
    db(env, `learning_lab_sessions?user_id=eq.${uid}&outcome=eq.completed&select=pack_id,scenario_id,outcome,ics_role&limit=2000`),
    db(env, `learning_competency_ratings?user_id=eq.${uid}&select=competency_id,state,rated_at&order=rated_at.asc&limit=2000`),
    db(env, `learning_hseep_participants?user_id=eq.${uid}&exercise_role=eq.evaluator&select=exercise_id&limit=500`),
    db(env, `learning_hseep_evaluations?evaluator_id=eq.${uid}&source=eq.human&select=id&limit=500`),
    db(env, `learning_pathway_enrollments?user_id=eq.${uid}&pathway_id=eq.${q(pathwayId)}&select=*&limit=1`),
  ]);
  const status = pathwayStatus(pathway, {
    credentials: credentials || [], sessions: sessions || [], ratings: ratings || [],
    evaluatorExercises: (roles || []).length, evaluations: (evaluations || []).length,
  });
  return {
    ok: true,
    pathways_version: PATHWAYS.pathways_version,
    pathway: { pathway_id: pathway.pathway_id, title: pathway.title, stage: pathway.stage, summary: pathway.summary, competency_targets: pathway.competency_targets, notes: pathway.notes || [] },
    enrollment: enrollment?.[0] || null,
    ...status,
  };
}

async function enroll(env, user, pathwayId) {
  if (!registry().pathways.has(pathwayId)) throw bad('Pathway not found', 404);
  const rows = await db(env, 'learning_pathway_enrollments?on_conflict=user_id,pathway_id', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: { user_id: user.id, pathway_id: pathwayId, pathways_version: PATHWAYS.pathways_version, status: 'active' },
  });
  return { ok: true, enrollment: rows?.[0] || null };
}

/* ---------- review ---------- */
async function reviewQueue(env) {
  const [credentials, aars] = await Promise.all([
    db(env, 'learning_external_credentials?verification_status=eq.self_reported&select=id,user_id,issuer,catalog_id,external_program,title,completion_date,certificate_path,certificate_sha256,created_at&order=created_at.asc&limit=100'),
    db(env, 'learning_hseep_aar?status=eq.draft&select=id,exercise_id,updated_at&order=updated_at.asc&limit=100'),
  ]);
  return { ok: true, credentials: credentials || [], draft_aars: aars || [] };
}

async function reviewCredential(request, env, user, id) {
  const body = await readJson(request);
  const decision = String(body.decision || '');
  if (!['verify', 'reject'].includes(decision)) throw bad('decision must be verify or reject');
  const rows = await db(env, `learning_external_credentials?id=eq.${q(uuid(id, 'credential id'))}&select=id,user_id,verification_status&limit=1`);
  const credential = rows?.[0];
  if (!credential) throw bad('Credential not found', 404);
  if (credential.user_id === user.id) throw bad('Nobody reviews their own credential', 403);
  if (credential.verification_status !== 'self_reported') throw bad('Already reviewed', 409);
  const updated = await db(env, `learning_external_credentials?id=eq.${q(credential.id)}&verification_status=eq.self_reported`, {
    method: 'PATCH', prefer: 'return=representation',
    body: { verification_status: decision === 'verify' ? 'reviewer_verified' : 'rejected', verified_by: user.id, verified_at: new Date().toISOString(), verification_note: text(body.note, 2000, 'note') },
  });
  return { ok: true, credential: updated?.[0] || null };
}

async function credentialFile(env, id) {
  const rows = await db(env, `learning_external_credentials?id=eq.${q(uuid(id, 'credential id'))}&select=certificate_path&limit=1`);
  const path = rows?.[0]?.certificate_path;
  if (!path) throw bad('No file on this credential', 404);
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/${CREDENTIAL_BUCKET}/${path}`, {
    method: 'POST', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: 300 }), signal: AbortSignal.timeout(12_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.signedURL) throw bad('Could not sign the download', 502);
  return { ok: true, url: `${env.SUPABASE_URL}/storage/v1${data.signedURL}`, expires_in: 300 };
}

async function reviewRating(request, env, user) {
  const body = await readJson(request);
  const learnerId = uuid(body.user_id, 'user_id');
  if (learnerId === user.id) throw bad('Nobody rates their own competency', 403);
  const competency = String(body.competency_id || '');
  if (!COMPETENCY.test(competency)) throw bad('Unknown competency_id');
  const state = String(body.state || '');
  if (!STATES.includes(state)) throw bad('Unknown state');
  const note = text(body.note, 4000, 'note', { required: !AUTOMATED_CEILING.includes(state) });
  const row = {
    user_id: learnerId, competency_id: competency, state, source: 'reviewer', reviewer_id: user.id, review_note: note,
    session_id: body.session_id ? uuid(body.session_id, 'session_id') : null,
    exercise_id: body.exercise_id ? uuid(body.exercise_id, 'exercise_id') : null,
  };
  const rows = await db(env, 'learning_competency_ratings', { method: 'POST', prefer: 'return=representation', body: row });
  return { ok: true, rating: rows?.[0] || row };
}

/* ---------- HSEEP exercises ---------- */
async function exerciseRow(env, id) {
  const rows = await db(env, `learning_hseep_exercises?id=eq.${q(uuid(id, 'exercise id'))}&select=*&limit=1`);
  if (!rows?.length) throw bad('Exercise not found', 404);
  return rows[0];
}
function exerciseScenario(ex) {
  if (!ex.pack_id || !ex.scenario_id) return null;
  return scenarioFor(ex.pack_id, ex.pack_version, ex.scenario_id).scenario;
}

async function createExercise(request, env, user) {
  const body = await readJson(request);
  const row = { created_by: user.id, title: text(body.title, 200, 'title', { required: true }), mode: 'SIMULATION', objectives: [], core_capabilities: [] };
  if (body.scenario_id) {
    const { pack, scenario } = scenarioFor(body.pack_id, body.pack_version, body.scenario_id);
    Object.assign(row, { pack_id: pack.pack_id, pack_version: pack.pack_version, scenario_id: String(body.scenario_id) });
    row.exercise_type = body.exercise_type ? String(body.exercise_type) : scenario.exercise_type;
    row.objectives = scenario.objectives.map((objective_id) => ({ objective_id }));
    row.core_capabilities = scenario.core_capabilities;
  } else {
    row.exercise_type = String(body.exercise_type || '');
  }
  if (!EXERCISE_TYPES.has(row.exercise_type)) throw bad('exercise_type must be an HSEEP type: seminar, workshop, tabletop, game, drill, functional or full_scale');
  row.scheduled_for = isoTime(body.scheduled_for, 'scheduled_for');
  const rows = await db(env, 'learning_hseep_exercises', { method: 'POST', prefer: 'return=representation', body: row });
  return { ok: true, exercise: rows?.[0] || row };
}

async function readExercise(env, user, id, isReviewer) {
  const ex = await exerciseRow(env, id);
  const eid = q(ex.id);
  const participants = await db(env, `learning_hseep_participants?exercise_id=eq.${eid}&select=user_id,exercise_role,ics_position,session_id`);
  if (!isReviewer && !(participants || []).some((p) => p.user_id === user.id) && ex.created_by !== user.id) throw bad('Exercise not found', 404);
  const [evaluations, aar, items, log] = await Promise.all([
    db(env, `learning_hseep_evaluations?exercise_id=eq.${eid}&select=*&order=recorded_at.asc`),
    db(env, `learning_hseep_aar?exercise_id=eq.${eid}&select=*&limit=1`),
    db(env, `learning_hseep_improvement_items?exercise_id=eq.${eid}&select=*&order=item_code.asc`),
    db(env, `learning_ics214_entries?exercise_id=eq.${eid}&select=user_id,ics_position,operational_period,entry_time,activity&order=entry_time.asc&limit=1000`),
  ]);
  return { ok: true, exercise: ex, participants: participants || [], evaluations: evaluations || [], aar: aar?.[0] || null, improvement_items: items || [], ics_214: log || [] };
}

async function patchExercise(request, env, id) {
  const ex = await exerciseRow(env, id);
  const body = await readJson(request);
  const patch = {};
  if (body.status !== undefined) {
    if (!EXERCISE_STATUS.has(String(body.status))) throw bad('Unknown status');
    if (['aar_final', 'closed'].includes(String(body.status))) throw bad('Finalise the AAR/IP through PUT …/aar with finalize');
    patch.status = String(body.status);
  }
  if (body.scheduled_for !== undefined) patch.scheduled_for = isoTime(body.scheduled_for, 'scheduled_for');
  if (body.conducted_at !== undefined) patch.conducted_at = isoTime(body.conducted_at, 'conducted_at');
  if (!Object.keys(patch).length) throw bad('Nothing to change');
  const rows = await db(env, `learning_hseep_exercises?id=eq.${q(ex.id)}`, { method: 'PATCH', prefer: 'return=representation', body: patch });
  return { ok: true, exercise: rows?.[0] || null };
}

async function addParticipant(request, env, id) {
  const ex = await exerciseRow(env, id);
  const body = await readJson(request);
  const role = String(body.exercise_role || '');
  if (!EXERCISE_ROLES.has(role)) throw bad('exercise_role must be player, controller, evaluator, facilitator or observer');
  const ics = body.ics_position ? String(body.ics_position) : null;
  if (ics && !registry().roles.has(ics)) throw bad('Unknown ics_position');
  const rows = await db(env, 'learning_hseep_participants?on_conflict=exercise_id,user_id,exercise_role', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
    body: { exercise_id: ex.id, user_id: uuid(body.user_id, 'user_id'), exercise_role: role, ics_position: ics, session_id: body.session_id ? uuid(body.session_id, 'session_id') : null },
  });
  return { ok: true, participant: rows?.[0] || null };
}

async function addEvaluation(request, env, user, id) {
  const ex = await exerciseRow(env, id);
  const body = await readJson(request);
  const scenario = exerciseScenario(ex);
  const criterion = String(body.criterion_id || '');
  if (scenario && scenario.eeg.size && !scenario.eeg.has(criterion)) throw bad('criterion_id is not an EEG criterion of this exercise');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(criterion)) throw bad('criterion_id is required');
  const rating = String(body.rating || '');
  if (!['P', 'S', 'M', 'U'].includes(rating)) throw bad('rating must be P, S, M or U');
  const kind = String(body.observation_type || (rating === 'P' ? 'strength' : 'area_for_improvement'));
  if (!['strength', 'area_for_improvement'].includes(kind)) throw bad('observation_type must be strength or area_for_improvement');
  const rows = await db(env, 'learning_hseep_evaluations', { method: 'POST', prefer: 'return=representation', body: {
    exercise_id: ex.id, evaluator_id: user.id, criterion_id: criterion, objective_id: text(body.objective_id, 80, 'objective_id'),
    rating, observation_type: kind, observation: text(body.observation, 4000, 'observation', { required: true }), source: 'human',
  } });
  return { ok: true, evaluation: rows?.[0] || null };
}

async function putHotwash(request, env, user, id) {
  const ex = await exerciseRow(env, id);
  const body = await readJson(request);
  const rows = await db(env, `learning_hseep_exercises?id=eq.${q(ex.id)}`, { method: 'PATCH', prefer: 'return=representation', body: {
    hotwash_notes: text(body.notes, 20000, 'notes', { required: true }), hotwash_recorded_at: new Date().toISOString(), hotwash_recorded_by: user.id,
    status: ex.status === 'planned' ? 'conducted' : ex.status,
  } });
  return { ok: true, exercise: rows?.[0] || null };
}

function observationList(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) throw bad(`${field} must be a list of up to 50 items`);
  return value.map((v) => ({ criterion_id: v?.criterion_id ? String(v.criterion_id).slice(0, 80) : null, text: text(v?.text, 2000, `${field} text`, { required: true }) }));
}

async function putAar(request, env, user, id) {
  const ex = await exerciseRow(env, id);
  const body = await readJson(request);
  const finalize = body.finalize === true;
  const existing = await db(env, `learning_hseep_aar?exercise_id=eq.${q(ex.id)}&select=*&limit=1`);
  if (existing?.[0]?.status === 'final') throw bad('The AAR/IP is final', 409);
  const doc = {
    exercise_id: ex.id,
    summary: text(body.summary, 20000, 'summary'),
    strengths: observationList(body.strengths, 'strengths'),
    areas_for_improvement: observationList(body.areas_for_improvement, 'areas_for_improvement'),
    drafted_by: existing?.[0]?.drafted_by || user.id,
  };
  if (finalize) {
    const open = await db(env, `learning_hseep_improvement_items?exercise_id=eq.${q(ex.id)}&owner_user_id=is.null&owner_label=is.null&select=item_code`);
    if (open?.length) throw bad(`Every improvement item needs an owner before the AAR/IP is final: ${open.map((i) => i.item_code).join(', ')}`, 409);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(doc)));
    Object.assign(doc, { status: 'final', finalized_by: user.id, finalized_at: new Date().toISOString(), document_sha256: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('') });
  } else {
    doc.status = 'draft';
  }
  const rows = await db(env, 'learning_hseep_aar?on_conflict=exercise_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=representation', body: doc });
  await db(env, `learning_hseep_exercises?id=eq.${q(ex.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: finalize ? 'aar_final' : 'aar_draft' } });
  return { ok: true, aar: rows?.[0] || doc };
}

function itemFields(body, { creating }) {
  const out = {};
  if (creating || body.issue !== undefined) out.issue = text(body.issue, 2000, 'issue', { required: creating });
  if (body.corrective_action !== undefined) out.corrective_action = text(body.corrective_action, 2000, 'corrective_action');
  if (body.core_capability !== undefined) out.core_capability = text(body.core_capability, 120, 'core_capability');
  if (body.objective_id !== undefined) out.objective_id = text(body.objective_id, 80, 'objective_id');
  if (body.owner_user_id !== undefined) out.owner_user_id = body.owner_user_id ? uuid(body.owner_user_id, 'owner_user_id') : null;
  if (body.owner_label !== undefined) out.owner_label = text(body.owner_label, 200, 'owner_label');
  if (body.start_date !== undefined) out.start_date = isoDate(body.start_date, 'start_date');
  if (body.due_date !== undefined) out.due_date = isoDate(body.due_date, 'due_date');
  if (body.status !== undefined) {
    if (!ITEM_STATUS.has(String(body.status))) throw bad('status must be open, in_progress, closed or deferred');
    out.status = String(body.status);
    out.closed_at = out.status === 'closed' ? new Date().toISOString() : null;
    if (out.status === 'closed') out.closure_evidence = text(body.closure_evidence, 4000, 'closure_evidence', { required: true });
  }
  return out;
}

async function addImprovement(request, env, id) {
  const ex = await exerciseRow(env, id);
  const body = await readJson(request);
  const code = String(body.item_code || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(code)) throw bad('item_code is required');
  const rows = await db(env, 'learning_hseep_improvement_items', { method: 'POST', prefer: 'return=representation', body: { exercise_id: ex.id, item_code: code, ...itemFields(body, { creating: true }) } });
  return { ok: true, item: rows?.[0] || null };
}

async function patchImprovement(request, env, id) {
  const body = await readJson(request);
  const patch = itemFields(body, { creating: false });
  if (!Object.keys(patch).length) throw bad('Nothing to change');
  const rows = await db(env, `learning_hseep_improvement_items?id=eq.${q(uuid(id, 'item id'))}`, { method: 'PATCH', prefer: 'return=representation', body: patch });
  if (!rows?.length) throw bad('Improvement item not found', 404);
  return { ok: true, item: rows[0] };
}

async function addIcs214(request, env, user, id, isReviewer) {
  const ex = await exerciseRow(env, id);
  const body = await readJson(request);
  const position = String(body.ics_position || '');
  if (!registry().roles.has(position)) throw bad('Unknown ics_position');
  if (!isReviewer) {
    const mine = await db(env, `learning_hseep_participants?exercise_id=eq.${q(ex.id)}&user_id=eq.${q(user.id)}&select=ics_position`);
    if (!(mine || []).length) throw bad('Exercise not found', 404);
  }
  const rows = await db(env, 'learning_ics214_entries', { method: 'POST', prefer: 'return=representation', body: {
    exercise_id: ex.id, user_id: user.id, ics_position: position, operational_period: text(body.operational_period, 120, 'operational_period'),
    entry_time: isoTime(body.entry_time, 'entry_time') || new Date().toISOString(), activity: text(body.activity, 2000, 'activity', { required: true }),
  } });
  return { ok: true, entry: rows?.[0] || null };
}

/* ---------- router ---------- */
async function route(request, env, options, path) {
  const m = request.method;
  const rest = path.slice(LEARNING_PATH.length).replace(/^\//, '');
  const parts = rest ? rest.split('/') : [];
  const done = (body, status = 200) => reply(request, env, body, status);
  const notAllowed = () => { throw bad('Method not allowed', 405); };

  if (!parts.length) { if (m !== 'GET') notAllowed(); await learner(request, env, options); return done(registryBody()); }
  const [head, id, sub] = parts;

  // Deliberately stays owner-only even if the general learning audience opens later.
  if (head === 'adaptive') {
    const user = await options.requireHouseOwner(request, env);
    return done(await routeAdaptive(request, env, user, parts.slice(1), db));
  }

  if (head === 'catalog' && parts.length === 1) { if (m !== 'GET') notAllowed(); await learner(request, env, options); return done(catalogBody()); }

  if (head === 'pathways') {
    const user = await learner(request, env, options);
    if (parts.length === 1) { if (m !== 'GET') notAllowed(); return done({ ok: true, pathways_version: PATHWAYS.pathways_version, rule: PATHWAYS.rule, pathways: PATHWAYS.pathways }); }
    if (parts.length === 2) { if (m !== 'GET') notAllowed(); return done(await pathwayForUser(env, user, id)); }
    if (parts.length === 3 && sub === 'enroll') { if (m !== 'POST') notAllowed(); return done(await enroll(env, user, id), 201); }
  }

  if (head === 'sessions') {
    const user = await learner(request, env, options);
    if (parts.length === 1) {
      if (m === 'POST') return done(await startSession(request, env, user), 201);
      if (m !== 'GET') notAllowed();
      const rows = await db(env, `learning_lab_sessions?user_id=eq.${q(user.id)}&select=*&order=started_at.desc&limit=100`);
      return done({ ok: true, sessions: rows || [] });
    }
    if (parts.length === 2) {
      if (m !== 'GET') notAllowed();
      const session = await ownSession(env, user, id);
      const events = await db(env, `learning_evidence_events?session_id=eq.${q(session.id)}&select=seq,event_type,action_id,status,actor_role,payload,occurred_at,prev_hash,event_hash&order=seq.asc&limit=2000`);
      return done({ ok: true, session, events: events || [] });
    }
    if (parts.length === 3 && sub === 'events') { if (m !== 'POST') notAllowed(); return done(await appendEvents(request, env, user, id), 201); }
    if (parts.length === 3 && sub === 'complete') { if (m !== 'POST') notAllowed(); return done(await completeSession(request, env, user, id)); }
  }

  if (head === 'credentials') {
    const user = await learner(request, env, options);
    if (parts.length === 1) {
      if (m === 'POST') return done(await recordCredential(request, env, user), 201);
      if (m !== 'GET') notAllowed();
      const rows = await db(env, `learning_external_credentials?user_id=eq.${q(user.id)}&select=*&order=completion_date.desc&limit=500`);
      return done({ ok: true, credentials: rows || [] });
    }
    if (parts.length === 2 && id === 'upload-url') { if (m !== 'POST') notAllowed(); return done(await uploadUrl(request, env, user)); }
  }

  if (head === 'review') {
    const user = await reviewer(request, env, options);
    if (parts.length === 2 && id === 'queue') { if (m !== 'GET') notAllowed(); return done(await reviewQueue(env)); }
    if (parts.length === 2 && id === 'ratings') { if (m !== 'POST') notAllowed(); return done(await reviewRating(request, env, user), 201); }
    if (id === 'credentials' && parts.length === 3) { if (m !== 'POST') notAllowed(); return done(await reviewCredential(request, env, user, sub)); }
    if (id === 'credentials' && parts.length === 4 && parts[3] === 'file') { if (m !== 'GET') notAllowed(); return done(await credentialFile(env, sub)); }
  }

  if (head === 'exercises') {
    if (parts.length === 1) {
      if (m === 'POST') { const user = await reviewer(request, env, options); return done(await createExercise(request, env, user), 201); }
      if (m !== 'GET') notAllowed();
      await reviewer(request, env, options);
      const rows = await db(env, 'learning_hseep_exercises?select=*&order=created_at.desc&limit=100');
      return done({ ok: true, exercises: rows || [] });
    }
    if (parts.length === 2) {
      if (m === 'PATCH') { await reviewer(request, env, options); return done(await patchExercise(request, env, id)); }
      if (m !== 'GET') notAllowed();
      const user = await learner(request, env, options);
      const isReviewer = await reviewer(request, env, options).then(() => true, () => false);
      return done(await readExercise(env, user, id, isReviewer));
    }
    if (parts.length === 3) {
      if (sub === 'ics214') {
        if (m !== 'POST') notAllowed();
        const user = await learner(request, env, options);
        const isReviewer = await reviewer(request, env, options).then(() => true, () => false);
        return done(await addIcs214(request, env, user, id, isReviewer), 201);
      }
      const user = await reviewer(request, env, options);
      if (sub === 'participants') { if (m !== 'POST') notAllowed(); return done(await addParticipant(request, env, id), 201); }
      if (sub === 'evaluations') { if (m !== 'POST') notAllowed(); return done(await addEvaluation(request, env, user, id), 201); }
      if (sub === 'improvements') { if (m !== 'POST') notAllowed(); return done(await addImprovement(request, env, id), 201); }
      if (sub === 'hotwash') { if (m !== 'PUT') notAllowed(); return done(await putHotwash(request, env, user, id)); }
      if (sub === 'aar') { if (m !== 'PUT') notAllowed(); return done(await putAar(request, env, user, id)); }
    }
  }

  if (head === 'improvements' && parts.length === 2) {
    await reviewer(request, env, options);
    if (m !== 'PATCH') notAllowed();
    return done(await patchImprovement(request, env, id));
  }

  throw bad('Learning route not found', 404);
}

export async function handleLearning(request, env, options = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (path !== LEARNING_PATH && !path.startsWith(`${LEARNING_PATH}/`)) return null;
  const respond = (res) => { res.headers.set('cache-control', 'private, no-store'); return res; };
  try {
    if (typeof options.requireHouseOwner !== 'function') return respond(fail(request, env, 'Authorization is unavailable', 503));
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return respond(fail(request, env, 'Learning record is not configured', 503));
    return respond(await route(request, env, options, path));
  } catch (error) {
    const status = Number(error.status) || 500;
    const known = [400, 401, 403, 404, 405, 409, 413].includes(status);
    return respond(fail(request, env, known ? error.message : status === 502 ? error.message : 'Learning record is unavailable right now', known || status === 502 ? status : 503));
  }
}
