// Executes unchanged pending SQL against a disposable local database only.
// PGLITE_MODULE_PATH is a pinned local package file, never a database URL.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateNodeIdentity } from '../core/src/compute/signature.mjs';
import { consumeScopedEnrollment, enrollmentDigest } from '../core/src/compute/devices.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = process.env.PGLITE_MODULE_PATH;
if (!modulePath || !path.isAbsolute(modulePath)) throw new Error('Set PGLITE_MODULE_PATH to the pinned local PGlite module.');
const { PGlite } = await import(pathToFileURL(modulePath));
const { pgcrypto } = await import(pathToFileURL(path.join(path.dirname(modulePath), 'contrib/pgcrypto.js')));
const db = new PGlite({ extensions: { pgcrypto } });
const ORG = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const OWNER = '00000000-0000-4000-8000-000000000003';
let sequence = 0;
let assertions = 0;
function ok(condition, message) { assert.ok(condition, message); assertions++; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions++; }

async function issue({ expired = false } = {}) {
  const credential = `mcen1_${(++sequence).toString(16).padStart(43, 'a')}`;
  const { rows } = await db.query(`insert into public.ops_compute_enrollments(org_id,issued_by,display_name,platform,credential_hash,issued_at,expires_at)
    values($1,$2,'SQL fixture Mac','darwin',$3,clock_timestamp() - ($4::boolean::integer * interval '11 minutes'), clock_timestamp() + case when $4 then interval '-1 minute' else interval '9 minutes' end) returning id`, [ORG, OWNER, enrollmentDigest(credential), expired]);
  return { credential, id: rows[0].id };
}
function request(identity, overrides = {}) {
  return { protocol: 'mccluster-compute/1', org_id: ORG, display_name: 'untrusted override', public_key: identity.publicKeyPem, inventory: { platform: 'darwin' }, capabilities: [{ capability: 'ai.chat', implementation: 'qwen3.8b.local', model: 'qwen3:8b', max_concurrency: 1 }], labels: { trust: 'evil', role: 'admin' }, max_leases: 1, ...overrides };
}
const restImpl = async (_path, init) => {
  const input = JSON.parse(init.body);
  const { rows } = await db.query('select public.compute_enroll_once($1,$2::jsonb) as result', [input.p_credential_hash, JSON.stringify(input.p_node)]);
  return { body: rows[0].result };
};
async function consume(issued, identity, overrides = {}) { return consumeScopedEnrollment(issued.credential, request(identity, overrides), { restImpl }); }
async function rejected(issued, identity, overrides) { await assert.rejects(consume(issued, identity, overrides), { code: 'ENROLLMENT_INVALID_OR_EXPIRED' }); assertions++; }

