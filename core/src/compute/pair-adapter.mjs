#!/usr/bin/env node
// Optional, owner-started loopback diagnostics. This intentionally issues only
// GET /node_id and GET /state: even EXO's placement-preview route can fetch an
// uncached model card. No inference or lifecycle mutation is enabled until the
// required runtime/model/memory/cleanup evidence has a verified implementation.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPublicKey } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { EXO_PAIR_CONFIG, observeExoState, pairDiagnosticCapability, unavailablePairResult, validatePairConfig, validatePairInput } from './exo-runtime.mjs';
import { nodeIdFromPublicKey, signRequest } from './signature.mjs';

const MAX_BODY = 65_536;
const MAX_STATE = 2 * 1024 * 1024;

async function boundedJson(stream, maximum) {
  const chunks = [];
  let length = 0;
  for await (const chunk of stream) {
    length += chunk.length;
    if (length > maximum) throw new Error('Body limit exceeded.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function readPairConfig(filename) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BODY || stat.mode & 0o022) throw new Error('The pair config must be a regular file that other users cannot modify.');
  return validatePairConfig(JSON.parse(await fs.readFile(filename, 'utf8')));
}

export function createPairController({ config: rawConfig = { schema: EXO_PAIR_CONFIG, enabled: false }, fetchImpl = fetch, now = Date.now, requestTimeoutMs = 3000 } = {}) {
  const config = validatePairConfig(rawConfig);
  async function inspect(signal) {
    if (!config.enabled) return { observation: null, extraGaps: [] };
    const deadline = AbortSignal.timeout(Math.max(50, Math.min(10_000, requestTimeoutMs)));
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const read = async route => {
      const response = await fetchImpl(`${config.runtime_url}${route}`, { method: 'GET', redirect: 'error', headers: { accept: 'application/json' }, signal: combined });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('Runtime unavailable.'); }
      return boundedJson(response.body, MAX_STATE);
    };
    try {
      const [localRuntimeNodeId, state] = await Promise.all([read('/node_id'), read('/state')]);
      return { observation: observeExoState({ state, localRuntimeNodeId, config, now: now() }), extraGaps: [] };
    } catch {
      // Never forward an upstream response, prompt, URL or exception text.
      return { observation: null, extraGaps: [{ code: 'EXO_UNREACHABLE', reason: 'The local EXO diagnostic API did not return a bounded state response. Check the owner-started runtime and its loopback endpoint.' }] };
    }
  }
  return {
    config,
    inspect,
    health() { return { ok: true, service: 'mccluster-pair-probe/1', enabled: config.enabled, inference_enabled: false, state: 'unavailable' }; },
    async execute(body, signal) {
      const input = validatePairInput(body, config);
      const result = await inspect(signal);
      // Cleanup confirmation is observational only. No instance is ever created,
      // so a restart cannot strand an adapter-owned model or watchdog timer.
      if (input.action === 'release' && result.observation?.runtime_idle) {
        return { ok: true, action: 'release', unloaded: true, mutated: false, inference_enabled: false,
          cleanup_evidence: 'exo:/state contains no instances or active runners', ...result.observation };
      }
      return { ...unavailablePairResult({ config, action: input.action, ...result }),
        ...(input.action === 'release' ? { unloaded: false } : {}),
        ...(input.action === 'prepare' ? { ollama_unloaded: false } : {}) };
    },
  };
}

async function protectedNodeJson(stateRoot, basename) {
  // Refuse symlinks anywhere in the state path, including the final file. The
  // directory and files must belong to this user and exclude other users.
  const directory = path.resolve(stateRoot);
  let cursor = path.parse(directory).root;
  for (const part of directory.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error('Cleanup requires a private node state directory without symbolic links.');
  }
  const info = await fs.lstat(directory);
  const filename = path.join(directory, basename);
  const fileInfo = await fs.lstat(filename);
  const uid = process.getuid?.();
  if (!info.isDirectory() || info.mode & 0o077 || uid != null && info.uid !== uid || !fileInfo.isFile() || fileInfo.isSymbolicLink()
    || fileInfo.mode & 0o077 || uid != null && fileInfo.uid !== uid || fileInfo.size > MAX_BODY) {
    throw new Error('Cleanup requires the current user’s protected node state (0700 directory, 0600 files).');
  }
  const bytes = await fs.readFile(filename);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('The protected node state is not valid JSON.'); }
  finally { bytes.fill(0); }
}

