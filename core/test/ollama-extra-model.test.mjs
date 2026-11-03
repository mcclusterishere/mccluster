import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function withAdapter({ installed }, run) {
  const requests = [];
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/chat') {
      const body = JSON.parse(raw); requests.push(body);
      if (!installed.includes(body.model)) { res.statusCode = 404; return res.end(JSON.stringify({ error: `model "${body.model}" not found, try pulling it first` })); }
      return res.end(JSON.stringify({ message: { role: 'assistant', content: '{"ok":true}' }, done_reason: 'stop', eval_count: 4, eval_duration: 1e9, prompt_eval_count: 4, prompt_eval_duration: 1e9 }));
    }
    res.end('{}');
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [new URL('../src/compute/ollama-adapter.mjs', import.meta.url).pathname], { env: { ...process.env, MCCLUSTER_OLLAMA_ADAPTER_PORT: String(port), MCCLUSTER_OLLAMA_URL: `http://127.0.0.1:${upstream.address().port}`, MCCLUSTER_OLLAMA_EXTRA_MODELS: 'fast:4b' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await once(child.stdout, 'data');
    const call = input => fetch(`http://127.0.0.1:${port}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capability: 'ai.chat', input }) }).then(r => r.json());
    await run({ call, requests });
  } finally {
    child.kill(); await once(child, 'exit');
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
  }
}

test('an allowlisted extra model is used without the thinking flag, with a JSON Schema format', { timeout: 15000 }, async () => {
  await withAdapter({ installed: ['qwen3:8b', 'fast:4b'] }, async ({ call, requests }) => {
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    const out = await call({ prompt: 'x', model: 'fast:4b', schema, num_ctx: 4096 });
    assert.equal(out.model, 'fast:4b');
    assert.equal('think' in requests[0], false);
    assert.deepEqual(requests[0].format, schema);
    assert.equal(requests[0].options.num_ctx, 16384);
    const other = await call({ prompt: 'x', model: 'not-allowed:70b' });
    assert.equal(other.model, 'qwen3:8b');
    assert.equal(requests[1].model, 'qwen3:8b');
    assert.equal(requests[1].think, false);
  });
});

test('a missing extra model falls back to the default model and says so', { timeout: 15000 }, async () => {
  await withAdapter({ installed: ['qwen3:8b'] }, async ({ call, requests }) => {
    const out = await call({ prompt: 'x', model: 'fast:4b' });
    assert.equal(out.model, 'qwen3:8b');
    assert.equal(out.fallback_from, 'fast:4b');
    assert.deepEqual(requests.map(r => r.model), ['fast:4b', 'qwen3:8b']);
  });
});
