/* LIVE MISSIONS: proving a webhook came from Cloudflare, and counting it once.

   Two different senders (docs read 2026-10-15/16):

   1. live_input.connected / live_input.disconnected / live_input.errored
      come from Cloudflare NOTIFICATIONS, through a generic webhook
      destination. Its only authentication is a shared secret the owner
      chooses, sent verbatim in the `cf-webhook-auth` header ("If this header
      is not present, or is not your specified value, you should reject the
      webhook"). No HMAC, no timestamp. Secret name: CF_LIVE_NOTIFICATION_SECRET.
      Payload: { name, text, data: { notification_name, input_id, event_type,
      updated_at, ... }, ts }.
      Replay defence, since the header proves nothing about freshness: the
      event's own time must be within MAX_EVENT_AGE_SECONDS of now (and not
      in the future beyond a small skew), and the database counts each
      (input, type, updated_at) once (action_live_webhook_events).

   2. Stream's own VIDEO webhook (one per account) signs with
      `Webhook-Signature: time=<unix>,sig1=<hex>`, HMAC-SHA256 over
      "<time>.<raw body>" keyed with the webhook's `secret`. Secret name:
      CF_STREAM_WEBHOOK_SECRET. Optional here: the cron also polls. */

export const MAX_EVENT_AGE_SECONDS = 300;
export const MAX_FUTURE_SKEW_SECONDS = 60;
const enc = new TextEncoder();

export function timingSafeEqualString(a, b) {
  const x = enc.encode(String(a == null ? '' : a)), y = enc.encode(String(b == null ? '' : b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export function verifyNotificationSecret(request, secret) {
  if (!secret) return { ok: false, status: 503, error: 'live webhook secret is not configured' };
  const got = request.headers.get('cf-webhook-auth');
  if (!got || !timingSafeEqualString(got, secret)) return { ok: false, status: 401, error: 'webhook not authenticated' };
  return { ok: true };
}

const KINDS = { 'live_input.connected': 'connected', 'live_input.disconnected': 'disconnected', 'live_input.errored': 'disconnected' };

/* -> { ok, inputId, kind, at (ISO), eventKey } | { ok:false, status, error } */
export function parseLiveInputEvent(payload, nowMs = Date.now()) {
  const d = payload && typeof payload === 'object' ? payload.data : null;
  if (!d || typeof d !== 'object') return { ok: false, status: 400, error: 'not a live input event' };
  const type = String(d.event_type || '');
  const kind = KINDS[type];
  const inputId = typeof d.input_id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(d.input_id) ? d.input_id : null;
  if (!kind || !inputId) return { ok: false, status: 400, error: 'not a live input event' };
  let at = Date.parse(d.updated_at);
  if (!Number.isFinite(at) && Number.isFinite(Number(payload.ts))) at = Number(payload.ts) * 1000;
  if (!Number.isFinite(at)) return { ok: false, status: 400, error: 'event has no time' };
  if (nowMs - at > MAX_EVENT_AGE_SECONDS * 1000) return { ok: false, status: 409, error: 'event too old (replay refused)' };
  if (at - nowMs > MAX_FUTURE_SKEW_SECONDS * 1000) return { ok: false, status: 409, error: 'event time is in the future' };
  return { ok: true, inputId, kind, type, at: new Date(at).toISOString(), eventKey: `${inputId}:${type}:${new Date(at).toISOString()}` };
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signStreamWebhook(secret, rawBody, timeSec) {
  return `time=${timeSec},sig1=${await hmacHex(secret, `${timeSec}.${rawBody}`)}`;
}

export async function verifyStreamSignature(header, rawBody, secret, nowMs = Date.now()) {
  if (!secret) return { ok: false, status: 503, error: 'stream webhook secret is not configured' };
  const parts = Object.fromEntries(String(header || '').split(',').map((kv) => { const i = kv.indexOf('='); return i < 0 ? [kv.trim(), ''] : [kv.slice(0, i).trim(), kv.slice(i + 1).trim()]; }));
  const time = Number(parts.time);
  if (!Number.isFinite(time) || !parts.sig1) return { ok: false, status: 401, error: 'missing signature' };
  if (Math.abs(nowMs / 1000 - time) > MAX_EVENT_AGE_SECONDS) return { ok: false, status: 409, error: 'signature too old (replay refused)' };
  const want = await hmacHex(secret, `${parts.time}.${rawBody}`);
  if (!timingSafeEqualString(want, parts.sig1.toLowerCase())) return { ok: false, status: 401, error: 'bad signature' };
  return { ok: true, time };
}
