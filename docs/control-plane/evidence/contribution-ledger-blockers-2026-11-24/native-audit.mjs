import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// Equity Uprise platform support: audit only, no product activation.
// Run from a checkout of the pinned #831 head; local native PostgreSQL only.
const root=path.resolve(process.argv[2] || process.cwd());
process.chdir(root);
const { nativeTestDb, migrationPath, waitForBlocked }=await import(pathToFileURL(`${root}/scripts/native-admin-test-db.mjs`));
const { hashJson }=await import(pathToFileURL(`${root}/core/src/compute/jobs.mjs`));
const candidatePins={
 'supabase/pending/compute_contribution_ledger_v1.sql':'57e79053f37ed0cf91b1bb6623ab316f5b5956587474cd446d3fc7f8d9a08b18',
 'supabase/pending/compute_contribution_ledger_v1.rollback.sql':'0f167349c1fbd0f593fedaf53ad323afa0e3c89542ad92c8c9f048cf5a5cd1c6'
};
for(const [file,expected] of Object.entries(candidatePins))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(`${root}/${file}`)).digest('hex'),expected,`audit requires pinned candidate: ${file}`);
// Disposable native PostgreSQL; never connects to canonical Supabase.
// Loads the pinned compute/scheduler/attestation/ledger candidates and uses
// synthetic implementation labels to reproduce the four documented blockers.
// It does not execute a model or claim the complete pilot acceptance suite.
if(!process.env.NATIVE_TEST_DATABASE_URL)throw Error('This audit requires disposable native PostgreSQL');
let db;
if(process.env.NATIVE_TEST_DATABASE_URL) db=await nativeTestDb('ledger_audit');
else {
 const modulePath=process.env.PGLITE_MODULE_PATH;
 if(!modulePath||!path.isAbsolute(modulePath)) throw Error('Set PGLITE_MODULE_PATH to pinned PGlite');
 const {PGlite}=await import(pathToFileURL(modulePath));
 const {pgcrypto}=await import(pathToFileURL(path.join(path.dirname(modulePath),'contrib/pgcrypto.js')));
 db=new PGlite({extensions:{pgcrypto}});
}
const read=(file)=>fs.readFileSync(`${root}/${file}`,'utf8');
const sha256=(text)=>crypto.createHash('sha256').update(text,'utf8').digest('hex');
const J=value=>db.native?db.sql.json(value):JSON.stringify(value);
const q=async(sql,params=[])=>(await db.query(sql,params)).rows;
const one=async(sql,params=[])=>(await q(sql,params))[0];
let passed=0;
const ok=(label)=>{passed+=1;console.log(`${label}: REPRODUCED`);};

const ORG='00000000-0000-4000-8000-000000000001';
const NODE_A='node_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', NODE_B='node_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', NODE_C='node_cccccccccccccccccccccccccccccccc', NODE_D='node_dddddddddddddddddddddddddddddddd';
const HOLDER='core-primary';
const CAPS=J([{capability:'ai.chat',implementation:'fixture.standard.local',max_concurrency:1},{capability:'ai.chat',implementation:'micro.local',max_concurrency:1},{capability:'ai.chat',implementation:'points.local',max_concurrency:1}]);
const IMPLS="array['fixture.standard.local','micro.local','points.local']";
const DIGEST='sha256:0123456789abcdef';
let keySeq=0; const key=(prefix)=>`${prefix}:${++keySeq}`;