try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema extensions; create table public.orgs(id uuid primary key);`);
  for (const file of ['supabase/replay_migrations/20260912071000_compute_node_protocol.sql', 'supabase/migrations/20260919021007_compute_capability_concurrency_live_reconcile.sql', 'supabase/migrations/20261020210718_compute_lease_authority_v2.sql', 'supabase/pending/compute_owner_enrollment_v1.sql']) await db.exec(fs.readFileSync(path.join(root, file), 'utf8'));
  await db.query('insert into public.orgs(id) values($1),($2)', [ORG, OTHER]);
  const initial = await issue();
  const mac = generateNodeIdentity();
  equal((await consume(initial, mac)).id, mac.nodeId, 'valid credential enrolls its generated key');
  const record = (await db.query('select * from public.ops_compute_nodes where id=$1', [mac.nodeId])).rows[0];
  equal(record.display_name, 'SQL fixture Mac', 'owner-issued name is authoritative');
  equal(record.labels.enrolled_trust, 'owned', 'server owns trust');
  equal(record.labels.role, 'device-worker', 'client cannot grant an admin role');
  equal(record.max_leases, 1, 'scope permits one active lease');
  await rejected(initial, generateNodeIdentity());
  await rejected(initial, mac);
  await rejected(await issue({ expired: true }), generateNodeIdentity());
  const scoped = await issue();
  const second = generateNodeIdentity();
  await rejected(scoped, second, { org_id: OTHER });
  await rejected(scoped, second, { inventory: { platform: 'win32' } });
  await rejected(scoped, second, { max_leases: 2 });
  await rejected(scoped, second, { capabilities: [{ capability: 'browser.act', implementation: 'chromium.local' }] });
  // The RPC is service-role only, but malformed nullable JSON must also fail
  // closed at the database boundary instead of bypassing a PL/pgSQL IF.
  const rawNode = { id: second.nodeId, org_id: ORG, public_key_pem: second.publicKeyPem, key_fingerprint: second.fingerprint, protocol_version: 'mccluster-compute/1', inventory: { platform: 'darwin' }, capabilities: [], max_leases: 1 };
  for (const capabilities of [null, [{ implementation: 'qwen3.8b.local', max_concurrency: 1 }], [{ capability: 'ai.chat', max_concurrency: 1 }], [null]]) {
    equal((await db.query('select public.compute_enroll_once($1,$2::jsonb) as r', [enrollmentDigest(scoped.credential), JSON.stringify({ ...rawNode, capabilities })])).rows[0].r, null, 'malformed capability cannot bypass scoped SQL validation');
  }
  equal((await db.query('select public.compute_enroll_once($1,null) as r', [enrollmentDigest(scoped.credential)])).rows[0].r, null, 'null node request is rejected');
  equal((await consume(scoped, second)).id, second.nodeId, 'invalid request does not consume credential');
  const raced = await issue();
  const contenders = [generateNodeIdentity(), generateNodeIdentity()];
  const outcomes = await Promise.allSettled(contenders.map((identity) => consume(raced, identity)));
  equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1, 'exactly one concurrent consumption wins');
  equal(outcomes.filter((result) => result.status === 'rejected').length, 1, 'reused credential loses');
  const credentialRow = (await db.query('select * from public.ops_compute_enrollments where id=$1', [raced.id])).rows[0];
  ok(credentialRow.consumed_at && credentialRow.node_id, 'consume has durable receipt');
  ok(!JSON.stringify(credentialRow).includes(raced.credential), 'only digest persisted');
  await db.query("update public.ops_compute_nodes set state='revoked', revoked_at=clock_timestamp() where id=$1", [mac.nodeId]);
  await rejected(await issue(), mac);
  await db.query("update public.ops_compute_nodes set state='online', revoked_at=null where id=$1", [mac.nodeId]);
  const task = (await db.query("insert into public.ops_compute_tasks(org_id,capability,implementation,input) values($1,'ai.chat','qwen3.8b.local','{}') returning id", [ORG])).rows[0].id;
  let lease = (await db.query("select public.compute_claim_task($1,array['ai.chat'],array['qwen3.8b.local']) as r", [mac.nodeId])).rows[0].r;
  ok(lease?.lease_id, 'newly enrolled worker can claim');
  await db.query('select public.compute_start_lease($1,$2,$3)', [mac.nodeId, lease.lease_id, lease.lease_token]);
  await db.query("update public.ops_compute_nodes set state='draining' where id=$1", [mac.nodeId]);
  equal((await db.query("select public.compute_claim_task($1,array['ai.chat'],array['qwen3.8b.local']) as r", [mac.nodeId])).rows[0].r, null, 'pause prevents new leases');
  ok((await db.query('select public.compute_heartbeat_lease($1,$2,$3) as r', [mac.nodeId, lease.lease_id, lease.lease_token])).rows[0].r, 'paused in-flight work can renew');
  await db.query("update public.ops_compute_nodes set state='revoked',revoked_at=clock_timestamp() where id=$1", [mac.nodeId]);
  equal((await db.query('select public.compute_heartbeat_lease($1,$2,$3) as r', [mac.nodeId, lease.lease_id, lease.lease_token])).rows[0].r, null, 'revoked work cannot renew');
  equal((await db.query("select public.compute_complete_lease($1,$2,$3,'{\"content\":\"late\"}') as r", [mac.nodeId, lease.lease_id, lease.lease_token])).rows[0].r, false, 'revoked worker cannot publish a late result');
  equal((await db.query("select public.compute_claim_task($1,array['ai.chat'],array['qwen3.8b.local']) as r", [mac.nodeId])).rows[0].r, null, 'revoked worker cannot claim');
  await db.query("update public.ops_compute_leases set expires_at=clock_timestamp()-interval '1 second' where id=$1", [lease.lease_id]);
  await db.query("select public.compute_claim_task($1,array['ai.chat'],array['qwen3.8b.local'])", [second.nodeId]);
  equal((await db.query('select status from public.ops_compute_tasks where id=$1', [task])).rows[0].status, 'queued', 'lease expiry requeues using existing rules');
  await db.query("update public.ops_compute_tasks set run_after=clock_timestamp()-interval '1 second' where id=$1", [task]);
  lease = (await db.query("select public.compute_claim_task($1,array['ai.chat'],array['qwen3.8b.local']) as r", [second.nodeId])).rows[0].r;
  equal(lease.node_id, second.nodeId, 'a different worker recovers expired work');
  equal(lease.attempt, 2, 'recovery increments the fenced attempt');
  for (const role of ['anon', 'authenticated']) {
    equal((await db.query("select has_table_privilege($1,'public.ops_compute_enrollments','SELECT') as r", [role])).rows[0].r, false, `${role} cannot read enrollment hashes`);
    equal((await db.query("select has_function_privilege($1,'public.compute_enroll_once(text,jsonb)','EXECUTE') as r", [role])).rows[0].r, false, `${role} cannot consume enrollment directly`);
  }
  ok((await db.query("select relrowsecurity from pg_class where oid='public.ops_compute_enrollments'::regclass")).rows[0].relrowsecurity, 'RLS enabled');
  console.log(JSON.stringify({ suite: 'owner-device-sql', engine: 'disposable PGlite/PostgreSQL', assertions, passed: true, production_changes: false, concurrent_sessions: false }));
} finally { await db.close(); }
