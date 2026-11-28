/* TABLE READ — Worker routes (OFF BY DEFAULT: TABLE_READ_ENABLED="false").

   GET  /v1/table-read/status                    { enabled }
   POST /v1/table-read/rooms                     signed-in member -> a private room, the host pass,
                                                 one actor invite per role asked for
   POST /v1/table-read/rooms/:id/invites         host pass (Authorization: TableRead <pass>) -> one more invite
   GET  /v1/table-read/rooms/:id/socket          WebSocket, pass in Sec-WebSocket-Protocol ["tr1", <pass>]

   Media never touches the Worker: the room relays WebRTC signalling and the
   shared cue. Recordings stay on each device until its owner exports them
   or sends them to the host peer to peer. Invite links carry the pass in the
   URL fragment, which browsers never send to a server.
   Release gates: docs/creator/TABLE-READ.md. */
import { fail, reply } from '../lib/http.js';
import { bearerUser } from '../world-layers.js';
import { signPass, readPass, randomId } from './room.js';

const ROOT = '/v1/table-read';
const ROOM_ID = /^tr[0-9a-f]{18}$/;
const PASS_SECONDS = 12 * 60 * 60;

export function tableReadReady(env) {
  return String(env?.TABLE_READ_ENABLED || '').toLowerCase() === 'true' &&
    typeof env?.TABLE_READ_PASS_KEY === 'string' && env.TABLE_READ_PASS_KEY.length >= 32 &&
    !!env?.TABLE_READ_ROOM;
}

const roleList = (v) => (Array.isArray(v) ? v : []).map((r) => String(r || '').trim().slice(0, 40)).filter(Boolean).slice(0, 5);

async function invite(env, roomId, role, now) {
  const seat = randomId('a', 6);
  const exp = Math.floor(now / 1000) + PASS_SECONDS;
  return { role, seat_id: seat, pass: await signPass(env.TABLE_READ_PASS_KEY, { r: roomId, s: seat, k: 'actor', o: role, e: exp }), expires_at: exp };
}

export async function handleTableRead(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(ROOT)) return null;
  if (url.pathname === `${ROOT}/status`) return reply(request, env, { enabled: tableReadReady(env) });
  if (!tableReadReady(env)) return fail(request, env, 'table_read_disabled', 503);

  if (url.pathname === `${ROOT}/rooms` && request.method === 'POST') {
    const user = await bearerUser(request, env, fetchImpl);
    if (!user) return fail(request, env, 'sign_in_required', 401);
    let body = {};
    try { body = await request.json(); } catch { /* empty body is fine */ }
    const roomId = randomId('tr', 9);
    const exp = Math.floor(now / 1000) + PASS_SECONDS;
    const host = await signPass(env.TABLE_READ_PASS_KEY, { r: roomId, s: 'host', k: 'host', o: null, n: 'Host', e: exp });
    const invites = [];
    for (const role of roleList(body.roles)) invites.push(await invite(env, roomId, role, now));
    return reply(request, env, { room_id: roomId, host_pass: host, invites, expires_at: exp });
  }

  const m = url.pathname.match(/^\/v1\/table-read\/rooms\/([^/]+)\/(invites|socket)$/);
  if (!m || !ROOM_ID.test(m[1])) return fail(request, env, 'not_found', 404);
  const roomId = m[1];

  if (m[2] === 'invites' && request.method === 'POST') {
    const auth = request.headers.get('authorization') || '';
    const claims = await readPass(env.TABLE_READ_PASS_KEY, auth.replace(/^TableRead\s+/i, ''), now);
    if (!claims || claims.r !== roomId || claims.k !== 'host') return fail(request, env, 'host_only', 403);
    let body = {};
    try { body = await request.json(); } catch { /* none */ }
    const role = roleList([body.role])[0];
    if (!role) return fail(request, env, 'role_required', 400);
    return reply(request, env, await invite(env, roomId, role, now));
  }

  if (m[2] === 'socket') {
    if ((request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return fail(request, env, 'websocket_required', 426);
    const protocols = (request.headers.get('sec-websocket-protocol') || '').split(',').map((s) => s.trim());
    if (protocols[0] !== 'tr1' || !protocols[1]) return fail(request, env, 'pass_required', 401);
    const claims = await readPass(env.TABLE_READ_PASS_KEY, protocols[1], now);
    if (!claims || claims.r !== roomId) return fail(request, env, 'bad_pass', 403);
    const stub = env.TABLE_READ_ROOM.get(env.TABLE_READ_ROOM.idFromName(roomId));
    const headers = new Headers(request.headers);
    headers.set('x-table-read-claims', JSON.stringify(claims));
    return stub.fetch(new Request(`https://table-read/${roomId}`, { headers }));
  }
  return fail(request, env, 'method_not_allowed', 405);
}
