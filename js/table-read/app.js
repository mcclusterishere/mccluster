/* TABLE READ — the page (table-read.html). Script first, faces small.

   Host: start a private room, load the scene, hand out one link per role,
   run the cue (next, back, pause, markers, optional scroll speed), fire the
   sync cue, ask for consent and roll a take.
   Actor: open the link on a phone, allow camera and microphone, read.

   Camera and mic go peer to peer (WebRTC mesh). Each device records its own
   full-frame camera and microphone locally (MediaRecorder, 1 s chunks into
   IndexedDB), whatever size its self-view is on screen. A take leaves the
   phone only when its owner exports it or taps Send to host. Rooms: the
   Worker (api.mccluster.org/v1/table-read, flag TABLE_READ_ENABLED) or the
   Prime-local relay (tools/table-read/relay.mjs), same protocol. */
import { offsetSample, bestOffset, driftPpm, toDevice, alignOnCue, inTake } from './sync.js';
import { createTakeStore, manifest } from './take-store.js';

const $ = (s, r = document) => r.querySelector(s);
const params = new URLSearchParams(location.search);
const API = (params.get('api') || 'https://api.mccluster.org').replace(/\/+$/, '');
const deviceNow = () => performance.timeOrigin + performance.now();
const ICE = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const CHUNK_BYTES = 16 * 1024;

const ui = {
  lobby: $('#trLobby'), join: $('#trJoin'), room: $('#trRoom'),
  status: $('#trStatus'), rec: $('#trRec'), prev: $('#trPrev'), speaker: $('#trSpeaker'), line: $('#trLine'),
  yours: $('#trYours'), next: $('#trNext'), markers: $('#trMarkers'), tiles: $('#trTiles'), self: $('#trSelf'),
  host: $('#trHost'), actor: $('#trActor'), holds: $('#trHolds'), seats: $('#trSeats'), invites: $('#trInvites'),
  consent: $('#trConsent'), takes: $('#trTakes'), flash: $('#trFlash'), notice: $('#trNotice'),
};

const S = {
  roomId: null, pass: null, seat: null, kind: null, role: null, name: '',
  ws: null, state: null, stream: null, peers: new Map(), clock: [], offset: 0,
  store: null, recorder: null, take: null, audio: null, autoTimer: null, received: new Map(),
};

function say(text, tone = '') { ui.notice.textContent = text; ui.notice.dataset.tone = tone; }
function show(which) { for (const k of ['lobby', 'join', 'room']) ui[k].hidden = k !== which; }
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtBytes = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
const send = (m) => { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(m)); };

