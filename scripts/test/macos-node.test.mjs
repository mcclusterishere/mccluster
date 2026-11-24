import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { validateCapabilityManifest } from '../../core/src/compute/protocol.mjs';
import { readMeasuredInferenceSidecar } from '../../core/src/compute/node-agent-config.mjs';
import { benchmarkMac, localOllamaUrl, processRssBytes } from '../../core/macos/benchmark.mjs';
import { parseArgs, readSetupFile, resolveConfig, renderLaunchAgent, runtimeEnv, runtimeBundle,
  prepareInstall, privateWrite, enrollWithPipe, saveBenchmark } from '../../core/macos/mccluster-node.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ORG = '11111111-1111-4111-8111-111111111111';
const DIGEST = 'a'.repeat(64);
const read = file => fs.readFile(path.join(ROOT, file), 'utf8').then(JSON.parse);
const configFor = directory => resolveConfig({ state_root: path.join(directory, 'node'), org_id: ORG, display_name: 'Studio & review <Mac>' }, {}, { home: directory });

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mccluster-macos-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function fakeOllama(t, { digestChanges = false, truncate = false, redirect = false } = {}) {
  let tagCalls = 0, request = null, redirected = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/tags') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ models: [{ name: 'qwen3:8b', digest: digestChanges && tagCalls++ ? 'b'.repeat(64) : DIGEST,
        details: { parameter_size: '8.2B', quantization_level: 'Q4_K_M' } }] }));
    } else if (req.url === '/api/version') res.end(JSON.stringify({ version: 'test-fixture-only' }));
    else if (req.url === '/api/ps') res.end(JSON.stringify({ models: [{ name: 'qwen3:8b', digest: DIGEST, size: 6 * 1024 ** 3, size_vram: 6 * 1024 ** 3 }] }));
    else if (req.url === '/api/chat') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      request = JSON.parse(Buffer.concat(chunks));
      if (redirect) { res.writeHead(302, { location: '/redirected' }); res.end(); return; }
      res.setHeader('content-type', 'application/x-ndjson');
      res.write('{"message":{"content":"Read ');
      await new Promise(resolve => setTimeout(resolve, 20));
      res.write('the request."},"done":false}\n');
      await new Promise(resolve => setTimeout(resolve, 35));
      if (!truncate) res.write(JSON.stringify({ done: true, message: { content: '' }, prompt_eval_count: 20,
        prompt_eval_duration: 100_000_000, eval_count: 40, eval_duration: 2_000_000_000 }) + '\n');
      res.end();
    } else { redirected++; res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { url: `http://127.0.0.1:${server.address().port}`, get request() { return request; }, get redirected() { return redirected; } };
}

test('Mac manifest uses the OVH mapping and schemas, one lease, only local executors', async () => {
  const [mac, ovh] = await Promise.all([read('core/node-manifests/owner-macos-metal.json'), read('core/node-manifests/ovh-primary.json')]);
  const reference = ovh.capabilities.find(entry => entry.implementation === 'qwen3.8b.local');
  assert.equal(validateCapabilityManifest(mac.capabilities).length, 1);
  assert.equal(mac.max_leases, 1);
  assert.equal(mac.capabilities[0].model, 'qwen3:8b');
  assert.equal(mac.capabilities[0].implementation, reference.implementation);
  assert.deepEqual(mac.capabilities[0].input_schema, reference.input_schema);
  assert.deepEqual(mac.capabilities[0].output_schema, reference.output_schema);
  assert.equal(mac.capabilities[0].max_concurrency, 1);
  assert.equal(mac.capabilities[0].min_vram_bytes, 0);
  for (const property of ['url', 'health_url']) assert.equal(new URL(mac.capabilities[0].executor[property]).hostname, '127.0.0.1');
});

test('CLI refuses token arguments and setup JSON rejects secret-bearing fields', async t => {
  assert.throws(() => parseArgs(['install', '--token', 'secret']), /Credentials/);
  const directory = await temporary(t), file = path.join(directory, 'setup.json');
  await fs.writeFile(file, JSON.stringify({ org_id: ORG, display_name: 'Studio iMac', platform: 'macos', context: 4096, max_leases: 1 }));
  assert.equal((await readSetupFile(file)).org_id, ORG);
  await fs.writeFile(file, JSON.stringify({ org_id: ORG, credential: 'not-a-real-secret' }));
  await assert.rejects(readSetupFile(file), /nonsecret/);
  await fs.writeFile(file, JSON.stringify({ org_id: ORG, context: 32768 }));
  await assert.rejects(readSetupFile(file), /4K/);
});

