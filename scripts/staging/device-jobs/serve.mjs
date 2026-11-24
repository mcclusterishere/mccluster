#!/usr/bin/env node
// Real-device staging: the same private composition run.mjs proves with a
// fixture (PGlite with the repository's compute SQL, the PostgREST shim, the
// REAL Core compute gateway, a self-signed TLS ingress), kept running so real
// devices can enrol and take real jobs. Everything listens on 127.0.0.1 only.
// The admin token, the enrolment token, the receipt key and the CA are
// generated for this run and written only to --run-dir; stdout carries one
// JSON line with URLs and file names, never a secret value.
//
//   PGLITE_MODULE_PATH=<dir>/node_modules/@electric-sql/pglite/dist/index.js \
//     node scripts/staging/device-jobs/serve.mjs --run-dir <dir> [--port-base 47800] [--org <uuid>]
//
// It stays up until SIGINT/SIGTERM, until stdin closes (unless --no-stdin), or
// until a file named "stop" appears in the run directory (the clean stop for a
// detached process on Windows). The database is in memory: stopping it ends
// the staging and everything enrolled against it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadComputeSchema, openPglite, startPostgrestShim } from './pglite-postgrest.mjs';
import { generateReceiptKey } from '../../../core/src/compute/jobs.mjs';
import { RUN_FILES, STAGING_SCHEMA, requestJson, validateServeOptions } from './real-device-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let options;
try { options = validateServeOptions(process.argv.slice(2)); }
catch (error) { console.error(JSON.stringify({ event: 'staging_usage_error', error: error.message })); process.exit(2); }

const { runDir, org, ports } = options;
const file = (name) => path.join(runDir, name);
fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
try {
  const prior = JSON.parse(fs.readFileSync(file(RUN_FILES.staging), 'utf8'));
  if (prior?.pids?.serve && !prior.stopped_at && alive(prior.pids.serve)) {
    console.error(JSON.stringify({ event: 'staging_already_running', pid: prior.pids.serve }));
    process.exit(3);
  }
} catch { /* no prior staging in this run directory */ }
fs.rmSync(file(RUN_FILES.stop), { force: true });

const serveLog = fs.createWriteStream(file(RUN_FILES.serve_log), { flags: 'a' });
function log(record) { serveLog.write(`${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`); }
function writeSecret(name, value) { fs.writeFileSync(file(name), value, { mode: 0o600 }); }

