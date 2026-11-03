import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLearning, LEARNING_AUDIENCE, LEARNING_PATH, CREDENTIAL_BUCKET, pathwayStatus, registry, validateEvent } from '../src/prim3/learning.js';
import PATHWAYS from '../../../docs/design/equity-uprise-development/LEARNING-PATHWAYS.json' with { type: 'json' };

const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'service', ALLOWED_ORIGINS: 'https://matthew.mccluster.org' };
const OWNER = '00000000-0000-4000-8000-0000000000a1';
const LEARNER = '00000000-0000-4000-8000-0000000000b2';
const owner = async () => ({ id: OWNER, email: 'owner@example.invalid' });
const denied = async () => { throw Object.assign(new Error('McCluster house owner access required'), { status: 403 }); };
const opts = { requireHouseOwner: owner, authUser: owner };

// A small in-memory PostgREST + Storage double. It records every call.
function fakeDb(seed = {}) {
  const tables = { learning_lab_sessions: [], learning_evidence_events: [], learning_external_credentials: [], learning_competency_ratings: [],
    learning_hseep_exercises: [], learning_hseep_participants: [], learning_hseep_evaluations: [], learning_hseep_aar: [],
    learning_hseep_improvement_items: [], learning_ics214_entries: [], learning_pathway_enrollments: [], learning_reviewers: [], ...seed };
  const calls = [];
  let n = 0;
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const filters = (search) => [...new URLSearchParams(search)].filter(([k]) => !['select', 'order', 'limit', 'on_conflict'].includes(k));
  const match = (row, fs) => fs.every(([k, v]) => {
    if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
    if (v === 'is.null') return row[k] === null || row[k] === undefined;
    if (v === 'is.true') return row[k] === true;
    return true;
  });
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: u.pathname, search: u.search, body });
    if (u.pathname.startsWith('/storage/v1/object/upload/sign/')) return json({ url: `/object/upload/sign/${u.pathname.split('/sign/')[1]}?token=t` });
    if (u.pathname.startsWith('/storage/v1/object/list/')) return json(seed.__files?.includes(`${body.prefix}/${body.search}`) ? [{ name: body.search }] : []);
    if (u.pathname.startsWith('/storage/v1/object/sign/')) return json({ signedURL: `/object/sign/x?token=d` });
    const table = u.pathname.replace('/rest/v1/', '');
    const rows = tables[table];
    if (!rows) return json({ message: 'unknown table ' + table }, 404);
    const fs = filters(u.search);
    if (method === 'GET') return json(rows.filter((r) => match(r, fs)));
    if (method === 'POST') {
      const list = (Array.isArray(body) ? body : [body]).map((r) => ({ id: id(), ...r }));
      if (table === 'learning_evidence_events') {
        for (const r of list) {
          const s = tables.learning_lab_sessions.find((x) => x.id === r.session_id);
          if (s.outcome !== 'in_progress') return json({ message: 'learning session is closed' }, 400);
          r.seq = (s.last_event_seq || 0) + 1; r.prev_hash = s.last_event_hash || null; r.event_hash = String(r.seq).padStart(64, 'e');
          s.last_event_seq = r.seq; s.last_event_hash = r.event_hash;
        }
      }
      if (table === 'learning_lab_sessions') for (const r of list) Object.assign(r, { outcome: 'in_progress', last_event_seq: 0, started_at: '2026-11-03T15:00:00Z' });
      rows.push(...list);
      return json(list, 201);
    }
    if (method === 'PATCH') {
      const hit = rows.filter((r) => match(r, fs));
      hit.forEach((r) => Object.assign(r, body));
      return json(hit);
    }
    return json({}, 405);
  };
  return { tables, calls, fetchImpl };
}
async function withDb(seed, run) {
  const original = globalThis.fetch;
  const db = fakeDb(seed);
  globalThis.fetch = db.fetchImpl;
  try { return await run(db); } finally { globalThis.fetch = original; }
}
const call = (method, path, body, options = opts) => handleLearning(new Request(`https://api.mccluster.org${LEARNING_PATH}${path}`, {
  method, headers: { origin: 'https://matthew.mccluster.org', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}), env, options);

test('the LMS is house-owner only today, behind one switch', async () => {
  assert.equal(LEARNING_AUDIENCE, 'house-owner');
  await withDb({}, async (db) => {
    const res = await call('GET', '', undefined, { requireHouseOwner: denied, authUser: owner });
    assert.equal(res.status, 403);
    assert.equal(db.calls.length, 0, 'no database read before the owner check');
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.equal(await handleLearning(new Request('https://api.mccluster.org/v1/prim3/progress'), env, opts), null);
  });
});

test('the registry serves every pack with its version, and the catalog says "prepares you for"', async () => {
  await withDb({}, async () => {
    const body = await (await call('GET', '')).json();
    assert.equal(body.audience, 'house-owner');
    assert.equal(body.automated_ceiling, 'Demonstrated');
    assert.deepEqual(body.packs.map((p) => p.pack_id).sort(), Object.keys(PATHWAYS.packs).sort());
    assert.ok(body.packs.find((p) => p.pack_id === 'hseep-building-safety').scenario_count >= 7);
    const catalog = await (await call('GET', '/catalog')).json();
    assert.ok(catalog.courses.length >= 34);
    for (const course of catalog.courses) {
      assert.match(course.learner_copy, /^Prepares you for /);
      assert.doesNotMatch(course.learner_copy, /certified/i);
    }
    assert.ok(catalog.retired_do_not_cite.some((r) => r.course_code === 'IS-139.A'));
    assert.ok(!catalog.courses.some((c) => c.course_code === 'IS-139.A'));
  });
});

test('a session must name a real pack, version and scenario, and is never LIVE', async () => {
  await withDb({}, async (db) => {
    const base = { pack_id: 'hseep-building-safety', pack_version: '1.0.0', scenario_id: 'EU-HSEEP-FIRE-SMOKE-V1', seed: 7 };
    assert.equal((await call('POST', '/sessions', { ...base, pack_version: '0.9.0' })).status, 400);
    assert.equal((await call('POST', '/sessions', { ...base, scenario_id: 'EU-NOT-A-DRILL' })).status, 400);
    assert.equal((await call('POST', '/sessions', { ...base, pack_id: 'made-up' })).status, 400);
    assert.equal((await call('POST', '/sessions', { ...base, mode: 'LIVE' })).status, 400);
    assert.equal((await call('POST', '/sessions', { ...base, execution_target: 'LIVE' })).status, 400);
    assert.equal((await call('POST', '/sessions', { ...base, ics_role: 'grand_wizard' })).status, 400);
    assert.equal(db.tables.learning_lab_sessions.length, 0);
    const res = await call('POST', '/sessions', { ...base, ics_role: 'incident_commander' });
    assert.equal(res.status, 201);
    const { session } = await res.json();
    assert.equal(session.user_id, OWNER);
    assert.equal(session.execution_target, 'SANDBOX');
    assert.equal(db.tables.learning_evidence_events[0].event_type, 'start');
    assert.equal(db.tables.learning_evidence_events[0].payload.seed, 7);
  });
});

test('evidence is validated against the scenario and closed sessions are final', async () => {
  await withDb({}, async (db) => {
    const { session } = await (await call('POST', '/sessions', { pack_id: 'fema-building-ops', pack_version: '1.0.0', scenario_id: 'EU-OPS-BASIC-EVAC-V1' })).json();
    assert.equal((await call('POST', `/sessions/${session.id}/events`, { event_type: 'action', action_id: 'not-an-action' })).status, 400);
    assert.equal((await call('POST', `/sessions/${session.id}/events`, { event_type: 'start' })).status, 400);
    assert.equal((await call('POST', `/sessions/${session.id}/events`, { event_type: 'decision', action_id: 'evac-route', actor_role: 'wizard' })).status, 400);
    const ok = await call('POST', `/sessions/${session.id}/events`, { events: [
      { event_type: 'inspect', action_id: 'evac-inspect', status: 'success' },
      { event_type: 'decision', action_id: 'evac-route', status: 'success', payload: { route: 'site-east-egress-walk' } },
    ] });
    assert.equal(ok.status, 201);
    const appended = (await ok.json()).appended;
    assert.deepEqual(appended.map((e) => e.seq), [2, 3]);
    assert.equal(appended[1].prev_hash, appended[0].event_hash, 'the chain comes back from the database');

    assert.equal((await call('POST', `/sessions/${session.id}/complete`, { outcome: 'completed', competency_signals: [{ competency_id: 'CORE-08', state: 'Verified' }] })).status, 400);
    assert.equal((await call('POST', `/sessions/${session.id}/complete`, { outcome: 'completed', competency_signals: [{ competency_id: 'OPS-02', state: 'Practicing' }] })).status, 400, 'not assessed by this scenario');
    const done = await call('POST', `/sessions/${session.id}/complete`, { outcome: 'completed', evidence_bundle_sha256: 'a'.repeat(64), competency_signals: [{ competency_id: 'CORE-08', state: 'Demonstrated' }] });
    assert.equal(done.status, 200);
    assert.deepEqual(db.tables.learning_competency_ratings.map((r) => [r.competency_id, r.state, r.source]), [['CORE-08', 'Demonstrated', 'automated']]);
    assert.equal((await call('POST', `/sessions/${session.id}/events`, { event_type: 'note' })).status, 409);
    assert.equal((await call('POST', `/sessions/${session.id}/complete`, { outcome: 'completed' })).status, 409);
  });
});

test('certificates upload to the learner\'s own private folder and start self-reported', async () => {
  await withDb({}, async (db) => {
    assert.equal((await call('POST', '/credentials/upload-url', { mime_type: 'text/html', byte_size: 10 })).status, 400);
    assert.equal((await call('POST', '/credentials/upload-url', { mime_type: 'application/pdf', byte_size: 20 * 1024 * 1024 })).status, 413);
    const up = await (await call('POST', '/credentials/upload-url', { mime_type: 'application/pdf', byte_size: 2048 })).json();
    assert.equal(up.bucket, CREDENTIAL_BUCKET);
    assert.match(up.storage_path, new RegExp(`^${OWNER}/[0-9a-f-]{36}\\.pdf$`));
    assert.ok(db.calls.some((c) => c.path === `/storage/v1/object/upload/sign/${CREDENTIAL_BUCKET}/${up.storage_path}`));
    assert.ok(up.upload_url.startsWith('https://db.example/storage/v1/object/upload/sign/'));
  });
  const file = `${OWNER}/00000000-0000-4000-8000-00000000e001.pdf`;
  await withDb({ __files: [file] }, async (db) => {
    const claim = { catalog_id: 'FEMA-IS-100-C', completion_date: '2026-10-01', certificate_path: file, certificate_sha256: 'b'.repeat(64), mime_type: 'application/pdf', byte_size: 2048 };
    assert.equal((await call('POST', '/credentials', { ...claim, catalog_id: 'FEMA-IS-139-A' })).status, 400);
    assert.equal((await call('POST', '/credentials', { ...claim, fema_sid: '0123456789' })).status, 400);
    assert.equal((await call('POST', '/credentials', { ...claim, certificate_path: `${LEARNER}/00000000-0000-4000-8000-00000000e001.pdf` })).status, 400);
    assert.equal((await call('POST', '/credentials', { ...claim, certificate_path: `${OWNER}/00000000-0000-4000-8000-00000000e009.pdf` })).status, 409, 'file must exist');
    assert.equal((await call('POST', '/credentials', { ...claim, completion_date: '2099-01-01' })).status, 400);
    const res = await call('POST', '/credentials', { ...claim, verification_status: 'reviewer_verified' });
    assert.equal(res.status, 201);
    const row = db.tables.learning_external_credentials[0];
    assert.equal(row.verification_status, 'self_reported', 'a learner can never self-verify');
    assert.equal(row.issuer, 'FEMA');
    assert.equal(row.course_code, 'IS-100.C');
    assert.ok(!('fema_sid' in row));
  });
});

test('reviewers verify other people\'s certificates and rate above the automated ceiling', async () => {
  const theirs = { id: '00000000-0000-4000-8000-00000000c001', user_id: LEARNER, verification_status: 'self_reported', catalog_id: 'FEMA-IS-100-C', certificate_path: `${LEARNER}/00000000-0000-4000-8000-00000000e001.pdf` };
  const mine = { id: '00000000-0000-4000-8000-00000000c002', user_id: OWNER, verification_status: 'self_reported', catalog_id: 'FEMA-IS-700-B' };
  await withDb({ learning_external_credentials: [theirs, mine] }, async (db) => {
    const queue = await (await call('GET', '/review/queue')).json();
    assert.equal(queue.credentials.length, 2);
    assert.equal((await call('POST', `/review/credentials/${mine.id}`, { decision: 'verify' })).status, 403);
    assert.equal((await call('POST', `/review/credentials/${theirs.id}`, { decision: 'maybe' })).status, 400);
    const res = await call('POST', `/review/credentials/${theirs.id}`, { decision: 'verify', note: 'Matches the NDEMU transcript.' });
    assert.equal(res.status, 200);
    assert.equal(theirs.verification_status, 'reviewer_verified');
    assert.equal(theirs.verified_by, OWNER);
    assert.equal((await call('POST', `/review/credentials/${theirs.id}`, { decision: 'reject' })).status, 409);
    assert.equal((await call('POST', '/review/ratings', { user_id: OWNER, competency_id: 'CORE-08', state: 'Verified', note: 'x' })).status, 403);
    assert.equal((await call('POST', '/review/ratings', { user_id: LEARNER, competency_id: 'CORE-08', state: 'Verified' })).status, 400, 'a note is required above Demonstrated');
    assert.equal((await call('POST', '/review/ratings', { user_id: LEARNER, competency_id: 'CORE-08', state: 'Verified', note: 'Observed leading the drill.' })).status, 201);
    assert.equal(db.tables.learning_competency_ratings[0].reviewer_id, OWNER);
    const file = await (await call('GET', `/review/credentials/${theirs.id}/file`)).json();
    assert.equal(file.expires_in, 300);
  });
});

test('pathway status: official course, then uploaded evidence, then drills unlock', () => {
  const basics = registry().pathways.get('building-safety-basics');
  const none = pathwayStatus(basics, {});
  assert.equal(none.steps.find((s) => s.step_id === 'bsb-is100').status, 'available');
  assert.equal(none.steps.find((s) => s.step_id === 'bsb-drills').status, 'locked');
  assert.equal(none.unlocked_scenarios.length, 0);
  assert.match(none.steps[0].learner_copy, /^Prepares you for IS-100\.C/);
  assert.equal(none.steps[0].official_url, 'https://training.fema.gov/is/courseoverview.aspx?code=IS-100.C');

  const withIs100 = pathwayStatus(basics, { credentials: [{ id: 'c1', catalog_id: 'FEMA-IS-100-C', verification_status: 'self_reported' }] });
  assert.equal(withIs100.steps[0].status, 'satisfied');
  assert.deepEqual(withIs100.unlocked_scenarios.map((u) => u.scenario_id).sort(), ['EU-OPS-BASIC-EVAC-V1', 'EU-OPS-BLOCKED-STAIR-V1']);

  const rejected = pathwayStatus(basics, { credentials: [{ id: 'c1', catalog_id: 'FEMA-IS-100-C', verification_status: 'rejected' }] });
  assert.equal(rejected.steps[0].status, 'available');

  const evaluator = registry().pathways.get('exercise-evaluator');
  const pdsSelf = pathwayStatus(evaluator, { credentials: [{ id: 'p', catalog_id: 'FEMA-PDS', verification_status: 'self_reported' }] });
  assert.equal(pdsSelf.steps.find((s) => s.step_id === 'eval-pds').status, 'locked', 'the PDS step needs its seven courses first');
  const allCourses = ['FEMA-IS-120-C', 'FEMA-IS-130-A', 'FEMA-IS-230-E', 'FEMA-IS-235-C', 'FEMA-IS-240-C', 'FEMA-IS-241-C', 'FEMA-IS-242-C', 'FEMA-IS-244-B']
    .map((c, i) => ({ id: `c${i}`, catalog_id: c, verification_status: 'self_reported' }));
  const pdsPending = pathwayStatus(evaluator, { credentials: [...allCourses, { id: 'p', catalog_id: 'FEMA-PDS', verification_status: 'self_reported' }] });
  assert.equal(pdsPending.steps.find((s) => s.step_id === 'eval-pds').status, 'evidence_submitted', 'PDS must be reviewer-verified');
  const pdsDone = pathwayStatus(evaluator, { credentials: [...allCourses, { id: 'p', catalog_id: 'FEMA-PDS', verification_status: 'reviewer_verified' }],
    evaluatorExercises: 1, evaluations: 3, ratings: ['CORE-03', 'SHR-04', 'PSC-05'].map((c) => ({ competency_id: c, state: 'Verified', rated_at: '2026-11-03' })) });
  assert.equal(pdsDone.complete, true);

  const it = registry().pathways.get('it-support-network-security');
  const itNone = pathwayStatus(it, {});
  assert.equal(itNone.unlocked_scenarios.length, 8, 'Foundation labs are open practice before A+');
});

test('every learner-facing pathway step links the issuer and never claims certification', () => {
  for (const pathway of PATHWAYS.pathways) {
    for (const step of pathway.steps) {
      if (step.kind === 'official_course') {
        assert.ok(step.official_url.startsWith('https://'), step.step_id);
        assert.match(step.learner_copy, /^Prepares you for /);
      }
      assert.doesNotMatch(JSON.stringify(step), /\bcertified\b/i, step.step_id);
    }
  }
});

test('HSEEP exercises: real types, EEG criteria from the pack, owners before a final AAR/IP', async () => {
  await withDb({}, async (db) => {
    assert.equal((await call('POST', '/exercises', { title: 'Bad', exercise_type: 'exercise' })).status, 400);
    const res = await call('POST', '/exercises', { title: 'Fire drill, Floor 1', pack_id: 'hseep-building-safety', pack_version: '1.0.0', scenario_id: 'EU-HSEEP-FIRE-SMOKE-V1' });
    assert.equal(res.status, 201);
    const { exercise } = await res.json();
    assert.equal(exercise.exercise_type, 'drill');
    assert.equal(exercise.objectives.length, 3);
    assert.equal((await call('POST', `/exercises/${exercise.id}/participants`, { user_id: LEARNER, exercise_role: 'player', ics_position: 'wizard' })).status, 400);
    assert.equal((await call('POST', `/exercises/${exercise.id}/participants`, { user_id: LEARNER, exercise_role: 'player', ics_position: 'incident_commander' })).status, 201);
    assert.equal((await call('POST', `/exercises/${exercise.id}/evaluations`, { criterion_id: 'MADE-UP-EEG', rating: 'P', observation: 'x y z' })).status, 400);
    assert.equal((await call('POST', `/exercises/${exercise.id}/evaluations`, { criterion_id: 'FIRE-EEG-1', rating: 'Q', observation: 'x y z' })).status, 400);
    assert.equal((await call('POST', `/exercises/${exercise.id}/evaluations`, { criterion_id: 'FIRE-EEG-1', rating: 'S', observation: 'Alarm raised after a short delay.' })).status, 201);
    assert.equal(db.tables.learning_hseep_evaluations[0].observation_type, 'area_for_improvement');
    assert.equal((await call('PUT', `/exercises/${exercise.id}/hotwash`, { notes: 'Players found the north route quickly.' })).status, 200);
    assert.equal((await call('POST', `/exercises/${exercise.id}/improvements`, { item_code: 'FIRE-IP-01', issue: 'Alarm delay' })).status, 201);
    assert.equal((await call('PUT', `/exercises/${exercise.id}/aar`, { summary: 'Draft', finalize: true })).status, 409, 'owners first');
    const item = db.tables.learning_hseep_improvement_items[0];
    assert.equal((await call('PATCH', `/improvements/${item.id}`, { status: 'closed' })).status, 400, 'closing needs evidence');
    assert.equal((await call('PATCH', `/improvements/${item.id}`, { owner_label: 'Building operations lead', due_date: '2026-12-01' })).status, 200);
    const final = await call('PUT', `/exercises/${exercise.id}/aar`, { summary: 'Alarm delay found and owned.', strengths: [{ text: 'Route choice' }], areas_for_improvement: [{ criterion_id: 'FIRE-EEG-1', text: 'Alarm delay' }], finalize: true });
    assert.equal(final.status, 200);
    const aar = (await final.json()).aar;
    assert.equal(aar.status, 'final');
    assert.match(aar.document_sha256, /^[0-9a-f]{64}$/);
    assert.equal((await call('PUT', `/exercises/${exercise.id}/aar`, { summary: 'again' })).status, 409);
    assert.equal((await call('POST', `/exercises/${exercise.id}/ics214`, { ics_position: 'incident_commander', activity: 'Command established at Assembly Area B.' })).status, 201);
    const full = await (await call('GET', `/exercises/${exercise.id}`)).json();
    assert.equal(full.ics_214.length, 1);
    assert.equal(full.participants.length, 1);
  });
});

test('event validation is strict about payload size and types', () => {
  const scenario = registry().packs.get('hseep-building-safety').scenarios.get('EU-HSEEP-FIRE-SMOKE-V1');
  assert.throws(() => validateEvent({ event_type: 'note', payload: { big: 'x'.repeat(9000) } }, scenario), /too large/);
  assert.throws(() => validateEvent({ event_type: 'note', payload: [] }, scenario), /payload/);
  assert.throws(() => validateEvent({ event_type: 'note', status: 'great' }, scenario), /status/);
  assert.equal(validateEvent({ event_type: 'decision', action_id: 'fire-route', actor_role: 'floor_warden' }, scenario).actor_role, 'floor_warden');
});