/* ---------- lobby (host) ---------- */
function rolesIn(text) {
  const roles = [];
  for (const l of String(text).split(/\r?\n/)) {
    const m = l.trim().match(/^([A-Z][A-Z0-9 .'_-]{0,39}):/);
    if (m && !roles.includes(m[1])) roles.push(m[1]);
  }
  return roles;
}

function authHeader() {
  try { const s = window.MCC?.session?.(); return s?.access_token ? { authorization: `Bearer ${s.access_token}` } : {}; } catch { return {}; }
}

async function startRoom(e) {
  e.preventDefault();
  const title = $('#trTitle').value.trim();
  const text = $('#trScript').value;
  const roles = rolesIn(text);
  if (!roles.length) { say('Add at least one line as NAME: line.', 'bad'); return; }
  if ($('#trHostOnCam').checked && !S.stream && !(await turnOnCamera())) return;
  S.hostRecords = $('#trHostRecords').checked && !!S.stream;
  say('Starting a private room…');
  let res;
  try {
    res = await fetch(`${API}/v1/table-read/rooms`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify({ title, roles }),
    });
  } catch { say('Could not reach the room service. Table Read needs a connection for live rooms.', 'bad'); return; }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) { say('Sign in to host a Table Read.', 'bad'); return; }
  if (!res.ok) { say(body.error === 'table_read_disabled' ? 'Table Read rooms are not switched on yet.' : `Could not start the room (${body.error || res.status}).`, 'bad'); return; }
  S.roomId = body.room_id; S.pass = body.host_pass; S.kind = 'host'; S.name = 'Host';
  S.pendingScript = { text, title };
  renderInvites(body.invites);
  history.replaceState(null, '', `${location.pathname}${location.search}#room=${body.room_id}&pass=${encodeURIComponent(body.host_pass)}`);
  await enterRoom();
}

function inviteUrl(inv) {
  const base = `${location.origin}${location.pathname}${API === 'https://api.mccluster.org' ? '' : `?api=${encodeURIComponent(API)}`}`;
  return `${base}#room=${S.roomId}&pass=${encodeURIComponent(inv.pass)}`;
}

function renderInvites(invites) {
  S.invites = invites;
  try { sessionStorage.setItem(`tr-invites-${S.roomId}`, JSON.stringify(invites)); } catch { /* private mode */ }
  ui.invites.innerHTML = invites.map((inv, i) => `
    <li><span class="tr-role">${esc(inv.role)}</span>
      <input readonly value="${esc(inviteUrl(inv))}" aria-label="Link for ${esc(inv.role)}" data-invite="${i}">
      <button type="button" data-copy="${i}">Copy</button>
      ${navigator.share ? `<button type="button" data-share="${i}">Share</button>` : ''}</li>`).join('');
}

ui.invites?.addEventListener('click', async (e) => {
  const c = e.target.dataset.copy; const s = e.target.dataset.share;
  if (c != null) { try { await navigator.clipboard.writeText(inviteUrl(S.invites[c])); e.target.textContent = 'Copied'; } catch { $(`[data-invite="${c}"]`).select(); } }
  if (s != null) navigator.share({ title: 'Table Read', text: `Your role: ${S.invites[s].role}`, url: inviteUrl(S.invites[s]) }).catch(() => {});
});

/* ---------- join (actor or host on camera) ---------- */
async function turnOnCamera() {
  const audio = { echoCancellation: true, noiseSuppression: false, autoGainControl: false };
  const video = { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ audio, video });
  } catch (err) {
    say(err?.name === 'NotAllowedError' ? 'Camera and microphone were not allowed. Allow them for this site in your browser settings, then try again.' : `Camera or microphone unavailable (${err?.name || 'error'}).`, 'bad');
    return false;
  }
  try { S.audio = new (window.AudioContext || window.webkitAudioContext)(); await S.audio.resume(); } catch { S.audio = null; }
  ui.self.querySelector('video').srcObject = S.stream;
  return true;
}

async function actorJoin(e) {
  e.preventDefault();
  S.name = $('#trName').value.trim().slice(0, 60);
  if (!(await turnOnCamera())) return;
  await enterRoom();
}

/* ---------- the room ---------- */
async function enterRoom() {
  show('room');
  ui.host.hidden = S.kind !== 'host';
  ui.actor.hidden = S.kind === 'host';
  S.store = S.store || await createTakeStore();
  if (!S.store.durable) say('This browser is not keeping takes between visits (private mode?). Export each take before you close the page.', 'warn');
  if (!S.invites && S.kind === 'host') { try { renderInvites(JSON.parse(sessionStorage.getItem(`tr-invites-${S.roomId}`) || '[]')); } catch { /* none */ } }
  renderTakes();
  connect();
}

function wsUrl() {
  return `${API.replace(/^http/, 'ws')}/v1/table-read/rooms/${S.roomId}/socket`;
}

function connect(attempt = 0) {
  ui.status.textContent = attempt ? 'Reconnecting…' : 'Connecting…';
  const ws = new WebSocket(wsUrl(), ['tr1', S.pass]);
  S.ws = ws;
  ws.onopen = () => { ui.status.textContent = 'Connected'; S.clock = []; pingBurst(); };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
  ws.onclose = (e) => {
    if (S.ws !== ws) return;
    if (e.code === 4001) { say('The host removed you from this room.', 'bad'); ui.status.textContent = 'Removed'; return; }
    if (e.code === 4003 || e.code === 4009) { ui.status.textContent = e.code === 4009 ? 'Open in another tab' : 'Not allowed'; return; }
    ui.status.textContent = 'Offline: retrying';
    setTimeout(() => connect(attempt + 1), Math.min(8000, 500 * 2 ** attempt));
  };
}

function pingBurst() {
  let n = 0;
  const one = () => { send({ type: 'ping', t0: deviceNow() }); if (++n < 6) setTimeout(one, 150); };
  one();
  clearInterval(S.pingTimer);
  S.pingTimer = setInterval(() => send({ type: 'ping', t0: deviceNow() }), 2000);
}

