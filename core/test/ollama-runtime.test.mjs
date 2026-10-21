import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('real adapter HTTP contract preserves tool calls, explicit settings and measured runtime', { timeout: 15000 }, async () => {
  let request;
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const responses = {
      '/api/version': { version: 'test-version' },
      '/api/tags': { models: [{ name: 'qwen3:8b', digest: 'sha256:test', size: 123 }] },
      '/api/show': { details: { quantization_level: 'Q4_K_M' }, capabilities: ['completion', 'tools', 'thinking'], model_info: { 'qwen3.context_length': 40960 } },
      '/api/ps': { models: [{ name: 'qwen3:8b', size_vram: 0, context_length: 16384 }] },
    };
    if (req.url === '/api/chat') {
      request = JSON.parse(raw);
      responses[req.url] = { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'operations_read', arguments: {} } }] }, done_reason: 'stop', total_duration: 3e9, load_duration: 1e9, prompt_eval_duration: 1e9, eval_duration: 1e9, prompt_eval_count: 20, eval_count: 10 };
    }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(responses[req.url] || {}));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [new URL('../src/compute/ollama-adapter.mjs', import.meta.url).pathname], { env: { ...process.env, MCCLUSTER_OLLAMA_ADAPTER_PORT: String(port), MCCLUSTER_OLLAMA_URL: `http://127.0.0.1:${upstream.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await once(child.stdout, 'data');
    const result = await fetch(`http://127.0.0.1:${port}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capability: 'ai.chat', input: { prompt: 'Check operations', tools: [{ type: 'function', function: { name: 'operations_read', parameters: { type: 'object' } } }] } }) }).then(r => r.json());
    assert.equal(request.think, false);
    assert.equal(request.keep_alive, '30m');
    assert.equal(request.options.num_predict, 1024);
    assert.equal(request.options.num_ctx, 16384);
    assert.equal(request.tools[0].function.name, 'operations_read');
    assert.equal(result.tool_calls[0].function.name, 'operations_read');
    assert.equal(result.usage.generation_tokens_per_second, 10);
    const diagnostics = await fetch(`http://127.0.0.1:${port}/diagnostics`).then(r => r.json());
    assert.equal(diagnostics.ollama_version, 'test-version');
    assert.equal(diagnostics.digest, 'sha256:test');
    assert.equal(diagnostics.running[0].size_vram, 0);
    assert.equal(diagnostics.details.quantization_level, 'Q4_K_M');
  } finally {
    child.kill(); await once(child, 'exit');
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
  }
});