test('HTTPS coordinator and local-only Ollama validation fail closed', () => {
  assert.equal(resolveConfig({ org_id: ORG, display_name: 'M'.repeat(80) }).display_name.length, 80);
  assert.throws(() => resolveConfig({ org_id: ORG, display_name: 'M'.repeat(81) }), /1–80/);
  for (const compute_url of ['http://compute.example.test', 'https://user:password@example.test', 'https://example.test/?token=x', 'https://example.test/path']) {
    assert.throws(() => resolveConfig({ org_id: ORG, compute_url }));
  }
  for (const url of ['https://127.0.0.1:11434', 'http://localhost:11434', 'http://example.test:11434', 'http://127.0.0.1/?secret=x']) {
    assert.throws(() => localOllamaUrl(url));
  }
  assert.equal(localOllamaUrl('http://[::1]:11434'), 'http://[::1]:11434');
});

test('dry-run executes on Linux and writes no files, keys, launch jobs or credentials', async t => {
  const directory = await temporary(t), config = configFor(directory);
  const result = await prepareInstall(config, { dryRun: true });
  assert.equal(result.plan.writes, false);
  assert.equal(result.plan.launches, false);
  assert.equal(result.plan.downloads, false);
  assert.deepEqual(await fs.readdir(directory), []);
  const cli = execFileSync(process.execPath, [path.join(ROOT, 'core/macos/mccluster-node.mjs'), 'install', '--org-id', ORG,
    '--state-root', config.state_root, '--dry-run'], { encoding: 'utf8' });
  assert.equal(JSON.parse(cli).writes, false);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('launchd gets literal argv and XML-escaped values, never a credential or a shell', async t => {
  const config = { ...configFor(await temporary(t)), runtime_root: '/opt/review & data/runtime' };
  const plist = renderLaunchAgent(config, 'agent');
  assert.match(plist, /Studio &amp; review &lt;Mac&gt;/);
  assert.match(plist, /<key>ProgramArguments<\/key>/);
  assert.match(plist, /<key>Umask<\/key><integer>63<\/integer>/);
  assert.doesNotMatch(plist, /ENROLL_TOKEN|\/bin\/sh|\/bin\/bash|SUPABASE|mcen1/);
  assert.equal(runtimeEnv(config).MCCLUSTER_OLLAMA_CONTEXT, '4096');
});

test('runtime bundle contains the complete relative import closure and no server config', async () => {
  const bundle = await runtimeBundle();
  assert.match(bundle.digest, /^[a-f0-9]{64}$/);
  assert.ok(bundle.files.has('src/compute/node-agent.mjs'));
  assert.ok(bundle.files.has('src/compute/ollama-adapter.mjs'));
  assert.ok(bundle.files.has('macos/benchmark.mjs'));
  for (const name of bundle.files.keys()) assert.doesNotMatch(name, /(?:gateway|store|supabase|\.env|identity\.json)/);
});

test('installation is private and starts with no admitted model; a symlink cannot redirect writes', async t => {
  const directory = await temporary(t), config = configFor(directory);
  const result = await prepareInstall(config);
  assert.equal((await fs.stat(config.state_root)).mode & 0o777, 0o700);
  const manifest = JSON.parse(await fs.readFile(path.join(config.state_root, 'capabilities.json')));
  assert.deepEqual(manifest.capabilities, []);
  assert.equal((await fs.stat(path.join(config.state_root, 'node.config.json'))).mode & 0o777, 0o600);
  for (const kind of ['agent', 'adapter']) {
    const file = path.join(config.launch_dir, `org.mccluster.node.${kind}.plist`);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    assert.match(await fs.readFile(file, 'utf8'), /runtime/);
  }
  const outside = path.join(directory, 'outside.json'); await fs.writeFile(outside, 'untouched');
  const link = path.join(config.state_root, 'linked.json'); await fs.symlink(outside, link);
  await assert.rejects(privateWrite(link, 'overwrite'), /symbolic link/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'untouched');
  assert.ok(result.config.runtime_root);
});

test('enrollment passes its credential only through stdin, wipes the buffer, and suppresses child output', async t => {
  const config = { ...configFor(await temporary(t)), runtime_root: '/review/runtime' };
  const dummy = `mcen1_${'a'.repeat(43)}`;
  const token = Buffer.from(dummy);
  let invocation, sent = '';
  const spawnImpl = (command, args, options) => {
    invocation = { command, args, options };
    const child = new EventEmitter();
    child.stdin = new Writable({ write(chunk, encoding, callback) { sent += chunk.toString(); callback(); } });
    child.stdin.on('finish', () => setImmediate(() => child.emit('exit', 0)));
    child.kill = () => {};
    return child;
  };
  assert.deepEqual(await enrollWithPipe(config, token, { spawnImpl }), { enrolled: true });
  assert.equal(sent, `${dummy}\n`);
  assert.ok([...token].every(byte => byte === 0));
  assert.doesNotMatch(JSON.stringify(invocation), /mcen1|SUPABASE/);
  assert.equal(invocation.options.env.MCCLUSTER_NODE_ENROLL_TOKEN_STDIN, '1');
  assert.deepEqual(invocation.options.stdio, ['pipe', 'ignore', 'ignore']);
});

test('benchmark measures streamed first content, digest, sampled peak memory and output speed at 4K', async t => {
  const server = await fakeOllama(t);
  let rssSamples = 0;
  const receipt = await benchmarkMac({ ollamaUrl: server.url, freeMemory: () => 6 * 1024 ** 3,
    sampleRss: () => ++rssSamples * 1024 ** 2, sampleIntervalMs: 10 });
  assert.equal(receipt.benchmark_passed, true);
  assert.equal(receipt.num_ctx, 4096);
  assert.equal(server.request.options.num_ctx, 4096);
  assert.equal(server.request.stream, true);
  assert.equal(server.request.model, 'qwen3:8b');
  assert.equal(receipt.model_digest, DIGEST);
  assert.equal(receipt.generation_tokens_per_second, 20);
  assert.equal(receipt.prompt_tokens_per_second, 200);
  assert.ok(receipt.time_to_first_token_ms > 0 && receipt.time_to_first_token_ms < receipt.wall_ms);
  assert.equal(receipt.peak_memory_bytes, rssSamples * 1024 ** 2);
  assert.equal(receipt.memory_is_sampled_lower_bound, true);
  assert.equal(receipt.headroom_passed, true);
  const directory = await temporary(t), config = configFor(directory);
  await prepareInstall(config);
  await saveBenchmark(config, receipt);
  const text = await fs.readFile(path.join(config.state_root, 'measured-inference.json'), 'utf8');
  assert.equal(readMeasuredInferenceSidecar(text).measurements['qwen3:8b'].generation_tokens_per_second, 20);
  assert.equal(JSON.parse(await fs.readFile(path.join(config.state_root, 'capabilities.json'))).capabilities.length, 1);
  await saveBenchmark(config, { ...receipt, benchmark_passed: false, headroom_passed: false });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(config.state_root, 'capabilities.json'))).capabilities, []);
});