function onMessage(m) {
  switch (m.type) {
    case 'welcome':
      S.seat = m.seat_id; S.kind = m.kind; S.role = m.role;
      if (S.kind === 'actor' && S.name) send({ type: 'set_name', name: S.name });
      if (S.kind === 'host' && S.pendingScript) { send({ type: 'load_script', ...S.pendingScript }); S.pendingScript = null; }
      // A host who chose "I'm on camera too" records their own device under the same rule.
      if (S.kind === 'host' && S.stream && S.hostRecords) { S.consent = 'granted'; send({ type: 'consent', value: 'granted' }); }
      break;
    case 'pong': {
      const s = offsetSample(m.t0, m.server_t, deviceNow());
      S.clock.push(s); if (S.clock.length > 400) S.clock.shift();
      const b = bestOffset(S.clock); if (b) S.offset = b.offset;
      break;
    }
    case 'state': onState(m.state); break;
    case 'signal': onSignal(m.from, m.data); break;
    case 'consent_request': if (S.kind === 'actor') askConsent(m); break;
    case 'take_start': startTake(m); break;
    case 'take_stop': stopTake(m); break;
    case 'sync_cue': scheduleSync(m); break;
    case 'removed': break;
    case 'error':
      if (m.error === 'consent_missing') say(`Waiting for consent from ${m.seats.map(seatName).join(', ')}.`, 'warn');
      else if (!['held', 'auto_off', 'stale'].includes(m.error)) say(`Room: ${m.error}`, 'bad');
      break;
    default: break;
  }
}

const seatName = (id) => { const s = S.state?.seats.find((x) => x.seat_id === id); return s ? `${s.name}${s.role ? ` (${s.role})` : ''}` : id; };

function onState(state) {
  const prior = S.state;
  S.state = state;
  const me = state.seats.find((s) => s.seat_id === S.seat);
  if (me) {
    S.role = me.role;
    if (me.consent !== S.consent && ['granted', 'declined', 'revoked'].includes(me.consent)) {
      S.consent = me.consent; $('#trRevoke').hidden = me.consent !== 'granted';
    }
  }
  if (!prior || prior.cue.seq !== state.cue.seq) onCue(state);
  renderSeats(state);
  syncPeers(state);
  if (S.kind === 'host') runAutoScroll(state);
}

function onCue(state) {
  const { lines } = state.scene;
  const i = state.cue.index;
  const cur = lines[i];
  ui.prev.textContent = lines[i - 1] ? `${lines[i - 1].speaker ? `${lines[i - 1].speaker}: ` : ''}${lines[i - 1].text}` : '';
  ui.speaker.textContent = cur ? (cur.kind === 'line' ? cur.speaker : cur.kind === 'cue' ? 'CUE' : 'DIRECTION') : '';
  ui.line.textContent = cur ? cur.text : 'Waiting for the host to load the scene.';
  ui.line.dataset.kind = cur?.kind || 'empty';
  const mine = cur && cur.kind === 'line' && S.role && cur.speaker === S.role;
  ui.yours.hidden = !mine;
  document.body.classList.toggle('tr-my-line', !!mine);
  ui.next.innerHTML = lines.slice(i + 1, i + 4).map((l) => `<li data-kind="${l.kind}"${S.role && l.speaker === S.role ? ' data-mine' : ''}>${l.speaker ? `<b>${esc(l.speaker)}</b> ` : ''}${esc(l.text)}</li>`).join('');
  ui.markers.innerHTML = state.cue.markers.slice(-6).map((mk) => `<button type="button" data-goto="${mk.index}"${S.kind === 'host' ? '' : ' disabled'}>${esc(mk.label)}</button>`).join('');
  $('#trPause').textContent = state.cue.paused ? 'Resume' : 'Pause';
  $('#trPos').textContent = lines.length ? `${i + 1} / ${lines.length}${state.cue.paused ? ' · paused' : ''}` : '';
  if (S.take && S.recorder) S.take.lines.push({ index: i, seq: state.cue.seq, device_t: deviceNow(), server_t: state.cue.changed_at });
}

