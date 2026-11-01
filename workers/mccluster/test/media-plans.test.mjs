import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePlans, handleReferences, planHash, validatePlan } from '../src/media/plans.js';

const ORG='123e4567-e89b-42d3-a456-426614174000', ID='223e4567-e89b-42d3-a456-426614174000';
const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only'};
const user={id:'323e4567-e89b-42d3-a456-426614174000'};
const plan=()=>({title:'Fixture episode',script:'Owner words\nsecond line',canon:'Draft direction',scenes:[{id:'one',title:'Arrival',prompt:'A quiet arrival',input:{duration:5},takes:[]}]});
const request=(method,tail='',body={})=>new Request('https://api.fixture.invalid/v1/media/plans'+tail+'?org_id='+ORG,{method,...(method==='GET'?{}:{body:JSON.stringify({org_id:ORG,client_id:ID,...body})})});
async function plane(fn,role='owner') {
  const original=globalThis.fetch, rows=new Map(), calls=[]; let race=false;
  globalThis.fetch=async (url,opt={})=>{
    const u=new URL(url), method=opt.method||'GET', body=opt.body&&JSON.parse(opt.body);calls.push({url:String(url),method,body});
    const json=(v,status=200)=>new Response(JSON.stringify(v),{status});
    if(u.pathname.endsWith('/org_members'))return json([{role,orgs:{id:ORG,name:'Fixture',kind:'studio',enabled:true}}]);
    if(!u.pathname.endsWith('/media_workflows'))return json([]);
    const key=(u.searchParams.get('id')||'').replace('eq.','');
    if(method==='POST'){rows.set(body.id,body);return json([body]);}
    if(method==='PATCH'){
      const row=rows.get(key);
      if(race || !row || 'eq.'+row.updated_at!==u.searchParams.get('updated_at') || 'eq.'+row.config.hash!==u.searchParams.get('config->>hash'))return json([]);
      rows.set(key,{...row,...body});return json([rows.get(key)]);
    }
    return json(key?(rows.has(key)?[rows.get(key)]:[]):[...rows.values()]);
  };
  try{await fn({rows,calls,race:()=>{race=true;}});}finally{globalThis.fetch=original;}
}
test('save/reload preserves owner text, revision identity and recoverable history; retry is idempotent',()=>plane(async({rows,calls})=>{
  const p=plan();const first=await handlePlans(request('POST','',{plan:p}),env,user);
  const again=await handlePlans(request('POST','',{plan:p}),env,user);assert.equal(again.saved.id,first.saved.id);assert.equal(rows.size,1);
  p.script+='\nOwner correction';const next=await handlePlans(request('PATCH','/'+ID,{plan:p,expected_revision:1,expected_hash:first.saved.hash}),env,user);
  assert.equal(next.saved.revision,2);assert.equal(next.saved.hash,await planHash(p));assert.equal(next.saved.history[0].plan.script,'Owner words\nsecond line');
  const loaded=await handlePlans(request('GET','/'+ID),env,user);assert.deepEqual(loaded.saved,next.saved);
  assert.ok(calls.every(c=>new URL(c.url).hostname==='fixture.invalid'));assert.ok(!calls.some(c=>/media_jobs|fal|site_content/.test(c.url)));
}));
test('stale revision and racing patch both fail without overwriting saved plan',()=>plane(async p=>{
  const first=await handlePlans(request('POST','',{plan:plan()}),env,user);
  await assert.rejects(handlePlans(request('PATCH','/'+ID,{plan:plan(),expected_revision:0,expected_hash:first.saved.hash}),env,user),e=>e.status===409);
  const edited=plan();edited.title='Edited';p.race();await assert.rejects(handlePlans(request('PATCH','/'+ID,{plan:edited,expected_revision:1,expected_hash:first.saved.hash}),env,user),e=>e.status===409);
  assert.equal(p.rows.get(ID).name,'Fixture episode');
}));
test('viewer cannot read, create or retain private references',()=>plane(async({calls})=>{
  for(const req of [request('GET'),request('POST','',{plan:plan()})])await assert.rejects(handlePlans(req,env,user),e=>e.status===403);
  await assert.rejects(handleReferences(new Request('https://api.fixture.invalid/v1/media/references?org_id='+ORG),env,user),e=>e.status===403);
  assert.ok(calls.every(c=>c.url.includes('org_members')));
},'viewer'));
test('unknown selected outputs and cross-project records are refused',()=>plane(async()=>{
  const p=plan();p.work_project_id=ID;await assert.rejects(handlePlans(request('POST','',{plan:p}),env,user),/Linked Work project/);
  delete p.work_project_id;p.scenes[0].selected_asset_id=ID;p.scenes[0].takes=[{job_id:ID,asset_id:ID}];await assert.rejects(handlePlans(request('POST','',{plan:p}),env,user),/not a completed output/);
}));
test('validation keeps unique scenes, bounded imports and real take selection',()=>{
  const p=plan();p.scenes.push({...p.scenes[0]});assert.throws(()=>validatePlan(p),/unique/);
  assert.throws(()=>validatePlan({...plan(),script:'x'.repeat(200001)}),/long/);
  const q=plan();q.scenes[0].status='selected';assert.throws(()=>validatePlan(q),/completed take/);
});
test('oversized request is refused before storage',()=>plane(async({calls})=>{
  await assert.rejects(handlePlans(new Request('https://api.fixture.invalid/v1/media/plans',{method:'POST',body:'x'.repeat(550001)}),env,user),e=>e.status===413);assert.equal(calls.length,0);
}));
