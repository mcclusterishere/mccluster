// Real PostgreSQL + PostgREST acceptance. Disposable Docker network with loopback-only HTTP.
// No production credentials, URLs, schema changes or learner records are accepted.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { adaptiveEventId } from '../workers/mccluster/src/prim3/adaptive-learning.js';
import { handleLearning } from '../workers/mccluster/src/prim3/learning.js';
const PG='postgres@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929';
const REST='postgrest/postgrest@sha256:0a46780309a604cdc8b56c776c6e5e15788ce58174d709e40459ab5a2d44d228';
const name=`prim3-proof-${process.pid}-${randomBytes(3).toString('hex')}`, pg=`${name}-pg`, rest=`${name}-rest`;
const dir=mkdtempSync(join(tmpdir(),'prim3-proof-')), originalFetch=globalThis.fetch;
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:120000}).trim();
const sql=q=>{const r=spawnSync('docker',['exec','-i',pg,'psql','-h','127.0.0.1','-U','postgres','-At','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+15000;while(Date.now()<end){try{if(await fn())return;}catch{}await pause(50);}throw Error(`Timed out: ${label}`);}
const owner=randomUUID(),other=randomUUID(),sid=randomUUID();
const secret=randomBytes(32).toString('hex');
function jwt(role,sub){const a=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),b=Buffer.from(JSON.stringify({role,sub,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return `${a}.${b}.${createHmac('sha256',secret).update(`${a}.${b}`).digest('base64url')}`;}
let origin,env,loseAck=false,failClose=false,requests=0;
const options={requireHouseOwner:async()=>({id:owner})};
const request=(method,path,body,settings=env,opts=options)=>handleLearning(new Request(`http://local.test/v1/prim3/learning${path}`,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),settings,opts);
const call=(method,path,body,settings,opts)=>request(method,`/adaptive${path}`,body,settings,opts);
async function ok(p){const r=await p,b=await r.json();assert.equal(r.status,200,JSON.stringify(b));return b;}
const event=(v,type,extra={})=>({id:randomUUID(),seq:v.flow.nextSeq,type,questionId:v.flow.question?.id??null,...extra});
const send=e=>call('POST',`/sessions/${sid}/events`,e);
const answer=v=>{const n=v.flow.question.prompt.match(/-?\d+/g).map(Number);return Math.abs(n[2]-n[0]);};
const count=()=>Number(sql(`select count(*) from learning_evidence_events where session_id='${sid}';`));
async function race(actions){
 const lock=spawn('docker',['exec','-i',pg,'psql','-h','127.0.0.1','-U','postgres','-At','-v','ON_ERROR_STOP=1']);
 let ready=false,errors='';lock.stdout.on('data',b=>{if(b.toString().includes('HELD'))ready=true;});lock.stderr.on('data',b=>{errors+=b;});
 const finished=new Promise((resolve,reject)=>{lock.on('error',reject);lock.on('close',code=>code===0?resolve():reject(Error(errors)));});
 lock.stdin.write(`begin; select id from learning_lab_sessions where id='${sid}' for update; select 'HELD';\n`);
 let pending;
 try {await until(()=>ready,'hold session row lock');pending=Promise.all(actions.map(send));
 await until(()=>Number(sql("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like 'WITH pgrst%';"))>=actions.length,'independent PostgREST connections blocked on PostgreSQL locks');
 } finally {lock.stdin.end('commit;\n');await finished;}
 return pending;
}
try {
 docker('network','create',name);
 docker('run','-d','--name',pg,'--network',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust',PG);
 await until(()=>docker('exec',pg,'pg_isready','-h','127.0.0.1','-U','postgres').includes('accepting'),'PostgreSQL ready');
 for(const file of ['supabase_api_roles.stub.sql','supabase_storage.stub.sql','learning_evidence.stub.sql'])sql(readFileSync(`supabase/tests/${file}`,'utf8'));
 sql(readFileSync('supabase/migrations/20261103182544_learning_evidence_v1.sql','utf8'));
 sql(`insert into auth.users(id) values('${owner}'),('${other}'); create role authenticator login noinherit; grant anon,authenticated,service_role to authenticator;`);
 writeFileSync(join(dir,'rest.env'),`PGRST_DB_URI=postgres://authenticator@${pg}:5432/postgres\nPGRST_DB_SCHEMAS=public\nPGRST_DB_ANON_ROLE=anon\nPGRST_JWT_SECRET=${secret}\n`,{mode:0o600});
 docker('run','-d','--name',rest,'--network',name,'-p','127.0.0.1::3000','--env-file',join(dir,'rest.env'),REST);
 origin=`http://${docker('port',rest,'3000/tcp')}`;
 assert.equal(new URL(origin).hostname,'127.0.0.1');
 await until(async()=>{const r=await originalFetch(origin);return r.ok;},'PostgREST ready');
 env={SUPABASE_URL:origin,SUPABASE_SERVICE_ROLE_KEY:jwt('service_role',owner),PRIM3_ADAPTIVE_ENABLED:'true',PRIM3_ADAPTIVE_SIGNING_KEY:randomBytes(32).toString('hex')};
 // Only adapt Supabase's path prefix and inject transport failures; every query
 // and write is executed by real PostgREST/PostgreSQL, including RLS/triggers.
 globalThis.fetch=async(url,init={})=>{const u=new URL(url);assert.equal(u.origin,origin);requests++;u.pathname=u.pathname.replace(/^\/rest\/v1\//,'/');
 if(failClose&&init.method==='PATCH'){failClose=false;return new Response('{}',{status:503});}
 const r=await originalFetch(u,init);if(loseAck&&init.method==='POST'&&u.pathname==='/learning_evidence_events'&&r.ok){loseAck=false;await r.text();throw Error('test: response lost after real commit');}return r;};
 const start={session_id:sid,template_id:'relay-distance-v1',review:{fictionChecked:true,geographyChecked:true}};
 assert.equal((await call('POST','/sessions',start,{...env,PRIM3_ADAPTIVE_ENABLED:undefined})).status,503);assert.equal(requests,0);
 assert.equal((await call('GET','',undefined,env,{requireHouseOwner:async()=>{throw Object.assign(Error('denied'),{status:403});}})).status,403);assert.equal(requests,0);
 const released=await Promise.all([ok(call('POST','/sessions',start)),ok(call('POST','/sessions',start))]);
 let v=released[0];assert.equal(count(),1);assert.equal(released[1].session_id,sid);
 v=await ok(send(event(v,'begin')));v=await ok(send(event(v,'handoff')));
 let e=event(v,'answer',{answer:answer(v)});
 let pair=await race([e,e]);assert.deepEqual(pair.map(r=>r.status),[200,200]);assert.equal(count(),4);console.log('PASS real lock contention: identical submissions commit one event');
 v=await ok(call('GET',`/sessions/${sid}`));e=event(v,'answer',{answer:answer(v)});
 pair=await race([e,{...e,id:randomUUID(),answer:999}]);assert.deepEqual(pair.map(r=>r.status).sort(),[200,409]);assert.equal(count(),5);console.log('PASS conflicting submissions: one winner, one conflict, no chain gap');
 v=await ok(call('GET',`/sessions/${sid}`));e=event(v,'answer',{answer:answer(v)});loseAck=true;
 v=await ok(send(e));await ok(send(e));assert.equal(count(),6);console.log('PASS lost commit acknowledgement + retry: one event');
 v=await ok(send(event(v,'hint')));v=await ok(send(event(v,'answer',{answer:answer(v)})));assert.equal(v.result.independent,false);
 e=event(v,'finish',{outcome:'completed'});failClose=true;assert.equal((await send(e)).status,503);
 v=await ok(send(e));assert.equal(v.flow.phase,'debrief');assert.equal(v.evidence.closed,true);assert.equal(v.flow.debrief.principlesCredit,false);assert.equal(count(),9);
 assert.equal(sql('select count(*) from learning_competency_ratings;'),'0');
 assert.equal(sql(`select last_event_seq from learning_lab_sessions where id='${sid}';`),'9');
 assert.equal(sql(`select count(*) from learning_evidence_events where session_id='${sid}' and event_hash <> learning_event_digest(prev_hash,session_id,seq,event_type,action_id,status,actor_role,payload,occurred_at);`),'0');
 console.log('PASS JSONB signed replay, hash chain, hinted answer and close-recovery debrief; no competency credit');
 assert.equal((await request('POST',`/sessions/${sid}/events`,{event_type:'note'})).status,409);
 assert.equal((await call('GET',`/sessions/${sid}`,undefined,env,{requireHouseOwner:async()=>({id:other})})).status,404);
 const rows=await originalFetch(`${origin}/learning_evidence_events?select=id`,{headers:{authorization:`Bearer ${jwt('authenticated',other)}`}});assert.equal(rows.status,200);assert.deepEqual(await rows.json(),[]);
 const ownRows=await originalFetch(`${origin}/learning_evidence_events?select=id`,{headers:{authorization:`Bearer ${jwt('authenticated',owner)}`}});assert.equal((await ownRows.json()).length,9);
 const patch=await originalFetch(`${origin}/learning_evidence_events?id=eq.${sql(`select id from learning_evidence_events where session_id='${sid}' order by seq limit 1;`)}`,{method:'PATCH',headers:{authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'content-type':'application/json'},body:JSON.stringify({payload:{forged:true}})});assert.equal(patch.ok,false);
 console.log('PASS actual database RLS, cross-user handler isolation, append-only guard and generic-route bypass rejection');
 const progress=await ok(call('GET','/progress'));
 assert.equal(progress.progress.next_level,v.flow.level);
 assert.equal(progress.progress.basis_session_id,sid);
 assert.equal(progress.progress.competency_credit,false);
 const followId=randomUUID();const follow=await ok(call('POST','/sessions',{...start,session_id:followId,initial_level:3}));
 assert.equal(follow.flow.level,progress.progress.next_level);
 assert.equal((await ok(call('GET',`/sessions/${followId}`))).flow.level,follow.flow.level);
 const foreign=await ok(call('GET','/progress',undefined,env,{requireHouseOwner:async()=>({id:other})}));
 assert.deepEqual(foreign.progress.recent,[]);
 console.log('PASS cross-session progression uses signed closed math evidence, ignores requested level and isolates users');
 // Authenticated learners can append self-reported evidence through existing RLS.
 // Even a plausible event ID/shape cannot manufacture server-validated math.
 const forgedSid=randomUUID();await ok(call('POST','/sessions',{...start,session_id:forgedSid}));
 const forged=await originalFetch(`${origin}/learning_evidence_events`,{method:'POST',headers:{authorization:`Bearer ${jwt('authenticated',owner)}`,'content-type':'application/json'},body:JSON.stringify({id:await adaptiveEventId(forgedSid,1),session_id:forgedSid,user_id:owner,seq:1,event_hash:'0'.repeat(64),event_type:'decision',payload:{version:'1.0.0',session_id:forgedSid,user_id:owner,type:'event',signature:'0'.repeat(64),result:{correct:true}}})});
 assert.equal(forged.ok,true);assert.equal((await call('GET',`/sessions/${forgedSid}`)).status,409);
 assert.equal((await call('GET',`/sessions/${sid}`,undefined,{...env,PRIM3_ADAPTIVE_SIGNING_KEY:'different-local-key-000000000000000000'})).status,409);
 assert.equal(sql('select count(*) from learning_competency_ratings;'),'0');
 console.log('PASS self-reported forged evidence and wrong signing key cannot become validated learning credit');
 console.log('PASS isolated PostgreSQL 17.6 + PostgREST 13.0.7 acceptance; no production interaction');
} finally {
 globalThis.fetch=originalFetch;
 for(const container of [rest,pg]){try{docker('rm','-f','-v',container);}catch{}}
 try{docker('network','rm',name);}catch{}
 rmSync(dir,{recursive:true,force:true});
}
