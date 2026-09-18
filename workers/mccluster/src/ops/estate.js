/* ============================================================
   THE ESTATE, READ FROM DURABLE TRUTH.

   Nothing in this module knows a repository name, a domain or a host.
   It asks Supabase, because the estate is data the owner controls at
   runtime, not a constant somebody has to redeploy the Worker to change.

   docs/control-plane/registry.json is still the human-readable map and
   the seed; ops_estate_nodes is the live one. A test keeps them from
   drifting apart.
   ============================================================ */

import { opsError, text } from './lib.js';

const CACHE_TTL_MS = 30_000;
let cache = null;
let policyCache = null;

function serviceHeaders(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw opsError('McCluster is not configured', 503, { code: 'not_configured' });
  }
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

async function rest(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...serviceHeaders(env), ...(init.headers || {}) }
  });
  const raw = await res.text();
  let body = null;
  if (raw) { try { body = JSON.parse(raw); } catch { body = { raw }; } }
  if (!res.ok) {
    throw opsError('Control-plane database request failed', res.status === 404 ? 404 : 502, {
      code: 'database_error', status: res.status, detail: body
    });
  }
  return body;
}

export async function loadEstate(env, { force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.nodes;
  const nodes = await rest(env, 'ops_estate_nodes?select=*&order=kind.asc,node_key.asc');
  const list = Array.isArray(nodes) ? nodes : [];
  cache = { at: Date.now(), nodes: list };
  return list;
}

export function invalidateEstate() { cache = null; policyCache = null; }

/* Resolving a node is the containment boundary for the whole surface:
   an action can only ever touch something the owner registered and left
   enabled. A disabled node — `Here`, a retired satellite — is a 403 with
   the reason attached, not a silent no-op. */
export async function resolveNode(env, { kind, nodeKey, fallbackKey }) {
  const key = text(nodeKey, 250) || text(fallbackKey, 250);
  if (!key) {
    throw opsError('node_key is required for this action', 400, { code: 'missing_parameter', parameter: 'node_key' });
  }
  const nodes = await loadEstate(env);
  const matches = nodes.filter((node) => node.node_key === key && (!kind || node.kind === kind));
  const node = matches[0];
  if (!node) {
    throw opsError('That is not a node on the McCluster estate', 404, {
      code: 'node_not_found', node_key: key, kind: kind || null
    });
  }
  if (node.enabled === false) {
    throw opsError('That node is disabled on the estate and cannot be acted on', 403, {
      code: 'node_disabled', node_key: key,
      reason: node.metadata?.do_not_deploy ? 'Registered as do-not-deploy.' : 'Disabled by the owner.'
    });
  }
  return node;
}

export async function listNodes(env, params = {}) {
  const nodes = await loadEstate(env, { force: true });
  const kind = text(params.kind, 40);
  const provider = text(params.provider, 40);
  const filtered = nodes.filter((node) => {
    if (kind && node.kind !== kind) return false;
    if (provider && node.provider !== provider) return false;
    if (params.enabled === true && node.enabled === false) return false;
    if (params.enabled === false && node.enabled !== false) return false;
    return true;
  });
  return {
    count: filtered.length,
    by_kind: filtered.reduce((acc, node) => { acc[node.kind] = (acc[node.kind] || 0) + 1; return acc; }, {}),
    nodes: filtered.map((node) => ({
      kind: node.kind, node_key: node.node_key, name: node.name, provider: node.provider,
      provider_ref: node.provider_ref, default_branch: node.default_branch, role: node.role,
      enabled: node.enabled, metadata: node.metadata || {}
    }))
  };
}

const KINDS = ['repo', 'site', 'worker', 'database', 'host', 'zone', 'bucket', 'queue'];
const PROVIDERS = ['github', 'cloudflare', 'supabase', 'ovh', 'http'];

export async function upsertNode(env, params = {}) {
  const kind = text(params.kind, 40);
  const nodeKey = text(params.node_key, 250);
  if (!KINDS.includes(kind)) {
    throw opsError('kind must be one of the estate kinds', 400, { code: 'invalid_parameter', parameter: 'kind', allowed: KINDS });
  }
  if (!nodeKey) throw opsError('node_key is required', 400, { code: 'missing_parameter', parameter: 'node_key' });

  const existing = (await loadEstate(env, { force: true })).find((n) => n.kind === kind && n.node_key === nodeKey) || null;
  const provider = text(params.provider, 40) || existing?.provider;
  if (!PROVIDERS.includes(provider)) {
    throw opsError('provider must be one of the estate providers', 400, {
      code: 'invalid_parameter', parameter: 'provider', allowed: PROVIDERS
    });
  }

  const metadata = params.metadata && typeof params.metadata === 'object' && !Array.isArray(params.metadata)
    ? params.metadata : {};
  const row = {
    kind,
    node_key: nodeKey,
    name: text(params.name, 200) || existing?.name || nodeKey,
    provider,
    provider_ref: params.provider_ref === undefined ? (existing?.provider_ref ?? null) : text(params.provider_ref, 250) || null,
    default_branch: params.default_branch === undefined ? (existing?.default_branch ?? null) : text(params.default_branch, 250) || null,
    role: params.role === undefined ? (existing?.role ?? null) : text(params.role, 120) || null,
    /* Merge rather than replace: a caller binding an OVH service name
       must not blow away the deploy binding that was already there. */
    metadata: { ...(existing?.metadata || {}), ...metadata },
    updated_at: new Date().toISOString()
  };

  const result = await rest(env, 'ops_estate_nodes?on_conflict=kind,node_key', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([row])
  });
  invalidateEstate();
  const saved = Array.isArray(result) ? result[0] : result;
  return { created: !existing, node: saved || row };
}

export async function disableNode(env, params = {}) {
  const kind = text(params.kind, 40);
  const nodeKey = text(params.node_key, 250);
  if (!kind || !nodeKey) throw opsError('kind and node_key are required', 400, { code: 'missing_parameter' });
  const result = await rest(
    env,
    `ops_estate_nodes?kind=eq.${encodeURIComponent(kind)}&node_key=eq.${encodeURIComponent(nodeKey)}`,
    {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ enabled: false, updated_at: new Date().toISOString() })
    }
  );
  invalidateEstate();
  if (!Array.isArray(result) || !result.length) {
    throw opsError('That is not a node on the McCluster estate', 404, { code: 'node_not_found', node_key: nodeKey });
  }
  return { disabled: true, kind, node_key: nodeKey };
}

/* The live switchboard. An action the database does not list, or lists
   as disabled, cannot run — even though the Worker still ships its code
   and its schema. */
export async function loadActionPolicy(env) {
  /* Cached for the same half-minute as the estate. The board runs eight
     read actions in one request, and each of them consults the policy;
     without this that is eight identical queries for a table that
     changes when an owner decides it should. */
  if (policyCache && Date.now() - policyCache.at < CACHE_TTL_MS) return policyCache.map;
  const rows = await rest(env, 'ops_action_policy?select=action_id,domain,capability,mutates,enabled');
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) map.set(row.action_id, row);
  policyCache = { at: Date.now(), map };
  return map;
}

export { rest as estateRest };
