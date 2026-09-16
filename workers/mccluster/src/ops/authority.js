/* ============================================================
   THE GATE.

   Every infrastructure action goes through this file, and this file
   goes through the control authority that already exists in the
   database (migrations 0047 and 0066). It does not decide anything
   itself:

     control_authorize_service     — may this actor, in this role,
                                     hold this capability, and if the
                                     capability is `high` risk, is
                                     there an approved control_approvals
                                     row bound to this exact request?
     control_record_command_service — write the attempt down before it
                                     runs, with an idempotency key.
     control_finish_command_service — write down what happened.

   Two properties matter more than anything else here.

   First, the record comes BEFORE the call to the provider. An action
   that reboots a host and then dies has still been written down. A
   ledger you only reach on success is a ledger of your successes.

   Second, the request hash covers the action, the node and the exact
   parameters. An approval is therefore an approval of one specific
   thing: approve a rollback to version A and you have not approved a
   rollback to version B, and you have not approved it twice.
   ============================================================ */

import { opsError, sha256Hex, text, truncate } from './lib.js';

function serviceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

async function rpc(env, name, body, { authorization } = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: authorization
      ? { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization, 'content-type': 'application/json' }
      : serviceHeaders(env),
    body: JSON.stringify(body || {})
  });
  const raw = await res.text();
  let parsed = null;
  if (raw) { try { parsed = JSON.parse(raw); } catch { parsed = { raw }; } }
  if (!res.ok) {
    throw opsError(
      text(parsed?.message, 300) || 'Control authority call failed',
      res.status >= 400 && res.status < 500 ? res.status : 502,
      { code: 'authority_error', rpc: name, detail: truncate(parsed, 1000) }
    );
  }
  return parsed;
}

async function restOne(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: serviceHeaders(env) });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => null);
  return Array.isArray(rows) ? rows[0] || null : rows;
}

export async function authUser(request, env) {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization }
  });
  if (!res.ok) return null;
  return res.json();
}

export async function houseOrgId(env) {
  const row = await restOne(env, 'orgs?slug=eq.mccluster&select=id&limit=1');
  if (!row?.id) {
    throw opsError('McCluster house organization is not configured', 503, { code: 'house_org_missing' });
  }
  return row.id;
}

/* The actor for the infrastructure surface is a member of the house
   org, not merely an authenticated application user. What that
   membership *permits* is then the capability ladder's problem, not
   this function's: staff read, owners act, and even an owner needs an
   approval for anything `high`. */
export async function resolveActor(request, env) {
  const user = await authUser(request, env);
  if (!user) throw opsError('Authentication required', 401, { code: 'unauthenticated' });
  const orgId = await houseOrgId(env);
  const membership = await restOne(
    env,
    `org_members?org_id=eq.${encodeURIComponent(orgId)}&profile_id=eq.${encodeURIComponent(user.id)}&select=role&limit=1`
  );
  if (!membership?.role) {
    throw opsError('McCluster house membership required', 403, { code: 'not_house_member' });
  }
  return { user, orgId, role: membership.role };
}

/* Stable across retries and across isolates: same action, same node,
   same parameters means the same hash, so an approval binds to it and
   a replay is recognisable. Keys are sorted because JSON key order is
   an accident of how the request was written. */
export async function requestHash({ actionId, nodeKey, params }) {
  const canonical = JSON.stringify({
    action: actionId,
    node: nodeKey || null,
    params: sortDeep(params ?? {})
  });
  return sha256Hex(canonical);
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])]));
  }
  return value;
}

export async function authorize(env, { actor, capability, resourceType, resourceId, hash, approvalId }) {
  const verdict = await rpc(env, 'control_authorize_service', {
    p_actor: actor.user.id,
    p_org: actor.orgId,
    p_capability: capability,
    p_resource_type: resourceType || null,
    p_resource_id: resourceId || null,
    p_request_hash: hash || null,
    p_approval_id: approvalId || null
  });
  if (verdict?.allowed === true) return verdict;

  const reason = text(verdict?.reason, 60) || 'denied';
  const messages = {
    not_org_member: 'You are not a member of the McCluster house organization',
    capability_denied: `Your role (${verdict?.role || 'unknown'}) does not hold ${capability}`,
    approval_required: `${capability} is a high-risk capability and needs an approved request before it can run`,
    approval_invalid: 'That approval does not match this exact request, or it has expired'
  };
  throw opsError(messages[reason] || `Not authorized for ${capability}`, reason === 'not_org_member' ? 403 : 403, {
    code: reason,
    capability,
    risk: verdict?.risk || null,
    ...(reason === 'approval_required' || reason === 'approval_invalid'
      ? { request_hash: hash, resource_type: resourceType, resource_id: resourceId, how: 'POST /v1/ops/approvals with this capability, resource and request_hash, then have an owner approve it.' }
      : {})
  });
}

