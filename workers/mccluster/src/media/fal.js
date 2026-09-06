import { fal } from '@fal-ai/client';

const FAL_JWKS_URL = 'https://rest.fal.ai/.well-known/jwks.json';
const FAL_WEBHOOK_MAX_AGE_SECONDS = 300;
const FAL_JWKS_CACHE_MS = 6 * 60 * 60 * 1000;
let jwksCache = { keys: null, expiresAt: 0 };

function configured(env) {
  return Boolean(env.FAL_KEY);
}

function setup(env) {
  if (!configured(env)) throw Object.assign(new Error('fal gateway is not configured'), { status: 503 });
  fal.config({ credentials: env.FAL_KEY });
}

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < value.length; i += 2) out[i / 2] = Number.parseInt(value.slice(i, i + 2), 16);
  return out;
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function falJwks() {
  const now = Date.now();
  if (jwksCache.keys && jwksCache.expiresAt > now) return jwksCache.keys;
  const res = await fetch(FAL_JWKS_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw Object.assign(new Error('Unable to load fal webhook verification keys'), { status: 503 });
  const body = await res.json();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  if (!keys.length) throw Object.assign(new Error('fal webhook verification keys are unavailable'), { status: 503 });
  jwksCache = { keys, expiresAt: now + FAL_JWKS_CACHE_MS };
  return keys;
}

export async function submitFal(env, modelId, input, options = {}) {
  setup(env);
  const submitOptions = { input };
  if (options.webhookUrl) submitOptions.webhookUrl = options.webhookUrl;
  const result = await fal.queue.submit(modelId, submitOptions);
  return { request_id: result.request_id || result.requestId };
}

export async function statusFal(env, modelId, requestId) {
  setup(env);
  return fal.queue.status(modelId, { requestId, logs: true });
}

export async function resultFal(env, modelId, requestId) {
  setup(env);
  const result = await fal.queue.result(modelId, { requestId });
  return { data: result.data, request_id: result.requestId || requestId };
}

export async function verifyFalWebhook(request) {
  const requestId = request.headers.get('x-fal-webhook-request-id');
  const userId = request.headers.get('x-fal-webhook-user-id');
  const timestamp = request.headers.get('x-fal-webhook-timestamp');
  const signatureHex = request.headers.get('x-fal-webhook-signature');
  if (!requestId || !userId || !timestamp || !signatureHex) {
    throw Object.assign(new Error('Missing fal webhook signature headers'), { status: 401 });
  }

  const timestampSeconds = Number.parseInt(timestamp, 10);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > FAL_WEBHOOK_MAX_AGE_SECONDS) {
    throw Object.assign(new Error('Stale or invalid fal webhook timestamp'), { status: 401 });
  }

  const rawBody = new Uint8Array(await request.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', rawBody));
  const message = new TextEncoder().encode(`${requestId}\n${userId}\n${timestamp}\n${bytesToHex(digest)}`);
  const signature = hexToBytes(signatureHex);
  if (!signature) throw Object.assign(new Error('Invalid fal webhook signature encoding'), { status: 401 });

  const keys = await falJwks();
  let verified = false;
  for (const jwk of keys) {
    if (typeof jwk?.x !== 'string') continue;
    try {
      const key = await crypto.subtle.importKey('raw', base64UrlToBytes(jwk.x), { name: 'Ed25519' }, false, ['verify']);
      if (await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, message)) {
        verified = true;
        break;
      }
    } catch {
      // Try the next current fal signing key.
    }
  }
  if (!verified) throw Object.assign(new Error('Invalid fal webhook signature'), { status: 401 });

  try {
    return JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw Object.assign(new Error('Invalid fal webhook JSON'), { status: 400 });
  }
}

export function normalizeFalStatus(raw) {
  const value = String(raw?.status || '').toUpperCase();
  if (value === 'COMPLETED') return 'completed';
  if (value === 'IN_PROGRESS') return 'running';
  if (value === 'IN_QUEUE') return 'queued';
  if (value === 'ERROR' || value === 'FAILED') return 'failed';
  return 'queued';
}

export function collectAssetCandidates(value, path = '', out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectAssetCandidates(item, `${path}[${i}]`, out));
    return out;
  }
  if (typeof value !== 'object') return out;

  if (typeof value.url === 'string' && /^https?:\/\//i.test(value.url)) {
    const mime = value.content_type || value.mime_type || value.mimeType || null;
    const lower = `${path} ${mime || ''} ${value.url}`.toLowerCase();
    let assetType = 'file';
    if (/image|\.png|\.jpe?g|\.webp|\.gif/.test(lower)) assetType = 'image';
    else if (/video|\.mp4|\.webm|\.mov/.test(lower)) assetType = 'video';
    else if (/audio|\.wav|\.mp3|\.m4a|\.ogg/.test(lower)) assetType = 'audio';
    out.push({
      asset_type: assetType,
      role: path || 'result',
      url: value.url,
      mime_type: mime,
      width: Number.isFinite(value.width) ? value.width : null,
      height: Number.isFinite(value.height) ? value.height : null,
      duration_seconds: Number.isFinite(value.duration) ? value.duration : null,
      metadata: value
    });
  }

  for (const [key, child] of Object.entries(value)) {
    if (key !== 'url') collectAssetCandidates(child, path ? `${path}.${key}` : key, out);
  }
  return out;
}
