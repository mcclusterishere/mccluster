#!/usr/bin/env node
// One owned production worker against the production staging: the
// repository's production executor (core/src/production/executor.mjs, on
// 127.0.0.1:4792) and the REAL node agent (core/src/compute/node-agent.mjs)
// enrolled over the staging's TLS ingress with the signed compute protocol.
//
//   node scripts/staging/production/worker.mjs --run-dir <staging run dir> \
//     --state-dir <new folder for this node's identity> \
//     --executor-config %LOCALAPPDATA%\McCluster\production-executor.json \
//     [--manifest core/node-manifests/prime-production.json] [--name prime-staging]
//
// The state directory is this run's own (identity, capabilities), never
// %ProgramData%\mccluster-node: the node Prime already runs is not touched.
// Stop: SIGINT, or a file named "stop" in the state directory.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function parseArgs(argv) {
  const out = { manifest: path.join(ROOT, 'core/node-manifests/prime-production.json'), name: 'prime-staging' };
  for (let i = 0; i < argv.length; i += 2) {
    const [a, v] = [argv[i], argv[i + 1]];
    if (a === '--run-dir') out.runDir = path.resolve(v);
    else if (a === '--state-dir') out.stateDir = path.resolve(v);
    else if (a === '--executor-config') out.executorConfig = path.resolve(v);
    else if (a === '--manifest') out.manifest = path.resolve(v);
    else if (a === '--name') out.name = String(v).slice(0, 60);
    else throw new Error(`unknown argument ${a}`);
  }
  for (const key of ['runDir', 'stateDir', 'executorConfig']) if (!out[key]) throw new Error(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
  if (/[\\/]ProgramData[\\/]mccluster-node$/i.test(out.stateDir)) throw new Error('use a new state directory, not the node Prime already runs');
  return out;
}

function get(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => { let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(body) }); } catch { resolve({ status: res.statusCode, body: null }); } }); });
    req.on('error', () => resolve({ status: 0 })); req.on('timeout', () => { req.destroy(); resolve({ status: 0 }); });
  });
}

function scrubbedEnv(extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(?:SUPABASE_|CORE_|MCCLUSTER_)/i.test(k)) env[k] = v;
  return { ...env, ...extra };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const staging = JSON.parse(fs.readFileSync(path.join(o.runDir, 'staging.json'), 'utf8'));
  if (staging.production !== false || !/^https:\/\/127\.0\.0\.1:\d+$/.test(staging.urls.compute)) throw new Error('staging.json does not describe a loopback production staging');
  fs.mkdirSync(o.stateDir, { recursive: true });
  const manifestCopy = path.join(o.stateDir, 'capabilities.json');
  fs.copyFileSync(o.manifest, manifestCopy);
  const log = (name) => fs.createWriteStream(path.join(o.stateDir, name), { flags: 'a' });

  const executor = spawn(process.execPath, [path.join(ROOT, 'core/src/production/executor.mjs')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: scrubbedEnv({ MCCLUSTER_PRODUCTION_CONFIG: o.executorConfig })
  });
  const exLog = log('executor.log'); executor.stdout.pipe(exLog); executor.stderr.pipe(exLog);
  let ready = null;
  for (const deadline = Date.now() + 20_000; Date.now() < deadline;) {
    const r = await get('http://127.0.0.1:4792/ready');
    if (r.status === 200) { ready = r.body; break; }
    if (executor.exitCode !== null) throw new Error(`the production executor exited (${executor.exitCode}); see ${path.join(o.stateDir, 'executor.log')}`);
    await new Promise((res) => setTimeout(res, 300));
  }
  if (!ready) throw new Error('the production executor did not answer /ready on 127.0.0.1:4792');

  const agent = spawn(process.execPath, [path.join(ROOT, 'core/src/compute/node-agent.mjs')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: scrubbedEnv({
      MCCLUSTER_COMPUTE_URL: staging.urls.compute, MCCLUSTER_ORG_ID: staging.org_id,
      MCCLUSTER_NODE_ENROLL_TOKEN: fs.readFileSync(path.join(o.runDir, staging.files.enroll_token), 'utf8').trim(),
      MCCLUSTER_NODE_NAME: o.name, MCCLUSTER_NODE_STATE_DIR: o.stateDir, MCCLUSTER_NODE_MANIFEST: manifestCopy,
      MCCLUSTER_NODE_POLL_MS: '2000', MCCLUSTER_NODE_HEARTBEAT_MS: '10000',
      NODE_EXTRA_CA_CERTS: staging.ca_cert_path
    })
  });
  const agLog = log('node-agent.log'); agent.stdout.pipe(agLog); agent.stderr.pipe(agLog);
  console.log(JSON.stringify({ event: 'production_worker_started', name: o.name, compute: staging.urls.compute, state_dir: o.stateDir, executor: { node_label: ready.node_label, capabilities: ready.capabilities, unreal: ready.engines?.unreal || null, unreal_projects: ready.unreal_projects || {} }, pids: { executor: executor.pid, node_agent: agent.pid } }));

  let stopping = false;
  const stop = (reason) => {
    if (stopping) return; stopping = true;
    console.log(JSON.stringify({ event: 'production_worker_stopping', reason }));
    try { agent.kill('SIGINT'); } catch {}
    setTimeout(() => { try { executor.kill('SIGTERM'); } catch {} process.exit(0); }, 3000).unref();
  };
  agent.on('exit', (c) => { if (!stopping) { console.error(JSON.stringify({ event: 'node_agent_exited', code: c })); stop('node-agent-exited'); } });
  executor.on('exit', (c) => { if (!stopping) { console.error(JSON.stringify({ event: 'executor_exited', code: c })); stop('executor-exited'); } });
  setInterval(() => { if (fs.existsSync(path.join(o.stateDir, 'stop'))) { fs.rmSync(path.join(o.stateDir, 'stop'), { force: true }); stop('stop-file'); } }, 1000);
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

main().catch((error) => { console.error(JSON.stringify({ event: 'production_worker_fatal', error: error.message })); process.exit(1); });
