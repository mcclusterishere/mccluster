// Real gateway, Ed25519 signatures and unchanged enrollment/lease SQL against a
// disposable PGlite fixture. No canonical database or physical device is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateNodeIdentity, signRequest } from '../src/compute/signature.mjs';
import { enrollmentDigest, createDeviceService } from '../src/compute/devices.mjs';
import { createOwnerWorkspaceDatabase, startOwnerWorkspaceRestFixture } from './helpers/owner-workspace-db.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ORG = '00000000-0000-4000-8000-000000000001';
const OWNER = '00000000-0000-4000-8000-000000000003';
const modulePath = process.env.PGLITE_MODULE_PATH;
const required = process.env.MCCLUSTER_DEVICE_SQL_TESTS_REQUIRED === '1';
const available = modulePath && path.isAbsolute(modulePath) && fs.existsSync(path.join(path.dirname(modulePath), 'contrib/pgcrypto.js'));
const CAPABILITIES = [{ capability: 'ai.chat', implementation: 'qwen3.8b.local', model: 'qwen3:8b', max_concurrency: 1 }];

test('real signed workers: one-time enrollment, reconnect, scope, pause, revoke and lease recovery', { skip: !available && !required ? 'Set PGLITE_MODULE_PATH to pinned PGlite with pgcrypto; real SQL is unverified in this run.' : false }, async () => {
  assert.ok(available, 'PGlite with pgcrypto is required for this proof');
  const { PGlite } = await import(pathToFileURL(modulePath));
  const { pgcrypto } = await import(pathToFileURL(path.join(path.dirname(modulePath), 'contrib/pgcrypto.js')));
  const db = new PGlite({ extensions: { pgcrypto } });
  let gateway; let server; let stdout = ''; let stderr = ''; let base;
  const requests = [];
  const reply = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema extensions; create table public.orgs(id uuid primary key);');
    for (const file of ['supabase/replay_migrations/20260912071000_compute_node_protocol.sql', 'supabase/migrations/20260919021007_compute_capability_concurrency_live_reconcile.sql', 'supabase/migrations/20261020210718_compute_lease_authority_v2.sql', 'supabase/pending/compute_owner_enrollment_v1.sql']) await db.exec(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    await db.query('insert into public.orgs(id) values($1)', [ORG]);
    server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://fixture.invalid');
        const name = url.pathname.replace('/rest/v1/', '');
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
        requests.push({ name, body });
        if (name === 'ops_compute_nodes') {
          const id = url.searchParams.get('id')?.replace(/^eq\./, '');
          if (req.method === 'GET') return reply(res, 200, (await db.query(id ? 'select * from public.ops_compute_nodes where id=$1' : 'select * from public.ops_compute_nodes', id ? [id] : [])).rows);
          if (req.method === 'PATCH') {
            const allowed = ['last_seen_at','updated_at','inventory','capabilities','labels','load','agent_version','max_leases'];
            const columns = Object.keys(body); assert.ok(columns.every((key) => allowed.includes(key)));
            const values = columns.map((key) => typeof body[key] === 'object' ? JSON.stringify(body[key]) : body[key]);
            values.push(id);
            const sql = `update public.ops_compute_nodes set ${columns.map((key, i) => `${key}=$${i + 1}`).join(',')} where id=$${values.length} and state not in ('revoked','quarantined') returning *`;
            return reply(res, 200, (await db.query(sql, values)).rows);
          }
        }
        if (name.startsWith('rpc/')) {
          const fn = name.slice(4);
          const functions = {
            compute_enroll_once: ['p_credential_hash','p_node'], compute_accept_nonce: ['p_node_id','p_nonce','p_expires_at'],
            compute_claim_task: ['p_node_id','p_capabilities','p_implementations','p_lease_seconds'],
            compute_start_lease: ['p_node_id','p_lease_id','p_lease_token','p_extend_seconds'],
            compute_heartbeat_lease: ['p_node_id','p_lease_id','p_lease_token','p_progress','p_extend_seconds'],
            compute_complete_lease: ['p_node_id','p_lease_id','p_lease_token','p_result'],
            compute_fail_lease: ['p_node_id','p_lease_id','p_lease_token','p_error','p_retry'],
          };
          assert.ok(functions[fn], `unexpected fixture RPC ${fn}`);
          const keys = functions[fn];
          const values = keys.map((key) => body[key] && typeof body[key] === 'object' && !Array.isArray(body[key]) ? JSON.stringify(body[key]) : body[key]);
          const { rows } = await db.query(`select public.${fn}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')}) as result`, values);
          return reply(res, 200, rows[0].result);
        }
        reply(res, 404, { message: 'Unknown fixture route' });
      } catch (error) { reply(res, 500, { message: error.message }); }
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const portProbe = http.createServer(); portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening');
    const port = portProbe.address().port; await new Promise((resolve) => portProbe.close(resolve));
    const env = { ...process.env, CORE_COMPUTE_HOST: '127.0.0.1', CORE_COMPUTE_PORT: String(port), CORE_OWNER_AI_WORKSPACE_ENABLED: '0', MCCLUSTER_ORG_ID: ORG, SUPABASE_URL: `http://127.0.0.1:${server.address().port}`, SUPABASE_SECRET_KEY: 'local-sql-fixture', CORE_COMPUTE_ENROLL_TOKEN: 'legacy-fixture-value' };
    delete env.SUPABASE_SERVICE_ROLE_KEY;
    gateway = spawn(process.execPath, [path.join(ROOT, 'core/src/compute/gateway.mjs')], { env, stdio: ['ignore','pipe','pipe'] });
    gateway.stderr.on('data', (chunk) => { stderr += chunk; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Gateway not ready: ${stderr}`)), 15000);
      gateway.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.includes('compute_gateway_ready')) { clearTimeout(timer); resolve(); } });
      gateway.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Gateway exited ${code}`)); });
    });
    base = `http://127.0.0.1:${port}`;
    let n = 0;
    const issuedCredentials = [];
    async function issue(expired = false) {
      const credential = `mcen1_${(++n).toString(16).padStart(43,'b')}`;
      issuedCredentials.push(credential);
      await db.query(`insert into public.ops_compute_enrollments(org_id,issued_by,display_name,platform,credential_hash,issued_at,expires_at) values($1,$2,$3,'darwin',$4,clock_timestamp() - ($5::boolean::integer * interval '11 minutes'), clock_timestamp() + case when $5 then interval '-1 minute' else interval '9 minutes' end)`, [ORG,OWNER,`Fixture Mac ${n}`,enrollmentDigest(credential),expired]);
      return credential;
    }
    async function enroll(identity, credential, overrides = {}) {
      return fetch(`${base}/v1/compute/enroll`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify({ protocol: 'mccluster-compute/1', org_id: ORG, public_key: identity.publicKeyPem, agent_version: 'test', inventory: { platform: 'darwin' }, capabilities: CAPABILITIES, max_leases: 1, ...overrides }) });
    }
    async function signed(identity, route, body) {
      const bytes = Buffer.from(JSON.stringify(body));
      return fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...signRequest({ privateKeyPem: identity.privateKeyPem, nodeId: identity.nodeId, method: 'POST', path: route, bodyBytes: bytes }) }, body: bytes });
    }
    const one = generateNodeIdentity(); const two = generateNodeIdentity(); const pending = await issue();
    let response = await enroll(one, pending); assert.equal(response.status, 201, await response.clone().text());
    assert.equal((await response.json()).node_id, one.nodeId);
    assert.equal((await enroll(two, pending)).status, 401, 'reused credential rejected at real HTTP boundary');
    assert.equal((await enroll(two, await issue(true))).status, 401, 'expired credential rejected at real HTTP boundary');
    response = await enroll(two, await issue()); assert.equal(response.status, 201);
    assert.equal((await signed(one, '/v1/compute/heartbeat', { load: { running_leases: 0 } })).status, 200);
    await db.query("update public.ops_compute_nodes set last_seen_at=clock_timestamp()-interval '5 minutes' where id=$1", [one.nodeId]);
    assert.equal((await signed(one, '/v1/compute/heartbeat', { load: { running_leases: 0 } })).status, 200, 'same identity reconnects without a new credential');
    const malicious = await signed(one, '/v1/compute/heartbeat', { capabilities: [...CAPABILITIES,{ capability: 'browser.act', implementation: 'chromium.local' }], labels: { enrollment_scope: null, trust: 'partner' }, max_leases: 64 });
    assert.equal(malicious.status, 200);
    let row = (await db.query('select * from public.ops_compute_nodes where id=$1', [one.nodeId])).rows[0];
    assert.equal(row.max_leases, 1); assert.deepEqual(row.capabilities.map((entry) => entry.capability), ['ai.chat']); assert.equal(row.labels.enrolled_trust, 'owned');
    const task = (await db.query("insert into public.ops_compute_tasks(org_id,capability,implementation) values($1,'ai.chat','qwen3.8b.local') returning id", [ORG])).rows[0].id;
    let leased = await (await signed(one, '/v1/compute/lease', {})).json(); assert.ok(leased.lease?.lease_id, JSON.stringify(leased));
    const lease = leased.lease; const leaseBody = { lease_token: lease.lease_token };
    assert.equal((await signed(one, `/v1/compute/leases/${lease.lease_id}/start`, leaseBody)).status, 200);
    await db.query("update public.ops_compute_nodes set state='draining' where id=$1", [one.nodeId]);
    assert.equal((await (await signed(one, '/v1/compute/lease', {})).json()).lease, null);
    assert.equal((await signed(one, `/v1/compute/leases/${lease.lease_id}/heartbeat`, leaseBody)).status, 200, 'pause drains running work');
    await db.query("update public.ops_compute_nodes set state='revoked',revoked_at=clock_timestamp() where id=$1", [one.nodeId]);
    assert.equal((await signed(one, '/v1/compute/lease', {})).status, 403);
    assert.equal((await signed(one, `/v1/compute/leases/${lease.lease_id}/heartbeat`, leaseBody)).status, 403);
    assert.equal((await signed(one, `/v1/compute/leases/${lease.lease_id}/complete`, { ...leaseBody, result: { content: 'late' } })).status, 403);
    await db.query("update public.ops_compute_leases set expires_at=clock_timestamp()-interval '1 second' where id=$1", [lease.lease_id]);
    await signed(two, '/v1/compute/lease', {});
    await db.query("update public.ops_compute_tasks set run_after=clock_timestamp()-interval '1 second' where id=$1", [task]);
    leased = await (await signed(two, '/v1/compute/lease', {})).json();
    assert.equal(leased.lease.attempt, 2); assert.equal(leased.lease.node_id, two.nodeId);
    assert.equal((await signed(two, `/v1/compute/leases/${leased.lease.lease_id}/start`, { lease_token: leased.lease.lease_token })).status, 200);
    assert.equal((await signed(two, `/v1/compute/leases/${leased.lease.lease_id}/complete`, { lease_token: leased.lease.lease_token, result: { content: 'Recovered.' } })).status, 200);
    assert.equal((await db.query('select status from public.ops_compute_tasks where id=$1', [task])).rows[0].status, 'done');
    for (const credential of issuedCredentials) {
      assert.equal((stdout + stderr).includes(credential), false, 'no enrollment credentials in gateway logs');
      assert.equal(JSON.stringify(requests).includes(credential), false, 'only credential digest reaches database');
    }
    assert.equal((stdout + stderr).includes(one.privateKeyPem), false);
  } finally {
    if (gateway && gateway.exitCode == null && gateway.signalCode == null) { const exited = once(gateway, 'exit'); gateway.kill('SIGTERM'); await exited; }
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    await db.close();
  }
});

