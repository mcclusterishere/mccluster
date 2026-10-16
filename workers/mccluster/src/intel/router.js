/* /v1/intel — the evidence -> claim -> briefing -> decision -> mission ->
   outcome loop (docs/control-plane/INTEL-TO-MISSION-CANON.md).

   Every route except GET /v1/intel/geo requires the McCluster house owner
   (the same requireHouseOwner gate as /v1/seek-first and /v1/status). Every
   mutation writes control_audit through lib/audit.js. Decisions are recorded
   and approved through the context-decision Edge Function with the owner's
   OWN bearer token, so ai_context.decisions carries the human approver; this
   Worker never writes that table and never treats the service key as a
   person.

   GET /v1/intel/geo is the globe's privacy-safe aggregate: public for
   anyone, members for any signed-in user, owner for the house owner, with
   the k-anonymity floor applied in the database. */

import { fail, reply } from '../lib/http.js';
import { recordAudit } from '../lib/audit.js';
import { IntelError, configured, resolveHouseOrg, rpc, select } from './store.js';
import { USGS_CONNECTOR, USGS_CONNECTOR_KEY, collectorEnabled, runUsgsCollector } from './usgs-collector.js';

import { createIndicatorClient, IndicatorError } from './world-indicators.js';
const indicatorClient = createIndicatorClient();

const SERVICE = 'mccluster-intel';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID}$`, 'i');

function bad(message, code = 'invalid_request') {
  return new IntelError(message, 400, code);
}

async function body(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 200_000) throw new IntelError('Request body is too large', 413, 'request_too_large');
  let value;
  try { value = await request.json(); } catch { throw bad('Request body must be JSON', 'invalid_json'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad('Request body must be a JSON object', 'invalid_json');
  return value;
}

function text(value, name, { max = 2000, required = true } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) {
    if (required) throw bad(`${name} is required`);
    return null;
  }
  if (s.length > max) throw bad(`${name} must be at most ${max} characters`);
  return s;
}

function uuid(value, name) {
  const s = String(value || '').trim();
  if (!UUID_RE.test(s)) throw bad(`${name} must be a UUID`);
  return s.toLowerCase();
}

function oneOf(value, name, allowed, fallback) {
  const s = value === undefined || value === null || value === '' ? fallback : String(value).trim().toLowerCase();
  if (!allowed.includes(s)) throw bad(`${name} must be one of ${allowed.join(', ')}`);
  return s;
}

function idempotencyKey(value) {
  const s = String(value || '').trim();
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(s)) throw bad('idempotency_key is required (1-200 of A-Z a-z 0-9 . _ : -)');
  return s;
}

function measures(value, name = 'measures') {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw bad(`${name} must be an object`);
  if (JSON.stringify(value).length > 20_000) throw bad(`${name} is too large`);
  return value;
}

function iso(value, name, fallback = null) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== null) return fallback;
    throw bad(`${name} is required`);
  }
  const d = new Date(String(value));
  if (Number.isNaN(d.valueOf())) throw bad(`${name} must be an ISO timestamp`);
  return d.toISOString();
}

/* The owner's own token goes to context-decision, exactly as /v1/ai does. */
async function contextDecision(request, env, payload, method) {
  const authorization = request.headers.get('authorization') || '';
  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/context-decision`, {
    method,
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new IntelError(data?.error || 'Decision service refused the request', res.status >= 500 ? 502 : res.status, 'decision_service_error');
  }
  return data;
}

async function audit(env, orgId, user, event, resourceType, resourceId, detail = {}) {
  return recordAudit(env, {
    orgId, actorUserId: user?.id, event, capability: 'intel', resourceType, resourceId, detail
  });
}