function renderSeats(state) {
  ui.seats.innerHTML = state.seats.map((s) => `<li data-connected="${s.connected}">${esc(s.name)}${s.role ? ` · ${esc(s.role)}` : ''}
    <small>${s.connected ? '' : 'offline · '}consent: ${esc(s.consent)}${s.take ? ` · take ${esc(s.take.state)} ${fmtBytes(s.take.bytes)}` : ''}${s.transfer !== 'none' ? ` · transfer ${esc(s.transfer)}` : ''}</small></li>`).join('');
  ui.holds.textContent = state.holds.length ? `Holding a beat: ${state.holds.map(seatName).join(', ')}` : '';
  const rolling = state.take?.state === 'rolling';
  ui.rec.hidden = !rolling;
  $('#trTake').textContent = rolling ? 'Stop take' : 'Record take';
}

/* ---------- host controls ---------- */
function hostClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  const goto = b.dataset.goto; if (goto != null) { send({ type: 'goto', index: Number(goto) }); return; }
  switch (b.id) {
    case 'trBack': send({ type: 'back' }); break;
    case 'trNextBtn': send({ type: 'advance' }); break;
    case 'trPause': send({ type: S.state?.cue.paused ? 'resume' : 'pause' }); break;
    case 'trMark': send({ type: 'mark', label: '' }); break;
    case 'trSync': send({ type: 'sync_cue', lead_ms: 1500 }); break;
    case 'trAsk': send({ type: 'ask_consent' }); say('Asked everyone for recording consent.'); break;
    case 'trTake':
      if (S.state?.take?.state === 'rolling') send({ type: 'take_stop' });
      else send({ type: 'take_start', take_id: `take-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}` });
      break;
    case 'trExportSession': exportSession(); break;
    default: break;
  }
}

function runAutoScroll(state) {
  clearTimeout(S.autoTimer);
  const { cue } = state;
  if (cue.paused || cue.rate_wpm == null || state.holds.length) return;
  const line = state.scene.lines[cue.index];
  if (!line || cue.index >= state.scene.lines.length - 1) return;
  const words = line.text.split(/\s+/).filter(Boolean).length;
  const ms = Math.max(1200, (words / cue.rate_wpm) * 60000 + 700);
  S.autoTimer = setTimeout(() => send({ type: 'auto_tick', seq: cue.seq }), ms);
}

