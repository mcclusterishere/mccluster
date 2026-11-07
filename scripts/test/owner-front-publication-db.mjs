// Isolated PostgreSQL semantics via PGlite; no production credentials/network.
// PGLITE_DIR=/path/to/node_modules node --test scripts/test/owner-front-publication-db.mjs
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { ownerFrontFixture as fixture, owner, other } from './support/owner-front-db.mjs';
const config = () => ({scenes:{doors:true,vaunt:true,night:true,world:true},scroll:{duration:0.85,touchLerp:0.14},
  vr:{enabled:true,hold:true,band:[0.4,0.5],yaw:-140,pitch:-32,spots:[{yaw:0,pitch:0,label:'Home',href:'hire.html',blank:false,urgent:false}]},
  night:{arrive:0.74},start:'cabin',song:'antisocial',visible:true,
  media:{hero:null,scene1:null,scene2:null,night:null,cabin:null,sound:null,still:null}});

const snap = async db => (await db.query('select public.owner_front_snapshot_v1() as data')).rows[0].data;
const publish = async (db, rev, value) => (await db.query('select public.owner_front_publish_v1($1,$2::jsonb) as data',[rev,value===null?null:JSON.stringify(value)])).rows[0].data;

test('publish, history preview read, reset and restore retain identity and append audited revisions', async () => {
  const db=await fixture();try{
    assert.equal((await snap(db)).revision,'0');
    const first=await publish(db,'0',config());
    assert.equal(first.history.length,1);assert.equal(first.history[0].via,'control-front-publication/v1');
    const originalId=(await db.query("select id from site_content where slot='@front'")).rows[0].id;
    const next=config();next.song='here';
    const second=await publish(db,first.revision,next);
    assert.equal((await db.query("select id from site_content where slot='@front'")).rows[0].id,originalId);
    assert.equal(second.history.length,2);
    const before=JSON.stringify(await snap(db)); await snap(db); assert.equal(JSON.stringify(await snap(db)),before,'reading history never restores');
    const reset=await publish(db,second.revision,null);assert.equal(reset.value,null);assert.equal(reset.history[0].value,null);
    const restored=await publish(db,reset.revision,JSON.parse(first.history[0].value));
    assert.equal(restored.history.length,4);assert.equal(JSON.parse(restored.value).song,'antisocial');
    assert.equal(restored.history[3].id,first.revision,'history is not rewritten');
  }finally{await db.close();}
});

test('stale writes, repeat requests and legacy set/delete ABA cannot overwrite newer content',async()=>{
  const db=await fixture();try{
    const first=await publish(db,'0',config());
    await assert.rejects(publish(db,'0',config()),e=>e.code==='40001');
    await db.query("select site_content_set('index.html','@front',$1)",[JSON.stringify({...config(),song:'here'})]);
    await assert.rejects(publish(db,first.revision,null),e=>e.code==='40001');
    await db.exec("select site_content_revert('index.html','@front')");
    await assert.rejects(publish(db,'0',config()),e=>e.code==='40001','deleted row is not the original version zero');
    assert.equal((await snap(db)).value,null);
    await assert.rejects(publish(db,null,config()),e=>e.code==='40001');
  }finally{await db.close();}
});

test('anonymous, nonowner and null-identity calls cannot read private history or publish',async()=>{
  const db=await fixture();try{
    await publish(db,'0',config());
    await db.exec(`select set_config('request.jwt.claim.sub','${other}',false)`);
    await assert.rejects(snap(db),e=>e.code==='42501');
    await assert.rejects(publish(db,'1',config()),e=>e.code==='42501');
    assert.equal((await db.query('select * from site_content_history')).rows.length,0);
    await db.exec("select set_config('request.jwt.claim.sub','',false)");
    await assert.rejects(snap(db),e=>e.code==='42501');
    await db.exec('reset role; set role anon');
    await assert.rejects(snap(db),e=>e.code==='42501');
    await assert.rejects(publish(db,'1',config()),e=>e.code==='42501');
  }finally{await db.close();}
});

