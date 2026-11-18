// The browser executor's egress proxy on its own, without Chromium: one
// authorization per connection, a connection only to an address that
// authorization validated (never to a name, so nothing resolves it twice), the
// peer checked again after the connect, absolute-form http forwarded over the
// pinned socket with the Host header kept and hop-by-hop headers dropped, and
// every refusal answered with its code only. Public addresses here are
// documentation addresses; a test delivery maps them to a loopback server.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createEgressProxy, forwardableHeaders, parseAuthority, EGRESS_REFUSAL_HEADER } from '../src/compute/browser-egress.mjs';
import { checkRequest } from '../src/compute/browser-policy.mjs';

const closers = [];
after(async () => { for (const close of closers.reverse()) await close(); });

// A loopback target: echoes raw bytes on a tunnel, answers HTTP requests with
// what it received, and counts every connection it accepts.
async function startTarget() {
  const seen = { connections: 0, requests: [] };
  const server = http.createServer((req, res) => {
    seen.requests.push({ method: req.method, url: req.url, headers: req.headers });
    res.writeHead(201, { 'content-type': 'text/plain', 'x-target': 'yes', connection: 'keep-alive', 'keep-alive': 'timeout=5' });
    res.end(`TARGET ${req.method} ${req.url}`);
  });
  server.on('connection', () => { seen.connections += 1; });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  closers.push(async () => { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); });
  return { port: server.address().port, seen };
}

async function startProxy(options) {
  const proxy = createEgressProxy(options);
  const port = await proxy.listen();
  closers.push(() => proxy.close());
  return { proxy, port };
}

// One raw exchange: resolves with the status, the full text and the socket
// (left open for a 200 tunnel so the test can use it).
function exchange(port, request) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let text = '';
    const done = (status) => { socket.removeAllListeners('data'); resolve({ status, text, socket }); };
    socket.on('connect', () => socket.write(request));
    socket.on('data', (chunk) => {
      text += chunk;
      const status = Number((/^HTTP\/1\.[01] (\d{3})/.exec(text) || [])[1] || 0);
      if (status === 200 && /^CONNECT /.test(request) && text.includes('\r\n\r\n')) done(200);
    });
    socket.on('end', () => done(Number((/^HTTP\/1\.[01] (\d{3})/.exec(text) || [])[1] || 0)));
    socket.on('error', reject);
  });
}

function tunnelRoundTrip(socket, payload) {
  return new Promise((resolve, reject) => {
    let text = '';
    socket.on('data', (chunk) => { text += chunk; if (text.includes('TARGET')) { socket.destroy(); resolve(text); } });
    socket.on('error', reject);
    socket.write(payload);
  });
}

// The executor's rule, with a resolver the test controls.
function policyAuthorize(resolve) {
  return (host) => checkRequest(`http://${net.isIPv6(host) ? `[${host}]` : host}/`, null, { navigation: false, resolve });
}

test('authorities and headers: host:port and [v6]:port only; hop-by-hop and Connection-named headers are dropped', () => {
  assert.deepEqual(parseAuthority('Docs.Example.test:443'), { host: 'docs.example.test', port: 443 });
  assert.deepEqual(parseAuthority('[2001:db8::1]:8443'), { host: '2001:db8::1', port: 8443 });
  for (const bad of ['docs.example.test', 'docs.example.test:0', 'docs.example.test:70000', 'user@host:443', 'http://host:80', '[nothex]:1', '', null]) assert.equal(parseAuthority(bad), null, String(bad));
  assert.deepEqual(forwardableHeaders(['Host', 'a.test', 'Connection', 'keep-alive, X-Drop', 'Proxy-Connection', 'keep-alive', 'X-Drop', '1', 'Keep-Alive', 'timeout=5', 'Transfer-Encoding', 'chunked', 'Accept', '*/*']), ['Host', 'a.test', 'Accept', '*/*']);
});