function makeCert() {
  const bin = process.env.OPENSSL_BIN || 'openssl';
  try {
    execFileSync(bin, ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', file(RUN_FILES.tls_key), '-out', file(RUN_FILES.ca_cert), '-days', '7', '-subj', '/CN=mccluster-device-jobs-staging', '-addext', `subjectAltName=${options.tlsSans.join(',')}`], { stdio: 'ignore', windowsHide: true });
  } catch (error) {
    throw new Error(`openssl could not write the staging certificate (${error.code || error.message}); put openssl on PATH or set OPENSSL_BIN`);
  }
}

function startTlsIngress() {
  const server = https.createServer({ key: fs.readFileSync(file(RUN_FILES.tls_key)), cert: fs.readFileSync(file(RUN_FILES.ca_cert)) }, (req, res) => {
    const upstream = http.request({ host: '127.0.0.1', port: ports.gateway, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${ports.gateway}` } }, (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(ports.tls, '127.0.0.1', () => resolve(server)); });
}

// The gateway child gets this run's values only: nothing named for the Core,
// Supabase or a node in the caller's environment reaches it.
function gatewayEnv(extra) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^(?:SUPABASE_|CORE_|MCCLUSTER_)/i.test(key)) env[key] = value;
  return { ...env, ...extra };
}

let db; let shim; let tls; let gateway; let stopping = false; let stopWatch;

async function shutdown(reason, code = 0) {
  if (stopping) return;
  stopping = true;
  log({ event: 'staging_stopping', reason });
  clearInterval(stopWatch);
  // The gateway holds no lease of its own and its database ends with this process,
  // so a signal is enough here (on Windows it simply terminates the child). The
  // node agent, which does hold leases, is stopped through its stop file instead
  // (enroll-device.mjs).
  if (gateway && gateway.exitCode === null) {
    await new Promise((resolve) => { gateway.once('exit', resolve); gateway.kill('SIGTERM'); setTimeout(() => { try { gateway.kill('SIGKILL'); } catch {} resolve(); }, 6_000).unref(); });
  }
  try { tls?.closeAllConnections?.(); tls?.close(); } catch {}
  try { await shim?.close(); } catch {}
  try { await db?.close(); } catch {}
  try {
    const current = JSON.parse(fs.readFileSync(file(RUN_FILES.staging), 'utf8'));
    fs.writeFileSync(file(RUN_FILES.staging), JSON.stringify({ ...current, stopped_at: new Date().toISOString(), stop_reason: reason }, null, 2));
  } catch {}
  fs.rmSync(file(RUN_FILES.stop), { force: true });
  log({ event: 'staging_stopped', reason });
  serveLog.end(() => process.exit(code));
  setTimeout(() => process.exit(code), 2_000).unref();
}

async function main() {
  const secrets = { apiKey: crypto.randomBytes(24).toString('hex'), enroll: crypto.randomBytes(24).toString('hex'), admin: crypto.randomBytes(24).toString('hex') };
  const receiptKey = generateReceiptKey();
  writeSecret(RUN_FILES.admin_token, secrets.admin);
  writeSecret(RUN_FILES.enroll_token, secrets.enroll);
  writeSecret(RUN_FILES.receipt_signing_key, receiptKey.privateKeyPem);
  fs.writeFileSync(file(RUN_FILES.receipt_public_key), receiptKey.publicKeyPem);
  makeCert();
  try { fs.chmodSync(file(RUN_FILES.tls_key), 0o600); } catch {}

  db = await openPglite();
  const schemaFiles = await loadComputeSchema(db, ROOT);
  await db.query('insert into public.orgs(id, slug, enabled) values ($1, $2, true)', [org, 'staging']);
  shim = await startPostgrestShim({ db, apiKey: secrets.apiKey, port: ports.shim, log });
  tls = await startTlsIngress();

  const gatewayLog = fs.createWriteStream(file(RUN_FILES.gateway_log), { flags: 'a' });
  gateway = spawn(process.execPath, [path.join(ROOT, 'core/src/compute/gateway.mjs')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: gatewayEnv({
      SUPABASE_URL: shim.url, SUPABASE_SERVICE_ROLE_KEY: secrets.apiKey, MCCLUSTER_ORG_ID: org, MCCLUSTER_CORE_ID: 'staging-real-device-gateway',
      CORE_COMPUTE_HOST: '127.0.0.1', CORE_COMPUTE_PORT: String(ports.gateway), CORE_COMPUTE_ENROLL_TOKEN: secrets.enroll, CORE_COMPUTE_ADMIN_TOKEN: secrets.admin,
      CORE_COMPUTE_LEASE_SECONDS: String(options.leaseSeconds), CORE_RECEIPT_SIGNING_KEY: receiptKey.privateKeyPem
    })
  });
  gateway.stdout.pipe(gatewayLog); gateway.stderr.pipe(gatewayLog);
  gateway.on('exit', (code, signal) => { log({ event: 'gateway_exited', code, signal }); if (!stopping) shutdown('gateway-exited', 1); });

  const gatewayUrl = `http://127.0.0.1:${ports.gateway}`;
  const computeUrl = `https://127.0.0.1:${ports.tls}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    try { if ((await requestJson(`${computeUrl}/health`, { ca: fs.readFileSync(file(RUN_FILES.ca_cert)), timeoutMs: 2_000 })).status === 200) break; } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('the gateway did not answer /health through the TLS ingress within 30 s');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const staging = {
    schema: STAGING_SCHEMA,
    started_at: new Date().toISOString(),
    org_id: org,
    urls: { compute: computeUrl, gateway_loopback: gatewayUrl },
    bind: '127.0.0.1',
    tls_subject_alt_names: options.tlsSans,
    ca_cert_path: file(RUN_FILES.ca_cert),
    receipt_key_id: receiptKey.keyId,
    lease_seconds: options.leaseSeconds,
    files: { ...RUN_FILES },
    pids: { serve: process.pid, gateway: gateway.pid },
    schema_files: schemaFiles,
    database: 'PGlite, in memory: it ends with this process',
    stop: `create a file named "${RUN_FILES.stop}" in the run directory, or send SIGINT`
  };
  fs.writeFileSync(file(RUN_FILES.staging), JSON.stringify(staging, null, 2));
  log({ event: 'staging_ready', ports, pids: staging.pids });
  // The one stdout line: URLs and file names. No token, no key.
  console.log(JSON.stringify({ event: 'staging_ready', schema: STAGING_SCHEMA, org_id: org, urls: staging.urls, run_dir: runDir, files: staging.files, receipt_key_id: receiptKey.keyId, pids: staging.pids }));

  stopWatch = setInterval(() => { if (fs.existsSync(file(RUN_FILES.stop))) shutdown('stop-file'); }, 1_000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
if (process.platform === 'win32') process.on('SIGBREAK', () => shutdown('SIGBREAK'));
if (options.watchStdin) { process.stdin.on('end', () => shutdown('stdin-closed')); process.stdin.on('error', () => {}); process.stdin.resume(); }

main().catch((error) => {
  log({ event: 'staging_fatal', error: error.message });
  console.error(JSON.stringify({ event: 'staging_fatal', error: error.message }));
  shutdown('fatal', 1);
});
