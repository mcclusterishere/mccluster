/* The intel loop through the real Worker router (src/index.js), with
   Supabase, Auth, context-decision and USGS stood in by a fake fetch. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true };
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
const { default: core } = await import('../src/index.js');
import {
  USGS_CONNECTOR_KEY, collectorEnabled, fetchUsgsPage, normalizeFeature, queryUrl, runScheduledIntelCollectors, runUsgsCollector
} from '../src/intel/usgs-collector.js';

/* Fixture IDs: fixed so a failure names the record it is about. */
const SB = 'https://supabase.test';
const ORG = '00000000-0000-4000-8000-0000000000a1';
const OWNER = '00000000-0000-4000-8000-00000000000b';
const MEMBER = '00000000-0000-4000-8000-00000000000c';
const RUN = '00000000-0000-4000-8000-000000000101';
const EVIDENCE_LOCATED = '00000000-0000-4000-8000-0000000000e1';
const EVIDENCE_UNKNOWN = '00000000-0000-4000-8000-0000000000e2';
const CLAIM = '00000000-0000-4000-8000-0000000000c1';
const BRIEFING = '00000000-0000-4000-8000-0000000000b1';
const DECISION = '00000000-0000-4000-8000-0000000000d1';
const MISSION = '00000000-0000-4000-8000-0000000000f0';
const PROOF = '00000000-0000-4000-8000-0000000000f1';
const OUTCOME = '00000000-0000-4000-8000-0000000000f2';
const OUTCOME_EVIDENCE = '00000000-0000-4000-8000-0000000000e3';
const SERVICE_KEY = 'service-role-fixture';

const ENV = {
  SUPABASE_URL: SB,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  ALLOWED_ORIGINS: 'https://matthew.mccluster.org',
  INTEL_USGS_COLLECTOR_ENABLED: 'true'
};

const USGS_FIXTURE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature', id: 'us7000aaaa',
      properties: { mag: 4.6, place: '10 km S of Example, CA', time: Date.parse('2026-10-15T01:00:00Z'), updated: Date.parse('2026-10-15T01:30:00Z'),
        url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000aaaa', status: 'reviewed', magType: 'mw', sig: 326, tsunami: 0,
        title: 'M 4.6 - 10 km S of Example, CA' },
      geometry: { type: 'Point', coordinates: [-117.5, 35.5, 8.2] }
    },
    {
      type: 'Feature', id: 'us7000bbbb',
      properties: { mag: 3.1, place: null, time: Date.parse('2026-10-15T01:10:00Z'), updated: Date.parse('2026-10-15T01:10:00Z') },
      geometry: null
    },
    {
      type: 'Feature', id: 'us7000cccc',
      properties: { mag: 2.9, time: Date.parse('2026-10-15T01:20:00Z') },
      geometry: { type: 'Point', coordinates: [0, 0, 10] }
    }
  ]
};

