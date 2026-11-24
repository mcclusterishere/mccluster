#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { ReadStream, WriteStream } from 'node:tty';
import { benchmarkMac, localOllamaUrl, ollamaJson, MAC_MODEL, MAC_CONTEXT } from './benchmark.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = path.resolve(HERE, '..');
const CONFIG_SCHEMA = 'mccluster-macos-node/1';
const LABELS = ['org.mccluster.node.adapter', 'org.mccluster.node.agent'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const defaultStateRoot = () => path.join(os.homedir(), 'Library', 'Application Support', 'McCluster Node');
const plainName = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80 && !/[\x00-\x1f\x7f]/.test(value);
const safePath = value => typeof value === 'string' && path.isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value);

export function computeOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Compute URL must be an HTTPS origin without credentials, query, or path.');
  }
  return url.origin;
}

export function parseArgs(argv) {
  const command = argv[0] || 'help';
  if (!['install', 'enroll', 'benchmark', 'status', 'start', 'stop', 'help'].includes(command)) throw new Error('Unknown command. Use help.');
  const opts = {};
  const names = new Map([['--name', 'display_name'], ['--org-id', 'org_id'], ['--compute-url', 'compute_url'],
    ['--state-root', 'state_root'], ['--setup-file', 'setup_file']]);
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--dry-run') { opts.dry_run = true; continue; }
    if (!names.has(flag) || argv[index + 1] === undefined || argv[index + 1].startsWith('--')) throw new Error('Unknown or incomplete option. Credentials are accepted only at the hidden prompt.');
    opts[names.get(flag)] = argv[++index];
  }
  return { command, opts };
}

export async function readSetupFile(filename) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384) throw new Error('Setup file must be a regular JSON file smaller than 16 KB.');
  const value = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Setup file must contain an object.');
  const allowed = new Set(['org_id', 'compute_url', 'enrollment_id', 'display_name', 'platform', 'implementation', 'model', 'context', 'max_leases']);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('Setup files may contain only the nonsecret device setup fields.');
  if (value.platform && !['macos', 'darwin'].includes(value.platform)) throw new Error('This setup is for a different platform.');
  if (value.model && value.model !== MAC_MODEL || value.implementation && value.implementation !== 'qwen3.8b.local'
    || value.context != null && value.context !== MAC_CONTEXT || value.max_leases != null && value.max_leases !== 1) {
    throw new Error('This installer supports qwen3:8b, 4K context and one active job.');
  }
  return value;
}

export function resolveConfig(opts = {}, previous = {}, { home = os.homedir(), node = process.execPath } = {}) {
  const stateRoot = path.resolve(opts.state_root || defaultStateRoot());
  const displayName = opts.display_name ?? previous.display_name ?? 'Studio iMac';
  const orgId = opts.org_id || previous.org_id;
  const computeUrl = computeOrigin(opts.compute_url || previous.compute_url || 'https://compute.mccluster.org');
  if (!plainName(displayName)) throw new Error('Name the device using 1–80 printable characters.');
  if (!UUID.test(orgId || '')) throw new Error('A valid owner workspace organization ID is required.');
  if (![stateRoot, home, node].every(safePath)) throw new Error('Installer paths must be absolute and contain no control characters.');
  if (previous.enrolled_at && (previous.org_id !== orgId || previous.compute_url !== computeUrl)) {
    throw new Error('This identity is already bound to another coordinator or workspace. Use a separate state directory for a new enrollment.');
  }
  return { schema: CONFIG_SCHEMA, display_name: displayName.trim(), org_id: orgId, compute_url: computeUrl,
    enrollment_id: opts.enrollment_id || previous.enrollment_id || null,
    state_root: stateRoot, launch_dir: path.join(home, 'Library', 'LaunchAgents'), node_path: node,
    model: MAC_MODEL, context: MAC_CONTEXT, max_leases: 1,
    runtime_root: previous.runtime_root || null, enrolled_at: previous.enrolled_at || null };
}

