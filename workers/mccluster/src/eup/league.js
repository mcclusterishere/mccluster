/* E=Up → Environmental Justice League (admin-only intake).
   Reached only through ./router.js after the verified house-owner check. Every
   command goes to the one service-only RPC `eup_league_command` defined by
   supabase/pending/eup_league_v1.sql, which rechecks ownership, revisions and
   idempotency in the same transaction. Nothing here reads or writes the public
   projections (action_missions, network_groups, action_policy_bills) or the
   HELD world_environment SQL. Points, payment, publication and broadcast are
   absent on purpose: separate decisions, separate code.
   First complete mission target: "Write a song for a healthier world". */
import { CAMPAIGN_FIXTURE } from './league-fixture.js';

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const RPC = 'eup_league_command';
/* SQLSTATE → HTTP status and reason the Control shell can act on. */
const ERRORS = {
  '42501': [403, 'owner_required'], '40001': [409, 'revision_conflict'], 'P0002': [404, 'not_found'],
  '22023': [422, 'invalid'], '23505': [409, 'exists'], '23514': [422, 'invalid'],
  EU001: [409, 'capacity_exhausted'], EU002: [403, 'self_review_denied'], EU003: [409, 'idempotency_conflict']
};

async function body(request, fail, max = 32768) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw fail(415, 'JSON required', 'json_required');
  const reader = request.body?.getReader();
  if (!reader) throw fail(400, 'Body required', 'body_required');
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw fail(413, 'Body too large', 'body_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let parsed;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw fail(400, 'Invalid JSON', 'invalid_json'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw fail(400, 'Invalid JSON', 'invalid_json');
  return parsed;
}

function key(b, fail) {
  if (typeof b.idempotency_key !== 'string' || !KEY.test(b.idempotency_key)) throw fail(400, 'Idempotency key required', 'idempotency_key_required');
  return b.idempotency_key;
}
function revision(b, fail) {
  if (!Number.isInteger(b.expected_revision) || b.expected_revision < 1 || b.expected_revision > 2147483646) throw fail(400, 'Expected revision required', 'expected_revision_required');
  return b.expected_revision;
}
function id(value, fail) {
  if (typeof value !== 'string' || !UUID.test(value)) throw fail(404, 'Not found', 'not_found');
  return value.toLowerCase();
}