test('server rejects malformed, unsafe, oversized or unsupported settings without writing history',async()=>{
  const db=await fixture();try{
    const cases=[()=>[],()=>({}),v=>({...v,visible:'yes'}),v=>({...v,song:'unknown'}),v=>({...v,start:null}),
      v=>({...v,extra:true}),v=>({...v,scroll:{...v.scroll,duration:99}}),v=>({...v,vr:{...v.vr,band:[0.4,0.41]}}),
      v=>({...v,vr:{...v.vr,spots:[]}}),v=>({...v,vr:{...v.vr,spots:[{...v.vr.spots[0],href:'javascript:alert(1)'}]}}),
      v=>({...v,vr:{...v.vr,spots:[{...v.vr.spots[0],href:'//evil.test'}]}}),
      v=>({...v,vr:{...v.vr,spots:[{...v.vr.spots[0],label:'x'.repeat(22000)}]}}),
      v=>({...v,media:{sound:{src:'https://example.com/file'}}})];
    for(const alter of cases) await assert.rejects(publish(db,'0',alter(config())),e=>e.code==='22023');
    assert.equal((await snap(db)).revision,'0');
  }finally{await db.close();}
});

test('history is bounded and scoped, and pending proposal can be reapplied',async()=>{
  const db=await fixture();try{
    for(let i=0;i<28;i++)await db.query("select site_content_set('index.html','@front',$1)",[JSON.stringify(config())]);
    await db.exec("select site_content_set('other.html','private','unrelated')");
    const data=await snap(db);assert.equal(data.history.length,25);assert.equal(data.revision,'28');
    assert.ok(data.history.every(x=>x.value!=='unrelated'));
    await db.exec('reset role');await db.exec(await readFile(new URL('../../supabase/pending/owner_front_publication_v1.sql',import.meta.url),'utf8'));
    await db.exec('set role authenticated');assert.equal((await snap(db)).revision,'28');
  }finally{await db.close();}
});

test('the existing page renderer and shared song list produce publishable house settings',async()=>{
  const db=await fixture();try{
    const main=await readFile(new URL('../../js/main.js',import.meta.url),'utf8');
    const start=main.indexOf('  var FRONT_DEFAULT = {'),end=main.indexOf("  /* AN ACCOUNT'S OWN FRONT PAGE (front.html");
    assert.ok(start>0&&end>start);
    const ctx={};vm.runInNewContext(main.slice(start,end)+'\nthis.frontConfig=frontConfig;this.songs=FRONT_SONGS;',ctx);
    let revision='0';
    for(const song of ctx.songs){
      const value=ctx.frontConfig({song});
      const result=await publish(db,revision,value);revision=result.revision;
      assert.deepEqual(JSON.parse(result.value),JSON.parse(JSON.stringify(value)));
    }
  }finally{await db.close();}
});

const saveDraft=async(db,revision,base,value)=>(await db.query('select owner_front_draft_save_v1($1,$2,$3::jsonb) as data',[revision,base,value===null?null:JSON.stringify(value)])).rows[0].data;
const discardDraft=(db,revision)=>db.query('select owner_front_draft_discard_v1($1)',[revision]);
test('private drafts persist, reject stale versions and cannot be read through table grants',async()=>{
 const db=await fixture();try{
  const draft=await saveDraft(db,null,'0',config());
  assert.equal((await snap(db)).revision,'0');assert.equal((await snap(db)).draft.revision,draft.revision);
  assert.equal((await db.query('select * from site_content')).rows.length,0);
  await assert.rejects(db.query('select * from owner_front_drafts'),e=>e.code==='42501');
  await assert.rejects(saveDraft(db,null,'0',config()),e=>e.code==='40001');
  const next=await saveDraft(db,draft.revision,'0',{...config(),song:'here'});
  await assert.rejects(discardDraft(db,draft.revision),e=>e.code==='40001');
  await discardDraft(db,next.revision);const recreated=await saveDraft(db,null,'0',config());
  assert.notEqual(recreated.revision,draft.revision);
  await assert.rejects(saveDraft(db,draft.revision,'0',config()),e=>e.code==='40001');
  await db.exec(`select set_config('request.jwt.claim.sub','${other}',false)`);
  await assert.rejects(saveDraft(db,null,'0',config()),e=>e.code==='42501');
  await assert.rejects(discardDraft(db,recreated.revision),e=>e.code==='42501');
 }finally{await db.close();}
});
test('publish removes only its matching saved draft and failed publication preserves private work',async()=>{
 const db=await fixture();try{
  const draft=await saveDraft(db,null,'0',config());
  await assert.rejects(publish(db,'99',config()),e=>e.code==='40001');
  assert.equal((await snap(db)).draft.revision,draft.revision);
  const published=await publish(db,'0',{...config(),song:'here'});
  assert.equal(published.draft.revision,draft.revision,'different draft survives another tab publication');
  const updated=await saveDraft(db,draft.revision,published.revision,config());
  const done=await publish(db,published.revision,config());assert.equal(done.draft,null);
  await assert.rejects(discardDraft(db,updated.revision),e=>e.code==='40001');
 }finally{await db.close();}
});

