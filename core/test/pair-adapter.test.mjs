import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXO_AUDITED_RELEASE, EXO_PAIR_CONFIG, EXO_PAIR_MODEL, exoLoopbackOrigin, privateLanAddress, validatePairConfig, observeExoState, pairDiagnosticCapability } from '../src/compute/exo-runtime.mjs';
import { createPairController, createPairAdapterServer, readPairConfig, confirmLocalPairCleanup } from '../src/compute/pair-adapter.mjs';
import { validateCapabilityManifest } from '../src/compute/protocol.mjs';
import { generateNodeIdentity, verifySignedRequest } from '../src/compute/signature.mjs';

const NOW = Date.parse('2026-11-22T22:00:00Z');
const NODE_A = `node_${'a'.repeat(32)}`, NODE_B = `node_${'b'.repeat(32)}`;
const config = () => ({ schema: EXO_PAIR_CONFIG, enabled: true, runtime_url: 'http://127.0.0.1:52415',
  runtime: { ...EXO_AUDITED_RELEASE }, model_id: EXO_PAIR_MODEL, model_revision: 'a'.repeat(40), local_node_id: NODE_A,
  members: [{ node_id: NODE_A, runtime_node_id: 'runtime-a', lan_addresses: ['192.168.10.11'] },
    { node_id: NODE_B, runtime_node_id: 'runtime-b', lan_addresses: ['192.168.10.12'] }] });
const edge = ip => ({ sinkMultiaddr: { address: `/ip4/${ip}/tcp/42001`, ipAddress: ip, port: 42001, addressType: 'ip4' } });
const snapshot = () => ({ topology: { nodes: ['runtime-a', 'runtime-b'], connections: { 'runtime-a': { 'runtime-b': [edge('192.168.10.12')] }, 'runtime-b': { 'runtime-a': [edge('192.168.10.11')] } } },
  lastSeen: { 'runtime-a': new Date(NOW).toISOString(), 'runtime-b': new Date(NOW).toISOString() },
  nodeMemory: Object.fromEntries(['runtime-a', 'runtime-b'].map(id => [id, { ramTotal: { inBytes: 16 * 1024 ** 3 }, ramAvailable: { inBytes: 7 * 1024 ** 3 } }])), instances: {}, runners: {} });
const request = (action = 'probe', fields = {}) => ({ capability: 'compute.pair.control', implementation: 'exo.mlx.local', input: {
  action, pair_id: '3a333333-3333-4333-8333-333333333333', reservation_id: '4a444444-4444-4444-8444-444444444444',
  node_ids: [NODE_A, NODE_B], model_id: EXO_PAIR_MODEL, ...fields } });