async function geo(request, env, url, options) {
  // Audience from the caller, never from a parameter.
  let audience = 'public';
  const user = typeof options.authUser === 'function' ? await options.authUser(request, env).catch(() => null) : null;
  if (user?.id) {
    audience = 'members';
    try {
      await options.requireHouseOwner(request, env);
      audience = 'owner';
    } catch { /* a member, not the owner */ }
  }
  const until = iso(url.searchParams.get('until'), 'until', new Date().toISOString());
  const since = iso(url.searchParams.get('since'), 'since', new Date(Date.parse(until) - 7 * 86_400_000).toISOString());
  const cell = Number(url.searchParams.get('cell') || 10);
  if (![1, 5, 10, 30].includes(cell)) throw bad('cell must be 1, 5, 10 or 30');
  const bucket = oneOf(url.searchParams.get('bucket'), 'bucket', ['hour', 'day', 'week'], 'day');
  const org = await resolveHouseOrg(env);
  const projection = await rpc(env, 'intel_geo_projection', {
    p_org: org.id, p_audience: audience, p_since: since, p_until: until, p_cell_deg: cell, p_time_bucket: bucket, p_k: 5
  });
  const res = reply(request, env, {
    ok: true,
    service: SERVICE,
    schema: 'mccluster-intel-geo/v1',
    layer: { key: 'intel.evidence', attribution: [USGS_CONNECTOR.license_policy.attribution] },
    ...projection,
    generated_at: new Date().toISOString()
  });
  res.headers.set('cache-control', audience === 'public' ? 'public, max-age=300' : 'private, no-store');
  return res;
}

