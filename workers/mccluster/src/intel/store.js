/* The intel canon's one door to Supabase.

   Every transition (collect, review, claim, briefing, decision basis,
   mission, outcome, lineage, projection, health) is a security-definer
   function from supabase/pending/20261015210000_intel_mission_canon_v1.sql,
   callable by the service role only. Until that migration is applied the
   functions do not exist; PostgREST answers "function not found", and every
   route says so plainly (503 intel_schema_not_ready) instead of pretending
   the store is empty. */

export class IntelError extends Error {
  constructor(message, status = 400, code = 'intel_error', detail = undefined) {
    super(message);
    this.name = 'IntelError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function configured(env) {
  return Boolean(env?.SUPABASE_URL && env?.SUPABASE_SERVICE_ROLE_KEY);
}

function headers(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra
  };
}

const SCHEMA_MISSING_CODES = new Set(['PGRST202', 'PGRST205', '42883', '42P01']);

function translate(status, payload) {
  const code = payload && typeof payload === 'object' ? String(payload.code || '') : '';
  const message = payload && typeof payload === 'object' ? String(payload.message || '') : '';
  if (SCHEMA_MISSING_CODES.has(code) || (status === 404 && /schema cache|does not exist/i.test(message))) {
    return new IntelError('Intel schema is not applied yet (supabase/pending/20261015210000_intel_mission_canon_v1.sql)', 503, 'intel_schema_not_ready');
  }
  if (code === 'P0002') return new IntelError(message || 'Not found', 404, 'not_found');
  if (code === '42501') return new IntelError(message || 'Not permitted', 409, 'not_permitted');
  if (code === '23505') return new IntelError(message || 'Already exists', 409, 'conflict');
  if (code === '23514' || code === '23503' || code === '22P02' || code === 'P0001' || status === 400) {
    return new IntelError(message || 'Rejected by the intel store', 400, 'rejected', { code });
  }
  return new IntelError('Intel store request failed', 502, 'intel_store_error', { status, code });
}

async function request(env, path, { method = 'GET', body, prefer } = {}) {
  if (!configured(env)) throw new IntelError('McCluster database is not configured', 503, 'database_not_configured');
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: headers(env, prefer ? { prefer } : {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!res.ok) throw translate(res.status, payload);
  return payload;
}

export function rpc(env, fn, args) {
  return request(env, `rpc/${fn}`, { method: 'POST', body: args });
}

export function select(env, path) {
  return request(env, path);
}

export async function resolveHouseOrg(env) {
  const rows = await request(env, 'orgs?slug=eq.mccluster&enabled=eq.true&select=id,slug&limit=1');
  const org = Array.isArray(rows) ? rows[0] : null;
  if (!org?.id) throw new IntelError('McCluster house organization is not configured', 503, 'house_org_missing');
  return org;
}
