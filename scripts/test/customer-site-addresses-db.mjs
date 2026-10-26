// Four synthetic pilot tenants. No production namespace, ownership or DNS assertion.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {projectTilesFixture,A,B} from '../../workers/mccluster/test/support/project-tiles-fixture.mjs';
import {handleCustomerSiteAddress,customerSiteAddressResponse} from '../../workers/mccluster/src/customer-site-addresses.js';
import {handleManagedProjects} from '../../workers/mccluster/src/managed-projects.js';
const f=await projectTilesFixture();
try{
 await f.sql.exec(await readFile('supabase/pending/customer_site_addresses_v1.sql','utf8'));f.env.CUSTOMER_SITE_OFFER_ENABLED='true';
 const pilots=[['Equity Uprise','equity-uprise-fixture',A],['Whip Equipped','whip-equipped-fixture',B],['Zone Five Fitness','zone-five-fitness-fixture','44444444-4444-4444-8444-444444444444'],['Benji Chase','benji-chase-fixture','55555555-5555-4555-8555-555555555555']];
 for(const [name,slug,id]of pilots){
  if(![A,B].includes(id)){await f.sql.query('insert into auth.users values($1)',[id]);await f.sql.query('insert into m_people(id) values($1)',[id]);await f.sql.query('insert into m_auth_user_links values($1,$1,true)',[id]);await f.sql.query("insert into network_profiles values($1,'public')",[id]);}
  await f.sql.query("insert into managed_projects(slug,owner_user_id,m_uid,name,published,published_at) values($1,$2,$2,$3,'{}',now())",[slug,id,name]);
  f.db.actor=async()=>({auth_uid:id,m_uid:id});
  const req=new Request('https://api.mccluster.org/v1/customer-site/address?project='+slug,{method:'POST',body:JSON.stringify({slug})});
  const assigned=await handleCustomerSiteAddress(req,f.env,{db:f.db});assert.equal(assigned.status,200,await assigned.clone().text());assert.equal((await assigned.json()).address.url,'https://mccluster.org/'+slug);
  const options={db:f.db,projectPublic:(r,e,d)=>handleManagedProjects(r,e,{...d,fetchImpl:f.restFetch})};
  const site=await customerSiteAddressResponse(new Request('https://mccluster.org/'+slug),f.env,async()=>new Response('<html><head></head><body>Existing renderer</body></html>'),options);assert.equal(site.status,200);assert.match(await site.text(),new RegExp('"project":"'+slug+'"'));
  const www=await customerSiteAddressResponse(new Request('https://www.mccluster.org/'+slug),f.env,undefined,options);assert.equal(www.headers.get('location'),'https://mccluster.org/'+slug);
  await f.sql.query("update network_profiles set visibility='private' where m_uid=$1",[id]);assert.equal((await customerSiteAddressResponse(new Request('https://mccluster.org/'+slug),f.env,undefined,options)).status,404);await f.sql.query("update network_profiles set visibility='public' where m_uid=$1",[id]);
 }
 await assert.rejects(()=>f.db.rpc('customer_site_address_assign_v1',{p_user:B,p_actor:B,p_kind:'project',p_key:'equity-uprise-fixture',p_slug:'steal-fixture'}),/website unavailable/);
 await assert.rejects(()=>f.db.rpc('customer_site_address_assign_v1',{p_user:B,p_actor:B,p_kind:'project',p_key:'beta',p_slug:'equity-uprise-fixture'}),/already assigned/);
 await f.sql.exec('set role authenticated');await assert.rejects(()=>f.sql.query('select * from customer_site_addresses'),/permission denied/);await f.sql.exec('reset role');
 for(const path of ['/','/company','/news','/assets','/auth','/v1','/index.html'])assert.equal(await customerSiteAddressResponse(new Request('https://mccluster.org'+path),f.env,undefined,{db:f.db}),null);
 assert.equal(await customerSiteAddressResponse(new Request('https://mccluster.org/unassigned-fixture'),f.env,undefined,{db:f.db}),null);
 console.log('PASS: four fixture identities, immutable free aliases, private/unauthorized reads, ownership/namespace collision, WWW and protected/legacy routes. No real tenant/domain state created.');
}finally{await f.close();}
