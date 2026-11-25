import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { inferenceFetch, inferenceJson, inferenceError } from '../src/compute/inference-http.mjs';
import { localAiChat } from '../src/compute/local-ai-client.mjs';

async function fixture(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('inference transport allows delayed headers and preserves POST JSON', async t => {
  const url = await fixture(t, async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), { synthetic: true });
    setTimeout(() => res.end('{"ok":true}'), 80);
  });
  const response = await inferenceFetch(url, { method: 'POST', body: '{"synthetic":true}', signal: AbortSignal.timeout(2000) });
  assert.equal(response.ok, true);
  assert.deepEqual(await inferenceJson(response), { ok: true });
});

for (const phase of ['headers', 'body']) {
  test(`deadline bounds the ${phase} wait and closes the upstream connection`, async t => {
    let closed;
    const disconnected = new Promise(resolve => { closed = resolve; });
    const url = await fixture(t, (req, res) => {
      req.resume();
      res.once('close', closed);
      if (phase === 'body') { res.writeHead(200); res.write('{'); }
    });
    const signal = AbortSignal.timeout(150);
    await assert.rejects(inferenceFetch(url, { signal }), error => {
      const safe = inferenceError(error, { signal });
      assert.equal(safe.code, 'LOCAL_AI_TIMEOUT');
      assert.equal(safe.status, 504);
      assert.equal(safe.retryable, true);
      return true;
    });
    await disconnected;
  });
}

test('caller abort is distinct from timeout and never reveals the abort reason', async t => {
  const controller = new AbortController();
  const url = await fixture(t, (req, res) => {
    req.resume();
    controller.abort(new Error('secret-prompt-token'));
  });
  await assert.rejects(inferenceFetch(url, { signal: controller.signal }), error => {
    const safe = inferenceError(error, { signal: controller.signal });
    assert.equal(safe.code, 'CALLER_ABORTED'); assert.equal(safe.retryable, false);
    assert.doesNotMatch(safe.message, /secret-prompt-token/);
    return true;
  });
});

test('an already cancelled request is never sent', async t => {
  let calls = 0;
  const url = await fixture(t, (req, res) => { calls++; res.end('{}'); });
  await assert.rejects(inferenceFetch(url, { signal: AbortSignal.abort() }));
  assert.equal(calls, 0);
});

for (const declared of [false, true]) {
  test(`response byte bound rejects ${declared ? 'declared' : 'chunked'} oversize data`, async t => {
    const url = await fixture(t, (req, res) => {
      req.resume();
      if (declared) res.setHeader('content-length', 100);
      res.end('x'.repeat(100));
    });
    await assert.rejects(inferenceFetch(url, { signal: AbortSignal.timeout(2000), maxBytes: 32 }), { code: 'INFERENCE_RESPONSE_TOO_LARGE' });
  });
}

test('partial body transport failure cannot become empty JSON success', async t => {
  const url = await fixture(t, (req, res) => {
    req.resume(); res.write('{'); setImmediate(() => res.destroy());
  });
  await assert.rejects(inferenceFetch(url, { signal: AbortSignal.timeout(2000) }));
});

test('transport does not follow redirects or send the request to another destination', async t => {
  let redirected = 0;
  const target = await fixture(t, (req, res) => { redirected++; res.end('{}'); });
  const url = await fixture(t, (req, res) => { req.resume(); res.writeHead(307, { location: target }); res.end('{}'); });
  const response = await inferenceFetch(url, { signal: AbortSignal.timeout(2000) });
  assert.equal(response.status, 307); assert.equal(response.ok, false); assert.equal(redirected, 0);
});

test('inference transport requires a caller-owned cancellation budget', () => {
  assert.throws(() => inferenceFetch('http://127.0.0.1:1'), /bounded cancellation signal/);
});

test('local client classifies nested network errors without logging URLs or private messages', async () => {
  await assert.rejects(localAiChat({ prompt: 'synthetic' }, {
    fetchImpl: async () => { throw new TypeError('secret URL', { cause: Object.assign(new Error('private'), { code: 'ECONNREFUSED' }) }); },
  }), error => {
    assert.equal(error.code, 'ECONNREFUSED'); assert.equal(error.retryable, true);
    assert.equal(error.message, 'Local AI adapter transport failed (ECONNREFUSED)');
    return true;
  });
});

for (const body of ['{', 'null', '[]']) {
  test(`local client rejects malformed or non-object JSON ${body}`, async () => {
    await assert.rejects(localAiChat({ prompt: 'synthetic' }, {
      fetchImpl: async () => new Response(body),
    }), { code: 'INFERENCE_INVALID_RESPONSE' });
  });
}

test('local client forwards caller cancellation and does not swallow body abort errors', async () => {
  const controller = new AbortController();
  await assert.rejects(localAiChat({ prompt: 'synthetic', signal: controller.signal }, {
    fetchImpl: async (_url, { signal }) => ({
      json: async () => {
        controller.abort(new Error('private-reason'));
        assert.equal(signal.aborted, true);
        throw signal.reason;
      },
    }),
  }), { code: 'CALLER_ABORTED', retryable: false });
});

test('local client preserves controlled adapter codes but never upstream error text', async () => {
  await assert.rejects(localAiChat({ prompt: 'synthetic' }, {
    fetchImpl: async () => new Response(JSON.stringify({ error: 'secret prompt', code: 'OLLAMA_TIMEOUT' }), { status: 504 }),
  }), error => {
    assert.equal(error.code, 'OLLAMA_TIMEOUT'); assert.equal(error.retryable, true);
    assert.doesNotMatch(error.message, /secret/); return true;
  });
});
