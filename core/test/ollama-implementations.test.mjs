// The adapter's implementation -> model map (MCCLUSTER_OLLAMA_IMPLEMENTATIONS),
// the think rule, per-implementation readiness, engine evidence from /api/ps
// and warm-on-start, all against a fake Ollama daemon on loopback.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ADAPTER = fileURLToPath(new URL('../src/compute/ollama-adapter.mjs', import.meta.url));
const MAP = 'qwen3.8b.local=qwen3:8b,qwen3.14b.local=qwen3:14b,small.local=qwen3:4b-instruct-2507';

function fakeOllama(state) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ url: req.url, body });
    const json = (status, payload) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(payload)); };
    if (req.url === '/api/tags') return json(200, { models: state.installed.map((name) => ({ name, model: name, digest: `sha256:${name}`, size: 100 })) });
    if (req.url === '/api/ps') return state.psStatus ? json(state.psStatus, { error: 'ps failed' }) : json(200, { models: state.running || [] });
    if (req.url === '/api/chat') {
      if (!state.installed.includes(body.model)) return json(404, { error: `model "${body.model}" not found, try pulling it first` });
      return json(200, { message: { role: 'assistant', content: `from ${body.model}` }, done_reason: 'stop', eval_count: 4, eval_duration: 1e9, prompt_eval_count: 4, prompt_eval_duration: 1e9 });
    }
    if (req.url === '/api/pull') return json(200, { status: 'success' });
    if (req.url === '/api/version') return json(200, { version: 'test-version' });
    if (req.url === '/api/show') return json(200, { details: {}, capabilities: ['completion'] });
    return json(200, {});
  });
  return { server, requests };
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

