/* TABLE READ — the room's rules, one source for the Worker's Durable Object
   (src/table-read/durable.js) and the Prime-local relay (tools/table-read/relay.mjs).

   No media passes through here. The room relays WebRTC signalling between
   seats, keeps every seat on the same cue, and records who consented to
   what. Camera and microphone stay peer to peer (mesh, first version up to
   MAX_SEATS), and each device records itself locally.

   Who may do what:
   - host: load the scene, assign roles, advance / rewind / goto / pause /
     resume, set the optional scroll rate, drop cue markers, fire the sync cue,
     ask for recording consent, start and stop a take, remove a seat.
   - actor: hold a beat (blocks the optional auto-scroll only, never the
     cue itself), react, answer consent, report take status, send signalling.
   A seat's kind and role come from its signed pass, never from a message. */

export const MAX_SEATS = 6;
export const MAX_LINES = 2000;
export const MAX_LINE_CHARS = 2000;
export const MAX_SIGNAL_BYTES = 64_000;
export const RATE_MIN_WPM = 60;
export const RATE_MAX_WPM = 260;

const ID = /^[a-z0-9_-]{1,40}$/i;
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

/* "SPEAKER: line", "(direction)", "[CUE label]". Blank lines and "#" comments
   are skipped. A line with no "NAME:" continues the previous speaker. */
