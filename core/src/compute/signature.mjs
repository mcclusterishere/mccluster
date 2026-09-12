import crypto from 'node:crypto';
import { COMPUTE_PROTOCOL, DEFAULT_CLOCK_SKEW_MS, validateNodeId } from './protocol.mjs';

export const SIGNATURE_HEADERS = Object.freeze({
  protocol: 'x-mccluster-compute-protocol',
  node: 'x-mccluster-node-id',
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

export function keyFingerprint(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  const der = key.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex');
}

export function nodeIdFromPublicKey(publicKeyPem) {
  return `node_${keyFingerprint(publicKeyPem).slice(0, 32)}`;
}

export function generateNodeIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return {
    nodeId: nodeIdFromPublicKey(publicKeyPem),
    fingerprint: keyFingerprint(publicKeyPem),
    publicKeyPem,
    privateKeyPem
  };
}

export function canonicalRequest({ method, path, nodeId, timestamp, nonce, digest }) {
  return [
    'MCCLUSTER-COMPUTE-V1',
    String(method || 'POST').toUpperCase(),
    String(path || '/'),
    validateNodeId(nodeId),
    String(timestamp),
    String(nonce),
    String(digest)
  ].join('\n');
}

export function signRequest({ privateKeyPem, method, path, nodeId, bodyBytes = Buffer.alloc(0), timestamp = new Date().toISOString(), nonce = crypto.randomUUID() }) {
  const digest = sha256Body(bodyBytes);
  const canonical = canonicalRequest({ method, path, nodeId, timestamp, nonce, digest });
  const signature = crypto.sign(null, Buffer.from(canonical), privateKeyPem).toString('base64url');
  return {
    [SIGNATURE_HEADERS.protocol]: COMPUTE_PROTOCOL,
    [SIGNATURE_HEADERS.node]: nodeId,
    [SIGNATURE_HEADERS.timestamp]: timestamp,
    [SIGNATURE_HEADERS.nonce]: nonce,
    [SIGNATURE_HEADERS.digest]: digest,
    [SIGNATURE_HEADERS.signature]: signature
  };
}

function header(headers, name) {
  if (typeof headers?.get === 'function') return headers.get(name);
  return headers?.[name] ?? headers?.[name.toLowerCase()] ?? null;
}

function constantTimeStringEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function verifySignedRequest({ publicKeyPem, method, path, headers, bodyBytes = Buffer.alloc(0), now = Date.now(), maxClockSkewMs = DEFAULT_CLOCK_SKEW_MS }) {
  const protocol = header(headers, SIGNATURE_HEADERS.protocol);
  const nodeId = validateNodeId(header(headers, SIGNATURE_HEADERS.node));
  const timestamp = header(headers, SIGNATURE_HEADERS.timestamp);
  const nonce = header(headers, SIGNATURE_HEADERS.nonce);
  const claimedDigest = header(headers, SIGNATURE_HEADERS.digest);
  const signature = header(headers, SIGNATURE_HEADERS.signature);
  if (protocol !== COMPUTE_PROTOCOL) throw Object.assign(new Error('Unsupported compute protocol'), { status: 400, code: 'BAD_PROTOCOL' });
  if (!timestamp || !nonce || !claimedDigest || !signature) throw Object.assign(new Error('Missing compute signature headers'), { status: 401, code: 'MISSING_SIGNATURE' });
  if (!/^[0-9a-f-]{16,80}$/i.test(nonce)) throw Object.assign(new Error('Invalid nonce'), { status: 401, code: 'BAD_NONCE' });
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time) || Math.abs(now - time) > maxClockSkewMs) {
    throw Object.assign(new Error('Compute request timestamp is outside the allowed clock window'), { status: 401, code: 'STALE_SIGNATURE' });
  }
  const digest = sha256Body(bodyBytes);
  if (!constantTimeStringEqual(digest, claimedDigest)) {
    throw Object.assign(new Error('Compute request body digest mismatch'), { status: 401, code: 'BAD_DIGEST' });
  }
  const canonical = canonicalRequest({ method, path, nodeId, timestamp, nonce, digest });
  let signatureBytes;
  try { signatureBytes = Buffer.from(signature, 'base64url'); }
  catch { throw Object.assign(new Error('Invalid signature encoding'), { status: 401, code: 'BAD_SIGNATURE' }); }
  if (!crypto.verify(null, Buffer.from(canonical), publicKeyPem, signatureBytes)) {
    throw Object.assign(new Error('Compute request signature is invalid'), { status: 401, code: 'BAD_SIGNATURE' });
  }
  return { nodeId, timestamp, nonce, digest };
}
