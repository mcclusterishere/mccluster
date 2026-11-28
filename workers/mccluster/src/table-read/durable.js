/* TABLE READ — the room's Durable Object. Only routes.js reaches it, after it
   verified the seat pass; the claims arrive in x-table-read-claims. Room state
   (scene, cue, seats, consent, take markers) is saved after each change so an
   evicted object comes back on the same cue. No media and no recordings here. */
import { createHub } from './hub.js';

export class TableReadRoom {
  constructor(state) {
    this.state = state;
    this.hub = null;
    this.saving = null;
  }

  async load(roomId) {
    if (this.hub) return this.hub;
    const saved = await this.state.storage.get('room');
    this.hub = createHub({
      room: saved || null,
      roomId,
      onChange: (room) => {
        clearTimeout(this.saving);
        this.saving = setTimeout(() => this.state.storage.put('room', room), 250);
      },
    });
    return this.hub;
  }

  async fetch(request) {
    let claims;
    try { claims = JSON.parse(request.headers.get('x-table-read-claims') || ''); } catch { claims = null; }
    if (!claims) return new Response('forbidden', { status: 403 });
    const hub = await this.load(claims.r);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const peer = { send: (o) => server.send(JSON.stringify(o)), close: (c, r) => server.close(c, r) };
    const conn = hub.connect(claims, peer);
    if (conn) {
      server.addEventListener('message', (e) => conn.message(typeof e.data === 'string' ? e.data : ''));
      server.addEventListener('close', () => conn.closed());
      server.addEventListener('error', () => conn.closed());
    }
    return new Response(null, { status: 101, webSocket: client, headers: { 'sec-websocket-protocol': 'tr1' } });
  }
}
