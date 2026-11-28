/* TABLE READ — one room's live connections, independent of the socket type.
   The Durable Object feeds it Cloudflare WebSockets; the Prime-local relay
   feeds it Node sockets. Both get identical behaviour from room.js. */
import { createRoom, join, leave, handle, publicState } from './room.js';

export function createHub({ room, roomId, sceneTitle, onChange = () => {}, now = () => Date.now() } = {}) {
  const state = room || createRoom({ roomId, sceneTitle, now: now() });
  const sockets = new Map(); // seat_id -> send(obj)

  const sendTo = (seat, msg) => { const s = sockets.get(seat); if (s) try { s.send(msg); } catch { /* closed */ } };
  const broadcast = (msg) => { for (const seat of sockets.keys()) sendTo(seat, msg); };
  const pushState = () => { broadcast({ type: 'state', state: publicState(state), server_t: now() }); onChange(state); };

  return {
    room: state,
    connect(claims, peer) {
      const r = join(state, { seatId: claims.s, kind: claims.k, role: claims.o, name: claims.n, now: now() });
      if (r.error) { peer.send({ type: 'error', error: r.error }); peer.close?.(4003, r.error); return null; }
      const prior = sockets.get(claims.s);
      if (prior && prior !== peer) try { prior.close?.(4009, 'replaced'); } catch { /* gone */ }
      sockets.set(claims.s, peer);
      peer.send({ type: 'welcome', seat_id: claims.s, kind: claims.k, role: state.seats[claims.s].role, server_t: now(), rejoined: r.rejoined });
      pushState();
      return {
        message(raw) {
          let msg;
          try { msg = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { peer.send({ type: 'error', error: 'bad_json' }); return; }
          const out = handle(state, claims.s, msg, now());
          if (out.error) { peer.send({ type: 'error', error: out.error, for: msg?.type, seats: out.seats }); return; }
          if (out.reply) peer.send(out.reply);
          if (out.to) for (const t of out.to) sendTo(t.seat, t.msg);
          if (out.broadcast) broadcast(out.broadcast);
          if (out.close) { const s = sockets.get(out.close); sockets.delete(out.close); try { s?.send({ type: 'removed' }); s?.close?.(4001, 'removed'); } catch { /* gone */ } }
          if (out.state) pushState();
        },
        closed() {
          if (sockets.get(claims.s) !== peer) return;
          sockets.delete(claims.s);
          leave(state, claims.s, now());
          pushState();
        },
      };
    },
  };
}
