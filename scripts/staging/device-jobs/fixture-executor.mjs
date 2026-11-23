// The staging worker's local executor: a loopback HTTP service standing where
// a real device runs its Ollama adapter (core/src/compute/ollama-adapter.mjs).
// It answers the same /ready and /execute contract and echoes the prompt, so
// the harness proves the fabric, the lease fence and the receipt without a
// model. Failure injection is a JSON control file the harness rewrites:
//   { "mode": "ok" | "fail-once" | "fail-always" | "hang", "delay_ms": 0 }
// Synthetic output is marked fixture:true and model "fixture-echo"; nothing
// here is evidence of inference on real hardware.
import http from 'node:http';
import fs from 'node:fs';

const PORT = Number(process.env.FIXTURE_EXECUTOR_PORT || 4790);
const CONTROL = process.env.FIXTURE_CONTROL_FILE || '';
const IMPLEMENTATION = process.env.FIXTURE_IMPLEMENTATION || 'fixture.echo.local';
let failures = 0;
let served = 0;

function control() {
  try { return CONTROL ? JSON.parse(fs.readFileSync(CONTROL, 'utf8')) : { mode: 'ok' }; }
  catch { return { mode: 'ok' }; }
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && (url.pathname === '/ready' || url.pathname === '/health')) {
    const implementation = url.searchParams.get('implementation');
    if (implementation && implementation !== IMPLEMENTATION) return json(res, 404, { ok: false, error: 'unknown implementation' });
    return json(res, 200, { ok: true, implementation: IMPLEMENTATION, fixture: true, served, gpu_evidence: null });
  }
  if (req.method === 'POST' && url.pathname === '/execute') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let task = {};
    try { task = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return json(res, 400, { error: 'invalid JSON' }); }
    const requested = control();
    const promptText = typeof (task.input || {}).prompt === 'string' ? task.input.prompt : '';
    // A failure injection can be bound to one job by a prompt fragment, so an
    // earlier queued job never consumes it.
    const mode = requested.match && !promptText.includes(String(requested.match)) ? { mode: 'ok' } : requested;
    if (mode.delay_ms) await new Promise((resolve) => setTimeout(resolve, Math.min(600_000, Number(mode.delay_ms) || 0)));
    if (mode.mode === 'hang') { await new Promise((resolve) => setTimeout(resolve, Math.min(600_000, Number(mode.hang_ms) || 120_000))); return json(res, 504, { error: 'fixture hang released' }); }
    if (mode.mode === 'fail-always' || (mode.mode === 'fail-once' && failures === 0)) {
      failures += 1;
      return json(res, 500, { error: `fixture executor failure (injected, attempt ${failures})` });
    }
    served += 1;
    const input = task.input || {};
    const prompt = typeof input.prompt === 'string' ? input.prompt : Array.isArray(input.messages) ? String(input.messages.at(-1)?.content ?? '') : '';
    const content = `ECHO: ${prompt}`;
    return json(res, 200, {
      model: 'fixture-echo',
      implementation: task.implementation || IMPLEMENTATION,
      content,
      message: { role: 'assistant', content },
      done_reason: 'stop',
      usage: { prompt_tokens: prompt.split(/\s+/).filter(Boolean).length, generation_tokens: content.split(/\s+/).length, generation_tokens_per_second: null },
      settings: { fixture: true },
      fixture: true,
      served_at: new Date().toISOString()
    });
  }
  json(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'fixture_executor_ready', port: PORT, implementation: IMPLEMENTATION, control: Boolean(CONTROL) }));
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
