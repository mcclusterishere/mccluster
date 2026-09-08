// Capability lookup against the control plane's own grant matrix.
//
// The Worker used to decide authorization with role literals scattered
// through each router. That works until the vocabularies drift: the edge
// functions read `control_role_capabilities`, the Worker hardcoded a
// different ladder, and `org_members.role` allows a third set of values
// (`owner|staff|viewer`). One of those three has to be the authority.
//
// This module makes it the table. Nothing here invents a second auth
// system — it reads the grants the control plane already publishes, so
// changing who may do what is a row, not a deploy.
//
// Fail-closed by construction: an unreadable or empty grant table raises
// 503 rather than falling through to "allow".

const GRANT_TTL_MS = 60_000;

let cache = null;
let inFlight = null;

async function fetchGrants(env) {
  const url = `${env.SUPABASE_URL}/rest/v1/control_role_capabilities?select=role,capability,allowed`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      accept: 'application/json'
    }
  });
  if (!res.ok) {
    throw Object.assign(new Error('Authorization is temporarily unavailable'), { status: 503 });
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) {
    throw Object.assign(new Error('Authorization is temporarily unavailable'), { status: 503 });
  }
  const grants = new Map();
  for (const row of rows) grants.set(`${row.role} ${row.capability}`, row.allowed === true);
  return { grants, loadedAt: Date.now() };
}

async function grantTable(env) {
  if (cache && Date.now() - cache.loadedAt < GRANT_TTL_MS) return cache;
  if (!inFlight) {
    inFlight = fetchGrants(env)
      .then((table) => { cache = table; return table; })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

/**
 * Throw unless `membership.role` holds `capability` in the grant matrix.
 *
 * `membership` is the org_members row a router already fetched, so this
 * adds one cached read and no extra round trip on the hot path.
 */
export async function requireCapability(env, membership, capability) {
  if (!capability) throw new Error('requireCapability called with no capability');
  const role = membership?.role;
  if (!role) throw Object.assign(new Error('No organization membership found'), { status: 403 });

  const { grants } = await grantTable(env);
  if (grants.get(`${role} ${capability}`) !== true) {
    throw Object.assign(
      new Error(`Your role (${role}) does not include ${capability}`),
      { status: 403 }
    );
  }
  return membership;
}

// Tests reach for this so one case cannot leak a cached table into the next.
export function __resetCapabilityCache() { cache = null; inFlight = null; }