test('CONNECT asks once and connects to exactly the address it validated: a resolver that answers private afterwards is never asked again for that connection', async () => {
  const target = await startTarget();
  const answers = [[{ address: '198.51.100.7', family: 4 }], [{ address: '127.0.0.1', family: 4 }]];
  const lookups = [];
  const dialed = [];
  const { port } = await startProxy({
    authorize: policyAuthorize(async (host) => { lookups.push(host); return answers[Math.min(lookups.length - 1, answers.length - 1)]; }),
    // The test network: the documentation address is the loopback target.
    deliver: (address, p) => { dialed.push(`${address}:${p}`); return { host: '127.0.0.1', port: target.port, test: true }; }
  });
  const first = await exchange(port, 'CONNECT rebind.example.test:443 HTTP/1.1\r\nhost: rebind.example.test:443\r\n\r\n');
  assert.equal(first.status, 200);
  assert.match(await tunnelRoundTrip(first.socket, 'GET /through HTTP/1.1\r\nhost: rebind.example.test\r\nconnection: close\r\n\r\n'), /TARGET GET \/through/);
  assert.deepEqual(lookups, ['rebind.example.test'], 'one resolution for the connection');
  assert.deepEqual(dialed, ['198.51.100.7:443'], 'connected at the validated address');
  // The next connection resolves again and now meets the private answer: refused, never dialed.
  const second = await exchange(port, 'CONNECT rebind.example.test:443 HTTP/1.1\r\nhost: rebind.example.test:443\r\n\r\n');
  assert.equal(second.status, 403);
  assert.match(second.text, new RegExp(`${EGRESS_REFUSAL_HEADER}: BROWSER_PRIVATE_ADDRESS`, 'i'));
  assert.doesNotMatch(second.text, /127\.0\.0\.1/, 'the answer never echoes an address');
  assert.deepEqual(dialed, ['198.51.100.7:443']);
  assert.equal(target.seen.connections, 1);
});

test('a cached answer is the one connected to: authorize answers from the caller cache without a second lookup', async () => {
  const target = await startTarget();
  const cache = new Map([['cached.example.test', [{ address: '198.51.100.9', family: 4 }]]]);
  let lookups = 0;
  const dialed = [];
  const { port } = await startProxy({
    authorize: (host) => checkRequest(`http://${host}/`, null, { navigation: false, resolve: async () => { lookups += 1; return [{ address: '10.0.0.5', family: 4 }]; }, cache }),
    deliver: (address) => { dialed.push(address); return { host: '127.0.0.1', port: target.port, test: true }; }
  });
  const tunnel = await exchange(port, 'CONNECT cached.example.test:80 HTTP/1.1\r\nhost: cached.example.test:80\r\n\r\n');
  assert.equal(tunnel.status, 200);
  tunnel.socket.destroy();
  assert.equal(lookups, 0, 'the validated answer in the cache was used');
  assert.deepEqual(dialed, ['198.51.100.9']);
});

test('private destinations are refused before any connection: literals, names answering private, mixed answers, and a failed lookup', async () => {
  const target = await startTarget();
  const dialed = [];
  const answersFor = { 'lan.example.test': [{ address: '192.168.1.20', family: 4 }], 'mixed.example.test': [{ address: '198.51.100.7', family: 4 }, { address: '10.1.2.3', family: 4 }], 'v6.example.test': [{ address: 'fe80::1', family: 6 }] };
  const refusals = [];
  const { port } = await startProxy({
    authorize: policyAuthorize(async (host) => { if (answersFor[host]) return answersFor[host]; throw Object.assign(new Error('nope'), { code: 'ENOTFOUND' }); }),
    deliver: (address) => { dialed.push(address); return { host: '127.0.0.1', port: target.port, test: true }; },
    onRefused: (event) => refusals.push(event)
  });
  for (const [authority, code] of [[`127.0.0.1:${target.port}`, 'BROWSER_PRIVATE_ADDRESS'], ['[::1]:443', 'BROWSER_PRIVATE_ADDRESS'], ['[::ffff:7f00:1]:443', 'BROWSER_PRIVATE_ADDRESS'], ['169.254.169.254:80', 'BROWSER_PRIVATE_ADDRESS'], ['lan.example.test:443', 'BROWSER_PRIVATE_ADDRESS'], ['mixed.example.test:443', 'BROWSER_PRIVATE_ADDRESS'], ['v6.example.test:443', 'BROWSER_PRIVATE_ADDRESS'], ['missing.example.test:443', 'BROWSER_DNS_FAILED']]) {
    const answer = await exchange(port, `CONNECT ${authority} HTTP/1.1\r\nhost: ${authority}\r\n\r\n`);
    assert.equal(answer.status, 403, authority);
    assert.match(answer.text, new RegExp(`${EGRESS_REFUSAL_HEADER}: ${code}`, 'i'), authority);
  }
  assert.deepEqual(dialed, [], 'nothing was dialed');
  assert.equal(target.seen.connections, 0);
  assert.equal(refusals.length, 8);
  assert.ok(refusals.every((event) => event.kind === 'connect' && /^BROWSER_/.test(event.code)));
});

