import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const {PGlite}=createRequire(resolve(process.env.PGLITE_DIR||'/tmp/productization-tools/node_modules','fixture.cjs'))('@electric-sql/pglite');
const db=new PGlite(),root=new URL('../../',import.meta.url),A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';let n=0;
const file=p=>readFile(new URL(p,root),'utf8');const ok=(a,b)=>{assert.deepEqual(a,b);n++;};
const denied=async(fn,code)=>{await assert.rejects(fn,e=>e.code===code);n++;};
const q=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function role(r){await db.exec('reset role');await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:r})]);await db.exec('set role '+r);}
const access=async(user=A,org=A,app='social')=>(await q('select creator_platform_access_v1($1,$2,$3) r',[user,org,app])).r;
const record=async(e,event='record:one',org=A,user=A,order=orderId)=>(await q('select creator_domain_trial_record_v1($1,$2,$3,$4,$5) r',[user,org,order,event,e])).r;
let orderId,evidence;
async function deniedTx(fn,code){await db.exec('savepoint denied_check');await denied(fn,code);await db.exec('rollback to savepoint denied_check');}

try{
 const pins=JSON.parse(await file('supabase/tests/editor-versioned/social-consumer-hashes.json'));
 for(const [p,h] of Object.entries(pins))ok(createHash('sha256').update(await file(p)).digest('hex'),h);
 for(const f of ['api-roles','account-fixture','domain-trial-catalog','managed-projects'])await db.exec((await file('supabase/tests/editor-versioned/'+f+'.sql')).replaceAll('create extension if not exists pgcrypto;',''));
 await db.exec(await file('supabase/pending/creator_domain_orders_v1.sql'));
 await db.exec(await file('supabase/migrations/20261009204152_creator_billing_subscriptions_v1.sql'));
 for(let i=0;i<2;i++)await db.exec(await file('supabase/pending/creator_domain_trial_v1.sql'));
 await q("insert into orgs values($1,'alice'),($2,'bob')",[A,B]);await q("insert into org_members values($1,$1,'owner'),($2,$2,'owner')",[A,B]);
 await db.exec("insert into platform_apps(app_key,name,product_family) values('social','Social','test'),('shop','Shop','test')");
 await q("insert into managed_projects(slug,owner_user_id,m_uid,name) values('retained',$1,$1,'Retained')",[A]);
 await db.exec(await file('supabase/tests/editor-versioned/storage.sql'));await db.exec(await file('supabase/tests/editor-versioned/social-consumer-fixture.sql'));await db.exec(await file('supabase/pending/customer_social_selfservice.sql'));for(let i=0;i<2;i++)await db.exec(await file('supabase/pending/customer_social_trial_consumer_v2.sql'));
 const c=(await q("insert into creator_domain_contacts(auth_user_id,provider_contact_id,terms_version,consent_at,verified_at) values($1,'contact1','v1',now(),now()) returning id",[A])).id;
 const quote=(await q("insert into creator_domain_quotes(auth_user_id,hostname,action,years,total_cents,registrar_cents,currency,expires_at) values($1,'example.test','register',1,1200,1000,'USD',now()+interval '1 hour') returning id",[A])).id;
 orderId=(await q("insert into creator_domain_orders(auth_user_id,quote_id,contact_id,terms_version,status,checkout_session_id,funded_event_id,paid_cents,funded_at) values($1,$2,$3,'v1','funded','cs_fixture','evt_fixture',1200,now()-interval '1 hour') returning id",[A,quote,c])).id;
 evidence=(await q("select jsonb_build_object('source','verified_registrar_readback','mode','live','hostname','example.test','registration_id','reg1','registrant_contact_id','contact1','registrant_verified',true,'charge_verified',true,'registrar_cents',1000,'currency','USD','term_years',1,'registered_at',now()-interval '30 minutes','expires_at',now()+interval '1 year','observed_at',now()) e")).e;

 const service=async(action,data={},mode='module')=>(await q('select customer_social_service_v2($1,$2,$2,$3,$4) r',[action,A,data,mode])).r;
 const state=async()=>(await q('select customer_social_access_v2($1,$1) r',[A])).r;
 await role('service_role');ok((await state()).mode,'legacy_paid');ok((await state()).eligible,false);
 await denied(()=>service('begin',{state_hash:'first'},'legacy_paid'),'42501');
 await role('postgres');await q("insert into creator_billing_subscriptions values('sub_fixture','cus_fixture',$1,'price_existing','active',now()+interval '1 day',false,$1,now())",[A]);await role('service_role');
 ok((await state()).eligible,true);await service('begin',{state_hash:'legacy'},'legacy_paid');
 await role('postgres');await db.exec("insert into private.customer_social_consumer_policy select true,true,false,id from platform_apps where app_key='social';insert into private.creator_domain_trial_policies values(1,true,'registration_verified','fixed_30_days','once_per_org',false,3600);insert into private.creator_domain_trial_modules select 1,id,true,true,'price_social' from platform_apps where app_key='social'");
 await q("update creator_domain_orders set status='fulfilled' where id=$1",[orderId]);await role('service_role');
 ok((await state()).eligible,false);await denied(()=>service('begin',{state_hash:'wrong-price'}),'42501');
 await record(evidence);ok((await state()).eligible,true);
 await denied(()=>q("select customer_social_service('begin',$1,$1,'{}')",[A]),'55000');
 await service('begin',{state_hash:'trial'});await service('claim',{state_hash:'trial'});await service('stage',{state_hash:'trial',selection_hash:'selection',token:'synthetic-test-token',expires_at:new Date(Date.now()+86400000).toISOString()});
 const installed=await service('install',{selection_hash:'selection',external_id:'fixture-account',handle:'fixture',token:'synthetic-page-token'});ok(installed.connected,true);
 await role('postgres');const trialSecret=(await q('select secret_id from private.customer_social_connections where org_id=$1',[A])).secret_id;await role('service_role');
 const released=(await q('select customer_social_token_v2($1,$2) r',[A,trialSecret])).r;ok(released.token,'synthetic-page-token');ok(released.mode,'module');await denied(()=>q('select customer_social_token_v2($1,$2)',[B,trialSecret]),'42501');
 await role('postgres');await db.exec("insert into storage.buckets(id,name) values('social-outbox','social-outbox')");await q("insert into storage.objects(bucket_id,name,metadata) values('social-outbox',$1,$2)",[A+'/clip.mp4',{size:100,mimetype:"video/mp4"}]);
 await role('service_role');const data={key:'one',hash:'hash-one',payload:{source:'customer-social',storage_path:A+'/clip.mp4'}};const job=await service('enqueue',data);ok((await service('enqueue',data)).id,job.id);
 await denied(()=>service('enqueue',{...data,hash:'wrong'}),'23505');
 // Actual Worker OAuth admission/status through real SQL, synthetic Auth/transport.
 const {handleCustomerSocialRequest}=await import('../../workers/mccluster/src/social/customer.js');
 const {tokenFor}=await import('../../workers/mccluster/src/social/meta.js');
 const originalFetch=globalThis.fetch;
 const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only',CUSTOMER_SOCIAL_ENABLED:'true',CREATOR_SOCIAL_MODULE_ACCESS_ENABLED:'true',META_APP_ID:'fixture',META_APP_SECRET:'fixture',CUSTOMER_SOCIAL_REDIRECT_URI:'https://site.invalid/customer-social.html'};
 globalThis.fetch=async(input,init={})=>{
  const url=new URL(input),name=url.pathname.split('/').pop();
  if(name==='org_members')return new Response(JSON.stringify(url.searchParams.get('org_id')==='eq.'+A?[{role:'owner'}]:[]));
  if(name==='org_channels'){await role('postgres');return new Response(JSON.stringify((await db.query('select secret_id,account_id from org_channels where org_id=$1',[A])).rows));}
  const keys={customer_social_access_v2:['p_org','p_user'],customer_social_service_v2:['p_action','p_org','p_user','p_data','p_mode'],customer_social_token_v2:['p_org','p_secret']}[name];assert.ok(keys,'unexpected network '+name);
  const body=JSON.parse(init.body);await role('service_role');
  try{return new Response(JSON.stringify((await q('select public.'+name+'('+keys.map((_,i)=>'$'+(i+1)).join(',')+') r',keys.map(k=>body[k]))).r));}catch(e){return new Response(JSON.stringify({code:e.code}),{status:400});}
 };
 try{
  const result=await handleCustomerSocialRequest(new Request('https://site.invalid/v1/customer-social/connect',{method:'POST',body:JSON.stringify({org_id:A})}),env,{id:A});ok(new URL(result.authorization_url).hostname,'www.facebook.com');
  const status=await handleCustomerSocialRequest(new Request('https://site.invalid/v1/customer-social/status?org_id='+A),env,{id:A});ok(status.module_consumer.mode,'module');ok(status.capability.eligible,true);ok(status.legacy_paid_gate_required,false);ok(status.capability.entitlement_reason,'included_trial');ok(status.capability.reason,null);
  ok(await tokenFor(env,{org_id:A,platform:'instagram',external_account_id:'fixture-account'}),'synthetic-page-token');
 }finally{globalThis.fetch=originalFetch;}
 await role('postgres');await db.exec('delete from private.creator_domain_trial_modules');await role('service_role');ok((await state()).eligible,true); // immutable trial snapshot grandfathered
 await role('postgres');await db.exec("update platform_apps set enabled=false where app_key='social'");await role('service_role');await denied(()=>service('begin',{state_hash:'app-disabled'}),'42501');await denied(()=>q("update social_publish_jobs set state='processing' where id=$1",[job.id]),'42501');
 await role('postgres');await db.exec("update platform_apps set enabled=true where app_key='social';update private.customer_social_consumer_policy set safety_disabled=true");await role('service_role');ok((await state()).eligible,false);await denied(()=>service('begin',{state_hash:'kill'}),'42501');
 await role('postgres');await db.exec('update private.customer_social_consumer_policy set safety_disabled=false');
 await denied(()=>db.exec("update private.customer_social_consumer_policy set app_id=(select id from platform_apps where app_key='shop')"),'42501');
 await db.exec('begin');await db.exec("alter table private.creator_domain_trial_receipts disable trigger creator_trial_receipt_guard;update private.creator_domain_trial_receipts set trial_starts_at=clock_timestamp()-interval '2 days',trial_expires_at=clock_timestamp()-interval '1 day';alter table private.creator_domain_trial_receipts enable trigger creator_trial_receipt_guard");
 await role('service_role');ok((await state()).eligible,false);await deniedTx(()=>q('select customer_social_token_v2($1,$2)',[A,trialSecret]),'42501');await deniedTx(()=>service('begin',{state_hash:'expired'}),'42501');await deniedTx(()=>q("update social_publish_jobs set state='processing' where id=$1",[job.id]),'42501');await db.exec('rollback');await role('postgres');
 await db.exec('update private.creator_domain_trial_policies set enabled=false');await role('service_role');ok((await state()).eligible,false);await denied(()=>service('begin',{state_hash:'global-off'}),'42501');await role('postgres');await db.exec('update private.creator_domain_trial_policies set enabled=true');
 await role('service_role');await q('select creator_domain_trial_cancel_v1($1,$1,$2,$3)',[A,orderId,'cancel-social']);ok((await state()).eligible,false);await denied(()=>q('select customer_social_token_v2($1,$2)',[A,trialSecret]),'42501');await denied(()=>service('enqueue',{...data,key:'two'}),'42501');
 await denied(()=>q("insert into social_publish_jobs(org_id,account_id,state,payload) values($1,$2,'queued','{}')",[A,installed.account_id]),'42501');
 await denied(()=>q("update social_publish_jobs set state='processing' where id=$1",[job.id]),'42501');
 await q("update social_publish_jobs set last_error='bookkeeping remains available' where id=$1",[job.id]);
 await role('postgres');const cred=(await q('select secret_id from private.customer_social_connections where org_id=$1',[A])).secret_id;await role('service_role');
 ok((await q('select customer_social_credential_access($1,$2) r',[A,cred])).r.allowed,false);
 ok((await q('select customer_social_credential_access($1,$2) r',[A,cred])).r.mode,'module');
 await denied(()=>q('select customer_social_access_v2($1,$2)',[A,B]),'42501');
 await role('postgres');await db.exec("insert into private.creator_domain_trial_modules select 1,id,true,true,'price_social' from platform_apps where app_key='social';update creator_billing_subscriptions set stripe_price_id='price_social'");await role('service_role');ok((await state()).eligible,true);await service('begin',{state_hash:'paid'});
 await role('postgres');await db.exec('update private.customer_social_consumer_policy set enabled=false');await role('service_role');ok((await state()).mode,'legacy_paid');ok((await state()).eligible,true);
 await role('postgres');await db.exec('update private.customer_social_consumer_policy set safety_disabled=true');await role('service_role');ok((await state()).eligible,false);await service('disconnect');ok((await service('status')),null);
 await denied(()=>q("update social_publish_jobs set state='queued' where id=$1",[job.id]),'42501');await denied(()=>q("update social_publish_jobs set state='queued',dedupe_key=null,payload='{}' where id=$1",[job.id]),'42501');
 await role('postgres');ok((await q('select count(*)::int n from social_publish_jobs')).n,1);ok((await q('select state from social_publish_jobs where id=$1',[job.id])).state,'cancelled');ok((await q("select count(*)::int n from managed_projects where slug='retained'")).n,1);
 for(const r of ['anon','authenticated']){await role(r);await denied(()=>q('select customer_social_access_v2($1,$1)',[A]),'42501');await denied(()=>service('begin',{}),'42501');}
 await role('service_role');await denied(()=>q("select private.customer_social_service_legacy_v1('begin',$1,$1,'{}')",[A]),'42501');
 console.log('PASS '+n+' atomic social consumer SQL/Worker assertions');
}finally{await db.close();}