function json(data, status = 200, headers = {}) {
  return new Response(data === null ? null : JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/* A stand-in for PostgREST, Auth, the context-decision function and USGS.
   It keeps just enough state to walk the loop with the fixture IDs; the
   database rules themselves are proven by supabase/tests/intel_mission_canon.behaviour.sql. */
function harness({ usgs = () => json(USGS_FIXTURE), schemaReady = true } = {}) {
  const calls = [];
  const state = { evidence: [], claim: null, briefing: null, decision: null, mission: null, outcome: null, runs: [], audit: [] };
  const rpcs = {
    intel_collector_begin: () => ({ started: true, run_id: RUN, connector_id: 'conn-1', cursor: {} }),
    intel_collector_fail: (a) => { state.runs.push({ id: a.p_run, status: 'failed', error: a.p_error }); return { run_id: a.p_run, status: 'failed' }; },
    intel_collector_commit: (a) => {
      a.p_records.forEach((r, i) => state.evidence.push({ id: i === 0 ? EVIDENCE_LOCATED : (i === 1 ? EVIDENCE_UNKNOWN : `e-${i}`), title: r.title, lat: r.lat ?? null, lon: r.lon ?? null, geo_source:r.lat == null ? 'none' : 'source_published', review_status: 'unreviewed' }));
      state.runs.push({ id: a.p_run, status: 'succeeded', written: a.p_records.length, cursor: a.p_cursor });
      return { run_id: a.p_run, status: 'succeeded', records_seen: a.p_records.length, records_written: a.p_records.length, records_rejected: 0, deduplicated: 0, cursor: a.p_cursor };
    },
    intel_review: (a) => {
      if (a.p_subject_type === 'evidence') state.evidence.find((e) => e.id === a.p_subject_id).review_status = a.p_to_status;
      else state.claim.status = a.p_to_status;
      return { subject_type: a.p_subject_type, subject_id: a.p_subject_id, from: 'x', to: a.p_to_status };
    },
    intel_create_claim: (a) => { state.claim = { id: CLAIM, statement: a.p_statement, links: a.p_links, status: 'under_review' }; return { claim_id: CLAIM, status: 'under_review', evidence_links: a.p_links.length }; },
    intel_create_briefing: (a) => { state.briefing = { id: BRIEFING, citations: a.p_citations }; return { briefing_id: BRIEFING, citations: a.p_citations.length }; },
    intel_record_decision_basis: (a) => {
      assert.equal(a.p_decision, DECISION); assert.equal(a.p_briefing, BRIEFING);
      state.audit.push({ event:'intel.decision.proposed', resource_id:DECISION, actor_user_id:OWNER });
      return { decision_id: DECISION, basis_items: 3, audit:{recorded:true,id:state.audit.length} };
    },
    intel_create_mission_from_decision: (a) => {
      if (state.decision?.status !== 'approved') return { __error: { code: '42501', message: 'decision is proposed, not approved' } };
      state.mission = { id: MISSION, decision_id: a.p_decision, ...a.p_mission };
      return { mission_id: MISSION, decision_id: a.p_decision, created: true, mission_status: 'draft' };
    },
    intel_submit_outcome: (a) => { state.outcome = { id: OUTCOME, mission_id: a.p_mission, proof_ids: a.p_proof_ids, status: 'submitted' }; return { outcome_id: OUTCOME, created: true, status: 'submitted' }; },
    intel_review_outcome: (a) => { state.outcome.status = a.p_status; return { outcome_id: OUTCOME, status: a.p_status, evidence_id: OUTCOME_EVIDENCE, claim_id: a.p_claim }; },
    intel_lineage: (a) => (a.p_claim !== CLAIM ? null : {
      claim: { id: CLAIM, status: state.claim.status },
      evidence: [...state.claim.links.map((l) => ({ id: l.evidence_id, stance: l.stance })), ...(state.outcome?.status === 'accepted' ? [{ id: OUTCOME_EVIDENCE, kind: 'mission_outcome', stance: 'supports' }] : [])],
      briefings: state.briefing ? [{ id: BRIEFING, citations: state.briefing.citations }] : [],
      decisions: state.decision ? [{ id: DECISION, status: state.decision.status, approved_by: state.decision.approved_by }] : [],
      missions: state.mission ? [{ mission_id: MISSION, decision_id: DECISION, status: 'draft' }] : [],
      outcomes: state.outcome ? [{ id: OUTCOME, status: state.outcome.status, proof_ids: state.outcome.proof_ids, feedback_evidence_id: OUTCOME_EVIDENCE }] : []
    }),
    intel_geo_projection: (a) => ({
      audience: a.p_audience, k_threshold: a.p_audience === 'owner' ? 1 : 5, cell_deg: a.p_cell_deg, time_bucket: a.p_time_bucket,
      since: a.p_since, until: a.p_until,
      totals: { records: 2, located: 1, unknown_location: 1, suppressed_records: a.p_audience === 'owner' ? 0 : 1, suppressed_buckets: a.p_audience === 'owner' ? 0 : 1 },
      buckets: a.p_audience === 'owner' ? [{ cell: 'g10:3:-12', cell_center: { lat: 35, lon: -115 }, cell_bounds: [-120, 30, -110, 40], bucket_start: '2026-10-15T00:00:00Z', count: 1 }] : []
    }),
    intel_health: () => ({
      connector: { key: USGS_CONNECTOR_KEY, enabled: true },
      stored: { source_records: state.evidence.length, evidence_total: state.evidence.length },
      latest_run: state.runs.at(-1) || null,
      last_successful_run: [...state.runs].reverse().find((r) => r.status !== 'failed') || null,
      failures: { last_7d: state.runs.filter((r) => r.status === 'failed').length, runs_last_7d: state.runs.length }
    })
  };

  const fetchImpl = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : {}));
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, headers, body, init });

    if (url.startsWith('https://earthquake.usgs.gov/')) return usgs(url, init);
    if (url === `${SB}/auth/v1/user`) {
      const auth = headers.get('authorization');
      if (auth === 'Bearer owner-token') return json({ id: OWNER, email: 'owner@example.test' });
      if (auth === 'Bearer member-token') return json({ id: MEMBER, email: 'member@example.test' });
      return json({ msg: 'invalid' }, 401);
    }
    if (url.startsWith(`${SB}/rest/v1/orgs?`)) return json([{ id: ORG, slug: 'mccluster' }]);
    if (url.startsWith(`${SB}/rest/v1/org_members?`)) return json(url.includes(`profile_id=eq.${OWNER}`) ? [{ org_id: ORG, role: 'owner' }] : []);
    if (url === `${SB}/rest/v1/control_audit`) { state.audit.push(body); return json([{ id: state.audit.length, at: '2026-10-16T00:00:00Z' }], 201); }
    if (url === `${SB}/rest/v1/control_observability_events`) return json(null, 201);
    if (url.startsWith(`${SB}/functions/v1/context-decision`)) {
      assert.equal(headers.get('authorization'), 'Bearer owner-token', 'the owner token, never the service key, reaches context-decision');
      if (method === 'GET') return json({contract:'intel-decision/v2',schema_ready:true});
      if (method === 'POST') {
        state.decision = { id: DECISION, status: 'proposed', title: body.title, metadata: body.metadata };
        return json({ decision: { id: DECISION, org_id: ORG, status: 'proposed', title: body.title } }, 201);
      }
      if (method === 'PATCH') {
        state.decision = { ...state.decision, status: body.status, approved_by: OWNER };
        return json({ decision: { id: DECISION, status: body.status, approved_by: OWNER, approved_at: '2026-10-16T00:00:00Z' } });
      }
    }
    const rpc = url.match(/\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (rpc) {
      if (!schemaReady) return json({ code: 'PGRST202', message: 'Could not find the function in the schema cache' }, 404);
      const fn = rpcs[rpc[1]];
      if (!fn) return json({ code: 'PGRST202', message: 'not found' }, 404);
      const out = fn(body);
      if (out && out.__error) return json(out.__error, 400);
      return json(out);
    }
    if (url.startsWith(`${SB}/rest/v1/intel_evidence?`)) {
      if (!schemaReady) return json({ code: 'PGRST205', message: 'Could not find the table' }, 404);
      return json(state.evidence);
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
  return { calls, state, fetchImpl };
}

function withFetch(t, fetchImpl) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  t.after(() => { globalThis.fetch = original; });
}

