// The node browser's only way onto the network: a loopback forward proxy.
// Chromium is launched to use it for every request (loopback included, WebRTC
// held to proxied traffic) and the executor's own Node-side fetches
// (route.fetch) tunnel through it, so no connection leaves the executor except
// from here. For each connection the proxy asks `authorize(host)` once (the
// executor answers from the task's DNS cache, the very answer its policy check
// validated, or resolves the name once), refuses the destination when any
// address in the answer is private, loopback, link-local or special, connects
// to exactly a validated address (never to a name, so nothing resolves it a
// second time) and checks the connected peer again. A DNS answer that changes
// between the policy check and the connection (rebinding) therefore cannot
// reach the owner's LAN. CONNECT carries https, wss and the executor's own
// fetches; absolute-form requests carry Chromium's plain http. Answers never
// echo an address: a refusal names its code only.
import http from 'node:http';
import net from 'node:net';
import { isPrivateAddress } from './browser-policy.mjs';

export const EGRESS_REFUSAL_HEADER = 'x-mccluster-egress-refusal';
const HOP_BY_HOP = ['connection', 'proxy-connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
const CODE = /^BROWSER_[A-Z_]{1,40}$/;

function refusal(code) {
  return Object.assign(new Error(code), { code: CODE.test(String(code)) ? code : 'BROWSER_EGRESS_REFUSED' });
}

// "host:port" or "[v6]:port" (a CONNECT authority); null when it is anything else.
export function parseAuthority(value) {
  const match = /^(?:\[([0-9a-f:.]+)\]|([a-z0-9_.-]+)):(\d{1,5})$/i.exec(String(value || '').trim());
  if (!match) return null;
  if (match[1] && !net.isIPv6(match[1])) return null;
  const port = Number(match[3]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: (match[1] || match[2]).toLowerCase(), port };
}

// Header pairs without hop-by-hop headers and without any header the
// Connection header names; rawHeaders keep their order and case.
export function forwardableHeaders(raw) {
  const drop = new Set(HOP_BY_HOP);
  for (let i = 0; i < raw.length; i += 2) {
    if (String(raw[i]).toLowerCase() === 'connection') for (const token of String(raw[i + 1]).split(',')) drop.add(token.trim().toLowerCase());
  }
  const out = [];
  for (let i = 0; i < raw.length; i += 2) if (!drop.has(String(raw[i]).toLowerCase())) out.push(raw[i], raw[i + 1]);
  return out;
}

// No connection made here ever resolves a name: the destination is always an
// IP literal, and this lookup refuses if a name ever reached a connect.
const noLookup = (hostname, options, callback) => callback(Object.assign(new Error('the egress proxy connects to validated addresses only'), { code: 'EGRESS_NO_LOOKUP' }));

function connectOnce(target, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: target.host, port: target.port, lookup: noLookup });
    const timer = setTimeout(() => { socket.destroy(); reject(Object.assign(new Error('connect timed out'), { code: 'ETIMEDOUT' })); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', (error) => { clearTimeout(timer); socket.destroy(); reject(error); });
  });
}

const identityDelivery = (address, port) => ({ host: address, port });