export function runtimeEnv(config) {
  return {
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    MCCLUSTER_COMPUTE_URL: config.compute_url, MCCLUSTER_ORG_ID: config.org_id,
    MCCLUSTER_NODE_NAME: config.display_name, MCCLUSTER_NODE_STATE_DIR: config.state_root,
    MCCLUSTER_NODE_MANIFEST: path.join(config.state_root, 'capabilities.json'),
    MCCLUSTER_NODE_POLL_MS: '1000', MCCLUSTER_NODE_HEARTBEAT_MS: '30000',
    MCCLUSTER_NODE_ENGINE_PROBE_MS: '15000', MCCLUSTER_NODE_SHUTDOWN_GRACE_MS: '30000',
    MCCLUSTER_OLLAMA_URL: 'http://127.0.0.1:11434', MCCLUSTER_OLLAMA_MODEL: MAC_MODEL,
    MCCLUSTER_OLLAMA_IMPLEMENTATIONS: 'qwen3.8b.local=qwen3:8b',
    MCCLUSTER_OLLAMA_CONTEXT: String(MAC_CONTEXT), MCCLUSTER_OLLAMA_KEEP_ALIVE: '5m',
    MCCLUSTER_OLLAMA_ON_DEMAND_KEEP_ALIVE: '5m', MCCLUSTER_OLLAMA_WARM_ON_START: 'false',
    MCCLUSTER_OLLAMA_ADAPTER_PORT: '4790', MCCLUSTER_OLLAMA_ADAPTER_MAX_QUEUE: '1'
  };
}

function xml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]); }
export function renderLaunchAgent(config, kind) {
  if (!['agent', 'adapter'].includes(kind) || !safePath(config.runtime_root)) throw new Error('Invalid launch agent configuration.');
  const label = `org.mccluster.node.${kind}`;
  const file = kind === 'agent' ? 'node-agent.mjs' : 'ollama-adapter.mjs';
  const environment = Object.entries(runtimeEnv(config)).map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(config.node_path)}</string><string>${xml(path.join(config.runtime_root, 'src', 'compute', file))}</string></array>
