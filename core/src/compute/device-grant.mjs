// ONE-CLICK DEVICE OPT-IN (owner, 2026-11-24: "I should be able to opt the Mac in by logging into the Mac on the
// website and just clicking the opt-in button ... any computer ... including possibly a phone ... Anything with a
// chip, you want it to do work.").
//
// The owner, signed in on the website, asks the gateway for a grant: POST /v1/compute/device-grants with their
// Supabase session. Core checks the session with Supabase and that the account holds ops.use on the house org
// (control_authorize_service, the same check music-access makes). The grant it returns is
//
//   mccg1.<base64url(JSON {v,org,sub,exp,nonce,kind})>.<base64url(HMAC-SHA256(key, "mccg1." + payload))>
//
// keyed with CORE_COMPUTE_ENROLL_TOKEN (the secret enrolment already uses, so no new secret and no new table).
// /v1/compute/enroll then takes the grant instead of the raw token, once: its nonce goes through
// ops_compute_nonces like every signed request, so a copied grant cannot enrol a second device. It lives 15 minutes.
// A node enrolled by grant is labelled owned (the owner opted it in) and records who did it.
import crypto from 'node:crypto';

export const GRANT_PREFIX = 'mccg1';
export const GRANT_TTL_MS = 15 * 60_000;
export const GRANT_KINDS = new Set(['installer', 'browser']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const mac = (key, data) => crypto.createHmac('sha256', String(key)).update(data).digest();

export function issueGrant({ key, orgId, userId, kind = 'installer', now = Date.now(), ttlMs = GRANT_TTL_MS, nonce = crypto.randomBytes(18).toString('base64url') }) {
  if (!key || String(key).length < 16) throw Object.assign(new Error('Device opt-in is not configured'), { status: 503, code: 'AUTH_NOT_CONFIGURED' });
  if (!UUID.test(String(orgId || ''))) throw Object.assign(new Error('House organization is not configured'), { status: 503, code: 'ORG_NOT_CONFIGURED' });
  if (!UUID.test(String(userId || ''))) throw Object.assign(new Error('Invalid account'), { status: 401, code: 'UNAUTHORIZED' });
  if (!GRANT_KINDS.has(kind)) throw Object.assign(new Error('Unknown grant kind'), { status: 400, code: 'INVALID_GRANT_KIND' });
  const payload = b64(JSON.stringify({ v: 1, org: orgId, sub: userId, kind, exp: now + ttlMs, nonce }));
  const head = `${GRANT_PREFIX}.${payload}`;
  return { grant: `${head}.${b64(mac(key, head))}`, expires_at: new Date(now + ttlMs).toISOString(), kind };
}

/** The grant's claims, or a 401. Does not consume it: the caller records the nonce (one use). */
export function verifyGrant(grant, { key, now = Date.now() }) {
  const bad = (why) => Object.assign(new Error('Invalid device grant'), { status: 401, code: 'INVALID_GRANT', reason: why });
  if (!key) throw Object.assign(new Error('Device opt-in is not configured'), { status: 503, code: 'AUTH_NOT_CONFIGURED' });
  const parts = String(grant || '').split('.');
  if (parts.length !== 3 || parts[0] !== GRANT_PREFIX || !parts[1] || !parts[2]) throw bad('shape');
  const want = mac(key, `${parts[0]}.${parts[1]}`);
  let got;
  try { got = Buffer.from(parts[2], 'base64url'); } catch { throw bad('signature'); }
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw bad('signature');
  let claims;
  try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { throw bad('payload'); }
  if (claims?.v !== 1 || !UUID.test(String(claims.org)) || !UUID.test(String(claims.sub)) || !GRANT_KINDS.has(claims.kind)) throw bad('claims');
  if (typeof claims.nonce !== 'string' || claims.nonce.length < 16 || claims.nonce.length > 64) throw bad('nonce');
  if (!(Number(claims.exp) > now)) throw Object.assign(new Error('Device grant expired; opt in again'), { status: 401, code: 'GRANT_EXPIRED' });
  return claims;
}

/** The enrol call's credential: a grant (x-mccluster-enroll-grant) or the raw token (Bearer). */
export function enrollCredential(headers) {
  const grant = String(headers['x-mccluster-enroll-grant'] || '').trim();
  return grant ? { grant } : { token: true };
}

/** Is this Supabase session the house owner (ops.use on the house org)? Injected fetch for tests. */
export async function authorizeOwnerSession(accessToken, { supabaseUrl, apiKey, orgId, fetchImpl = fetch }) {
  const deny = (msg = 'Sign in as the owner to opt a device in') => Object.assign(new Error(msg), { status: 403, code: 'OWNER_REQUIRED' });
  if (!accessToken || accessToken.length > 8192) throw Object.assign(new Error('Sign in first'), { status: 401, code: 'UNAUTHORIZED' });
  if (!supabaseUrl || !apiKey) throw Object.assign(new Error('Device opt-in is not configured'), { status: 503, code: 'AUTH_NOT_CONFIGURED' });
  const base = String(supabaseUrl).replace(/\/$/, '');
  const who = await fetchImpl(`${base}/auth/v1/user`, { headers: { apikey: apiKey, authorization: `Bearer ${accessToken}` } });
  if (!who.ok) throw Object.assign(new Error('Sign in again'), { status: 401, code: 'UNAUTHORIZED' });
  const user = await who.json().catch(() => null);
  if (!UUID.test(String(user?.id || ''))) throw Object.assign(new Error('Sign in again'), { status: 401, code: 'UNAUTHORIZED' });
  const res = await fetchImpl(`${base}/rest/v1/rpc/control_authorize_service`, {
    method: 'POST',
    headers: { apikey: apiKey, ...(apiKey.startsWith('eyJ') ? { authorization: `Bearer ${apiKey}` } : {}), 'content-type': 'application/json' },
    body: JSON.stringify({ p_actor: user.id, p_org: orgId, p_capability: 'ops.use', p_resource_type: null, p_resource_id: null, p_request_hash: null, p_approval_id: null })
  });
  if (!res.ok) throw deny();
  const data = await res.json().catch(() => null);
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.allowed !== true) throw deny();
  return { userId: user.id };
}