export async function leagueCommand(env, fetchImpl, fail, params) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw fail(503, 'League storage unavailable', 'storage_unavailable');
  const response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${RPC}`, {
    method: 'POST', redirect: 'manual',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_action: params.action, p_actor: params.actor, p_id: params.id || '', p_document: params.document ?? null, p_revision: params.revision ?? null, p_key: params.key ?? null })
  });
  if (response.status >= 300 && response.status < 400) throw fail(503, 'Storage redirect refused', 'storage_unavailable');
  let result = null;
  try { result = await response.json(); } catch { result = null; }
  if (!response.ok) {
    const [status, reason] = ERRORS[result?.code] || [503, 'storage_unavailable'];
    /* A missing RPC means the pending SQL is not applied: say so, do not pretend. */
    if (response.status === 404 && /function|rpc/i.test(result?.message || '')) throw fail(503, 'Environmental Justice League schema is not applied (pending eup_league_v1.sql)', 'schema_not_applied');
    throw fail(status, status === 503 ? 'League storage unavailable' : (result?.message || 'League request rejected'), reason);
  }
  return result;
}

export async function handleLeague(request, env, { user, parts, url, fetchImpl = fetch, fail }) {
  const method = request.method;
  const run = (action, extra = {}) => leagueCommand(env, fetchImpl, fail, { action, actor: user.id, ...extra });
  const [resource, resourceId, verb] = parts;

  if (resource === 'fixture' && method === 'GET' && parts.length === 1) {
    /* The draft catalogue the owner may create from. Unpublished, unpriced, not a seed. */
    return { ok: true, fixture: CAMPAIGN_FIXTURE };
  }
  if (resource === 'campaigns') {
    if (parts.length === 1 && method === 'GET') return { ok: true, campaigns: await run('campaigns.list') };
    if (parts.length === 1 && method === 'POST') {
      const b = await body(request, fail);
      if (!b.campaign || typeof b.campaign !== 'object' || Array.isArray(b.campaign)) throw fail(422, 'campaign object required', 'invalid');
      return { ok: true, campaign: await run('campaigns.create', { key: key(b, fail), document: b.campaign }) };
    }
    if (parts.length === 3 && verb === 'transition' && method === 'POST') {
      const b = await body(request, fail);
      if (!['released', 'paused', 'withdrawn'].includes(b.to)) throw fail(422, 'to must be released, paused or withdrawn', 'invalid');
      return { ok: true, campaign: await run('campaigns.transition', { id: id(resourceId, fail), key: key(b, fail), revision: revision(b, fail), document: { to: b.to } }) };
    }
    if (parts.length === 3 && verb === 'missions' && method === 'POST') {
      const b = await body(request, fail);
      if (!b.mission || typeof b.mission !== 'object' || Array.isArray(b.mission)) throw fail(422, 'mission object required', 'invalid');
      return { ok: true, mission: await run('missions.create', { id: id(resourceId, fail), key: key(b, fail), document: b.mission }) };
    }
  }
  if (resource === 'missions') {
    if (parts.length === 1 && method === 'GET') {
      const campaign = url.searchParams.get('campaign');
      return { ok: true, missions: await run('missions.list', { id: campaign ? id(campaign, fail) : '' }) };
    }
    if (parts.length === 2 && method === 'PUT') {
      const b = await body(request, fail);
      if (!b.mission || typeof b.mission !== 'object' || Array.isArray(b.mission)) throw fail(422, 'mission object required', 'invalid');
      return { ok: true, mission: await run('missions.update', { id: id(resourceId, fail), key: key(b, fail), revision: revision(b, fail), document: b.mission }) };
    }
    if (parts.length === 3 && verb === 'transition' && method === 'POST') {
      const b = await body(request, fail);
      if (!['released', 'paused', 'withdrawn'].includes(b.to)) throw fail(422, 'to must be released, paused or withdrawn', 'invalid');
      return { ok: true, mission: await run('missions.transition', { id: id(resourceId, fail), key: key(b, fail), revision: revision(b, fail), document: { to: b.to } }) };
    }
    if (parts.length === 3 && verb === 'applications' && method === 'POST') {
      /* Admin preview: the owner records an application (default applicant: themselves). */
      const b = await body(request, fail);
      const doc = b.application && typeof b.application === 'object' && !Array.isArray(b.application) ? b.application : {};
      if (doc.applicant !== undefined && (typeof doc.applicant !== 'string' || !UUID.test(doc.applicant))) throw fail(422, 'applicant must be an account id', 'invalid');
      return { ok: true, application: await run('applications.create', { id: id(resourceId, fail), key: key(b, fail), revision: revision(b, fail), document: doc }) };
    }
  }
  if (resource === 'applications') {
    if (parts.length === 1 && method === 'GET') {
      const mission = url.searchParams.get('mission'); const status = url.searchParams.get('status');
      if (status && !['submitted', 'approved', 'declined', 'withdrawn'].includes(status)) throw fail(422, 'Unknown status', 'invalid');
      return { ok: true, applications: await run('applications.list', { id: mission ? id(mission, fail) : '', document: status ? { status } : null }) };
    }
    if (parts.length === 3 && verb === 'decision' && method === 'POST') {
      const b = await body(request, fail);
      if (!['approved', 'declined'].includes(b.decision)) throw fail(422, 'decision must be approved or declined', 'invalid');
      const document = { decision: b.decision };
      if (b.reason !== undefined) document.reason = b.reason;
      return { ok: true, application: await run('applications.decide', { id: id(resourceId, fail), key: key(b, fail), revision: revision(b, fail), document }) };
    }
  }
  if (resource === 'assignments') {
    if (parts.length === 1 && method === 'GET') {
      const mission = url.searchParams.get('mission');
      return { ok: true, assignments: await run('assignments.list', { id: mission ? id(mission, fail) : '' }) };
    }
    if (parts.length === 3 && verb === 'accept' && method === 'POST') {
      const b = await body(request, fail);
      return { ok: true, assignment: await run('assignments.accept', { id: id(resourceId, fail), key: key(b, fail), revision: revision(b, fail), document: {} }) };
    }
    if (parts.length === 3 && verb === 'proofs' && method === 'POST') {
      const b = await body(request, fail);
      if (!b.proof || typeof b.proof !== 'object' || Array.isArray(b.proof)) throw fail(422, 'proof object required', 'invalid');
      const extra = b.expected_revision === undefined ? {} : { revision: revision(b, fail) };
      return { ok: true, proof: await run('proofs.submit', { id: id(resourceId, fail), key: key(b, fail), document: b.proof, ...extra }) };
    }
  }
  if (resource === 'proofs') {
    if (parts.length === 1 && method === 'GET') {
      const assignment = url.searchParams.get('assignment');
      return { ok: true, proofs: await run('proofs.list', { id: assignment ? id(assignment, fail) : '' }) };
    }
    if (parts.length === 3 && verb === 'review' && method === 'POST') {
      const b = await body(request, fail);
      if (!['accepted', 'needs_changes', 'rejected'].includes(b.decision)) throw fail(422, 'decision must be accepted, needs_changes or rejected', 'invalid');
      if (!Number.isInteger(b.proof_revision) || b.proof_revision < 1) throw fail(400, 'proof_revision required', 'expected_revision_required');
      const document = { decision: b.decision };
      if (b.reason !== undefined) document.reason = b.reason;
      return { ok: true, proof: await run('proofs.review', { id: id(resourceId, fail), key: key(b, fail), revision: b.proof_revision, document }) };
    }
    if (parts.length === 3 && verb === 'consent' && method === 'POST') {
      const b = await body(request, fail);
      if (!b.consent || typeof b.consent !== 'object' || Array.isArray(b.consent)) throw fail(422, 'consent object required', 'invalid');
      if (!Number.isInteger(b.proof_revision) || b.proof_revision < 1) throw fail(400, 'proof_revision required', 'expected_revision_required');
      return { ok: true, consent: await run('consents.set', { id: id(resourceId, fail), key: key(b, fail), revision: b.proof_revision, document: b.consent }) };
    }
  }
  if (resource === 'consents' && parts.length === 1 && method === 'GET') {
    const proof = url.searchParams.get('proof');
    return { ok: true, consents: await run('consents.list', { id: proof ? id(proof, fail) : '' }) };
  }
  if (resource === 'publish' || resource === 'broadcast' || resource === 'payouts' || resource === 'points') {
    throw fail(501, 'Publication, broadcast, points and payouts are separate decisions and are not implemented', 'not_implemented');
  }
  throw fail(404, 'League route not found', 'not_found');
}
