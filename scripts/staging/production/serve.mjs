#!/usr/bin/env node
// Production staging: an isolated McCluster Core for one owned worker to
// take real production jobs. It composes, on 127.0.0.1 only:
//
//   * PGlite (in memory) with the repository's compute SQL and the PENDING
//     supabase/pending/production_pipeline_v1.sql (applied here, to this
//     disposable database only; never to Supabase);
//   * the PostgREST shim over it;
//   * the REAL Core compute gateway (core/src/compute/gateway.mjs) behind a
//     self-signed TLS ingress: the node agent's signed protocol, unchanged;
//   * the production API (production-api.mjs): the nine core.production.*
//     actions for Creator Suite, with an owner token.
//
//   PGLITE_MODULE_PATH=<dir>/node_modules/@electric-sql/pglite/dist/index.js \
//     node scripts/staging/production/serve.mjs --run-dir <dir> \
//       --seed scripts/staging/production/get-it-back-s31.seed.json \
//       --media-root <production project root on this machine> [--port-base 47900]
//
// Nothing here reaches the canonical Supabase project, the OVH Core,
// Cloudflare or a production host. The run directory holds this run's
// tokens and keys (admin.token, enroll.token, owner.token, tls-key.pem,
// ca-cert.pem): keep it out of Git
// and out of chat. stdout carries one JSON line with URLs and file names.
// Stop: SIGINT, or a file named "stop" in the run directory.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadComputeSchema, openPglite, startPostgrestShim } from './pglite-postgrest.mjs';

export const STAGING_SCHEMA = 'mccluster-production-staging/1';
export const RUN_FILES = Object.freeze({
  staging: 'staging.json', stop: 'stop', admin_token: 'admin.token', enroll_token: 'enroll.token', owner_token: 'owner.token',
  tls_key: 'tls-key.pem', ca_cert: 'ca-cert.pem',
  serve_log: 'serve.log', gateway_log: 'gateway.log', api_log: 'production-api.log'
});
export const PRODUCTION_SQL = 'supabase/pending/production_pipeline_v1.sql';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PRODUCTION_HOSTS = /(^|\.)(mccluster\.org|humanuprise\.com|equityuprise\.com|supabase\.co)$/i;

function parseArgs(argv) {
  const out = { mediaRoots: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]; const v = argv[i + 1];
    if (a === '--run-dir') { out.runDir = path.resolve(v); i += 1; }
    else if (a === '--seed') { out.seed = path.resolve(v); i += 1; }
    else if (a === '--media-root') { out.mediaRoots.push(path.resolve(v)); i += 1; }
    else if (a === '--port-base') { out.portBase = Number(v); i += 1; }
    else if (a === '--org') { out.org = v; i += 1; }
    else if (a === '--lease-seconds') { out.leaseSeconds = Number(v); i += 1; }
    else if (a === '--no-stdin') out.noStdin = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!out.runDir) throw new Error('--run-dir is required');
  if (!out.seed) throw new Error('--seed is required (the production project record to stage)');
  if (!out.mediaRoots.length) throw new Error('--media-root is required (the production project root the worker renders into)');
  for (const root of out.mediaRoots) if (!fs.existsSync(root)) throw new Error(`--media-root ${root} does not exist`);
  if (out.portBase != null && !(Number.isInteger(out.portBase) && out.portBase >= 1024 && out.portBase <= 65000)) throw new Error('--port-base must be 1024..65000');
  out.org = out.org || crypto.randomUUID();
  out.leaseSeconds = out.leaseSeconds || 120;
  return out;
}

async function freePort() {
  return new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
}

