import test from 'node:test';
import assert from 'node:assert/strict';
import { mcpRpc } from '../src/tools/mcp-http.mjs';

test('endpoint validation refuses remote HTTP, credentials and fragments before dispatch', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected dispatch'); };
  try {
    for (const url of ['http://example.com/mcp', 'https://user:secret@example.com/mcp', 'https://example.com/mcp#fragment', 'file:///tmp/mcp']) {
      await assert.rejects(mcpRpc({ url }, 'tools/list'));
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('all redirect statuses stop without retry or dispatch to Location', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [301, 302, 303, 307, 308]) {
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        calls++;
        assert.equal(init.redirect, 'manual');
        return new Response(null, { status, headers: { location: 'https://unapproved.example/mcp' } });
      };
      await assert.rejects(mcpRpc({ url: 'https://api.mccluster.org/v1/core/mcp' }, 'tools/list', {}, { retries: 2 }), /endpoint redirected/);
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = original; }
});

test('configured HTTPS and IPv4/IPv6 loopback HTTP remain usable', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ result: { tools: [] } }), { headers: { 'content-type': 'application/json' } });
  try {
    for (const url of ['https://api.mccluster.org/v1/core/mcp', 'http://localhost:4777/mcp', 'http://127.0.0.1:4777/mcp', 'http://[::1]:4777/mcp']) {
      assert.deepEqual(await mcpRpc({ url }, 'tools/list'), { tools: [] });
    }
  } finally { globalThis.fetch = original; }
});

test('redirect cleanup failure preserves refusal without transport retry', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { status: 307, body: { cancel: async () => { throw new TypeError('cleanup failed'); } } };
  };
  try {
    await assert.rejects(mcpRpc({ url: 'https://api.mccluster.org/v1/core/mcp' }, 'tools/list', {}, { retries: 2 }), /endpoint redirected/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('native fetch never sends redirected private arguments or custom headers to target', async () => {
  const { createServer } = await import('node:http');
  const { once } = await import('node:events');
  const received = [];
  const target = createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    received.push({ headers: req.headers, body });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ result: {} }));
  });
  let source;
  const previous = process.env.TEST_MCP_REDIRECT_DUMMY;
  try {
    target.listen(0, '127.0.0.1');
    await once(target, 'listening');
    source = createServer(async (req, res) => {
      let body = '';
      for await (const part of req) body += part;
      assert.equal(req.headers['x-dummy-mcp-auth'], 'dummy-not-a-credential');
      assert.match(body, /dummy-private-argument/);
      res.writeHead(307, { location: `http://127.0.0.1:${target.address().port}/mcp` });
      res.end();
    });
    source.listen(0, '127.0.0.1');
    await once(source, 'listening');
    process.env.TEST_MCP_REDIRECT_DUMMY = 'dummy-not-a-credential';
    await assert.rejects(mcpRpc({
      url: `http://127.0.0.1:${source.address().port}/mcp`,
      headerEnv: { name: 'x-dummy-mcp-auth', env: 'TEST_MCP_REDIRECT_DUMMY' }
    }, 'tools/call', { name: 'repo.inspect', arguments: { dummy: 'dummy-private-argument' } }), /endpoint redirected/);
    assert.equal(received.length, 0);
  } finally {
    if (previous === undefined) delete process.env.TEST_MCP_REDIRECT_DUMMY;
    else process.env.TEST_MCP_REDIRECT_DUMMY = previous;
    for (const server of [source, target]) {
      if (server?.listening) {
        server.closeAllConnections();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    }
  }
});
