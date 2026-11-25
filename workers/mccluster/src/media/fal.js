const FAL_JWKS_URL = 'https://rest.fal.ai/.well-known/jwks.json';
const FAL_BILLING_EVENTS_URL = 'https://api.fal.ai/v1/models/billing-events';
const FAL_QUEUE_URL = 'https://queue.fal.run';
/* A catalog model id is a path under the queue host: owner/app[/more]. Anything
   else never becomes part of a URL. */
const FAL_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/;
const FAL_WEBHOOK_MAX_AGE_SECONDS = 300;
const FAL_JWKS_CACHE_MS = 6 * 60 * 60 * 1000;
let jwksCache = { keys: null, expiresAt: 0 };

function configured(env) {
  return Boolean(env.FAL_KEY);
}

// Only status/result reach the vendor SDK (read-only; its retries are harmless
// there). Submission, webhook verification, billing lookups and asset parsing
// are plain fetch + WebCrypto, so a static import would make the whole media
// module graph unlinkable — and those paths untestable — on any checkout where
// the optional package is not installed.
let falClient = null;

async function loadFal() {
  if (!falClient) {
    try {
      ({ fal: falClient } = await import('@fal-ai/client'));
    } catch {
      throw Object.assign(new Error('fal gateway client is not installed'), { status: 503, preflight: true });
    }
  }
  return falClient;
}

/* The preflight every provider call shares: nothing is sent without a key. */
function requireKey(env) {
  if (!configured(env)) throw Object.assign(new Error('fal gateway is not configured'), { status: 503, preflight: true });
}

async function setup(env) {
  requireKey(env);
  const fal = await loadFal();
  fal.config({ credentials: env.FAL_KEY });
  return fal;
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

/* Audit C5: a thrown submit error is NOT proof the provider did not accept
   the request. Only an error raised before anything was sent (our own
   preflight) or a provider answer that refused the request (4xx) is definite;
   a timeout, abort, network failure or 5xx after the bytes left is uncertain
   and the caller must keep the budget reservation for reconciliation rather
   than release it and risk paying twice on a retry. */
export function classifySubmitError(error) {
  if (!error || typeof error !== 'object') return 'uncertain';
  if (error.preflight === true || error.definite === true) return 'definite';
  if (error.uncertain === true || error.timeoutType) return 'uncertain';
  const status = Number(error.status ?? error.statusCode);
  /* A 4xx is the provider refusing the request: the queue endpoint returns
     2xx + request_id when it accepts, so nothing was queued. A 5xx is not
     proof of that: 502, 504 and the edge's 520 to 526 come from an
     intermediary, and a 500 or 503 can follow an accepted request just as a
     timeout can. A reservation is released only on a definite answer, so
     every 5xx stays uncertain and goes to reconciliation. No status at all =
     nothing came back. */
  if (Number.isInteger(status) && status >= 400 && status < 500) return 'definite';
  return 'uncertain';
}

/* ONE provider request per call, never retried here.

   The vendor SDK's queue.submit retries a paid POST up to three more times on
   429/502/503/504 and on transport errors, and its per-call retry option
   overrides any client configuration (@fal-ai/client 1.10.1, queue.js and
   request.js). A 502 or a dropped connection can hide an accepted request, so
   a hidden retry is a second paid job under one reservation. This is a plain
   POST to the queue endpoint the SDK itself calls: the caller sees exactly
   what the single attempt produced and decides (classifySubmitError above).

   Inputs are JSON from validated request bodies. The SDK also uploaded Blob
   and File inputs to provider storage; a model that needs binary input must
   add an explicit upload step, not bring the retrying client back. */
export async function submitFal(env, modelId, input, options = {}) {
  requireKey(env);
  if (typeof modelId !== 'string' || !FAL_MODEL_ID.test(modelId)) {
    throw Object.assign(new Error('fal model id is not a valid queue endpoint'), { status: 400, preflight: true });
  }
  const url = new URL(`${FAL_QUEUE_URL}/${modelId}`);
  if (options.webhookUrl) url.searchParams.set('fal_webhook', options.webhookUrl);

  let res;
  try {
    res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        authorization: `Key ${env.FAL_KEY}`,
        accept: 'application/json',
        'content-type': 'application/json',
        'x-fal-queue-priority': 'normal'
      },
      body: JSON.stringify(input ?? {})
    });
  } catch (error) {
    /* Nothing came back: the bytes may have left. */
    throw Object.assign(new Error(error instanceof Error ? error.message : String(error), { cause: error }), {
      name: error?.name || 'Error', uncertain: true
    });
  }

  let text = '';
  let unreadable = false;
  try { text = await res.text(); } catch { unreadable = true; }
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }

  if (!res.ok) {
    const message = (typeof body?.message === 'string' && body.message)
      || (typeof body?.detail === 'string' && body.detail)
      || `fal queue request failed (HTTP ${res.status})`;
    throw Object.assign(new Error(message), {
      status: res.status,
      detail: body,
      timeoutType: res.headers.get('x-fal-request-timeout-type') || undefined
    });
  }
  const requestId = body && typeof body === 'object' ? (body.request_id || body.requestId) : null;
  if (unreadable || !requestId || typeof requestId !== 'string') {
    /* The provider answered 2xx, so it may have queued the request, but the
       handle is missing: never treat that as "not submitted". */
    throw Object.assign(new Error('fal accepted the submission but returned no request id'), { uncertain: true, provider_status_code: res.status });
  }
  return { request_id: requestId };
}

