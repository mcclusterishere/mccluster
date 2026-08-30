import crypto from 'node:crypto';

export function sha256(value='') {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function signNodeRequest(secret, timestamp, rawBody) {
  const bodyHash = sha256(rawBody);
  return {
    bodyHash,
    signature: sha256(`${timestamp}.${bodyHash}.${sha256(secret)}`)
  };
}

export function safeEqualHex(left='', right='') {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right) || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function requestIsFresh(timestamp, maxSkewMs=300000) {
  const value = Number(timestamp);
  return Number.isFinite(value) && Math.abs(Date.now() - value) <= maxSkewMs;
}