/** Called only by an explicit local CLI, never an HTTP route or browser input. */
export async function confirmLocalPairCleanup({ config, reservationId, stateRoot = path.join(os.homedir(), 'Library', 'Application Support', 'McCluster Node'),
  fetchImpl = fetch, now = Date.now, signal } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reservationId || '')) throw new Error('Copy the cleanup reservation ID from the owner’s Devices panel.');
  const controller = createPairController({ config, fetchImpl, now });
  if (!controller.config.enabled) throw new Error('The owner must explicitly configure the local pair diagnostic first.');
  const { observation } = await controller.inspect(signal);
  if (observation?.runtime_idle !== true) throw new Error('Cleanup is not proven. Unload the pair using the runtime’s own controls, restore both mapped runtime members and retry when no instances or live runners remain. No receipt was sent.');
  const observedAt = new Date(now()).toISOString();
  let saved, identity;
  try {
    saved = await protectedNodeJson(stateRoot, 'node.config.json');
    identity = await protectedNodeJson(stateRoot, 'identity.json');
  } catch { throw new Error('The protected local worker identity/configuration could not be read. Use the original owner account and node state directory. No receipt was sent.'); }
  let origin, nodeId;
  try {
    const url = new URL(saved.compute_url);
    if (saved.schema !== 'mccluster-macos-node/1' || path.resolve(saved.state_root) !== path.resolve(stateRoot) || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid saved coordinator.');
    origin = url.origin;
    nodeId = nodeIdFromPublicKey(identity.publicKeyPem);
    const privatePublicKey = createPublicKey(identity.privateKeyPem);
    if (privatePublicKey.asymmetricKeyType !== 'ed25519' || nodeIdFromPublicKey(privatePublicKey.export({ type: 'spki', format: 'pem' })) !== nodeId || identity.nodeId !== nodeId || controller.config.local_node_id !== nodeId) throw new Error('Invalid identity.');
  } catch { throw new Error('The protected worker identity or HTTPS coordinator does not match this pair configuration. No receipt was sent.'); }
  const pathname = '/v1/compute/pair-cleanup';
  const bodyBytes = Buffer.from(JSON.stringify({ reservation_id: reservationId, receipt: {
    schema: 'mccluster-pair-cleanup/1', runtime: 'exo', unloaded: true, model_instances: 0, observed_at: observedAt,
  } }));
  const signedHeaders = signRequest({ privateKeyPem: identity.privateKeyPem, method: 'POST', path: pathname, nodeId, bodyBytes, timestamp: new Date(now()).toISOString() });
  identity.privateKeyPem = null;
  const deadline = AbortSignal.timeout(10_000);
  let response, result;
  try {
    response = await fetchImpl(`${origin}${pathname}`, { method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', ...signedHeaders }, body: bodyBytes,
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw Object.assign(new Error('Core refused this device’s signed cleanup. A revoked or quarantined device cannot clear the hold.'), { safe: true });
      if (response.status === 409) throw Object.assign(new Error('Core could not clear this cleanup hold. Check the reservation ID, allow active work/reservations to finish, and refresh Devices before retrying.'), { safe: true });
      throw new Error('Cleanup request failed.');
    }
    result = await boundedJson(response.body, MAX_BODY);
  } catch (error) {
    if (error.safe) throw error;
    throw new Error('Core did not confirm cleanup. Check outbound HTTPS and the Devices panel; the device remains paused.');
  }
  if (result?.ok !== true || result.node_id !== nodeId || result.cleanup_confirmed !== true || result.resume_available !== true || result.state !== 'draining') throw new Error('Core returned no matching cleanup confirmation. Refresh Devices before taking another action.');
  return { ok: true, node_id: nodeId, reservation_id: reservationId, cleanup_confirmed: true, resume_available: true,
    state: 'draining', recovery: 'Cleanup hold cleared. Open Devices and click Resume when this Mac should accept ordinary jobs.' };
}

function send(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(body);
}

export function createPairAdapterServer(options = {}) {
  const controller = createPairController(options);
  let inFlight = 0;
  const server = http.createServer(async (request, response) => {
    const port = server.address()?.port;
    // Loopback binding plus Host/Origin checks also refuse browser cross-origin
    // requests and DNS rebinding. This endpoint is for the local node agent.
    if (request.headers.host !== `127.0.0.1:${port}` || request.headers.origin || request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'none') return send(response, 403, { error: 'Local node-agent requests only.' });
    if (request.method === 'GET' && request.url === '/health') return send(response, 200, controller.health());
    if (request.method === 'GET' && request.url === '/ready') return send(response, 503, { ...controller.health(), ok: false, reason: 'Distributed inference is unverified. Use the explicit diagnostic probe.' });
    if (request.method !== 'POST' || request.url !== '/execute') return send(response, 404, { error: 'Not found.' });
    if (String(request.headers['content-type'] || '').split(';')[0] !== 'application/json') return send(response, 415, { error: 'JSON required.' });
    if (inFlight >= 2) return send(response, 429, { error: 'A pair diagnostic is already in progress.' });
    inFlight++;
    const caller = new AbortController();
    const abort = () => caller.abort();
    request.once('aborted', abort);
    response.once('close', () => { if (!response.writableEnded) abort(); });
    try {
      const body = await boundedJson(request, MAX_BODY);
      send(response, 200, await controller.execute(body, caller.signal));
    } catch {
      send(response, 400, { error: 'Invalid local pair request. Check the action, enrolled-device mapping and reservation.' });
    } finally {
      inFlight--;
      request.removeListener('aborted', abort);
    }
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  server.keepAliveTimeout = 1000;
  return server;
}

async function main(argv) {
  if (argv[0] === 'cleanup') {
    const args = {};
    const allowed = new Map([['--config', 'configFile'], ['--reservation-id', 'reservationId'], ['--state-root', 'stateRoot']]);
    for (let index = 1; index < argv.length; index += 2) {
      if (!allowed.has(argv[index]) || !argv[index + 1] || argv[index + 1].startsWith('--') || Object.hasOwn(args, allowed.get(argv[index]))) throw new Error('Usage: node core/src/compute/pair-adapter.mjs cleanup --config <file> --reservation-id <id> [--state-root <directory>]. Credentials are never accepted as arguments.');
      args[allowed.get(argv[index])] = argv[index + 1];
    }
    if (!args.configFile || !args.reservationId) throw new Error('Cleanup needs the local pair config and reservation ID from Devices.');
    const config = await readPairConfig(args.configFile);
    console.log(JSON.stringify(await confirmLocalPairCleanup({ config, reservationId: args.reservationId, stateRoot: args.stateRoot }), null, 2));
    return;
  }
  if (![2, 3].includes(argv.length) || argv[0] !== '--config' || argv.length === 3 && argv[2] !== '--print-capability') throw new Error('Explicit opt-in: node core/src/compute/pair-adapter.mjs --config ./mccluster-pair-probe.json [--print-capability]');
  const config = await readPairConfig(argv[1]);
  if (!config.enabled) throw new Error('Pair diagnostics are disabled in this configuration.');
  if (argv[2] === '--print-capability') { console.log(JSON.stringify(pairDiagnosticCapability(config), null, 2)); return; }
  const server = createPairAdapterServer({ config });
  server.listen(4791, '127.0.0.1', () => console.log(JSON.stringify({ event: 'pair_probe_ready', host: '127.0.0.1', port: 4791, inference_enabled: false })));
  server.on('error', () => { console.error('The local pair diagnostic listener could not start.'); process.exitCode = 1; });
  for (const event of ['SIGTERM', 'SIGINT']) process.once(event, () => { server.close(); server.closeAllConnections(); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(error => {
  console.error(error.message); process.exitCode = 1;
});