function exportSession() {
  if (!S.state) return;
  const data = { schema: 'mccluster-table-read-session/1', room_id: S.roomId, exported_at: new Date().toISOString(), scene: S.state.scene, take: S.state.take, markers: S.state.cue.markers };
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${S.roomId}-${S.state.take?.take_id || 'session'}.session.json`);
}

/* ---------- actor controls ---------- */
function actorClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'trHold') {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Release beat' : 'Hold beat';
    send({ type: 'hold', on });
  }
  if (b.id === 'trRevoke') revokeConsent();
}

function askConsent(m) {
  ui.consent.querySelector('[data-scene]').textContent = m.scene || 'this scene';
  if (typeof ui.consent.showModal === 'function') ui.consent.showModal(); else ui.consent.setAttribute('open', '');
}

function answerConsent(value) {
  S.consent = value;
  send({ type: 'consent', value });
  ui.consent.close?.(); ui.consent.removeAttribute('open');
  $('#trRevoke').hidden = value !== 'granted';
  say(value === 'granted' ? 'Thanks. Your camera and mic will be recorded on this phone only while a take is rolling.' : 'Not recording you. You can still read.');
}

function revokeConsent() {
  S.consent = 'revoked';
  send({ type: 'consent', value: 'revoked' });
  if (S.recorder && S.recorder.state !== 'inactive') S.recorder.stop();
  $('#trRevoke').hidden = true;
  say('Recording stopped. What was recorded stays on this phone; delete it below if you want.');
}

/* ---------- reaction tiles ---------- */
function tileFor(seatId) {
  let t = ui.tiles.querySelector(`[data-seat="${seatId}"]`);
  if (!t) {
    t = document.createElement('figure');
    t.className = 'tr-tile'; t.dataset.seat = seatId;
    t.innerHTML = '<video playsinline autoplay muted></video><figcaption></figcaption>';
    ui.tiles.appendChild(t);
  }
  t.querySelector('figcaption').textContent = seatName(seatId);
  return t;
}

/* A voice-only seat (host off camera) still needs to be heard. */
function audioFor(seatId, stream) {
  let a = document.querySelector(`audio[data-seat="${seatId}"]`);
  if (!a) { a = document.createElement('audio'); a.dataset.seat = seatId; a.autoplay = true; document.body.appendChild(a); }
  if (a.srcObject !== stream) a.srcObject = stream;
}

function makeMovable(el, handle) {
  let start = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    start = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!start) return;
    const p = el.offsetParent || document.body;
    const left = Math.max(0, Math.min(p.clientWidth - el.offsetWidth, start.left + e.clientX - start.x));
    const top = Math.max(0, Math.min(p.clientHeight - el.offsetHeight, start.top + e.clientY - start.y));
    el.style.left = `${left}px`; el.style.top = `${top}px`; el.style.right = 'auto'; el.style.bottom = 'auto';
  });
  const end = () => { if (start) { start = null; try { localStorage.setItem('tr-tiles-pos', JSON.stringify({ left: el.style.left, top: el.style.top })); } catch { /* none */ } } };
  handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  try { const p = JSON.parse(localStorage.getItem('tr-tiles-pos') || 'null'); if (p?.left) Object.assign(el.style, { left: p.left, top: p.top, right: 'auto', bottom: 'auto' }); } catch { /* none */ }
}

/* ---------- WebRTC mesh ---------- */
function syncPeers(state) {
  const live = new Set(state.seats.filter((s) => s.connected && s.seat_id !== S.seat).map((s) => s.seat_id));
  for (const [id, p] of S.peers) if (!live.has(id)) { p.pc.close(); S.peers.delete(id); document.querySelectorAll(`[data-seat="${id}"]`).forEach((n) => n.remove()); }
  for (const id of live) if (!S.peers.has(id) && S.seat < id) makePeer(id, true);
}

function makePeer(id, offerer) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const peer = { pc, dc: null, offerer };
  S.peers.set(id, peer);
  if (S.stream) for (const t of S.stream.getTracks()) pc.addTrack(t, S.stream);
  else { pc.addTransceiver('audio', { direction: 'recvonly' }); pc.addTransceiver('video', { direction: 'recvonly' }); }
  pc.onicecandidate = (e) => { if (e.candidate) send({ type: 'signal', to: id, data: { ice: e.candidate } }); };
  pc.ontrack = (e) => {
    if (e.track.kind === 'audio') { audioFor(id, e.streams[0]); return; }
    const v = tileFor(id).querySelector('video'); if (v.srcObject !== e.streams[0]) v.srcObject = e.streams[0];
  };
  pc.onconnectionstatechange = () => { const t = ui.tiles.querySelector(`[data-seat="${id}"]`); if (t) t.dataset.state = pc.connectionState; if (pc.connectionState === 'failed') { pc.close(); S.peers.delete(id); if (S.state) syncPeers(S.state); } };
  const wire = (dc) => { peer.dc = dc; dc.binaryType = 'arraybuffer'; dc.onmessage = (e) => onTransfer(id, e.data); };
  if (offerer) {
    wire(pc.createDataChannel('take', { ordered: true }));
    pc.onnegotiationneeded = async () => {
      try { await pc.setLocalDescription(await pc.createOffer()); send({ type: 'signal', to: id, data: { sdp: pc.localDescription } }); } catch { /* retried on next state */ }
    };
  } else pc.ondatachannel = (e) => wire(e.channel);
  return peer;
}

async function onSignal(from, data) {
  let peer = S.peers.get(from);
  if (!peer) peer = makePeer(from, false);
  const { pc } = peer;
  try {
    if (data?.sdp) {
      await pc.setRemoteDescription(data.sdp);
      if (data.sdp.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); send({ type: 'signal', to: from, data: { sdp: pc.localDescription } }); }
      for (const c of peer.pending || []) await pc.addIceCandidate(c).catch(() => {});
      peer.pending = [];
    } else if (data?.ice) {
      if (pc.remoteDescription) await pc.addIceCandidate(data.ice).catch(() => {});
      else (peer.pending = peer.pending || []).push(data.ice);
    }
  } catch { /* a stale description; the offerer renegotiates */ }
}

/* ---------- recording this device ---------- */
function pickMime() {
  const opts = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'];
  return opts.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
}

async function startTake(m) {
  if (!S.stream || S.consent !== 'granted' || S.recorder) return;
  const mime = pickMime();
  const vt = S.stream.getVideoTracks()[0];
  const settings = vt?.getSettings?.() || {};
  const take = await S.store.begin({
    room_id: S.roomId, take_id: m.take_id, seat_id: S.seat, role: S.role, name: S.name, scene: S.state?.scene.title || '',
    mime: mime || 'video/webm', video: { width: settings.width || null, height: settings.height || null, frame_rate: settings.frameRate || null },
    consent: { scope: 'record_local', granted_device_t: deviceNow() }, sync: [], markers: [], lines: [],
  });
  S.take = take;
  let rec;
  try { rec = new MediaRecorder(S.stream, mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 } : undefined); } catch (err) { say(`This browser cannot record (${err.name}).`, 'bad'); S.take = null; return; }
  S.recorder = rec;
  let seq = 0; let writes = Promise.resolve();
  rec.onstart = () => {
    take.started_device_t = deviceNow();
    take.lines.push({ index: S.state?.cue.index ?? 0, seq: S.state?.cue.seq ?? 0, device_t: take.started_device_t, server_t: m.server_t });
    S.store.update(take, {});
  };
  rec.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    const n = seq++; const t = deviceNow();
    writes = writes.then(() => S.store.chunk(take, n, e.data, t)).then(() => reportTake('rolling')).catch(() => say('Could not save part of the take on this phone. Storage may be full.', 'bad'));
  };
  rec.onstop = async () => {
    await writes;
    const b = bestOffset(S.clock);
    await S.store.update(take, {
      state: 'complete', stopped_device_t: deviceNow(),
      clock: b ? { offset_ms: b.offset, best_rtt_ms: b.rtt, samples: S.clock.length, drift_ppm: driftPpm(S.clock) } : null,
      markers: S.state?.take?.markers || [],
    });
    S.recorder = null; S.take = null;
    reportTake('complete', take);
    renderTakes();
  };
  rec.start(1000);
  reportTake('rolling');
}

function stopTake() { if (S.recorder && S.recorder.state !== 'inactive') S.recorder.stop(); }

function reportTake(state, take = S.take) {
  if (!take) return;
  ui.rec.querySelector('[data-bytes]').textContent = fmtBytes(take.bytes);
  send({ type: 'take_status', take_id: take.take_id, state, bytes: take.bytes, chunks: take.chunks });
}

function scheduleSync(m) {
  const at = toDevice(m.server_at, S.offset);
  const wait = Math.max(0, at - deviceNow());
  setTimeout(() => {
    const fired = deviceNow();
    ui.flash.hidden = false; requestAnimationFrame(() => setTimeout(() => { ui.flash.hidden = true; }, 160));
    if (S.audio) {
      const o = S.audio.createOscillator(); const g = S.audio.createGain();
      o.frequency.value = 1000; g.gain.value = 0.6; o.connect(g).connect(S.audio.destination);
      o.start(); o.stop(S.audio.currentTime + 0.12);
    }
    if (S.take) {
      S.take.sync.push({ id: m.id, label: m.label, server_at: m.server_at, offset_ms: S.offset, device_planned_t: at, device_fired_t: fired,
        in_take_ms: S.take.started_device_t ? inTake(m.server_at, S.offset, S.take.started_device_t) : null });
      S.store.update(S.take, {});
    }
  }, wait);
}

/* ---------- this device's takes: recover, export, send ---------- */
async function renderTakes() {
  if (!S.store) return;
  const takes = (await S.store.list()).filter((t) => !S.roomId || t.room_id === S.roomId || t.state !== 'received');
  const live = S.take?.key;
  ui.takes.innerHTML = takes.length ? takes.map((t) => `<li data-key="${esc(t.key)}">
      <span>${esc(t.take_id)} · ${esc(t.role || t.name || t.seat_id)} · ${fmtBytes(t.bytes)} · ${t.key === live ? 'recording' : t.state === 'recording' ? 'interrupted, recovered' : esc(t.state)}</span>
      <progress max="100" value="0" hidden></progress>
      ${t.key === live ? '' : `<button type="button" data-act="export">Export</button>
      ${S.kind === 'actor' && t.state !== 'received' ? '<button type="button" data-act="send">Send to host</button>' : ''}
      <button type="button" data-act="delete" class="tr-quiet">Delete</button>`}</li>`).join('') : '<li>No takes on this device.</li>';
  if (takes.length) ui.takes.closest('details').open = true;
}

ui.takes?.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const key = b.closest('li').dataset.key;
  const take = (await S.store.list()).find((t) => t.key === key); if (!take) return;
  if (b.dataset.act === 'export') await exportTake(take);
  if (b.dataset.act === 'delete') { if (confirm('Delete this take from this device? This cannot be undone.')) { await S.store.remove(take); renderTakes(); } }
  if (b.dataset.act === 'send') await sendTake(take, b.closest('li').querySelector('progress'));
});

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

const extFor = (mime) => (String(mime).includes('mp4') ? 'mp4' : 'webm');
async function exportTake(take) {
  const { blob, gaps } = await S.store.blob(take);
  const base = `${take.room_id}_${take.take_id}_${(take.role || take.seat_id).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  download(blob, `${base}.${extFor(take.mime)}`);
  download(new Blob([JSON.stringify(manifest(take, { sha256: await sha256(blob), gaps, interrupted: take.state === 'recording' }), null, 2)], { type: 'application/json' }), `${base}.take.json`);
}

async function sha256(blob) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function sendTake(take, bar) {
  const host = S.state?.seats.find((s) => s.kind === 'host' && s.connected);
  const peer = host && S.peers.get(host.seat_id);
  if (!peer?.dc || peer.dc.readyState !== 'open') { say('The host is not connected right now. Export the take instead, or try again when they are.', 'warn'); return; }
  if (!confirm('Send this take to the host? It goes straight to their device over this call.')) return;
  send({ type: 'transfer_consent', value: 'granted' });
  const { blob, gaps } = await S.store.blob(take);
  const meta = manifest(take, { sha256: await sha256(blob), gaps, interrupted: take.state === 'recording' });
  const dc = peer.dc;
  dc.send(JSON.stringify({ type: 'take-begin', manifest: meta, size: blob.size }));
  bar.hidden = false;
  const buf = new Uint8Array(await blob.arrayBuffer());
  dc.bufferedAmountLowThreshold = 256 * 1024;
  for (let off = 0; off < buf.length; off += CHUNK_BYTES) {
    if (dc.bufferedAmount > 1024 * 1024) await new Promise((r) => { dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; r(); }; });
    dc.send(buf.subarray(off, off + CHUNK_BYTES));
    const pct = Math.round(((off + CHUNK_BYTES) / buf.length) * 100);
    bar.value = Math.min(100, pct);
    if (pct % 10 === 0) send({ type: 'take_status', take_id: take.take_id, state: take.state, bytes: take.bytes, chunks: take.chunks, sent: Math.min(100, pct), transfer: 'sending' });
  }
  dc.send(JSON.stringify({ type: 'take-end', take_id: take.take_id }));
  bar.value = 100;
  send({ type: 'take_status', take_id: take.take_id, state: take.state, bytes: take.bytes, chunks: take.chunks, sent: 100, transfer: 'sent' });
  say('Take sent to the host.');
}