// authorize(host) -> { ok: true, addresses: [validated ip, ...] } | { ok: false, code }
// deliver(address, port) -> { host: ip, port, test?: true }: identity in
// production; the executor's test mode alone delivers its documentation
// address to the loopback fixture (and only that delivery skips the peer check).
export function createEgressProxy({ authorize, deliver = identityDelivery, onRefused = () => {}, connectTimeoutMs = 15_000, idleTimeoutMs = 120_000 } = {}) {
  if (typeof authorize !== 'function') throw new TypeError('authorize is required');
  const stats = { tunnels: 0, requests: 0, refused: 0, failed: 0 };
  const sockets = new Set();
  const track = (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); return socket; };

  async function addressesFor(host, port, kind) {
    let verdict;
    try { verdict = await authorize(host, port); }
    catch { verdict = { ok: false, code: 'BROWSER_DNS_FAILED' }; }
    // The whole answer must be public, exactly as the policy's checkAddresses
    // rules: one private address refuses the destination.
    const listed = verdict?.ok === true && Array.isArray(verdict.addresses) ? verdict.addresses : [];
    const addresses = listed.length && listed.every((address) => net.isIP(String(address)) && !isPrivateAddress(String(address))) ? listed.map(String) : [];
    if (!addresses.length) {
      const code = verdict?.ok === true ? 'BROWSER_PRIVATE_ADDRESS' : (CODE.test(String(verdict?.code)) ? verdict.code : 'BROWSER_DNS_FAILED');
      stats.refused += 1;
      onRefused({ host, port, kind, code });
      throw refusal(code);
    }
    return addresses;
  }

  async function dial(host, port, addresses, kind) {
    let lastError = null;
    for (const address of addresses) {
      const target = deliver(address, port) || identityDelivery(address, port);
      if (!net.isIP(String(target.host))) continue;
      let socket;
      try { socket = await connectOnce(target, connectTimeoutMs); }
      catch (error) { lastError = error; continue; }
      // The peer is checked again after the connect; only the executor's
      // test-mode delivery of its documentation address is exempt.
      if (target.test !== true && isPrivateAddress(String(socket.remoteAddress || ''))) {
        socket.destroy();
        stats.refused += 1;
        onRefused({ host, port, kind, code: 'BROWSER_PRIVATE_ADDRESS' });
        throw refusal('BROWSER_PRIVATE_ADDRESS');
      }
      return track(socket);
    }
    stats.failed += 1;
    throw Object.assign(new Error('no validated address accepted the connection'), { code: 'BROWSER_EGRESS_CONNECT_FAILED', cause: lastError });
  }

  const server = http.createServer();

  // CONNECT host:port: a byte tunnel to a validated address.
  server.on('connect', async (req, client, head) => {
    track(client);
    client.on('error', () => {});
    const target = parseAuthority(req.url);
    if (!target) { client.end('HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\nconnection: close\r\n\r\n'); return; }
    let upstream;
    try {
      const addresses = await addressesFor(target.host, target.port, 'connect');
      upstream = await dial(target.host, target.port, addresses, 'connect');
    } catch (error) {
      const code = CODE.test(String(error?.code)) ? error.code : 'BROWSER_EGRESS_REFUSED';
      const status = code === 'BROWSER_EGRESS_CONNECT_FAILED' ? '502 Bad Gateway' : '403 Forbidden';
      if (!client.destroyed) client.end(`HTTP/1.1 ${status}\r\n${EGRESS_REFUSAL_HEADER}: ${code}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`);
      return;
    }
    if (client.destroyed) { upstream.destroy(); return; }
    stats.tunnels += 1;
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
    upstream.setTimeout(idleTimeoutMs, () => { upstream.destroy(); client.destroy(); });
    client.setTimeout(idleTimeoutMs, () => { upstream.destroy(); client.destroy(); });
    upstream.on('close', () => client.destroy());
    client.on('close', () => upstream.destroy());
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });

  // Absolute-form http (GET http://host/path): one request to a validated address.
  server.on('request', async (req, res) => {
    let url = null;
    try { url = /^http:\/\//i.test(req.url || '') ? new URL(req.url) : null; } catch { url = null; }
    if (!url || url.username || url.password) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
      res.end('the egress proxy forwards absolute http URLs only');
      return;
    }
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const port = url.port ? Number(url.port) : 80;
    let socket;
    try {
      const addresses = await addressesFor(host, port, 'request');
      socket = await dial(host, port, addresses, 'request');
    } catch (error) {
      const code = CODE.test(String(error?.code)) ? error.code : 'BROWSER_EGRESS_REFUSED';
      res.writeHead(code === 'BROWSER_EGRESS_CONNECT_FAILED' ? 502 : 403, { 'content-type': 'text/plain; charset=utf-8', [EGRESS_REFUSAL_HEADER]: code, connection: 'close' });
      res.end(code);
      return;
    }
    stats.requests += 1;
    const upstream = http.request({
      createConnection: () => socket,
      method: req.method,
      path: `${url.pathname}${url.search}`,
      headers: forwardableHeaders(req.rawHeaders),
      setHost: false
    });
    upstream.setTimeout(idleTimeoutMs, () => upstream.destroy(Object.assign(new Error('upstream idle'), { code: 'ETIMEDOUT' })));
    upstream.on('response', (answer) => {
      res.writeHead(answer.statusCode || 502, answer.statusMessage, forwardableHeaders(answer.rawHeaders));
      answer.pipe(res);
      answer.on('error', () => res.destroy());
    });
    upstream.on('error', () => {
      if (!res.headersSent) { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' }); res.end('BROWSER_EGRESS_CONNECT_FAILED'); }
      else res.destroy();
    });
    req.on('error', () => upstream.destroy());
    req.pipe(upstream);
  });

  // An Upgrade without CONNECT (a plain-http WebSocket) is never forwarded.
  server.on('upgrade', (req, socket) => {
    stats.refused += 1;
    let host = null;
    try { host = new URL(req.url).hostname; } catch { host = null; }
    onRefused({ host, port: null, kind: 'upgrade', code: 'BROWSER_EGRESS_REFUSED' });
    socket.end(`HTTP/1.1 403 Forbidden\r\n${EGRESS_REFUSAL_HEADER}: BROWSER_EGRESS_REFUSED\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`);
  });
  server.on('clientError', (error, socket) => socket.destroy());

  return {
    stats,
    server,
    get port() { return server.address()?.port ?? null; },
    get listening() { return server.listening; },
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); });
      });
    },
    close() {
      return new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections?.();
        if (!server.listening) { resolve(); return; }
        server.close(() => resolve());
      });
    }
  };
}
