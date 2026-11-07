import assert from 'node:assert/strict';
import {freeSiteFixture,A,B,O} from '../../workers/mccluster/test/support/free-site-fixture.mjs';
import {handleManagedProjects} from '../../workers/mccluster/src/managed-projects.js';
import {handleCanonicalArtists,CANONICAL_ARTISTS} from '../../workers/mccluster/src/canonical-artists.js';
import {handleCustomerSiteModules} from '../../workers/mccluster/src/customer-site-modules.js';
import {handleCustomerSiteAddress} from '../../workers/mccluster/src/customer-site-addresses.js';
const f=await freeSiteFixture(),artist=Object.keys(CANONICAL_ARTISTS)[1];
const call=async(handler,path,body,who='alice',method=body?'POST':'GET')=>{const r=await handler(new Request('https://api.mccluster.org'+path,{method,headers:who?{authorization:'Bearer fixture-'+who}:{},body:body?JSON.stringify(body):undefined}),f.env,{fetchImpl:f.restFetch});return {status:r.status,data:await r.json()};};
try{
 for(const t of ['creator_domains','creator_billing_subscriptions','creator_site_media_state','music_creator_profiles','customer_social_deliveries'])assert.equal((await f.sql.query('select to_regclass($1) as t',[t])).rows[0].t,null);
 const create=await call(handleManagedProjects,'/v1/projects',{slug:'equity-fixture',name:'Equity Uprise'});assert.equal(create.status,201,JSON.stringify(create));const project=create.data.id;
 const prefix=f.env.SUPABASE_URL+'/storage/v1/object/public/front-media/'+A+'/projects/equity-fixture/';
 for(const config of [{words:{eyebrow:'Cinematic'}},{layout:'offers',offer_page:{title:'Our offers',intro:'Build together.',logo:prefix+'logo.png',cards:[{title:'Build',body:'An ordinary owned website',image:prefix+'offer.jpg'}]}}]){
  const published=await call(handleManagedProjects,'/v1/projects/equity-fixture/edit',{config,publish:true});assert.equal(published.status,200,JSON.stringify(published));
  assert.equal((await call(handleManagedProjects,'/v1/projects/equity-fixture',null,null)).status,200);
 }
 assert.equal((await call(handleManagedProjects,'/v1/projects/equity-fixture/edit',null,'bob')).status,404);
 assert.equal((await call(handleCustomerSiteModules,'/v1/customer-site/modules?project=equity-fixture',{module:'world',enabled:false})).status,200);
 assert.equal((await call(handleCustomerSiteAddress,'/v1/customer-site/address?project=equity-fixture',{slug:'equity-fixture'})).status,200);
 await f.sql.exec('set role service_role');for(const file of ['one','two'])await f.sql.query("select customer_site_storage_reserve_v1($1,'front-media',$2,250000000)",[A,A+'/projects/equity-fixture/'+file]);await assert.rejects(()=>f.sql.query("select customer_site_storage_reserve_v1($1,'front-media',$2,1)",[A,A+'/projects/equity-fixture/over']),/storage full/);await f.sql.exec('reset role');
 const resolve=()=>call(handleCanonicalArtists,'/v1/canonical-artists/resolve?id='+encodeURIComponent(artist),null,null);
 assert.equal((await resolve()).data.state,'unbound');
 assert.equal((await call(handleCanonicalArtists,'/v1/canonical-artists/grant',{artist_id:artist,owner_user_id:A,provenance:'Fixture reviewed ownership'})).status,403);
 assert.equal((await call(handleCanonicalArtists,'/v1/canonical-artists/grant',{artist_id:artist,owner_user_id:A,provenance:'Fixture reviewed ownership'},'operator')).status,200);
 assert.equal((await call(handleCanonicalArtists,'/v1/canonical-artists/bind',{artist_id:artist,project_id:project},'bob')).status,403);
 const owned=await call(handleManagedProjects,'/v1/projects',{slug:'foreign-fixture',name:'Equity Uprise'},'bob');
 assert.equal((await call(handleCanonicalArtists,'/v1/canonical-artists/bind',{artist_id:artist,project_id:owned.data.id})).status,403);
 for(let i=0;i<2;i++)assert.equal((await call(handleCanonicalArtists,'/v1/canonical-artists/bind',{artist_id:artist,project_id:project})).status,200);
 let resolved=await resolve();assert.equal(resolved.data.home,'front.html?project=equity-fixture');for(const key of ['owner_user_id','m_uid','project_id','provenance','draft'])assert.equal(resolved.data[key],undefined);
 await f.sql.query("update network_profiles set visibility='private' where m_uid=$1",[A]);assert.equal((await resolve()).status,404);await f.sql.query("update network_profiles set visibility='public' where m_uid=$1",[A]);
 await f.sql.query('update m_auth_user_links set is_primary=false where auth_user_id=$1',[A]);assert.equal((await resolve()).status,404);await f.sql.query('update m_auth_user_links set is_primary=true where auth_user_id=$1',[A]);
 await assert.rejects(()=>f.sql.query('update managed_projects set owner_user_id=$1 where id=$2',[B,project]),/identity is immutable/);
 assert.equal((await call(handleCanonicalArtists,'/v1/canonical-artists/revoke',{artist_id:artist,provenance:'Fixture reviewed withdrawal'},'operator')).status,200);assert.equal((await resolve()).status,404);
 assert.equal((await f.sql.query('select count(*)::int n from canonical_artist_binding_events')).rows[0].n,3);
 await f.sql.exec('set role authenticated');await assert.rejects(()=>f.sql.query('select * from canonical_artist_bindings'),/permission denied/);await assert.rejects(()=>f.sql.query("select canonical_artist_binding_v1('grant',$1,$2,$3,null,'forged authority')",[artist,O,B]),/permission denied/);await f.sql.exec('reset role');
 console.log('PASS: minimal free schema create/edit/publish/private read/modules/address/quota; canonical grant/bind/revoke SQL authority, owner isolation, no name privilege, immutable identity, privacy and audit provenance. No paid/provider/Studio schema or live data.');
}finally{await f.close();}