export function parseScript(text) {
  const lines = [];
  const roles = [];
  let last = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue;
    if (lines.length >= MAX_LINES) break;
    let m;
    if ((m = t.match(/^\[(?:cue)\s*:?\s*(.*)\]$/i))) {
      lines.push({ id: `l${lines.length}`, kind: 'cue', speaker: null, text: clip(m[1] || 'cue', 200) });
    } else if ((m = t.match(/^\((.*)\)$/))) {
      lines.push({ id: `l${lines.length}`, kind: 'direction', speaker: null, text: clip(m[1], MAX_LINE_CHARS) });
    } else if ((m = t.match(/^([A-Z][A-Z0-9 .'_-]{0,39}):\s*(.*)$/))) {
      last = clip(m[1], 40);
      if (!roles.includes(last)) roles.push(last);
      lines.push({ id: `l${lines.length}`, kind: 'line', speaker: last, text: clip(m[2], MAX_LINE_CHARS) });
    } else {
      lines.push({ id: `l${lines.length}`, kind: last ? 'line' : 'direction', speaker: last, text: clip(t, MAX_LINE_CHARS) });
    }
  }
  return { lines, roles };
}

export function createRoom({ roomId, sceneTitle = '', now = Date.now() } = {}) {
  return {
    id: roomId,
    created_at: now,
    scene: { title: clip(sceneTitle, 120), lines: [], roles: [] },
    cue: { index: 0, paused: true, rate_wpm: null, seq: 0, changed_at: now, markers: [] },
    seats: {},        // seat_id -> { seat_id, kind, role, name, joined_at, consent, transfer, take, holding, connected }
    take: null,       // { take_id, state: 'armed'|'rolling'|'stopped', started_at, stopped_at, sync: [] }
    log: [],
  };
}

function event(room, type, data, now) {
  room.log.push({ t: now, type, ...data });
  if (room.log.length > 200) room.log.splice(0, room.log.length - 200);
}

export function publicState(room) {
  const seats = Object.values(room.seats).map((s) => ({
    seat_id: s.seat_id, kind: s.kind, role: s.role, name: s.name, connected: s.connected,
    consent: s.consent, transfer: s.transfer, take: s.take, holding: s.holding,
  }));
  return {
    id: room.id,
    scene: room.scene,
    cue: room.cue,
    seats,
    holds: seats.filter((s) => s.holding).map((s) => s.seat_id),
    take: room.take,
  };
}

export function join(room, { seatId, kind, role, name, now = Date.now() }) {
  if (!ID.test(seatId || '')) return { error: 'bad_seat' };
  const existing = room.seats[seatId];
  if (!existing && Object.keys(room.seats).length >= MAX_SEATS) return { error: 'room_full' };
  if (kind !== 'host' && kind !== 'actor') return { error: 'bad_kind' };
  room.seats[seatId] = {
    seat_id: seatId,
    kind,
    role: clip(role, 40) || null,
    name: clip(name, 60) || (kind === 'host' ? 'Host' : clip(role, 40) || 'Actor'),
    joined_at: existing?.joined_at || now,
    connected: true,
    consent: existing?.consent || 'none',      // none | asked | granted | declined | revoked
    transfer: existing?.transfer || 'none',    // none | granted | sending | sent | declined
    take: existing?.take || null,              // { take_id, state, bytes, chunks }
    holding: false,
  };
  event(room, existing ? 'rejoin' : 'join', { seat: seatId }, now);
  return { ok: true, rejoined: !!existing };
}

export function leave(room, seatId, now = Date.now()) {
  const s = room.seats[seatId];
  if (!s) return;
  s.connected = false;
  s.holding = false;
  event(room, 'leave', { seat: seatId }, now);
}

function bump(room, now) { room.cue.seq += 1; room.cue.changed_at = now; }
const clampIndex = (room, i) => Math.max(0, Math.min(Math.max(0, room.scene.lines.length - 1), i | 0));

const HOST_ONLY = new Set(['load_script', 'assign_role', 'advance', 'back', 'goto', 'pause', 'resume',
  'set_rate', 'mark', 'sync_cue', 'ask_consent', 'take_start', 'take_stop', 'remove', 'auto_tick']);

/* One message from one seat. Returns { state?: true, to?: [{seat, msg}], reply?: msg, error? }. */
export function handle(room, seatId, msg, now = Date.now()) {
  const seat = room.seats[seatId];
  if (!seat) return { error: 'not_joined' };
  if (!msg || typeof msg.type !== 'string') return { error: 'bad_message' };
  const type = msg.type;
  if (HOST_ONLY.has(type) && seat.kind !== 'host') return { error: 'host_only' };

  switch (type) {
    case 'ping':
      // NTP-style: the client keeps t0 and its own receive time; server time is t1 = t2.
      return { reply: { type: 'pong', t0: Number(msg.t0) || 0, server_t: now } };

    case 'load_script': {
      const parsed = parseScript(msg.text);
      if (!parsed.lines.length) return { error: 'empty_script' };
      room.scene = { title: clip(msg.title, 120) || room.scene.title, lines: parsed.lines, roles: parsed.roles };
      room.cue.index = 0; room.cue.paused = true; room.cue.markers = [];
      bump(room, now);
      event(room, 'load_script', { lines: parsed.lines.length }, now);
      return { state: true };
    }
    case 'assign_role': {
      const t = room.seats[msg.seat_id];
      if (!t) return { error: 'no_such_seat' };
      t.role = clip(msg.role, 40) || null;
      return { state: true };
    }
    case 'advance': room.cue.index = clampIndex(room, room.cue.index + (Number(msg.by) || 1)); bump(room, now); return { state: true };
    case 'back': room.cue.index = clampIndex(room, room.cue.index - (Number(msg.by) || 1)); bump(room, now); return { state: true };
    case 'goto': room.cue.index = clampIndex(room, Number(msg.index)); bump(room, now); return { state: true };
    case 'pause': room.cue.paused = true; bump(room, now); event(room, 'pause', { index: room.cue.index }, now); return { state: true };
    case 'resume': room.cue.paused = false; bump(room, now); event(room, 'resume', { index: room.cue.index }, now); return { state: true };
    case 'set_rate': {
      const r = msg.rate_wpm == null ? null : Number(msg.rate_wpm);
      room.cue.rate_wpm = r == null || !Number.isFinite(r) ? null : Math.max(RATE_MIN_WPM, Math.min(RATE_MAX_WPM, Math.round(r)));
      bump(room, now);
      return { state: true };
    }
    case 'auto_tick': {
      // The host's optional scroll: only while resumed, a rate is set and nobody is holding a beat.
      if (room.cue.paused || room.cue.rate_wpm == null) return { error: 'auto_off' };
      if (Object.values(room.seats).some((s) => s.holding && s.connected)) return { error: 'held' };
      if (Number(msg.seq) !== room.cue.seq) return { error: 'stale' };
      room.cue.index = clampIndex(room, room.cue.index + 1); bump(room, now);
      return { state: true };
    }
    case 'mark': {
      if (room.cue.markers.length >= 200) return { error: 'too_many_markers' };
      const marker = { index: room.cue.index, label: clip(msg.label, 80) || `Cue ${room.cue.markers.length + 1}`, server_t: now };
      room.cue.markers.push(marker);
      if (room.take?.state === 'rolling') room.take.markers.push(marker);
      bump(room, now);
      return { state: true };
    }
    case 'sync_cue': {
      // Every device flashes and beeps at the same server instant; each one stamps its own clock.
      const at = now + Math.max(300, Math.min(5000, Number(msg.lead_ms) || 1500));
      const sync = { id: `s${(room.take?.sync.length || 0) + 1}`, server_at: at, label: clip(msg.label, 40) || 'sync' };
      if (room.take) room.take.sync.push(sync);
      return { state: true, broadcast: { type: 'sync_cue', ...sync } };
    }
    case 'ask_consent':
      for (const s of Object.values(room.seats)) if (s.consent !== 'granted') s.consent = 'asked';
      return { state: true, broadcast: { type: 'consent_request', scope: 'record_local', scene: room.scene.title } };
    case 'take_start': {
      const missing = Object.values(room.seats).filter((s) => s.connected && s.kind === 'actor' && s.consent !== 'granted');
      if (missing.length && !msg.allow_partial) return { error: 'consent_missing', seats: missing.map((s) => s.seat_id) };
      room.take = { take_id: clip(msg.take_id, 40) || `take-${now}`, state: 'rolling', started_at: now, stopped_at: null, sync: [], markers: [], index_at_start: room.cue.index };
      bump(room, now);
      event(room, 'take_start', { take: room.take.take_id }, now);
      return { state: true, broadcast: { type: 'take_start', take_id: room.take.take_id, server_t: now } };
    }
    case 'take_stop':
      if (!room.take || room.take.state !== 'rolling') return { error: 'no_take' };
      room.take.state = 'stopped'; room.take.stopped_at = now;
      bump(room, now);
      return { state: true, broadcast: { type: 'take_stop', take_id: room.take.take_id, server_t: now } };
    case 'remove': {
      const t = room.seats[msg.seat_id];
      if (!t || t.kind === 'host') return { error: 'no_such_seat' };
      delete room.seats[msg.seat_id];
      return { state: true, close: msg.seat_id };
    }

    case 'set_name':
      seat.name = clip(msg.name, 60) || seat.name;
      return { state: true };
    case 'hold':
      seat.holding = !!msg.on;
      return { state: true };
    case 'react':
      return { broadcast: { type: 'react', seat_id: seatId, what: clip(msg.what, 16), server_t: now } };
    case 'consent': {
      const v = msg.value;
      if (!['granted', 'declined', 'revoked'].includes(v)) return { error: 'bad_consent' };
      seat.consent = v;
      event(room, 'consent', { seat: seatId, value: v }, now);
      return { state: true };
    }
    case 'transfer_consent': {
      const v = msg.value;
      if (!['granted', 'declined'].includes(v)) return { error: 'bad_consent' };
      seat.transfer = v;
      return { state: true };
    }
    case 'take_status': {
      seat.take = {
        take_id: clip(msg.take_id, 40),
        state: clip(msg.state, 20),
        bytes: Math.max(0, Number(msg.bytes) || 0),
        chunks: Math.max(0, Number(msg.chunks) || 0),
        sent: Math.max(0, Number(msg.sent) || 0),
      };
      if (msg.transfer && ['sending', 'sent'].includes(msg.transfer) && seat.transfer !== 'declined') seat.transfer = msg.transfer;
      return { state: true };
    }
    case 'signal': {
      const to = String(msg.to || '');
      if (!room.seats[to] || to === seatId) return { error: 'no_such_seat' };
      const body = JSON.stringify(msg.data ?? null);
      if (body.length > MAX_SIGNAL_BYTES) return { error: 'too_big' };
      return { to: [{ seat: to, msg: { type: 'signal', from: seatId, data: msg.data } }] };
    }
    default:
      return { error: 'unknown_type' };
  }
}

/* Signed seat passes: tr1.<claims>.<HMAC-SHA256>, claims { r room, s seat, k kind, o role, e expiry }. */
const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const key = (secret, use) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [use]);

export async function signPass(secret, claims) {
  const body = b64u(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret, 'sign'), enc.encode(`tr1.${body}`)));
  return `tr1.${body}.${b64u(sig)}`;
}

export async function readPass(secret, pass, now = Date.now()) {
  const m = /^tr1\.([A-Za-z0-9_-]{4,1200})\.([A-Za-z0-9_-]{40,60})$/.exec(String(pass || ''));
  if (!m || !secret) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', await key(secret, 'verify'), unb64u(m[2]), enc.encode(`tr1.${m[1]}`)); } catch { return null; }
  if (!ok) return null;
  let c;
  try { c = JSON.parse(new TextDecoder().decode(unb64u(m[1]))); } catch { return null; }
  if (!c || typeof c.r !== 'string' || !ID.test(c.s || '') || !['host', 'actor'].includes(c.k)) return null;
  if (!Number.isFinite(c.e) || c.e * 1000 < now) return null;
  return c;
}

export function randomId(prefix, bytes = 9) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return `${prefix}${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}