async function onTransfer(from, data) {
  if (S.kind !== 'host') return;
  if (typeof data === 'string') {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.type === 'take-begin') S.received.set(from, { manifest: m.manifest, size: m.size, parts: [], got: 0 });
    if (m.type === 'take-end') {
      const r = S.received.get(from); if (!r) return;
      S.received.delete(from);
      const blob = new Blob(r.parts, { type: r.manifest.mime });
      const ok = (await sha256(blob)) === r.manifest.sha256;
      const take = await S.store.begin({ ...r.manifest, take_id: r.manifest.take_id, seat_id: r.manifest.seat_id, room_id: r.manifest.room_id });
      await S.store.chunk(take, 0, blob, deviceNow());
      await S.store.update(take, { ...r.manifest, key: take.key, state: 'received', chunks: 1, bytes: blob.size, verified: ok });
      say(ok ? `Received ${seatName(from)}'s take (${fmtBytes(blob.size)}), checksum verified.` : `Received ${seatName(from)}'s take but the checksum did not match. Ask them to export it instead.`, ok ? '' : 'bad');
      $('#trRecv').textContent = '';
      renderTakes();
    }
    return;
  }
  const r = S.received.get(from); if (!r) return;
  r.parts.push(data); r.got += data.byteLength;
  $('#trRecv').textContent = `Receiving from ${seatName(from)}: ${Math.min(100, Math.round((r.got / r.size) * 100))}%`;
}

