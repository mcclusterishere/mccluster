#!/usr/bin/env node
// Scheduler standby exercise (docs/control-plane/DEVICE-JOBS-SCHEDULER-STANDBY.md).
//
// Two REAL Core compute gateways run against one disposable PGlite database
// that holds the repository's compute SQL plus the pending scheduler lease SQL:
// gateway A as the primary (the OVH role), gateway B as the standby (the Prime
// role). The run proves, with the real election loop and the real RPCs:
//   1. one active holder: A holds term 1, B is held and refuses submissions and
//      node claims with 503 SCHEDULER_STANDBY naming the live holder;
//   2. a partition: A is frozen (SIGSTOP), its lease expires server-side, B takes
//      over with term 2 and accepts submissions;
//   3. the fenced return: A is resumed (SIGCONT), its renew is fenced, it stays a
//      candidate and keeps refusing;
//   4. controlled failback: the active standby hands over to the primary, A takes
//      term 3, B is fenced.
// Nothing reaches canonical Supabase, the OVH Core or any device.
//
//   PGLITE_MODULE_PATH=<dir>/node_modules/@electric-sql/pglite/dist/index.js \
//     node scripts/staging/device-jobs/scheduler-failover.mjs --out /tmp/scheduler-proof
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadComputeSchema, openPglite, startPostgrestShim } from './pglite-postgrest.mjs';
import { generateNodeIdentity, signRequest } from '../../../core/src/compute/signature.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = new Map(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const OUT = path.resolve(String(args.get('out') || path.join(os.tmpdir(), `scheduler-failover-${Date.now()}`)));
fs.mkdirSync(OUT, { recursive: true });
const ORG = '00000000-0000-4000-8000-00000000c0de';
const TTL = 10;
const secrets = { apiKey: crypto.randomBytes(24).toString('hex'), admin: crypto.randomBytes(24).toString('hex'), enroll: crypto.randomBytes(24).toString('hex') };
const base = 48300 + Math.floor(Math.random() * 100);
const ports = { a: base, b: base + 1 };
const children = new Map();
const steps = [];
let shim; let db;