// Spawns the adapter on an OS-assigned port and resolves once the FIRST stdout
// line is the ready event; stdout keeps accumulating for later assertions.
async function withAdapter(t, state, env = {}) {
  const { server, requests } = fakeOllama(state);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const child = spawn(process.execPath, [ADAPTER], {
    env: { ...process.env, MCCLUSTER_OLLAMA_ADAPTER_PORT: '0', MCCLUSTER_OLLAMA_URL: `http://127.0.0.1:${server.address().port}`, MCCLUSTER_OLLAMA_MODEL: 'qwen3:8b', MCCLUSTER_OLLAMA_ADAPTER_TIMEOUT_MS: '5000', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const output = { stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => { output.stdout += chunk; });
  child.stderr.on('data', (chunk) => { output.stderr += chunk; });
  t.after(async () => {
    await stop(child);
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections(); await closed;
  });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ready line within 5 s; stderr=${output.stderr}`)), 5000);
    const check = () => {
      const first = output.stdout.split('\n')[0];
      if (!first || !output.stdout.includes('\n')) return;
      clearTimeout(timer); child.stdout.off('data', check);
      try {
        const message = JSON.parse(first);
        assert.equal(message.event, 'ollama_adapter_ready', 'the ready event stays the first stdout line');
        resolve(message);
      } catch (error) { reject(error); }
    };
    child.stdout.on('data', check);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`adapter exited ${code}; stderr=${output.stderr}`)); });
  });
  const url = `http://127.0.0.1:${ready.port}`;
  const get = async (path) => { const r = await fetch(`${url}${path}`); return { status: r.status, body: await r.json() }; };
  const post = async (path, body) => { const r = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const chats = () => requests.filter((r) => r.url === '/api/chat').map((r) => r.body);
  const events = () => output.stdout.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  return { url, get, post, requests, chats, events, output, child };
}

async function eventually(read, predicate, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await read(); if (predicate(value)) return value; await delay(20); }
  assert.fail('condition not reached in time');
}

test('the implementation decides the model, then an allowlisted input.model, then the default; think follows the qwen3 non-instruct family', { timeout: 15000 }, async (t) => {
  const a = await withAdapter(t, { installed: ['qwen3:8b', 'qwen3:14b', 'qwen3:4b-instruct-2507'] }, { MCCLUSTER_OLLAMA_IMPLEMENTATIONS: MAP });
  const fourteen = await a.post('/execute', { capability: 'ai.chat', implementation: 'qwen3.14b.local', input: { prompt: 'x' } });
  assert.equal(fourteen.status, 200);
  assert.equal(fourteen.body.model, 'qwen3:14b');
  assert.equal(fourteen.body.model_source, 'implementation');
  assert.equal(fourteen.body.implementation, 'qwen3.14b.local');
  assert.equal(fourteen.body.content, 'from qwen3:14b');
  assert.equal(a.chats()[0].model, 'qwen3:14b');
  assert.equal(a.chats()[0].think, false, 'qwen3:14b is a thinking model: the key is sent (false unless asked)');
  assert.equal(a.chats()[0].keep_alive, '5m', 'a mapped model is on demand unless listed as resident');

  const byInput = await a.post('/execute', { capability: 'ai.chat', implementation: 'unmapped.local', input: { prompt: 'x', model: 'qwen3:14b' } });
  assert.equal(byInput.body.model, 'qwen3:14b');
  assert.equal(byInput.body.model_source, 'input');

  const plain = await a.post('/execute', { capability: 'ai.chat', input: { prompt: 'x' } });
  assert.equal(plain.body.model, 'qwen3:8b');
  assert.equal(plain.body.model_source, 'default');
  assert.equal(a.chats()[2].think, false);
  assert.equal(a.chats()[2].keep_alive, '24h');

  const refused = await a.post('/execute', { capability: 'ai.chat', input: { prompt: 'x', model: 'not-allowed:70b' } });
  assert.equal(refused.body.model, 'qwen3:8b');
  assert.equal(refused.body.model_source, 'default');

  const instruct = await a.post('/execute', { capability: 'ai.chat', implementation: 'small.local', input: { prompt: 'x', think: true } });
  assert.equal(instruct.body.model, 'qwen3:4b-instruct-2507');
  assert.equal('think' in a.chats()[4], false, 'instruct-only builds reject the think flag');

  const missing = await a.post('/execute', { capability: 'ai.chat', implementation: 'qwen3.14b.local', input: { prompt: 'x' } });
  assert.equal(missing.status, 200, 'the installed mapped model keeps answering');
  const other = await a.post('/execute', { capability: 'image.generate', input: { prompt: 'x' } });
  assert.equal(other.status, 400);
  assert.equal(other.body.code, 'UNSUPPORTED_CAPABILITY');
});

test('a missing mapped model falls back to the default model and says so', { timeout: 15000 }, async (t) => {
  const a = await withAdapter(t, { installed: ['qwen3:8b'] }, { MCCLUSTER_OLLAMA_IMPLEMENTATIONS: MAP });
  const out = await a.post('/execute', { capability: 'ai.chat', implementation: 'qwen3.14b.local', input: { prompt: 'x' } });
  assert.equal(out.body.model, 'qwen3:8b');
  assert.equal(out.body.fallback_from, 'qwen3:14b');
  assert.equal(out.body.model_source, 'implementation');
  assert.deepEqual(a.chats().map((c) => c.model), ['qwen3:14b', 'qwen3:8b']);
});

test('MCCLUSTER_OLLAMA_THINK_MODELS is the exact think set when given', { timeout: 15000 }, async (t) => {
  const a = await withAdapter(t, { installed: ['qwen3:8b', 'qwen3:14b'] }, { MCCLUSTER_OLLAMA_IMPLEMENTATIONS: MAP, MCCLUSTER_OLLAMA_THINK_MODELS: 'qwen3:8b' });
  await a.post('/execute', { capability: 'ai.chat', implementation: 'qwen3.14b.local', input: { prompt: 'x' } });
  await a.post('/execute', { capability: 'ai.chat', input: { prompt: 'x' } });
  assert.equal('think' in a.chats()[0], false);
  assert.equal(a.chats()[1].think, false);
});

test('/ready?implementation= answers per entry; plain /ready keeps its verdict and lists the map', { timeout: 15000 }, async (t) => {
  const a = await withAdapter(t, { installed: ['qwen3:8b'] }, { MCCLUSTER_OLLAMA_IMPLEMENTATIONS: MAP });
  const eight = await a.get('/ready?implementation=qwen3.8b.local');
  assert.equal(eight.status, 200);
  assert.deepEqual([eight.body.ok, eight.body.daemon_reachable, eight.body.implementation, eight.body.model, eight.body.model_installed, eight.body.digest, eight.body.inference_probe, eight.body.error],
    [true, true, 'qwen3.8b.local', 'qwen3:8b', true, 'sha256:qwen3:8b', 'skipped', null]);
  assert.equal(eight.body.busy, false);
  assert.equal(eight.body.queue_depth, 0);
  assert.equal('gpu_evidence' in eight.body, true);

  const fourteen = await a.get('/ready?implementation=qwen3.14b.local');
  assert.equal(fourteen.status, 503, 'a model that is not pulled yet keeps only its own entry down');
  assert.deepEqual([fourteen.body.ok, fourteen.body.daemon_reachable, fourteen.body.implementation, fourteen.body.model, fourteen.body.model_installed, fourteen.body.digest], [false, true, 'qwen3.14b.local', 'qwen3:14b', false, null]);
  assert.match(fourteen.body.error, /not installed/);

  const unknown = await a.get('/ready?implementation=nope.local');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, 'UNKNOWN_IMPLEMENTATION');
  assert.equal(unknown.body.implementation, 'nope.local');

  const plain = await a.get('/ready');
  assert.equal(plain.status, 200);
  assert.equal(plain.body.ok, true);
  assert.equal(plain.body.model, 'qwen3:8b');
  assert.deepEqual(plain.body.implementations, [
    { implementation: 'qwen3.8b.local', model: 'qwen3:8b', installed: true, digest: 'sha256:qwen3:8b', vision: false },
    { implementation: 'qwen3.14b.local', model: 'qwen3:14b', installed: false, digest: null, vision: false },
    { implementation: 'small.local', model: 'qwen3:4b-instruct-2507', installed: false, digest: null, vision: false }
  ]);

  const health = await a.get('/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.implementations.length, 3);
  assert.equal(health.body.ready, true);
  assert.equal(health.body.service, 'mccluster-ollama-adapter');

  const diagnostics = await a.get('/diagnostics');
  assert.equal(diagnostics.status, 200);
  assert.deepEqual(diagnostics.body.implementations[1], { implementation: 'qwen3.14b.local', model: 'qwen3:14b', installed: false, running: false, vision: false });
  assert.equal('gpu_evidence' in diagnostics.body, true);
});

test('without a map, /ready?implementation= is unknown and the lists are empty', { timeout: 15000 }, async (t) => {
  const a = await withAdapter(t, { installed: ['qwen3:8b'] });
  assert.equal((await a.get('/ready?implementation=qwen3.8b.local')).status, 404);
  const plain = await a.get('/ready');
  assert.equal(plain.status, 200);
  assert.deepEqual(plain.body.implementations, []);
  assert.deepEqual((await a.get('/health')).body.implementations, []);
});

test('gpu_evidence is read from /api/ps, cached, and honest about CPU loads and failures', { timeout: 15000 }, async (t) => {
  const gpu = await withAdapter(t, { installed: ['qwen3:8b'], running: [{ name: 'qwen3:8b', model: 'qwen3:8b', size: 5_600_000_000, size_vram: 5_600_000_000 }] });
  const health = await gpu.get('/health');
  const evidence = health.body.gpu_evidence;
  assert.equal(evidence.source, 'ollama:/api/ps');
  assert.equal(evidence.model, 'qwen3:8b');
  assert.equal(evidence.size_vram_bytes, 5_600_000_000);
  assert.equal(evidence.size_bytes, 5_600_000_000);
  assert.equal(evidence.processor_gpu_percent, 100);
  assert.equal(evidence.running_models, 1);
  assert.ok(Number.isFinite(Date.parse(evidence.checked_at)));
  await gpu.get('/health');
  await gpu.get('/ready');
  assert.equal(gpu.requests.filter((r) => r.url === '/api/ps').length, 1, 'one /api/ps read per cache window, never a generation');
  assert.equal(gpu.requests.filter((r) => r.url === '/api/chat').length, 0);

  const split = await withAdapter(t, { installed: ['qwen3:8b'], running: [{ name: 'qwen3:8b', size: 1000, size_vram: 250 }, { name: 'qwen3:14b', size: 9000, size_vram: 0 }] });
  const splitEvidence = (await split.get('/ready')).body.gpu_evidence;
  assert.equal(splitEvidence.model, 'qwen3:8b', 'the model with the most VRAM is the observation');
  assert.equal(splitEvidence.processor_gpu_percent, 25);
  assert.equal(splitEvidence.running_models, 2);

  const idle = await withAdapter(t, { installed: ['qwen3:8b'], running: [] });
  const idleEvidence = (await idle.get('/health')).body.gpu_evidence;
  assert.deepEqual([idleEvidence.model, idleEvidence.size_vram_bytes, idleEvidence.size_bytes, idleEvidence.processor_gpu_percent, idleEvidence.running_models], [null, 0, 0, null, 0]);

  const broken = await withAdapter(t, { installed: ['qwen3:8b'], psStatus: 500 });
  assert.equal((await broken.get('/health')).body.gpu_evidence, null);
});

test('an invalid implementation map stops the adapter before it listens', { timeout: 15000 }, async () => {
  for (const value of ['bad entry', 'qwen3.8b.local=qwen3:8b,qwen3.8b.local=qwen3:14b', 'Bad.Impl=qwen3:8b', 'ok.local=']) {
    const child = spawn(process.execPath, [ADAPTER], {
      env: { ...process.env, MCCLUSTER_OLLAMA_ADAPTER_PORT: '0', MCCLUSTER_OLLAMA_URL: 'http://127.0.0.1:9', MCCLUSTER_OLLAMA_IMPLEMENTATIONS: value },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    let code = null;
    try { [code] = await once(child, 'exit', { signal: AbortSignal.timeout(5000) }); }
    finally { await stop(child); }
    assert.equal(code, 1, `exit code for ${JSON.stringify(value)}`);
    assert.match(stderr, /ollama_adapter_config_error/);
    assert.match(stderr, /MCCLUSTER_OLLAMA_IMPLEMENTATIONS/);
    assert.equal(stdout, '', 'no ready line for a misconfigured adapter');
  }
});

test('/models/pull accepts mapped models as well as the extra-model allowlist', { timeout: 15000 }, async (t) => {
  const a = await withAdapter(t, { installed: ['qwen3:8b'] }, { MCCLUSTER_OLLAMA_IMPLEMENTATIONS: MAP });
  const ok = await a.post('/models/pull', { model: 'qwen3:14b' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(a.requests.filter((r) => r.url === '/api/pull')[0].body.model, 'qwen3:14b');
  const refused = await a.post('/models/pull', { model: 'huge:70b' });
  assert.equal(refused.status, 400);
});

test('warm-on-start loads each installed resident model with one bounded token after the ready line', { timeout: 15000 }, async (t) => {
  const a = await withAdapter(t, { installed: ['qwen3:8b', 'qwen3:14b'] }, {
    MCCLUSTER_OLLAMA_IMPLEMENTATIONS: MAP,
    MCCLUSTER_OLLAMA_RESIDENT_MODELS: 'qwen3:14b,qwen3:4b-instruct-2507',
    MCCLUSTER_OLLAMA_WARM_ON_START: 'true'
  });
  const chats = await eventually(() => a.chats(), (list) => list.length >= 2);
  assert.deepEqual(chats.map((c) => c.model).sort(), ['qwen3:14b', 'qwen3:8b'], 'resident and installed only; the missing instruct model is skipped');
  for (const chat of chats) {
    assert.equal(chat.options.num_predict, 16);
    assert.equal(chat.messages[0].content, 'ok');
    assert.equal(chat.think, false);
    assert.equal(chat.keep_alive, '24h');
  }
  const warm = await eventually(() => a.events().filter((e) => e.event === 'ollama_adapter_warm'), (list) => list.length >= 2);
  assert.deepEqual(warm.map((e) => [e.model, e.ok]).sort(), [['qwen3:14b', true], ['qwen3:8b', true]]);
  assert.ok(warm.every((e) => Number.isFinite(e.wall_ms)));
  assert.equal(a.events()[0].event, 'ollama_adapter_ready');
  const health = await a.get('/health');
  assert.equal(health.body.busy, false);
  assert.equal(health.body.queue_depth, 0);
});

test('warm-on-start is off by default', { timeout: 15000 }, async (t) => {
  const a = await withAdapter(t, { installed: ['qwen3:8b'] });
  await a.get('/health');
  await delay(300);
  assert.equal(a.chats().length, 0);
});

// A port reserved in advance, so a fake daemon can start listening on it only
// when the test says so: after a reboot the adapter's startup task runs before
// the Ollama tray app exists.
async function reservePort() {
  const probe = http.createServer();
  probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function spawnAdapter(t, env) {
  const child = spawn(process.execPath, [ADAPTER], {
    env: { ...process.env, MCCLUSTER_OLLAMA_ADAPTER_PORT: '0', MCCLUSTER_OLLAMA_MODEL: 'qwen3:8b', MCCLUSTER_OLLAMA_ADAPTER_TIMEOUT_MS: '5000', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const output = { stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => { output.stdout += chunk; });
  child.stderr.on('data', (chunk) => { output.stderr += chunk; });
  t.after(() => stop(child));
  const events = () => output.stdout.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  return { child, output, events };
}

test('warm-on-start retries until the daemon answers: the tray app starts after the adapter after a reboot', { timeout: 20000 }, async (t) => {
  const port = await reservePort();
  const a = await spawnAdapter(t, { MCCLUSTER_OLLAMA_URL: `http://127.0.0.1:${port}`, MCCLUSTER_OLLAMA_WARM_ON_START: 'true', MCCLUSTER_OLLAMA_WARM_RETRY_MS: '1000' });
  const failed = await eventually(() => a.events().filter((e) => e.event === 'ollama_adapter_warm' && e.ok === false), (list) => list.length >= 2);
  assert.equal(failed[0].attempt, 1);
  assert.equal(failed[0].model, null);
  assert.equal(failed[0].next_in_ms, 1000, 'a daemon that does not answer yet is tried again (the retry floor is one second)');
  assert.equal(failed[1].attempt, 2);
  assert.equal(a.events()[0].event, 'ollama_adapter_ready', 'the ready line stays first');

  const { server, requests } = fakeOllama({ installed: ['qwen3:8b'] });
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { const closed = new Promise((resolve) => server.close(resolve)); server.closeAllConnections(); await closed; });
  const warmed = await eventually(() => a.events().filter((e) => e.event === 'ollama_adapter_warm' && e.ok === true), (list) => list.length >= 1);
  assert.equal(warmed[0].model, 'qwen3:8b');
  assert.equal(requests.filter((r) => r.url === '/api/chat').length, 1);
  await delay(600);
  assert.equal(requests.filter((r) => r.url === '/api/chat').length, 1, 'warmed once; the retries stop once the daemon answered');
  assert.equal(a.events().filter((e) => e.event === 'ollama_adapter_warm_window_ended').length, 0);
});

test('warm-on-start gives up after its window and says so', { timeout: 15000 }, async (t) => {
  const port = await reservePort();
  const a = await spawnAdapter(t, { MCCLUSTER_OLLAMA_URL: `http://127.0.0.1:${port}`, MCCLUSTER_OLLAMA_WARM_ON_START: 'true', MCCLUSTER_OLLAMA_WARM_RETRY_MS: '1000', MCCLUSTER_OLLAMA_WARM_WINDOW_MS: '1500' });
  const ended = await eventually(() => a.events().filter((e) => e.event === 'ollama_adapter_warm_window_ended'), (list) => list.length >= 1);
  assert.equal(ended[0].attempts, 2, 'the second attempt lands past the window, so no third is scheduled');
  assert.equal(ended[0].window_ms, 1500);
  const attempts = a.events().filter((e) => e.event === 'ollama_adapter_warm');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].next_in_ms, null);
  await delay(600);
  assert.equal(a.events().filter((e) => e.event === 'ollama_adapter_warm').length, 2, 'no attempt after the window');
});

// Images ride on messages[].images exactly as Ollama takes them; the adapter
// validates them with the shared module, passes them through untouched and
// refuses to put an image in front of a text model.
const VISION_MAP = `${MAP},qwen3-vl.8b.local=qwen3-vl:8b`;
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('images pass through to /api/chat messages[].images untouched for a vision model and the response counts them', { timeout: 15000 }, async (t) => {
  const a = await withAdapter(t, { installed: ['qwen3:8b', 'qwen3-vl:8b'] }, { MCCLUSTER_OLLAMA_IMPLEMENTATIONS: VISION_MAP });
  const out = await a.post('/execute', { capability: 'ai.chat', implementation: 'qwen3-vl.8b.local', input: { messages: [{ role: 'user', content: 'what is in this image', images: [PNG_1X1] }], num_ctx: 8192 } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.model, 'qwen3-vl:8b');
  assert.equal(out.body.images_in, 1);
  assert.deepEqual(a.chats()[0].messages, [{ role: 'user', content: 'what is in this image', images: [PNG_1X1] }], 'the message reaches Ollama exactly as sent');
  const text = await a.post('/execute', { capability: 'ai.chat', implementation: 'qwen3.8b.local', input: { prompt: 'hello' } });
  assert.equal(text.body.images_in, 0);
});

test('image refusals carry their codes and happen before any /api/chat call', { timeout: 15000 }, async (t) => {
  const a = await withAdapter(t, { installed: ['qwen3:8b', 'qwen3-vl:8b'] }, { MCCLUSTER_OLLAMA_IMPLEMENTATIONS: VISION_MAP });
  const cases = [
    [{ messages: [{ role: 'user', content: 'x', images: ['not base64!!'] }] }, 'AI_CHAT_IMAGE_INVALID'],
    [{ messages: [{ role: 'user', content: 'x', images: [`data:image/png;base64,${PNG_1X1}`] }] }, 'AI_CHAT_IMAGE_INVALID'],
    [{ messages: [{ role: 'user', content: 'x', images: [Buffer.from('GIF89a and more bytes here').toString('base64')] }] }, 'AI_CHAT_IMAGE_TYPE'],
    [{ messages: [{ role: 'user', content: 'x', images: [PNG_1X1, PNG_1X1, PNG_1X1, PNG_1X1, PNG_1X1] }] }, 'AI_CHAT_IMAGES_TOO_MANY'],
    [{ messages: [{ role: 'user', content: 'x', images: [Buffer.concat([Buffer.from(PNG_1X1, 'base64'), Buffer.alloc(200_000)]).toString('base64')] }] }, 'AI_CHAT_IMAGE_TOO_LARGE'],
    [{ prompt: 'x', images: [PNG_1X1] }, 'AI_CHAT_IMAGE_INVALID']
  ];
  for (const [input, code] of cases) {
    const out = await a.post('/execute', { capability: 'ai.chat', implementation: 'qwen3-vl.8b.local', input });
    assert.equal(out.status, 400, JSON.stringify(out.body));
    assert.equal(out.body.code, code);
  }
  assert.equal(a.chats().length, 0, 'nothing reached the daemon');
});

test('images in front of a text model are AI_CHAT_IMAGE_MODEL_NOT_VISION, and a missing vision model never falls back to the text default', { timeout: 15000 }, async (t) => {
  const a = await withAdapter(t, { installed: ['qwen3:8b'] }, { MCCLUSTER_OLLAMA_IMPLEMENTATIONS: VISION_MAP });
  const image = { messages: [{ role: 'user', content: 'look', images: [PNG_1X1] }] };
  const text = await a.post('/execute', { capability: 'ai.chat', implementation: 'qwen3.8b.local', input: image });
  assert.equal(text.status, 400);
  assert.equal(text.body.code, 'AI_CHAT_IMAGE_MODEL_NOT_VISION');
  const byDefault = await a.post('/execute', { capability: 'ai.chat', input: image });
  assert.equal(byDefault.body.code, 'AI_CHAT_IMAGE_MODEL_NOT_VISION', 'the default model is a text model');
  assert.equal(a.chats().length, 0);
  const missing = await a.post('/execute', { capability: 'ai.chat', implementation: 'qwen3-vl.8b.local', input: image });
  assert.equal(missing.status, 404, 'the vision model is not pulled: the daemon answer surfaces');
  assert.equal(missing.body.code, 'OLLAMA_UPSTREAM_ERROR');
  assert.deepEqual(a.chats().map((c) => c.model), ['qwen3-vl:8b'], 'no second attempt on the text default with the image still attached');
  const plain = await a.post('/execute', { capability: 'ai.chat', implementation: 'qwen3-vl.8b.local', input: { prompt: 'no image' } });
  assert.equal(plain.body.fallback_from, 'qwen3-vl:8b', 'without an image the text default still answers for a missing mapped model');
});

test('MCCLUSTER_OLLAMA_VISION_MODELS is the exact vision set when given', { timeout: 15000 }, async (t) => {
  const a = await withAdapter(t, { installed: ['qwen3:8b', 'qwen3:14b', 'qwen3-vl:8b'] }, { MCCLUSTER_OLLAMA_IMPLEMENTATIONS: VISION_MAP, MCCLUSTER_OLLAMA_VISION_MODELS: 'qwen3:14b' });
  const image = { messages: [{ role: 'user', content: 'look', images: [PNG_1X1] }] };
  assert.equal((await a.post('/execute', { capability: 'ai.chat', implementation: 'qwen3.14b.local', input: image })).status, 200);
  assert.equal((await a.post('/execute', { capability: 'ai.chat', implementation: 'qwen3-vl.8b.local', input: image })).body.code, 'AI_CHAT_IMAGE_MODEL_NOT_VISION');
  assert.equal((await a.get('/ready?implementation=qwen3.14b.local')).body.vision, true);
  assert.equal((await a.get('/ready?implementation=qwen3-vl.8b.local')).body.vision, false);
});

test('readiness bodies say which implementation can see', { timeout: 15000 }, async (t) => {
  const a = await withAdapter(t, { installed: ['qwen3:8b', 'qwen3-vl:8b'] }, { MCCLUSTER_OLLAMA_IMPLEMENTATIONS: VISION_MAP });
  const vision = await a.get('/ready?implementation=qwen3-vl.8b.local');
  assert.equal(vision.status, 200);
  assert.equal(vision.body.vision, true);
  assert.equal((await a.get('/ready?implementation=qwen3.8b.local')).body.vision, false);
  const byImplementation = Object.fromEntries((await a.get('/ready')).body.implementations.map((item) => [item.implementation, item.vision]));
  assert.deepEqual(byImplementation, { 'qwen3.8b.local': false, 'qwen3.14b.local': false, 'small.local': false, 'qwen3-vl.8b.local': true });
  assert.equal((await a.get('/health')).body.implementations.find((item) => item.implementation === 'qwen3-vl.8b.local').vision, true);
  assert.equal((await a.get('/diagnostics')).body.implementations.find((item) => item.implementation === 'qwen3-vl.8b.local').vision, true);
});
