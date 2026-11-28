/* WebCrypto helpers. Only globalThis.crypto.subtle is used so the same code
   runs on Node 20+ and on a Cloudflare Worker. */

const encoder = new TextEncoder();

/** A fresh ArrayBuffer-backed copy, which is what SubtleCrypto's types accept. */
function own(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto is not available in this runtime');
  return s;
}

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (const b of view) out += b.toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) throw new Error('invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return toHex(await subtle().digest('SHA-256', own(bytes)));
}

export async function sha256Base64Url(data: Uint8Array): Promise<string> {
  return toBase64Url(await subtle().digest('SHA-256', own(data)));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return subtle().importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function hmacSha256(secret: string, data: string | Uint8Array): Promise<Uint8Array> {
  const key = await hmacKey(secret);
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return new Uint8Array(await subtle().sign('HMAC', key, own(bytes)));
}

export async function hmacSha256Hex(secret: string, data: string | Uint8Array): Promise<string> {
  return toHex(await hmacSha256(secret, data));
}

/** Length-checked constant-time string comparison. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Ed25519 signature check (Discord interactions). */
export async function ed25519Verify(publicKeyHex: string, signatureHex: string, message: Uint8Array): Promise<boolean> {
  try {
    const key = await subtle().importKey('raw', own(fromHex(publicKeyHex)), { name: 'Ed25519' }, false, ['verify']);
    return await subtle().verify({ name: 'Ed25519' }, key, own(fromHex(signatureHex)), own(message));
  } catch {
    return false;
  }
}

export function randomId(): string {
  return globalThis.crypto.randomUUID();
}
