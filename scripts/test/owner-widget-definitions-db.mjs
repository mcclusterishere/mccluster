import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,OWNER,OTHER} from './support/widget-definitions-db.mjs';
import {readFile} from 'node:fs/promises';
const config={version:1,widgets:{summary:{configured:false,capability:'fixture.read',kind:'subscription'}}};
const empty={version:1,widgets:{}};
test('SQL-backed owner journey, conflicts, denied roles and rollback',async t=>{
 const f=await fixture();t.after(()=>f.db.close());let s=await f.snapshot('fixture');
 assert.equal(s.revision,'0');assert.equal(s.value,null);assert.equal((await f.snapshot(null)).apps.length,3);
 await t.test('private save/reload and preview do not publish',async()=>{
  s=await f.edit(s,'save',config);assert.deepEqual((await f.snapshot('fixture')).draft.config,config);assert.equal(s.value,null);
  const p=await f.edit(s,'preview',config);assert.equal(p.grants_access,false);assert.equal(p.state,'unconfigured');assert.equal((await f.snapshot('fixture')).value,null);
 });
 await t.test('stale draft CAS refuses overwrite',async()=>{
  const old=s;s=await f.edit(s,'save',empty);await assert.rejects(f.edit(old,'save',config),e=>e.code==='40001');s=await f.edit(s,'save',config);
 });
 await t.test('publish preserves unrelated metadata and history',async()=>{
  s=await f.edit(s,'publish');assert.deepEqual(s.value,config);assert.equal(s.draft,null);assert.equal(s.history.length,1);
  await f.db.exec('reset role');assert.equal((await f.db.query("select settings->>'preserve' as p from platform_apps where app_key='fixture'")).rows[0].p,'unchanged');await f.db.exec('set role authenticated');
 });
 const first=s.history[0].id;
 await t.test('restore creates private draft before explicit publication',async()=>{
  s=await f.edit(s,'save',empty);s=await f.edit(s,'publish');assert.deepEqual(s.value,empty);
  s=await f.edit(s,'restore',null,first);assert.deepEqual(s.value,empty);assert.deepEqual(s.draft.config,config);
  s=await f.edit(s,'publish');assert.deepEqual(s.value,config);
  await assert.rejects(f.edit(await f.snapshot('other'),'restore',null,first),e=>e.code==='22023');
 });
 await t.test('activation, mappings, prices, malformed and prototype keys rejected',async()=>{
  for(const bad of [null,[],{version:2,widgets:{}},{version:1,widgets:{x:{configured:true}}},{version:1,widgets:{x:{configured:'false'}}},{version:1,widgets:{x:{configured:false,plans:{}}}},{version:1,widgets:{constructor:{configured:false}}},{version:1,widgets:{x:{configured:false,kind:null}}},{version:1,widgets:{x:{configured:false,capability:5}}}])await assert.rejects(f.edit(s,'save',bad),e=>e.code==='22023');
  await assert.rejects(f.edit(await f.snapshot('system'),'save',config),e=>e.code==='22023');
 });
 await t.test('legacy writes and ABA are detected, active existing policy protected',async()=>{
  s=await f.edit(s,'save',empty);await f.db.exec('reset role');
  await f.db.query("update platform_apps set settings=jsonb_set(settings,'{widget_access_v1}',$1) where app_key='fixture'",[empty]);
  await f.db.query("update platform_apps set settings=jsonb_set(settings,'{widget_access_v1}',$1) where app_key='fixture'",[config]);await f.db.exec('set role authenticated');
  await assert.rejects(f.edit(s,'publish'),e=>e.code==='40001');
  s=await f.snapshot('fixture');s=await f.edit(s,'save',empty);await f.db.exec('reset role');
  await f.db.query("update platform_apps set settings=jsonb_set(settings,'{widget_access_v1}',$1) where app_key='fixture'",[{version:1,widgets:{x:{configured:true}}}]);await f.db.exec('set role authenticated');
  s=await f.snapshot('fixture');s=await f.edit(s,'save',empty);await assert.rejects(f.edit(s,'publish'),e=>e.code==='22023');
 });
 await t.test('direct table access and nonowner RPC denied',async()=>{
  await assert.rejects(f.db.query('select * from owner_widget_drafts'),e=>e.code==='42501');
  await assert.rejects(f.db.query('delete from owner_widget_history'),e=>e.code==='42501');
  await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);await assert.rejects(f.snapshot(null),e=>e.code==='42501');await assert.rejects(f.edit(s,'save',empty),e=>e.code==='42501');
  await f.db.exec('set role anon');await assert.rejects(f.snapshot(null),e=>e.code==='42501');await f.db.exec('set role authenticated');await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[OWNER]);
 });
 await t.test('disabled house and removed owner membership fail closed',async()=>{
  await f.db.exec("reset role;update orgs set enabled=false;set role authenticated");await assert.rejects(f.snapshot(null),e=>e.code==='42501');
  await f.db.exec("reset role;update orgs set enabled=true;update org_members set role='viewer';set role authenticated");await assert.rejects(f.snapshot(null),e=>e.code==='42501');
  await f.db.exec("reset role;update org_members set role='owner';set role authenticated");
 });
 await t.test('rollback disables entrypoints and preserves data',async()=>{
  await f.db.exec('reset role');await f.db.exec(await readFile(new URL('../../supabase/pending/owner_widget_definitions_v1.rollback.sql',import.meta.url),'utf8'));await f.db.exec('set role authenticated');await assert.rejects(f.snapshot(null),e=>e.code==='42501');
  await f.db.exec('reset role');assert.ok((await f.db.query('select count(*)::int n from owner_widget_history')).rows[0].n>0);
 });
});
