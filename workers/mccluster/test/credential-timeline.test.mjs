import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleLearning} from '../src/prim3/learning.js';
import {normalizePlan,creditSummary} from '../src/prim3/credential-timeline.js';
import {corsHeaders} from '../src/lib/http.js';
test('only the owner timeline advertises cross-origin replacement to allowed site origins',()=>{
  const origin='http://localhost:4173', path='https://api.example/v1/prim3/learning/course-studio/timeline';
  const opts=(u,o)=>corsHeaders(new Request(u,{method:'OPTIONS',headers:{origin:o,'access-control-request-method':'PUT'}}),{});
  assert.match(opts(path,origin)['access-control-allow-methods'],/\bPUT\b/);
  assert.equal(opts(path,origin)['access-control-allow-origin'],origin);
  assert.notEqual(opts(path,'https://untrusted.invalid')['access-control-allow-origin'],'https://untrusted.invalid');
  assert.doesNotMatch(opts(path+'/other',origin)['access-control-allow-methods'],/\bPUT\b/);
});
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002',practice='10000000-0000-4000-8000-000000000009';
const env={SUPABASE_URL:'https://study.invalid',SUPABASE_SERVICE_ROLE_KEY:'local-only',COURSE_STUDIO_ENABLED:'true',CREDENTIAL_TIMELINE_ENABLED:'true'};
const destination=(school,credits,status='posted')=>({school,equivalent:'EX 111',credits,status,evidence_date:'2025-03-01',evidence_type:'transcript'});
const item=(id='abc',more={})=>({id,label:'Example examination',kind:'exam',start:'2025-01-01',end:'2025-02-28',status:'passed',next_action:'Reconcile',prerequisites:[],destinations:[],...more});
const plan=(...items)=>({version:1,goals:[],items});
test('invalid data stays off the academic plan; prerequisites are an acyclic graph',()=>{
  const raw=plan(item('a'),item('b',{prerequisites:['a']}));
  assert.deepEqual(normalizePlan(raw),raw);
  for(const p of [plan(item('a',{prerequisites:['a']})),plan(item('a',{prerequisites:['b']})),plan(item('a'),item('a')),
    plan(item('a',{kind:'course',status:'passed'})),plan(item('a',{start:'2025-02-29'})),plan(item('a',{start:'2026-01-01'})),
    plan(item('a',{goal_ids:['missing']})),plan(item('a',{destinations:[destination('X',3),destination(' x ',4)]})),
    plan(item('a',{destinations:[{...destination('X',3),evidence_date:'2099-01-01'}]})),
    plan(item('a',{destinations:[{...destination('X',3),equivalent:''}]})),plan(item('a',{destinations:[{...destination('X',3),equivalent:'---'}]})),
    plan(item('a',{status:'studying',destinations:[destination('X',3)]})),plan(item('a',{destinations:[destination('X',0)]})),
    {...raw,student_id:'excluded'},plan(item('a',{syllabus:'do not send raw files'})),plan(item('a',{label:'password=private'}))])assert.throws(()=>normalizePlan(p));
});
test('no cross-school or duplicate accumulation; disputed amounts excluded',()=>{
  const p=normalizePlan(plan(
    item('a',{destinations:[destination('Example A',3),destination('Example B',4)]}),
    item('b',{destinations:[{...destination('example a',3),equivalent:'EX-111'}]}),
    item('c',{destinations:[{...destination('Example A',4),equivalent:'EX 222'}]}),
    item('d',{destinations:[{...destination('Example A',3),equivalent:'EX 222'}]}),
    item('e',{destinations:[{...destination('Example A',5),equivalent:'EX 333',status:'preapproved'}]})
  ));
  assert.deepEqual(creditSummary(p),[{school:'Example A',posted_credits:3,conflicts:['EX 222']},{school:'Example B',posted_credits:4,conflicts:[]}]);
});
test('owner route: scoped read, dated confirmation, CAS, denied identities, separate academic and practice state',async t=>{
  const plans=new Map();let calls=0;const wire=[];
  const gate={requireHouseOwner:async req=>{const token=req.headers.get('authorization');if(!token)throw Object.assign(Error('Sign in'),{status:401});
    const uid=token.slice(7);if(![A,B].includes(uid))throw Object.assign(Error('Not allowed'),{status:403});return{id:uid};}};
  t.mock.method(globalThis,'fetch',async (u,init={})=>{
    const url=new URL(u),table=url.pathname.split('/').at(-1);calls++;wire.push(url.origin);assert.equal(url.origin,'https://study.invalid');
    const uid=url.searchParams.get('owner_id')?.slice(3);
    if(table==='learning_studio_timelines'){assert.ok(uid===A||uid===B);return Response.json(plans.has(uid)?[plans.get(uid)]:[]);}
    if(table==='learning_studio_summary'){assert.ok(uid===A||uid===B);return Response.json(uid===A?[{id:practice,title:'Practice',completed:4,total:4,state:'ready'}]:[]);}
    assert.equal(table,'learning_studio_save_timeline');const {p_owner,p_expected,p_plan}=JSON.parse(init.body);
    if((plans.get(p_owner)?.revision||0)!==p_expected)return Response.json(0);
    plans.set(p_owner,{revision:p_expected+1,plan:p_plan});return Response.json(p_expected+1);
  });
  async function request(uid,body,overrides={}){
    const init={headers:{'content-type':'application/json',...(uid?{authorization:'Bearer '+uid}:{})}};
    if(body!==undefined){init.method='PUT';init.body=JSON.stringify(body);}
    const res=await handleLearning(new Request('https://owner.invalid/v1/prim3/learning/course-studio/timeline',init),{...env,...overrides},gate);
    assert.match(res.headers.get('cache-control'),/no-store/);return {status:res.status,...await res.json()};
  }
  assert.equal((await request(null)).status,401);assert.equal((await request('ordinary')).status,403);assert.equal((await request(A,undefined,{CREDENTIAL_TIMELINE_ENABLED:'false'})).status,503);assert.equal(calls,0);
  const open=await request(A);assert.equal(open.revision,0);assert.equal(open.school_connection,'manual');assert.ok(open.links.every(l=>l.url.startsWith('https:')));
  const p=plan(item('prereq',{kind:'task',status:'planned',study_course_id:practice}),item('exam',{prerequisites:['prereq'],destinations:[destination('Example A',3)]}));
  assert.equal((await request(B,{expected_revision:0,plan:p,confirm_evidence:true})).status,409);
  assert.equal((await request(A,{expected_revision:0,plan:p})).status,400);assert.equal(plans.size,0);
  const save=await request(A,{expected_revision:0,plan:p,confirm_evidence:true});assert.equal(save.revision,1);
  assert.equal((await request(A,{expected_revision:0,plan:p,confirm_evidence:true})).status,409);
  const latest=await request(A);assert.equal(latest.plan.items[0].status,'planned');assert.equal(latest.practice[0].completed,4);
  assert.equal(latest.credit_summary[0].posted_credits,3);assert.equal((await request(B)).plan.items.length,0);
  const clearing={expected_revision:1,plan:plan()};assert.equal((await request(A,clearing)).status,400);assert.equal((await request(A,{...clearing,confirm_evidence:true})).revision,2);
  assert.equal(new Set(wire).size,1);
});