test('the connected peer is checked again: a connection that lands on a private address outside the test delivery is closed and refused', async () => {
  const target = await startTarget();
  const { port } = await startProxy({
    authorize: async () => ({ ok: true, addresses: ['198.51.100.7'] }),
    // Something between the validation and the socket put the connection on loopback.
    deliver: () => ({ host: '127.0.0.1', port: target.port })
  });
  const answer = await exchange(port, 'CONNECT moved.example.test:443 HTTP/1.1\r\nhost: moved.example.test:443\r\n\r\n');
  assert.equal(answer.status, 403);
  assert.match(answer.text, new RegExp(`${EGRESS_REFUSAL_HEADER}: BROWSER_PRIVATE_ADDRESS`, 'i'));
});

test('absolute-form http is forwarded over the pinned socket with the Host header kept and hop-by-hop headers dropped', async () => {
  const target = await startTarget();
  const dialed = [];
  const { port } = await startProxy({
    authorize: policyAuthorize(async () => [{ address: '198.51.100.7', family: 4 }]),
    deliver: (address, p) => { dialed.push(`${address}:${p}`); return { host: '127.0.0.1', port: target.port, test: true }; }
  });
  const answer = await exchange(port, 'GET http://plain.example.test/path?q=1 HTTP/1.1\r\nhost: plain.example.test\r\nproxy-connection: keep-alive\r\nproxy-authorization: Basic eDp5\r\nx-keep: yes\r\nconnection: close\r\n\r\n');
  assert.equal(answer.status, 201);
  assert.match(answer.text, /TARGET GET \/path\?q=1/);
  assert.match(answer.text, /x-target: yes/i);
  assert.doesNotMatch(answer.text, /keep-alive: timeout/i, 'hop-by-hop response headers are dropped');
  assert.deepEqual(dialed, ['198.51.100.7:80']);
  const received = target.seen.requests.at(-1);
  assert.equal(received.url, '/path?q=1', 'origin-form upstream');
  assert.equal(received.headers.host, 'plain.example.test', 'the Host header is the original one');
  assert.equal(received.headers['x-keep'], 'yes');
  assert.equal(received.headers['proxy-connection'], undefined);
  assert.equal(received.headers['proxy-authorization'], undefined);
});

test('requests that are not absolute http, upgrades, private absolute targets and dead destinations are answered without a page', async () => {
  const target = await startTarget();
  const { port } = await startProxy({
    authorize: policyAuthorize(async (host) => (host === 'dead.example.test' ? [{ address: '198.51.100.8', family: 4 }] : [{ address: '198.51.100.7', family: 4 }])),
    // dead.example.test is delivered to a port nothing listens on.
    deliver: (address, p) => ({ host: '127.0.0.1', port: address === '198.51.100.8' ? 9 : target.port, test: true }),
    connectTimeoutMs: 3000
  });
  assert.equal((await exchange(port, 'GET /local HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\n\r\n')).status, 400, 'not a web server');
  assert.equal((await exchange(port, 'GET https://secure.example.test/ HTTP/1.1\r\nhost: secure.example.test\r\nconnection: close\r\n\r\n')).status, 400, 'https goes through CONNECT');
  assert.equal((await exchange(port, 'GET http://u:p@plain.example.test/ HTTP/1.1\r\nhost: plain.example.test\r\nconnection: close\r\n\r\n')).status, 400, 'credentials in a URL');
  const privateTarget = await exchange(port, `GET http://127.0.0.1:${target.port}/ HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\n\r\n`);
  assert.equal(privateTarget.status, 403);
  assert.match(privateTarget.text, new RegExp(`${EGRESS_REFUSAL_HEADER}: BROWSER_PRIVATE_ADDRESS`, 'i'));
  const upgrade = await exchange(port, 'GET http://plain.example.test/socket HTTP/1.1\r\nhost: plain.example.test\r\nconnection: Upgrade\r\nupgrade: websocket\r\n\r\n');
  assert.equal(upgrade.status, 403, 'a plain-http upgrade is never forwarded');
  const dead = await exchange(port, 'CONNECT dead.example.test:443 HTTP/1.1\r\nhost: dead.example.test:443\r\n\r\n');
  assert.equal(dead.status, 502);
  assert.match(dead.text, new RegExp(`${EGRESS_REFUSAL_HEADER}: BROWSER_EGRESS_CONNECT_FAILED`, 'i'));
  assert.equal(target.seen.connections, 0);
});

test('the proxy listens on loopback only', async () => {
  const { proxy } = await startProxy({ authorize: async () => ({ ok: false, code: 'BROWSER_DNS_FAILED' }) });
  assert.equal(proxy.server.address().address, '127.0.0.1');
  assert.equal(proxy.listening, true);
});
