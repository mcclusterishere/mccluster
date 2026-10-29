/* McCluster speech edge: owner-only full-duplex provider gateway.
 * Dessa is a research preview, not an executable model or API.
 * Moshi is an opt-in self-hosted reference using its /api/chat WS protocol.
 * No raw audio, transcripts, or sessions are persisted by the edge.
 */
import { allowedOrigins, fail, reply } from '../lib/http.js';
import { bearerUser } from '../world-layers.js';
import { isHouseOwner } from '../world-access.js';

export const VOICE_ROOT = '/v1/voice';
export const VOICE_CAPABILITY = 'speech.converse.full_duplex';
export const VOICE_TICKET_TTL_SECONDS = 30;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const pattern = /^mcv1\.([A-Za-z0-9_-]{24,1200})\.([A-Za-z0-9_-]{43})$/;

function b64(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function unb64(text) {
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
function json(req, env, body, status = 200) {
  const res = reply(req, env, body, status);
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('vary', 'Origin, Authorization');
  return res;
}
function error(req, env, message, status = 400, detail) {
  const res = fail(req, env, message, status, detail);
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('vary', 'Origin, Authorization');
  return res;
}
function enabled(env) {
  return String(env?.VOICE_CONVERSATION_ENABLED || '').toLowerCase() === 'true';
}
function hasSigningKey(env) {
  return typeof env?.VOICE_SESSION_SIGNING_KEY === 'string' && env.VOICE_SESSION_SIGNING_KEY.length >= 32;
}
function moshiUrl(env) {
  const raw = env?.VOICE_MOSHI_WS_URL;
  if (typeof raw !== 'string' || raw.length > 350) return null;
  try {
    const u = new URL(raw);
    // Private McCluster TLS subdomains ONLY; no caller-supplied URLs or redirects.
    if (u.protocol !== 'wss:' || u.username || u.password || u.port || u.search || u.hash ||
        u.pathname !== '/api/chat' ||
        !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.mccluster\.org$/i.test(u.hostname)) return null;
    return u;
  } catch { return null; }
}
export function moshiReady(env) {
  return enabled(env) && hasSigningKey(env) && moshiUrl(env) !== null &&
    typeof env?.VOICE_MOSHI_GATEWAY_TOKEN === 'string' &&
    env.VOICE_MOSHI_GATEWAY_TOKEN.length >= 32;
}
function originOf(req, env) {
  const value = req.headers.get('origin');
  return value && allowedOrigins(env).includes(value) ? value : null;
}
async function hmacKey(env, usage) {
  return crypto.subtle.importKey('raw', encoder.encode(env.VOICE_SESSION_SIGNING_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}
export async function signVoiceTicket(env, claims) {
  if (!hasSigningKey(env)) throw Error('Voice key unavailable');
  const body = 'mcv1.' + b64(encoder.encode(JSON.stringify(claims)));
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(env, 'sign'), encoder.encode(body));
  return body + '.' + b64(new Uint8Array(mac));
}
export async function verifyVoiceTicket(env, raw, { origin, nowMs = Date.now() } = {}) {
  if (!hasSigningKey(env) || typeof raw !== 'string') return null;
  const match = pattern.exec(raw);
  if (!match) return null;
  try {
    const body = 'mcv1.' + match[1];
    if (!await crypto.subtle.verify('HMAC', await hmacKey(env, 'verify'),
      unb64(match[2]), encoder.encode(body))) return null;
    const c = JSON.parse(decoder.decode(unb64(match[1])));
    const now = Math.floor(nowMs / 1000);
    if (c?.version !== 1 || c?.aud !== 'mccluster.voice.stream' ||
        c?.provider !== 'moshi' || typeof c?.sid !== 'string' ||
        !/^[0-9a-f-]{36}$/.test(c.sid) || c?.origin !== origin ||
        !Number.isInteger(c.iat) || !Number.isInteger(c.exp) ||
        c.iat > now + 2 || c.exp <= now ||
        c.exp - c.iat !== VOICE_TICKET_TTL_SECONDS) return null;
    return c;
  } catch { return null; }
}
function protocolTicket(req) {
  const raw = req.headers.get('sec-websocket-protocol') || '';
  if (raw.length > 1600) return null;
  const matches = raw.split(',').map(p => p.trim()).filter(p => p.startsWith('mcv1.'));
  return matches.length === 1 ? matches[0] : null;
}
async function payloadOf(req) {
  if (Number(req.headers.get('content-length') || 0) > 1024) return null;
  const body = await req.text();
  if (body.length > 1024) return null;
  try {
    const json = body ? JSON.parse(body) : {};
    return json && typeof json === 'object' && !Array.isArray(json) ? json : null;
  } catch { return null; }
}
function states(env) {
  return [
    { id: 'dessa', kind: 'native_speech_to_speech', full_duplex: true,
      status: 'awaiting_official_release', executable: false },
    { id: 'moshi', kind: 'native_speech_to_speech', full_duplex: true,
      status: moshiReady(env) ? 'configured' : 'disabled', executable: moshiReady(env) }
  ];
}

// Dependency injection is for offline network and clock regression tests only.
export async function handleVoiceRequest(req, env, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
  if (path !== VOICE_ROOT && !path.startsWith(VOICE_ROOT + '/')) return null;

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
    'cache-control': 'private, no-store',
    'access-control-allow-origin': originOf(req, env) || 'null',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    vary: 'Origin'
  } });

  const origin = originOf(req, env);
  if (!origin) return error(req, env, 'Origin not permitted', 403);

  if (path === VOICE_ROOT + '/stream' && req.method === 'GET') {
    if (!moshiReady(env)) return error(req, env, 'Voice transport is disabled', 503);
    if ((req.headers.get('upgrade') || '').toLowerCase() !== 'websocket')
      return error(req, env, 'WebSocket upgrade required', 426);
    const ticket = protocolTicket(req);
    if (!ticket || !await verifyVoiceTicket(env, ticket, { origin, nowMs: now() }))
      return error(req, env, 'Valid voice session ticket required', 401);
    const gateway = new URL(moshiUrl(env).href.replace(/^wss:/, 'https:'));
    let upstream;
    try {
      // Deliberately do not forward user's Bearer, cookies, Origin, or ticket.
      // Private reverse proxy MUST validate and strip the gateway token.
      upstream = await fetchImpl(gateway.href, { redirect: 'manual',
        headers: { Upgrade: 'websocket', Authorization: 'Bearer ' + env.VOICE_MOSHI_GATEWAY_TOKEN } });
    } catch { return error(req, env, 'Voice inference gateway unavailable', 502); }
    if (upstream?.status !== 101 || !upstream.webSocket)
      return error(req, env, 'Voice inference gateway refused upgrade', 502);
    return upstream;
  }

  const user = await bearerUser(req, env, fetchImpl);
  if (!user) return error(req, env, 'Authentication required', 401);
  if (!await isHouseOwner(env, user.id, fetchImpl))
    return error(req, env, 'McCluster house owner access required', 403);

  if (path === VOICE_ROOT + '/status' && req.method === 'GET')
    return json(req, env, { ok: true, capability: VOICE_CAPABILITY, access: 'house_owner_only',
      storage: 'no_voice_media_or_transcripts_at_edge', providers: states(env) });

  if (path === VOICE_ROOT + '/sessions' && req.method === 'POST') {
    const body = await payloadOf(req);
    if (!body || (body.provider !== undefined && typeof body.provider !== 'string'))
      return error(req, env, 'Invalid voice session request', 400);
    if (body.provider === 'dessa')
      return error(req, env, 'Dessa has no published production API or licensed model release',
        503, { provider: 'dessa', status: 'awaiting_official_release' });
    if (body.provider && body.provider !== 'moshi')
      return error(req, env, 'Unsupported voice provider', 400);
    if (!moshiReady(env)) return error(req, env, 'Moshi inference is not configured', 503);
    const issuedAt = Math.floor(now() / 1000);
    const ticket = await signVoiceTicket(env, {
      version: 1, aud: 'mccluster.voice.stream', provider: 'moshi',
      sid: crypto.randomUUID(), origin, iat: issuedAt, exp: issuedAt + VOICE_TICKET_TTL_SECONDS
    });
    const endpoint = new URL(req.url);
    endpoint.protocol = endpoint.protocol === 'http:' ? 'ws:' : 'wss:';
    endpoint.pathname = VOICE_ROOT + '/stream';
    endpoint.search = '';
    endpoint.hash = '';
    return json(req, env, { ok: true, capability: VOICE_CAPABILITY, provider: 'moshi',
      transport: 'websocket', endpoint: endpoint.href, protocols: [ticket],
      expires_in_seconds: VOICE_TICKET_TTL_SECONDS,
      audio_frame_protocol: 'kyutai-moshi-api-chat',
      consent: 'explicit_microphone_permission', recording: false }, 201);
  }
  return error(req, env, 'Voice route not found', 404);
}
