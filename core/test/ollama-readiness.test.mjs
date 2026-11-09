// Audit finding C6 (2026-11-09): the adapter answered /health 200 ok:true
// against an Ollama daemon with zero installed models while /execute failed
// 404. Liveness (daemon reachable) and readiness (default model installed with
// a digest, optional bounded inference) are now separate verdicts, and the
// deploy gate in scripts/ovh-core-health.sh probes /ready as well as /health.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

async function freePort() {
  const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  return port;
}

async function withAdapter(t, upstreamHandler, env = {}) {
  const upstream = http.createServer(upstreamHandler);
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const port = await freePort();
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/compute/ollama-adapter.mjs', import.meta.url))], {
    env: { ...process.env, MCCLUSTER_OLLAMA_ADAPTER_PORT: String(port), MCCLUSTER_OLLAMA_URL: `http://127.0.0.1:${upstream.address().port}`, MCCLUSTER_OLLAMA_MODEL: 'qwen3:8b', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await once(child.stdout, 'data');
  t.after(async () => {
    child.kill(); await once(child, 'exit');
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
  });
  const get = async path => { const r = await fetch(`http://127.0.0.1:${port}${path}`); return { status: r.status, body: await r.json() }; };
  return { get, port };
}

const json = (res, body, status = 200) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };

test('C6: a reachable daemon with zero installed models is live but NOT ready', { timeout: 15000 }, async t => {
  const { get, port } = await withAdapter(t, async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (req.url === '/api/tags') return json(res, { models: [] });
    if (req.url === '/api/chat') return json(res, { error: 'model "qwen3:8b" not found, try pulling it first' }, 404);
    return json(res, {});
  });
  const health = await get('/health');
  assert.equal(health.status, 200, 'liveness: daemon answers');
  assert.equal(health.body.ok, true);
  assert.equal(health.body.ready, false, 'liveness body must still say the model is unusable');
  assert.equal(health.body.model_installed, false);

  const ready = await get('/ready');
  assert.equal(ready.status, 503, 'readiness must fail with no installed default model');
  assert.equal(ready.body.ok, false);
  assert.equal(ready.body.daemon_reachable, true);
  assert.equal(ready.body.model_installed, false);
  assert.match(ready.body.error, /not installed/);

  const execute = await fetch(`http://127.0.0.1:${port}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capability: 'ai.chat', input: { prompt: 'hello' } }) });
  assert.equal(execute.status, 404, 'the audit observation: execution fails on this daemon');
});

test('readiness passes when the default model is installed with a digest, and inference probe is opt-in', { timeout: 15000 }, async t => {
  let chatCalls = 0;
  const handler = async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (req.url === '/api/tags') return json(res, { models: [{ name: 'qwen3:8b', digest: 'sha256:abc', size: 1 }] });
    if (req.url === '/api/chat') { chatCalls += 1; const body = JSON.parse(raw); assert.equal(body.options.num_predict, 1); return json(res, { message: { role: 'assistant', content: 'ok' }, done_reason: 'stop' }); }
    return json(res, {});
  };
  const plain = await withAdapter(t, handler);
  const ready = await plain.get('/ready');
  assert.equal(ready.status, 200);
  assert.deepEqual([ready.body.ok, ready.body.model_installed, ready.body.digest, ready.body.inference_probe], [true, true, 'sha256:abc', 'skipped']);
  assert.equal(chatCalls, 0, 'no inference without the explicit probe flag');
  assert.equal((await plain.get('/health')).body.ready, true);

  const probed = await withAdapter(t, handler, { MCCLUSTER_OLLAMA_READY_PROBE: 'true' });
  const first = await probed.get('/ready');
  assert.equal(first.status, 200);
  assert.equal(first.body.inference_probe, 'ok');
  assert.equal(chatCalls, 1);
  await probed.get('/ready');
  assert.equal(chatCalls, 1, 'probe result is cached briefly so repeated gate probes do not reload the model');
});

test('readiness with the inference probe fails when the daemon rejects the installed model', { timeout: 15000 }, async t => {
  const { get } = await withAdapter(t, async (req, res) => {
    for await (const _ of req) { /* drain */ }
    if (req.url === '/api/tags') return json(res, { models: [{ name: 'qwen3:8b', digest: 'sha256:abc' }] });
    if (req.url === '/api/chat') return json(res, { error: 'runner failed' }, 500);
    return json(res, {});
  }, { MCCLUSTER_OLLAMA_READY_PROBE: 'true' });
  const ready = await get('/ready');
  assert.equal(ready.status, 503);
  assert.equal(ready.body.model_installed, true);
  assert.equal(ready.body.inference_probe, 'failed');
});

test('an unreachable daemon fails both liveness and readiness', { timeout: 15000 }, async t => {
  const upstream = http.createServer(); upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const dead = upstream.address().port; await new Promise(resolve => upstream.close(resolve));
  const port = await freePort();
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/compute/ollama-adapter.mjs', import.meta.url))], { env: { ...process.env, MCCLUSTER_OLLAMA_ADAPTER_PORT: String(port), MCCLUSTER_OLLAMA_URL: `http://127.0.0.1:${dead}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  await once(child.stdout, 'data');
  t.after(async () => { child.kill(); await once(child, 'exit'); });
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 503);
  const ready = await fetch(`http://127.0.0.1:${port}/ready`);
  assert.equal(ready.status, 503);
  assert.equal((await ready.json()).daemon_reachable, false);
});

test('the shared deploy gate probes /ready after /health and the forward deploy gates on it', () => {
  const health = readFileSync(fileURLToPath(new URL('../../scripts/ovh-core-health.sh', import.meta.url)), 'utf8');
  const deploy = readFileSync(fileURLToPath(new URL('../../scripts/deploy-ovh-core.sh', import.meta.url)), 'utf8');
  assert.match(health, /MCC_ADAPTER_READY_URL="\$\{MCC_ADAPTER_READY_URL:-http:\/\/127\.0\.0\.1:4790\/ready\}"/);
  assert.match(health, /mcc_probe "\$\{MCC_ADAPTER_HEALTH_URL\}"[\s\S]*elif ! mcc_probe "\$\{MCC_ADAPTER_READY_URL\}"/);
  assert.match(deploy, /mcc_probe "\$\{MCC_ADAPTER_READY_URL\}"\nmcc_resume_producers/);
});
