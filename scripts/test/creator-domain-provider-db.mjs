// Real pending SQL/leases + Worker; provider/DNS are deterministic intercepts.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {freeSiteFixture,A,B} from '../../workers/mccluster/test/support/free-site-fixture.mjs';
import {handleCreatorDomains} from '../../workers/mccluster/src/creator-domains.js';
import {handleCreatorDomainHost} from '../../workers/mccluster/src/creator-domain-host.js';
const f=await freeSiteFixture(),PID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
try{
 for(const name of ['creator_domains_v1.sql','creator_domain_targets_v1.sql','creator_domain_provider_bindings_v1.sql'])await f.sql.exec(await readFile('supabase/pending/'+name,'utf8'));
 await f.sql.query("insert into managed_projects(slug,owner_user_id,m_uid,name,published,published_at) values('domain-fixture',$1,$1,'Domain fixture','{}',now())",[A]);
 const project=(await f.sql.query('select id from managed_projects')).rows[0].id;
 const env={...f.env,CREATOR_DOMAINS_ENABLED:'true',CREATOR_DOMAINS_ZONE_ID:'fixture-zone',CREATOR_DOMAINS_API_TOKEN:'fixture',CREATOR_DOMAINS_CNAME:'sites.mccluster.org'};
 let provider=null,creates=0,deletes=0,mode='',row,release,entered,providerCalls=0;
 const read=async()=>row=(await f.sql.query('select * from creator_domains')).rows[0];
 const fetchImpl=async(input,init={})=>{
  const u=new URL(input),method=init.method||'GET';
  if(u.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:u.searchParams.get('type')==='TXT'?16:5,data:u.searchParams.get('type')==='TXT'?row.verification_token:'sites.mccluster.org.'}]});
  if(u.hostname==='api.cloudflare.com'){
   providerCalls++;
   if(method==='POST'){
    creates++;const body=JSON.parse(init.body);assert.equal(body.custom_metadata,undefined);provider={id:PID,hostname:body.hostname,status:'active',ssl:{status:'active'}};
    if(mode==='lost')throw Error('Synthetic response loss');
    if(mode==='hold'){entered();await new Promise(r=>release=r);}
    if(mode==='removed')await f.sql.query("update managed_projects set published=null,published_at=null,removed_at=now() where id=$1",[project]);
    return Response.json({success:true,result:mode==='malformed'?{hostname:body.hostname}:provider});
   }
   if(method==='DELETE'){deletes++;provider=null;return Response.json({success:true,result:null});}
   if(u.searchParams.has('hostname.exact')){assert.equal(u.searchParams.get('per_page'),'5');assert.equal(u.searchParams.get('hostname.exact'),row.hostname);return Response.json({success:true,result:provider?[provider]:[]});}
   if(!provider)return Response.json({success:false},{status:404});
   return Response.json({success:true,result:mode==='wrong-host'?{...provider,hostname:'www.someone-else.org'}:provider});
  }
  if(mode==='persist-fails'&&u.pathname.endsWith('/update_creator_domain_v2')&&JSON.parse(init.body).changes.provider_id)return Response.json({code:'XX000'},{status:503});
  if(mode==='persist-response-lost'&&u.pathname.endsWith('/update_creator_domain_v2')&&JSON.parse(init.body).changes.provider_id){await f.restFetch(input,init);return Response.json({code:'XX000'},{status:503});}
  return f.restFetch(input,init);
 };
 const call=async(path='',method='GET',body,who='alice',settings=env)=>{const r=await handleCreatorDomains(new Request('https://api.mccluster.org/v1/creator-domains'+path,{method,headers:{authorization:'Bearer fixture-'+who},body:body?JSON.stringify(body):undefined}),settings,{fetchImpl,authorizeEntitlement:async()=>true});return {status:r.status,body:await r.json()};};
 async function setup(next=''){
  await f.sql.exec('delete from creator_domains');await f.sql.query('update managed_projects set removed_at=null,published=\'{}\',published_at=now() where id=$1',[project]);provider=null;creates=0;deletes=0;providerCalls=0;mode=next;release=null;
  const r=await call('','POST',{hostname:'www.customer.org',target:{type:'managed_project',id:project,slug:'domain-fixture'}});assert.equal(r.status,201,JSON.stringify(r));await read();
 }
 const verify=()=>call('/'+row.id+'/verify','POST');
 await setup();assert.equal((await verify()).status,200);await read();assert.equal(row.provider_state,'bound');assert.equal(row.provider_zone_id,env.CREATOR_DOMAINS_ZONE_ID);assert.equal(row.status,'active');assert.equal(creates,1);
 assert.equal((await verify()).status,200);assert.equal(creates,1);
 const host=async settings=>handleCreatorDomainHost(new Request('https://www.customer.org/v1/projects/domain-fixture'),settings||env,{fetchImpl,authorizeEntitlement:async()=>true,projectPublic:async()=>Response.json({ok:true,config:{}})});
 assert.equal((await host()).status,200);const before=providerCalls;assert.equal((await host({...env,CREATOR_DOMAINS_ZONE_ID:'different-zone'})).status,404);assert.equal(providerCalls,before);
 await f.sql.query("update creator_domains set last_checked_at=now()-interval '25 hours'");assert.equal((await host()).status,404);assert.equal((await verify()).status,200);
 assert.equal((await call('/'+row.id,'DELETE',null,'bob')).status,404);
 mode='wrong-host';assert.equal((await call('/'+row.id,'DELETE')).status,409);assert.equal(deletes,0);await read();assert.equal(row.status,'detached');assert.equal(row.provider_state,'reconciliation_required');
 for(const kind of ['lost','malformed','persist-fails']){
  await setup(kind);assert.equal((await verify()).status,409,kind);await read();assert.equal(row.provider_state,'reconciliation_required',kind);assert.equal(row.provider_id,null,kind);mode='';
  assert.equal((await verify()).status,409);assert.equal((await call('/'+row.id,'DELETE')).status,409);assert.equal(creates,1);assert.equal(deletes,0);assert.ok(await read());
 }
 await setup();provider={id:PID,hostname:'www.customer.org',custom_metadata:{creator_domain_id:row.id}};assert.equal((await verify()).status,409);assert.equal(creates,0);assert.equal(deletes,0);await read();assert.equal(row.provider_state,'reconciliation_required');
 await setup('persist-response-lost');assert.equal((await verify()).status,503);await read();assert.equal(row.provider_state,'bound');assert.equal(row.provider_id,PID);mode='';assert.equal((await verify()).status,200);assert.equal(creates,1);
 await setup('removed');assert.equal((await verify()).status,409);await read();assert.equal(row.provider_id,PID);assert.equal(row.provider_state,'bound');assert.notEqual(row.status,'active');
 await setup();assert.equal((await verify()).status,200);await read();provider=null;assert.equal((await call('/'+row.id,'DELETE')).status,200);assert.equal(deletes,0);assert.equal(await read(),undefined);
 await setup();assert.equal((await verify()).status,200);await read();assert.equal((await call('/'+row.id,'DELETE',null,'alice',{...env,CREATOR_DOMAINS_ZONE_ID:'other-zone'})).status,409);assert.equal(deletes,0);
 await setup('hold');const reached=new Promise(r=>entered=r),pending=verify();await reached;
 assert.equal((await verify()).status,409);assert.equal((await call('/'+row.id,'DELETE')).status,409);
 const oldToken=(await read()).operation_id;await f.sql.query("update creator_domains set lease_until=now()-interval '1 second'");
 assert.equal((await verify()).status,409);release();assert.equal((await pending).status,409);await read();assert.equal(row.provider_state,'reconciliation_required');assert.equal(row.provider_id,null);assert.equal(creates,1);
 await assert.rejects(()=>f.sql.query("select update_creator_domain_v2($1,$2,$3,'{\"status\":\"active\"}',true,false)",[row.id,A,oldToken]),/operation changed/);
 // Unresolved detached claims cannot free a verified name for another owner.
 await call('/'+row.id,'DELETE');await f.sql.query("insert into creator_domains(auth_user_id,handle,hostname,verification_token,target_type,target_id) values($1,'foreign','www.customer.org','other','member_front',$1)",[B]);
 await assert.rejects(()=>f.sql.query('select claim_creator_domain_v2((select id from creator_domains where auth_user_id=$1),$1,$2,true)',[B,crypto.randomUUID()]),/duplicate key/);
 await f.sql.exec('set role authenticated');await assert.rejects(()=>f.sql.query('select claim_creator_domain_v2($1,$2,$3,true)',[row.id,A,crypto.randomUUID()]),/permission denied/);await f.sql.exec('reset role');
 console.log('PASS: provider create without metadata; exact-list minimum; durable lost/malformed/persistence-failure reconciliation; no unknown adoption/delete; zone/host readback, freshness, removed target, known404 cleanup; concurrent and expired lease fencing; reserved hostname and RLS. No live provider calls.');
}finally{await f.close();}
