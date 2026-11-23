// A node's loopback executor for `lyrics.align` (core/src/compute/lyrics-node.mjs). Bound to 127.0.0.1 only; the
// node agent calls it the way it calls the Ollama adapter. One song at a time (the separation and recognition use
// the whole GPU); a second request while one runs answers 429 so the lease fails fast and the task goes elsewhere.
//   GET  /ready    200 when Python can import the machine's engines (demucs, faster_whisper, torchaudio), else 503
//   POST /execute  {capability:"lyrics.align", input:{audio_url, audio_ext, sheet_text, title}} -> {doc}
// Env: MCCLUSTER_LYRICS_EXECUTOR_PORT (4792), LYRICS_PYTHON (python3; "python" on Windows),
//      MCCLUSTER_LYRICS_AUDIO_HOSTS (the storage hosts a master may come from).
import http from 'node:http';
import { spawn } from 'node:child_process';
import { executeLyricsTask, LYRICS_CAPABILITY } from './lyrics-node.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.MCCLUSTER_LYRICS_EXECUTOR_PORT || 4792);
const PYTHON = process.env.LYRICS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const BODY_LIMIT = 256 * 1024;
let busy = false;
let readiness = { at: 0, ok: false, reason: 'not checked' };

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store' });
  res.end(payload);
}

export function checkEngines(python = PYTHON, spawnImpl = spawn) {
  return new Promise((resolve) => {
    let done = false, err = '';
    const child = spawnImpl(python, ['-c', 'import demucs, faster_whisper, torchaudio; print("ok")'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const finish = (ok, reason) => { if (!done) { done = true; resolve({ ok, reason }); } };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(false, 'engine check timed out'); }, 20_000);
    child.stderr?.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); finish(false, `python unavailable: ${e.code || e.message}`); });
    child.on('close', (code) => { clearTimeout(timer); finish(code === 0, code === 0 ? null : (err.trim().split('\n').pop() || `exit ${code}`).slice(0, 200)); });
  });
}

async function ready() {
  if (Date.now() - readiness.at < 600_000) return readiness;
  const r = await checkEngines();
  readiness = { at: Date.now(), ok: r.ok, reason: r.reason };
  return readiness;
}

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > BODY_LIMIT) throw Object.assign(new Error('request too large'), { status: 413 }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('lyrics-executor.mjs')) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${HOST}`);
    try {
      if (req.method === 'GET' && (url.pathname === '/ready' || url.pathname === '/health')) {
        const r = await ready();
        return json(res, r.ok ? 200 : 503, { ok: r.ok, capability: LYRICS_CAPABILITY, busy, reason: r.reason, gpu_evidence: null });
      }
      if (req.method === 'POST' && url.pathname === '/execute') {
        const body = await readBody(req);
        if (body.capability && body.capability !== LYRICS_CAPABILITY) return json(res, 400, { error: `this executor runs ${LYRICS_CAPABILITY} only` });
        if (busy) return json(res, 429, { error: 'the lyric machine is busy with another song' });
        busy = true;
        try { return json(res, 200, await executeLyricsTask(body.input || {})); }
        finally { busy = false; }
      }
      return json(res, 404, { error: 'not found' });
    } catch (error) {
      return json(res, Number(error.status) || 500, { error: error.message, code: error.code || null });
    }
  });
  server.listen(PORT, HOST, () => console.log(JSON.stringify({ event: 'lyrics_executor_ready', host: HOST, port: PORT, python: PYTHON })));
}