function usage(over={}) {
 return { prompt_eval_count:100, prompt_eval_cached_count:20, eval_count:50, total_duration_ns:3_000_000_000, load_duration_ns:1_000_000_000, prompt_eval_duration_ns:500_000_000, eval_duration_ns:1_000_000_000, model_digest:DIGEST, ollama_version:'0.6.0', ...over };
}
function metering(result, {nodeId, attempt, over={}}) {
 const u=result.usage;
 return { prompt_eval_count:u.prompt_eval_count, prompt_eval_cached_count:u.prompt_eval_cached_count, eval_count:u.eval_count, total_duration_ns:u.total_duration_ns, load_duration_ns:u.load_duration_ns, prompt_eval_duration_ns:u.prompt_eval_duration_ns, eval_duration_ns:u.eval_duration_ns, model:result.model, model_digest:u.model_digest, runtime_version:u.ollama_version, node_id:nodeId, attempt, ...over };
}
async function enqueue({implementation='fixture.standard.local', input={prompt:'hi'}, maxAttempts=3, idempotencyKey=null}={}) {
 const r=(await one("select public.compute_enqueue_task($1::uuid,'ai.chat',$2::text,$3::jsonb,'{}'::jsonb,0,null::timestamptz,$4::integer,'{}'::jsonb,$5::text) as r",[ORG,implementation,J(input),maxAttempts,idempotencyKey])).r;
 assert.equal(r.conflict,false); return r.task.id;
}
async function reserve(opKey, accountId, taskId, max, deadline=null, modelClass=null, unitVersion=null) {
 return (await one('select public.compute_ledger_reserve($1,$2,$3::uuid,$4::bigint,$5::integer,$6::text,$7::integer) as r',[opKey,accountId,taskId,String(max),deadline,modelClass,unitVersion])).r;
}
async function settle(opKey, taskId, tokenHash, attempt, met, outputSha, holder=HOLDER, term=1) {
 return (await one('select public.compute_ledger_settle($1,$2::uuid,$3,$4::integer,$5::jsonb,$6,$7::text,$8::bigint) as r',[opKey,taskId,tokenHash,attempt,J(met),outputSha,holder,term])).r;
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
 assert.equal((await one('select public.compute_complete_lease($1,$2::uuid,$3,$4::jsonb) as r',[nodeId,lease.leaseId,lease.token,J(result)])).r,true,'complete');
 return lease;
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
  ('pilot.fixture-standard',1,$1::jsonb,'["fixture.standard.local"]'::jsonb,1000,100,3,1,200,4096,32768),
  ('pilot.micro',1,'[{"model":"micro:1b","digest":"sha256:micro"}]'::jsonb,'["micro.local"]'::jsonb,1,0,3,1,100000,4096,32768),
  ('pilot.points',1,'[{"model":"points:1b","digest":"sha256:points"}]'::jsonb,'["points.local"]'::jsonb,1000000000,0,3,1,100000,4096,32768) on conflict do nothing`,[J([{model:'fixture:standard',digest:DIGEST}])]);
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
 await applyLedger();console.log('loaded supabase/pending/compute_contribution_ledger_v1.sql');
 await applyLedger();ok('the forward file applies twice');


 await q('insert into public.orgs(id) values($1) on conflict do nothing',[ORG]);
 for(const id of [NODE_A,NODE_B,NODE_C,NODE_D]) await q(`insert into public.ops_compute_nodes(id,org_id,display_name,public_key_pem,key_fingerprint,protocol_version,agent_version,capabilities) values($1,$2,$1,'fixture',$1,'mccluster-compute/1','test',$3::jsonb)`,[id,ORG,CAPS]);
 await seed();
 const prepare=async(node,evalCount)=>{
  const task=await enqueue({implementation:'micro.local'});
  assert.equal((await reserve(key('reserve'),'owner-1',task,4096)).ok,true);
  const result={model:'micro:1b',content:'synthetic audit output',usage:usage({prompt_eval_count:0,prompt_eval_cached_count:0,eval_count:evalCount,model_digest:'sha256:micro'})};
  const lease=await runTask(node,task,result);
  return {task,lease,result,met:metering(result,{nodeId:node,attempt:lease.attempt})};
 };
 const finish=async(t)=>settle(key('settle'),t.task,t.lease.tokenHash,t.lease.attempt,t.met,hashJson(t.result));
 const first=await finish(await prepare(NODE_A,2));
 assert.equal(first.accepted,true);assert.equal(Number(first.minted_micro),0);assert.equal(Number(first.carry_micro),2);
 await q("insert into public.ops_compute_account_quotas(account_id,daily_mint_cap_micro) values('worker-a',0)");
 const second=await finish(await prepare(NODE_A,1));
 assert.equal(second.accepted,true);assert.equal(Number(second.minted_micro),1);
 const capped=(await one("select sum(units_micro)::text as minted from public.ops_compute_contribution_ledger where account_id='worker-a' and kind='mint'")).minted;
 assert.equal(capped,'1');
 ok('daily cap0 exceeded by1: carried2 + accepted1 at ratio3 mints1, cap check priced floor(1/3)=0');

 // Different nodes can mint for the same account. Both sessions reach the
 // carry-row lock only after reading the same pre-mint daily balance.
 await q("update public.ops_compute_node_accounts set account_id='worker-c' where node_id=$1",[NODE_D]);
 await q("insert into public.ops_compute_account_carry(account_id,carry_micro) values('worker-c',0)");
 await q("insert into public.ops_compute_account_quotas(account_id,daily_mint_cap_micro) values('worker-c',1)");
 const left=await prepare(NODE_C,3),right=await prepare(NODE_D,3);
 const gate=db.fork(),a=db.fork(),b=db.fork();
 try {
  await gate.exec('begin');
  await gate.query("select carry_micro from public.ops_compute_account_carry where account_id='worker-c' for update");
  const run=async(conn,t,k)=>(await conn.query('select public.compute_ledger_settle($1,$2::uuid,$3,$4::integer,$5::jsonb,$6,$7::text,$8::bigint) as r',[k,t.task,t.lease.tokenHash,t.lease.attempt,conn.sql.json(t.met),hashJson(t.result),HOLDER,1])).rows[0].r;
  const pa=run(a,left,key('settle')),pb=run(b,right,key('settle'));
  await waitForBlocked(db,2);
  await gate.exec('commit');
  const results=await Promise.all([pa,pb]);
  assert.equal(results.filter(r=>r.accepted===true).length,2,JSON.stringify(results));
  assert.equal(results.reduce((n,r)=>n+Number(r.minted_micro),0),2);
  const total=(await one("select sum(units_micro)::text as minted from public.ops_compute_contribution_ledger where account_id='worker-c' and kind='mint'")).minted;
  assert.equal(total,'2');
  ok('two native sessions exceeded daily cap1 with2 total minted after both passed quota before carry lock');
 } finally {await gate.close();await a.close();await b.close();}

 // Accepted ledger rows cannot be edited/deleted, but TRUNCATE is not guarded.
 const countBefore=Number((await one('select count(*)::int as n from public.ops_compute_contribution_ledger')).n);
 assert.ok(countBefore>0);
 await db.transaction(async tx=>{await tx.exec('truncate public.ops_compute_contribution_ledger cascade');assert.equal(Number((await tx.query('select count(*)::int as n from public.ops_compute_contribution_ledger')).rows[0].n),0);throw Object.assign(Error('rollback synthetic truncate'),{auditRollback:true});}).catch(e=>{if(!e.auditRollback)throw e;});
 assert.equal(Number((await one('select count(*)::int as n from public.ops_compute_contribution_ledger')).n),countBefore);
 ok('append-only guard does not refuse owner TRUNCATE; audit transaction rolled back');
 const tasksBefore=Number((await one('select count(*)::int as n from public.ops_compute_tasks')).n);
 await db.exec(read('supabase/pending/compute_contribution_ledger_v1.rollback.sql'));
 assert.equal((await one("select to_regclass('public.ops_compute_contribution_ledger')::text as relation")).relation,null);
 assert.equal(Number((await one('select count(*)::int as n from public.ops_compute_tasks')).n),tasksBefore);
 ok('unguarded recovery drops nonempty accounting history while retaining base compute tasks');
 console.log(JSON.stringify({suite:'contribution-ledger-blocker-audit',native:true,postgres:(await one('select version() as version')).version,defects_reproduced:4,full_reset:false,base:'canonical compute SQL with explicit peripheral org/role fixtures',production_changes:false,head:'b9c2ed1d86de175b5a5d1f8ce1a442ec6d45312d'}));
}finally{await db.close();}
