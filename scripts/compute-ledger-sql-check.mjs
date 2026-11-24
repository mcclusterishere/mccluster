import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nativeTestDb, migrationPath, waitForBlocked } from './native-admin-test-db.mjs';
import { hashJson, meteringBlock } from '../core/src/compute/jobs.mjs';
import { estimateMaxUnitsMicro } from '../core/src/compute/contribution-ledger.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { createInterface } from 'node:readline';
import { submitJob, validateCompletion } from '../core/src/compute/jobs-service.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Disposable WASM or local native PostgreSQL; never connects to canonical Supabase.
// Loads the applied compute migrations, the pending scheduler lease and attestation
// SQL and the pending contribution ledger SQL, seeds through the real compute_*
// functions, and asserts every case of COMPUTE-CONTRIBUTION-LEDGER.md
// "Tests the pilot must pass" with its refusal code.
let db;
if(process.env.NATIVE_TEST_DATABASE_URL) db=await nativeTestDb('ledger');
else {
 const modulePath=process.env.PGLITE_MODULE_PATH;
 if(!modulePath||!path.isAbsolute(modulePath)) throw Error('Set PGLITE_MODULE_PATH to pinned PGlite');
 const {PGlite}=await import(pathToFileURL(modulePath));
 const {pgcrypto}=await import(pathToFileURL(path.join(path.dirname(modulePath),'contrib/pgcrypto.js')));
 db=new PGlite({extensions:{pgcrypto}});
}
const read=(file)=>fs.readFileSync(`${root}/${file}`,'utf8');
const sha256=(text)=>crypto.createHash('sha256').update(text,'utf8').digest('hex');
const q=async(sql,params=[])=>Array.from((await db.query(sql,params)).rows);
const one=async(sql,params=[])=>(await q(sql,params))[0];
let passed=0;
const ok=(label)=>{passed+=1;console.log(`${label}: PASS`);};

const ORG='00000000-0000-4000-8000-000000000001';
const NODE_A='node_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', NODE_B='node_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', NODE_C='node_cccccccccccccccccccccccccccccccc', NODE_D='node_dddddddddddddddddddddddddddddddd';
const HOLDER='core-primary';
const CAPS=JSON.stringify([{capability:'ai.chat',implementation:'qwen3.8b.local',max_concurrency:1},{capability:'ai.chat',implementation:'micro.local',max_concurrency:1},{capability:'ai.chat',implementation:'points.local',max_concurrency:1}]);
const IMPLS="array['qwen3.8b.local','micro.local','points.local']";
const DIGEST='sha256:0123456789abcdef';
let keySeq=0; const key=(prefix)=>`${prefix}:${++keySeq}`;

function usage(over={}) {
 return { prompt_eval_count:100, prompt_eval_cached_count:20, eval_count:50, total_duration_ns:3_000_000_000, load_duration_ns:1_000_000_000, prompt_eval_duration_ns:500_000_000, eval_duration_ns:1_000_000_000, model_digest:DIGEST, ollama_version:'0.6.0', ...over };
}
function metering(result, {nodeId, attempt, over={}}) {
 const u=result.usage;
 return { prompt_eval_count:u.prompt_eval_count, prompt_eval_cached_count:u.prompt_eval_cached_count, eval_count:u.eval_count, total_duration_ns:u.total_duration_ns, load_duration_ns:u.load_duration_ns, prompt_eval_duration_ns:u.prompt_eval_duration_ns, eval_duration_ns:u.eval_duration_ns, model:result.model, model_digest:u.model_digest, runtime_version:u.ollama_version, node_id:nodeId, attempt, ...over };
}
async function enqueue({implementation='qwen3.8b.local', input={prompt:'hi'}, maxAttempts=3, idempotencyKey=null}={}) {
 const r=(await one("select public.compute_enqueue_task($1::uuid,'ai.chat',$2::text,$3::text::jsonb,'{}'::jsonb,0,null::timestamptz,$4::integer,'{}'::jsonb,$5::text) as r",[ORG,implementation,JSON.stringify(input),maxAttempts,idempotencyKey])).r;
 assert.equal(r.conflict,false); return r.task.id;
}
async function reserve(opKey, accountId, taskId, max, deadline=null, modelClass=null, unitVersion=null) {
 return (await one('select public.compute_ledger_reserve($1,$2,$3::uuid,$4::bigint,$5::integer,$6::text,$7::integer) as r',[opKey,accountId,taskId,String(max),deadline,modelClass,unitVersion])).r;
}
async function settle(opKey, taskId, tokenHash, attempt, met, outputSha, holder=HOLDER, term=1, connection=db) {
 const {rows}=await connection.query('select public.compute_ledger_settle($1,$2::uuid,$3,$4::integer,$5::text::jsonb,$6,$7::text,$8::bigint) as r',[opKey,taskId,tokenHash,attempt,JSON.stringify(met),outputSha,holder,term]);
 return rows[0].r;
}
async function release(opKey, taskId, reason, holder=HOLDER, term=1) {
 return (await one('select public.compute_ledger_release($1,$2::uuid,$3,$4::text,$5::bigint) as r',[opKey,taskId,reason,holder,term])).r;
}
async function correct(opKey, correctionOf, accountId, spend, units, reason) {
 return (await one('select public.compute_ledger_correct($1,$2::bigint,$3,$4::bigint,$5::bigint,$6) as r',[opKey,correctionOf,accountId,String(spend),String(units),reason])).r;
}
async function balances(accountId) { return (await one('select public.compute_ledger_balances($1) as r',[accountId])).r; }
async function receipt(taskId) { return (await one('select public.compute_ledger_receipt($1::uuid) as r',[taskId])).r; }
async function claim(nodeId, taskId) {
 const c=(await one(`select public.compute_claim_task($1,array['ai.chat'],${IMPLS}) as r`,[nodeId])).r;
 assert.ok(c,`claim for ${taskId} returned null`); assert.equal(c.task_id,taskId,'claim took the expected task');
 return { leaseId:c.lease_id, token:c.lease_token, tokenHash:sha256(c.lease_token), attempt:Number(c.attempt) };
}
async function runTask(nodeId, taskId, result) {
 const lease=await claim(nodeId,taskId);
 assert.ok((await one('select public.compute_start_lease($1,$2::uuid,$3) as r',[nodeId,lease.leaseId,lease.token])).r,'start');
 assert.equal((await one('select public.compute_complete_lease($1,$2::uuid,$3,$4::text::jsonb) as r',[nodeId,lease.leaseId,lease.token,JSON.stringify(result)])).r,true,'complete');
 return lease;
}
async function microAttempt(nodeId, units, {accountId='owner-1', max=4096, usageOverrides={}}={}) {
 const task=await enqueue({implementation:'micro.local'});
 assert.equal((await reserve(key('reserve'),accountId,task,max)).ok,true);
 const result={model:'micro:1b',content:task,usage:usage({eval_count:units,prompt_eval_count:0,prompt_eval_cached_count:0,eval_duration_ns:100_000_000,model_digest:'sha256:micro',...usageOverrides})};
 const lease=await runTask(nodeId,task,result);
 const operation=key('settle');
 return {
  task,
  settle: (connection=db)=>settle(operation,task,lease.tokenHash,lease.attempt,metering(result,{nodeId,attempt:lease.attempt}),hashJson(result),HOLDER,1,connection)
 };
}
async function cancelTask(taskId) { await q("update public.ops_compute_tasks set status='canceled' where id=$1::uuid and status='queued'",[taskId]); }
async function ledgerRows(taskId) { return q('select kind, account_id, units_micro::text as units_micro, spend_micro::text as spend_micro, reason, attempt from public.ops_compute_contribution_ledger where task_id=$1::uuid order by entry_id',[taskId]); }
const ACCOUNT_IDS=['owner-1','worker-a','worker-b','worker-c','worker-points','quota-acct','frozen-acct','related-acct'];

async function applyLedger() {
 await db.exec(read('supabase/pending/compute_contribution_ledger_v1.sql'));
}
async function seed() {
 await q(`insert into public.ops_compute_accounts(account_id,org_id,kind,status,display_points_opt_in) values
  ('owner-1',$1,'owner','active',false),('worker-a',$1,'community','active',false),('worker-b',$1,'community','active',false),
  ('worker-c',$1,'community','active',false),('worker-points',$1,'community','active',true),('quota-acct',$1,'owner','active',false),
  ('frozen-acct',$1,'owner','frozen',false),('related-acct',$1,'community','active',false) on conflict do nothing`,[ORG]);
 await q(`insert into public.ops_compute_node_accounts(node_id,account_id) values ($1,'worker-a'),($2,'owner-1'),($3,'worker-c'),($4,'worker-points') on conflict do nothing`,[NODE_A,NODE_B,NODE_C,NODE_D]);
 await q(`insert into public.ops_compute_model_classes(model_class,unit_version,approved_models,implementations,out_unit_micro,in_unit_micro,redemption_ratio,min_tokens_per_s,max_tokens_per_s,max_eval_count,max_prompt_eval_count) values
  ('pilot.qwen3-8b',1,$1::text::jsonb,'["qwen3.8b.local"]'::jsonb,1000,100,3,1,200,4096,32768),
  ('pilot.micro',1,'[{"model":"micro:1b","digest":"sha256:micro"}]'::jsonb,'["micro.local"]'::jsonb,1,0,3,1,100000,4096,32768),
  ('pilot.points',1,'[{"model":"points:1b","digest":"sha256:points"}]'::jsonb,'["points.local"]'::jsonb,1000000000,0,3,1,100000,4096,32768) on conflict do nothing`,[JSON.stringify([{model:'qwen3:8b',digest:DIGEST}])]);
 // Opening grants: a correction with negative spend raises the submitter's available balance.
 for(const [acct,amount] of [['owner-1','-1000000000000000'],['quota-acct','-1000000000000000'],['frozen-acct','-1000000000000000'],['related-acct','-1000000000000000']]) {
  const g=await correct(key(`grant-${acct}`),null,acct,amount,0,'pilot opening grant');
  assert.equal(g.ok,true,JSON.stringify(g));
 }
 const acquire=(await one("select public.compute_scheduler_acquire($1::uuid,$2,'primary',300) as r",[ORG,HOLDER])).r;
 assert.ok(['fresh','renewed','expired_takeover'].includes(acquire.reason),JSON.stringify(acquire));
 assert.equal(Number(acquire.term),1);
}