export async function handleIntelRequest(request, env, options = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!(path === '/v1/intel' || path.startsWith('/v1/intel/'))) return null;

  try {
    if (typeof options.requireHouseOwner !== 'function') {
      throw new IntelError('Intel authorization is unavailable', 503, 'authorization_unavailable');
    }
    if (!configured(env)) throw new IntelError('McCluster database is not configured', 503, 'database_not_configured');

    if (path === '/v1/intel/geo' && request.method === 'GET') return await geo(request, env, url, options);

    const user = await options.requireHouseOwner(request, env);
    if (path === '/v1/intel/world-indicators') {
      if (request.method !== 'GET') return fail(request, env, 'Method not allowed', 405);
      if ([...url.searchParams.keys()].some(k => !['economy', 'indicators'].includes(k) || url.searchParams.getAll(k).length !== 1)) throw bad('Unsupported or repeated parameter');
      try {
        const input = { economy: url.searchParams.get('economy') || 'WLD' };
        if (url.searchParams.has('indicators')) input.indicators = url.searchParams.get('indicators').split(',');
        const data = await (options.indicatorClient || indicatorClient)(input);
        const response = reply(request, env, { ok: true, ...data });
        response.headers.set('cache-control', 'private, no-store');
        return response;
      } catch (error) {
        if (!(error instanceof IndicatorError)) throw error;
        const status = error.code.startsWith('invalid_') && ['invalid_economy', 'invalid_indicators'].includes(error.code) ? 400 : error.code === 'too_many_indicator_requests' ? 429 : error.code === 'provider_timeout' ? 504 : 502;
        return fail(request, env, 'World indicators unavailable', status, { code: error.code });
      }
    }
    const org = await resolveHouseOrg(env);
    const actor = user.id;

    if ((path === '/v1/intel' || path === '/v1/intel/health') && request.method === 'GET') {
      let health = null;
      let schemaReady = true;
      try {
        health = await rpc(env, 'intel_health', { p_org: org.id, p_connector_key: USGS_CONNECTOR_KEY });
      } catch (error) {
        if (!(error instanceof IntelError && error.code === 'intel_schema_not_ready')) throw error;
        schemaReady = false;
      }
      return reply(request, env, {
        ok: true,
        service: SERVICE,
        schema_ready: schemaReady,
        collector: { key: USGS_CONNECTOR_KEY, enabled: collectorEnabled(env), flag: 'INTEL_USGS_COLLECTOR_ENABLED' },
        // stored totals, the latest run and failures are reported separately on purpose
        ...(health || { connector: null, stored: null, latest_run: null, last_successful_run: null, failures: null }),
        checked_at: new Date().toISOString()
      });
    }

    if (path === '/v1/intel/collect/usgs' && request.method === 'POST') {
      if (!collectorEnabled(env)) {
        return fail(request, env, 'The USGS collector is off (INTEL_USGS_COLLECTOR_ENABLED is not "true")', 409, { code: 'collector_disabled' });
      }
      const report = await runUsgsCollector(env);
      const auditResult = await audit(env, org.id, user, 'intel.collect.usgs', 'ops_ingest_run', report.run_id || null, { status: report.status || report.reason });
      return reply(request, env, { ok: report.status !== 'failed', service: SERVICE, report, audit: auditResult }, report.status === 'failed' ? 502 : 200);
    }

    if (path === '/v1/intel/evidence' && request.method === 'GET') {
      const status = oneOf(url.searchParams.get('review_status'), 'review_status', ['unreviewed', 'accepted', 'rejected', 'all'], 'unreviewed');
      const limit = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50));
      const filter = status === 'all' ? '' : `&review_status=eq.${status}`;
      const rows = await select(env,
        `intel_evidence?org_id=eq.${org.id}${filter}` +
        '&select=id,kind,title,summary,publisher,source_url,license,attribution,retrieved_at,observed_at,content_sha256,measures,lat,lon,geo_source,region_label,review_status,visibility,source_record_id,outcome_id' +
        `&order=retrieved_at.desc&limit=${limit}`);
      return reply(request, env, { ok: true, service: SERVICE, evidence: Array.isArray(rows) ? rows : [] });
    }

    let match = path.match(new RegExp(`^/v1/intel/evidence/(${UUID})/review$`, 'i'));
    if (match && request.method === 'POST') {
      const input = await body(request);
      const result = await rpc(env, 'intel_review', {
        p_org: org.id, p_actor: actor, p_subject_type: 'evidence', p_subject_id: uuid(match[1], 'evidence id'),
        p_to_status: oneOf(input.status, 'status', ['accepted', 'rejected']),
        p_note: text(input.note, 'note', { required: false }),
        p_confidence: null,
        p_visibility: input.visibility === undefined ? null : oneOf(input.visibility, 'visibility', ['private', 'members', 'public'])
      });
      const auditResult = await audit(env, org.id, user, 'intel.evidence.reviewed', 'intel_evidence', match[1], result);
      return reply(request, env, { ok: true, review: result, audit: auditResult });
    }

    if (path === '/v1/intel/claims' && request.method === 'POST') {
      const input = await body(request);
      if (!Array.isArray(input.evidence) || input.evidence.length === 0 || input.evidence.length > 100) {
        throw bad('evidence must list 1 to 100 {evidence_id, stance}');
      }
      const links = input.evidence.map((link, i) => ({
        evidence_id: uuid(link?.evidence_id, `evidence[${i}].evidence_id`),
        stance: oneOf(link?.stance, `evidence[${i}].stance`, ['supports', 'contradicts', 'context']),
        note: text(link?.note, `evidence[${i}].note`, { required: false })
      }));
      const result = await rpc(env, 'intel_create_claim', {
        p_org: org.id, p_actor: actor,
        p_statement: text(input.statement, 'statement'),
        p_subject_kind: oneOf(input.subject_kind, 'subject_kind', ['event', 'place', 'infrastructure', 'organization', 'program', 'policy', 'aggregate']),
        p_purpose: oneOf(input.purpose, 'purpose', ['public_interest_research', 'nonprofit_program', 'operations']),
        p_links: links,
        p_region_label: text(input.region_label, 'region_label', { max: 200, required: false })
      });
      const auditResult = await audit(env, org.id, user, 'intel.claim.created', 'intel_claim', result?.claim_id, { evidence_links: links.length });
      return reply(request, env, { ok: true, claim: result, audit: auditResult }, 201);
    }

    match = path.match(new RegExp(`^/v1/intel/claims/(${UUID})/review$`, 'i'));
    if (match && request.method === 'POST') {
      const input = await body(request);
      let confidence = null;
      if (input.confidence !== undefined && input.confidence !== null) {
        confidence = Number(input.confidence);
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw bad('confidence must be between 0 and 1');
      }
      const result = await rpc(env, 'intel_review', {
        p_org: org.id, p_actor: actor, p_subject_type: 'claim', p_subject_id: uuid(match[1], 'claim id'),
        p_to_status: oneOf(input.status, 'status', ['under_review', 'supported', 'disputed', 'rejected', 'retracted']),
        p_note: text(input.note, 'note', { required: false }),
        p_confidence: confidence,
        p_visibility: input.visibility === undefined ? null : oneOf(input.visibility, 'visibility', ['private', 'members', 'public'])
      });
      const auditResult = await audit(env, org.id, user, 'intel.claim.reviewed', 'intel_claim', match[1], result);
      return reply(request, env, { ok: true, review: result, audit: auditResult });
    }

    if (path === '/v1/intel/briefings' && request.method === 'POST') {
      const input = await body(request);
      if (!Array.isArray(input.citations) || input.citations.length === 0 || input.citations.length > 500) {
        throw bad('citations must list 1 to 500 {claim_id and/or evidence_id, locator}');
      }
      const citations = input.citations.map((c, i) => {
        const claim = c?.claim_id ? uuid(c.claim_id, `citations[${i}].claim_id`) : null;
        const evidence = c?.evidence_id ? uuid(c.evidence_id, `citations[${i}].evidence_id`) : null;
        if (!claim && !evidence) throw bad(`citations[${i}] needs claim_id or evidence_id`);
        return { claim_id: claim, evidence_id: evidence, locator: text(c?.locator, `citations[${i}].locator`, { max: 500, required: false }) };
      });
      const result = await rpc(env, 'intel_create_briefing', {
        p_org: org.id, p_actor: actor,
        p_title: text(input.title, 'title', { max: 300 }),
        p_body: text(input.body, 'body', { max: 40000 }),
        p_citations: citations,
        p_drafting: oneOf(input.drafting, 'drafting', ['human', 'model_assisted'], 'human')
      });
      const auditResult = await audit(env, org.id, user, 'intel.briefing.created', 'intel_briefing', result?.briefing_id, { citations: citations.length });
      return reply(request, env, { ok: true, briefing: result, audit: auditResult }, 201);
    }

    // Propose a decision from a final briefing: context-decision writes ai_context.decisions as the owner.
    if (path === '/v1/intel/decisions' && request.method === 'POST') {
      const input = await body(request);
      const briefingId = uuid(input.briefing_id, 'briefing_id');
      const proposed = await contextDecision(request, env, {
        org_id: org.id,
        title: text(input.title, 'title', { max: 300 }),
        decision: text(input.decision, 'decision', { max: 4000 }),
        rationale_summary: text(input.rationale, 'rationale', { max: 4000 }),
        risk_class: oneOf(input.risk_class, 'risk_class', ['low', 'medium', 'high', 'critical'], 'low'),
        status: 'proposed',
        proposed_by: 'intel_briefing',
        metadata: { intel_briefing_id: briefingId, source: SERVICE }
      }, 'POST');
      const decision = proposed?.decision || proposed;
      const decisionId = uuid(decision?.id, 'decision id returned by context-decision');
      const basis = await rpc(env, 'intel_record_decision_basis', {
        p_org: org.id, p_actor: actor, p_decision: decisionId, p_briefing: briefingId
      });
      const auditResult = await audit(env, org.id, user, 'intel.decision.proposed', 'ai_context.decision', decisionId, { briefing_id: briefingId, basis_items: basis?.basis_items });
      return reply(request, env, { ok: true, decision, basis, audit: auditResult }, 201);
    }

    match = path.match(new RegExp(`^/v1/intel/decisions/(${UUID})/approve$`, 'i'));
    if (match && request.method === 'POST') {
      const input = await body(request);
      const status = oneOf(input.status, 'status', ['approved', 'rejected'], 'approved');
      const decisionId = uuid(match[1], 'decision id');
      const resolved = await contextDecision(request, env, {
        org_id: org.id, decision_id: decisionId, status, note: text(input.note, 'note', { required: false }) || ''
      }, 'PATCH');
      const auditResult = await audit(env, org.id, user, `intel.decision.${status}`, 'ai_context.decision', decisionId, {});
      return reply(request, env, { ok: true, decision: resolved?.decision || resolved, audit: auditResult });
    }

    match = path.match(new RegExp(`^/v1/intel/decisions/(${UUID})/missions$`, 'i'));
    if (match && request.method === 'POST') {
      const input = await body(request);
      const objectives = Array.isArray(input.objectives) ? input.objectives.slice(0, 20).map((o, i) => text(o, `objectives[${i}]`, { max: 500 })) : [];
      const result = await rpc(env, 'intel_create_mission_from_decision', {
        p_org: org.id, p_actor: actor, p_decision: uuid(match[1], 'decision id'),
        p_idempotency_key: idempotencyKey(input.idempotency_key),
        p_mission: {
          title: text(input.title, 'title', { max: 160 }),
          description: text(input.description, 'description', { max: 4000, required: false }) || '',
          domain: oneOf(input.domain, 'domain', ['music', 'advocacy', 'community', 'business', 'research', 'education', 'mutual_aid', 'creative', 'other'], 'community'),
          objectives,
          scope: text(input.scope, 'scope', { required: false }),
          region_label: text(input.region_label, 'region_label', { max: 200, required: false }),
          target_measures: measures(input.target_measures, 'target_measures')
        }
      });
      const auditResult = await audit(env, org.id, user, 'intel.mission.created', 'action_mission', result?.mission_id, { decision_id: match[1], created: result?.created });
      return reply(request, env, { ok: true, mission: result, audit: auditResult }, result?.created ? 201 : 200);
    }

    match = path.match(new RegExp(`^/v1/intel/missions/(${UUID})/outcomes$`, 'i'));
    if (match && request.method === 'POST') {
      const input = await body(request);
      if (!Array.isArray(input.proof_ids) || input.proof_ids.length === 0 || input.proof_ids.length > 50) {
        throw bad('proof_ids must list 1 to 50 action_proofs ids');
      }
      const result = await rpc(env, 'intel_submit_outcome', {
        p_org: org.id, p_actor: actor, p_mission: uuid(match[1], 'mission id'),
        p_idempotency_key: idempotencyKey(input.idempotency_key),
        p_summary: text(input.summary, 'summary', { max: 4000 }),
        p_occurred_at: iso(input.occurred_at, 'occurred_at'),
        p_measures: measures(input.measures),
        p_proof_ids: input.proof_ids.map((id, i) => uuid(id, `proof_ids[${i}]`))
      });
      const auditResult = await audit(env, org.id, user, 'intel.outcome.submitted', 'intel_outcome', result?.outcome_id, { mission_id: match[1] });
      return reply(request, env, { ok: true, outcome: result, audit: auditResult }, result?.created ? 201 : 200);
    }

    match = path.match(new RegExp(`^/v1/intel/outcomes/(${UUID})/review$`, 'i'));
    if (match && request.method === 'POST') {
      const input = await body(request);
      const result = await rpc(env, 'intel_review_outcome', {
        p_org: org.id, p_actor: actor, p_outcome: uuid(match[1], 'outcome id'),
        p_status: oneOf(input.status, 'status', ['accepted', 'rejected']),
        p_note: text(input.note, 'note', { required: false }),
        p_claim: input.claim_id ? uuid(input.claim_id, 'claim_id') : null,
        p_stance: oneOf(input.stance, 'stance', ['supports', 'contradicts', 'context'], 'supports')
      });
      const auditResult = await audit(env, org.id, user, 'intel.outcome.reviewed', 'intel_outcome', match[1], result);
      return reply(request, env, { ok: true, review: result, audit: auditResult });
    }

    match = path.match(new RegExp(`^/v1/intel/lineage/claims/(${UUID})$`, 'i'));
    if (match && request.method === 'GET') {
      const lineage = await rpc(env, 'intel_lineage', { p_org: org.id, p_claim: uuid(match[1], 'claim id') });
      if (!lineage) return fail(request, env, 'Claim not found', 404, { code: 'not_found' });
      return reply(request, env, { ok: true, service: SERVICE, schema: 'mccluster-intel-lineage/v1', lineage });
    }

    return fail(request, env, 'Not found', 404);
  } catch (error) {
    if (error instanceof IntelError) {
      return fail(request, env, error.message, error.status, { code: error.code, ...(error.detail ? { detail: error.detail } : {}) });
    }
    throw error;
  }
}
