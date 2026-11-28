import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScript, createRoom, join, handle, publicState, signPass, readPass, MAX_SEATS } from '../src/table-read/room.js';
import { createHub } from '../src/table-read/hub.js';
import { handleTableRead, tableReadReady } from '../src/table-read/routes.js';

const SCRIPT = `# stand-in scene
[CUE open]
DAVE: Yo. It's me.
MATTHEW: Dave?
(beat)
DAVE: I'm a whole new man, man.
MATTHEW: For real? How you doing?`;

function room() {
  const r = createRoom({ roomId: 'trtest', now: 1000 });
  join(r, { seatId: 'host', kind: 'host', now: 1000 });
  join(r, { seatId: 'a1', kind: 'actor', role: 'DAVE', now: 1000 });
  join(r, { seatId: 'a2', kind: 'actor', role: 'MATTHEW', now: 1000 });
  handle(r, 'host', { type: 'load_script', text: SCRIPT, title: 'Rehab call' }, 1000);
  return r;
}

test('parses speakers, directions and cue markers', () => {
  const p = parseScript(SCRIPT);
  assert.deepEqual(p.roles, ['DAVE', 'MATTHEW']);
  assert.equal(p.lines.length, 6);
  assert.equal(p.lines[0].kind, 'cue');
  assert.equal(p.lines[3].kind, 'direction');
  assert.equal(p.lines[4].text, "I'm a whole new man, man.");
});

test('only the host moves the cue; actors are refused', () => {
  const r = room();
  assert.equal(handle(r, 'a1', { type: 'advance' }).error, 'host_only');
  assert.equal(handle(r, 'a1', { type: 'take_start' }).error, 'host_only');
  handle(r, 'host', { type: 'advance' }, 2000);
  handle(r, 'host', { type: 'advance', by: 2 }, 2000);
  assert.equal(r.cue.index, 3);
  handle(r, 'host', { type: 'back' }, 2000);
  assert.equal(r.cue.index, 2);
  handle(r, 'host', { type: 'goto', index: 999 }, 2000);
  assert.equal(r.cue.index, 5, 'goto clamps to the last line');
});

test('a held beat blocks the optional scroll but never the host', () => {
  const r = room();
  handle(r, 'host', { type: 'set_rate', rate_wpm: 140 });
  handle(r, 'host', { type: 'resume' });
  handle(r, 'a1', { type: 'hold', on: true });
  assert.equal(handle(r, 'host', { type: 'auto_tick', seq: r.cue.seq }).error, 'held');
  assert.equal(r.cue.index, 0);
  handle(r, 'host', { type: 'advance' });
  assert.equal(r.cue.index, 1, 'manual advance still works while held');
  handle(r, 'a1', { type: 'hold', on: false });
  assert.ok(handle(r, 'host', { type: 'auto_tick', seq: r.cue.seq }).state);
  assert.equal(r.cue.index, 2);
  assert.equal(handle(r, 'host', { type: 'auto_tick', seq: r.cue.seq - 1 }).error, 'stale');
  handle(r, 'host', { type: 'pause' });
  assert.equal(handle(r, 'host', { type: 'auto_tick', seq: r.cue.seq }).error, 'auto_off');
});

test('a take needs every connected actor to consent', () => {
  const r = room();
  handle(r, 'host', { type: 'ask_consent' });
  assert.equal(r.seats.a1.consent, 'asked');
  const refused = handle(r, 'host', { type: 'take_start' });
  assert.equal(refused.error, 'consent_missing');
  assert.deepEqual(refused.seats.sort(), ['a1', 'a2']);
  handle(r, 'a1', { type: 'consent', value: 'granted' });
  handle(r, 'a2', { type: 'consent', value: 'declined' });
  assert.equal(handle(r, 'host', { type: 'take_start' }).error, 'consent_missing');
  handle(r, 'a2', { type: 'consent', value: 'granted' });
  const ok = handle(r, 'host', { type: 'take_start', take_id: 'take-1' }, 5000);
  assert.equal(ok.broadcast.type, 'take_start');
  handle(r, 'host', { type: 'mark', label: 'reaction' }, 6000);
  const sync = handle(r, 'host', { type: 'sync_cue', lead_ms: 1000 }, 7000);
  assert.equal(sync.broadcast.server_at, 8000);
  assert.equal(r.take.sync.length, 1);
  assert.equal(r.take.markers[0].label, 'reaction');
  assert.equal(handle(r, 'host', { type: 'take_stop' }, 9000).broadcast.type, 'take_stop');
  assert.equal(handle(r, 'a1', { type: 'consent', value: 'maybe' }).error, 'bad_consent');
});

test('signalling only reaches a seat in the room and is size-capped', () => {
  const r = room();
  const out = handle(r, 'a1', { type: 'signal', to: 'a2', data: { sdp: 'v=0' } });
  assert.deepEqual(out.to[0], { seat: 'a2', msg: { type: 'signal', from: 'a1', data: { sdp: 'v=0' } } });
  assert.equal(handle(r, 'a1', { type: 'signal', to: 'nobody', data: {} }).error, 'no_such_seat');
  assert.equal(handle(r, 'a1', { type: 'signal', to: 'a2', data: 'x'.repeat(70_000) }).error, 'too_big');
});

test('the room caps seats and public state carries no pass', () => {
  const r = createRoom({ roomId: 'trcap' });
  for (let i = 0; i < MAX_SEATS; i++) assert.ok(join(r, { seatId: `s${i}`, kind: 'actor' }).ok);
  assert.equal(join(r, { seatId: 'late', kind: 'actor' }).error, 'room_full');
  assert.ok(join(r, { seatId: 's0', kind: 'actor' }).rejoined, 'a known seat may rejoin when full');
  assert.ok(!JSON.stringify(publicState(r)).includes('pass'));
});