function log(record) { console.log(JSON.stringify({ at: new Date().toISOString(), ...record })); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function assert(c, m) { if (!c) throw new Error(m); }
async function waitFor(label, fn, { timeoutMs = 30_000, intervalMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs; let last;
  while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(intervalMs); }
  throw new Error(`timed out waiting for ${label}${last ? `: ${last.message}` : ''}`);
}
async function step(name, fn) {
  const started = Date.now();
  try { const detail = await fn(); steps.push({ name, ok: true, duration_ms: Date.now() - started, detail: detail ?? null }); log({ step: name, ok: true }); }
  catch (error) { steps.push({ name, ok: false, duration_ms: Date.now() - started, error: error.message }); log({ step: name, ok: false, error: error.message }); }
}
function spawnGateway(name, role, holder, port) {
  const out = fs.createWriteStream(path.join(OUT, `${name}.log`), { flags: 'a' });
  const child = spawn(process.execPath, [path.join(ROOT, 'core/src/compute/gateway.mjs')], { cwd: ROOT, env: {
    ...process.env, SUPABASE_URL: shim.url, SUPABASE_SERVICE_ROLE_KEY: secrets.apiKey, MCCLUSTER_ORG_ID: ORG, MCCLUSTER_CORE_ID: holder,
    CORE_COMPUTE_HOST: '127.0.0.1', CORE_COMPUTE_PORT: String(port), CORE_COMPUTE_ENROLL_TOKEN: secrets.enroll, CORE_COMPUTE_ADMIN_TOKEN: secrets.admin,
    MCCLUSTER_SCHEDULER_ROLE: role, MCCLUSTER_SCHEDULER_HOLDER_ID: holder, MCCLUSTER_SCHEDULER_TTL_SECONDS: String(TTL), MCCLUSTER_SCHEDULER_RENEW_MS: '2000'
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(out); child.stderr.pipe(out);
  child.on('exit', (code, signal) => log({ child: name, exited: true, code, signal }));
  children.set(name, child);
  return child;
}
async function call(url, { method = 'GET', headers = {}, body, raw } = {}) {
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const res = await fetch(url, { method, headers: { ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: payload });
  const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}
const admin = (port, pathname, init = {}) => call(`http://127.0.0.1:${port}${pathname}`, { ...init, headers: { authorization: `Bearer ${secrets.admin}`, ...(init.headers || {}) } });
const health = async (port) => (await call(`http://127.0.0.1:${port}/health`)).body;
const submit = (port) => admin(port, '/v1/compute/jobs', { method: 'POST', body: { capability: 'ai.chat', input: { prompt: 'who schedules?' }, allow_offline: true } });
function signed(identity, port, pathname, body) {
  const bodyBytes = Buffer.from(JSON.stringify(body));
  const headers = signRequest({ privateKeyPem: identity.privateKeyPem, method: 'POST', path: pathname, nodeId: identity.nodeId, bodyBytes });
  return call(`http://127.0.0.1:${port}${pathname}`, { method: 'POST', headers, raw: bodyBytes });
}

async function main() {
  db = await openPglite();
  const loaded = await loadComputeSchema(db, ROOT, { pending: ['compute_job_attestations_v1', 'compute_scheduler_lease_v1'] });
  await db.query('insert into public.orgs(id, slug, enabled) values ($1, $2, true)', [ORG, 'mccluster']);
  shim = await startPostgrestShim({ db, apiKey: secrets.apiKey, log });
  spawnGateway('gateway-a', 'primary', 'ovh-primary', ports.a);
  await waitFor('gateway A health', async () => (await call(`http://127.0.0.1:${ports.a}/health`)).status === 200);
  await sleep(500);
  spawnGateway('gateway-b', 'standby', 'prime-standby', ports.b);
  await waitFor('gateway B health', async () => (await call(`http://127.0.0.1:${ports.b}/health`)).status === 200);
  const node = generateNodeIdentity();

  await step('one active holder: the primary holds term 1 and the standby is held', async () => {
    const a = await waitFor('A active', async () => { const h = await health(ports.a); return h.scheduler?.active ? h : null; });
    const b = await waitFor('B held', async () => { const h = await health(ports.b); return h.scheduler && h.scheduler.active === false && h.scheduler.live_holder === 'ovh-primary' ? h : null; });
    assert(a.scheduler.term === 1 && a.scheduler.role === 'primary', `A term ${a.scheduler.term}`);
    return { a: a.scheduler, b: b.scheduler };
  });

  await step('the standby refuses admin submissions and node lease claims with SCHEDULER_STANDBY; the primary accepts', async () => {
    const enrol = await call(`http://127.0.0.1:${ports.a}/v1/compute/enroll`, { method: 'POST', headers: { authorization: `Bearer ${secrets.enroll}` }, body: {
      protocol: 'mccluster-compute/1', org_id: ORG, display_name: 'failover-fixture', public_key: node.publicKeyPem, agent_version: 'harness',
      inventory: { platform: 'linux', arch: 'x64', cpu_count: 1, memory_bytes: 1, disk_free_bytes: 1, gpus: [], runtime: {} },
      capabilities: [{ capability: 'ai.chat', implementation: 'manual.local', max_concurrency: 1 }], labels: { trust: 'owned' }, max_leases: 1 } });
    assert(enrol.status === 201, `enrol ${enrol.status}`);
    const viaB = await submit(ports.b);
    const viaA = await submit(ports.a);
    const claimB = await signed(node, ports.b, '/v1/compute/lease', {});
    const heartbeatB = await signed(node, ports.b, '/v1/compute/heartbeat', { load: { running_leases: 0 } });
    const statusB = await admin(ports.b, `/v1/compute/jobs/${viaA.body.job.job_id}?org_id=${ORG}`);
    const claimA = await signed(node, ports.a, '/v1/compute/lease', {});
    assert(viaB.status === 503 && viaB.body.code === 'SCHEDULER_STANDBY' && viaB.body.active_holder === 'ovh-primary', `submit via B ${viaB.status} ${JSON.stringify(viaB.body)}`);
    assert(viaA.status === 202, `submit via A ${viaA.status}`);
    assert(claimB.status === 503 && claimB.body.code === 'SCHEDULER_STANDBY', `claim via B ${claimB.status} ${claimB.body?.code}`);
    assert(heartbeatB.status === 200, `heartbeat via B is liveness, allowed: ${heartbeatB.status}`);
    assert(statusB.status === 200, `reads on the standby are allowed: ${statusB.status}`);
    assert(claimA.status === 200 && claimA.body.lease?.task?.id === viaA.body.job.job_id, `claim via A ${claimA.status}`);
    return { submit_via_standby: viaB.body.code, submit_via_primary: viaA.status, claim_via_standby: claimB.body.code, claim_via_primary: claimA.status, reads_on_standby: statusB.status };
  });

  await step('partition: the primary is frozen, its lease expires server-side, the standby takes over with term 2 and accepts submissions', async () => {
    children.get('gateway-a').kill('SIGSTOP');
    const frozenAt = new Date().toISOString();
    const b = await waitFor('B active', async () => { const h = await health(ports.b); return h.scheduler?.active ? h : null; }, { timeoutMs: (TTL + 15) * 1000, intervalMs: 500 });
    assert(b.scheduler.term === 2, `B term ${b.scheduler.term}`);
    const viaB = await submit(ports.b);
    assert(viaB.status === 202, `submit via B after takeover ${viaB.status}`);
    return { frozen_at: frozenAt, standby_active_at: new Date().toISOString(), term: b.scheduler.term, reason: b.scheduler.last_reason ?? null };
  });

  await step('fenced return: the primary is resumed, its renew is fenced, it refuses and names the standby as the live holder', async () => {
    children.get('gateway-a').kill('SIGCONT');
    const a = await waitFor('A fenced', async () => { const h = await health(ports.a); return h.scheduler && h.scheduler.active === false && h.scheduler.live_holder === 'prime-standby' ? h : null; }, { timeoutMs: 20_000 });
    const viaA = await submit(ports.a);
    assert(viaA.status === 503 && viaA.body.code === 'SCHEDULER_STANDBY' && viaA.body.active_holder === 'prime-standby', `submit via A after fencing ${viaA.status} ${JSON.stringify(viaA.body)}`);
    const fencedLog = fs.readFileSync(path.join(OUT, 'gateway-a.log'), 'utf8').includes('scheduler_fenced');
    return { a: a.scheduler, submit_via_primary: viaA.body.code, fenced_event_logged: fencedLog };
  });

  await step('controlled failback: the active standby hands over, the primary takes term 3, the standby is fenced', async () => {
    const handover = await admin(ports.b, '/v1/compute/scheduler/handover', { method: 'POST', body: { to_holder_id: 'ovh-primary', grace_seconds: 60 } });
    assert(handover.status === 200 && handover.body.ok === true, `handover ${handover.status} ${JSON.stringify(handover.body)}`);
    const a = await waitFor('A active again', async () => { const h = await health(ports.a); return h.scheduler?.active ? h : null; }, { timeoutMs: 20_000 });
    assert(a.scheduler.term === 3, `A term ${a.scheduler.term}`);
    const b = await waitFor('B fenced', async () => { const h = await health(ports.b); return h.scheduler && h.scheduler.active === false ? h : null; }, { timeoutMs: 20_000 });
    const viaA = await submit(ports.a); const viaB = await submit(ports.b);
    assert(viaA.status === 202 && viaB.status === 503, `after failback A ${viaA.status} B ${viaB.status}`);
    const status = await admin(ports.a, `/v1/compute/scheduler?org_id=${ORG}`);
    assert(status.status === 200 && status.body.store?.holder_id === 'ovh-primary' && Number(status.body.store.term) === 3, `status ${JSON.stringify(status.body).slice(0, 300)}`);
    return { handover: handover.body, a: a.scheduler, b: b.scheduler, store: status.body.store, history_length: Array.isArray(status.body.store?.history) ? status.body.store.history.length : null };
  });

  const ok = steps.every((s) => s.ok);
  const proof = { schema: 'mccluster-scheduler-failover-proof/1', ok, finished_at: new Date().toISOString(), ttl_seconds: TTL, renew_ms: 2000, commit: gitSha(), schema_files: loaded, steps,
    synthetic: 'Two real gateway processes over one disposable database. No canonical Supabase, no OVH Core, no device. Node traffic redirection (tunnel/DNS) is out of scope and stays a manual owner step.' };
  fs.writeFileSync(path.join(OUT, 'proof.json'), JSON.stringify(proof, null, 2));
  fs.writeFileSync(path.join(OUT, 'PROOF.md'), ['# Scheduler standby: staging proof', '', `Result: **${ok ? 'PASS' : 'FAIL'}** (${steps.filter((s) => s.ok).length}/${steps.length}). Commit ${proof.commit}. TTL ${TTL} s, renew 2 s.`, '', proof.synthetic, '', '| Step | Result | ms | Detail |', '| --- | --- | --- | --- |', ...steps.map((s) => `| ${s.name} | ${s.ok ? 'pass' : `FAIL: ${s.error}`} | ${s.duration_ms} | \`${JSON.stringify(s.detail ?? null).replace(/\|/g, '\\|').slice(0, 500)}\` |`), ''].join('\n'));
  log({ event: 'failover_finished', ok, passed: steps.filter((s) => s.ok).length, steps: steps.length, out: OUT });
  return ok;
}
function gitSha() { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } }

let exit = 1;
try { exit = (await main()) ? 0 : 1; }
catch (error) { log({ event: 'failover_fatal', error: error.message }); }
finally {
  for (const [, child] of children) { try { child.kill('SIGCONT'); } catch {} try { child.kill('SIGTERM'); } catch {} }
  await sleep(1500);
  for (const [, child] of children) { try { child.kill('SIGKILL'); } catch {} }
  try { await shim?.close(); } catch {}
  try { await db?.close(); } catch {}
  process.exit(exit);
}
