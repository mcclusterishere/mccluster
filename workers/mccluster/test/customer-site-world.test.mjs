import test from 'node:test';import assert from 'node:assert/strict';import {handleCustomerSiteWorld} from '../src/customer-site-world.js';
test('World tenant data requires published owned site and enabled module; queries only explicit public project updates',async()=>{
 let enabled=false,published=true;const calls=[];
 const db={select:async(t,f)=>{calls.push({t,f});if(t==='managed_projects')return[{slug:'alpha',owner_user_id:'alice',m_uid:'alice-person',name:'Alpha'}];if(t==='customer_site_modules')return[{enabled}];if(t==='network_posts')return[{id:'post1',body:'An update',created_at:'2026-10-26'}];throw Error('Unexpected table');}};
 const call=async()=>{const r=await handleCustomerSiteWorld(new Request('https://api.mccluster.org/v1/customer-site/world?project=alpha'),{CUSTOMER_SITE_OFFER_ENABLED:'true'},{db,projectPublic:async()=>new Response('{}',{status:published?200:404})});return{status:r.status,data:await r.json()};};
 assert.equal((await call()).status,403);assert.equal(calls.some(c=>c.t==='network_posts'),false);
 enabled=true;assert.equal((await call()).status,200);const filters=calls.find(c=>c.t==='network_posts').f;assert.equal(filters.author_m_uid,'eq.alice-person');assert.equal(filters['metadata->>site_project'],'eq.alpha');for(const k of ['deleted_at','removed_at','reply_to_id','group_id'])assert.equal(filters[k],'is.null');assert.equal(filters.visibility,'eq.public');
 published=false;assert.equal((await call()).status,404);
});