async function call(path, { method = 'GET', token, body, env = ENV } = {}) {
  const headers = { origin: 'https://matthew.mccluster.org' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await core.fetch(new Request(`https://api.mccluster.org${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: res.status, body: await res.json(), headers: res.headers };
}

test('flag off: the scheduled hook makes no network or database call, and manual collection is refused', async (t) => {
  const h = harness();
  withFetch(t, h.fetchImpl);
  const env = { ...ENV, INTEL_USGS_COLLECTOR_ENABLED: 'false' };
  assert.equal(collectorEnabled(env), false);
  assert.equal(collectorEnabled({ ...ENV, INTEL_USGS_COLLECTOR_ENABLED: undefined }), false, 'absent means off');
  assert.deepEqual(await runScheduledIntelCollectors(env), { ran: false, reason: 'collector_disabled' });
  assert.equal(h.calls.length, 0, 'no fetch at all with the flag off');
  const res = await call('/v1/intel/collect/usgs', { method: 'POST', token: 'owner-token', env });
  assert.equal(res.status, 409);
  assert.equal(res.body.detail.code, 'collector_disabled');
  assert.ok(!h.calls.some((c) => c.url.includes('earthquake.usgs.gov') || c.url.includes('/rpc/')), 'refusal writes nothing');
});

test('wrangler.toml enables the owner-authorized private collector', async () => {
  const { readFile } = await import('node:fs/promises');
  const toml = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /^INTEL_USGS_COLLECTOR_ENABLED = "true"$/m);
});

test('owner routes refuse anonymous callers and members', async (t) => {
  const h = harness();
  withFetch(t, h.fetchImpl);
  assert.equal((await call('/v1/intel/health')).status, 401);
  assert.equal((await call('/v1/intel/health', { token: 'member-token' })).status, 403);
  assert.equal((await call('/v1/intel/claims', { method: 'POST', token: 'member-token', body: {} })).status, 403);
});

test('before the migration is applied, routes say intel_schema_not_ready instead of reporting empty data', async (t) => {
  const h = harness({ schemaReady: false });
  withFetch(t, h.fetchImpl);
  const health = await call('/v1/intel/health', { token: 'owner-token' });
  assert.equal(health.status, 200);
  assert.equal(health.body.schema_ready, false);
  assert.equal(health.body.stored, null, 'no invented zero totals');
  const evidence = await call('/v1/intel/evidence', { token: 'owner-token' });
  assert.equal(evidence.status, 503);
  assert.equal(evidence.body.detail.code, 'intel_schema_not_ready');
  const geo = await call('/v1/intel/geo', { token: 'owner-token' });
  assert.equal(geo.status, 503);
});

test('USGS query is bounded and checkpointed; fetch uses redirect manual (Workers reject "error")', async () => {
  const now = new Date('2026-10-16T00:00:00Z');
  const first = queryUrl({}, now);
  assert.equal(first.searchParams.get('starttime'), '2026-10-15T00:00:00.000Z', 'first run looks back 24h');
  assert.equal(first.searchParams.get('minmagnitude'), '2.5');
  assert.equal(first.searchParams.get('limit'), '500');
  assert.equal(first.searchParams.get('orderby'), 'time-asc');
  const next = queryUrl({ last_observed_at: '2026-10-15T20:00:00.000Z' }, now);
  assert.equal(next.searchParams.get('starttime'), '2026-10-15T19:00:00.000Z', 'one hour overlap before the checkpoint');

  let init = null;
  await fetchUsgsPage(first, async (_url, i) => { init = i; return json(USGS_FIXTURE); });
  assert.equal(init.redirect, 'manual');
});

test('normalization never invents coordinates', async () => {
  const [located, missing, nullIsland] = await Promise.all(USGS_FIXTURE.features.map((f) => normalizeFeature(f, '2026-10-16T00:00:00.000Z')));
  assert.equal(located.lat, 35.5);
  assert.equal(located.lon, -117.5);
  assert.equal(located.idempotency_key, `usgs:us7000aaaa:${Date.parse('2026-10-15T01:30:00Z')}`);
  assert.match(located.content_hash, /^[0-9a-f]{64}$/);
  assert.equal(located.source_url, 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000aaaa');
  assert.equal(located.measures.magnitude, 4.6);
  assert.ok(!('lat' in missing) && !('lon' in missing), 'no geometry -> unknown location');
  assert.ok(!('lat' in nullIsland), '(0,0) -> unknown location');
  assert.equal(await normalizeFeature({ properties: {} }, 'x'), null, 'an unidentifiable feature is rejected, not guessed');
});

for (const [name, upstream, reason] of [
  ['HTTP 503', () => json({ error: 'busy' }, 503), 'provider_http_503'],
  ['a redirect', () => new Response(null, { status: 301, headers: { location: 'https://elsewhere.test/' } }), 'provider_redirect'],
  ['invalid JSON', () => new Response('<html>', { status: 200 }), 'provider_invalid_json'],
  ['a wrong shape', () => json({ type: 'Nope' }), 'provider_invalid_payload'],
  ['a network error', () => { throw new TypeError('fetch failed'); }, 'provider_network_error']
]) {
  test(`an upstream failure (${name}) is a failed run, never zero rows of success`, async (t) => {
    const h = harness({ usgs: upstream });
    withFetch(t, h.fetchImpl);
    const report = await runUsgsCollector(ENV, { fetchImpl: h.fetchImpl, now: new Date('2026-10-16T00:00:00Z') });
    assert.equal(report.status, 'failed');
    assert.equal(report.error, reason);
    const failCall = h.calls.find((c) => c.url.endsWith('/rpc/intel_collector_fail'));
    assert.ok(failCall, 'the failure is recorded');
    assert.equal(failCall.body.p_error, reason);
    assert.equal(failCall.body.p_run, RUN);
    assert.ok(!h.calls.some((c) => c.url.endsWith('/rpc/intel_collector_commit')), 'nothing is committed and the cursor does not move');
  });
}

test('HTTP 204 from USGS is an explicit "no events" and commits an empty batch', async (t) => {
  const h = harness({ usgs: () => new Response(null, { status: 204 }) });
  withFetch(t, h.fetchImpl);
  const report = await runUsgsCollector(ENV, { fetchImpl: h.fetchImpl });
  assert.equal(report.status, 'succeeded');
  const commit = h.calls.find((c) => c.url.endsWith('/rpc/intel_collector_commit'));
  assert.deepEqual(commit.body.p_records, []);
  assert.deepEqual(commit.body.p_cursor, {}, 'cursor unchanged when nothing arrived');
});

test('full loop: USGS evidence -> claim -> briefing -> decision -> mission -> outcome -> lineage, with fixture IDs', async (t) => {
  const h = harness();
  withFetch(t, h.fetchImpl);
  const owner = 'owner-token';

  // 1. collect (owner trigger; the flag is on in this env)
  const collect = await call('/v1/intel/collect/usgs', { method: 'POST', token: owner });
  assert.equal(collect.status, 200, JSON.stringify(collect.body));
  assert.equal(collect.body.report.status, 'succeeded');
  const commit = h.calls.find((c) => c.url.endsWith('/rpc/intel_collector_commit'));
  assert.equal(commit.body.p_org, ORG);
  assert.equal(commit.body.p_records.length, 3);
  assert.deepEqual(commit.body.p_cursor, { last_observed_at: '2026-10-15T01:20:00.000Z' }, 'checkpoint = newest observed event');
  const begin = h.calls.find((c) => c.url.endsWith('/rpc/intel_collector_begin'));
  assert.equal(begin.body.p_connector.license_policy.publisher, 'U.S. Geological Survey');
  assert.equal(begin.body.p_min_interval_seconds, 900);

  // 2. review evidence
  const listed = await call('/v1/intel/evidence?review_status=all', { token: owner });
  assert.equal(listed.body.evidence[0].id, EVIDENCE_LOCATED);
  const reviewed = await call(`/v1/intel/evidence/${EVIDENCE_LOCATED}/review`, { method: 'POST', token: owner, body: { status: 'accepted', visibility: 'public', note: 'matches the USGS event page' } });
  assert.equal(reviewed.status, 200);
  const reviewCall = h.calls.find((c) => c.url.endsWith('/rpc/intel_review'));
  assert.equal(reviewCall.body.p_actor, OWNER, 'the reviewer is the authenticated owner');
  assert.equal(reviewed.body.audit.recorded, true, 'every mutation is audited');

  // 3. claim + review
  const claim = await call('/v1/intel/claims', { method: 'POST', token: owner, body: {
    statement: 'Seismic activity near Example warrants a preparedness check-in mission',
    subject_kind: 'event', purpose: 'nonprofit_program',
    evidence: [{ evidence_id: EVIDENCE_LOCATED, stance: 'supports' }, { evidence_id: EVIDENCE_UNKNOWN, stance: 'context' }]
  } });
  assert.equal(claim.status, 201);
  assert.equal(claim.body.claim.claim_id, CLAIM);
  assert.equal((await call('/v1/intel/claims', { method: 'POST', token: owner, body: { statement: 'x', subject_kind: 'person', purpose: 'operations', evidence: [{ evidence_id: EVIDENCE_LOCATED, stance: 'supports' }] } })).status, 400, 'no person-level subjects');
  assert.equal((await call('/v1/intel/claims', { method: 'POST', token: owner, body: { statement: 'x', subject_kind: 'place', purpose: 'electoral', evidence: [{ evidence_id: EVIDENCE_LOCATED, stance: 'supports' }] } })).status, 400, 'no electoral lane');
  assert.equal((await call(`/v1/intel/claims/${CLAIM}/review`, { method: 'POST', token: owner, body: { status: 'supported', confidence: 0.6 } })).status, 200);

  // 4. briefing with citations
  const briefing = await call('/v1/intel/briefings', { method: 'POST', token: owner, body: {
    title: 'Example region seismic briefing', body: 'Summary [1][2].',
    citations: [{ claim_id: CLAIM }, { evidence_id: EVIDENCE_LOCATED, locator: 'USGS event page' }]
  } });
  assert.equal(briefing.status, 201);
  assert.equal(briefing.body.briefing.briefing_id, BRIEFING);
  assert.equal((await call('/v1/intel/briefings', { method: 'POST', token: owner, body: { title: 't', body: 'b', citations: [] } })).status, 400, 'a briefing cites something');

  // 5. decision proposed through context-decision as the owner, basis recorded
  const decision = await call('/v1/intel/decisions', { method: 'POST', token: owner, body: {
    briefing_id: BRIEFING, title: 'Run a preparedness check-in', decision: 'Open a check-in mission', rationale: 'Briefing cites accepted USGS evidence'
  } });
  assert.equal(decision.status, 201, JSON.stringify(decision.body));
  assert.equal(decision.body.decision.id, DECISION);
  assert.equal(h.state.decision.metadata.intel_briefing_id, BRIEFING);

  // a proposed decision cannot create a mission
  const early = await call(`/v1/intel/decisions/${DECISION}/missions`, { method: 'POST', token: owner, body: { idempotency_key: 'mission-1', title: 'Preparedness check-in' } });
  assert.equal(early.status, 409);

  // 6. owner approves, then the linked mission is created (draft)
  const approved = await call(`/v1/intel/decisions/${DECISION}/approve`, { method: 'POST', token: owner, body: { status: 'approved', note: 'go' } });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.decision.approved_by, OWNER);
  const mission = await call(`/v1/intel/decisions/${DECISION}/missions`, { method: 'POST', token: owner, body: {
    idempotency_key: 'mission-1', title: 'Preparedness check-in', domain: 'community',
    objectives: ['Contact 10 households'], region_label: 'Example region', target_measures: { households_contacted: 10 }
  } });
  assert.equal(mission.status, 201);
  assert.equal(mission.body.mission.mission_id, MISSION);
  assert.equal(mission.body.mission.mission_status, 'draft');

  // 7. outcome with proof, reviewed, fed back to the claim
  const outcome = await call(`/v1/intel/missions/${MISSION}/outcomes`, { method: 'POST', token: owner, body: {
    idempotency_key: 'outcome-1', summary: '10 households contacted', occurred_at: '2026-10-16T12:00:00Z',
    measures: { households_contacted: { value: 10, unit: 'households' } }, proof_ids: [PROOF]
  } });
  assert.equal(outcome.status, 201);
  const outcomeReview = await call(`/v1/intel/outcomes/${OUTCOME}/review`, { method: 'POST', token: owner, body: { status: 'accepted', claim_id: CLAIM, stance: 'supports' } });
  assert.equal(outcomeReview.body.review.evidence_id, OUTCOME_EVIDENCE);

  // 8. lineage
  const lineage = await call(`/v1/intel/lineage/claims/${CLAIM}`, { token: owner });
  assert.equal(lineage.status, 200);
  const l = lineage.body.lineage;
  assert.deepEqual(l.evidence.map((e) => e.id), [EVIDENCE_LOCATED, EVIDENCE_UNKNOWN, OUTCOME_EVIDENCE]);
  assert.equal(l.briefings[0].id, BRIEFING);
  assert.equal(l.decisions[0].id, DECISION);
  assert.equal(l.decisions[0].status, 'approved');
  assert.equal(l.missions[0].mission_id, MISSION);
  assert.equal(l.outcomes[0].id, OUTCOME);
  assert.deepEqual(l.outcomes[0].proof_ids, [PROOF]);
  assert.equal(l.outcomes[0].feedback_evidence_id, OUTCOME_EVIDENCE);
  assert.equal((await call('/v1/intel/lineage/claims/00000000-0000-4000-8000-000000000999', { token: owner })).status, 404);

  // 9. health separates stored totals, the latest run and failures
  const health = await call('/v1/intel/health', { token: owner });
  assert.equal(health.body.schema_ready, true);
  assert.equal(health.body.collector.enabled, true);
  assert.equal(health.body.latest_run.status, 'succeeded');
  assert.equal(health.body.failures.last_7d, 0);
  assert.equal(health.body.stored.source_records, 3);

  // audit trail covered every mutation
  const events = h.state.audit.map((a) => a.event);
  for (const e of ['intel.collect.usgs', 'intel.evidence.reviewed', 'intel.claim.created', 'intel.claim.reviewed', 'intel.briefing.created',
    'intel.decision.proposed', 'intel.decision.approved', 'intel.mission.created', 'intel.outcome.submitted', 'intel.outcome.reviewed']) {
    assert.ok(events.includes(e), `audited: ${e}`);
  }
});

test('geo aggregate: audience comes from the caller, never from a parameter', async (t) => {
  const h = harness();
  withFetch(t, h.fetchImpl);
  const anon = await call('/v1/intel/geo?audience=owner&cell=10&bucket=day&since=2026-10-14T00:00:00Z&until=2026-10-17T00:00:00Z');
  assert.equal(anon.status, 403);
  assert.equal(anon.body.code, 'admin_preview', 'a query parameter cannot release a feature');
  const member = await call('/v1/intel/geo', { token: 'member-token' });
  assert.equal(member.status,403);
  assert.match(member.headers.get('cache-control'), /no-store/);

  const owner = await call('/v1/intel/geo', { token: 'owner-token' });
  assert.equal(owner.body.audience, 'owner');
  assert.equal(owner.body.buckets[0].cell, 'g10:3:-12');

  assert.equal((await call('/v1/intel/geo?cell=3', {token:'owner-token'})).status, 400);
  const geoCalls = h.calls.filter((c) => c.url.endsWith('/rpc/intel_geo_projection'));
  assert.ok(geoCalls.every((c) => c.body.p_k === 5), 'the Worker always asks for k >= 5; the database floors it too');
});