/* ---------- manual import (host): check files before they go to Prime ---------- */
async function importFiles(e) {
  const files = [...e.target.files];
  const takes = [];
  for (const f of files.filter((x) => x.name.endsWith('.take.json'))) {
    try { takes.push(JSON.parse(await f.text())); } catch { /* skip */ }
  }
  if (!takes.length) { $('#trImportOut').textContent = 'Choose the .take.json files that came with each take.'; return; }
  const byCue = {};
  for (const t of takes) for (const s of t.sync || []) (byCue[s.id] = byCue[s.id] || []).push({ seat: t.role || t.seat_id, sync_in_take_ms: s.in_take_ms });
  const first = Object.keys(byCue)[0];
  const a = first ? alignOnCue(byCue[first]) : { aligned: [], spread_ms: null };
  const media = files.filter((x) => /\.(webm|mp4)$/i.test(x.name)).map((x) => x.name);
  $('#trImportOut').textContent = `${takes.length} take(s), ${media.length} media file(s). ` +
    (first ? `Sync cue ${first}: heads differ by ${Math.round(a.spread_ms)} ms; trims ${a.aligned.map((x) => `${x.seat} ${Math.round(x.trim_head_ms)} ms`).join(', ')}.` : 'No sync cue in these takes: align on the clap instead.') +
    ' Copy the files into the production\'s takes folder on Prime and run the import there.';
}

