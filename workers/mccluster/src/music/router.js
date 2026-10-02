/* THE LISTEN LEDGER, AND A RECORD YOU EARN.

   A gated album closer can require one completed listen from an explicit
   set of eligible songs on that album. The closer cannot be opened cold;
   after each earned play, another eligible completed listen is required. The preview stays public; the master never leaves the
   private bucket except as a URL this file signs for one granted play.

   Nothing here trusts the browser about time. A listen counts only when
   the player's beats (one every ~15 seconds while the song is actually
   playing) add up to 95% of the song's measured length
   (src/music/tracks.js). Each beat credits the real time since the last
   one, capped at 20 seconds, so pausing, skipping to the end or playing
   at double speed does not count. One listen is open per listener at a
   time (a lock and a unique index in the database), so songs cannot be
   "heard" in parallel.

   An earned play is not a storage URL. It is a token for
   /v1/music/stream/:token, which this Worker serves from the private
   bucket for a few minutes and a handful of requests, then refuses.

     POST /v1/music/listens                 { track }  → { listen_id }
     POST /v1/music/listens/:id/beat                    → { heard_seconds }
     POST /v1/music/listens/:id/finish                  → { counted, gates }
     GET  /v1/music/gates/:track                        → { gate }
     POST /v1/music/gates/:track/play                   → { url } or 403 locked
     GET  /v1/music/stream/:token                       → the audio, while the token holds

   House operators (ops.use) play gated records without spending anything,
   so the owner can always hear their own catalogue. */

import { corsHeaders, fail, reply } from '../lib/http.js';
import { requireCapability } from '../lib/capabilities.js';
import { resolveWorkspaces } from '../workspaces.js';
import { TRACKS } from './tracks.js';

export const GATES = {
  'niggy-nigg': {
    /* CIA Mind Control closer: hear either other album song first. */
    any_of: ['you-the-feds', 'pull-up'],
    bucket: 'mcc-gated-audio',
    object: 'niggy-nigg/niggy-nigg.mp3',
    /* the owner's own playback: a signed storage URL, no gate */
    url_seconds: 600,
    /* a listener's one play: long enough to press play and finish a short
       record, with room for the range requests an audio element makes;
       short enough that a copied link is not a second copy (the request
       allowance is GATES_MAX_HITS) */
    stream_seconds: 300
  }
};

export const COUNT_SHARE = 0.95;
const GATES_MAX_HITS = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;

function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

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
  if (gate.any_of) return { p_user: userId, p_track: key, p_eligible: gate.any_of };
  if (gate.sequence) return { p_user: userId, p_track: key, p_sequence: gate.sequence, p_window_minutes: gate.window_minutes };
  return { p_user: userId, p_track: key, p_first: gate.first, p_each: gate.each };
}

/* Where a listener stands, with the next song named so the page can say
   "play You the Feds next" without knowing the rule. */
async function readGate(env, userId, key, claim) {
  const gate = GATES[key];
  const name = gate.any_of
    ? (claim ? 'music_gate_claim_any' : 'music_gate_any_state')
    : gate.sequence
      ? (claim ? 'music_gate_claim_sequence' : 'music_gate_sequence_state')
      : (claim ? 'music_gate_claim' : 'music_gate_state');
  const state = await rpc(env, name, { ...gateArgs(userId, key), ...(claim || {}) });
  if (state && gate.any_of) {
    state.titles = gate.any_of.map((k) => TRACKS[k]?.title || k);
  } else if (state && gate.sequence) {
    state.titles = gate.sequence.map((k) => TRACKS[k]?.title || k);
    if (state.next) state.next_title = TRACKS[state.next]?.title || state.next;
  }
  return state;
}

async function allGates(env, userId) {
  const out = {};
  for (const key of Object.keys(GATES)) out[key] = await readGate(env, userId, key);
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

async function beatListen(request, env, user, listenId) {
  const userId = need(user);
  if (!UUID.test(listenId)) return fail(request, env, 'Unknown listen', 404);
  const heard = await rpc(env, 'music_listen_beat', { p_user: userId, p_listen: listenId });
  return reply(request, env, { ok: true, heard_seconds: heard == null ? null : Number(heard) });
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
  return reply(request, env, { ok: true, gate: await readGate(env, userId, key) });
}

async function gatePlay(request, env, user, key) {
  const userId = need(user);
  const gate = GATES[key];
  if (!gate) return fail(request, env, 'Unknown gated track', 404);

  if (await isHouseOperator(env, user)) {
    const url = await signObject(env, gate.bucket, gate.object, gate.url_seconds);
    return reply(request, env, { ok: true, url, expires_in: gate.url_seconds, gate: { allowed: true, operator: true } });
  }

  const token = newToken();
  const state = await readGate(env, userId, key, { p_token: token, p_stream_seconds: gate.stream_seconds });
  if (!state?.claimed) {
    return reply(request, env, { error: 'Locked', locked: true, gate: state }, 403);
  }
  const url = `${new URL(request.url).origin}/v1/music/stream/${token}`;
  return reply(request, env, { ok: true, url, expires_in: gate.stream_seconds, gate: state });
}

/* The one play itself. The token is the credential (an <audio> element
   cannot send an Authorization header); the database counts every request
   against it and stops answering once it is used up or stale. */
async function streamPlay(request, env, token) {
  if (!TOKEN.test(token)) return fail(request, env, 'Unknown play', 404);
  const key = await rpc(env, 'music_stream_open', { p_token: token, p_max_hits: GATES_MAX_HITS });
  const gate = key && GATES[key];
  if (!gate) return fail(request, env, 'This play has ended', 410);
  const path = `${gate.bucket}/${String(gate.object).split('/').map(encodeURIComponent).join('/')}`;
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
  };
  const range = request.headers.get('range');
  if (range) headers.range = range;
  const upstream = await fetch(`${env.SUPABASE_URL}/storage/v1/object/authenticated/${path}`, { headers });
  if (!upstream.ok && upstream.status !== 206) {
    return fail(request, env, upstream.status === 404 ? 'The full track is not uploaded' : 'Could not open the full track',
      upstream.status === 404 ? 404 : 502);
  }
  const out = new Headers(corsHeaders(request, env));
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  out.set('cache-control', 'no-store, private');
  out.set('content-disposition', 'inline');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export async function handleMusicRequest(request, env, user) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return fail(request, env, 'McCluster is not configured', 503);

  if (path === '/v1/music/listens' && request.method === 'POST') return startListen(request, env, user);

  const finish = path.match(/^\/v1\/music\/listens\/([^/]+)\/finish$/);
  if (finish && request.method === 'POST') return finishListen(request, env, user, finish[1]);

  const beat = path.match(/^\/v1\/music\/listens\/([^/]+)\/beat$/);
  if (beat && request.method === 'POST') return beatListen(request, env, user, beat[1]);

  const stream = path.match(/^\/v1\/music\/stream\/([^/]+)$/);
  if (stream && request.method === 'GET') return streamPlay(request, env, stream[1]);

  const gate = path.match(/^\/v1\/music\/gates\/([a-z0-9-]+)(\/play)?$/);
  if (gate && !gate[2] && request.method === 'GET') return gateState(request, env, user, gate[1]);
  if (gate && gate[2] && request.method === 'POST') return gatePlay(request, env, user, gate[1]);

  return null;
}
