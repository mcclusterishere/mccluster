/* Isolated SQL + Worker route + actual Core lease/build/completion. The REST adapter is a
   test double for PostgREST; no production services, secrets, telemetry or storage. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {handleLearning} from '../workers/mccluster/src/prim3/learning.js';
import {COURSE_STUDIO_SOURCES as sources} from '../core/src/course-studio/source-catalog.mjs';
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH?pathToFileURL(process.env.PGLITE_MODULE_PATH):'@electric-sql/pglite');
const db=new PGlite(), ROOT=new URL('../',import.meta.url), realFetch=globalThis.fetch;
const read=path=>readFile(new URL(path,ROOT),'utf8');
const org=randomUUID(),owner=randomUUID(),other=randomUUID(),guest=randomUUID();
const env={SUPABASE_URL:'https://study.invalid',SUPABASE_SERVICE_ROLE_KEY:'local-fixture',COURSE_STUDIO_ENABLED:'true'};
Object.assign(process.env,env,{SUPABASE_SECRET_KEY:'',MCCLUSTER_CORE_ID:'isolated-study-test'});
const {claimNext,completeJob}=await import('../core/src/supabase.mjs');
const {courseStudyBuild}=await import('../core/src/executors/course-study-build.mjs');
const {buildCompletionEvidence}=await import('../core/src/completion-evidence.mjs');
const ddl=await read('supabase/pending/learning_studio_v1.sql');
const rollback=await read('supabase/pending/learning_studio_v1.rollback.sql');
const oid=ident=>{assert.match(ident,/^[a-z_]+$/);return '"'+ident+'"';};
const urlFor=path=>'https://local.invalid/v1/prim3/learning/course-studio'+path;
const auth={requireHouseOwner:async req=>{
  const user=req.headers.get('authorization')?.replace('Bearer ','');
  if(!user)throw Object.assign(Error('Authentication required'),{status:401});
  if(user!==owner&&user!==other)throw Object.assign(Error('House owner required'),{status:403});
  return {id:user};
}};
async function api(path='',body,user=owner,overrides={}){
  const init={headers:{'content-type':'application/json',...(user?{authorization:'Bearer '+user}:{})}};
  if(body!==undefined){init.method='POST';init.body=JSON.stringify(body);}
  const result=await handleLearning(new Request(urlFor(path),init),{...env,...overrides},auth);
  assert.match(result.headers.get('cache-control'),/no-store/);return {status:result.status,...await result.json()};
}
let serviceCalls=0;
async function localRest(target,init={}){
  const url=new URL(target);
  assert.equal(url.origin,env.SUPABASE_URL); assert.ok(url.pathname.startsWith('/rest/v1/'));
  serviceCalls++;
  const route=url.pathname.slice('/rest/v1/'.length),body=init.body?JSON.parse(init.body):null;
  const query=(s,params=[])=>db.query(s,params);
  try{
    if(route.startsWith('rpc/')){
      const name=route.slice(4);assert.ok(['learning_studio_submit','learning_studio_finish','learning_studio_answer','learning_studio_retry'].includes(name));
      const names=Object.keys(body);
      const result=await query('select public.'+oid(name)+'('+names.map((k,i)=>oid(k)+'=> $'+(i+1)).join(',')+') as data',
        names.map(k=>k==='p_bundle'||k==='p_urls'?JSON.stringify(body[k]):body[k]));
      return Response.json(result.rows[0].data);
    }
    assert.ok(['orgs','ops_agent_jobs','learning_studio_courses','learning_studio_summary'].includes(route));
    const filters=[],params=[];const param=(v)=>{params.push(v);return '$'+params.length;};
    for(const [key,opValue] of url.searchParams){
      if(['order','limit','select'].includes(key))continue;
      const cut=opValue.indexOf('.'),op=opValue.slice(0,cut),val=opValue.slice(cut+1);
      const operator={eq:'=',lt:'<',lte:'<='}[op];assert.ok(operator);filters.push('t.'+oid(key)+operator+param(val));
    }
    const where=filters.length?' where '+filters.join(' and '):'';
    let sql;
    if(init.method==='PATCH'){
      assert.equal(route,'ops_agent_jobs');
      sql='update '+oid(route)+' t set '+Object.keys(body).map(k=>oid(k)+'='+param(k==='output'?JSON.stringify(body[k]):body[k])).join(',')+where+' returning t.*';
    }else{
      const selection=url.searchParams.get('select')||'*', join=selection.includes('job:ops_agent_jobs!inner(status)');
      const cols=selection.split(',').filter(k=>k!=='job:ops_agent_jobs!inner(status)').map(k=>k==='*'?'t.*':'t.'+oid(k)).join(',');
      sql='select '+cols+(join?",jsonb_build_object('status',j.status) as job":"")+' from '+oid(route)+' t'+(join?' join ops_agent_jobs j on j.id=t.job_id':'')+where;
      if(url.searchParams.has('limit'))sql+=' limit '+param(Number(url.searchParams.get('limit')));
    }
    return Response.json((await query(sql,params)).rows);
  }catch(e){if(!e.code)throw e;return Response.json({message:'Local database guard: '+e.code},{status:e.code==='23505'?409:400});}
}
try {
  const queueSql=await read('supabase/migrations/20260919053445_operational_ontology_v1.sql');
  const queue=queueSql.match(/create table if not exists public\.ops_agent_jobs \([\s\S]*?\n\);/i)[0];
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
    create table auth.users(id uuid primary key);create table orgs(id uuid primary key,slug text,enabled boolean);
    create table org_members(org_id uuid,profile_id uuid,role text);create table ops_objectives(id uuid primary key);`+queue);
  await db.query("insert into auth.users values ($1),($2),($3)",[owner,other,guest]);
  await db.query("insert into orgs values ($1,'mccluster',true)",[org]);
  await db.query("insert into org_members values ($1,$2,'owner'),($1,$3,'owner')",[org,owner,other]);
  await db.exec('grant select on orgs,org_members to service_role; grant all on ops_agent_jobs to service_role;');
  await db.exec(ddl);await db.exec(rollback);await db.exec(ddl);
  for(const role of ['anon','authenticated']){
    await db.exec('set role '+role);
    await assert.rejects(db.query('select * from learning_studio_courses'),/permission denied/i);
    await assert.rejects(db.query('select * from learning_studio_summary'),/permission denied/i);
    await assert.rejects(db.query('select learning_studio_retry($1,$2)',[owner,randomUUID()]),/permission denied/i);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  globalThis.fetch=localRest;
  assert.equal((await api('',undefined,null)).status,401);assert.equal((await api('',undefined,guest)).status,403);
  assert.equal((await api('',undefined,owner,{COURSE_STUDIO_ENABLED:'false'})).status,503);
  assert.equal(serviceCalls,0);
  const meta=await api();assert.equal(meta.cadence.exams_per_year,4);assert.equal(meta.cadence.badges_per_month,1);
  const data={school:'Example College',course_code:'MATH-X',title:'Example science seminar',term:'Sample term',request_id:randomUUID(),source_urls:sources.map(s=>s.url)};
  assert.equal((await api('',{...data,source_urls:['https://example.invalid/private']})).status,400);
  assert.equal((await api('',{...data,owner_id:other})).status,400);
  assert.equal((await api('',{...data,title:'x'.repeat(5000)})).status,413);
  const {id}=await api('',data);assert.match(id,/^[a-f0-9-]{36}$/i);assert.equal((await api('',data)).id,id);
  assert.equal((await api('',{...data,title:'another course'})).status,409);
  assert.deepEqual((await api('',undefined,other)).courses,[]);assert.equal((await api('/'+id,undefined,other)).status,404);
  assert.equal((await api('/'+id)).course.state,'queued');
  const job=await claimNext(['course_study_build']);assert.equal(job.target_id,id);assert.deepEqual(job.input,{});
  const raw=await courseStudyBuild(job,{fetchImpl:process.env.COURSE_TEST_PUBLIC_READING==='1'?realFetch:
    async url=>{const s=sources.find(s=>s.url===url);assert.ok(s); return new Response({algebra:'Linear Functions. Its average rate of change is constant. Point-slope form; slope-intercept form.',calculus:'Elementary derivative rules. Instantaneous rate of change. Constant multiple rule; sum rule; power functions.',chemistry:'Composition of an atom; gain or lose electrons; number of protons; different number of neutrons; carbon-13.'}[s.topic],{headers:{'content-type':'text/html'}});}});
  assert.equal((await api('/'+id)).bundle,null);
  const saved=(await db.query('select bundle from learning_studio_courses where id=$1',[id])).rows[0].bundle;
  assert.equal((await db.query('select learning_studio_finish($1,$2,$3,$4,$5) ok',[id,job.id,'stale-worker',job.attempts,JSON.stringify(saved)])).rows[0].ok,false);
  const observedFrozen=await courseStudyBuild(job,{fetchImpl:()=>{throw Error('must not fetch after fenced write');}});assert.deepEqual(observedFrozen,raw);
  const evidence=buildCompletionEvidence(job,raw,{startedAt:new Date().toISOString(),completedAt:new Date().toISOString(),workerId:'isolated-study-test'});
  await completeJob(job,evidence);
  const detail=await api('/'+id);assert.equal(detail.course.state,'ready');assert.equal(detail.bundle.rounds.length,4*sources.length);
  for(const r of detail.bundle.rounds){assert.ok(sources.some(s=>s.url===r.source));assert.ok(!('answer' in r)&&!('explanation' in r));}
  assert.equal((await api('/'+id+'/answers',{round:1,choice:0})).status,409);
  for(let round=0;round<saved.rounds.length;round++){
    const choice=saved.rounds[round].answer;const body={round,choice};
    assert.equal((await api('/'+id+'/answers',body,other)).status,404);
    assert.equal((await api('/'+id+'/answers',body)).status,200);
    assert.equal((await api('/'+id+'/answers',body)).status,200);
    assert.equal((await api('/'+id+'/answers',{round,choice:(choice+1)%4})).status,409);
  }
  const reopened=await api('/'+id);assert.equal(reopened.course.score,4*sources.length);assert.equal(reopened.answers.length,4*sources.length);
  assert.equal((await api()).courses[0].completed,4*sources.length);
  const queued=await api('',{...data,request_id:randomUUID()});const retryJob=await claimNext(['course_study_build']);
  await db.query("update ops_agent_jobs set status='failed' where id=$1",[retryJob.id]);
  assert.equal((await api('/'+queued.id+'/retry',{},other)).status,409);assert.equal((await api('/'+queued.id+'/retry',{})).status,200);
  const reclaimed=await claimNext(['course_study_build']);assert.equal(reclaimed.id,retryJob.id);assert.ok(reclaimed.attempts>retryJob.attempts);assert.notEqual(reclaimed.locked_by,retryJob.locked_by);
  await db.exec('reset role');
  const queueRecords=(await db.query('select * from ops_agent_jobs')).rows;
  for(const str of [...Object.values(data).filter(s=>typeof s==='string'),sources[0].url,owner]){
    assert.ok(!JSON.stringify(queueRecords).includes(str),'Course details must not flow into operations telemetry');
  }
  await assert.rejects(db.exec(rollback),/refusing destructive rollback/);await db.exec('rollback');
  console.log('PASS: two denied roles; SQL apply + empty rollback; owner route -> atomic queue -> real claim -> source-validated build -> fenced private save -> completion -> all scored rounds -> reload; IDOR, idempotency, stale-lease and retry guards. Reading: '+(process.env.COURSE_TEST_PUBLIC_READING==='1'?'official public chapters over HTTPS':'offline fixture')+'. No live OVH or production services.');
}finally{globalThis.fetch=realFetch;await db.close();}