/* ---------- boot ---------- */
function boot() {
  const frag = new URLSearchParams(location.hash.slice(1));
  $('#trStart')?.addEventListener('submit', startRoom);
  $('#trJoinForm')?.addEventListener('submit', actorJoin);
  ui.host.addEventListener('click', hostClick);
  ui.markers.addEventListener('click', hostClick);
  ui.actor.addEventListener('click', actorClick);
  $('#trRate').addEventListener('change', (e) => send({ type: 'set_rate', rate_wpm: e.target.value ? Number(e.target.value) : null }));
  $('#trConsentYes').addEventListener('click', () => answerConsent('granted'));
  $('#trConsentNo').addEventListener('click', () => answerConsent('declined'));
  $('#trHideSelf').addEventListener('click', (e) => {
    const hide = !ui.self.hidden; ui.self.hidden = hide;
    e.target.textContent = hide ? 'Show me' : 'Hide me'; e.target.setAttribute('aria-pressed', String(hide));
  });
  $('#trFaces').addEventListener('click', () => {
    const order = ['top-right', 'bottom-right', 'bottom-left', 'top-left'];
    const box = ui.tiles.parentElement;
    const next = order[(order.indexOf(box.dataset.faces || 'top-right') + 1) % order.length];
    box.dataset.faces = next; ui.tiles.removeAttribute('style');
    try { localStorage.removeItem('tr-tiles-pos'); } catch { /* none */ }
  });
  $('#trImport').addEventListener('change', importFiles);
  $('#trLoadFile').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) $('#trScript').value = await f.text(); });
  makeMovable(ui.tiles, ui.tiles);
  addEventListener('pagehide', () => { if (S.recorder && S.recorder.state !== 'inactive') S.recorder.requestData(); });

  if (frag.get('room') && frag.get('pass')) {
    S.roomId = frag.get('room'); S.pass = frag.get('pass');
    const kind = (() => { try { return JSON.parse(atob(S.pass.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; } })();
    if (kind.k === 'host') { S.kind = 'host'; S.name = 'Host'; enterRoom(); return; }
    S.kind = 'actor';
    $('#trJoinRole').textContent = kind.o || 'your role';
    show('join');
    createTakeStore().then((st) => { S.store = st; return st.list(); }).then((t) => {
      const mine = t.filter((x) => x.room_id === S.roomId && x.state === 'recording');
      if (mine.length) say(`${mine.length} interrupted take(s) from this room are saved on this phone. They will be listed once you join.`, 'warn');
    });
    return;
  }
  if (!$('#trScript').value) $('#trScript').value = STAND_IN;
  show('lobby');
}

/* Placeholder text for rehearsing the room only. The production script is
   Episodes\Get It Back - The Call From Dave - Executive Suite Cutscene.md on Prime;
   load it with "Or load a script file". Only "I'm a whole new man, man." is owner-confirmed. */
const STAND_IN = `# STAND-IN TEXT for testing the room. Replace with the episode script.
[CUE phone rings]
(Matthew in the suite, smiling, the song still playing.)
DAVE: Yo. It's Dave.
MATTHEW: Dave? Man, I was just thinking about you.
(beat)
DAVE: I'm a whole new man, man.
MATTHEW: For real. How you doing in there?
DAVE: Day by day. I'm good.
[CUE end of call]`;

window.__tableRead = S; // for the end-to-end test and local debugging only
boot();
