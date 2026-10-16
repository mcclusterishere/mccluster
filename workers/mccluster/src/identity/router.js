/* IDENTITY VERIFICATION LEVELS: the Worker's part.
   docs/control-plane/IDENTITY-VERIFICATION-LEVELS.md

   The live videos never pass through here: the member's browser uploads
   them straight into the private Supabase Storage bucket at the one path the
   database issued (identity_start_submission), and the owner's browser plays
   them back through short-lived signed URLs. This module only does what needs
   a server secret:

     POST /v1/identity/persona/inquiry   member: open the government-ID check
                                         (Persona) for MY V2 submission
     POST /v1/identity/persona/webhook   Persona: inquiry status updates,
                                         HMAC-verified, idempotent by event id
     GET  /v1/identity/entitlement?key=  member: am I entitled to `key`
                                         (e.g. halo_full)? The contract Halo
                                         reads (never a client claim).

   PERSONA_ENABLED must be the string "true" or both Persona routes answer
   503 PERSONA_DISABLED (it ships "false"). Secrets by NAME only:
   PERSONA_API_KEY, PERSONA_TEMPLATE_ID, PERSONA_WEBHOOK_SECRET.
   PERSONA_STORE_VERIFIED_NAME="true" (owner's choice, default off) keeps the
   ID's name and birth YEAR so the owner can compare them with the stated
   name; otherwise only the inquiry id and status are stored. ID images and
   selfies stay with Persona; nothing here ever requests or stores them. */
import { reply, fail } from '../lib/http.js';

const PERSONA_API = 'https://api.withpersona.com/api/v1';
const PERSONA_VERSION = '2025-10-27';
export const WEBHOOK_TOLERANCE_SECONDS = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INQUIRY = /^inq_[A-Za-z0-9]{6,64}$/;
const EVENT = /^evt_[A-Za-z0-9]{6,64}$/;
const STATUSES = new Set(['created', 'pending', 'completed', 'expired', 'failed', 'needs_review', 'approved', 'declined']);
const encoder = new TextEncoder();

function noStore(response) { response.headers.set('cache-control', 'no-store'); return response; }

function hex(buffer) { return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join(''); }

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Persona-Signature: "t=<unix>,v1=<hex>"; during a secret rotation two such
   sets, separated by a space. Returns [{t, v1}]. */
export function parsePersonaSignature(header) {
  if (typeof header !== 'string' || !header.trim()) return [];
  return header.trim().split(/\s+/).map((set) => {
    const parts = Object.fromEntries(set.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return i > 0 ? [kv.slice(0, i).trim(), kv.slice(i + 1).trim()] : [kv, ''];
    }));
    return { t: parts.t, v1: parts.v1 };
  }).filter((s) => /^\d{9,11}$/.test(s.t || '') && /^[0-9a-f]{64}$/i.test(s.v1 || ''));
}

/* HMAC-SHA256 over "<t>.<raw body>" with the webhook secret, hex. Accepts if
   any signature set matches and its timestamp is within the tolerance
   (a captured delivery cannot be replayed later). */