// Loads the staged project: the project row, its owner, assets (the
// approved Unreal sequence among them), shots and consents.
export async function seedProject(db, org, ownerProfile, seed) {
  await db.query('insert into public.org_members(org_id, profile_id, role) values ($1, $2, $3)', [org, ownerProfile, 'owner']);
  await db.query('insert into public.production_projects(id, org_id, title, status, settings) values ($1, $2, $3, $4, $5::jsonb)', [seed.id, org, seed.title, seed.status || 'active', JSON.stringify(seed.settings || {})]);
  for (const a of seed.assets || []) {
    await db.query('insert into public.production_assets(org_id, project_id, asset_id, version, kind, path, sha256, bytes, approved, editable, label, metadata) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)',
      [org, seed.id, a.asset_id, a.version || 1, a.kind, a.path, a.sha256 || null, a.bytes ?? null, a.approved === true, a.editable !== false, a.label || null, JSON.stringify(a.metadata || {})]);
  }
  for (const s of seed.shots || []) {
    await db.query('insert into public.production_shots(org_id, project_id, shot_id, episode, start_frame, end_frame, fps, camera, line_id, actors) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [org, seed.id, s.shot_id, s.episode || null, s.start_frame ?? null, s.end_frame ?? null, s.fps || 24, s.camera || null, s.line_id || null, s.actors || []]);
  }
  for (const c of seed.consents || []) {
    await db.query('insert into public.production_consents(org_id, project_id, actor_id, scope, evidence_ref) values ($1,$2,$3,$4,$5)', [org, seed.id, c.actor_id, c.scope || [], c.evidence_ref || null]);
  }
}

export async function loadProductionStaging(db, root = ROOT) {
  const files = await loadComputeSchema(db, root);
  await db.exec(`create table if not exists public.org_members(org_id uuid not null references public.orgs(id) on delete cascade, profile_id uuid not null, role text not null, primary key (org_id, profile_id));`);
  await db.exec(fs.readFileSync(path.join(root, PRODUCTION_SQL), 'utf8'));
  return [...files, 'public.org_members (staging stub)', `${PRODUCTION_SQL} (pending: applied to this disposable database only)`];
}

function childEnv(extra) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^(?:SUPABASE_|CORE_|MCCLUSTER_|PRODUCTION_)/i.test(key)) env[key] = value;
  return { ...env, ...extra };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { runDir, org } = options;
  const file = (name) => path.join(runDir, name);
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  fs.rmSync(file(RUN_FILES.stop), { force: true });
  const seed = JSON.parse(fs.readFileSync(options.seed, 'utf8'));
  const base = options.portBase;
  const ports = { gateway: base ?? await freePort(), tls: base != null ? base + 1 : await freePort(), shim: base != null ? base + 2 : await freePort(), api: base != null ? base + 3 : await freePort() };
  const serveLog = fs.createWriteStream(file(RUN_FILES.serve_log), { flags: 'a' });
  const log = (record) => serveLog.write(`${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
  const secret = (name, value) => fs.writeFileSync(file(name), value, { mode: 0o600 });

  const secrets = { apiKey: crypto.randomBytes(24).toString('hex'), enroll: crypto.randomBytes(24).toString('hex'), admin: crypto.randomBytes(24).toString('hex'), owner: crypto.randomBytes(32).toString('hex') };
  const ownerProfile = crypto.randomUUID();
  secret(RUN_FILES.admin_token, secrets.admin);
  secret(RUN_FILES.enroll_token, secrets.enroll);
  secret(RUN_FILES.owner_token, secrets.owner);
  execFileSync(process.env.OPENSSL_BIN || 'openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', file(RUN_FILES.tls_key), '-out', file(RUN_FILES.ca_cert), '-days', '7', '-subj', '/CN=mccluster-production-staging', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore', windowsHide: true });

  const db = await openPglite();
  await db.query('select 1');
  const schemaFiles = await loadProductionStaging(db);
  await db.query('insert into public.orgs(id, slug, enabled) values ($1, $2, true)', [org, 'production-staging']);
  await seedProject(db, org, ownerProfile, seed);
  const shim = await startPostgrestShim({ db, apiKey: secrets.apiKey, port: ports.shim, log });

  const tlsServer = https.createServer({ key: fs.readFileSync(file(RUN_FILES.tls_key)), cert: fs.readFileSync(file(RUN_FILES.ca_cert)) }, (req, res) => {
    const up = http.request({ host: '127.0.0.1', port: ports.gateway, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${ports.gateway}` } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  await new Promise((resolve, reject) => { tlsServer.once('error', reject); tlsServer.listen(ports.tls, '127.0.0.1', resolve); });

  const shared = { SUPABASE_URL: shim.url, SUPABASE_SERVICE_ROLE_KEY: secrets.apiKey, MCCLUSTER_ORG_ID: org };
  if (PRODUCTION_HOSTS.test(new URL(shim.url).hostname)) throw new Error('refusing a production database host');
  const gateway = spawn(process.execPath, [path.join(ROOT, 'core/src/compute/gateway.mjs')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: childEnv({ ...shared, MCCLUSTER_CORE_ID: 'production-staging-gateway', CORE_COMPUTE_HOST: '127.0.0.1', CORE_COMPUTE_PORT: String(ports.gateway), CORE_COMPUTE_ENROLL_TOKEN: secrets.enroll, CORE_COMPUTE_ADMIN_TOKEN: secrets.admin, CORE_COMPUTE_LEASE_SECONDS: String(options.leaseSeconds) })
  });
  const gatewayLog = fs.createWriteStream(file(RUN_FILES.gateway_log), { flags: 'a' });
  gateway.stdout.pipe(gatewayLog); gateway.stderr.pipe(gatewayLog);
  const api = spawn(process.execPath, [path.join(ROOT, 'scripts/staging/production/production-api.mjs')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: childEnv({ ...shared, PRODUCTION_API_PORT: String(ports.api), PRODUCTION_OWNER_PROFILE_ID: ownerProfile, PRODUCTION_OWNER_TOKEN: secrets.owner, PRODUCTION_MEDIA_ROOTS: JSON.stringify(options.mediaRoots) })
  });
  const apiLog = fs.createWriteStream(file(RUN_FILES.api_log), { flags: 'a' });
  api.stdout.pipe(apiLog); api.stderr.pipe(apiLog);

  let stopping = false; let watch = null;
  const shutdown = async (reason, code = 0) => {
    if (stopping) return; stopping = true; clearInterval(watch);
    log({ event: 'staging_stopping', reason });
    for (const child of [api, gateway]) if (child.exitCode === null) { try { child.kill('SIGTERM'); } catch {} }
    await new Promise((r) => setTimeout(r, 500));
    try { tlsServer.close(); } catch {}
    try { await shim.close(); } catch {}
    try { await db.close(); } catch {}
    try { const cur = JSON.parse(fs.readFileSync(file(RUN_FILES.staging), 'utf8')); fs.writeFileSync(file(RUN_FILES.staging), JSON.stringify({ ...cur, stopped_at: new Date().toISOString(), stop_reason: reason }, null, 2)); } catch {}
    fs.rmSync(file(RUN_FILES.stop), { force: true });
    serveLog.end(() => process.exit(code));
    setTimeout(() => process.exit(code), 2000).unref();
  };
  for (const child of [gateway, api]) child.on('exit', (c, s) => { log({ event: 'child_exited', pid: child.pid, code: c, signal: s }); if (!stopping) shutdown('child-exited', 1); });

  const ca = fs.readFileSync(file(RUN_FILES.ca_cert));
  const computeUrl = `https://127.0.0.1:${ports.tls}`;
  const apiUrl = `http://127.0.0.1:${ports.api}`;
  const ping = (url, opts = {}) => new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { ...opts, timeout: 2000 }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0)); req.on('timeout', () => { req.destroy(); resolve(0); });
  });
  const deadline = Date.now() + 30_000;
  while ((await ping(`${computeUrl}/health`, { ca })) !== 200 || (await ping(`${apiUrl}/health`)) !== 200) {
    if (Date.now() > deadline) throw new Error('the gateway or the production API did not come up within 30 s');
    await new Promise((r) => setTimeout(r, 300));
  }

  const staging = {
    schema: STAGING_SCHEMA, started_at: new Date().toISOString(), org_id: org, owner_profile_id: ownerProfile,
    urls: { compute: computeUrl, production_api: apiUrl, gateway_loopback: `http://127.0.0.1:${ports.gateway}` },
    bind: '127.0.0.1', ca_cert_path: file(RUN_FILES.ca_cert), lease_seconds: options.leaseSeconds,
    project: seed.id, media_roots: options.mediaRoots, files: { ...RUN_FILES }, pids: { serve: process.pid, gateway: gateway.pid, production_api: api.pid },
    schema_files: schemaFiles, database: 'PGlite, in memory: it ends with this process', production: false,
    stop: `create a file named "${RUN_FILES.stop}" in the run directory, or send SIGINT`
  };
  fs.writeFileSync(file(RUN_FILES.staging), JSON.stringify(staging, null, 2));
  log({ event: 'staging_ready', ports });
  console.log(JSON.stringify({ event: 'staging_ready', schema: STAGING_SCHEMA, org_id: org, urls: staging.urls, run_dir: runDir, files: staging.files, project: seed.id }));

  watch = setInterval(() => { if (fs.existsSync(file(RUN_FILES.stop))) shutdown('stop-file'); }, 1000);
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  if (process.platform === 'win32') process.on('SIGBREAK', () => shutdown('SIGBREAK'));
  if (!options.noStdin) { process.stdin.on('end', () => shutdown('stdin-closed')); process.stdin.on('error', () => {}); process.stdin.resume(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => { console.error(JSON.stringify({ event: 'staging_fatal', error: error.message })); process.exit(1); });
}
