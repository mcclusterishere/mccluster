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
try{
 const pins=JSON.parse(await file('supabase/tests/editor-versioned/domain-trial-hashes.json'));
 for(const [p,h] of Object.entries(pins))ok(createHash('sha256').update(await file(p)).digest('hex'),h);
 for(const f of ['api-roles','account-fixture','domain-trial-catalog','managed-projects'])await db.exec((await file('supabase/tests/editor-versioned/'+f+'.sql')).replaceAll('create extension if not exists pgcrypto;',''));
 await db.exec(await file('supabase/pending/creator_domain_orders_v1.sql'));
 await db.exec(await file('supabase/migrations/20261009204152_creator_billing_subscriptions_v1.sql'));
 for(let i=0;i<2;i++)await db.exec(await file('supabase/pending/creator_domain_trial_v1.sql'));
 await q("insert into orgs values($1,'alice'),($2,'bob')",[A,B]);await q("insert into org_members values($1,$1,'owner'),($2,$2,'owner')",[A,B]);
 await db.exec("insert into platform_apps(app_key,name,product_family) values('social','Social','test'),('shop','Shop','test')");
 await q("insert into managed_projects(slug,owner_user_id,m_uid,name) values('retained',$1,$1,'Retained')",[A]);
 const c=(await q("insert into creator_domain_contacts(auth_user_id,provider_contact_id,terms_version,consent_at,verified_at) values($1,'contact1','v1',now(),now()) returning id",[A])).id;
 const quote=(await q("insert into creator_domain_quotes(auth_user_id,hostname,action,years,total_cents,registrar_cents,currency,expires_at) values($1,'example.test','register',1,1200,1000,'USD',now()+interval '1 hour') returning id",[A])).id;
 orderId=(await q("insert into creator_domain_orders(auth_user_id,quote_id,contact_id,terms_version,status,checkout_session_id,funded_event_id,paid_cents,funded_at) values($1,$2,$3,'v1','funded','cs_fixture','evt_fixture',1200,now()-interval '1 hour') returning id",[A,quote,c])).id;
 evidence=(await q("select jsonb_build_object('source','verified_registrar_readback','mode','live','hostname','example.test','registration_id','reg1','registrant_contact_id','contact1','registrant_verified',true,'charge_verified',true,'registrar_cents',1000,'currency','USD','term_years',1,'registered_at',now()-interval '30 minutes','expires_at',now()+interval '1 year','observed_at',now()) e")).e;
 for(const r of ['anon','authenticated','service_role']){
  for(const sig of ['creator_domain_trial_record_v1(uuid,uuid,uuid,text,jsonb)','creator_domain_trial_cancel_v1(uuid,uuid,uuid,text)','creator_platform_access_v1(uuid,uuid,text)','creator_platform_require_v1(uuid,uuid,text,text)'])ok((await q('select has_function_privilege($1,$2,\'execute\') p',[r,sig])).p,r==='service_role');
  for(const t of ['policies','modules','receipts','events'])ok((await q("select has_table_privilege($1,$2,'INSERT,UPDATE,DELETE,TRUNCATE,SELECT') p",[r,'private.creator_domain_trial_'+t])).p,false);
 }
 for(const r of ['anon','authenticated']){await role(r);await denied(()=>access(),'42501');await denied(()=>record(evidence),'42501');}
 await role('service_role');await denied(()=>record(evidence),'55000');await denied(()=>access(B,A),'42501');await denied(()=>access(A,B),'42501');ok((await access()).capabilities.base_manage.allowed,true);
 await role('postgres');await db.exec("insert into private.creator_domain_trial_policies values(1,true,'registration_verified','calendar_month_utc','once_per_org',false,3600);insert into private.creator_domain_trial_modules select 1,id,true,true,'price_social' from platform_apps where app_key='social'");
 await role('service_role');await denied(()=>record(evidence),'42501');
 await denied(()=>q('select creator_domain_trial_cancel_v1($1,$1,$2,$3)',[A,orderId,'cancel:before']),'P0002');
 await role('postgres');await q("update creator_domain_orders set status='fulfilled' where id=$1",[orderId]);await role('service_role');
 for(const change of [{hostname:'wrong.test'},{charge_verified:false},{registrant_contact_id:'other'},{mode:'sandbox'},{registrar_cents:999},{term_years:2},{observed_at:'2000-01-01Z'}])await denied(()=>record({...evidence,...change}),'42501');
 await role('postgres');await db.exec("create function trial_fixture_fail() returns trigger language plpgsql as $$begin raise exception 'synthetic receipt failure';end$$;create trigger zz_trial_fixture_fail after insert on private.creator_domain_trial_events for each row execute function trial_fixture_fail();");
 await role('service_role');await denied(()=>record(evidence),'P0001');await role('postgres');ok((await q('select count(*)::int n from private.creator_domain_trial_receipts')).n,0);await db.exec('drop trigger zz_trial_fixture_fail on private.creator_domain_trial_events');await role('service_role');
 const receipt=await record(evidence);ok((await access()).capabilities.advanced.allowed,true);ok((await access(A,A,'shop')).capabilities.advanced.allowed,false);
 ok(await record(evidence),receipt);ok(await record(evidence,'record:retry'),receipt);await denied(()=>record({...evidence,registration_id:'other'}),'PT409');await denied(()=>record(evidence,'record:one',B,B),'PT409');
 ok((await q("select creator_platform_require_v1($1,$1,'social','advanced') r",[A])).r.scope.org_id,A);
 await role('postgres');await q("update m_people set status='suspended' where id=$1",[A]);await role('service_role');await denied(()=>access(),'42501');await role('postgres');await q("update m_people set status='active' where id=$1",[A]);
 for(const [input,mode,want] of [['2024-01-31T12:00:00Z','calendar_month_utc','2024-02-29T12:00:00.000Z'],['2023-01-31T12:00:00Z','calendar_month_utc','2023-02-28T12:00:00.000Z'],['2024-01-31T12:00:00Z','fixed_30_days','2024-03-01T12:00:00.000Z']])ok((await q('select private.creator_trial_end_v1($1,$2) t',[input,mode])).t.toISOString(),want);
 for(const [time,state,allowed] of [[new Date(new Date(receipt.trial_starts_at)-1),'pending',false],[receipt.trial_starts_at,'active',true],[receipt.trial_expires_at,'expired',false]]){const r=(await q("select private.creator_platform_access_at_v1($1,$1,'social',$2) r",[A,time])).r;ok(r.trial.state,state);ok(r.capabilities.advanced.allowed,allowed);ok(r.capabilities.base_manage.allowed,true);}
 await q("update creator_domain_orders set status='refund_required' where id=$1",[orderId]);await role('service_role');ok((await access()).capabilities.advanced.allowed,false);
 await role('postgres');await q("update creator_domain_orders set status='fulfilled' where id=$1",[orderId]);await role('service_role');
 const cancelled=(await q('select creator_domain_trial_cancel_v1($1,$1,$2,$3) r',[A,orderId,'cancel:'+orderId])).r;ok(cancelled.domain_expires_at,receipt.domain_expires_at);ok((await access()).capabilities.advanced.allowed,false);ok((await access()).capabilities.base_manage.allowed,true);
 ok((await q('select creator_domain_trial_cancel_v1($1,$1,$2,$3) r',[A,orderId,'cancel:'+orderId])).r,cancelled);ok((await record(evidence,'record:aftercancel')).cancelled_at,cancelled.cancelled_at);
 await denied(()=>q("select creator_platform_require_v1($1,$1,'social','advanced')",[A]),'42501');
 await role('postgres');await q("insert into creator_billing_subscriptions values('sub_fixture','cus_fixture',$1,'price_other','active',now()+interval '1 day',false,$1,now())",[A]);await role('service_role');ok((await access()).capabilities.advanced.allowed,false);
 await role('postgres');await db.exec("update creator_billing_subscriptions set stripe_price_id='price_social'");await role('service_role');ok((await access()).capabilities.advanced.allowed,true);ok((await access(A,A,'shop')).capabilities.advanced.allowed,false);ok((await access(B,B)).capabilities.advanced.allowed,false);
 await role('postgres');await db.exec("update creator_billing_subscriptions set status='trialing'");await role('service_role');ok((await access()).capabilities.advanced.allowed,false);
 await role('postgres');
 const cb=(await q("insert into creator_domain_contacts(auth_user_id,provider_contact_id,terms_version,consent_at,verified_at) values($1,'contactB','v1',now(),now()) returning id",[B])).id;
 const qb=(await q("insert into creator_domain_quotes(auth_user_id,hostname,action,years,total_cents,registrar_cents,currency,expires_at) values($1,'bob.test','register',1,1200,1000,'USD',now()+interval '1 hour') returning id",[B])).id;
 const ob=(await q("insert into creator_domain_orders(auth_user_id,quote_id,contact_id,terms_version,status,checkout_session_id,funded_event_id,paid_cents,funded_at) values($1,$2,$3,'v1','fulfilled','cs_B','evt_B',1200,now()-interval '1 hour') returning id",[B,qb,cb])).id;
 const eb={...evidence,hostname:'bob.test',registrant_contact_id:'contactB',registration_id:'regB',expires_at:new Date(Date.now()+86400000).toISOString()};
 await role('service_role');const rb=await record(eb,'record:B',B,B,ob);ok(rb.trial_expires_at,rb.domain_expires_at);
 await role('postgres');const ended=(await q("select private.creator_platform_access_at_v1($1,$1,'social',$2) r",[B,rb.domain_expires_at])).r;ok(ended.capabilities.advanced.allowed,false);ok(ended.capabilities.base_manage.allowed,true);
 for(const sql of ['delete from private.creator_domain_trial_receipts','truncate private.creator_domain_trial_events','update private.creator_domain_trial_events set payload=\'{}\'','update private.creator_domain_trial_receipts set cancelled_at=null'])await denied(()=>db.exec(sql),'42501');
 ok((await q("select count(*)::int n from managed_projects where slug='retained'")).n,1);ok((await q('select count(*)::int n from private.creator_domain_trial_receipts')).n,2);
 ok((await q("select count(*)::int n from pg_class where relnamespace='private'::regnamespace and relname like 'creator_domain_trial_%' and relkind='r' and relrowsecurity and relforcerowsecurity")).n,4);
 // Real Worker handlers and SQL RPC execution, with only Auth/network transport simulated.
 const {handlePlatformModuleAccess,requirePlatformModule,recordVerifiedDomainTrial}=await import('../../workers/mccluster/src/platform-module-access.js');
 const env={CREATOR_DOMAIN_TRIAL_ENABLED:'true',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only'};
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
 const fetchImpl=async(url,init)=>{
  if(url.endsWith('/auth/v1/user'))return json({id:A});
  const name=new URL(url).pathname.split('/').pop(),args=JSON.parse(init.body);
  const keys={creator_platform_access_v1:['p_user','p_org','p_app'],creator_platform_require_v1:['p_user','p_org','p_app','p_capability'],creator_domain_trial_cancel_v1:['p_owner','p_org','p_order','p_event'],creator_domain_trial_record_v1:['p_owner','p_org','p_order','p_event','p_evidence']}[name];
  assert.ok(keys,'unknown RPC');await role('service_role');
  try{return json((await q('select public.'+name+'('+keys.map((_,i)=>'$'+(i+1)).join(',')+') r',keys.map(k=>args[k]))).r);}catch(e){return json({code:e.code},400);}
 };
 const request=(path,body)=>new Request('https://site.invalid'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer fixture'},...(body?{body:JSON.stringify(body)}:{})});
 let response=await handlePlatformModuleAccess(request('/v2/platform/apps/social/access?org_id='+A),env,{fetchImpl});
 ok(response.status,200);const projected=await response.json();ok(projected.capabilities.base_manage.allowed,true);ok(projected.capabilities.advanced.allowed,false);ok(projected.domain.expires_at,receipt.domain_expires_at);ok(projected.hosting.allowed,null);
 ok((await handlePlatformModuleAccess(request('/v2/platform/apps/social/access?org_id='+B),env,{fetchImpl})).status,403);
 await assert.rejects(requirePlatformModule(env,A,A,'social','advanced',{fetchImpl}),e=>e.status===403);n++;
 response=await handlePlatformModuleAccess(request('/v2/platform/domain-trials/'+orderId+'/cancel',{org_id:A}),env,{fetchImpl});ok(response.status,200);ok((await response.json()).cancelled_at,cancelled.cancelled_at);
 const repeated=await recordVerifiedDomainTrial(env,{ownerId:A,orgId:A,orderId,eventId:'record:one'},{capabilities:{registrant_readback:true,charge_readback:true},readVerifiedRegistration:async()=>evidence},{fetchImpl});ok(repeated.cancelled_at,cancelled.cancelled_at);ok(repeated.trial_expires_at,receipt.trial_expires_at);
 console.log('PASS '+n+' domain trial SQL/Worker assertions; local PGlite only, no production changes');
}finally{await db.close();}
