// COM-3 native SQL acceptance, including actual independent-session lock races.
// No external DB URL is accepted. Opt in with ALLOW_LOCAL_CREATOR_DB_TESTS=1,
// PG_BIN=<installed PostgreSQL 16/17 bin> PG_MODULE=<installed node-postgres>.
// A fresh non-root server listens only on 127.0.0.1 and is stopped/removed after.
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,appendFileSync,rmSync,existsSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {join} from 'node:path';
import {recoverCreatorCheckout} from '../../workers/mccluster/src/creator-checkout-recovery.js';

assert.equal(process.env.ALLOW_LOCAL_CREATOR_DB_TESTS,'1','local disposable PostgreSQL test opt-in required');
assert.notEqual(process.getuid?.(),0,'PostgreSQL test must run as a non-root user');
const bin=process.env.PG_BIN;
assert.ok(bin&&existsSync(join(bin,'initdb'))&&existsSync(join(bin,'pg_ctl')),'PG_BIN must contain installed binaries');
const require=createRequire(import.meta.url),{Client}=require(process.env.PG_MODULE||'pg');
const forward=readFileSync(new URL('../../supabase/pending/20261026009200_creator_checkout_reservations.sql',import.meta.url),'utf8');
const rollback=readFileSync(new URL('../../supabase/pending/20261026009200_creator_checkout_reservations.rollback.sql',import.meta.url),'utf8');
const dir=mkdtempSync('/tmp/creator-checkout-pg-');
const env={PATH:process.env.PATH||'/usr/bin:/bin',LANG:'C',LC_ALL:'C'};
let running=false;const clients=new Set();
const stop=()=>{if(running){spawnSync(join(bin,'pg_ctl'),['-D',dir,'-m','immediate','-w','stop'],{env,stdio:'ignore'});running=false;}rmSync(dir,{recursive:true,force:true});};
process.once('exit',stop);
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stop();process.exit(1);});
const run=(tool,args)=>execFileSync(join(bin,tool),args,{env,stdio:'pipe',encoding:'utf8'});
const freePort=()=>new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const checks=[];
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS',name);};
const owner=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const key=n=>`checkout-fixture-${String(n).padStart(4,'0')}`;
const payload=(user,request,price='price_fixture')=>({mode:'subscription',expand:['line_items'],client_reference_id:user,
 line_items:[{price,quantity:1}],success_url:'https://matthew.mccluster.org/customer-commerce.html?checkout=returned&session_id={CHECKOUT_SESSION_ID}',
 cancel_url:'https://matthew.mccluster.org/customer-commerce.html?checkout=cancelled',
 metadata:{mccluster_user_id:user,creator_plan:'starter',creator_period:'monthly',creator_provider_mode:'test',creator_request_id:request},
 subscription_data:{metadata:{mccluster_user_id:user,creator_plan:'starter',creator_period:'monthly',creator_provider_mode:'test',creator_request_id:request}}});
