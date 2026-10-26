import test from 'node:test';
import assert from 'node:assert/strict';
import {handleWorldDirectory} from '../src/world-directory.js';
import {directoryFixture,A,B} from './support/world-directory-fixture.mjs';
const listing=(overrides={})=>({source_kind:'project',source_key:'alpha',entity_type:'service',title:'Audio mastering',description:'Mix and master songs',category:'music',online_only:false,location_label:'Chicago',service_area:'Illinois',is_listed:true,location_consent:true,...overrides});
test('tenant module off blocks direct listing and hides retained listings without changing membership',async()=>{
 const {call,tables,env}=directoryFixture();env.CUSTOMER_SITE_OFFER_ENABLED='true';tables.customer_site_modules=[];
 assert.equal((await call('/me','POST',listing(),'alice')).body.code,'module_disabled');
 tables.customer_site_modules.push({owner_user_id:A,source_kind:'project',source_key:'alpha',module_key:'world_discovery',enabled:true});
 assert.equal((await call('/me','POST',listing(),'alice')).status,200);assert.equal((await call()).body.items.length,1);
 tables.customer_site_modules[0].enabled=false;
 assert.equal((await call()).body.items.length,0);assert.equal((await call('/me','GET',null,'alice')).body.listings.length,1);
 assert.equal(tables.network_profiles[0].discoverable,true);assert.equal(tables.world_directory_listings.length,1);
 tables.customer_site_modules[0].enabled=true;tables.customer_site_modules[0].owner_user_id=B;assert.equal((await call()).body.items.length,0);
 delete tables.customer_site_modules;assert.equal((await call()).status,503);
});
test('public search filters real opt-in sources and preserves provenance without coordinates',async()=>{
 const {call}=directoryFixture();
 assert.equal((await call('/me','POST',listing(),'alice')).status,200);
 await call('/me','POST',listing({source_key:'beta',title:'Online design',category:'creative',online_only:true}),'bob');
 let r=await call('?q=audio&type=service&category=music&location=illinois&online=false');assert.equal(r.status,200);assert.equal(r.body.items.length,1);
 const item=r.body.items[0];assert.equal(item.href,'front.html?project=alpha');assert.match(item.provenance,/Owner-provided/);assert.equal(item.owner_user_id,undefined);assert.equal(item.lat,undefined);
 r=await call('?online=true');assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].location,'Online');assert.equal(r.body.items[0].service_area,'');
 assert.equal((await call('?q=missing')).body.items.length,0);
 assert.equal((await call('?type=event')).body.code,'unsupported_type');assert.equal((await call()).body.unavailable_types.length,2);
});
test('two owner isolation, consent, no arbitrary links or coordinates, duplicate recovery',async()=>{
 const {call}=directoryFixture();
 assert.equal((await call('/me')).status,401);
 assert.equal((await call('/me','POST',listing({source_key:'beta'}),'alice')).status,404);
 assert.equal((await call('/me','POST',listing({location_consent:false}),'alice')).status,400);
 for(const field of ['owner_user_id','lat','longitude','href'])assert.equal((await call('/me','POST',listing({[field]:'bad'}),'alice')).status,400);
 const a=await call('/me','POST',listing(),'alice');assert.equal(a.status,200);
 assert.equal((await call('/me','POST',listing(),'alice')).status,409);
 assert.equal((await call('/me','POST',listing({id:a.body.listing.id,source_key:'beta'}),'bob')).status,404);
 assert.equal((await call('/me','DELETE',{id:a.body.listing.id},'bob')).status,404);
 assert.equal((await call('/me','GET',null,'bob')).body.listings.length,0);
 assert.equal((await call('/me','POST',listing({id:a.body.listing.id,is_listed:false}),'alice')).status,200);
 assert.equal((await call()).body.items.length,0);
 assert.equal((await call('/me','DELETE',{id:a.body.listing.id},'alice')).status,200);
});
test('private/network profiles and unpublished/removed/reassigned sources disappear immediately',async()=>{
 const {call,tables}=directoryFixture();await call('/me','POST',listing(),'alice');
 for(const visibility of ['private','network',null]){tables.network_profiles[0].visibility=visibility;assert.equal((await call()).body.items.length,0);}
 tables.network_profiles[0].visibility='public';
 tables.network_profiles[0].discoverable=false;assert.equal((await call()).body.items.length,0);tables.network_profiles[0].discoverable=true;
 for(const [key,value] of [['published',null],['removed_at','2026-01-01'],['owner_user_id',B]]){const previous=tables.managed_projects[0][key];tables.managed_projects[0][key]=value;assert.equal((await call()).body.items.length,0);tables.managed_projects[0][key]=previous;}
 assert.equal((await call()).body.items.length,1);
});
test('missing schema is unavailable, not fake empty success; malformed filters are rejected',async()=>{
 const {call,tables}=directoryFixture();assert.equal((await call('?category=other%26owner_user_id%3Deq.foo')).status,400);
 delete tables.world_directory_listings;assert.equal((await call()).status,503);
});
