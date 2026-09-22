import crypto from 'node:crypto';

const VERSION = 'v1';

function secretKey(secret = process.env.MCCLUSTER_MEETING_TARGET_KEY || '') {
  const raw = String(secret || '').trim();
  if (raw.length < 24) {
    throw Object.assign(new Error('MCCLUSTER_MEETING_TARGET_KEY must be configured with at least 24 characters'), {
      status: 503,
      code: 'MEETING_TARGET_KEY_NOT_CONFIGURED',
    });
  }
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

function b64(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function unb64(value) {
  return Buffer.from(String(value), 'base64url');
}

export function sealMeetingTarget(target, { secret } = {}) {
  if (!target || typeof target !== 'object') throw new Error('meeting target is required');
  const iv = crypto.randomBytes(12);
  const key = secretKey(secret);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('mccluster:meeting-target:v1', 'utf8'));
  const plaintext = Buffer.from(JSON.stringify(target), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64(iv), b64(tag), b64(ciphertext)].join('.');
}

export function openMeetingTarget(sealed, { secret } = {}) {
  const parts = String(sealed || '').split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw Object.assign(new Error('Unsupported or invalid sealed meeting target'), {
      status: 400,
      code: 'INVALID_MEETING_TARGET',
    });
  }
  const key = secretKey(secret);
  const iv = unb64(parts[1]);
  const tag = unb64(parts[2]);
  const ciphertext = unb64(parts[3]);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from('mccluster:meeting-target:v1', 'utf8'));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  const parsed = JSON.parse(plaintext);
  if (!parsed || typeof parsed !== 'object') throw new Error('Decrypted meeting target is invalid');
  return parsed;
}
