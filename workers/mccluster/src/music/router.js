/* THE LISTEN LEDGER, AND A RECORD YOU EARN.

   The owner's rule for a gated record: an account, then five DIFFERENT
   other songs heard all the way through, then ONE play. Every play after
   that costs one more full song. The preview stays public; the master
   never leaves the private bucket except as a URL this file signs for one
   granted play.

   Nothing here trusts the browser about time. A listen counts only when
   this Worker saw the song start and saw it end with at least 95% of the
   song's measured length (src/music/tracks.js) of real time in between,
   so skipping to the end or playing at double speed does not count, and
   the database closes a listener's open listen whenever they start
   another, so songs cannot be "heard" in parallel.

     POST /v1/music/listens                 { track }  → { listen_id }
     POST /v1/music/listens/:id/finish                  → { counted, gates }
     GET  /v1/music/gates/:track                        → { gate }
     POST /v1/music/gates/:track/play                   → { url } or 403 locked

   House operators (ops.use) play gated records without spending anything,
   so the owner can always hear their own catalogue. */

import { fail, reply } from '../lib/http.js';
import { requireCapability } from '../lib/capabilities.js';
import { resolveWorkspaces } from '../workspaces.js';
import { TRACKS } from './tracks.js';

export const GATES = {
  'niggy-nigg': {
    first: 5,
    each: 1,
    bucket: 'mcc-gated-audio',
    object: 'niggy-nigg/niggy-nigg.mp3',
    /* long enough to press play, pause once and finish a short record;
       short enough that a copied link is not a second copy of the song */
    url_seconds: 600
  }
};

export const COUNT_SHARE = 0.95;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function need(user) {
  if (!user?.id) throw Object.assign(new Error('Sign in to count your listens'), { status: 401 });
  return user.id;
}

async function rpc(env, name, body) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    throw Object.assign(new Error(`${name} failed`), { status: 502, detail: data?.message || text.slice(0, 200) });
  }
  return data;
}

async function signObject(env, bucket, object, seconds) {
  const path = `${bucket}/${String(object).split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/${path}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ expiresIn: seconds })
  });
  const data = await res.json().catch(() => null);
  const signed = data?.signedURL || data?.signedUrl;
  if (!res.ok || !signed) {
    throw Object.assign(new Error(res.status === 404 ? 'The full track is not uploaded' : 'Could not open the full track'),
      { status: res.status === 404 ? 404 : 502 });
  }
  return `${env.SUPABASE_URL}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}`;
}

async function isHouseOperator(env, user) {
  try {
    const { workspaces } = await resolveWorkspaces(env, user);
    const house = workspaces.find((w) => w.slug === 'mccluster' && w.enabled);
    if (!house) return false;
    await requireCapability(env, { role: house.role }, 'ops.use');
    return true;
  } catch {
    return false;
  }
}

function gateArgs(userId, key) {
  const gate = GATES[key];
  return { p_user: userId, p_track: key, p_first: gate.first, p_each: gate.each };
}

async function allGates(env, userId) {
  const out = {};
  for (const key of Object.keys(GATES)) out[key] = await rpc(env, 'music_gate_state', gateArgs(userId, key));
  return out;
}

async function startListen(request, env, user) {
  const userId = need(user);
  const body = await request.json().catch(() => ({}));
  const key = String(body?.track || '');
  const track = TRACKS[key];
  if (!track) return fail(request, env, 'Unknown track', 404);
  /* The gated record never counts toward its own gate. */
  if (track.gated || !track.seconds) return reply(request, env, { ok: true, listen_id: null, counts: false });
  const minSeconds = Math.max(1, Math.floor(track.seconds * COUNT_SHARE));
  const listenId = await rpc(env, 'music_listen_start', { p_user: userId, p_track: key, p_min_seconds: minSeconds });
  return reply(request, env, { ok: true, listen_id: listenId, counts: true, min_seconds: minSeconds });
}

async function finishListen(request, env, user, listenId) {
  const userId = need(user);
  if (!UUID.test(listenId)) return fail(request, env, 'Unknown listen', 404);
  const counted = await rpc(env, 'music_listen_finish', { p_user: userId, p_listen: listenId });
  return reply(request, env, { ok: true, counted: counted === true, gates: await allGates(env, userId) });
}

async function gateState(request, env, user, key) {
  const userId = need(user);
  if (!GATES[key]) return fail(request, env, 'Unknown gated track', 404);
  if (await isHouseOperator(env, user)) return reply(request, env, { ok: true, gate: { allowed: true, operator: true } });
  return reply(request, env, { ok: true, gate: await rpc(env, 'music_gate_state', gateArgs(userId, key)) });
}

async function gatePlay(request, env, user, key) {
  const userId = need(user);
  const gate = GATES[key];
  if (!gate) return fail(request, env, 'Unknown gated track', 404);

  if (await isHouseOperator(env, user)) {
    const url = await signObject(env, gate.bucket, gate.object, gate.url_seconds);
    return reply(request, env, { ok: true, url, expires_in: gate.url_seconds, gate: { allowed: true, operator: true } });
  }

  const state = await rpc(env, 'music_gate_claim', gateArgs(userId, key));
  if (!state?.claimed) {
    return reply(request, env, { error: 'Locked', locked: true, gate: state }, 403);
  }
  try {
    const url = await signObject(env, gate.bucket, gate.object, gate.url_seconds);
    return reply(request, env, { ok: true, url, expires_in: gate.url_seconds, gate: state });
  } catch (error) {
    /* A play the listener earned is not spent on our outage. */
    await fetch(`${env.SUPABASE_URL}/rest/v1/music_gated_plays?id=eq.${encodeURIComponent(state.play_id)}`, {
      method: 'DELETE',
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
    }).catch(() => {});
    throw error;
  }
}

export async function handleMusicRequest(request, env, user) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return fail(request, env, 'McCluster is not configured', 503);

  if (path === '/v1/music/listens' && request.method === 'POST') return startListen(request, env, user);

  const finish = path.match(/^\/v1\/music\/listens\/([^/]+)\/finish$/);
  if (finish && request.method === 'POST') return finishListen(request, env, user, finish[1]);

  const gate = path.match(/^\/v1\/music\/gates\/([a-z0-9-]+)(\/play)?$/);
  if (gate && !gate[2] && request.method === 'GET') return gateState(request, env, user, gate[1]);
  if (gate && gate[2] && request.method === 'POST') return gatePlay(request, env, user, gate[1]);

  return null;
}
