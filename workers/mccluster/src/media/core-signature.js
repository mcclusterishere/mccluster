// Core -> Worker machine credential for POST /v1/media/mcp, and (through
// ../world-core-reads.js) GETs of the read-only World layers the news pairing
// reads. Nothing else accepts it.
//
// McCluster Core on OVH calls this Worker's media MCP to run generative work
// (model3d, image, video, audio). It used to send a stored Supabase user token
// (MCCLUSTER_API_BEARER), which expires within the hour, so every media tool
// reached through Core failed with "Authentication required". Core now signs
// each request with the key it already shares with this Worker
// (CORE_EDGE_SIGNING_KEY), and a valid signature acts as the house owner.
//
// The format mirrors signCoreRequest() in core/src/broker-edge-auth.mjs byte
// for byte. Its canonical label (MCCLUSTER-CORE-V1) differs from the Worker ->
// Core label (MCCLUSTER-EDGE-V1), so a signature from one direction never
// verifies in the other.
//
// Fails closed: a request that announces the Core protocol and does not verify
// is refused, never downgraded to anonymous or to a bearer check.

export const CORE_PROTOCOL = 'mccluster-core/v1';
const CORE_LABEL = 'MCCLUSTER-CORE-V1';
export const CORE_CLOCK_SKEW_MS = 60_000;
const NONCE_CACHE_MAX = 4096;

const H = {
  protocol: 'x-mccluster-edge-protocol',
  timestamp: 'x-mccluster-timestamp',
  nonce: 'x-mccluster-nonce',
  digest: 'x-mccluster-content-sha256',
  signature: 'x-mccluster-signature'
};

function b64url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function constantTimeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length || left.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function authError(message, status = 401) {
  return Object.assign(new Error(message), { status });
}

// Per-isolate replay cache. Workers do not share memory across isolates, so on
// its own this narrows replay only to "another isolate within the 60-second
// window" (audit 2026-11-09, C5: two isolates accepted one captured signed
// mutation). It stays as the cheap first check; MUTATING calls additionally
// need an atomic claim in a SHARED replay store (below), and fail closed when
// none is configured. Read-only Core GETs keep this cache alone: they spend
// nothing and the World layers they read are idempotent (documented policy).
const seenNonces = new Map();
function acceptNonce(nonce, expiresAt, now) {
  for (const [key, expiry] of seenNonces) {
    if (expiry <= now) seenNonces.delete(key);
    else break;
  }
  if (seenNonces.has(nonce)) return false;
  seenNonces.set(nonce, expiresAt);
  while (seenNonces.size > NONCE_CACHE_MAX) seenNonces.delete(seenNonces.keys().next().value);
  return true;
}

export function __resetCoreNonces() {
  seenNonces.clear();
}

export function isCoreSigned(request) {
  return request.headers.get(H.protocol) === CORE_PROTOCOL;
}

/* Shared replay store contract: claim(nonce, expiresAtMs) -> true when this
   call is the first to claim the nonce, false when it was already claimed.
   Any throw means "could not consult the store" and refuses the mutation. */
const NONCE_TABLE = 'core_signed_nonces';

// Supabase is the one shared durable plane this Worker already has (no KV or
// D1 binding exists, and HereTenantAgent is tenant state). A unique-key insert
// is the atomic claim; the row carries its expiry so a scheduled sweep can
// drop old nonces. Needs supabase/pending/core_signed_nonces_v1.sql applied.
export function createSupabaseReplayStore(env, { fetchImpl = fetch } = {}) {
  return {
    async claim(nonce, expiresAt) {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('replay store is not configured');
      const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/${NONCE_TABLE}`, {
        method: 'POST',
        headers: { ...serviceHeaders(env), 'content-type': 'application/json', prefer: 'return=minimal' },
        body: JSON.stringify({ nonce, expires_at: new Date(expiresAt).toISOString() })
      });
      if (res.status === 201) return true;
      if (res.status === 409) return false;
      throw new Error(`replay store unavailable (${res.status})`);
    }
  };
}

function resolveReplayStore(env) {
  const mode = String(env.CORE_REPLAY_STORE || '').trim().toLowerCase();
  if (mode === 'supabase') return createSupabaseReplayStore(env);
  if (mode === 'isolate') return { async claim() { return true; }, isolateOnly: true };
  return null;
}

export async function verifyCoreSignature({
  request, env, path, bodyBytes, now = Date.now(),
  mutating = String(request.method).toUpperCase() !== 'GET',
  replayStore = undefined
}) {
  const secret = env.CORE_EDGE_SIGNING_KEY;
  if (!secret) throw authError('Core signing key is not configured', 503);

  const timestamp = request.headers.get(H.timestamp);
  const nonce = request.headers.get(H.nonce);
  const digest = request.headers.get(H.digest);
  const signature = request.headers.get(H.signature);
  if (!timestamp || !nonce || !digest || !signature) throw authError('Core request is not signed');

  const signedAt = Date.parse(timestamp);
  if (!Number.isFinite(signedAt)) throw authError('Invalid Core timestamp');
  if (Math.abs(now - signedAt) > CORE_CLOCK_SKEW_MS) throw authError('Core request timestamp is outside the accepted window');

  const actualDigest = b64url(await crypto.subtle.digest('SHA-256', bodyBytes));
  if (!constantTimeEqual(digest, actualDigest)) throw authError('Core body digest mismatch');

  const canonical = [CORE_LABEL, String(request.method).toUpperCase(), path, timestamp, nonce, digest].join('\n');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const expected = b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical)));
  if (!constantTimeEqual(signature, expected)) throw authError('Core signature is not valid');

  const expiresAt = signedAt + CORE_CLOCK_SKEW_MS;
  if (!acceptNonce(nonce, expiresAt, now)) throw authError('Core request nonce was already used', 409);
  if (!mutating) return true;

  const store = replayStore === undefined ? resolveReplayStore(env) : replayStore;
  if (!store) throw authError('Core replay store is not configured for mutating requests (CORE_REPLAY_STORE)', 503);
  let claimed;
  try {
    claimed = await store.claim(nonce, expiresAt);
  } catch (error) {
    throw authError(`Core replay store could not be consulted: ${error?.message || error}`, 503);
  }
  if (!claimed) throw authError('Core request nonce was already used', 409);
  return true;
}

function serviceHeaders(env) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
}

// Core serves one house, so a verified Core call acts as that house's owner:
// the same person the edge already requires before it forwards anything to
// Core. Exactly one owner is required; anything else is refused rather than
// guessed, so a second owner never inherits Core's spend silently.
export async function houseOwnerActor(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw authError('Identity provider is not configured', 503);
  const orgRes = await fetch(`${env.SUPABASE_URL}/rest/v1/orgs?slug=eq.mccluster&select=id&limit=1`, { headers: serviceHeaders(env) });
  if (!orgRes.ok) throw authError('House organization lookup unavailable', 503);
  const orgId = (await orgRes.json())?.[0]?.id;
  if (!orgId) throw authError('House organization not found', 503);
  const ownerRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/org_members?org_id=eq.${encodeURIComponent(orgId)}&role=eq.owner&select=profile_id&limit=2`,
    { headers: serviceHeaders(env) }
  );
  if (!ownerRes.ok) throw authError('Owner membership lookup unavailable', 503);
  const owners = await ownerRes.json();
  if (!Array.isArray(owners) || owners.length !== 1 || !owners[0]?.profile_id) {
    throw authError('Core actor requires exactly one house owner', 503);
  }
  return { id: owners[0].profile_id, actor_source: 'core-signature' };
}
