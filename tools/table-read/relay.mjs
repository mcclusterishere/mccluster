#!/usr/bin/env node
/* TABLE READ — Prime-local relay. Serves this checkout's pages and runs the
   room with the Worker's own code (workers/mccluster/src/table-read/hub.js),
   so a Table Read works on Prime with no cloud: for rehearsal, for the
   end-to-end test, and for phones reached through an HTTPS tunnel.

     node tools/table-read/relay.mjs [--port 8787] [--host 127.0.0.1]

   It binds to 127.0.0.1 by default. Phones need HTTPS for the camera, so a
   phone reaches it through an HTTPS tunnel or the Worker's rooms, never plain
   LAN http. Room creation here needs no sign-in, which is why it never listens
   beyond the address you give it. The pass key lives only in this process
   (random per run). No recordings pass through it. Zero dependencies: the
   WebSocket server below is the minimum of RFC 6455 the room needs (text
   frames, ping/pong, close). */
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHub } from '../../workers/mccluster/src/table-read/hub.js';
import { signPass, readPass, randomId } from '../../workers/mccluster/src/table-read/room.js';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

export function startRelay({ port = 8787, host = '127.0.0.1', log = console.log } = {}) {
  const KEY = randomBytes(32).toString('hex');
  const hubs = new Map();
  const hubFor = (id) => { if (!hubs.has(id)) hubs.set(id, createHub({ roomId: id })); return hubs.get(id); };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://relay');
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (url.pathname === '/v1/table-read/status') return json(res, 200, { enabled: true, relay: true });
    if (url.pathname === '/v1/table-read/rooms' && req.method === 'POST') {
      let body = ''; for await (const c of req) { body += c; if (body.length > 1e6) break; }
      let parsed = {}; try { parsed = JSON.parse(body || '{}'); } catch { /* empty */ }
      const id = randomId('tr', 9);
      const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
      const invites = [];
      for (const role of (parsed.roles || []).slice(0, 5)) {
        const seat = randomId('a', 6);
        invites.push({ role, seat_id: seat, pass: await signPass(KEY, { r: id, s: seat, k: 'actor', o: String(role).slice(0, 40), e: exp }), expires_at: exp });
      }
      hubFor(id);
      log(`room ${id}: ${invites.map((i) => i.role).join(', ')}`);
      return json(res, 200, { room_id: id, host_pass: await signPass(KEY, { r: id, s: 'host', k: 'host', o: null, n: 'Host', e: exp }), invites, expires_at: exp });
    }
    const path = normalize(decodeURIComponent(url.pathname)).replace(/^([.][.][/\\])+/, '');
    const file = join(ROOT, path === '/' ? 'table-read.html' : path);
    if (!file.startsWith(ROOT) || /[/\\]\.(git|env)/.test(file)) { res.writeHead(404); res.end(); return; }
    try {
      let body = await readFile(file);
      if (extname(file) === '.html') body = Buffer.from(String(body).replace(/__STAMP__/g, 'relay'));
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });

  server.on('upgrade', async (req, socket) => {
    const m = new URL(req.url, 'http://relay').pathname.match(/^\/v1\/table-read\/rooms\/(tr[0-9a-f]{18})\/socket$/);
    const protos = String(req.headers['sec-websocket-protocol'] || '').split(',').map((s) => s.trim());
    const claims = m && protos[0] === 'tr1' ? await readPass(KEY, protos[1]) : null;
    if (!claims || claims.r !== m[1] || !hubs.has(m[1])) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: tr1\r\n\r\n`);
    const peer = wsPeer(socket);
    const conn = hubFor(m[1]).connect(claims, peer);
    if (!conn) return;
    peer.onText = (t) => conn.message(t);
    peer.onClose = () => conn.closed();
  });

  return new Promise((ok) => server.listen(port, host, () => {
    const addr = server.address();
    log(`Table Read relay on http://${host}:${addr.port}/table-read.html?api=http://${host}:${addr.port}`);
    ok({ server, port: addr.port, url: `http://${host}:${addr.port}`, close: () => new Promise((r) => server.close(r)), hubs });
  }));
}

function wsPeer(socket) {
  let buf = Buffer.alloc(0); let closed = false; let frag = [];
  const peer = { onText: () => {}, onClose: () => {} };
  const frame = (op, payload) => {
    const len = payload.length;
    const head = len < 126 ? Buffer.from([0x80 | op, len]) : len < 65536 ? Buffer.from([0x80 | op, 126, len >> 8, len & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
    if (!closed) socket.write(Buffer.concat([head, payload]));
  };
  const end = () => { if (closed) return; closed = true; peer.onClose(); socket.destroy(); };
  peer.send = (obj) => frame(1, Buffer.from(JSON.stringify(obj)));
  peer.close = (code = 1000) => { const b = Buffer.alloc(2); b.writeUInt16BE(code); frame(8, b); end(); };
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80; const op = buf[0] & 15; const masked = buf[1] & 0x80;
      let len = buf[1] & 127; let o = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); o = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); o = 10; }
      if (len > 1_000_000) { end(); return; }
      if (buf.length < o + (masked ? 4 : 0) + len) return;
      const mask = masked ? buf.subarray(o, o + 4) : null; o += masked ? 4 : 0;
      const payload = Buffer.from(buf.subarray(o, o + len)); buf = buf.subarray(o + len);
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      if (op === 8) { frame(8, Buffer.alloc(0)); end(); return; }
      if (op === 9) { frame(10, payload); continue; }
      if (op === 1 || op === 0) { frag.push(payload); if (fin) { const t = Buffer.concat(frag).toString('utf8'); frag = []; peer.onText(t); } }
    }
  });
  socket.on('close', end); socket.on('error', end);
  return peer;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  startRelay({ port: Number(arg('--port', 8787)), host: arg('--host', '127.0.0.1') });
}
