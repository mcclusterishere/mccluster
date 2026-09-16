// Replay-resistant machine credential for the Cloudflare Worker -> Core hop.
//
// The tool broker still binds to loopback. Once it is published through an
// authenticated reverse tunnel, a bare shared bearer is no longer sufficient:
// anyone who replays one captured request would reach Core. This module adds
// the "dedicated, rotatable credential with replay-resistant validation" that
// docs/control-plane/MCCLUSTER-CORE.md requires for machine-to-machine
// dispatch.
//
// It deliberately mirrors core/src/compute/signature.mjs rather than inventing
// a second scheme. The compute gateway authenticates *nodes*, so it uses
// per-node public keys. The edge hop authenticates exactly one caller that
// already shares a secret with Core, so a symmetric HMAC keeps the Worker side
// implementable with plain WebCrypto and keeps the key rotatable in one place.

import crypto from 'node:crypto';

export const EDGE_PROTOCOL = 'mccluster-edge/v1';
export const DEFAULT_EDGE_CLOCK_SKEW_MS = 60_000;
const DEFAULT_NONCE_CACHE_MAX = 4096;

export const EDGE_HEADERS = Object.freeze({
  protocol: 'x-mccluster-edge-protocol',
  timestamp: 'x-mccluster-timestamp',
  nonce: 'x-mccluster-nonce',
  digest: 'x-mccluster-content-sha256',
  signature: 'x-mccluster-signature'
});

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

export function sha256Body(bodyBytes = Buffer.alloc(0)) {
  return b64url(crypto.createHash('sha256').update(bodyBytes).digest());
}

export function canonicalEdgeRequest({ method, path, timestamp, nonce, digest }) {
  return [
    'MCCLUSTER-EDGE-V1',
    String(method || 'POST').toUpperCase(),
    String(path || '/'),
    String(timestamp),
    String(nonce),
    String(digest)
  ].join('\n');
}

export function signEdgeRequest({
  secret,
  method,
  path,
  bodyBytes = Buffer.alloc(0),
  timestamp = new Date().toISOString(),
  nonce = crypto.randomUUID()
}) {
  if (!secret) throw new Error('Edge signing secret is required');
  const digest = sha256Body(bodyBytes);
  const canonical = canonicalEdgeRequest({ method, path, timestamp, nonce, digest });
  const signature = b64url(crypto.createHmac('sha256', secret).update(canonical).digest());
  return {
    [EDGE_HEADERS.protocol]: EDGE_PROTOCOL,
    [EDGE_HEADERS.timestamp]: timestamp,
    [EDGE_HEADERS.nonce]: nonce,
    [EDGE_HEADERS.digest]: digest,
    [EDGE_HEADERS.signature]: signature
  };
}

function header(headers, name) {
  if (typeof headers?.get === 'function') return headers.get(name);
  return headers?.[name] ?? headers?.[name.toLowerCase()] ?? null;
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

function authError(message, code, status = 401) {
  return Object.assign(new Error(message), { status, code });
}

// Bounded, self-expiring nonce cache. Core's broker is a single process, so an
// in-memory cache is the whole replay window; it is not shared state that any
// other component reads, which keeps this from becoming a second store.
function createNonceCache({ max = DEFAULT_NONCE_CACHE_MAX } = {}) {
  const seen = new Map();
  return {
    accept(nonce, expiresAtMs, now) {
      for (const [key, expiry] of seen) {
        if (expiry <= now) seen.delete(key);
        else break;
      }
      if (seen.has(nonce)) return false;
      seen.set(nonce, expiresAtMs);
      while (seen.size > max) seen.delete(seen.keys().next().value);
      return true;
    },
    get size() {
      return seen.size;
    }
  };
}

export function createEdgeVerifier({
  secret,
  maxClockSkewMs = DEFAULT_EDGE_CLOCK_SKEW_MS,
  nonceCacheMax = DEFAULT_NONCE_CACHE_MAX
} = {}) {
  if (!secret) throw new Error('Edge verifier requires a signing secret');
  const nonces = createNonceCache({ max: nonceCacheMax });

  return {
    verify({ method, path, headers, bodyBytes = Buffer.alloc(0), now = Date.now() }) {
      const protocol = header(headers, EDGE_HEADERS.protocol);
      if (protocol && protocol !== EDGE_PROTOCOL) {
        throw authError(`Unsupported edge protocol: ${protocol}`, 'EDGE_PROTOCOL_UNSUPPORTED', 400);
      }

      const timestamp = header(headers, EDGE_HEADERS.timestamp);
      const nonce = header(headers, EDGE_HEADERS.nonce);
      const digest = header(headers, EDGE_HEADERS.digest);
      const signature = header(headers, EDGE_HEADERS.signature);
      if (!timestamp || !nonce || !digest || !signature) {
        throw authError('Edge request is not signed', 'EDGE_SIGNATURE_MISSING');
      }

      const signedAt = Date.parse(timestamp);
      if (!Number.isFinite(signedAt)) throw authError('Invalid edge timestamp', 'EDGE_TIMESTAMP_INVALID');
      if (Math.abs(now - signedAt) > maxClockSkewMs) {
        throw authError('Edge request timestamp is outside the accepted window', 'EDGE_TIMESTAMP_SKEW');
      }

      // Bind the signature to the exact bytes Core is about to parse, so a
      // valid envelope cannot be reused to carry a different tool call.
      if (!constantTimeEqual(digest, sha256Body(bodyBytes))) {
        throw authError('Edge body digest mismatch', 'EDGE_DIGEST_MISMATCH');
      }

      const canonical = canonicalEdgeRequest({ method, path, timestamp, nonce, digest });
      const expected = b64url(crypto.createHmac('sha256', secret).update(canonical).digest());
      if (!constantTimeEqual(signature, expected)) {
        throw authError('Edge signature is not valid', 'EDGE_SIGNATURE_INVALID');
      }

      if (!nonces.accept(nonce, signedAt + maxClockSkewMs, now)) {
        throw authError('Edge request nonce was already used', 'EDGE_REPLAY_DETECTED', 409);
      }

      return { timestamp, nonce, protocol: EDGE_PROTOCOL };
    },
    get pendingNonces() {
      return nonces.size;
    }
  };
}
