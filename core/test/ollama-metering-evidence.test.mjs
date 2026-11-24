// /execute returns the model digest and the daemon version with the result:
// read from the same daemon after the generation, not from an earlier probe.
// (Contract: docs/control-plane/COMPUTE-CONTRIBUTION-LEDGER.md on branch
// prime/contribution-ledger; not in this tree.) fileURLToPath keeps this
// runnable from a Windows checkout whose path has a space.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const ADAPTER = fileURLToPath(new URL('../src/compute/ollama-adapter.mjs', import.meta.url));

async function withAdapter(handler, run) {
  const seen = [];
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    seen.push(req.url);
    res.setHeader('content-type', 'application/json');
    return handler(req, res, raw, seen);
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const env = { ...process.env, MCCLUSTER_OLLAMA_ADAPTER_PORT: String(port), MCCLUSTER_OLLAMA_URL: `http://127.0.0.1:${upstream.address().port}`, MCCLUSTER_OLLAMA_MODEL: 'qwen3:8b' };
  for (const key of ['MCCLUSTER_OLLAMA_IMPLEMENTATIONS', 'MCCLUSTER_OLLAMA_EXTRA_MODELS', 'MCCLUSTER_OLLAMA_WARM_ON_START', 'MCCLUSTER_OLLAMA_RESIDENT_MODELS', 'MCCLUSTER_OLLAMA_VISION_MODELS', 'MCCLUSTER_OLLAMA_THINK_MODELS']) delete env[key];
  const child = spawn(process.execPath, [ADAPTER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await once(child.stdout, 'data');
    const execute = () => fetch(`http://127.0.0.1:${port}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capability: 'ai.chat', input: { prompt: 'x' } }) });
    await run({ execute, seen });
  } finally {
    child.kill(); await once(child, 'exit');
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
  }
}

const chatAnswer = JSON.stringify({ message: { role: 'assistant', content: 'ok' }, done_reason: 'stop', eval_count: 4, eval_duration: 1e9, prompt_eval_count: 3, prompt_eval_duration: 1e9, total_duration: 3e9, load_duration: 1e9 });

test('/execute returns usage.model_digest and usage.ollama_version read from the same daemon after the generation', { timeout: 20000 }, async () => {
  // The daemon's digest for the tag changes when the generation happens: a digest read before the run
  // (a /health style probe) would be "sha256:before"; the one bound to the result must be "sha256:after".
  let generated = false;
  await withAdapter((req, res) => {
    if (req.url === '/api/chat') { generated = true; return res.end(chatAnswer); }
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen3:8b', model: 'qwen3:8b', digest: generated ? 'sha256:after' : 'sha256:before' }, { name: 'other:1b', digest: 'sha256:other' }] }));
    if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.12.9' }));
    return res.end('{}');
  }, async ({ execute, seen }) => {
    const response = await execute();
    assert.equal(response.status, 200);
    const out = await response.json();
    assert.equal(out.model, 'qwen3:8b');
    assert.equal(out.usage.model_digest, 'sha256:after', 'the digest is read after the generation, for the model that served it');
    assert.equal(out.usage.ollama_version, '0.12.9');
    assert.equal(out.usage.eval_count, 4, 'the raw counters are still there');
    assert.equal(out.usage.prompt_eval_count, 3);
    const chat = seen.indexOf('/api/chat');
    assert.ok(chat >= 0);
    assert.ok(seen.indexOf('/api/tags', chat) > chat, '/api/tags is read after /api/chat');
    assert.ok(seen.indexOf('/api/version', chat) > chat, '/api/version is read after /api/chat');
    assert.equal(seen.slice(0, chat).includes('/api/tags'), false, 'no digest probe before the generation is involved');
  });
});

test('/execute still succeeds with null evidence when the daemon cannot say', { timeout: 20000 }, async () => {
  await withAdapter((req, res) => {
    if (req.url === '/api/chat') return res.end(chatAnswer);
    res.statusCode = 500; return res.end('{}');
  }, async ({ execute }) => {
    const response = await execute();
    assert.equal(response.status, 200, 'missing evidence is never a failed execution');
    const out = await response.json();
    assert.equal(out.content, 'ok');
    assert.equal(out.usage.model_digest, null);
    assert.equal(out.usage.ollama_version, null);
  });
});

test('/execute reports a null digest when the tag list does not name the model that served the run', { timeout: 20000 }, async () => {
  await withAdapter((req, res) => {
    if (req.url === '/api/chat') return res.end(chatAnswer);
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'other:1b', digest: 'sha256:other' }] }));
    if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.12.9' }));
    return res.end('{}');
  }, async ({ execute }) => {
    const out = await (await execute()).json();
    assert.equal(out.usage.model_digest, null, 'never another model\'s digest');
    assert.equal(out.usage.ollama_version, '0.12.9');
  });
});
