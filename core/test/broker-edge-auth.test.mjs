import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalEdgeRequest,
  createEdgeVerifier,
  EDGE_HEADERS,
  EDGE_PROTOCOL,
  sha256Body,
  signEdgeRequest
} from '../src/broker-edge-auth.mjs';

const SECRET = 'edge-secret-for-tests';
const OTHER_SECRET = 'a-different-edge-secret';

function signed(body, overrides = {}) {
  const bodyBytes = Buffer.from(JSON.stringify(body));
  const headers = signEdgeRequest({ secret: SECRET, method: 'POST', path: '/mcp', bodyBytes, ...overrides });
  return { headers, bodyBytes };
}

function verifierArgs({ headers, bodyBytes }, extra = {}) {
  return { method: 'POST', path: '/mcp', headers, bodyBytes, ...extra };
}

test('accepts a correctly signed request', () => {
  const verifier = createEdgeVerifier({ secret: SECRET });
  const request = signed({ method: 'tools/list' });
  const result = verifier.verify(verifierArgs(request));
  assert.equal(result.protocol, EDGE_PROTOCOL);
  assert.equal(typeof result.nonce, 'string');
});

test('rejects a body swapped after signing', () => {
  const verifier = createEdgeVerifier({ secret: SECRET });
  const request = signed({ method: 'tools/call', params: { name: 'system.health' } });
  const tampered = {
    headers: request.headers,
    bodyBytes: Buffer.from(JSON.stringify({ method: 'tools/call', params: { name: 'code.build' } }))
  };
  assert.throws(() => verifier.verify(verifierArgs(tampered)), /digest mismatch/i);
});

test('rejects a signature made with the wrong key', () => {
  const verifier = createEdgeVerifier({ secret: SECRET });
  const bodyBytes = Buffer.from(JSON.stringify({ method: 'tools/list' }));
  const headers = signEdgeRequest({ secret: OTHER_SECRET, method: 'POST', path: '/mcp', bodyBytes });
  assert.throws(() => verifier.verify(verifierArgs({ headers, bodyBytes })), /signature is not valid/i);
});

test('rejects a request replayed onto a different path', () => {
  const verifier = createEdgeVerifier({ secret: SECRET });
  const request = signed({ method: 'tools/list' });
  assert.throws(
    () => verifier.verify(verifierArgs(request, { path: '/v1/tools/call' })),
    /signature is not valid/i
  );
});

test('rejects a stale timestamp', () => {
  const verifier = createEdgeVerifier({ secret: SECRET, maxClockSkewMs: 1_000 });
  const request = signed({ method: 'tools/list' }, { timestamp: new Date(Date.now() - 60_000).toISOString() });
  assert.throws(() => verifier.verify(verifierArgs(request)), /outside the accepted window/i);
});

test('rejects a future timestamp beyond the skew window', () => {
  const verifier = createEdgeVerifier({ secret: SECRET, maxClockSkewMs: 1_000 });
  const request = signed({ method: 'tools/list' }, { timestamp: new Date(Date.now() + 60_000).toISOString() });
  assert.throws(() => verifier.verify(verifierArgs(request)), /outside the accepted window/i);
});

test('rejects a replayed nonce', () => {
  const verifier = createEdgeVerifier({ secret: SECRET });
  const request = signed({ method: 'tools/list' });
  verifier.verify(verifierArgs(request));
  assert.throws(() => verifier.verify(verifierArgs(request)), /nonce was already used/i);
});

test('rejects an unsigned request', () => {
  const verifier = createEdgeVerifier({ secret: SECRET });
  const bodyBytes = Buffer.from('{}');
  assert.throws(
    () => verifier.verify(verifierArgs({ headers: {}, bodyBytes })),
    /not signed/i
  );
});

test('rejects a partially signed request', () => {
  const verifier = createEdgeVerifier({ secret: SECRET });
  const request = signed({ method: 'tools/list' });
  const headers = { ...request.headers };
  delete headers[EDGE_HEADERS.nonce];
  assert.throws(
    () => verifier.verify(verifierArgs({ headers, bodyBytes: request.bodyBytes })),
    /not signed/i
  );
});

test('rejects an unknown protocol version', () => {
  const verifier = createEdgeVerifier({ secret: SECRET });
  const request = signed({ method: 'tools/list' });
  const headers = { ...request.headers, [EDGE_HEADERS.protocol]: 'mccluster-edge/v99' };
  assert.throws(
    () => verifier.verify(verifierArgs({ headers, bodyBytes: request.bodyBytes })),
    /Unsupported edge protocol/i
  );
});