export async function recordCommand(env, {
  actor, capability, actionId, resourceType, resourceId, hash, idempotencyKey, approvalId, status, metadata
}) {
  return rpc(env, 'control_record_command_service', {
    p_org: actor.orgId,
    p_actor: actor.user.id,
    p_actor_kind: actor.actorKind || 'human',
    p_capability: capability,
    p_resource_type: resourceType || null,
    p_resource_id: resourceId || null,
    p_action: actionId,
    p_request_hash: hash || null,
    p_idempotency_key: idempotencyKey || null,
    p_approval_id: approvalId || null,
    p_status: status || 'allowed',
    p_metadata: metadata || {}
  });
}

export async function finishCommand(env, commandId, status, result, error) {
  if (!commandId) return null;
  return rpc(env, 'control_finish_command_service', {
    p_command: commandId,
    p_status: status,
    p_result: result === undefined ? null : truncate(result, 8000),
    p_error: error ? text(error, 1000) : null
  }).catch(() => null);
}

/* Requesting and deciding an approval run as the human, not as the
   service: control_request_approval and control_decide_approval both
   read auth.uid(), and control_decide_approval insists the decider is
   an owner. So the Worker forwards the caller's own token instead of
   its service key — the database, not this file, decides who may say
   yes, and an agent holding an API token cannot approve its own work. */
export async function requestApproval(request, env, { orgId, capability, resourceType, resourceId, hash, reason, ttlSeconds }) {
  const authorization = request.headers.get('authorization') || '';
  const id = await rpc(env, 'control_request_approval', {
    p_org: orgId,
    p_capability: capability,
    p_resource_type: resourceType,
    p_resource_id: resourceId,
    p_request_hash: hash,
    p_reason: text(reason, 1000) || null,
    p_ttl_seconds: Number(ttlSeconds) || 1800
  }, { authorization });
  return typeof id === 'string' ? id : id?.id || null;
}

export async function decideApproval(request, env, { approvalId, state }) {
  const authorization = request.headers.get('authorization') || '';
  return rpc(env, 'control_decide_approval', {
    p_approval_id: approvalId,
    p_state: state
  }, { authorization });
}

export async function listCommands(env, orgId, { limit = 25, actionId } = {}) {
  const params = new URLSearchParams({
    org_id: `eq.${orgId}`,
    select: 'id,capability,action,resource_type,resource_id,status,error,created_at,finished_at,actor_kind,idempotency_key',
    order: 'created_at.desc',
    limit: String(Math.min(100, Math.max(1, Number(limit) || 25)))
  });
  if (actionId) params.set('action', `eq.${actionId}`);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/control_commands?${params}`, { headers: serviceHeaders(env) });
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

export async function listApprovals(env, orgId, { state = 'pending', limit = 25 } = {}) {
  const params = new URLSearchParams({
    org_id: `eq.${orgId}`,
    select: 'id,capability,resource_type,resource_id,request_hash,reason,state,created_at,expires_at',
    order: 'created_at.desc',
    limit: String(Math.min(100, Math.max(1, Number(limit) || 25)))
  });
  if (state && state !== 'all') params.set('state', `eq.${state}`);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/control_approvals?${params}`, { headers: serviceHeaders(env) });
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

/* An idempotency key already used by a finished command means the
   caller is retrying something that already happened. Replaying a
   reboot or a merge because a response was lost in transit is exactly
   the failure this prevents. */
export async function findReplay(env, orgId, idempotencyKey) {
  if (!idempotencyKey) return null;
  const params = new URLSearchParams({
    org_id: `eq.${orgId}`,
    idempotency_key: `eq.${idempotencyKey}`,
    select: 'id,action,status,result,error,created_at,finished_at',
    limit: '1'
  });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/control_commands?${params}`, { headers: serviceHeaders(env) });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export { rpc as authorityRpc };