test('disk restart and rollback/reapply preserve private drafts, published content and history',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const directory=await mkdtemp(join(tmpdir(),'owner-front-db-'));let db;
 try{
  db=await fixture({dataDir:directory});const live=await publish(db,'0',config());
  const draft=await saveDraft(db,null,live.revision,{...config(),song:'here'});
  await db.close();db=await fixture({dataDir:directory});assert.equal((await snap(db)).draft.revision,draft.revision);
  await db.exec('reset role');await db.exec(await readFile(new URL('../../supabase/pending/owner_front_publication_v1.rollback.sql',import.meta.url),'utf8'));
  await assert.rejects(snap(db),e=>e.code==='42883');
  assert.equal((await db.query("select value from site_content where slot='@front'")).rows[0].value,live.value);
  assert.equal((await db.query('select count(*)::int as n from site_content_history')).rows[0].n,1);
  await db.exec(await readFile(new URL('../../supabase/pending/owner_front_publication_v1.sql',import.meta.url),'utf8'));
  await db.exec('set role authenticated');const restored=await snap(db);
  assert.equal(restored.draft.revision,draft.revision);assert.equal(restored.revision,live.revision);
 }finally{if(db)await db.close();await rm(directory,{recursive:true,force:true});}
});

test('observed production M-account authorization rejects missing and nonowner primary links',async()=>{
 const db=await fixture();try{
  await db.exec(`reset role;
   alter table auth.users add column email text;
   update auth.users set email=case when id='${owner}' then 'matthew@mccluster.org' else 'member@fixture.invalid' end;
   create table public.m_auth_user_links(auth_user_id uuid,m_uid uuid,is_primary boolean);
   insert into m_auth_user_links values ('${owner}','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true),('${other}','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
   create or replace function public.current_m_uid() returns uuid language sql stable security definer set search_path=public as $$select m_uid from public.m_auth_user_links where auth_user_id=auth.uid() and is_primary=true limit 1$$;
   create or replace function public.mnet_admin_m_uids() returns setof uuid language sql stable security definer set search_path=public,auth as $$select l.m_uid from public.m_auth_user_links l join auth.users u on u.id=l.auth_user_id where l.is_primary=true and lower(coalesce(u.email,''))='matthew@mccluster.org'$$;
   create or replace function public.mnet_is_admin() returns boolean language sql stable security definer set search_path=public,auth as $$select exists(select 1 from public.mnet_admin_m_uids() a where a=public.current_m_uid())$$;
   set role authenticated;`);
  assert.equal((await snap(db)).revision,'0');
  await db.exec(`select set_config('request.jwt.claim.sub','${other}',false)`);await assert.rejects(snap(db),e=>e.code==='42501');
  await db.exec(`reset role; update m_auth_user_links set is_primary=false where auth_user_id='${owner}'; set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false)`);
  await assert.rejects(snap(db),e=>e.code==='42501');await assert.rejects(saveDraft(db,null,'0',config()),e=>e.code==='42501');
 }finally{await db.close();}
});
