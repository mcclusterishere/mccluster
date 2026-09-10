/*
  Cloudflare Access verification for the internal spatial surfaces.

  Two locks, and they are independent on purpose:

    1. Cloudflare Access, verified here, in front of the console shell and the
       internal routes. Enabled by setting SEEK_FIRST_ACCESS_TEAM_DOMAIN and
       SEEK_FIRST_ACCESS_AUD on the Worker.
    2. McCluster house-owner authentication (Supabase bearer + org_members
       owner role), enforced by requireHouseOwner on every route that returns
       data or viewer credentials. That lock is NEVER optional.

  So an unconfigured Access means the console shell is reachable but empty:
  it renders a sign-in prompt and nothing else, because every byte of data and
  every viewer token behind it still needs the house-owner token.

  THE DEPLOY WIPE, AND WHY THE FLAG EXISTS.

  `wrangler deploy` uploads the [vars] block in wrangler.toml as the Worker's
  COMPLETE set of plaintext bindings. Any plaintext var added in the dashboard
  and absent from the toml is removed by the next deploy. Secrets set with
  `wrangler secret put` are untouched; plaintext vars are not.

  SEEK_FIRST_ACCESS_TEAM_DOMAIN and SEEK_FIRST_ACCESS_AUD are not credentials --
  the team domain is a public hostname and the AUD tag appears in every
  assertion Access issues -- so they are the kind of value an operator naturally
  sets in the dashboard. Which meant every deploy silently switched the edge
  lock off, and the only trace was a boolean on the health route that nobody
  reads on a good day.

  The fix is not to make the code cleverer. It is to notice that the values and
  the requirement do not have to live in the same place. SEEK_FIRST_ACCESS_REQUIRED
  is declared in the toml's [vars] block, so it survives the very deploy that
  wipes the values. Once the owner sets it, losing the config stops being a
  silent unlock and becomes a loud 503 that names the missing binding.

  Unset, the old behaviour stands: an unconfigured edge is a no-op, because
  failing closed before Access is set up would lock the owner out of their own
  console with no way back in. That is a bootstrap concession, and the flag is
  how it gets retired the moment it is no longer needed.
*/

const JWKS_TTL_MS = 3600000;
let jwksCache = { url: null, keys: null, fetchedAt: 0 };

export class AccessError extends Error {
  constructor(message, status = 403, code = 'access_denied', detail = null) {
    super(message);
    this.name = 'AccessError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function accessConfigured(env) {
  return Boolean(env?.SEEK_FIRST_ACCESS_TEAM_DOMAIN && env?.SEEK_FIRST_ACCESS_AUD);
}

/*
  Declared in wrangler.toml so it outlives the deploy that clears the values it
  guards. Anything other than an explicit "true" leaves the bootstrap no-op in
  place -- a typo must not be what silences the lock.
*/
export function accessRequired(env) {
  return String(env?.SEEK_FIRST_ACCESS_REQUIRED ?? '').trim().toLowerCase() === 'true';
}

export function missingAccessBindings(env) {
  return ['SEEK_FIRST_ACCESS_TEAM_DOMAIN', 'SEEK_FIRST_ACCESS_AUD'].filter((name) => !env?.[name]);
}

function teamOrigin(env) {
  const raw = String(env.SEEK_FIRST_ACCESS_TEAM_DOMAIN).trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const host = raw.includes('.') ? raw : `${raw}.cloudflareaccess.com`;
  if (!/^[a-z0-9.-]+$/i.test(host)) throw new AccessError('Access team domain is malformed', 500, 'access_misconfigured');
  return `https://${host}`;
}

function base64UrlToBytes(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeSegment(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

async function jwks(env) {
  const url = `${teamOrigin(env)}/cdn-cgi/access/certs`;
  const fresh = jwksCache.url === url && jwksCache.keys && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (fresh) return jwksCache.keys;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new AccessError('Could not load Cloudflare Access signing keys', 503, 'access_jwks_unavailable');
  const body = await response.json();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  if (!keys.length) throw new AccessError('Cloudflare Access returned no signing keys', 503, 'access_jwks_unavailable');
  jwksCache = { url, keys, fetchedAt: Date.now() };
  return keys;
}

function readToken(request) {
  const header = request.headers.get('cf-access-jwt-assertion');
  if (header) return header.trim();
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/*
  Returns the Access identity when Access is configured and the request carries
  a valid assertion, null when Access is not configured, and throws otherwise.
*/
export async function verifyAccess(request, env) {
  if (!accessConfigured(env)) {
    if (accessRequired(env)) {
      const missing = missingAccessBindings(env);
      throw new AccessError(
        `Cloudflare Access is required but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set. `
          + 'A wrangler deploy clears plaintext vars that are absent from wrangler.toml -- '
          + 'restore them in the [vars] block or as Worker secrets.',
        503,
        'access_misconfigured',
        { missing_bindings: missing }
      );
    }
    return null;
  }

  const token = readToken(request);
  if (!token) throw new AccessError('Cloudflare Access assertion is required', 401, 'access_assertion_missing');

  const parts = token.split('.');
  if (parts.length !== 3) throw new AccessError('Cloudflare Access assertion is malformed', 401, 'access_assertion_malformed');

  let header;
  let payload;
  try {
    header = decodeSegment(parts[0]);
    payload = decodeSegment(parts[1]);
  } catch {
    throw new AccessError('Cloudflare Access assertion is malformed', 401, 'access_assertion_malformed');
  }
  if (header?.alg !== 'RS256') throw new AccessError('Unsupported Access assertion algorithm', 401, 'access_assertion_alg');

  const now = Math.floor(Date.now() / 1000);
  if (!payload?.exp || payload.exp <= now) throw new AccessError('Cloudflare Access assertion expired', 401, 'access_assertion_expired');
  if (payload.nbf && payload.nbf > now + 60) throw new AccessError('Cloudflare Access assertion is not yet valid', 401, 'access_assertion_nbf');
  if (payload.iss !== teamOrigin(env)) throw new AccessError('Cloudflare Access assertion issuer mismatch', 403, 'access_assertion_issuer');

  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(String(env.SEEK_FIRST_ACCESS_AUD))) {
    throw new AccessError('Cloudflare Access assertion audience mismatch', 403, 'access_assertion_audience');
  }

  const candidates = (await jwks(env)).filter((key) => !header.kid || key.kid === header.kid);
  const signature = base64UrlToBytes(parts[2]);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  for (const jwk of candidates) {
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        { ...jwk, alg: 'RS256', ext: true, key_ops: ['verify'] },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
      );
      if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed)) {
        return { email: payload.email || null, sub: payload.sub || null, aud: env.SEEK_FIRST_ACCESS_AUD, expires_at: payload.exp };
      }
    } catch {
      // Try the next published key rather than failing on one rotation artifact.
    }
  }
  throw new AccessError('Cloudflare Access assertion signature is invalid', 403, 'access_assertion_signature');
}
