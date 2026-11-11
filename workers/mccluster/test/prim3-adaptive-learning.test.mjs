import test from 'node:test';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { handleLearning } from '../src/prim3/learning.js';
import { evidenceDb } from './support/adaptive-evidence-db.mjs';
const OWNER='00000000-0000-4000-8000-0000000000a1', OTHER='00000000-0000-4000-8000-0000000000b2', SID='10000000-0000-4000-8000-000000000001';
const env={SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'test-only',PRIM3_ADAPTIVE_ENABLED:'true',PRIM3_ADAPTIVE_SIGNING_KEY:'local-tests-only-000000000000000000000000000000000000',ALLOWED_ORIGINS:'http://127.0.0.1:8765'};
const opts={requireHouseOwner:async()=>({id:OWNER})};
const start={session_id:SID,template_id:'relay-distance-v1',review:{fictionChecked:true,geographyChecked:true}};
async function withDb(run){const db=evidenceDb(),old=globalThis.fetch;globalThis.fetch=db.fetchImpl;try{await run(db);}finally{globalThis.fetch=old;}}
const req=(method,path,body,settings=env,options=opts)=>handleLearning(new Request(`https://api.mccluster.org/v1/prim3/learning${path}`,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),settings,options);
const call=(method,path,body,settings,options)=>req(method,`/adaptive${path}`,body,settings,options);
async function send(view,type,fields={}) {const e={id:`event-${view.flow.nextSeq}`,seq:view.flow.nextSeq,type,questionId:view.flow.question?.id??null,...fields};const res=await call('POST',`/sessions/${SID}/events`,e);return {res,e,view:await res.json()};}
async function begin(){const s=await (await call('POST','/sessions',start)).json();return (await send((await send(s,'begin')).view,'handoff')).view;}
const answer=v=>{const n=v.flow.question.prompt.match(/-?\d+/g).map(Number);return Math.abs(n[2]-n[0]);};
test('owner/config gates precede all evidence reads; defaults are disabled',async()=>withDb(async db=>{
  const denied={requireHouseOwner:async()=>{throw Object.assign(new Error('owner required'),{status:403});}};
  assert.equal((await call('GET','',undefined,env,denied)).status,403);assert.equal(db.calls.length,0);
  assert.equal((await (await call('GET','',undefined,{...env,PRIM3_ADAPTIVE_ENABLED:undefined})).json()).enabled,false);
  assert.equal((await call('POST','/sessions',start,{...env,PRIM3_ADAPTIVE_SIGNING_KEY:undefined})).status,503);
  assert.equal(db.calls.length,0);
}));
test('review → issue → brief → server answer → debrief writes existing evidence without competency credit',async()=>withDb(async db=>{
  assert.equal((await call('POST','/sessions',{...start,review:{}})).status,400);
  let v=await begin();assert.equal(v.tactical.href,'prim3-transit.html');
  v=(await send(v,'answer',{answer:answer(v),correct:false,result:{correct:false}})).view;
  assert.equal(v.result.correct,true);assert.equal(v.flow.debrief.independent,1);
  v=(await send(v,'hint')).view;v=(await send(v,'answer',{answer:answer(v)})).view;
  assert.equal(v.result.independent,false);
  v=(await send(v,'finish',{outcome:'completed'})).view;
  assert.equal(v.flow.phase,'debrief');assert.equal(v.evidence.closed,true);
  assert.equal(v.flow.debrief.principlesCredit,false);
  assert.equal(db.tables.learning_lab_sessions[0].outcome,'completed');
  assert.equal(db.tables.learning_evidence_events.length,7);
  assert.equal(db.calls.some(c=>c.table==='learning_competency_ratings'),false);
  assert.equal((await req('POST',`/sessions/${SID}/events`,{event_type:'note'})).status,409);
  assert.equal((await req('POST',`/sessions/${SID}/complete`,{outcome:'completed'})).status,409);
}));
test('lost ACK and concurrent identical retries persist one validated answer',async()=>withDb(async db=>{
  let v=await begin();db.loseAck();const sent=await send(v,'answer',{answer:answer(v)});assert.equal(sent.res.status,200);
  const retry=await call('POST',`/sessions/${SID}/events`,sent.e);assert.equal(retry.status,200);
  assert.equal(db.tables.learning_evidence_events.length,4);
  v=sent.view;const event={id:'same',seq:v.flow.nextSeq,type:'answer',questionId:v.flow.question.id,answer:answer(v)};
  const pair=await Promise.all([call('POST',`/sessions/${SID}/events`,event),call('POST',`/sessions/${SID}/events`,event)]);
  assert.deepEqual(pair.map(r=>r.status),[200,200]);assert.equal(db.tables.learning_evidence_events.length,5);
  assert.equal((await call('POST',`/sessions/${SID}/events`,{...event,answer:99})).status,409);
}));
test('cross-user reads, forged signatures, and copied receipts fail closed',async()=>withDb(async db=>{
  await begin();const other={requireHouseOwner:async()=>({id:OTHER})};
  assert.equal((await call('GET',`/sessions/${SID}`,undefined,env,other)).status,404);
  db.tables.learning_evidence_events[1].payload.result.accepted=false;
  assert.equal((await call('GET',`/sessions/${SID}`)).status,409);
}));
test('expiry rejects new answers but returns original receipt; incomplete close retries safely',async()=>withDb(async db=>{
  let v=await begin();const sent=await send(v,'answer',{answer:answer(v)});v=sent.view;
  const real=Date.now;Date.now=()=>real()+86_400_001;
  try{assert.equal((await call('POST',`/sessions/${SID}/events`,sent.e)).status,200);assert.equal((await send(v,'answer',{answer:1})).res.status,409);}finally{Date.now=real;}
  db.failClose();const finish=await send(v,'finish',{outcome:'completed'});assert.equal(finish.res.status,503);
  const recovered=await (await call('POST',`/sessions/${SID}/events`,finish.e)).json();assert.equal(recovered.evidence.closed,true);
  assert.equal(db.tables.learning_evidence_events.length,5);
}));
test('body limits and invalid answers do not append evidence',async()=>withDb(async db=>{
  const v=await begin();
  assert.equal((await send(v,'answer',{answer:''})).res.status,400);
  assert.equal((await call('POST',`/sessions/${SID}/events`,{pad:'x'.repeat(5000)})).status,413);
  assert.equal(db.tables.learning_evidence_events.length,3);
}));
test('release retries preserve one session/start event and stored JSON key order is irrelevant',async()=>withDb(async db=>{
  db.loseAck();const first=await call('POST','/sessions',start);assert.equal(first.status,200);
  const second=await call('POST','/sessions',start);assert.equal(second.status,200);
  assert.equal(db.tables.learning_lab_sessions.length,1);assert.equal(db.tables.learning_evidence_events.length,1);
  const p=db.tables.learning_evidence_events[0].payload;
  db.tables.learning_evidence_events[0].payload=Object.fromEntries(Object.entries(p).reverse());
  assert.equal((await call('GET',`/sessions/${SID}`)).status,200);
}));
test('concurrent conflicting answers cannot both occupy the same event slot',async()=>withDb(async db=>{
  const v=await begin(),e={id:'first',seq:v.flow.nextSeq,type:'answer',questionId:v.flow.question.id,answer:answer(v)};
  const responses=await Promise.all([call('POST',`/sessions/${SID}/events`,e),call('POST',`/sessions/${SID}/events`,{...e,id:'second',answer:999})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(db.tables.learning_evidence_events.length,4);
}));
test('assessment cannot bypass the explicit tactical handoff',async()=>withDb(async db=>{
  const s=await (await call('POST','/sessions',start)).json(),v=(await send(s,'begin')).view;
  assert.equal((await send(v,'answer',{answer:answer(v)})).res.status,409);
  assert.equal(db.tables.learning_evidence_events.length,2);
}));
test('verified math carries across sessions; tactical outcome and requested level do not grant credit',async()=>withDb(async db=>{
  let v=await begin();
  v=(await send(v,'answer',{answer:answer(v)})).view;
  v=(await send(v,'answer',{answer:answer(v)})).view;
  v=(await send(v,'finish',{outcome:'abandoned'})).view;
  const progress=await (await call('GET','/progress')).json();
  assert.equal(progress.progress.next_level,2);assert.equal(progress.progress.competency_credit,false);
  assert.equal(progress.progress.recent[0].independent,2);
  const nextId='10000000-0000-4000-8000-000000000002';
  const next=await (await call('POST','/sessions',{...start,session_id:nextId,initial_level:3,correct:true})).json();
  assert.equal(next.flow.level,2);assert.equal(next.flow.phase,'brief');
  const release=db.tables.learning_evidence_events.find(e=>e.session_id===nextId).payload;
  assert.equal(release.initial_level,2);assert.equal(release.basis_session_id,SID);
  assert.equal((await (await call('GET',`/sessions/${nextId}`)).json()).flow.level,2);
  assert.equal(db.calls.some(c=>c.table==='learning_competency_ratings'),false);
}));
test('hinted success, active sessions and other users cannot advance cross-session practice',async()=>withDb(async db=>{
  let v=await begin();
  v=(await send(v,'hint')).view;v=(await send(v,'answer',{answer:answer(v)})).view;
  assert.equal((await (await call('GET','/progress')).json()).progress.recent.length,0);
  v=(await send(v,'finish',{outcome:'completed'})).view;
  assert.equal((await (await call('GET','/progress')).json()).progress.next_level,1);
  const other=await (await call('GET','/progress',undefined,env,{requireHouseOwner:async()=>({id:OTHER})})).json();
  assert.equal(other.progress.next_level,1);assert.deepEqual(other.progress.recent,[]);
  assert.equal(other.progress.basis_session_id,null);
}));
test('tampered or incomplete closed history fails closed instead of seeding another level',async()=>withDb(async db=>{
  let v=await begin();v=(await send(v,'answer',{answer:answer(v)})).view;
  v=(await send(v,'finish',{outcome:'completed'})).view;
  db.tables.learning_evidence_events[3].payload.result.correct=false;
  assert.equal((await call('GET','/progress')).status,409);
  assert.equal((await call('POST','/sessions',{...start,session_id:'10000000-0000-4000-8000-000000000002'})).status,409);
  assert.equal(db.tables.learning_evidence_events.filter(e=>e.payload.type==='release').length,1);
}));
test('progress route stays disabled before database access',async()=>withDb(async db=>{
  assert.equal((await call('GET','/progress',undefined,{...env,PRIM3_ADAPTIVE_ENABLED:undefined})).status,503);
  assert.equal(db.calls.length,0);
}));

test('legacy signed releases without initial level replay and seed new practice',async()=>withDb(async db=>{
  let v=await begin();
  const release=db.tables.learning_evidence_events[0].payload;
  delete release.initial_level;delete release.basis_session_id;delete release.signature;
  const canonical=JSON.stringify(release,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
  release.signature=createHmac('sha256',env.PRIM3_ADAPTIVE_SIGNING_KEY).update(canonical).digest('hex');
  v=(await send(v,'answer',{answer:answer(v)})).view;
  v=(await send(v,'answer',{answer:answer(v)})).view;
  await send(v,'finish',{outcome:'completed'});
  assert.equal((await (await call('GET','/progress')).json()).progress.next_level,2);
}));
test('recent history is bounded and explicitly reports older sessions',async()=>withDb(async db=>{
  for(let i=1;i<=11;i++){
    const sid=`20000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
    let v=await (await call('POST','/sessions',{...start,session_id:sid})).json();
    for(const type of ['begin','handoff','answer','finish']){
      const e={id:`event-${v.flow.nextSeq}`,seq:v.flow.nextSeq,type,questionId:v.flow.question?.id??null};
      if(type==='answer')e.answer=answer(v);if(type==='finish')e.outcome='abandoned';
      const r=await call('POST',`/sessions/${sid}/events`,e);assert.equal(r.status,200);v=await r.json();
    }
  }
  const p=(await (await call('GET','/progress')).json()).progress;
  assert.equal(p.recent.length,10);assert.equal(p.has_older_sessions,true);assert.equal(p.window_limit,10);
}));
