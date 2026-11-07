import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { inferenceFetch } from '../src/compute/inference-http.mjs';

function adapterReady(child, diagnostic) {
  return new Promise((resolve, reject) => {
    let output = '';
    const finish = (error, ready) => {
      clearTimeout(timer);
      child.stdout.off('data', data); child.off('error', failed); child.off('exit', exited);
      if (error) reject(error); else resolve(ready);
    };
    const failed = error => finish(new Error(`adapter startup failed: ${error.message}; ${diagnostic()}`));
    const exited = (code, signal) => failed(new Error(`exit=${code} signal=${signal}`));
    const data = chunk => {
      output += chunk;
      if (output.length > 4096) return failed(new Error('readiness output exceeds fixture bound'));
      const lines = output.split('\n'); output = lines.pop();
      for (const line of lines) {
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.event !== 'ollama_adapter_ready') continue;
        if (message.host !== '127.0.0.1' || !Number.isInteger(message.port) || message.port < 1 || message.port > 65535) {
          return failed(new Error('invalid bound address in readiness event'));
        }
        return finish(null, message);
      }
    };
    const timer = setTimeout(() => failed(new Error('no readiness event within 3000ms')), 3000);
    child.stdout.on('data', data); child.once('error', failed); child.once('exit', exited);
    if (child.exitCode !== null || child.signalCode !== null) exited(child.exitCode, child.signalCode);
  });
}

async function stopAdapter(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  // Attach before signaling: a fast exit must not be missed by teardown.
  const exited = once(child, 'exit', { signal: AbortSignal.timeout(1000) });
  child.kill();
  try { await exited; } catch (error) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const killed = once(child, 'exit', { signal: AbortSignal.timeout(1000) });
    child.kill('SIGKILL'); await killed;
    throw new Error('adapter fixture required forced shutdown', { cause: error });
  }
}

async function withAdapter(t, handler, env = {}) {
  let child, stderr = '', phase = 'upstream startup';
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (req.url !== '/api/chat') { res.end('{}'); return; }
    await handler(JSON.parse(raw), res);
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(async () => {
    t.diagnostic(`adapter fixture cleanup: phase=${phase}; exit=${child?.exitCode}; signal=${child?.signalCode}; stderr=${stderr || '<empty>'}`);
    try { await stopAdapter(child); } finally {
      // Stop accepting first, then close sockets. No late health connection can
      // slip between closeAllConnections and close and strand the cleanup hook.
      const closed = new Promise(resolve => upstream.close(resolve));
      upstream.closeAllConnections(); await closed;
    }
  });
  phase = 'adapter startup';
  child = spawn(process.execPath, [new URL('../src/compute/ollama-adapter.mjs', import.meta.url).pathname], {
    env: { ...process.env, MCCLUSTER_OLLAMA_ADAPTER_PORT: '0', MCCLUSTER_OLLAMA_URL: `http://127.0.0.1:${upstream.address().port}`, MCCLUSTER_OLLAMA_ADAPTER_TIMEOUT_MS: '3000', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
  const ready = await adapterReady(child, () => stderr);
  phase = 'ready';
  const url = `http://127.0.0.1:${ready.port}`;
  const call = async (prompt = 'synthetic', signal = AbortSignal.timeout(5000), extra = {}) => {
    phase = `execute ${prompt}`;
    const response = await inferenceFetch(`${url}/execute`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal,
      body: JSON.stringify({ capability: 'ai.chat', input: { prompt, ...extra } }),
    });
    const result = { status: response.status, body: await response.json() };
    phase = `execute ${prompt} completed`; return result;
  };
  const health = async () => {
    phase = 'health';
    const result = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) }).then(r => r.json());
    phase = 'health completed'; return result;
  };
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

test('adapter fixture reports an occupied-port startup failure instead of waiting forever', { timeout: 10000 }, async t => {
  const occupied = http.createServer(); occupied.listen(0, '127.0.0.1'); await once(occupied, 'listening');
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  await assert.rejects(withAdapter(t, (_body, res) => res.end('{}'), {
    MCCLUSTER_OLLAMA_ADAPTER_PORT: String(occupied.address().port),
  }), /adapter startup.*EADDRINUSE/s);
});


test('concurrent adapter fixtures report distinct OS-assigned ports and serve real requests', { timeout: 10000 }, async t => {
  const adapters = await Promise.all([0, 1].map(i => withAdapter(t, (_body, res) => res.end(JSON.stringify({message:{content:String(i)}})))));
  assert.notEqual(adapters[0].url, adapters[1].url);
  const responses = await Promise.all(adapters.map(a => a.call()));
  assert.deepEqual(responses.map(r => [r.status, r.body.content]), [[200, '0'], [200, '1']]);
});