test('signed cleanup holds survive worker labels and owner Resume until fresh local recovery evidence', { skip: !available && !required ? 'Set PGLITE_MODULE_PATH to run signed cleanup SQL proof.' : false }, async () => {
  assert.ok(available, 'PGlite with pgcrypto is required for this proof');
  const db = await createOwnerWorkspaceDatabase();
  const api = await startOwnerWorkspaceRestFixture(db);
  let gateway; let logs = '';
  try {
    const probe = http.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const env = { ...process.env, CORE_COMPUTE_HOST: '127.0.0.1', CORE_COMPUTE_PORT: String(port), CORE_OWNER_AI_WORKSPACE_ENABLED: '1', MCCLUSTER_ORG_ID: ORG, SUPABASE_URL: api.url, SUPABASE_SECRET_KEY: api.serviceKey, CORE_COMPUTE_ENROLL_TOKEN: 'legacy-fixture-value' };
    delete env.SUPABASE_SERVICE_ROLE_KEY; delete env.CORE_COMPUTE_ALLOW_LEGACY_ENROLL;
    gateway = spawn(process.execPath, [path.join(ROOT, 'core/src/compute/gateway.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    gateway.stderr.on('data', data => { logs += data; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Cleanup gateway did not start.')), 15000);
      gateway.stdout.on('data', data => { logs += data; if (logs.includes('compute_gateway_ready')) { clearTimeout(timer); resolve(); } });
      gateway.once('exit', code => { clearTimeout(timer); reject(new Error(`Cleanup gateway exited ${code}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const restImpl = async (resource, init = {}) => {
      const response = await fetch(`${api.url}/rest/v1/${resource}`, { ...init, headers: { apikey: api.serviceKey, authorization: `Bearer ${api.serviceKey}`, 'content-type': 'application/json', ...init.headers } });
      const body = await response.json();
      if (!response.ok) throw Object.assign(new Error(body.message), { status: response.status, detail: body });
      return { body };
    };
    const service = createDeviceService({ restImpl, env: { CORE_COMPUTE_PUBLIC_URL: 'https://fixture-compute.invalid' } });
    const actor = { kind: 'owner', user_id: OWNER };
    const issued = await service.createEnrollment({ org_id: ORG, display_name: 'Cleanup fixture Mac' }, { actor });
    assert.equal(issued.setup.compute_url, 'https://fixture-compute.invalid');
    const identity = generateNodeIdentity();
    const body = { protocol: 'mccluster-compute/1', org_id: ORG, public_key: identity.publicKeyPem, inventory: { platform: 'darwin', arch: 'arm64' }, capabilities: CAPABILITIES, max_leases: 1 };
    const enroll = credential => fetch(`${base}/v1/compute/enroll`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify(body) });
    assert.equal((await enroll('legacy-fixture-value')).status, 401, 'workspace rollout closes the old reusable bootstrap credential');
    assert.equal((await enroll(issued.credential)).status, 201);
    const reservation = randomUUID();
    await db.query("update public.ops_compute_nodes set state='draining',pair_cleanup_required=true,pair_cleanup_details=jsonb_build_object('reservation_id',$2::text,'required_at',clock_timestamp()-interval '1 second') where id=$1", [identity.nodeId, reservation]);
    await assert.rejects(service.update({ org_id: ORG, node_id: identity.nodeId, action: 'resume' }, { actor }), { code: 'DEVICE_PAIR_CLEANUP_REQUIRED' });
    const signed = (route, payload, extra = {}) => {
      const bytes = Buffer.from(JSON.stringify(payload));
      const headers = { 'content-type': 'application/json', ...signRequest({ privateKeyPem: identity.privateKeyPem, nodeId: identity.nodeId, method: 'POST', path: route, bodyBytes: bytes, ...extra }) };
      return { headers, bytes, request: () => fetch(`${base}${route}`, { method: 'POST', headers, body: bytes }) };
    };
    const receipt = { schema: 'mccluster-pair-cleanup/1', runtime: 'exo', unloaded: true, model_instances: 0, observed_at: new Date().toISOString() };
    const route = '/v1/compute/pair-cleanup';
    assert.equal((await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reservation_id: reservation, receipt }) })).status, 401, 'unsigned browser cannot acknowledge local model cleanup');
    assert.equal((await signed(route, { reservation_id: reservation, receipt }, { privateKeyPem: generateNodeIdentity().privateKeyPem }).request()).status, 401, 'another signing key cannot acknowledge cleanup');
    assert.equal((await signed('/v1/compute/heartbeat', { labels: { pair_cleanup_required: false, pair_cleanup_details: null }, pair_cleanup_required: false }).request()).status, 200);
    assert.equal((await db.query('select pair_cleanup_required from public.ops_compute_nodes where id=$1', [identity.nodeId])).rows[0].pair_cleanup_required, true, 'worker labels cannot clear the server-owned hold');
    assert.equal((await signed(route, { reservation_id: randomUUID(), receipt }).request()).status, 409, 'receipt must match the held reservation');
    assert.equal((await signed(route, { reservation_id: reservation, receipt: { ...receipt, observed_at: new Date(Date.now() - 600_000).toISOString() } }).request()).status, 409, 'old evidence cannot clear current hold');
    const valid = signed(route, { reservation_id: reservation, receipt });
    const accepted = await valid.request(); assert.equal(accepted.status, 200, await accepted.clone().text());
    assert.equal((await accepted.json()).state, 'draining', 'signed cleanup does not auto-resume');
    assert.equal((await valid.request()).status, 409, 'replayed signed cleanup nonce is denied');
    assert.equal((await service.update({ org_id: ORG, node_id: identity.nodeId, action: 'resume' }, { actor })).device.eligible, true);
    await service.update({ org_id: ORG, node_id: identity.nodeId, action: 'revoke' }, { actor });
    assert.equal((await signed(route, { reservation_id: reservation, receipt }).request()).status, 403, 'revoked key cannot acknowledge recovery');
    assert.equal(logs.includes(issued.credential), false, 'enrollment credential is absent from gateway logs');
    assert.equal(logs.includes(identity.privateKeyPem), false, 'private key is absent from gateway logs');
  } finally {
    if (gateway && gateway.exitCode == null && gateway.signalCode == null) { const exited = once(gateway, 'exit'); gateway.kill('SIGTERM'); await exited; }
    await api.close(); await db.close();
  }
});
