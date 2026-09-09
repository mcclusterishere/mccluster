/*
  Cloudflare Access verification for the internal spatial surfaces.

  Two locks, and they are independent on purpose:

    1. Cloudflare Access, verified here, in front of the console shell and the
       internal routes. Enabled by setting SEEK_FIRST_ACCESS_TEAM_DOMAIN and
       SEEK_FIRST_ACCESS_AUD on the Worker. Until those exist this is a no-op, because
       failing closed on an unconfigured edge would lock the owner out of their
       own console with no way back in.
    2. McCluster house-owner authentication (Supabase bearer + org_members
       owner role), enforced by requireHouseOwner on every route that returns
       data or viewer credentials. That lock is NEVER optional.

  So an unconfigured Access means the console shell is reachable but empty:
  it renders a sign-in prompt and nothing else, because every byte of data and
  every viewer token behind it still needs the house-owner token.
*/

const JWKS_TTL_MS = 3600000;
let jwksCache = { url: null, keys: null, fetchedAt: 0 };

export class AccessError extends Error {
  constructor(message, status = 403, code = 'access_denied') {
    super(message);
    this.name = 'AccessError';
    this.status = status;
    this.code = code;
  }
}

export function accessConfigured(env) {
  return Boolean(env?.SEEK_FIRST_ACCESS_TEAM_DOMAIN && env?.SEEK_FIRST_ACCESS_AUD);
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
  if (!accessConfigured(env)) return null;

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