try {
 await db.exec(`do $$ begin create role anon;create role authenticated;create role service_role;exception when duplicate_object then null;end $$;create schema if not exists extensions;create table if not exists public.orgs(id uuid primary key);`);
 // Supabase default privileges, so the privilege assertions prove the file against the database it targets.
 await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;`);
 const files=[
  'supabase/replay_migrations/20260912071000_compute_node_protocol.sql',
  'supabase/migrations/20260919020830_compute_gateway_hardening_live_reconcile.sql',
  'supabase/migrations/20260919021007_compute_capability_concurrency_live_reconcile.sql',
  await migrationPath('compute_lease_authority_v2'),
  await migrationPath('job_attestations_v1'),
  await migrationPath('scheduler_lease_v1')
 ];
 for(const f of files){await db.exec(read(f));console.log(`loaded ${f}`);}
 await db.exec('create table public.ops_compute_accounts(prior_value text)');
 await db.exec("insert into public.ops_compute_accounts values ('preserve')");
 await assert.rejects(applyLedger,/unrecognized catalog fingerprint/);
 assert.equal((await one('select prior_value from public.ops_compute_accounts')).prior_value,'preserve');
 assert.equal((await one("select to_regclass('public.ops_compute_contribution_ledger') as t")).t,null);
 await db.exec('drop table public.ops_compute_accounts');
 ok('a partial preexisting table and its data are preserved before the forward file creates anything');
 await applyLedger();console.log('loaded supabase/pending/compute_contribution_ledger_v1.sql');
 await applyLedger();ok('the forward file applies twice');
 const rollback=()=>db.exec(read('supabase/pending/compute_contribution_ledger_v1.rollback.sql'));
 const tables=['ops_compute_accounts','ops_compute_node_accounts','ops_compute_model_classes','ops_compute_account_quotas','ops_compute_account_relations','ops_compute_private_grants','ops_compute_known_answer_tasks','ops_compute_fraud_reviews','ops_compute_spend_reservations','ops_compute_contribution_ledger','ops_compute_account_carry','ops_compute_display_points','ops_compute_ledger_operations'];
 // Each drift is present when the forward and empty-recovery files start.
 // Savepoints preserve that exact changed baseline across both refusal checks.
 for(const change of [
  'alter table public.ops_compute_account_carry add column future_setting text',
  'grant insert on public.ops_compute_contribution_ledger to authenticated',
  'grant select(carry_micro) on public.ops_compute_account_carry to anon',
  'grant execute on function public.compute_ledger_correct(text,bigint,text,bigint,bigint,text) to anon',
  'alter table public.ops_compute_contribution_ledger disable trigger ops_compute_contribution_ledger_append_only',
  'create policy unexpected_visibility on public.ops_compute_accounts using (true)',
  "create or replace function public.compute_ledger_sha256(p_text text) returns text language sql as $$select 'unexpected'::text$$",
  'create index fixture_carry_idx on public.ops_compute_account_carry(carry_micro)',
  'alter sequence public.ops_compute_contribution_ledger_entry_id_seq increment by 2'
 ]) {
  await db.exec('begin');
  try {
   await db.exec(change);
   for(const action of [applyLedger,rollback]) {
    await db.exec('savepoint changed_install');
    await assert.rejects(action,e=>e.code==='55000' && /unrecognized catalog fingerprint/.test(e.message));
    await db.exec('rollback to changed_install');
   }
   assert.notEqual((await one("select to_regclass('public.ops_compute_contribution_ledger') as t")).t,null);
  } finally {await db.exec('rollback');}
 }
 ok('forward and empty recovery refuse altered columns, table/column/function grants, trigger, policy, routine, index or sequence');
 await rollback();
 await rollback();
 for(const t of tables) assert.equal((await one('select to_regclass($1) as t',[`public.${t}`])).t,null);
 assert.equal((await one("select count(*)::int as n from pg_proc where pronamespace='public'::regnamespace and starts_with(proname::text,'compute_ledger_')")).n,0);
 for(const t of ['ops_compute_tasks','ops_compute_leases','ops_compute_nodes','ops_compute_attestations','ops_compute_scheduler_leases'])
  assert.notEqual((await one('select to_regclass($1) as t',[`public.${t}`])).t,null);
 await applyLedger();
 ok('empty rollback removes its objects, preserves compute tables, tolerates a second rollback and permits re-apply');
 await db.exec('begin isolation level repeatable read');
 try {
  await assert.rejects(rollback,/requires READ COMMITTED/);
 } finally {
  await db.exec('rollback');
 }
 await db.exec('create view public.fixture_carry as select account_id from public.ops_compute_account_carry');
 await assert.rejects(rollback,e=>e.code==='2BP01');
 assert.notEqual((await one("select to_regprocedure('public.compute_ledger_balances(text)') as rpc")).rpc,null);
 await db.exec('drop view public.fixture_carry');
 await db.exec('alter table public.ops_compute_account_carry rename to fixture_carry');
 await assert.rejects(rollback,/incomplete installation/);
 await db.exec('alter table public.fixture_carry rename to ops_compute_account_carry');
 ok('rollback refuses stale snapshots, external dependents and incomplete installations atomically');
 // A table owner can be subject to FORCE RLS. Give the fixture role this
 // exact installation only for the transaction and hide its stored class row.
 await db.exec('begin');
 try {
  await db.exec('create role ledger_recovery_fixture nologin nobypassrls');
  await db.exec('grant create, usage on schema public to ledger_recovery_fixture');
  await db.exec("insert into public.ops_compute_model_classes(model_class,unit_version,out_unit_micro,in_unit_micro,min_tokens_per_s,max_tokens_per_s,max_eval_count,max_prompt_eval_count) values ('visibility.fixture',1,1,0,0,1,1,1)");
  for(const t of tables) await db.exec(`alter table public.${t} owner to ledger_recovery_fixture`);
  await db.exec('alter table public.ops_compute_model_classes force row level security');
  await db.exec('set local role ledger_recovery_fixture');
  assert.equal((await one('select count(*)::int as n from public.ops_compute_model_classes')).n,0);
  await assert.rejects(rollback,e=>e.code==='42501' && /row.level security/.test(e.message));
 } finally {
  await db.exec('rollback');
 }
 ok('recovery refuses when forced row-level security hides a populated table from its owner');
 if(db.native) {
  const changing=db.fork(), installing=db.fork();
  let guarded;
  try {
   await changing.exec('begin');
   await changing.exec('alter table public.ops_compute_accounts add column concurrent_change text');
   guarded=assert.rejects(()=>installing.exec(read('supabase/pending/compute_contribution_ledger_v1.sql')),/unrecognized catalog fingerprint/);
   guarded.catch(()=>{});
   await waitForBlocked(db);await changing.exec('commit');await guarded;
   assert.equal((await one("select count(*)::int as n from pg_attribute where attrelid='public.ops_compute_accounts'::regclass and attname='concurrent_change' and not attisdropped")).n,1);
   await q('alter table public.ops_compute_accounts drop column concurrent_change');
  } finally {
   await changing.exec('rollback');await Promise.allSettled([guarded]);
   await Promise.all([changing.close(),installing.close()]);
  }
  ok('native install waits for the previous schema writer and preserves the newly committed catalog change');
  const writer=db.fork(), recovery=db.fork();
  let refused;
  try {
   await writer.exec('begin');
   await writer.exec("insert into public.ops_compute_model_classes(model_class,unit_version,out_unit_micro,in_unit_micro,min_tokens_per_s,max_tokens_per_s,max_eval_count,max_prompt_eval_count) values ('recovery.fixture',1,1,0,0,1,1,1)");
   refused=assert.rejects(()=>recovery.exec(read('supabase/pending/compute_contribution_ledger_v1.rollback.sql')),/ops_compute_model_classes contains data/);
   refused.catch(()=>{});
   await waitForBlocked(db);
   await writer.exec('commit');
   await refused;
   assert.equal((await one("select unit_version from public.ops_compute_model_classes where model_class='recovery.fixture'")).unit_version,1);
   await q("delete from public.ops_compute_model_classes where model_class='recovery.fixture'");
  } finally {
   await writer.exec('rollback');
   await Promise.allSettled([refused]);
   await Promise.all([writer.close(),recovery.close()]);
  }
  ok('native recovery waits for a configuration writer and preserves the committed row');
 }



 // Privileges.
 const priv=async(role,table,p)=>(await one(`select has_table_privilege($1,$2,$3) as v`,[role,`public.${table}`,p])).v;
 for(const table of ['ops_compute_contribution_ledger','ops_compute_spend_reservations','ops_compute_account_carry','ops_compute_display_points','ops_compute_ledger_operations']) {
  assert.equal(await priv('service_role',table,'select'),true,`${table} select`);
  for(const p of ['insert','update','delete']) assert.equal(await priv('service_role',table,p),false,`${table} ${p} leaked to service_role`);
  for(const role of ['anon','authenticated']) assert.equal(await priv(role,table,'select'),false,`${table} readable by ${role}`);
 }
 for(const table of ['ops_compute_accounts','ops_compute_model_classes','ops_compute_node_accounts','ops_compute_account_quotas','ops_compute_known_answer_tasks','ops_compute_account_relations','ops_compute_private_grants','ops_compute_fraud_reviews']) {
  for(const role of ['anon','authenticated']) assert.equal(await priv(role,table,'select'),false,`${table} readable by ${role}`);
  assert.equal(await priv('service_role',table,'select'),true);
 }
 const fpriv=async(role,sig)=>(await one('select has_function_privilege($1,$2,\'execute\') as v',[role,sig])).v;
 const rpcs=['public.compute_ledger_resolve_submission(uuid,uuid,text)','public.compute_ledger_reserve(text,text,uuid,bigint,integer,text,integer)','public.compute_ledger_settle(text,uuid,text,integer,jsonb,text,text,bigint)','public.compute_ledger_release(text,uuid,text,text,bigint)','public.compute_ledger_correct(text,bigint,text,bigint,bigint,text)','public.compute_ledger_balances(text)','public.compute_ledger_receipt(uuid)'];
 for(const sig of rpcs){assert.equal(await fpriv('service_role',sig),true,`${sig} service_role`);assert.equal(await fpriv('anon',sig),false,`${sig} anon`);assert.equal(await fpriv('authenticated',sig),false,`${sig} authenticated`);}
 for(const sig of ['public.compute_ledger_sha256(text)','public.compute_ledger_term_ok(uuid,text,bigint)','public.compute_ledger_operation_lookup(text,text,text)','public.compute_ledger_balances_internal(text)','public.compute_ledger_append_only()','public.compute_ledger_check_commit_term()','public.compute_ledger_lock_term(uuid,text,bigint)']) assert.equal(await fpriv('service_role',sig),false,`${sig} helper exposed`);
 const rls=await q("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname like 'ops_compute_%' and relkind='r' and not relrowsecurity and relname not in ('ops_compute_nodes','ops_compute_tasks','ops_compute_leases','ops_compute_nonces','ops_compute_attestations','ops_compute_scheduler_leases')");
 assert.deepEqual(rls,[],'every ledger table has RLS on');
 ok('privileges: service_role select-only on the ledger tables, RPCs to service_role only, helpers to nobody, RLS on');

 // The output hash has one implementation (hashJson in core/src/compute/jobs.mjs); the SQL re-derives nothing.
 assert.equal((await one("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='compute_ledger_canonical_json'")).n,0,'no second canonical JSON implementation in SQL');
 assert.equal((await one("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='compute_ledger_reserve'")).n,1,'one reserve signature, no ambiguous overload');
 ok('the SQL carries no canonical JSON of its own and one compute_ledger_reserve signature');

 // Lock order of compute_ledger_settle: node, then lease, then task, as compute_claim_task and compute_transition_lease_v2 take them.
 {
  const src=(await one("select pg_get_functiondef('public.compute_ledger_settle(text,uuid,text,integer,jsonb,text,text,bigint)'::regprocedure) as s")).s;
  const at=(re)=>{const m=re.exec(src); assert.ok(m,`settle source has ${re}`); return m.index;};
  const nodeLock=at(/from public\.ops_compute_nodes where id = v_node_id for update/);
  const leaseLock=at(/from public\.ops_compute_leases\s+where task_id = p_task_id and lease_token_hash = p_lease_token_hash for update/);
  const taskLock=at(/from public\.ops_compute_tasks where id = p_task_id for update/);
  assert.ok(nodeLock<leaseLock&&leaseLock<taskLock,`settle locks node (${nodeLock}) -> lease (${leaseLock}) -> task (${taskLock})`);
  const firstLock=src.indexOf('for update');
  assert.equal(firstLock,nodeLock+src.slice(nodeLock).indexOf('for update'),'the node row is the first row lock the settle takes');
  const v2=(await one("select pg_get_functiondef('public.compute_transition_lease_v2(text,text,uuid,text,jsonb,integer,boolean)'::regprocedure) as s")).s;
  const n2=v2.indexOf('from public.ops_compute_nodes where id=p_node_id for update'), l2=v2.indexOf('from public.ops_compute_leases where id=p_lease_id and node_id=p_node_id for update'), t2=v2.indexOf('from public.ops_compute_tasks where id=v_lease.task_id for update');
  assert.ok(n2>0&&n2<l2&&l2<t2,'compute_transition_lease_v2 locks node -> lease -> task');
  ok('lock order: compute_ledger_settle takes node -> lease -> task, the order of the device lease RPCs');
 }

 await q('insert into public.orgs(id) values($1) on conflict do nothing',[ORG]);
 for(const id of [NODE_A,NODE_B,NODE_C,NODE_D]) await q(`insert into public.ops_compute_nodes(id,org_id,display_name,public_key_pem,key_fingerprint,protocol_version,agent_version,capabilities) values($1,$2,$1,'fixture',$1,'mccluster-compute/1','test',$3::text::jsonb) on conflict do nothing`,[id,ORG,CAPS]);
 await seed();
 const MAX=4096*1000+32768*100; // the class bound: max_eval_count*out + max_prompt_eval_count*in
 const UNITS=50*1000+(100-20)*100; // 58,000 micro-units for usage()

 // Exercise the actual submit service against the SQL RPCs. Only the HTTP
 // transport and fleet advertisement are substituted by the disposable fixture.
 {
  const body={capability:'ai.chat',implementation:'qwen3.8b.local',input:{prompt:'submission retry'},account_id:'owner-1'};
  const options={canonicalOrg:ORG,idempotencyKey:'accepted-price'};
  let loseReserve=true, loseActivation=true, prices=0, taskId;
  const deps={
   env:{}, ledgerEnabled:()=>true, live:async()=>[{node_id:NODE_A,capability:'ai.chat',implementation:body.implementation}], log:()=>{},
   enqueue:async a=>{
    const result=(await one('select public.compute_enqueue_task($1::uuid,$2,$3,$4::text::jsonb,$5::text::jsonb,$6,$7::timestamptz,$8,$9::text::jsonb,$10) as r',
     [a.orgId,a.capability,a.implementation,JSON.stringify(a.input),JSON.stringify(a.requirements),a.priority,a.runAfter,a.maxAttempts,JSON.stringify(a.metadata),a.idempotencyKey])).r;
    assert.equal(result.conflict,false); taskId=result.task.id; return result;
   },
   modelClasses:async()=>{prices++;return q('select * from public.ops_compute_model_classes');},
   rpc:async(name,p)=>{
    if(name==='compute_ledger_resolve_submission') return (await one('select public.compute_ledger_resolve_submission($1,$2,$3) as r',[p.p_task_id,p.p_org_id,p.p_cancel_reason])).r;
    assert.equal(name,'compute_ledger_reserve');
    const result=await reserve(p.p_op_key,p.p_account_id,p.p_task_id,p.p_max_units_micro,p.p_deadline_seconds,p.p_model_class,p.p_unit_version);
    if(loseReserve){loseReserve=false;throw new Error('fixture dropped accepted reserve response');}
    return result;
   },
   activateHeld:async({taskId:task,runAfter})=>{
    if(loseActivation){loseActivation=false;throw new Error('fixture activation unavailable');}
    return one("update public.ops_compute_tasks set run_after=coalesce($2::timestamptz,clock_timestamp()) where id=$1 and status='queued' and run_after='9999-12-31 00:00:00+00' returning *",[task,runAfter]);
   }
  };
  await assert.rejects(()=>submitJob(body,options,deps),e=>e.code==='LEDGER_RESERVE_FAILED');
  const pinned=await one('select model_class,unit_version,max_units_micro::text as price from public.ops_compute_spend_reservations where task_id=$1',[taskId]);
  await q("update public.ops_compute_model_classes set unit_version=2,out_unit_micro=17 where model_class='pilot.qwen3-8b'");
  await assert.rejects(()=>submitJob(body,options,deps),e=>e.code==='LEDGER_ACTIVATE_FAILED');
  const replay=await submitJob(body,options,deps);
  assert.equal(replay.ledger.replayed,true);assert.equal(replay.ledger.unit_version,pinned.unit_version);
  assert.equal(String(replay.ledger.max_units_micro),pinned.price);assert.equal(prices,1);
  assert.equal((await ledgerRows(taskId)).length,1);
  const guarded=(await one("select public.compute_ledger_resolve_submission($1,$2,'late refusal') as r",[taskId,ORG])).r;
  assert.equal(guarded.canceled,false);assert.equal(guarded.reservation.reservation_id,replay.ledger.reservation_id);
  await q("update public.ops_compute_model_classes set unit_version=1,out_unit_micro=1000 where model_class='pilot.qwen3-8b'");
  await cancelTask(taskId);assert.equal((await release(key('release'),taskId,'fixture complete')).ok,true);
  ok('submit retries recover original SQL reservation after response loss, repricing and failed activation');
 }
 if(db.native) {
  // A worker has just reserved an old held job while the sweep is deciding
  // whether it was abandoned. The conditional cancel must see that commit.
  const create=async()=> (await one("select public.compute_enqueue_task($1::uuid,'ai.chat','qwen3.8b.local','{}','{}',0,'9999-12-31 00:00:00+00',1,$2::text::jsonb,null) as r",[ORG,JSON.stringify({contribution:{account_id:'owner-1'}})])).r.task.id;
  const task=await create(), orphan=await create();
  const writer=db.fork(), cleanup=db.fork();
  let pending;
  try {
   await writer.exec('begin');
   const {rows}=await writer.query('select public.compute_ledger_reserve($1,$2,$3::uuid,$4::bigint) as r',[`reserve:${task}`,'owner-1',task,'100']);
   assert.equal(rows[0].r.ok,true);
   pending=cleanup.query("select public.compute_ledger_resolve_submission($1,$2,'never reserved') as r",[task,ORG]);
   pending.catch(()=>{});
   await waitForBlocked(db);await writer.exec('commit');
   const state=(await pending).rows[0].r;
   assert.equal(state.canceled,false);assert.equal(state.reservation.reservation_id,rows[0].r.reservation_id);
   assert.equal((await one('select status from public.ops_compute_tasks where id=$1',[task])).status,'queued');
   assert.equal((await one("select public.compute_ledger_resolve_submission($1,$2,'never reserved') as r",[orphan,ORG])).r.canceled,true);
  } finally {
   await writer.exec('rollback');await Promise.allSettled([pending]);
   await Promise.all([writer.close(),cleanup.close()]);
  }
  await cancelTask(task);assert.equal((await release(key('release'),task,'fixture complete')).ok,true);
  ok('native hold cleanup waits for a concurrent reservation and cancels only the unreserved job');
 }
 // 1. Accepted settle; concurrent settle under one key (two in flight, one mint).
 {
  const task=await enqueue();
  const r=await reserve(key('reserve'),'owner-1',task,MAX); assert.equal(r.ok,true,JSON.stringify(r));
  const before=await balances('owner-1'); assert.equal(Number(before.pending),MAX);
  const result={model:'qwen3:8b',content:'hello',usage:usage()};
  const lease=await runTask(NODE_A,task,result);
  const k=key('settle');
  const met=metering(result,{nodeId:NODE_A,attempt:lease.attempt});
  const [s1,s2]=await Promise.all([settle(k,task,lease.tokenHash,1,met,hashJson(result)),settle(k,task,lease.tokenHash,1,met,hashJson(result))]);
  const fresh=[s1,s2].find(s=>s.replayed===false), replayed=[s1,s2].find(s=>s.replayed===true);
  assert.ok(fresh&&replayed,JSON.stringify([s1,s2]));
  assert.equal(fresh.ok,true); assert.equal(fresh.accepted,true); assert.equal(fresh.reason,'accepted');
  assert.equal(Number(fresh.units_micro),UNITS); assert.equal(Number(fresh.spend_micro),UNITS);
  assert.equal(Number(fresh.minted_micro),Math.floor(UNITS/3)); assert.equal(Number(fresh.carry_micro),UNITS%3);
  assert.equal(Number(fresh.released_micro),MAX-UNITS);
  assert.deepEqual({...replayed,replayed:false},fresh);
  const rows=await ledgerRows(task);
  assert.deepEqual(rows.map(r=>r.kind),['reserve','settle','mint','release']);
  assert.equal(rows.filter(r=>r.kind==='mint').length,1);
  const w=await balances('worker-a'); assert.equal(Number(w.earned),Math.floor(UNITS/3)); assert.equal(Number(w.carry_micro),UNITS%3); assert.equal(Number(w.available),Math.floor(UNITS/3));
  const o=await balances('owner-1'); assert.equal(Number(o.pending),0); assert.equal(Number(o.spent),UNITS-1000000000000000);
  assert.equal((await one('select status from public.ops_compute_spend_reservations where task_id=$1::uuid',[task])).status,'settled');
  ok('concurrent settle under one key: one mint, one replay, reservation settled, unused part released');
  // 2. replay same payload
  const again=await settle(k,task,lease.tokenHash,1,met,hashJson(result));
  assert.equal(again.replayed,true); assert.equal(again.accepted,true); assert.deepEqual(again.entries,fresh.entries);
  assert.equal((await one('select count(*)::int as n from public.ops_compute_contribution_ledger where task_id=$1::uuid',[task])).n,4);
  ok('replay same payload: replayed true, nothing appended');
  // 3. same key different payload
  const conflict=await settle(k,task,lease.tokenHash,1,{...met,eval_count:51},hashJson(result));
  assert.equal(conflict.ok,false); assert.equal(conflict.code,'CONFLICT');
  ok('same key different payload: CONFLICT');
  // duplicate settle under a fresh key
  const dup=await settle(key('settle'),task,lease.tokenHash,1,met,hashJson(result));
  assert.equal(dup.ok,false); assert.equal(dup.code,'DUPLICATE_SETTLE');
  ok('second settle of the same (task, attempt) under a new key: DUPLICATE_SETTLE');
  // receipt
  const rc=await receipt(task);
  assert.equal(rc.schema,'mccluster-ledger-receipt/1'); assert.equal(rc.reservation.status,'settled'); assert.equal(rc.settle.kind,'settle'); assert.equal(rc.mint.kind,'mint'); assert.equal(rc.verdict.accepted,true); assert.equal(rc.releases.length,1); assert.deepEqual(rc.reviews,[]);
  ok('ledger receipt: reservation, settle, mint, release, verdict');
 }

 // 4. Revoked node: no mint, settle recorded, review not opened.
 {
  const task=await enqueue(); assert.equal((await reserve(key('reserve'),'owner-1',task,MAX)).ok,true);
  const result={model:'qwen3:8b',content:'r',usage:usage()};
  const lease=await runTask(NODE_A,task,result);
  await q("update public.ops_compute_nodes set state='revoked', revoked_at=clock_timestamp() where id=$1",[NODE_A]);
  const s=await settle(key('settle'),task,lease.tokenHash,1,metering(result,{nodeId:NODE_A,attempt:1}),hashJson(result));
  assert.equal(s.ok,true); assert.equal(s.accepted,false); assert.equal(s.reason,'NODE_UNAVAILABLE'); assert.equal(Number(s.minted_micro),0); assert.equal(s.review_opened,false);
  assert.equal(s.charged,false); assert.equal(Number(s.spend_micro),0); assert.equal(Number(s.released_micro),MAX); assert.equal(s.reservation_status,'released');
  const rows=await ledgerRows(task); assert.deepEqual(rows.map(r=>r.kind),['reserve','settle','release']);
  assert.equal(Number(rows[1].spend_micro),0,'a worker-side rejection charges the submitter nothing'); assert.equal(Number(rows[1].units_micro),UNITS,'the claimed units stay on record');
  assert.equal(Number(rows[2].units_micro),MAX); assert.equal(rows[2].reason,'rejected:NODE_UNAVAILABLE');
  assert.equal((await one('select status from public.ops_compute_spend_reservations where task_id=$1::uuid',[task])).status,'released');
  assert.equal((await one('select count(*)::int as n from public.ops_compute_fraud_reviews')).n,0);
  await q("update public.ops_compute_nodes set state='online', revoked_at=null, last_seen_at=clock_timestamp() where id=$1",[NODE_A]);
  ok('revoked node: no mint, settle recorded with spend 0, the whole reservation released, review not opened');
 }

 // 5. Stale attempt: LEASE_REJECTED.
 {
  const task=await enqueue(); assert.equal((await reserve(key('reserve'),'owner-1',task,MAX)).ok,true);
  const first=await claim(NODE_A,task);
  assert.ok((await one('select public.compute_start_lease($1,$2::uuid,$3) as r',[NODE_A,first.leaseId,first.token])).r);
  await q("update public.ops_compute_leases set expires_at=clock_timestamp()-interval '1 second' where id=$1::uuid",[first.leaseId]);
  assert.equal((await one(`select public.compute_claim_task($1,array['ai.chat'],${IMPLS}) as r`,[NODE_B])).r,null,'the reclaim pass requeues and hands out nothing yet');
  await q("update public.ops_compute_tasks set run_after=clock_timestamp()-interval '1 second' where id=$1::uuid",[task]);
  const result={model:'qwen3:8b',content:'second',usage:usage()};
  const second=await runTask(NODE_A,task,result); assert.equal(second.attempt,2);
  const stale=await settle(key('settle'),task,first.tokenHash,1,metering(result,{nodeId:NODE_A,attempt:1}),hashJson(result));
  assert.equal(stale.ok,false); assert.equal(stale.code,'LEASE_REJECTED');
  const wrongAttempt=await settle(key('settle'),task,second.tokenHash,1,metering(result,{nodeId:NODE_A,attempt:1}),hashJson(result));
  assert.equal(wrongAttempt.code,'LEASE_REJECTED');
  assert.deepEqual((await ledgerRows(task)).map(r=>r.kind),['reserve'],'a refused settle writes nothing');
  const good=await settle(key('settle'),task,second.tokenHash,2,metering(result,{nodeId:NODE_A,attempt:2}),hashJson(result));
  assert.equal(good.accepted,true); assert.equal(good.attempt,2);
  ok('stale attempt: LEASE_REJECTED for the old lease and for a wrong attempt; the completing lease settles');
 }

 // 6. Cancellation: release, no settle.
 {
  const task=await enqueue(); assert.equal((await reserve(key('reserve'),'owner-1',task,MAX)).ok,true);
  await cancelTask(task);
  const k=key('release');
  const r=await release(k,task,'canceled'); assert.equal(r.ok,true); assert.equal(r.released,true); assert.equal(Number(r.released_micro),MAX);
  const again=await release(k,task,'canceled'); assert.equal(again.replayed,true); assert.equal(again.released,true);
  const closed=await release(key('release'),task,'canceled'); assert.equal(closed.ok,false); assert.equal(closed.code,'RESERVATION_CLOSED');
  const rows=await ledgerRows(task); assert.deepEqual(rows.map(r=>r.kind),['reserve','release']);
  assert.equal((await one('select status from public.ops_compute_spend_reservations where task_id=$1::uuid',[task])).status,'released');
  assert.equal(Number((await balances('owner-1')).pending),0);
  ok('cancellation: release (idempotent), no settle, pending back to zero');
 }

 // 7. Over-budget reserve, frozen account, unknown account, task already reserved.
 {
  const task=await enqueue();
  const bal=await balances('owner-1');
  const over=await reserve(key('reserve'),'owner-1',task,Number(bal.available)+1); assert.equal(over.ok,false); assert.equal(over.code,'OVER_BUDGET');
  const frozen=await reserve(key('reserve'),'frozen-acct',task,1); assert.equal(frozen.code,'ACCOUNT_FROZEN');
  const unknown=await reserve(key('reserve'),'nobody',task,1); assert.equal(unknown.code,'ACCOUNT_UNKNOWN');
  const poor=await reserve(key('reserve'),'worker-b',task,1); assert.equal(poor.code,'OVER_BUDGET','an account with nothing earned cannot reserve');
  assert.equal((await one('select count(*)::int as n from public.ops_compute_spend_reservations where task_id=$1::uuid',[task])).n,0);
  const okRes=await reserve(key('reserve'),'owner-1',task,MAX); assert.equal(okRes.ok,true);
  const twice=await reserve(key('reserve'),'owner-1',task,MAX); assert.equal(twice.code,'TASK_RESERVED');
  await cancelTask(task); assert.equal((await release(key('release'),task,'canceled')).ok,true);
  ok('over-budget reserve: OVER_BUDGET; ACCOUNT_FROZEN; ACCOUNT_UNKNOWN; TASK_RESERVED');
 }

 // 7b. Reserve refuses a task that is not queued; a replay of an accepted reserve still replays after the task moved on.
 {
  const canceled=await enqueue(); await cancelTask(canceled);
  const rc=await reserve(key('reserve'),'owner-1',canceled,MAX); assert.equal(rc.ok,false); assert.equal(rc.code,'TASK_NOT_QUEUED'); assert.equal(rc.task_status,'canceled');
  const done=await enqueue(); const result={model:'qwen3:8b',content:'unreserved',usage:usage()};
  const lease=await runTask(NODE_A,done,result);
  const none=await settle(key('settle'),done,lease.tokenHash,1,metering(result,{nodeId:NODE_A,attempt:1}),hashJson(result)); assert.equal(none.code,'NO_RESERVATION');
  const rd=await reserve(key('reserve'),'owner-1',done,MAX); assert.equal(rd.code,'TASK_NOT_QUEUED'); assert.equal(rd.task_status,'done');
  const running=await enqueue(); const held=await claim(NODE_A,running);
  assert.equal((await reserve(key('reserve'),'owner-1',running,MAX)).code,'TASK_NOT_QUEUED','a task a node already holds is not reserved');
  assert.equal((await one('select public.compute_fail_lease($1,$2::uuid,$3,$4,false) as r',[NODE_A,held.leaseId,held.token,'fixture'])).r,true);
  for(const t of [canceled,done,running]) assert.equal((await one('select count(*)::int as n from public.ops_compute_spend_reservations where task_id=$1::uuid',[t])).n,0,'nothing was opened');
  const live=await enqueue(); const k=key('reserve'); const first=await reserve(k,'owner-1',live,MAX); assert.equal(first.ok,true);
  const result2={model:'qwen3:8b',content:'replay',usage:usage()}; const lease2=await runTask(NODE_A,live,result2);
  const again=await reserve(k,'owner-1',live,MAX); assert.equal(again.ok,true); assert.equal(again.replayed,true,'the same key replays its stored outcome whatever the task state');
  assert.equal((await settle(key('settle'),live,lease2.tokenHash,1,metering(result2,{nodeId:NODE_A,attempt:1}),hashJson(result2))).accepted,true);
  ok('reserve refuses a task that is not queued (TASK_NOT_QUEUED: canceled, done, leased); an accepted reserve replays');
 }

 // 7c. unit_version pinned at reserve time and enforced at settle.
 {
  const task=await enqueue(); const r=await reserve(key('reserve'),'owner-1',task,MAX,null,'pilot.qwen3-8b',1);
  assert.equal(r.ok,true,JSON.stringify(r)); assert.equal(r.model_class,'pilot.qwen3-8b'); assert.equal(Number(r.unit_version),1);
  const pinned=await one('select model_class, unit_version from public.ops_compute_spend_reservations where task_id=$1::uuid',[task]);
  assert.deepEqual({model_class:pinned.model_class,unit_version:Number(pinned.unit_version)},{model_class:'pilot.qwen3-8b',unit_version:1});
  const byImpl=await enqueue({implementation:'micro.local'}); assert.equal((await reserve(key('reserve'),'owner-1',byImpl,4096)).model_class,'pilot.micro','without p_model_class the task implementation picks the class');
  await cancelTask(byImpl); assert.equal((await release(key('release'),byImpl,'canceled')).ok,true);
  const stale=await enqueue(); const rs=await reserve(key('reserve'),'owner-1',stale,MAX,null,'pilot.qwen3-8b',2);
  assert.equal(rs.ok,false); assert.equal(rs.code,'UNIT_VERSION_STALE','the Core priced with a version the class no longer has');
  assert.equal((await reserve(key('reserve'),'owner-1',stale,MAX,null,'no.such-class',1)).code,'MODEL_CLASS_UNKNOWN');
  await cancelTask(stale);
  // The owner bumps the class while the reserved task runs: the settle is held to version 1.
  const result={model:'qwen3:8b',content:'pinned',usage:usage()};
  const lease=await runTask(NODE_A,task,result);
  await q("update public.ops_compute_model_classes set unit_version=2, out_unit_micro=5000 where model_class='pilot.qwen3-8b'");
  const before=await balances('owner-1');
  const s=await settle(key('settle'),task,lease.tokenHash,1,metering(result,{nodeId:NODE_A,attempt:1}),hashJson(result));
  assert.equal(s.ok,true,JSON.stringify(s)); assert.equal(s.accepted,false); assert.equal(s.reason,'UNIT_VERSION_STALE'); assert.equal(s.charged,false); assert.equal(Number(s.spend_micro),0); assert.equal(Number(s.minted_micro),0);
  const after=await balances('owner-1'); assert.equal(BigInt(after.spent),BigInt(before.spent),'nothing is priced at weights the reservation never saw'); assert.equal(BigInt(after.available),BigInt(before.available)+BigInt(MAX));
  await q("update public.ops_compute_model_classes set unit_version=1, out_unit_micro=1000 where model_class='pilot.qwen3-8b'");
  // A reservation pinned to another class than the one the node ran is refused the same way.
  const cross=await enqueue({implementation:'micro.local'}); assert.equal((await reserve(key('reserve'),'owner-1',cross,MAX,null,'pilot.micro',1)).ok,true);
  const lc=await runTask(NODE_A,cross,result);
  const sc=await settle(key('settle'),cross,lc.tokenHash,1,metering(result,{nodeId:NODE_A,attempt:1}),hashJson(result));
  assert.equal(sc.reason,'MODEL_CLASS_MISMATCH'); assert.equal(sc.charged,false);
  ok('unit_version: pinned on the reservation, refused at reserve when stale, UNIT_VERSION_STALE at settle after a bump, MODEL_CLASS_MISMATCH for another class');
 }

 // 8. Stale scheduler term.
 {
  const task=await enqueue(); assert.equal((await reserve(key('reserve'),'owner-1',task,MAX)).ok,true);
  const result={model:'qwen3:8b',content:'t',usage:usage()};
  const lease=await runTask(NODE_A,task,result);
  const met=metering(result,{nodeId:NODE_A,attempt:1});
  for(const [holder,term] of [[HOLDER,7],['core-standby',1],[HOLDER,null],[null,null]]) {
   const s=await settle(key('settle'),task,lease.tokenHash,1,met,hashJson(result),holder,term);
   assert.equal(s.ok,false,JSON.stringify(s)); assert.equal(s.code,'STALE_TERM',`holder ${holder} term ${term}`);
  }
  const rel=await release(key('release'),task,'x',HOLDER,2); assert.equal(rel.code,'STALE_TERM');
  assert.deepEqual((await ledgerRows(task)).map(r=>r.kind),['reserve']);
  // A row that exists but is expired or released is still the org's row: a null term is refused, and so is its own old (holder, term).
  const live=await one('select expires_at, released_at from public.ops_compute_scheduler_leases where org_id=$1::uuid',[ORG]);
  for(const [label,sql] of [['expired',"update public.ops_compute_scheduler_leases set expires_at=clock_timestamp()-interval '1 second' where org_id=$1::uuid"],['released',"update public.ops_compute_scheduler_leases set released_at=clock_timestamp(), expires_at=clock_timestamp() where org_id=$1::uuid"]]) {
   await q(sql,[ORG]);
   for(const [holder,term] of [[HOLDER,null],['core-standby',null],[null,null],[HOLDER,1]]) {
    const s=await settle(key('settle'),task,lease.tokenHash,1,met,hashJson(result),holder,term);
    assert.equal(s.code,'STALE_TERM',`${label} row, holder ${holder} term ${term}: ${JSON.stringify(s)}`);
    const r=await release(key('release'),task,'x',holder,term); assert.equal(r.code,'STALE_TERM',`${label} row release, holder ${holder} term ${term}`);
   }
  }
  assert.deepEqual((await ledgerRows(task)).map(r=>r.kind),['reserve'],'nobody wrote during the gap');
  // No row at all (the election never used): the single scheduler's null term is accepted and recorded as null.
  await db.exec('create temp table sched_backup as select * from public.ops_compute_scheduler_leases; delete from public.ops_compute_scheduler_leases;');
  const single=await enqueue(); assert.equal((await reserve(key('reserve'),'owner-1',single,MAX)).ok,true);
  const r1={model:'qwen3:8b',content:'single',usage:usage()}; const l1=await runTask(NODE_A,single,r1);
  assert.equal((await settle(key('settle'),single,l1.tokenHash,1,metering(r1,{nodeId:NODE_A,attempt:1}),hashJson(r1),'core-single',7)).code,'STALE_TERM','a term with no scheduler row is not a live term');
  const s1=await settle(key('settle'),single,l1.tokenHash,1,metering(r1,{nodeId:NODE_A,attempt:1}),hashJson(r1),'core-single',null); assert.equal(s1.accepted,true,JSON.stringify(s1));
  assert.equal((await one("select scheduler_term from public.ops_compute_contribution_ledger where task_id=$1::uuid and kind='settle'",[single])).scheduler_term,null);
  await db.exec('insert into public.ops_compute_scheduler_leases select * from sched_backup; drop table sched_backup;');
  await q('update public.ops_compute_scheduler_leases set expires_at=$2, released_at=$3 where org_id=$1::uuid',[ORG,live.expires_at,live.released_at]);
  const good=await settle(key('settle'),task,lease.tokenHash,1,met,hashJson(result)); assert.equal(good.accepted,true);
  ok('stale scheduler term: STALE_TERM on settle and release, nothing written; the live (holder, term) settles');
  ok('scheduler fence: a null term is refused whenever a scheduler row exists (live, expired or released) and accepted only with no row');
 }

 // 9. Known-answer mismatch: no mint, review row; a match mints.
 {
  const task=await enqueue(); assert.equal((await reserve(key('reserve'),'owner-1',task,MAX)).ok,true);
  const result={model:'qwen3:8b',content:'wrong answer',usage:usage()};
  await q('insert into public.ops_compute_known_answer_tasks(task_id,expected_sha256) values($1::uuid,$2)',[task,hashJson({model:'qwen3:8b',content:'right answer',usage:usage()})]);
  const lease=await runTask(NODE_A,task,result);
  const s=await settle(key('settle'),task,lease.tokenHash,1,metering(result,{nodeId:NODE_A,attempt:1}),hashJson(result));
  assert.equal(s.ok,true); assert.equal(s.accepted,false); assert.equal(s.reason,'KNOWN_ANSWER_MISMATCH'); assert.equal(s.review_opened,true); assert.equal(Number(s.minted_micro),0);
  const reviews=await q('select * from public.ops_compute_fraud_reviews where task_id=$1::uuid',[task]);
  assert.equal(reviews.length,1); assert.equal(reviews[0].kind,'known_answer_mismatch'); assert.equal(reviews[0].status,'open'); assert.equal(reviews[0].node_id,NODE_A);
  assert.equal((await one('select state from public.ops_compute_nodes where id=$1',[NODE_A])).state,'online','the function never quarantines');
  assert.equal((await receipt(task)).reviews.length,1);
  const task2=await enqueue(); assert.equal((await reserve(key('reserve'),'owner-1',task2,MAX)).ok,true);
  const result2={model:'qwen3:8b',content:'right answer',usage:usage()};
  await q('insert into public.ops_compute_known_answer_tasks(task_id,expected_sha256) values($1::uuid,$2)',[task2,hashJson(result2)]);
  const lease2=await runTask(NODE_A,task2,result2);
  const s2=await settle(key('settle'),task2,lease2.tokenHash,1,metering(result2,{nodeId:NODE_A,attempt:1}),hashJson(result2));
  assert.equal(s2.accepted,true); assert.equal(s2.review_opened,false);
  ok('known-answer mismatch: no mint, review row, node untouched; a match mints');
 }

 // 10. Self-routed and related accounts: no mint, settle yes.
 {
  const task=await enqueue(); assert.equal((await reserve(key('reserve'),'owner-1',task,MAX)).ok,true);
  const result={model:'qwen3:8b',content:'self',usage:usage()};
  const lease=await runTask(NODE_B,task,result); // NODE_B works for owner-1, the submitter
  const s=await settle(key('settle'),task,lease.tokenHash,1,metering(result,{nodeId:NODE_B,attempt:1}),hashJson(result));
  assert.equal(s.ok,true); assert.equal(s.accepted,false); assert.equal(s.reason,'SELF_ROUTED'); assert.equal(Number(s.minted_micro),0); assert.equal(Number(s.spend_micro),UNITS);
  assert.deepEqual((await ledgerRows(task)).map(r=>r.kind),['reserve','settle','release']);
  await q("insert into public.ops_compute_account_relations(account_id,related_account_id,reason) values ('related-acct','worker-a','same household')");
  const task2=await enqueue(); assert.equal((await reserve(key('reserve'),'related-acct',task2,MAX)).ok,true);
  const lease2=await runTask(NODE_A,task2,result);
  const s2=await settle(key('settle'),task2,lease2.tokenHash,1,metering(result,{nodeId:NODE_A,attempt:1}),hashJson(result));
  assert.equal(s2.accepted,false); assert.equal(s2.reason,'SELF_ROUTED');
  assert.equal(Number((await balances('related-acct')).spent),UNITS-1000000000000000,'the submitter still pays');
  ok('self-routed and related accounts: no mint, settle recorded, submitter pays');
 }

 // 11. Late completion: no mint.
 {
  const task=await enqueue(); assert.equal((await reserve(key('reserve'),'owner-1',task,MAX,60)).ok,true);
  const result={model:'qwen3:8b',content:'late',usage:usage()};
  const lease=await runTask(NODE_A,task,result);
  await q("update public.ops_compute_spend_reservations set expires_at=clock_timestamp()-interval '1 second' where task_id=$1::uuid",[task]);
  const s=await settle(key('settle'),task,lease.tokenHash,1,metering(result,{nodeId:NODE_A,attempt:1}),hashJson(result));
  assert.equal(s.ok,true); assert.equal(s.accepted,false); assert.equal(s.reason,'LATE'); assert.equal(Number(s.minted_micro),0);
  assert.equal(s.charged,false); assert.equal(Number(s.spend_micro),0); assert.equal(Number(s.released_micro),MAX);
  ok('late completion: no mint, no charge, reason LATE');
 }

 // 12. Counters out of window / invalid; model and digest allowlist; output hash.
 {
  const cases=[
   ['COUNTERS_OUT_OF_WINDOW',{eval_duration_ns:1_000_000}], // 50,000 tokens/s
   ['COUNTERS_OUT_OF_WINDOW',{eval_count:5000,eval_duration_ns:100_000_000_000}], // above max_eval_count
   ['COUNTERS_OUT_OF_WINDOW',{prompt_eval_count:40000,prompt_eval_cached_count:0}],
   ['COUNTERS_INVALID',{prompt_eval_cached_count:101}],
   ['COUNTERS_INVALID',{eval_count:-1}],
   ['COUNTERS_INVALID',{eval_count:12.5}],
   ['COUNTERS_INVALID',{eval_duration_ns:0}],
   ['DIGEST_NOT_APPROVED',{model_digest:'sha256:other'}],
   ['MODEL_NOT_APPROVED',{},{model:'llama:1b'}],
   ['UNIT_VERSION_STALE',{},{},{unit_version:2}]
  ];
  for(const [code,over,resultOver={},metOver={}] of cases) {
   const task=await enqueue(); assert.equal((await reserve(key('reserve'),'owner-1',task,MAX)).ok,true);
   const result={model:'qwen3:8b',content:'c',...resultOver,usage:usage(over)};
   const lease=await runTask(NODE_A,task,result);
   const s=await settle(key('settle'),task,lease.tokenHash,1,metering(result,{nodeId:NODE_A,attempt:1,over:metOver}),hashJson(result));
   assert.equal(s.ok,true,JSON.stringify(s)); assert.equal(s.accepted,false,code); assert.equal(s.reason,code,JSON.stringify({code,over,s})); assert.equal(Number(s.minted_micro),0);
   assert.equal(s.charged,false,`${code} is the worker's side: no charge`); assert.equal(Number(s.spend_micro),0,code); assert.equal(Number(s.released_micro),MAX,code);
   assert.equal((await one('select status from public.ops_compute_spend_reservations where task_id=$1::uuid',[task])).status,'released',code);
  }
  // Output hash: the hash passed in must be the one the gateway recorded with the node's completion attestation.
  const task=await enqueue(); assert.equal((await reserve(key('reserve'),'owner-1',task,MAX)).ok,true);
  const result={model:'qwen3:8b',content:'h',usage:usage()};
  const lease=await runTask(NODE_A,task,result);
  await q("insert into public.ops_compute_attestations(lease_id,task_id,node_id,attempt,protocol,method,path,signed_at,nonce,body_digest,signature,result_sha256) values($1::uuid,$2::uuid,$3,1,'mccluster-compute/1','POST',$4,'2026-11-23T00:00:00.000Z',$5,$6,$7,$8)",[lease.leaseId,task,NODE_A,`/v1/compute/leases/${lease.leaseId}/complete`,'a'.repeat(32),'A'.repeat(43),'A'.repeat(86),hashJson(result)]);
  const before=await balances('owner-1');
  const s=await settle(key('settle'),task,lease.tokenHash,1,metering(result,{nodeId:NODE_A,attempt:1}),hashJson({...result,content:'tampered'}));
  assert.equal(s.accepted,false); assert.equal(s.reason,'OUTPUT_HASH_MISMATCH'); assert.equal(s.charged,false); assert.equal(Number(s.spend_micro),0);
  assert.equal(BigInt((await balances('owner-1')).spent),BigInt(before.spent),'a hash mismatch costs the submitter nothing');
  // ... and the lease's result must be the task's stored output.
  const task2=await enqueue(); assert.equal((await reserve(key('reserve'),'owner-1',task2,MAX)).ok,true);
  const lease2=await runTask(NODE_A,task2,result);
  await q("update public.ops_compute_tasks set output=output||'{\"content\":\"swapped\"}'::jsonb where id=$1::uuid",[task2]);
  const s2=await settle(key('settle'),task2,lease2.tokenHash,1,metering(result,{nodeId:NODE_A,attempt:1}),hashJson(result));
  assert.equal(s2.reason,'OUTPUT_HASH_MISMATCH'); assert.equal(s2.charged,false);
  ok('counters out of window and invalid, digest and model allowlist, unit version, output hash: no mint, no charge, reservation released, reason named');
 }

 // 12b. A real Ollama result: prompt_eval_cached_count null, zero counters omitted. Unreported means 0, not invalid.
 {
  for(const [label,strip,expectUnits] of [['cached null',(u)=>({...u,prompt_eval_cached_count:null}),50*1000+100*100],['cached and load absent',(u)=>{const {prompt_eval_cached_count,load_duration_ns,...rest}=u;return rest;},50*1000+100*100],['prompt absent (fully cached prompt)',(u)=>{const {prompt_eval_count,prompt_eval_cached_count,prompt_eval_duration_ns,...rest}=u;return rest;},50*1000]]) {
   const task=await enqueue(); assert.equal((await reserve(key('reserve'),'owner-1',task,MAX)).ok,true);
   const result={model:'qwen3:8b',content:label,usage:strip(usage())};
   const lease=await runTask(NODE_A,task,result);
   const u=result.usage;
   const met={prompt_eval_count:u.prompt_eval_count??null,prompt_eval_cached_count:u.prompt_eval_cached_count??null,eval_count:u.eval_count??null,total_duration_ns:u.total_duration_ns??null,load_duration_ns:u.load_duration_ns??null,prompt_eval_duration_ns:u.prompt_eval_duration_ns??null,eval_duration_ns:u.eval_duration_ns??null,model:result.model,model_digest:u.model_digest,runtime_version:u.ollama_version,node_id:NODE_A,attempt:1};
   const s=await settle(key('settle'),task,lease.tokenHash,1,met,hashJson(result));
   assert.equal(s.accepted,true,`${label}: ${JSON.stringify(s)}`); assert.equal(Number(s.units_micro),expectUnits,label); assert.equal(Number(s.spend_micro),expectUnits,label);
  }
  ok('an Ollama result with prompt_eval_cached_count null or counters absent settles: unreported counters are 0');
 }

 // 12c. The task's own caps bound the counters, and the charge never exceeds the reservation.
 {
  const SMALL=64*1000+32768*100; // num_predict 64
  const capCases=[
   [{prompt:'hi',num_predict:64},SMALL,{eval_count:4096,eval_duration_ns:40_000_000_000},'COUNTERS_OUT_OF_WINDOW'], // inside the class max, 64x the task's cap
   [{prompt:'hi',num_predict:64},SMALL,{eval_count:65,eval_duration_ns:1_000_000_000},'COUNTERS_OUT_OF_WINDOW'],
   [{prompt:'hi',num_ctx:4096},4096*1000+4096*100,{prompt_eval_count:5000,prompt_eval_cached_count:0},'COUNTERS_OUT_OF_WINDOW'],
   [{prompt:'hi'},1000,{},'UNITS_EXCEED_RESERVATION'] // inside every cap, above what was reserved
  ];
  for(const [input,max,over,code] of capCases) {
   const task=await enqueue({input}); assert.equal((await reserve(key('reserve'),'owner-1',task,max)).ok,true);
   const before=await balances('owner-1');
   const result={model:'qwen3:8b',content:'cap',usage:usage(over)};
   const lease=await runTask(NODE_A,task,result);
   const s=await settle(key('settle'),task,lease.tokenHash,1,metering(result,{nodeId:NODE_A,attempt:1}),hashJson(result));
   assert.equal(s.ok,true,JSON.stringify(s)); assert.equal(s.reason,code,JSON.stringify({input,over,s})); assert.equal(s.accepted,false); assert.equal(s.charged,false);
   assert.equal(Number(s.spend_micro),0); assert.equal(Number(s.minted_micro),0); assert.equal(Number(s.released_micro),max);
   const after=await balances('owner-1');
   assert.equal(BigInt(after.spent),BigInt(before.spent),`${code}: the submitter is not charged`); assert.equal(BigInt(after.available),BigInt(before.available)+BigInt(max),'the whole reservation comes back');
  }
  // Inside the task's caps: accepted, and the spend is within the reservation.
  const task=await enqueue({input:{prompt:'hi',num_predict:64}}); assert.equal((await reserve(key('reserve'),'owner-1',task,SMALL)).ok,true);
  const result={model:'qwen3:8b',content:'ok',usage:usage({eval_count:64,eval_duration_ns:1_000_000_000})};
  const lease=await runTask(NODE_A,task,result);
  const s=await settle(key('settle'),task,lease.tokenHash,1,metering(result,{nodeId:NODE_A,attempt:1}),hashJson(result));
  assert.equal(s.accepted,true,JSON.stringify(s)); assert.equal(Number(s.spend_micro),64*1000+80*100); assert.ok(Number(s.spend_micro)<=SMALL); assert.equal(Number(s.released_micro),SMALL-Number(s.spend_micro));
  // The adapter's floors: num_predict 8 runs as 16, so 16 tokens are inside the cap.
  const tiny=await enqueue({input:{prompt:'hi',num_predict:8}}); assert.equal((await reserve(key('reserve'),'owner-1',tiny,16*1000+32768*100)).ok,true);
  const rt={model:'qwen3:8b',content:'tiny',usage:usage({eval_count:16,eval_duration_ns:1_000_000_000})};
  const lt=await runTask(NODE_A,tiny,rt);
  assert.equal((await settle(key('settle'),tiny,lt.tokenHash,1,metering(rt,{nodeId:NODE_A,attempt:1}),hashJson(rt))).accepted,true);
  assert.equal((await one("select count(*)::int as n from public.ops_compute_contribution_ledger l join public.ops_compute_spend_reservations r on r.task_id=l.task_id where l.kind='settle' and l.spend_micro>r.max_units_micro")).n,0,'no settle anywhere spends above its reservation');
  ok('task caps: counters above num_predict or num_ctx are COUNTERS_OUT_OF_WINDOW, units above the reservation UNITS_EXCEED_RESERVATION; neither charges; spend never exceeds the reservation');
 }

 // 12d. The output hash is the Core's alone: numbers JSON.stringify and jsonb print differently (1e21, 1e-7) still settle.
 {
  const task=await enqueue(); assert.equal((await reserve(key('reserve'),'owner-1',task,MAX)).ok,true);
  const result={model:'qwen3:8b',content:'numbers',data:{big:1e21,small:1e-7,frac:0.1,int:3000000000,neg:-2.5e-9,list:[1e300,5e-324,123456789012345680000]},usage:usage()};
  const lease=await runTask(NODE_A,task,result);
  const stored=await one('select output, output::text as txt from public.ops_compute_tasks where id=$1::uuid',[task]);
  assert.ok(stored.txt.includes('1000000000000000000000')&&stored.txt.includes('0.0000001'),'jsonb text renders 1e21 and 1e-7 in plain decimal');
  assert.ok(JSON.stringify(result).includes('1e+21')&&JSON.stringify(result).includes('1e-7'),'JSON.stringify renders them in exponent form');
  assert.equal(hashJson(stored.output),hashJson(result),'the hash over the stored output read back equals the hash over what the node sent');
  const s=await settle(key('settle'),task,lease.tokenHash,1,metering(result,{nodeId:NODE_A,attempt:1}),hashJson(stored.output));
  assert.equal(s.accepted,true,JSON.stringify(s)); assert.equal(s.reason,'accepted');
  ok('output hash computed in one place (hashJson over the stored output): 1e21 and 1e-7 settle, no SQL re-derivation to disagree');
 }

 // 13. Integer accounting: ten one-micro-unit mints at 3:1 -> 3 spendable, carry 1; display points cross once.
 {
  for(let i=0;i<10;i++) {
   const task=await enqueue({implementation:'micro.local'}); assert.equal((await reserve(key('reserve'),'owner-1',task,4096)).ok,true);
   const result={model:'micro:1b',content:String(i),usage:usage({eval_count:1,prompt_eval_count:0,prompt_eval_cached_count:0,eval_duration_ns:100_000_000,model_digest:'sha256:micro'})};
   const lease=await runTask(NODE_C,task,result);
   const s=await settle(key('settle'),task,lease.tokenHash,1,metering(result,{nodeId:NODE_C,attempt:1}),hashJson(result));
   assert.equal(s.accepted,true,JSON.stringify(s)); assert.equal(Number(s.units_micro),1);
  }
  const c=await balances('worker-c'); assert.equal(Number(c.earned),3); assert.equal(Number(c.carry_micro),1); assert.equal(Number(c.available),3);
  const mints=await q("select units_micro::text as u from public.ops_compute_contribution_ledger where account_id='worker-c' and kind='mint' order by entry_id");
  assert.deepEqual(mints.map(m=>Number(m.u)),[0,0,1,0,0,1,0,0,1,0]);
  // display points: 60,000 units twice (points.local: 1,000 units per token, eval_count 60)
  for(let i=0;i<2;i++) {
   const task=await enqueue({implementation:'points.local'}); assert.equal((await reserve(key('reserve'),'owner-1',task,60*1000000000)).ok,true);
   const result={model:'points:1b',content:'p'+i,usage:usage({eval_count:60,prompt_eval_count:0,prompt_eval_cached_count:0,eval_duration_ns:1_000_000_000,model_digest:'sha256:points'})};
   const lease=await runTask(NODE_D,task,result);
   const s=await settle(key('settle'),task,lease.tokenHash,1,metering(result,{nodeId:NODE_D,attempt:1}),hashJson(result));
   assert.equal(s.accepted,true,JSON.stringify(s)); assert.equal(Number(s.display_points_delta),i);
  }
  const p=await one("select points::text as p, accepted_units_remainder::text as r from public.ops_compute_display_points where account_id='worker-points'");
  assert.equal(Number(p.p),1); assert.equal(Number(p.r),20000*1000000);
  assert.equal(Number((await balances('worker-points')).display_points),1);
  assert.equal((await one("select count(*)::int as n from public.ops_compute_display_points where account_id='worker-c'")).n,0,'no opt-in, no points row');
  ok('integer accounting: ten 1-micro mints at 3:1 give 3 spendable and carry 1; display points cross the 100,000-unit boundary once');
 }

 // 14. Quotas.
 {
  await q("insert into public.ops_compute_account_quotas(account_id,max_open_reservations,max_queued_tasks,daily_mint_cap_micro) values ('quota-acct',1,1,null)");
  const t1=await enqueue(), t2=await enqueue();
  assert.equal((await reserve(key('reserve'),'quota-acct',t1,MAX)).ok,true);
  const r2=await reserve(key('reserve'),'quota-acct',t2,MAX); assert.equal(r2.code,'QUOTA_RESERVATIONS');
  await q("update public.ops_compute_account_quotas set max_open_reservations=5 where account_id='quota-acct'");
  const r3=await reserve(key('reserve'),'quota-acct',t2,MAX); assert.equal(r3.code,'QUOTA_QUEUE');
  await cancelTask(t1); await cancelTask(t2); assert.equal((await release(key('release'),t1,'canceled')).ok,true);
  await q("insert into public.ops_compute_account_quotas(account_id,daily_mint_cap_micro) values ('worker-a',1)");
  const task=await enqueue(); assert.equal((await reserve(key('reserve'),'owner-1',task,MAX)).ok,true);
  const result={model:'qwen3:8b',content:'cap',usage:usage()};
  const lease=await runTask(NODE_A,task,result);
  const s=await settle(key('settle'),task,lease.tokenHash,1,metering(result,{nodeId:NODE_A,attempt:1}),hashJson(result));
  assert.equal(s.accepted,false); assert.equal(s.reason,'QUOTA_DAILY_MINT');
  await q("delete from public.ops_compute_account_quotas where account_id='worker-a'");
  ok('quotas: QUOTA_RESERVATIONS, QUOTA_QUEUE, QUOTA_DAILY_MINT');
 }

 // worker-c earned three units and carries one from the integer-accounting case.
 {
  await q("insert into public.ops_compute_account_quotas(account_id,daily_mint_cap_micro) values ('worker-c',3)");
  const before=await balances('worker-c');
  const attempt=await microAttempt(NODE_C,2);
  const refused=await attempt.settle();
  assert.equal(refused.reason,'QUOTA_DAILY_MINT');
  assert.equal(refused.minted_micro,0);
  assert.equal(refused.carry_micro,1);
  assert.equal(refused.charged,true);
  assert.deepEqual(await balances('worker-c'),before);
  assert.deepEqual((await ledgerRows(attempt.task)).map(row=>row.kind),['reserve','settle','release']);
  await q("update public.ops_compute_account_quotas set daily_mint_cap_micro=4 where account_id='worker-c'");
  assert.deepEqual(await attempt.settle(),{...refused,replayed:true});
  const next=await microAttempt(NODE_C,2);
  const accepted=await next.settle();
  assert.equal(accepted.accepted,true);
  assert.equal(accepted.minted_micro,1);
  assert.equal(accepted.carry_micro,0);
  assert.equal((await balances('worker-c')).earned,4);
  ok('rolling cap includes carry, accepts its exact boundary, preserves refused carry and replays the original decision');
 }

 {
  const maxEntry=9223372036854775807n;
  await q("insert into public.ops_compute_accounts(account_id,org_id,kind,display_points_opt_in) values ('range-owner',$1,'owner',false),('range-worker',$1,'community',true)",[ORG]);
  await q("update public.ops_compute_node_accounts set account_id='range-worker' where node_id=$1",[NODE_C]);
  for(let i=0;i<2;i++) assert.equal((await correct(key('grant'),null,'range-owner',-maxEntry,0,'range fixture grant')).ok,true);
  assert.equal((await one("select public.compute_ledger_balances('range-owner')->>'available' as amount")).amount,String(2n*maxEntry));

  const seedCarry=await microAttempt(NODE_C,2);
  assert.equal((await seedCarry.settle()).carry_micro,2);
  await q("update public.ops_compute_model_classes set out_unit_micro=$1::bigint, redemption_ratio=1 where model_class='pilot.micro'",[String(maxEntry)]);
  const wideClaim=await microAttempt(NODE_C,2);
  const over=await wideClaim.settle();
  assert.equal(over.reason,'UNITS_EXCEED_RESERVATION');
  assert.equal(over.claimed_units_micro_decimal,String(2n*maxEntry));
  assert.equal(over.charged,false);
  assert.equal(over.released_micro,4096);
  assert.deepEqual(await wideClaim.settle(),{...over,replayed:true});
  const wideMint=await microAttempt(NODE_C,1,{accountId:'range-owner',max:maxEntry});
  const rejected=await wideMint.settle();
  assert.equal(rejected.reason,'ACCOUNTING_OUT_OF_RANGE');
  assert.equal(rejected.charged,false);
  assert.equal(rejected.carry_micro,2);
  assert.deepEqual((await ledgerRows(wideMint.task)).map(r=>r.kind),['reserve','settle','release']);

  await q("update public.ops_compute_model_classes set redemption_ratio=3 where model_class='pilot.micro'");
  const exact=await microAttempt(NODE_C,1,{accountId:'range-owner',max:maxEntry});
  assert.equal((await exact.settle()).accepted,true);
  const rows=await ledgerRows(exact.task);
  assert.equal(rows.find(r=>r.kind==='settle').spend_micro,String(maxEntry));
  assert.equal(rows.find(r=>r.kind==='mint').units_micro,String((maxEntry+2n)/3n));
  const points=await one("select points::text as n, accepted_units_remainder::text as rem from public.ops_compute_display_points where account_id='range-worker'");
  assert.equal(points.n,String((maxEntry+2n)/100000000000n));
  assert.equal(points.rem,String((maxEntry+2n)%100000000000n));
  ok('wide weights and carry: exact BIGINT charge, wide point remainder, larger claim and unrepresentable mint both close safely');

  await q("update public.ops_compute_display_points set points=$1::bigint where account_id='range-worker'",[String(maxEntry)]);
  await q("update public.ops_compute_model_classes set out_unit_micro=100000000000 where model_class='pilot.micro'");
  const widePoints=await microAttempt(NODE_C,1,{max:100000000000});
  const pointRefusal=await widePoints.settle();
  assert.equal(pointRefusal.reason,'ACCOUNTING_OUT_OF_RANGE');
  assert.equal(pointRefusal.display_points_delta,0);
  assert.equal(pointRefusal.charged,false);
  assert.equal((await one("select points::text as n from public.ops_compute_display_points where account_id='range-worker'")).n,String(maxEntry));

  await q("update public.ops_compute_model_classes set out_unit_micro=1,min_tokens_per_s=0,max_tokens_per_s=2147483647 where model_class='pilot.micro'");
  const timing=await microAttempt(NODE_C,1,{usageOverrides:{eval_duration_ns:80_000_000_000_000,total_duration_ns:80_000_000_000_000}});
  assert.equal((await timing.settle()).accepted,true);
  const counters=await microAttempt(NODE_C,Number.MAX_SAFE_INTEGER);
  const refused=await counters.settle();
  assert.equal(refused.reason,'COUNTERS_OUT_OF_WINDOW');
  assert.equal(refused.charged,false);
  assert.equal(refused.released_micro,4096);
  await q("update public.ops_compute_model_classes set min_tokens_per_s=1,max_tokens_per_s=100000 where model_class='pilot.micro'");
  await q("update public.ops_compute_node_accounts set account_id='worker-c' where node_id=$1",[NODE_C]);
  ok('large duration products stay exact, oversized counters close without charging and display points never wrap');
 }
 if(db.native) {
  // The owner assigns two different nodes to one worker. Hold the first
  // successful RPC uncommitted until PostgreSQL observes the second one waiting.
  await q("update public.ops_compute_node_accounts set account_id='worker-b' where node_id in ($1,$2)",[NODE_C,NODE_D]);
  await q("insert into public.ops_compute_account_quotas(account_id,daily_mint_cap_micro) values ('worker-b',1)");
  const first=await microAttempt(NODE_C,3), second=await microAttempt(NODE_D,3);
  const writer=db.fork(), contender=db.fork();
  let pending;
  try {
   await writer.exec('begin');
   await writer.exec('set local role service_role');
   await contender.exec('set role service_role');
   const accepted=await first.settle(writer);
   assert.equal(accepted.minted_micro,1);
   pending=second.settle(contender);
   pending.catch(()=>{});
   await waitForBlocked(db);
   await writer.exec('commit');
   const refused=await pending;
   assert.equal(refused.reason,'QUOTA_DAILY_MINT');
   assert.equal(refused.minted_micro,0);
   assert.deepEqual(await first.settle(),{...accepted,replayed:true});
   assert.deepEqual(await second.settle(),{...refused,replayed:true});
   assert.equal((await balances('worker-b')).earned,1);
   const entries=await q("select units_micro::text as units from public.ops_compute_contribution_ledger where account_id='worker-b' and kind='mint'");
   assert.deepEqual(entries.map(row=>row.units),['1']);
  } finally {
   await writer.exec('rollback');
   await Promise.allSettled([pending]);
   await Promise.all([writer.close(),contender.close()]);
  }
  ok('native concurrent settlements for two devices on one worker wait and mint exactly once at the cap');
 }
 // 15. Append-only trigger.
 {
  for(const stmt of ["update public.ops_compute_contribution_ledger set units_micro=0 where entry_id=(select min(entry_id) from public.ops_compute_contribution_ledger)","delete from public.ops_compute_contribution_ledger where entry_id=(select min(entry_id) from public.ops_compute_contribution_ledger)","truncate public.ops_compute_contribution_ledger"]) {
   await assert.rejects(()=>db.exec(stmt),(e)=>/append-only/.test(String(e.message)));
  }
  ok('append-only triggers refuse UPDATE, DELETE and TRUNCATE');
 }

 // 16. Correction: appended, replayed, never edits; balances arithmetic over the sums.
 {
  const settleEntry=await one("select entry_id, account_id, spend_micro::text as s from public.ops_compute_contribution_ledger where kind='settle' order by entry_id limit 1");
  const k=key('correct');
  const c=await correct(k,Number(settleEntry.entry_id),settleEntry.account_id,-1000,0,'operator refund of a mispriced attempt');
  assert.equal(c.ok,true); assert.equal(Number(c.correction_of),Number(settleEntry.entry_id));
  assert.deepEqual({...(await correct(k,Number(settleEntry.entry_id),settleEntry.account_id,-1000,0,'operator refund of a mispriced attempt')),replayed:false},c);
  assert.equal((await correct(k,Number(settleEntry.entry_id),settleEntry.account_id,-2000,0,'operator refund of a mispriced attempt')).code,'CONFLICT');
  assert.equal((await correct(key('correct'),999999,settleEntry.account_id,-1,0,'x')).code,'ENTRY_NOT_FOUND');
  assert.equal((await one("select spend_micro::text as s from public.ops_compute_contribution_ledger where entry_id=$1::bigint",[settleEntry.entry_id])).s,settleEntry.s,'the original entry is untouched');
  for(const acct of ACCOUNT_IDS) {
   const b=await balances(acct);
   const sums=await one(`select
     (select coalesce(sum(max_units_micro),0) from public.ops_compute_spend_reservations where account_id=$1 and status='open')::text as pending,
     (select coalesce(sum(units_micro),0) from public.ops_compute_contribution_ledger where account_id=$1 and kind='mint')::text as earned,
     (select coalesce(sum(spend_micro),0) from public.ops_compute_contribution_ledger where account_id=$1 and kind in ('settle','correction'))::text as spent`,[acct]);
   assert.equal(String(b.pending),sums.pending,acct); assert.equal(String(b.earned),sums.earned,acct); assert.equal(String(b.spent),sums.spent,acct);
   assert.equal(BigInt(b.available),BigInt(sums.earned)-BigInt(sums.spent)-BigInt(sums.pending),acct);
  }
  assert.equal(await balances('nobody'),null);
  ok('corrections append and replay; balances are the sums (pending, earned, spent, available)');
 }

 if(db.native) {
  // The daemon only supplies the inference response. The real HTTP adapter,
  // pre-commit Core validator, metering reader and native SQL all see its bytes.
  let runtimeDigest=DIGEST, promptCount=12000;
  const observed=[];
  const daemon=http.createServer(async(req,res)=>{
   res.setHeader('content-type','application/json');
   if(req.url==='/api/tags') return res.end(JSON.stringify({models:[{name:'qwen3:8b',digest:DIGEST}]}));
   if(req.url==='/api/ps') return res.end(JSON.stringify({models:[{name:'qwen3:8b',digest:runtimeDigest}]}));
   if(req.url==='/api/version') return res.end(JSON.stringify({version:'0.6.0-fixture'}));
   if(req.url!=='/api/chat'){res.statusCode=404;return res.end('{}');}
   let raw='';for await(const part of req)raw+=part;
   const request=JSON.parse(raw);observed.push(request.options.num_ctx);
   res.end(JSON.stringify({model:request.model,message:{role:'assistant',content:''},done_reason:'stop',
    prompt_eval_count:promptCount,eval_count:0,eval_duration:0,total_duration:4e9,prompt_eval_duration:1e9}));
  });
  daemon.listen(0,'127.0.0.1');await once(daemon,'listening');
  const adapter=spawn(process.execPath,[path.join(root,'core/src/compute/ollama-adapter.mjs')],{env:{
   PATH:process.env.PATH,MCCLUSTER_OLLAMA_ADAPTER_HOST:'127.0.0.1',MCCLUSTER_OLLAMA_ADAPTER_PORT:'0',
   MCCLUSTER_OLLAMA_CONTEXT:'16384',MCCLUSTER_OLLAMA_URL:`http://127.0.0.1:${daemon.address().port}`},stdio:['ignore','pipe','ignore']});
  const stopped=once(adapter,'exit');
  const output=createInterface({input:adapter.stdout});
  try {
   const [line]=await once(output,'line',{signal:AbortSignal.timeout(10000)});
   const ready=JSON.parse(line);assert.equal(ready.event,'ollama_adapter_ready');
   const input={prompt:'runtime proof',num_ctx:4096,num_predict:64};
   const execute=async()=>{
    const res=await fetch(`http://127.0.0.1:${ready.port}/execute`,{method:'POST',headers:{'content-type':'application/json'},
     body:JSON.stringify({capability:'ai.chat',implementation:'qwen3.8b.local',input}),signal:AbortSignal.timeout(10000)});
    assert.equal(res.status,200);return res.json();
   };
   const classes=await q('select * from public.ops_compute_model_classes');
   const price=estimateMaxUnitsMicro({input,modelClass:classes.find(c=>c.model_class==='pilot.qwen3-8b')});
   for(const expected of ['accepted','DIGEST_NOT_APPROVED','COUNTERS_OUT_OF_WINDOW']){
    runtimeDigest=expected==='DIGEST_NOT_APPROVED'?'sha256:changed':DIGEST;
    promptCount=expected==='COUNTERS_OUT_OF_WINDOW'?17000:12000;
    const result=await execute();
    assert.equal(result.settings.num_ctx,16384);assert.equal(result.usage.eval_count,0);
    const task=await enqueue({input});assert.equal((await reserve(key('reserve'),'owner-1',task,price)).ok,true);
    const lease=await claim(NODE_A,task);
    const getTask=()=>one('select * from public.ops_compute_tasks where id=$1',[task]);
    const getLease=()=>one('select * from public.ops_compute_leases where id=$1',[lease.leaseId]);
    const deps={ledgerEnabled:()=>true,leaseById:getLease,taskRowById:getTask,log:()=>{},
     reservationForTask:()=>one('select * from public.ops_compute_spend_reservations where task_id=$1',[task]),modelClasses:async()=>classes};
    const validation=validateCompletion({leaseId:lease.leaseId,result},deps);
    if(expected==='COUNTERS_OUT_OF_WINDOW') await assert.rejects(()=>validation,e=>e.code==='RESULT_USAGE_OUT_OF_BOUNDS');
    else assert.equal((await validation).checked,true);
    // SQL independently rechecks a stored completion even if Core validation
    // was unavailable. This also covers receipt processing after an upgrade.
    await one('select public.compute_start_lease($1,$2,$3)',[NODE_A,lease.leaseId,lease.token]);
    assert.equal((await one('select public.compute_complete_lease($1,$2,$3,$4::text::jsonb) as yes',[NODE_A,lease.leaseId,lease.token,JSON.stringify(result)])).yes,true);
    const stored=await getTask(), met=meteringBlock({task:stored,lease:await getLease()});
    const settled=await settle(key('settle'),task,lease.tokenHash,lease.attempt,met,hashJson(stored.output));
    assert.equal(settled.reason,expected);
    assert.equal(settled.spend_micro,expected==='accepted'?1200000:0);
    if(expected==='accepted') assert.equal(met.model_digest_source,'ollama-tags-and-ps');
    if(expected==='DIGEST_NOT_APPROVED') assert.equal(met.model_digest,null);
   }
   assert.deepEqual(observed,[16384,16384,16384]);
  } finally {
   output.close();adapter.kill();await stopped;
   daemon.closeAllConnections();await new Promise(resolve=>daemon.close(resolve));
  }
  ok('HTTP adapter to native settlement: executed resident context, zero-token completion, loaded-model change and actual context ceiling');
 }
 if(db.native) {
  const task=await enqueue(), operation=key('fenced-settle');
  assert.equal((await reserve(key('reserve'),'owner-1',task,MAX)).ok,true);
  const result={model:'qwen3:8b',content:'handover',usage:usage()};
  const lease=await runTask(NODE_A,task,result), met=metering(result,{nodeId:NODE_A,attempt:lease.attempt});
  const blocker=db.fork(), candidate=db.fork();
  let waiting;
  try {
   await blocker.exec('begin');
   await blocker.query("select account_id from public.ops_compute_accounts where account_id='worker-a' for no key update");
   waiting=settle(operation,task,lease.tokenHash,lease.attempt,met,hashJson(result),HOLDER,1,candidate);
   waiting.catch(()=>{});
   await waitForBlocked(db);
   await one('select public.compute_scheduler_release($1,$2,$3) as r',[ORG,HOLDER,1]);
   const takeover=(await one("select public.compute_scheduler_acquire($1,'next-holder','primary',300) as r",[ORG])).r;
   assert.equal(takeover.active,true);assert.equal(takeover.term,2);
   await blocker.exec('commit');
   assert.equal((await waiting).code,'STALE_TERM');
   assert.deepEqual((await ledgerRows(task)).map(row=>row.kind),['reserve']);
   assert.equal((await settle(operation,task,lease.tokenHash,lease.attempt,met,hashJson(result),'next-holder',2)).accepted,true);
  } finally {
   await blocker.exec('rollback');await Promise.allSettled([waiting]);
   await Promise.all([blocker.close(),candidate.close()]);
  }
  ok('native scheduler takeover during a worker-row wait refuses old settle and permits the new holder to retry');

  const expiring=await enqueue(), releaseKey=key('fenced-release');
  assert.equal((await reserve(key('reserve'),'owner-1',expiring,MAX)).ok,true);
  await cancelTask(expiring);
  await q("update public.ops_compute_scheduler_leases set expires_at=clock_timestamp()+interval '1 second' where org_id=$1",[ORG]);
  const writer=db.fork();
  try {
   await writer.exec('begin');
   const {rows}=await writer.query("select public.compute_ledger_release($1,$2,'expired at commit','next-holder',2) as r",[releaseKey,expiring]);
   assert.equal(rows[0].r.released,true);
   await writer.query('select pg_sleep(greatest(0,extract(epoch from expires_at-clock_timestamp()))::float8+0.02) from public.ops_compute_scheduler_leases where org_id=$1',[ORG]);
   await assert.rejects(()=>writer.exec('commit'),e=>e.code==='40001' && /scheduler term/.test(e.message));
  } finally { await writer.exec('rollback');await writer.close(); }
  assert.deepEqual((await ledgerRows(expiring)).map(row=>row.kind),['reserve']);
  assert.equal((await one('select status from public.ops_compute_spend_reservations where task_id=$1',[expiring])).status,'open');
  const active=(await one("select public.compute_scheduler_acquire($1,'next-holder','primary',300) as r",[ORG])).r;
  assert.equal(active.term,3);assert.equal((await release(releaseKey,expiring,'expired at commit','next-holder',3)).released,true);
  ok('native expiry between successful release and COMMIT rolls back all accounting and permits reacquisition');

  const singleOrg='00000000-0000-4000-8000-0000000000ab';
  await q('insert into public.orgs(id) values($1)',[singleOrg]);
  await q("insert into public.ops_compute_accounts(account_id,org_id,kind) values ('single-org',$1,'owner')",[singleOrg]);
  assert.equal((await correct(key('grant'),null,'single-org',-1000,0,'single scheduler fixture')).ok,true);
  const single=(await one("select public.compute_enqueue_task($1,'ai.chat','qwen3.8b.local','{}','{}',0,null,1,'{}',null) as r",[singleOrg])).r.task.id;
  assert.equal((await reserve(key('reserve'),'single-org',single,100)).ok,true);
  await cancelTask(single);
  const first=db.fork(), election=db.fork();
  let acquiring;
  try {
   await first.exec('begin');
   const {rows}=await first.query("select public.compute_ledger_release($1,$2,'single','single-holder',null) as r",[key('release'),single]);
   assert.equal(rows[0].r.released,true);
   acquiring=election.query("select public.compute_scheduler_acquire($1,'elected','primary',300) as r",[singleOrg]);
   acquiring.catch(()=>{});
   await waitForBlocked(db); await first.exec('commit');
   const won=(await acquiring).rows[0].r;
   assert.equal(won.active,true);assert.equal(won.term,1);
   assert.equal((await release(key('release'),single,'single','single-holder',null)).code,'STALE_TERM');
  } finally {
   await first.exec('rollback');await Promise.allSettled([acquiring]);
   await Promise.all([first.close(),election.close()]);
  }
  ok('native first scheduler acquisition waits for the single-scheduler transaction to commit');
 }
 // After first use the recovery must preserve accounting, configuration and receipts.
 {
  const counts=()=>Promise.all(tables.map(async t=>(await one(`select count(*)::int as n from public.${t}`)).n));
  const before=await counts();
  const balance=await balances('worker-c');
  const {task_id:task}=await one("select task_id from public.ops_compute_contribution_ledger where kind='mint' order by entry_id limit 1");
  const original=await receipt(task);
  await assert.rejects(rollback,/ledger rollback refused.*contains data/);
  assert.deepEqual(await counts(),before);
  assert.deepEqual(await balances('worker-c'),balance);
  assert.deepEqual(await receipt(task),original);
  ok('populated rollback preserves all thirteen tables, balances and a settled receipt');
 }
 console.log(`compute contribution ledger SQL check: ${passed} cases PASS`);
} finally {await db.close();}