test('reads headers from a fetch-style Headers object', () => {
  const verifier = createEdgeVerifier({ secret: SECRET });
  const request = signed({ method: 'tools/list' });
  const headers = new Headers(request.headers);
  assert.equal(verifier.verify(verifierArgs({ headers, bodyBytes: request.bodyBytes })).protocol, EDGE_PROTOCOL);
});

test('nonce cache stays bounded', () => {
  const verifier = createEdgeVerifier({ secret: SECRET, nonceCacheMax: 8 });
  for (let i = 0; i < 50; i += 1) {
    verifier.verify(verifierArgs(signed({ method: 'tools/list', id: i })));
  }
  assert.ok(verifier.pendingNonces <= 8, `expected <= 8 cached nonces, got ${verifier.pendingNonces}`);
});

test('canonical string binds method, path, timestamp, nonce and digest', () => {
  const digest = sha256Body(Buffer.from('{}'));
  const canonical = canonicalEdgeRequest({
    method: 'post',
    path: '/mcp',
    timestamp: '2026-09-16T00:00:00.000Z',
    nonce: 'n-1',
    digest
  });
  assert.equal(canonical.split('\n')[0], 'MCCLUSTER-EDGE-V1');
  assert.equal(canonical.split('\n')[1], 'POST');
  assert.equal(canonical.split('\n')[2], '/mcp');
  assert.ok(canonical.endsWith(digest));
});

test('verifier construction requires a secret', () => {
  assert.throws(() => createEdgeVerifier({}), /requires a signing secret/i);
});

test('Core -> Worker signatures are domain-separated from Worker -> Core', async () => {
  const { signCoreRequest, canonicalCoreRequest, CORE_PROTOCOL } = await import('../src/broker-edge-auth.mjs');
  const bodyBytes = Buffer.from(JSON.stringify({ method: 'tools/list' }));
  const headers = signCoreRequest({ secret: SECRET, method: 'POST', path: '/mcp', bodyBytes });
  assert.equal(headers[EDGE_HEADERS.protocol], CORE_PROTOCOL);
  const verifier = createEdgeVerifier({ secret: SECRET });
  assert.throws(
    () => verifier.verify({ method: 'POST', path: '/mcp', headers: { ...headers, [EDGE_HEADERS.protocol]: EDGE_PROTOCOL }, bodyBytes }),
    /signature is not valid/i
  );
  assert.match(canonicalCoreRequest({ method: 'post', path: '/p', timestamp: 't', nonce: 'n', digest: 'd' }), /^MCCLUSTER-CORE-V1\nPOST\n\/p\nt\nn\nd$/);
});

test('mcp-http signs a server marked with signEnv over the exact body', async () => {
  const { mcpRpc } = await import('../src/tools/mcp-http.mjs');
  const { createHmac, createHash } = await import('node:crypto');
  process.env.TEST_CORE_SIGNING_KEY = SECRET;
  const original = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    await mcpRpc({ url: 'https://api.mccluster.org/v1/media/mcp', signEnv: 'TEST_CORE_SIGNING_KEY' }, 'tools/list');
  } finally {
    globalThis.fetch = original;
    delete process.env.TEST_CORE_SIGNING_KEY;
  }
  const h = captured.init.headers;
  assert.equal(h[EDGE_HEADERS.protocol], 'mccluster-core/v1');
  assert.equal(h[EDGE_HEADERS.digest], createHash('sha256').update(captured.init.body).digest('base64url'));
  const canonical = ['MCCLUSTER-CORE-V1', 'POST', '/v1/media/mcp', h[EDGE_HEADERS.timestamp], h[EDGE_HEADERS.nonce], h[EDGE_HEADERS.digest]].join('\n');
  assert.equal(h[EDGE_HEADERS.signature], createHmac('sha256', SECRET).update(canonical).digest('base64url'));
});

test('mcp-http sends no signature when the server is not marked', async () => {
  const { mcpRpc } = await import('../src/tools/mcp-http.mjs');
  const original = globalThis.fetch;
  let headers;
  globalThis.fetch = async (_url, init) => {
    headers = init.headers;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { headers: { 'content-type': 'application/json' } });
  };
  try { await mcpRpc({ url: 'https://example.com/mcp' }, 'tools/list'); }
  finally { globalThis.fetch = original; }
  assert.equal(headers[EDGE_HEADERS.signature], undefined);
});