const evidence={status:400,type:'invalid_request_error',pre_execution:true,provider_request_id:'req_fixture400'};
try{
 run('initdb',['-D',dir,'-U','postgres','--auth=trust','-E','UTF8','--locale=C','--no-instructions']);
 const port=await freePort();
 appendFileSync(join(dir,'postgresql.conf'),`\nlisten_addresses='127.0.0.1'\nport=${port}\nunix_socket_directories=''\nmax_connections=16\nfsync=off\nsynchronous_commit=off\nfull_page_writes=off\n`);
 run('pg_ctl',['-D',dir,'-l',join(dir,'server.log'),'-w','-t','30','start']);running=true;
 const connect=async()=>{const db=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',ssl:false,connectionTimeoutMillis:5000});await db.connect();clients.add(db);return db;};
 const admin=await connect();
 const version=(await admin.query('show server_version')).rows[0].server_version;
 assert.match(version,/^(16|17)\./);
 assert.equal((await admin.query('show listen_addresses')).rows[0].listen_addresses,'127.0.0.1');
 assert.equal((await admin.query('show unix_socket_directories')).rows[0].unix_socket_directories,'');
 console.log(JSON.stringify({version,uid:process.getuid(),host:'127.0.0.1',port,external_provider_calls:0}));
 await admin.query(`create role anon;create role authenticated;create role service_role bypassrls;
  create schema auth;grant usage on schema public,auth to anon,authenticated,service_role;
  create table auth.users(id uuid primary key);
  create table public.creator_billing_subscriptions(owner_user_id uuid,status text);
  grant select on public.creator_billing_subscriptions to service_role;
  alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
  alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
  alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
  create table public.creator_checkout_reservations(owner_user_id uuid primary key references auth.users(id),request_id text not null,price_id text not null,checkout_session_id text,expires_at timestamptz not null);`);
 for(let n=1;n<=40;n++)await admin.query('insert into auth.users values ($1)',[owner(n)]);
 await admin.query("insert into creator_checkout_reservations values($1,$2,'price_fixture',null,now()-interval '1 hour'),($3,$4,'price_fixture','cs_legacy',now()-interval '1 hour')",[owner(1),key(1),owner(2),key(2)]);
 await admin.query(forward);
 const db=await connect();await db.query('set role service_role');
 const value=async(sql,values=[],client=db)=>(await client.query(sql,values)).rows[0].result;
 const reserve=(n,k=key(n),p='price_fixture',body=payload(owner(n),k,p),client=db)=>value('select reserve_creator_checkout($1,$2,$3,$4) result',[owner(n),k,p,body],client);
 const outcome=(n,state,details=evidence,k=key(n),client=db)=>value('select mark_creator_checkout_outcome($1,$2,$3,$4) result',[owner(n),k,state,details],client);
 const bind=(n,id,k=key(n),client=db)=>value('select bind_creator_checkout($1,$2,$3) result',[owner(n),k,id],client);
 const release=(n,id)=>value('select release_expired_creator_checkout($1,$2) result',[owner(n),id]);
 const receipt=(n,k=key(n),client=db)=>value('select to_jsonb(a) result from creator_checkout_attempts a where owner_user_id=$1 and request_id=$2',[owner(n),k],client);
 // Historical-time fixture only. Real service_role mutation is separately denied.
 const age=async(n,hours)=>{await admin.query('begin;set local session_replication_role=replica');try{
  await admin.query(`update creator_checkout_attempts set created_at=created_at-($2*interval '1 hour'),expires_at=expires_at-($2*interval '1 hour'),retry_until=retry_until-($2*interval '1 hour'),
   provider_payload=jsonb_set(provider_payload,'{expires_at}',to_jsonb(extract(epoch from expires_at-($2*interval '1 hour'))::bigint)) where owner_user_id=$1`,[owner(n),hours]);
  await admin.query("update creator_checkout_reservations set expires_at=expires_at-($2*interval '1 hour') where owner_user_id=$1",[owner(n),hours]);await admin.query('commit');
 }catch(error){await admin.query('rollback');throw error;}};
 await check('upgrade preserves old guards; unknown payload requires owner; known expired session reconciles',async()=>{
  const before=await receipt(1);assert.equal(before.state,'requires_owner');assert.equal(before.provider_payload,null);
  assert.equal((await reserve(1,key(1),'price_fixture',null)).reason,'checkout_requires_owner');
  assert.equal(await release(1,'cs_legacy'),false);
  assert.equal((await reserve(2,key(2),'price_fixture',null)).reason,'checkout_reconciliation_required');
  assert.equal(await release(2,'cs_legacy'),true);assert.equal((await receipt(2)).state,'expired');
  assert.equal((await reserve(2,key(2),'price_fixture',null)).reason,'checkout_request_retired');
 });
 await check('first definitive 400 releases guard, keeps receipt, permits new request, blocks replay',async()=>{
  const first=await reserve(3);assert.equal(first.blocked,false);assert.equal(first.state,'reserved');
  assert.deepEqual(await outcome(3,'rejected'),{recorded:true,state:'rejected',released:true});
  const tombstone=await receipt(3);assert.equal(tombstone.dispatch_count,1);assert.ok(tombstone.released_at);
  assert.deepEqual(tombstone.provider_payload,first.provider_payload);assert.equal(tombstone.idempotency_key,first.idempotency_key);
  assert.equal((await reserve(3)).reason,'checkout_request_retired');
  assert.equal((await reserve(3,key(33))).blocked,false);
  assert.equal((await reserve(3)).reason,'checkout_request_retired');
  assert.equal(await bind(3,'cs_late'),false);
  assert.equal(await value('select request_id result from creator_checkout_reservations where owner_user_id=$1',[owner(3)]),key(33));
 });
 await check('unproven/malformed errors never release, nor does later valid rejection after uncertainty',async()=>{
  const variants=[{...evidence,status:500},{...evidence,type:'api_error'},{...evidence,pre_execution:false},{...evidence,provider_request_id:null}];
  for(let i=0;i<variants.length;i++){const n=4+i;await reserve(n);const result=await outcome(n,'rejected',variants[i]);assert.equal(result.released,false);assert.equal(result.state,'uncertain');
   assert.equal((await outcome(n,'rejected')).released,false);assert.equal((await reserve(n,key(100+n))).blocked,true);assert.equal((await receipt(n)).had_uncertain,true);}
 });
 await check('crash before outcome write cannot make the second provider call a safe rejection',async()=>{
  const first=await reserve(8);assert.deepEqual(await reserve(8),first);
  assert.equal((await receipt(8)).dispatch_count,2);assert.equal((await outcome(8,'rejected')).released,false);
  assert.equal((await receipt(8)).state,'uncertain');
 });
 await check('timeout before and after provider acceptance keep original identity across a new connection',async()=>{
  for(const n of [9,10]){const first=await reserve(n);assert.equal((await outcome(n,'uncertain',{})).released,false);
   const reloaded=await connect();await reloaded.query('set role service_role');
   const retried=await reserve(n,key(n),'price_fixture',null,reloaded);
   assert.equal(retried.idempotency_key,first.idempotency_key);assert.deepEqual(retried.provider_payload,first.provider_payload);
   assert.equal(retried.expires_at,first.expires_at);assert.equal(retried.state,'uncertain');
   assert.equal((await reserve(n,key(200+n))).reason,'checkout_pending');}
  assert.equal(await bind(10,'cs_timeoutaccepted'),true);
 });
 await check('bind failure preserves pending attempt; exact session binds idempotently, other binding refused',async()=>{
  const first=await reserve(11);assert.equal(await bind(11,'cs_bound',key(999)),false);
  assert.equal((await receipt(11)).state,'reserved');assert.equal((await reserve(11,key(111))).blocked,true);
  const retry=await reserve(11,key(11),'price_fixture',null);assert.deepEqual(retry.provider_payload,first.provider_payload);
  assert.equal(await bind(11,'cs_bound'),true);assert.equal(await bind(11,'cs_bound'),true);assert.equal(await bind(11,'cs_other'),false);
  assert.equal(await bind(9,'cs_bound'),false);
  assert.equal((await outcome(11,'uncertain',{})).state,'session_bound');assert.equal((await outcome(11,'rejected')).released,false);
  assert.equal(await release(11,'cs_bound'),false);
  assert.equal((await outcome(11,'requires_owner',{})).state,'requires_owner');assert.equal((await receipt(11)).checkout_session_id,'cs_bound');
  assert.equal(await bind(11,'cs_other'),false);assert.equal(await bind(11,'cs_bound'),true);
 });
 await check('original retry after checkout expiry stays byte-equivalent within 23h; later retry needs owner',async()=>{
  await reserve(12);await outcome(12,'uncertain',{});await age(12,2);const original=await receipt(12);
  const retry=await reserve(12,key(12),'price_fixture',null);assert.equal(retry.blocked,false);
  assert.deepEqual(retry.provider_payload,original.provider_payload);assert.equal(Date.parse(retry.expires_at),Date.parse(original.expires_at));
  assert.ok(Date.parse(retry.expires_at)<Date.now());assert.equal((await reserve(12,key(120))).blocked,true);
  await age(12,22);const prior=await receipt(12);assert.equal((await reserve(12,key(12),'price_fixture',null)).reason,'checkout_requires_owner');
  assert.equal((await receipt(12)).dispatch_count,prior.dispatch_count);assert.equal((await receipt(12)).state,'requires_owner');
  assert.equal((await outcome(12,'rejected')).released,false);assert.equal(await release(12,'cs_missing'),false);
 });
 await check('request/price/full payload and account binding are immutable',async()=>{
  await reserve(13);assert.equal((await reserve(13,key(13),'price_other')).reason,'checkout_identity_conflict');
  const changed={...payload(owner(13),key(13)),cancel_url:'https://wrong.example/'};
  assert.equal((await reserve(13,key(13),'price_fixture',changed)).reason,'checkout_identity_conflict');
  assert.equal((await reserve(13,key(130))).reason,'checkout_pending');
  assert.equal((await reserve(14,key(13))).blocked,false);assert.notEqual((await receipt(14,key(13))).idempotency_key,(await receipt(13)).idempotency_key);
  await assert.rejects(reserve(15,key(15),'price_fixture',payload(owner(14),key(15))),/canonical checkout payload required/);
  await assert.rejects(reserve(15,key(15),'price_fixture',null),/canonical checkout payload required/);
  await assert.rejects(reserve(15,key(15),'price_fixture',payload(owner(15),key(16))),/canonical checkout payload required/);
  const wrongPlan=payload(owner(15),key(15));wrongPlan.subscription_data.metadata.creator_plan='pro';
  await assert.rejects(reserve(15,key(15),'price_fixture',wrongPlan),/canonical checkout payload required/);
  for(const mutation of ["price_id='price_other'","provider_payload='{}'::jsonb","idempotency_key='changed'","expires_at=now()","created_at=now()-interval '1 hour'","retry_until=now()+interval '30 hours'"])
   await assert.rejects(db.query(`update creator_checkout_attempts set ${mutation} where owner_user_id=$1`,[owner(13)]),/immutable/);
  await assert.rejects(db.query('delete from creator_checkout_attempts where owner_user_id=$1',[owner(13)]),/permission denied/);
  await outcome(13,'uncertain',{});await assert.rejects(db.query('update creator_checkout_attempts set had_uncertain=false where owner_user_id=$1',[owner(13)]),/history cannot be erased/);
 });
 await check('delayed negative outcomes cannot erase session; delayed subscription blocks release/new attempts',async()=>{
  await reserve(16);assert.equal(await bind(16,'cs_delayed'),true);await age(16,2);
  assert.equal((await outcome(16,'rejected')).released,false);assert.equal((await receipt(16)).state,'session_bound');
  await admin.query("insert into creator_billing_subscriptions values($1,'active')",[owner(16)]);
  assert.equal(await release(16,'cs_delayed'),false);assert.equal((await reserve(16)).reason,'existing_subscription');
  assert.equal((await reserve(16,key(160))).reason,'existing_subscription');
  assert.equal((await receipt(16)).released_at,null);
 });
 await check('verified expired bound session is the only expiry release; its identity remains retired',async()=>{
  await reserve(17);await bind(17,'cs_expired');await age(17,2);
  assert.equal((await reserve(17)).reason,'checkout_reconciliation_required');assert.equal(await release(18,'cs_expired'),false);
  assert.equal(await release(17,'cs_wrong'),false);assert.equal(await release(17,'cs_expired'),true);
  assert.equal((await receipt(17)).state,'expired');assert.equal((await reserve(17)).reason,'checkout_request_retired');
  assert.equal((await reserve(17,key(170))).blocked,false);assert.equal(await bind(17,'cs_expired'),false);
 });
 await check('all blocking subscription statuses still protect owner, never another tenant',async()=>{
  for(const status of ['active','trialing','past_due','unpaid','incomplete','paused']){
   await admin.query('insert into creator_billing_subscriptions values($1,$2)',[owner(18),status]);assert.equal((await reserve(18)).reason,'existing_subscription');
   await admin.query('delete from creator_billing_subscriptions where owner_user_id=$1',[owner(18)]);
  }
  assert.equal((await reserve(18)).blocked,false);
 });
 await check('owner reconciliation audit is durable, append-only, and has no force release action',async()=>{
  const audit=(action,actor=owner(40))=>value('select audit_creator_checkout_recovery($1,$2,$3,$4,$5) result',[owner(12),key(12),actor,action,{status:409,state:'requires_owner'}]);
  assert.equal(await audit('reconcile_requested'),true);assert.equal(await audit('reconcile_failed'),true);
  await assert.rejects(audit('force_release'),/invalid recovery audit/);await assert.rejects(audit('reconcile_requested',null),/invalid recovery audit/);
  const row=(await db.query("select * from creator_checkout_recovery_audit where actor_user_id=$1 order by id desc limit 1",[owner(40)])).rows[0];
  assert.equal(row.owner_user_id,owner(12));assert.equal(row.request_id,key(12));assert.equal(row.action,'reconcile_failed');
  await assert.rejects(db.query('delete from creator_checkout_recovery_audit where id=$1',[row.id]),/permission denied/);
  await assert.rejects(admin.query("update creator_checkout_recovery_audit set action='changed' where id=$1",[row.id]),/append-only/);
  assert.equal((await reserve(12,key(121))).blocked,true);
 });
 await check('Supabase broad defaults are revoked: anon/authenticated cannot read data or invoke any RPC',async()=>{
  for(const role of ['anon','authenticated']){
   const denied=await connect();await denied.query(`set role ${role}`);
   for(const table of ['creator_checkout_reservations','creator_checkout_attempts','creator_checkout_recovery_audit'])await assert.rejects(denied.query(`select * from ${table}`),/permission denied/);
   for(const sql of ["select reserve_creator_checkout(null,null,null)","select mark_creator_checkout_outcome(null,null,'uncertain')","select bind_creator_checkout(null,null,null)","select release_expired_creator_checkout(null,null)","select audit_creator_checkout_recovery(null,null,null,null)"])
    await assert.rejects(denied.query(sql),/permission denied/);
   await assert.rejects(denied.query("select nextval('creator_checkout_recovery_audit_id_seq')"),/permission denied/);
  }
  const rls=await admin.query("select relname,relrowsecurity from pg_class where relname in ('creator_checkout_reservations','creator_checkout_attempts','creator_checkout_recovery_audit')");
  assert.equal(rls.rows.length,3);assert.ok(rls.rows.every(r=>r.relrowsecurity));
 });
 await check('real concurrent requests serialize per owner; rejection cannot erase a queued second dispatch',async()=>{
  const a=await connect(),b=await connect();for(const c of [a,b])await c.query('set role service_role');
  await a.query('begin');await reserve(20,key(20),'price_fixture',payload(owner(20),key(20)),a);
  let completed=false;const pending=reserve(20,key(200),'price_fixture',payload(owner(20),key(200)),b).then(r=>{completed=true;return r;});
    const end=Date.now()+5000;let locked=false;
  while(Date.now()<end){locked=(await admin.query("select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock' and query like 'select reserve_creator_checkout%') yes",[b.processID])).rows[0].yes;if(locked)break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(locked,true,'second connection must wait on native advisory lock');assert.equal(completed,false);
  await a.query('commit');assert.equal((await pending).reason,'checkout_pending');
  await a.query('begin');await reserve(21,key(21),'price_fixture',payload(owner(21),key(21)),a);
  const same=reserve(21,key(21),'price_fixture',payload(owner(21),key(21)),b);await a.query('commit');assert.equal((await same).blocked,false);
  assert.equal((await outcome(21,'rejected')).released,false);assert.equal((await receipt(21)).dispatch_count,2);
  assert.equal((await reserve(22)).blocked,false);
 });
 await check('actual recovery worker + native RPCs classify rejection and preserve exact request after lost response/bind failure',async()=>{
  const originalFetch=globalThis.fetch,sessions=new Map(),calls=[];let scenario='success',failBind=false;
  globalThis.fetch=async(input,options)=>{
   const url=new URL(input);assert.equal(url.origin,'https://api.stripe.com');assert.ok(url.pathname.startsWith('/v1/checkout/sessions'));
   calls.push({body:options.body,key:options.headers['Idempotency-Key'],method:options.method});
   if(options.method==='GET')return Response.json([...sessions.values()].find(s=>s.id===url.pathname.split('/').pop()));
   const id=options.headers['Idempotency-Key'];
   if(sessions.has(id))return Response.json(sessions.get(id));
   if(scenario==='reject')return Response.json({error:{type:'invalid_request_error',code:'parameter_invalid_integer'}},{status:400,headers:{'request-id':'req_native400'}});
   if(scenario==='timeout_before')throw new Error('Synthetic request never reached provider');
   const form=new URLSearchParams(options.body),metadata={};for(const [k,v]of form)if(k.startsWith('metadata['))metadata[k.slice(9,-1)]=v;
   const session={id:'cs_native_'+sessions.size,url:'https://checkout.stripe.com/c/native',mode:'subscription',livemode:false,status:'open',
    client_reference_id:form.get('client_reference_id'),metadata,line_items:{data:[{price:{id:form.get('line_items[0][price]')},quantity:1}]}};
   sessions.set(id,session);if(scenario==='timeout_after')throw new Error('Synthetic provider accepted then connection lost');return Response.json(session);
  };
  const nativeRpc=async(route,p)=>{
   if(route==='rpc/mark_creator_checkout_outcome')return value('select mark_creator_checkout_outcome($1,$2,$3,$4) result',[p.p_owner,p.p_request,p.p_outcome,p.p_details]);
   if(route==='rpc/bind_creator_checkout'){if(failBind)throw new Error('Synthetic persistence unavailable');return value('select bind_creator_checkout($1,$2,$3) result',[p.p_owner,p.p_request,p.p_session]);}
   if(route==='rpc/release_expired_creator_checkout')return value('select release_expired_creator_checkout($1,$2) result',[p.p_owner,p.p_session]);
   throw new Error('Unexpected native RPC '+route);
  };
  const recover=async(n,retry=false)=>{const reservation=await reserve(n,key(n),'price_fixture',retry?null:payload(owner(n),key(n)));assert.equal(reservation.blocked,false);
   return recoverCreatorCheckout({env:{STRIPE_SECRET_KEY:'rk_test_nativefixture'},db:nativeRpc,attempt:{...reservation,owner_user_id:owner(n)},dispatch:true});};
  try{
   scenario='reject';const rejected=await recover(30);assert.equal(rejected.status,422);assert.equal(rejected.data.released,true);assert.equal((await receipt(30)).state,'rejected');
   scenario='timeout_after';assert.equal((await recover(31)).status,503);const first=calls.findLast(c=>c.method==='POST');assert.equal((await receipt(31)).state,'uncertain');
   scenario='success';assert.equal((await recover(31,true)).status,200);assert.equal(calls.findLast(c=>c.method==='POST').body,first.body);assert.equal(calls.findLast(c=>c.method==='POST').key,first.key);assert.equal(sessions.size,1);assert.equal((await receipt(31)).state,'session_bound');
   failBind=true;assert.equal((await recover(32)).status,503);const bindBody=calls.findLast(c=>c.method==='POST').body;assert.equal((await receipt(32)).state,'uncertain');
   failBind=false;assert.equal((await recover(32,true)).status,200);assert.equal(calls.findLast(c=>c.method==='POST').body,bindBody);assert.equal(sessions.size,2);
   scenario='timeout_before';assert.equal((await recover(33)).status,503);scenario='reject';assert.equal((await recover(33,true)).status,503);
   assert.equal((await receipt(33)).state,'uncertain');assert.equal((await reserve(33,key(330))).blocked,true);
  }finally{globalThis.fetch=originalFetch;}
 });
 await check('repeat application and emergency rollback preserve guards, receipts and audit',async()=>{
  const counts=async()=>value("select jsonb_build_object('attempts',(select count(*) from creator_checkout_attempts),'guards',(select count(*) from creator_checkout_reservations),'audit',(select count(*) from creator_checkout_recovery_audit)) result",[],admin);
  const before=await counts();const original=await receipt(12);await admin.query(forward);assert.deepEqual(await counts(),before);assert.deepEqual(await receipt(12),original);
  await admin.query(rollback);assert.deepEqual(await counts(),before);await assert.rejects(reserve(23),/permission denied/);
  await assert.rejects(db.query('delete from creator_checkout_reservations where owner_user_id=$1',[owner(12)]),/permission denied/);
  await admin.query(forward);assert.deepEqual(await counts(),before);assert.equal((await reserve(23)).blocked,false);
 });
 console.log(JSON.stringify({result:'PASS',version,checks:checks.length,names:checks}));
}finally{
 for(const db of clients)await db.end().catch(()=>{});
 stop();
}
