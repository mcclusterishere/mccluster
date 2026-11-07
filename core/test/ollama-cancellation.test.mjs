import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { inferenceFetch } from '../src/compute/inference-http.mjs';

async function withAdapter(t, handler, env = {}) {
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (req.url !== '/api/chat') { res.end('{}'); return; }
    await handler(JSON.parse(raw), res);
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(async () => { upstream.closeAllConnections(); await new Promise(r => upstream.close(r)); });
  const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(r => reservation.close(r));
  const child = spawn(process.execPath, [new URL('../src/compute/ollama-adapter.mjs', import.meta.url).pathname], {
    env: { ...process.env, MCCLUSTER_OLLAMA_ADAPTER_PORT: String(port), MCCLUSTER_OLLAMA_URL: `http://127.0.0.1:${upstream.address().port}`, MCCLUSTER_OLLAMA_ADAPTER_TIMEOUT_MS: '3000', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  await once(child.stdout, 'data');
  const url = `http://127.0.0.1:${port}`;
  const call = async (prompt = 'synthetic', signal = AbortSignal.timeout(5000), extra = {}) => {
    const response = await inferenceFetch(`${url}/execute`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal,
      body: JSON.stringify({ capability: 'ai.chat', input: { prompt, ...extra } }),
    });
    return { status: response.status, body: await response.json() };
  };
  const health = () => fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) }).then(r => r.json());
  return { call, health, url };
}

async function eventually(read, predicate) {
  const end = Date.now() + 3000;
  while (Date.now() < end) { const result = await read(); if (predicate(result)) return result; await delay(10); }
  assert.fail('condition not reached in three seconds');
}

test('adapter enforces upstream deadline, releases slot, and exposes a safe timeout reason', { timeout: 10000 }, async t => {
  let closed = false;
  const { call, health } = await withAdapter(t, (body, res) => {
    if (body.messages[0].content === 'hold') { res.once('close', () => { closed = true; }); return; }
    res.end('{"message":{"content":"ok"}}');
  }, { MCCLUSTER_OLLAMA_ADAPTER_TIMEOUT_MS: '150' });
  const failure = await call('hold');
  assert.equal(failure.status, 504); assert.equal(failure.body.code, 'OLLAMA_TIMEOUT');
  await eventually(async () => closed, Boolean);
  const healthBeforeSuccess = await health();
  assert.equal(healthBeforeSuccess.busy, false);
  assert.equal(healthBeforeSuccess.last_error, 'Ollama request deadline exceeded');
  assert.equal((await call()).body.content, 'ok');
});

test('queued cancellation frees capacity; active cancellation stops upstream and preserves one slot', { timeout: 10000 }, async t => {
  const seen = [];
  let active = 0; let maximum = 0;
  const { call, health } = await withAdapter(t, (body, res) => {
    const prompt = body.messages[0].content;
    seen.push(prompt); active++; maximum = Math.max(maximum, active);
    res.once('close', () => { active--; });
    if (prompt !== 'hold') res.end('{"message":{"content":"ok"}}');
  }, { MCCLUSTER_OLLAMA_ADAPTER_MAX_QUEUE: '1' });
  const controller = new AbortController();
  const held = call('hold', controller.signal).catch(error => error);
  await eventually(health, result => result.busy);
  const queuedController = new AbortController();
  const queued = call('cancelled-queue', queuedController.signal).catch(error => error);
  await eventually(health, result => result.queue_depth === 1);
  const overflow = await call('overflow');
  assert.equal(overflow.status, 503); assert.equal(overflow.body.code, 'AI_QUEUE_FULL');
  queuedController.abort(); await queued;
  await eventually(health, result => result.queue_depth === 0);
  const replacement = call('replacement');
  await eventually(health, result => result.queue_depth === 1);
  controller.abort(); await held;
  assert.equal((await replacement).body.content, 'ok');
  await eventually(health, result => !result.busy && result.queue_depth === 0);
  assert.deepEqual(seen, ['hold', 'replacement']); assert.equal(maximum, 1);
});

test('fallback shares the original deadline rather than getting a fresh budget', { timeout: 10000 }, async t => {
  const seen = [];
  const { call } = await withAdapter(t, async (body, res) => {
    seen.push(body.model);
    await delay(250);
    if (body.model === 'synthetic:extra') { res.statusCode = 404; res.end('{"error":"not found"}'); }
    else res.end('{"message":{"content":"too late"}}');
  }, { MCCLUSTER_OLLAMA_EXTRA_MODELS: 'synthetic:extra', MCCLUSTER_OLLAMA_ADAPTER_TIMEOUT_MS: '400' });
  const result = await call('synthetic', undefined, { model: 'synthetic:extra' });
  assert.equal(result.status, 504); assert.equal(result.body.code, 'OLLAMA_TIMEOUT');
  assert.deepEqual(seen, ['synthetic:extra', 'qwen3:8b']);
});

test('adapter rejects malformed and partial upstream bodies instead of returning empty success', { timeout: 10000 }, async t => {
  const { call, health } = await withAdapter(t, (body, res) => {
    if (body.messages[0].content === 'partial') { res.write('{'); setImmediate(() => res.destroy()); }
    else res.end('{"private invalid content');
  });
  const malformed = await call('malformed');
  assert.equal(malformed.status, 502); assert.equal(malformed.body.code, 'INFERENCE_INVALID_RESPONSE');
  assert.doesNotMatch(JSON.stringify(malformed.body), /private/);
  const partial = await call('partial');
  assert.equal(partial.status, 502); assert.equal(partial.body.code, 'ECONNRESET');
  assert.equal((await health()).busy, false);
});

test('adapter does not expose upstream error bodies in response or health', { timeout: 10000 }, async t => {
  const { call, health } = await withAdapter(t, (_body, res) => {
    res.statusCode = 500; res.end('{"error":"private prompt and token"}');
  });
  const result = await call();
  assert.equal(result.status, 500); assert.equal(result.body.code, 'OLLAMA_UPSTREAM_ERROR');
  assert.equal(result.body.error, 'Ollama returned HTTP 500');
  assert.doesNotMatch(JSON.stringify(await health()), /private prompt|token/);
});

test('real local client can cancel both hops without leaving the adapter occupied', { timeout: 10000 }, async t => {
  let started = false; let closed = false;
  const { url, health } = await withAdapter(t, (_body, res) => {
    started = true; res.once('close', () => { closed = true; });
  });
  const previous = process.env.MCCLUSTER_OLLAMA_ADAPTER_URL;
  process.env.MCCLUSTER_OLLAMA_ADAPTER_URL = url;
  let localAiChat;
  try { ({ localAiChat } = await import(`../src/compute/local-ai-client.mjs?test=${Date.now()}`)); }
  finally {
    if (previous === undefined) delete process.env.MCCLUSTER_OLLAMA_ADAPTER_URL;
    else process.env.MCCLUSTER_OLLAMA_ADAPTER_URL = previous;
  }
  const controller = new AbortController();
  const request = localAiChat({ prompt: 'synthetic', signal: controller.signal });
  const rejection = assert.rejects(request, { code: 'CALLER_ABORTED', retryable: false });
  await eventually(async () => started, Boolean);
  controller.abort(); await rejection;
  await eventually(async () => closed, Boolean);
  await eventually(health, result => !result.busy && result.queue_depth === 0);
});