<key>WorkingDirectory</key><string>${xml(config.runtime_root)}</string>
<key>EnvironmentVariables</key><dict>${environment}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer><key>ExitTimeOut</key><integer>35</integer>
<key>ProcessType</key><string>Background</string><key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(path.join(config.state_root, 'logs', `${kind}.log`))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(config.state_root, 'logs', `${kind}.log`))}</string>
</dict></plist>\n`;
}

/** Refuse symlinks on the full path before touching a key, config, log or launch file. */
export async function noSymlinkPath(target) {
  const absolute = path.resolve(target);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error('A node path contains a symbolic link. Choose a private, regular directory.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function privateDir(directory, { sharedParent = false } = {}) {
  await noSymlinkPath(directory);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if (!sharedParent) await fs.chmod(directory, 0o700);
}
export async function privateWrite(filename, value) {
  await noSymlinkPath(filename);
  await privateDir(path.dirname(filename));
  const tmp = `${filename}.${randomUUID()}.tmp`;
  try { await fs.writeFile(tmp, value, { mode: 0o600, flag: 'wx' }); await fs.rename(tmp, filename); }
  finally { await fs.rm(tmp, { force: true }); }
}
const writeJson = (filename, value) => privateWrite(filename, `${JSON.stringify(value, null, 2)}\n`);
async function savedConfig(stateRoot) {
  const file = path.join(stateRoot, 'node.config.json');
  await noSymlinkPath(file);
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (value.schema !== CONFIG_SCHEMA) throw new Error('Unknown node configuration schema.');
    return value;
  } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

/** Copy only the runtime import closure, never server secrets, environment files or the repository. */
export async function runtimeBundle(coreRoot = CORE_ROOT) {
  const files = new Map();
  async function collect(relative) {
    if (files.has(relative)) return;
    if (relative.startsWith('../') || path.isAbsolute(relative) || !relative.endsWith('.mjs')) throw new Error('Runtime import escaped its source root.');
    const filename = path.join(coreRoot, relative);
    await noSymlinkPath(filename);
    const bytes = await fs.readFile(filename);
    files.set(relative, bytes);
    const source = bytes.toString('utf8');
    for (const match of source.matchAll(/\b(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
      if (match[1].startsWith('node:')) continue;
      if (!match[1].startsWith('.')) throw new Error('The device runtime needs an unsupported external dependency.');
      await collect(path.normalize(path.join(path.dirname(relative), match[1])));
    }
  }
  for (const entry of ['src/compute/node-agent.mjs', 'src/compute/ollama-adapter.mjs', 'macos/mccluster-node.mjs']) await collect(entry);
  const manifestPath = 'node-manifests/owner-macos-metal.json';
  const manifest = await fs.readFile(path.join(coreRoot, manifestPath));
  files.set(manifestPath, manifest);
  const hash = createHash('sha256');
  for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) { hash.update(name); hash.update('\0'); hash.update(bytes); }
  return { files, digest: hash.digest('hex') };
}

export async function prepareInstall(config, { coreRoot = CORE_ROOT, dryRun = false } = {}) {
  const bundle = await runtimeBundle(coreRoot);
  const next = { ...config, runtime_root: path.join(config.state_root, 'runtime', bundle.digest), runtime_digest: bundle.digest };
  const plan = { device: config.display_name, model: MAC_MODEL, context: MAC_CONTEXT, max_leases: 1,
    state_root: config.state_root, runtime_digest: bundle.digest, runtime_files: bundle.files.size,
    launch_agents: LABELS, credential_input: 'hidden terminal prompt, then one child stdin pipe',
    writes: !dryRun, launches: false, downloads: false };
  if (dryRun) return { config: next, plan };
  await privateDir(config.state_root);
  await noSymlinkPath(path.join(config.state_root, 'identity.json'));
  await privateDir(path.join(config.state_root, 'logs'));
  for (const [name, bytes] of bundle.files) await privateWrite(path.join(next.runtime_root, name), bytes);
  await privateDir(config.launch_dir, { sharedParent: true });
  for (const kind of ['adapter', 'agent']) {
    const filename = path.join(config.launch_dir, `org.mccluster.node.${kind}.plist`);
    await noSymlinkPath(filename);
    // The shared LaunchAgents directory is not chmodded by privateWrite.
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, renderLaunchAgent(next, kind), { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, filename); }
    finally { await fs.rm(temporary, { force: true }); }
    const log = path.join(config.state_root, 'logs', `${kind}.log`);
    await noSymlinkPath(log);
    await fs.writeFile(log, '', { mode: 0o600, flag: 'a' }); await fs.chmod(log, 0o600);
  }
  const manifest = JSON.parse(bundle.files.get('node-manifests/owner-macos-metal.json'));
  // No job can arrive until this installation passes its benchmark.
  await writeJson(path.join(config.state_root, 'capabilities.json'), { ...manifest, capabilities: [] });
  await writeJson(path.join(config.state_root, 'node.config.json'), next);
  return { config: next, plan };
}

export async function hiddenCredential() {
  // Open the terminal directly: piped input is refused, and nothing is added to shell history.
  const inputFd = fsSync.openSync('/dev/tty', 'r');
  const outputFd = fsSync.openSync('/dev/tty', 'w');
  const input = new ReadStream(inputFd);
  const output = new WriteStream(outputFd);
  if (!input.isTTY || !output.isTTY) { input.destroy(); output.destroy(); throw new Error('Enrollment needs an interactive terminal.'); }
  output.write('Paste the one-time enrollment credential (hidden), then press Return: ');
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let bytes = [], finished = false;
    function done(error) {
      if (finished) return;
      finished = true;
      input.removeListener('data', onData);
      input.setRawMode(false); input.pause(); output.write('\n');
      const value = Buffer.from(bytes); bytes.fill(0); bytes = [];
      input.destroy(); output.end();
      if (error) { value.fill(0); reject(error); } else resolve(value);
    }
    function onData(chunk) {
      for (const byte of chunk) {
        if (byte === 3 || byte === 4) return done(new Error('Enrollment canceled.'));
        if (byte === 13 || byte === 10) return done();
        if (byte === 127 || byte === 8) { bytes.pop(); continue; }
        if (byte < 33 || byte > 126 || bytes.length >= 2048) return done(new Error('Invalid enrollment credential.'));
        bytes.push(byte);
      }
    }
    input.on('data', onData);
    input.once('end', () => done(new Error('The terminal closed before enrollment.')));
    input.once('error', () => done(new Error('The terminal could not read the credential.')));
  });
}

export async function enrollWithPipe(config, credential, { spawnImpl = spawn, timeoutMs = 120_000 } = {}) {
  if (!Buffer.isBuffer(credential) || !/^mcen1_[A-Za-z0-9_-]{43}$/.test(credential.toString('utf8'))) {
    credential?.fill?.(0); throw new Error('Use the short-lived credential from Devices → Add this device.');
  }
  const env = { ...runtimeEnv(config), MCCLUSTER_NODE_ENROLL_ONLY: '1', MCCLUSTER_NODE_ENROLL_TOKEN_STDIN: '1' };
  return new Promise((resolve, reject) => {
    // Do not inherit a shell's service-role keys or previous enrollment token.
    const child = spawnImpl(config.node_path, [path.join(config.runtime_root, 'src', 'compute', 'node-agent.mjs')],
      { cwd: config.runtime_root, env, stdio: ['pipe', 'ignore', 'ignore'] });
    let expired = false;
    const timer = setTimeout(() => { expired = true; child.kill('SIGKILL'); }, timeoutMs);
    child.once('error', () => { clearTimeout(timer); credential.fill(0); reject(new Error('The enrollment worker could not start.')); });
    child.once('exit', code => {
      clearTimeout(timer); credential.fill(0);
      if (code === 0 && !expired) resolve({ enrolled: true });
      else reject(new Error(expired ? 'Enrollment timed out. Check Wi-Fi and Core, then request a fresh credential.'
        : 'Enrollment was refused. The credential may be expired or already used. Request a fresh credential in Devices.'));
    });
    child.stdin.on('error', () => { /* exit is authoritative; never print the credential */ });
    child.stdin.end(Buffer.concat([credential, Buffer.from('\n')]), () => credential.fill(0));
  });
}

function requireMac() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Install and service commands require the target Apple Silicon Mac. Use --dry-run to review on another system.');
  if (process.getuid?.() === 0) throw new Error('Run as your own macOS account, without sudo.');
}
function launch(config, kind, action, { run = execFileSync } = {}) {
  const domain = `gui/${process.getuid()}`;
  const file = path.join(config.launch_dir, `org.mccluster.node.${kind}.plist`);
  if (action === 'stop') {
    try { run('/bin/launchctl', ['bootout', domain, file], { stdio: 'ignore', timeout: 40_000 }); }
    catch (error) { if (![3, 5, 36, 113].includes(error.status)) throw new Error('Could not stop the background worker. Check Login Items in System Settings.'); }
  } else {
    run('/usr/bin/plutil', ['-lint', file], { stdio: 'ignore', timeout: 5000 });
    try { run('/bin/launchctl', ['bootstrap', domain, file], { stdio: 'ignore', timeout: 10_000 }); }
    catch { throw new Error('Could not start the background worker. Sign in to the Mac desktop and allow it in System Settings → Login Items.'); }
  }
}

export async function saveBenchmark(config, receipt, { coreRoot = CORE_ROOT } = {}) {
  const measurementsFile = path.join(config.state_root, 'measured-inference.json');
  await noSymlinkPath(measurementsFile);
  let existing = {};
  try { existing = JSON.parse(await fs.readFile(measurementsFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing.schema && existing.schema !== 'mccluster-measured-inference/1') throw new Error('Unknown measurement file schema.');
  await writeJson(measurementsFile, { schema: 'mccluster-measured-inference/1', measurements: { ...existing.measurements, [MAC_MODEL]: receipt } });
  await writeJson(path.join(config.state_root, 'macos-benchmark.json'), { schema: 'mccluster-macos-benchmark/1', ...receipt });
  const template = JSON.parse(await fs.readFile(path.join(coreRoot, 'node-manifests/owner-macos-metal.json'), 'utf8'));
  await writeJson(path.join(config.state_root, 'capabilities.json'), receipt.benchmark_passed ? template : { ...template, capabilities: [] });
}

async function preflightOllama() {
  const base = localOllamaUrl();
  let tags;
  try { tags = await ollamaJson(base, '/api/tags'); }
  catch { throw new Error('Open the owner-installed Ollama app on this Mac first. It must listen only on 127.0.0.1:11434.'); }
  if (!(tags.models || []).some(model => model.name === MAC_MODEL || model.model === MAC_MODEL)) {
    throw new Error('Install the starting model locally first: ollama pull qwen3:8b. Then repeat this command.');
  }
}

async function status(config) {
  let receipt = null, identity = false;
  try { receipt = JSON.parse(await fs.readFile(path.join(config.state_root, 'macos-benchmark.json'), 'utf8')); } catch { /* absent */ }
  try { await fs.access(path.join(config.state_root, 'identity.json')); identity = true; } catch { /* absent */ }
  let adapter = false;
  try { adapter = (await ollamaJson('http://127.0.0.1:4790', '/ready?implementation=qwen3.8b.local')).ready === true; } catch { /* unavailable */ }
  return { installed: Boolean(config.runtime_root), device_identity_present: identity, enrollment_recorded: Boolean(config.enrolled_at),
    adapter_ready: adapter, model: MAC_MODEL, context: MAC_CONTEXT, benchmark: receipt,
    note: 'Core Devices is authoritative for connected, paused, revoked and lease status.' };
}

export async function main(argv = process.argv.slice(2)) {
  const { command, opts } = parseArgs(argv);
  if (command === 'help') {
    console.log('McCluster Mac worker\n  install --setup-file ./mccluster-device-setup.json [--dry-run]\n  install --name "Studio iMac" --org-id <uuid> --compute-url https://compute.mccluster.org [--dry-run]\n  enroll | benchmark | status | start | stop [--state-root <absolute path>]\nRequires owner-installed Node 20+, Ollama and qwen3:8b. Credentials are read only by a hidden terminal prompt.');
    return;
  }
  const setup = opts.setup_file ? await readSetupFile(opts.setup_file) : {};
  const previous = await savedConfig(path.resolve(opts.state_root || defaultStateRoot()));
  let config = resolveConfig({ ...setup, ...opts }, previous);
  if (command === 'status') { console.log(JSON.stringify(await status(config), null, 2)); return; }
  if (opts.dry_run) { console.log(JSON.stringify((await prepareInstall(config, { dryRun: true })).plan, null, 2)); return; }
  requireMac();
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Install Node.js 20 or newer before the worker.');
  if (command === 'stop') { launch(config, 'agent', 'stop'); launch(config, 'adapter', 'stop'); console.log('Worker stopped locally. Existing leases finish or expire under Core rules.'); return; }
  if (command === 'start') {
    if (!config.enrolled_at || !config.runtime_root) throw new Error('Install and enroll this worker first.');
    launch(config, 'adapter', 'start'); launch(config, 'agent', 'start'); console.log('Background worker started. Check Devices for its signed heartbeat.'); return;
  }
  if (command === 'install') {
    await preflightOllama();
    if (previous.runtime_root) { launch(config, 'agent', 'stop'); launch(config, 'adapter', 'stop'); }
    config = (await prepareInstall(config)).config;
  } else if (!config.runtime_root) throw new Error('Install this worker first.');
  if (command === 'install' && !config.enrolled_at || command === 'enroll') {
    await enrollWithPipe(config, await hiddenCredential());
    config.enrolled_at = new Date().toISOString();
    await writeJson(path.join(config.state_root, 'node.config.json'), config);
    console.log('Device enrolled. The credential has been discarded.');
    if (command === 'enroll') console.log('Run benchmark next to verify the local model and start the worker.');
  }
  if (command === 'install' || command === 'benchmark') {
    // Pause claims locally while the owner explicitly benchmarks. This does not cancel a Core job silently.
    if (command === 'benchmark') { launch(config, 'agent', 'stop'); launch(config, 'adapter', 'stop'); }
    console.log('Benchmarking qwen3:8b at 4K context. The worker will accept jobs only if the benchmark passes.');
    let receipt;
    try { receipt = await benchmarkMac(); }
    catch (error) {
      const template = JSON.parse(await fs.readFile(path.join(CORE_ROOT, 'node-manifests/owner-macos-metal.json'), 'utf8'));
      await writeJson(path.join(config.state_root, 'capabilities.json'), { ...template, capabilities: [] });
      throw error;
    }
    await saveBenchmark(config, receipt);
    console.log(JSON.stringify(receipt, null, 2));
    launch(config, 'adapter', 'start'); launch(config, 'agent', 'start');
    if (!receipt.benchmark_passed) throw new Error(receipt.recovery);
    console.log('Test passed. Return to Devices and wait for model readiness and a signed heartbeat.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
