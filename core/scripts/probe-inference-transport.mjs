// Optional real-time transport regression. No Ollama, prompts, credentials or
// external service: two synthetic requests to an ephemeral loopback server.
// Full mode takes ~310s and is deliberately outside the normal test suite.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { inferenceFetch } from '../src/compute/inference-http.mjs';

const full = process.argv.includes('--full');
const delayMs = full ? 310_000 : 100;
const deadlineMs = full ? 325_000 : 5_000;
const timers = new Set();
const server = http.createServer((req, res) => {
  req.resume();
  const timer = setTimeout(() => { timers.delete(timer); res.end('{"synthetic":true}'); }, delayMs);
  timers.add(timer);
  res.once('close', () => { clearTimeout(timer); timers.delete(timer); });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/synthetic`;
const observe = async (name, transport) => {
  const signal = AbortSignal.timeout(deadlineMs);
  const started = Date.now();
  try {
    const response = await transport(url, { signal });
    assert.deepEqual(await response.json(), { synthetic: true });
    return { name, ok: true, elapsed_ms: Date.now() - started, signal_aborted: signal.aborted };
  } catch (error) {
    return { name, ok: false, elapsed_ms: Date.now() - started, signal_aborted: signal.aborted, error: error.name, code: error.code || null, cause_code: error.cause?.code || null };
  }
};
try {
  const results = await Promise.all([observe('native-fetch', fetch), observe('inference-http', inferenceFetch)]);
  console.log(JSON.stringify({ node: process.version, delay_ms: delayMs, deadline_ms: deadlineMs, results }, null, 2));
  assert.equal(results[1].ok, true);
  if (full) {
    assert.equal(results[0].ok, false);
    assert.equal(results[0].cause_code, 'UND_ERR_HEADERS_TIMEOUT');
    assert.equal(results[0].signal_aborted, false);
  } else assert.equal(results[0].ok, true);
} finally {
  for (const timer of timers) clearTimeout(timer);
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