test('seat passes: signed, bound, expiring, tamper-evident', async () => {
  const key = 'k'.repeat(40);
  const pass = await signPass(key, { r: 'trabc', s: 'a1', k: 'actor', o: 'DAVE', e: 2000 });
  assert.equal((await readPass(key, pass, 1_000_000)).o, 'DAVE');
  assert.equal(await readPass(key, pass, 2_000_001), null, 'expired');
  assert.equal(await readPass('x'.repeat(40), pass, 1000), null, 'wrong key');
  const [a, b, c] = pass.split('.');
  const forged = btoa(JSON.stringify({ r: 'trabc', s: 'a1', k: 'host', e: 2000 })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  assert.equal(await readPass(key, `${a}.${forged}.${c}`, 1000), null, 'cannot promote itself to host');
  assert.ok(b);
});

test('the hub relays to the right socket and pushes state to all', () => {
  const sent = { host: [], a1: [], a2: [] };
  const hub = createHub({ roomId: 'trhub' });
  const peer = (k) => ({ send: (m) => sent[k].push(m), close() {} });
  const h = hub.connect({ s: 'host', k: 'host' }, peer('host'));
  const a = hub.connect({ s: 'a1', k: 'actor', o: 'DAVE' }, peer('a1'));
  hub.connect({ s: 'a2', k: 'actor', o: 'MATTHEW' }, peer('a2'));
  h.message(JSON.stringify({ type: 'load_script', text: SCRIPT }));
  assert.equal(sent.a2.at(-1).state.scene.lines.length, 6);
  a.message(JSON.stringify({ type: 'signal', to: 'a2', data: { x: 1 } }));
  assert.equal(sent.a2.at(-1).type, 'signal');
  assert.ok(!sent.host.some((m) => m.type === 'signal'));
  a.message(JSON.stringify({ type: 'advance' }));
  assert.equal(sent.a1.at(-1).error, 'host_only');
  a.message('{not json');
  assert.equal(sent.a1.at(-1).error, 'bad_json');
  a.closed();
  assert.equal(sent.host.at(-1).state.seats.find((s) => s.seat_id === 'a1').connected, false);
});

test('routes: off by default, sign-in for rooms, host-only invites, pass on the socket', async () => {
  const off = await handleTableRead(new Request('https://api.mccluster.org/v1/table-read/rooms', { method: 'POST' }), {});
  assert.equal(off.status, 503);
  assert.equal((await (await handleTableRead(new Request('https://api.mccluster.org/v1/table-read/status'), {})).json()).enabled, false);
  assert.equal(await handleTableRead(new Request('https://api.mccluster.org/v1/other'), {}), null, 'other paths fall through');

  let forwarded = null;
  const env = {
    TABLE_READ_ENABLED: 'true', TABLE_READ_PASS_KEY: 'p'.repeat(40), SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'svc',
    TABLE_READ_ROOM: { idFromName: (n) => n, get: () => ({ fetch: async (req) => { forwarded = req; return new Response('ok'); } }) },
  };
  assert.ok(tableReadReady(env));
  const fetchImpl = async (u, o) => (o.headers.authorization === 'Bearer good' ? new Response(JSON.stringify({ id: 'u1' })) : new Response('{}', { status: 401 }));
  const anon = await handleTableRead(new Request('https://api.mccluster.org/v1/table-read/rooms', { method: 'POST' }), env, { fetchImpl });
  assert.equal(anon.status, 401);
  const made = await handleTableRead(new Request('https://api.mccluster.org/v1/table-read/rooms', {
    method: 'POST', headers: { authorization: 'Bearer good' }, body: JSON.stringify({ roles: ['DAVE', 'MATTHEW'] }),
  }), env, { fetchImpl });
  const room = await made.json();
  assert.match(room.room_id, /^tr[0-9a-f]{18}$/);
  assert.equal(room.invites.length, 2);

  const actorInvite = await handleTableRead(new Request(`https://api.mccluster.org/v1/table-read/rooms/${room.room_id}/invites`, {
    method: 'POST', headers: { authorization: `TableRead ${room.invites[0].pass}` }, body: JSON.stringify({ role: 'X' }),
  }), env);
  assert.equal(actorInvite.status, 403);
  const hostInvite = await handleTableRead(new Request(`https://api.mccluster.org/v1/table-read/rooms/${room.room_id}/invites`, {
    method: 'POST', headers: { authorization: `TableRead ${room.host_pass}` }, body: JSON.stringify({ role: 'NURSE' }),
  }), env);
  assert.equal((await hostInvite.json()).role, 'NURSE');

  const sock = (proto, id = room.room_id) => handleTableRead(new Request(`https://api.mccluster.org/v1/table-read/rooms/${id}/socket`, {
    headers: { upgrade: 'websocket', 'sec-websocket-protocol': proto },
  }), env);
  assert.equal((await sock('tr1')).status, 401);
  assert.equal((await sock(`tr1, ${room.invites[0].pass}`, 'tr000000000000000000')).status, 403, 'a pass for another room');
  assert.equal((await sock(`tr1, ${room.invites[0].pass}`)).status, 200);
  assert.equal(JSON.parse(forwarded.headers.get('x-table-read-claims')).o, 'DAVE');
});

test('a seat may set its own display name, clipped', () => {
  const r = room();
  handle(r, 'a1', { type: 'set_name', name: '  Dave\u0007 stand-in  ' });
  assert.equal(r.seats.a1.name, 'Dave  stand-in');
  handle(r, 'a1', { type: 'set_name', name: 'x'.repeat(200) });
  assert.equal(r.seats.a1.name.length, 60);
});
