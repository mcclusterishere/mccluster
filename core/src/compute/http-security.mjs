import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

function digestSecret(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest();
}

export function secureSecretEqual(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string' || !received || !expected) return false;
  return timingSafeEqual(digestSecret(received), digestSecret(expected));
}

export function normalizeRequestId(value) {
  const candidate = Array.isArray(value) ? '' : String(value || '').trim();
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate)) return candidate;
  return randomUUID();
}

export function parseIdempotencyKey(value) {
  if (value == null || value === '') return null;
  if (Array.isArray(value)) throw Object.assign(new Error('Idempotency-Key must be supplied once'), { status: 400, code: 'BAD_IDEMPOTENCY_KEY' });
  const key = String(value);
  if (!/^[!-~]{1,128}$/.test(key)) {
    throw Object.assign(new Error('Idempotency-Key must be 1-128 printable ASCII characters without spaces'), { status: 400, code: 'BAD_IDEMPOTENCY_KEY' });
  }
  return key;
}

export function assertJsonContentType(value) {
  const contentType = Array.isArray(value) ? '' : String(value || '').toLowerCase();
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    throw Object.assign(new Error('POST requests require Content-Type: application/json'), { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  }
}

export function resolveScopedOrg(requestedOrg, canonicalOrg) {
  const requested = requestedOrg ? String(requestedOrg) : null;
  const canonical = canonicalOrg ? String(canonicalOrg) : null;
  if (canonical && requested && requested !== canonical) {
    throw Object.assign(new Error('Cross-organization compute administration is not allowed'), { status: 403, code: 'CROSS_ORG_DENIED' });
  }
  return requested || canonical;
}