const mockFetch = (state = snapshot(), calls = []) => async (url, options) => {
  calls.push({ url, ...options });
  return new Response(JSON.stringify(url.endsWith('/node_id') ? 'runtime-a' : state), { headers: { 'content-type': 'application/json' } });
};
async function listening(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

test('optional config pins exact audited release, two identities and private literal endpoints', () => {
  assert.deepEqual(validatePairConfig(config()), config());
  for (const address of ['10.0.0.4', '172.16.0.5', '192.168.10.2', 'fd00::2', 'fe80::2']) assert.equal(privateLanAddress(address), true);
  for (const address of ['127.0.0.1', '::1', '8.8.8.8', '172.32.0.1', 'localhost', '::ffff:192.168.1.1']) assert.equal(privateLanAddress(address), false);
  for (const url of ['https://127.0.0.1:52415', 'http://localhost:52415', 'http://192.168.1.2', 'http://127.0.0.1/?token=x', 'http://user:secret@127.0.0.1']) assert.throws(() => exoLoopbackOrigin(url));
  for (const mutation of [value => value.runtime.commit = 'b'.repeat(40), value => value.model_revision = 'short', value => value.members[1].node_id = NODE_A, value => value.members[1].runtime_node_id = 'runtime-a', value => value.token = 'forbidden']) {
    const value = config(); mutation(value); assert.throws(() => validatePairConfig(value));
  }
});

test('normal Mac manifest excludes pair; opt-in capability is diagnostic only and uses the existing protocol', async () => {
  const standard = JSON.parse(await fs.readFile(new URL('../node-manifests/owner-macos-metal.json', import.meta.url), 'utf8'));
  assert.equal(standard.capabilities.some(item => item.capability === 'compute.pair.control'), false);
  const entry = pairDiagnosticCapability(config());
  assert.equal(validateCapabilityManifest([entry])[0].features.inference, false);
  assert.equal(entry.executor.health_url, 'http://127.0.0.1:4791/health');
  assert.throws(() => pairDiagnosticCapability({ schema: EXO_PAIR_CONFIG, enabled: false }));
});

test('actual tagged EXO wire format yields observations, never fabricated revision, traffic or peak proof', async () => {
  const state = snapshot();
  state.instances['instance-a'] = { MlxRingInstance: { instanceId: 'instance-a', shardAssignments: { modelId: EXO_PAIR_MODEL, nodeToRunner: { 'runtime-a': 'runner-a', 'runtime-b': 'runner-b' } } } };
  state.runners = { 'runner-a': { RunnerReady: {} }, 'runner-b': { RunnerRunning: {} } };
  state.runtime = { ...EXO_AUDITED_RELEASE }; state.model_revision = 'a'.repeat(40); state.peak_memory_verified = true;
  const result = await createPairController({ config: config(), fetchImpl: mockFetch(state), now: () => NOW }).execute(request());
  assert.equal(result.exactly_two_members, true); assert.equal(result.observed_lan_endpoints_match, true);
  assert.equal(result.observed_shared_instances.length, 1); assert.equal(result.observed_shared_instances[0].runners_ready_or_running, true);
  assert.equal(result.ok, false); assert.equal(result.state, 'unavailable'); assert.equal(result.runtime, null);
  assert.equal(result.model_revision, null); assert.equal(result.model_traffic_local, false); assert.equal(result.shared_model_test, false);
  assert.equal(result.devices[0].memory_bytes, 16 * 1024 ** 3); assert.equal(result.devices[0].peak_memory_bytes, null);
  assert.equal(result.devices[0].peak_memory_verified, false); assert.ok(result.gaps.some(gap => gap.code === 'EXO_PER_NODE_PEAK_UNAVAILABLE'));
});

test('wrong, additional, stale and public-address runtime members fail closed', () => {
  const cfg = validatePairConfig(config());
  const check = (state, id = 'runtime-a') => observeExoState({ state, localRuntimeNodeId: id, config: cfg, now: NOW });
  assert.equal(check(snapshot(), 'new-runtime-id').local_identity_matches, false);
  let state = snapshot(); state.topology.nodes.push('third-device'); assert.equal(check(state).exactly_two_members, false);
  state = snapshot(); state.lastSeen['runtime-b'] = new Date(NOW - 121_000).toISOString(); assert.equal(check(state).runtime_heartbeats_fresh, false);
  state = snapshot(); state.topology.connections['runtime-a']['runtime-b'][0] = edge('8.8.8.8'); assert.equal(check(state).observed_lan_endpoints_match, false);
  state = snapshot(); state.topology.connections['runtime-a']['runtime-b'][0] = edge('192.168.10.99'); assert.equal(check(state).observed_lan_endpoints_match, false);
  state = snapshot(); delete state.nodeMemory; assert.equal(check(state).devices[0].memory_bytes, null);
});

test('prepare, benchmark and chat issue no mutation, downloads or prompt requests while evidence is absent', async () => {
  const calls = [];
  const controller = createPairController({ config: config(), fetchImpl: mockFetch(snapshot(), calls), now: () => NOW });
  for (const action of ['prepare', 'benchmark', 'chat']) {
    const result = await controller.execute(request(action, { chat: { prompt: 'private prompt never sent upstream' } }));
    assert.equal(result.ok, false); assert.equal(result.mutated, false); assert.equal(result.inference_enabled, false);
    if (action === 'prepare') assert.equal(result.ollama_unloaded, false);
  }
  assert.equal(calls.length, 6);
  for (const call of calls) { assert.equal(call.method, 'GET'); assert.equal(call.redirect, 'error'); assert.equal(call.body, undefined); assert.match(call.url, /\/(state|node_id)$/); }
  assert.equal(JSON.stringify(calls).includes('private prompt'), false);
  await assert.rejects(controller.execute(request('probe', { node_ids: [NODE_A, `node_${'c'.repeat(32)}`] })));
  assert.equal(calls.length, 6);
});

test('release confirms idle state only after all instances and live runners have gone', async () => {
  let state = snapshot();
  const controller = createPairController({ config: config(), fetchImpl: async (url, opts) => mockFetch(state)(url, opts), now: () => NOW });
  let result = await controller.execute(request('release')); assert.equal(result.ok, true); assert.equal(result.unloaded, true); assert.equal(result.mutated, false);
  state.runners = { 'runner-a': { RunnerShuttingDown: {} } };
  result = await controller.execute(request('release')); assert.equal(result.ok, false); assert.equal(result.unloaded, false);
  state.runners = { 'runner-a': { RunnerShutdown: {} } };
  result = await controller.execute(request('release')); assert.equal(result.unloaded, true);
  state.instances = { unrelated: { MlxRingInstance: {} } };
  result = await controller.execute(request('release')); assert.equal(result.unloaded, false);
  state = snapshot(); state.lastSeen['runtime-b'] = new Date(NOW - 130_000).toISOString();
  result = await controller.execute(request('release')); assert.equal(result.unloaded, false);
});

test('disabled diagnostics never contact the runtime; upstream failures never echo errors or claim cleanup', async () => {
  let calls = 0;
  const disabled = createPairController({ fetchImpl: async () => { calls++; throw new Error('not called'); } });
  assert.equal((await disabled.execute(request())).code, 'PAIR_OPT_IN_REQUIRED'); assert.equal(calls, 0);
  const failed = createPairController({ config: config(), fetchImpl: async () => { throw new Error('private upstream detail'); } });
  const result = await failed.execute(request('release'));
  assert.equal(result.code, 'EXO_UNREACHABLE'); assert.equal(result.unloaded, false);
  assert.equal(JSON.stringify(result).includes('private upstream detail'), false);
});

test('real loopback HTTP diagnostic refuses browser origins, foreign hosts, unsupported endpoints and malformed bodies', async () => {
  const runtimeCalls = [];
  const server = createPairAdapterServer({ config: config(), fetchImpl: mockFetch(snapshot(), runtimeCalls), now: () => NOW });
  const base = await listening(server);
  try {
    assert.equal(server.address().address, '127.0.0.1');
    assert.equal((await fetch(`${base}/ready`)).status, 503);
    assert.equal((await (await fetch(`${base}/health`)).json()).inference_enabled, false);
    const body = JSON.stringify(request());
    for (const headers of [{ origin: 'https://foreign.example', 'content-type': 'application/json' }, { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }]) {
      assert.equal((await fetch(`${base}/execute`, { method: 'POST', headers, body })).status, 403);
    }
    const foreignHostStatus = await new Promise((resolve, reject) => {
      const req = http.request(`${base}/execute`, { method: 'POST', headers: { host: 'foreign.example', 'content-type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end(body);
    });
    assert.equal(foreignHostStatus, 403);
    assert.equal((await fetch(`${base}/execute`, { method: 'POST', body })).status, 415);
    assert.equal((await fetch(`${base}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[]' })).status, 400);
    assert.equal((await fetch(`${base}/v1/chat/completions`, { method: 'POST', body })).status, 404);
    const response = await fetch(`${base}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(response.status, 200); assert.equal((await response.json()).ok, false); assert.equal(runtimeCalls.length, 2);
  } finally { await close(server); }
});

test('runtime read timeout, redirects and oversized state are bounded and fail closed', async () => {
  let redirected = 0;
  const upstream = http.createServer((req, res) => {
    if (req.url === '/redirected') { redirected++; res.end('{}'); return; }
    res.writeHead(302, { location: '/redirected' }); res.end();
  });
  const base = await listening(upstream);
  try {
    const cfg = config(); cfg.runtime_url = base;
    const controller = createPairController({ config: cfg, requestTimeoutMs: 50 });
    assert.equal((await controller.execute(request())).code, 'EXO_UNREACHABLE'); assert.equal(redirected, 0);
    upstream.removeAllListeners('request'); upstream.on('request', () => {});
    const started = Date.now(); assert.equal((await controller.execute(request())).code, 'EXO_UNREACHABLE'); assert.ok(Date.now() - started < 1000);
  } finally { await close(upstream); }
  const oversized = createPairController({ config: config(), fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) });
  assert.equal((await oversized.execute(request())).code, 'EXO_UNREACHABLE');
});

test('opt-in config refuses writable shared files and symlinks', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'mccluster-pair-config-'));
  try {
    const filename = path.join(folder, 'pair.json'); await fs.writeFile(filename, JSON.stringify(config()), { mode: 0o600 });
    assert.equal((await readPairConfig(filename)).enabled, true);
    const linked = path.join(folder, 'linked.json'); await fs.symlink(filename, linked); await assert.rejects(readPairConfig(linked));
    await fs.chmod(filename, 0o666); await assert.rejects(readPairConfig(filename));
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

async function cleanupFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mccluster-pair-cleanup-'));
  const identity = generateNodeIdentity();
  const cfg = config(); cfg.local_node_id = identity.nodeId; cfg.members[0].node_id = identity.nodeId;
  await fs.writeFile(path.join(root, 'identity.json'), JSON.stringify(identity), { mode: 0o600 });
  await fs.writeFile(path.join(root, 'node.config.json'), JSON.stringify({ schema: 'mccluster-macos-node/1', state_root: root, compute_url: 'https://isolated-compute.example.test' }), { mode: 0o600 });
  return { root, identity, cfg };
}

test('explicit local cleanup proves idle then posts a fresh signed receipt using only the protected device identity', async () => {
  const { root, identity, cfg } = await cleanupFixture();
  const posts = [];
  try {
    const fetchImpl = async (url, options) => {
      if (url.startsWith('http://127.0.0.1:')) return mockFetch()(url, options);
      assert.equal(url, 'https://isolated-compute.example.test/v1/compute/pair-cleanup');
      assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
      const signed = verifySignedRequest({ publicKeyPem: identity.publicKeyPem, method: 'POST', path: '/v1/compute/pair-cleanup', headers: options.headers, bodyBytes: options.body, now: NOW });
      assert.equal(signed.nodeId, identity.nodeId);
      const body = JSON.parse(options.body.toString());
      assert.deepEqual(body, { reservation_id: request().input.reservation_id, receipt: { schema: 'mccluster-pair-cleanup/1', runtime: 'exo', unloaded: true, model_instances: 0, observed_at: new Date(NOW).toISOString() } });
      assert.equal(JSON.stringify(options).includes('PRIVATE KEY'), false);
      posts.push({ body, headers: options.headers });
      return new Response(JSON.stringify({ ok: true, node_id: identity.nodeId, state: 'draining', cleanup_confirmed: true, resume_available: true }));
    };
    const result = await confirmLocalPairCleanup({ config: cfg, stateRoot: root, reservationId: request().input.reservation_id, fetchImpl, now: () => NOW });
    assert.equal(result.cleanup_confirmed, true); assert.equal(result.state, 'draining'); assert.match(result.recovery, /click Resume/);
    await confirmLocalPairCleanup({ config: cfg, stateRoot: root, reservationId: request().input.reservation_id, fetchImpl, now: () => NOW });
    assert.equal(posts.length, 2); assert.notEqual(posts[0].headers['x-mccluster-nonce'], posts[1].headers['x-mccluster-nonce']);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'identity.json'), 'utf8')), identity);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('busy or stale runtime never reads/sends a cleanup identity or synthesizes unload', async () => {
  for (const mutate of [state => { state.instances = { 'still-loaded': { MlxRingInstance: {} } }; }, state => { state.runners = { 'runner-a': { RunnerShuttingDown: {} } }; }, state => { state.lastSeen['runtime-b'] = new Date(NOW - 121_000).toISOString(); }]) {
    const state = snapshot(); mutate(state);
    let posts = 0;
    const fetchImpl = async (url, options) => { if (options.method !== 'GET') posts++; return mockFetch(state)(url, options); };
    await assert.rejects(confirmLocalPairCleanup({ config: config(), stateRoot: '/nonexistent-node-state', reservationId: request().input.reservation_id, fetchImpl, now: () => NOW }), /Cleanup is not proven/);
    assert.equal(posts, 0);
  }
});

test('cleanup refuses exposed or mismatched identity, coordinator URLs and server rejection without echoing private errors', async () => {
  const { root, identity, cfg } = await cleanupFixture();
  let posts = 0;
  const fetchImpl = async (url, options) => {
    if (options.method === 'GET') return mockFetch()(url, options);
    posts++;
    return new Response('private-server-detail', { status: 409 });
  };
  const run = () => confirmLocalPairCleanup({ config: cfg, stateRoot: root, reservationId: request().input.reservation_id, fetchImpl, now: () => NOW });
  try {
    await fs.chmod(path.join(root, 'identity.json'), 0o644); await assert.rejects(run(), /protected local worker/); assert.equal(posts, 0);
    await fs.chmod(path.join(root, 'identity.json'), 0o600);
    const other = generateNodeIdentity();
    await fs.writeFile(path.join(root, 'identity.json'), JSON.stringify({ ...identity, privateKeyPem: other.privateKeyPem }));
    await assert.rejects(run(), /does not match/); assert.equal(posts, 0);
    await fs.writeFile(path.join(root, 'identity.json'), JSON.stringify(identity));
    const configFile = path.join(root, 'node.config.json');
    const saved = JSON.parse(await fs.readFile(configFile, 'utf8'));
    await fs.writeFile(configFile, JSON.stringify({ ...saved, compute_url: 'http://insecure.example.test' }));
    await assert.rejects(run(), /does not match/); assert.equal(posts, 0);
    await fs.writeFile(configFile, JSON.stringify(saved));
    await assert.rejects(run(), error => /active work\/reservations/.test(error.message) && !error.message.includes('private-server-detail'));
    assert.equal(posts, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('cleanup CLI rejects credential arguments before reading state and has no local HTTP cleanup route', async () => {
  const cli = fileURLToPath(new URL('../src/compute/pair-adapter.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'cleanup', '--token', 'fixture-secret-never-echo'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(`${result.stdout}${result.stderr}`.includes('fixture-secret-never-echo'), false);
  const server = createPairAdapterServer(); const base = await listening(server);
  try { assert.equal((await fetch(`${base}/cleanup`, { method: 'POST' })).status, 404); }
  finally { await close(server); }
});