test('memory pressure, changed digest, missing RSS and interrupted streams never pass', async t => {
  for (const condition of ['memory', 'digest', 'rss', 'stream']) {
    const server = await fakeOllama(t, { digestChanges: condition === 'digest', truncate: condition === 'stream' });
    const result = await benchmarkMac({ ollamaUrl: server.url, freeMemory: () => (condition === 'memory' ? 3 : 6) * 1024 ** 3,
      sampleRss: () => condition === 'rss' ? null : 6 * 1024 ** 3, sampleIntervalMs: 10 });
    assert.equal(result.benchmark_passed, false, condition);
    assert.ok(result.recovery, condition);
  }
});

test('benchmark refuses Ollama redirects without contacting the redirect endpoint', async t => {
  const server = await fakeOllama(t, { redirect: true });
  await assert.rejects(benchmarkMac({ ollamaUrl: server.url, freeMemory: () => 6 * 1024 ** 3,
    sampleRss: () => 6 * 1024 ** 3 }), /fetch failed/);
  assert.equal(server.redirected, 0);
});

test('Mac RSS sampling selects only Ollama process resident memory and labels unverified hosts', () => {
  const run = () => ' 100 /Applications/Ollama.app/Contents/Resources/ollama\n200 /usr/local/bin/ollama_llama_server\n900 unrelated\n';
  assert.equal(processRssBytes({ platform: 'darwin', run }), 300 * 1024);
  assert.equal(processRssBytes({ platform: 'linux', run }), null);
});