export async function statusFal(env, modelId, requestId) {
  const fal = await setup(env);
  return fal.queue.status(modelId, { requestId, logs: true });
}

export async function resultFal(env, modelId, requestId) {
  const fal = await setup(env);
  const result = await fal.queue.result(modelId, { requestId });
  return { data: result.data, request_id: result.requestId || requestId };
}

export async function billingEventsFal(env, requestIds) {
  const ids = [...new Set((requestIds || []).map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 50);
  if (!ids.length) return { available: true, events: [] };
  if (!env.FAL_ADMIN_KEY) {
    return { available: false, retryable: false, reason: 'fal_admin_key_not_configured', events: [] };
  }

  const url = new URL(FAL_BILLING_EVENTS_URL);
  ids.forEach((id) => url.searchParams.append('request_id', id));
  url.searchParams.set('limit', String(Math.max(ids.length, 1)));

  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Key ${env.FAL_ADMIN_KEY}`
    }
  });

  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }

  if (res.status === 401 || res.status === 403) {
    return {
      available: false,
      retryable: false,
      reason: 'fal_admin_key_rejected',
      status: res.status,
      detail: body,
      events: []
    };
  }

  if (res.status === 429) {
    return {
      available: false,
      retryable: true,
      reason: 'fal_billing_rate_limited',
      status: res.status,
      detail: body,
      events: []
    };
  }

  if (!res.ok) {
    throw Object.assign(new Error('Unable to query fal billing events'), {
      status: 503,
      detail: { provider_status: res.status, provider_body: body }
    });
  }

  return {
    available: true,
    retryable: false,
    events: Array.isArray(body?.billing_events) ? body.billing_events : [],
    next_cursor: body?.next_cursor || null,
    has_more: Boolean(body?.has_more)
  };
}

/* fal signs every webhook it sends, for every customer, with the same keys:
   the signature proves "fal sent this for that account's request", not "this
   is one of ours". FAL_WEBHOOK_USER_ID, when configured, pins the signed
   account id to the house's own, so another fal customer's signed webhook is
   refused outright. */
export async function verifyFalWebhook(request, env = null) {
  const requestId = request.headers.get('x-fal-webhook-request-id');
  const userId = request.headers.get('x-fal-webhook-user-id');
  const timestamp = request.headers.get('x-fal-webhook-timestamp');
  const signatureHex = request.headers.get('x-fal-webhook-signature');
  if (!requestId || !userId || !timestamp || !signatureHex) {
    throw Object.assign(new Error('Missing fal webhook signature headers'), { status: 401 });
  }
  const pinnedUserId = String(env?.FAL_WEBHOOK_USER_ID || '').trim();
  if (pinnedUserId && pinnedUserId !== userId) {
    throw Object.assign(new Error('fal webhook is not from the configured fal account'), { status: 401 });
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