export async function verifyPersonaSignature(rawBody, header, secret, { nowSeconds = Math.floor(Date.now() / 1000), tolerance = WEBHOOK_TOLERANCE_SECONDS } = {}) {
  if (!secret) return { ok: false, reason: 'not_configured' };
  const sets = parsePersonaSignature(header);
  if (!sets.length) return { ok: false, reason: 'missing_signature' };
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  let stale = false;
  for (const { t, v1 } of sets) {
    const expected = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${t}.${rawBody}`)));
    if (!timingSafeEqualHex(expected, v1.toLowerCase())) continue;
    if (Math.abs(nowSeconds - Number(t)) > tolerance) { stale = true; continue; }
    return { ok: true, timestamp: Number(t) };
  }
  return { ok: false, reason: stale ? 'stale_timestamp' : 'bad_signature' };
}

/* The few fields we keep from an event. Everything else in Persona's payload
   (images, document numbers, addresses, full birthdate) is dropped here. */
export function extractPersonaEvent(event, { storeVerifiedName = false } = {}) {
  const data = event?.data;
  if (!data || data.type !== 'event' || !EVENT.test(String(data.id || ''))) return null;
  const attrs = data.attributes || {};
  const inquiry = attrs.payload?.data;
  const out = {
    event_id: data.id,
    event_name: String(attrs.name || '').slice(0, 80),
    event_created_at: typeof attrs['created-at'] === 'string' && !Number.isNaN(Date.parse(attrs['created-at'])) ? attrs['created-at'] : null,
    inquiry_id: null,
    status: null,
    verified_name: null,
    birth_year: null
  };
  if (inquiry?.type === 'inquiry' && INQUIRY.test(String(inquiry.id || ''))) {
    out.inquiry_id = inquiry.id;
    const ia = inquiry.attributes || {};
    out.status = STATUSES.has(ia.status) ? ia.status : null;
    if (storeVerifiedName) {
      const name = [ia['name-first'], ia['name-middle'], ia['name-last']].filter((v) => typeof v === 'string' && v.trim()).join(' ').trim();
      out.verified_name = name ? name.slice(0, 200) : null;
      const year = typeof ia.birthdate === 'string' ? Number(ia.birthdate.slice(0, 4)) : NaN;
      out.birth_year = Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null;
    }
  }
  return out;
}

function service(env) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' };
}

async function rpc(env, name, body) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: service(env), body: JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw Object.assign(new Error(data?.message || 'Identity verification storage unavailable'), { status: res.status >= 500 ? 503 : 409 });
  return data;
}

async function requireMember(request, env) {
  const bearer = request.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(bearer)) throw Object.assign(new Error('Authentication required'), { status: 401 });
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: bearer } });
  if (!res.ok) throw Object.assign(new Error('Invalid session'), { status: 401 });
  const user = await res.json();
  if (!UUID.test(user?.id || '')) throw Object.assign(new Error('Invalid session'), { status: 401 });
  return user;
}

const personaOn = (env) => env.PERSONA_ENABLED === 'true';

async function createInquiry(request, env) {
  if (!personaOn(env)) return fail(request, env, 'The government-ID check is not switched on yet', 503, { code: 'PERSONA_DISABLED' });
  if (!env.PERSONA_API_KEY || !env.PERSONA_TEMPLATE_ID) return fail(request, env, 'The government-ID check is not configured', 503, { code: 'PERSONA_NOT_CONFIGURED' });
  const user = await requireMember(request, env);
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const submissionId = String(body?.submission_id || '');
  if (!UUID.test(submissionId)) return fail(request, env, 'submission_id is required', 400);
  const sub = await rpc(env, 'identity_submission_for_persona', { p_user: user.id, p_submission_id: submissionId });
  if (!sub) return fail(request, env, 'Submission not found', 404);
  if (sub.level !== 'v2_halo_full') return fail(request, env, 'Only a full-access request uses the ID check', 409);
  if (sub.status !== 'submitted') return fail(request, env, 'Send your live video first', 409, { code: 'VIDEO_FIRST' });
  if (sub.persona_inquiry_id) return noStore(reply(request, env, { inquiry_id: sub.persona_inquiry_id, status: sub.persona_status, existing: true }));

  const res = await fetch(`${PERSONA_API}/inquiries`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.PERSONA_API_KEY}`,
      'content-type': 'application/json',
      'persona-version': PERSONA_VERSION,
      'key-inflection': 'kebab',
      // one inquiry per submission even if the member double-taps
      'idempotency-key': `mccluster-identity-${submissionId}`
    },
    body: JSON.stringify({
      data: { attributes: { 'inquiry-template-id': env.PERSONA_TEMPLATE_ID } },
      meta: { 'auto-create-account-reference-id': user.id, 'auto-create-one-time-link': true }
    })
  });
  const json = await res.json().catch(() => null);
  const inquiryId = json?.data?.id;
  if (!res.ok || !INQUIRY.test(String(inquiryId || ''))) return fail(request, env, 'The ID check could not be started', 502, { code: 'PERSONA_UPSTREAM' });
  const status = STATUSES.has(json?.data?.attributes?.status) ? json.data.attributes.status : 'created';
  await rpc(env, 'identity_record_persona_inquiry', { p_user: user.id, p_submission_id: submissionId, p_inquiry_id: inquiryId, p_status: status });
  const link = json?.meta?.['one-time-link'];
  return noStore(reply(request, env, {
    inquiry_id: inquiryId,
    status,
    one_time_link: typeof link === 'string' && /^https:\/\//.test(link) ? link : null
  }));
}

async function webhook(request, env) {
  if (!personaOn(env)) return fail(request, env, 'Persona is not switched on', 503, { code: 'PERSONA_DISABLED' });
  if (!env.PERSONA_WEBHOOK_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return fail(request, env, 'Persona webhook is not configured', 503);
  const raw = await request.text();
  if (raw.length > 512 * 1024) return fail(request, env, 'Payload too large', 413);
  const check = await verifyPersonaSignature(raw, request.headers.get('persona-signature'), env.PERSONA_WEBHOOK_SECRET);
  if (!check.ok) return fail(request, env, 'Invalid Persona signature', 401, { code: check.reason });
  let event;
  try { event = JSON.parse(raw); } catch { return fail(request, env, 'Malformed event', 400); }
  const e = extractPersonaEvent(event, { storeVerifiedName: env.PERSONA_STORE_VERIFIED_NAME === 'true' });
  if (!e) return fail(request, env, 'Malformed event', 400);
  const result = await rpc(env, 'identity_apply_persona_event', {
    p_event_id: e.event_id, p_event_name: e.event_name, p_inquiry_id: e.inquiry_id, p_status: e.status,
    p_event_created_at: e.event_created_at, p_verified_name: e.verified_name, p_birth_year: e.birth_year
  });
  return reply(request, env, { received: true, duplicate: Boolean(result?.duplicate), applied: Boolean(result?.applied) });
}

async function entitlement(request, env) {
  const user = await requireMember(request, env);
  const key = new URL(request.url).searchParams.get('key') || '';
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) return fail(request, env, 'key is required', 400);
  const result = await rpc(env, 'identity_entitlement_for', { p_user: user.id, p_key: key });
  return noStore(reply(request, env, { key, entitled: result?.entitled === true }));
}

export async function handleIdentity(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (!path.startsWith('/v1/identity/')) return null;
  const routes = {
    '/v1/identity/persona/inquiry': ['POST', createInquiry],
    '/v1/identity/persona/webhook': ['POST', webhook],
    '/v1/identity/entitlement': ['GET', entitlement]
  };
  const route = routes[path];
  if (!route) return fail(request, env, 'Not found', 404);
  if (request.method !== route[0]) return fail(request, env, 'Method not allowed', 405);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return fail(request, env, 'Identity verification unavailable', 503);
  try {
    return await route[1](request, env);
  } catch (error) {
    return fail(request, env, error.message || 'Identity request failed', error.status || 500);
  }
}
