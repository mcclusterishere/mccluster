import { COURSE_STUDIO_SOURCES } from '../../../../core/src/course-studio/source-catalog.mjs';
import { routeCredentialTimeline } from './credential-timeline.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cadence = Object.freeze({years:4, exams_per_year:4, badges_per_month:1});
const urls = new Set(COURSE_STUDIO_SOURCES.map(({url}) => url));
const matchingTerms = Object.freeze({
  algebra:['algebra','linear functions','precalculus','pre-calculus','slope'],
  calculus:['calculus','differential calculus','derivative'],
  chemistry:['chemistry','atomic structure','isotopes','ion charge']
});
function sourceInfo({url,title}) {
  const known=COURSE_STUDIO_SOURCES.find(s=>s.url===url);
  if (!known) reject('Course contains an unrecognized source',409);
  return {url,title:known.title||title,attribution:known.attribution,license:known.license,license_url:known.license_url};
}
const reject = (message,status=400) => { throw Object.assign(new Error(message),{status}); };

async function input(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) reject('JSON required',400);
  const reader=request.body?.getReader(); if (!reader) reject('JSON required');
  const decoder=new TextDecoder('utf-8',{fatal:true}); let size=0,str='';
  try {
    for (;;) {
      const {done,value}=await reader.read(); if(done) break;
      size+=value.byteLength;
      if(size>4096){ await reader.cancel(); reject('Course request is too large',413); }
      str+=decoder.decode(value,{stream:true});
    }
    const result=JSON.parse(str+decoder.decode());
    if(!result || typeof result!=='object' || Array.isArray(result)) reject('Expected a JSON object');
    return result;
  } catch(error) { if(error.status) throw error; reject('Invalid JSON'); }
  finally { reader.releaseLock(); }
}
function field(body,key,max,optional=false){
  const value=body[key]??''; if(typeof value!=='string' || (!optional&&!value.trim()) || value.length>max || /[\u0000-\u001f\u007f]/u.test(value)) reject('Invalid '+key);
  return value.trim();
}
function only(body,keys) { if(Object.keys(body).some(k=>!keys.includes(k))) reject('Unexpected field'); }
function summary(row) {
  return {id:row.id,school:row.school,course_code:row.course_code,title:row.title,term:row.term,
    state:row.state,completed:row.completed,total:row.total,score:row.score};
}
function publicBundle(bundle) {
  return {brief:bundle.brief.map(({text,source})=>({text,source})),
    sources:bundle.sources.map(sourceInfo),
    rounds:bundle.rounds.map(({prompt,choices,source})=>({prompt,choices,source}))};
}
export async function routeCourseStudio(request,env,user,parts,db){
  if(!UUID.test(user?.id||'')) reject('Owner identity required',403);
  if(env.COURSE_STUDIO_ENABLED!=='true') reject('Course Studio is not enabled',503);
  if(parts.length===1&&parts[0]==='timeline') return routeCredentialTimeline(request,env,user,db);
  const [id,action]=parts, method=request.method, own='owner_id=eq.'+user.id;
  if(!id&&!parts.length&&method==='GET'){
    const rows=await db(env,'learning_studio_summary?select=id,school,course_code,title,term,state,total,completed,score&order=created_at.desc&limit=100&'+own);
    return {ok:true,readings:COURSE_STUDIO_SOURCES.map(s=>({...sourceInfo(s),topic:s.topic,keywords:matchingTerms[s.topic]||[]})),cadence,courses:rows.map(summary)};
  }
  if(!id&&!parts.length&&method==='POST'){
    const body=await input(request);only(body,['request_id','school','course_code','title','term','source_urls']);
    if(!UUID.test(body.request_id||'')) reject('A request UUID is required');
    if(!Array.isArray(body.source_urls)||!body.source_urls.length||body.source_urls.length>urls.size||
       body.source_urls.some(u=>!urls.has(u))||new Set(body.source_urls).size!==body.source_urls.length) reject('Select one or more different supported readings');
    // Preserve the canonical registry order so a retransmission compares the same source set.
    const courseId=await db(env,'rpc/learning_studio_submit',{method:'POST',body:{p_owner:user.id,p_request:body.request_id,
      p_school:field(body,'school',120),p_code:field(body,'course_code',32),p_title:field(body,'title',160),p_term:field(body,'term',64,true),
      p_urls:[...urls].filter(u=>body.source_urls.includes(u))}});
    return {ok:true,id:courseId};
  }
  if(!UUID.test(id||'')||parts.length>2) reject('Study course not found',404);
  if(parts.length===1&&method==='GET'){
    // A single snapshot of queue + course prevents a retry/finish race in the user-facing state.
    const [row]=await db(env,'learning_studio_courses?select=id,school,course_code,title,term,bundle,answers,job:ops_agent_jobs!inner(status)&limit=1&'+own+'&id=eq.'+id);
    if(!row) reject('Study course not found',404);
    const state=row.job.status==='done'&&row.bundle?'ready':row.job.status==='failed'?'failed':row.job.status==='running'?'running':'queued';
    const answers=state==='ready'?row.answers:[],bundle=state==='ready'?publicBundle(row.bundle):null;
    return {ok:true,course:summary({...row,state,completed:answers.length,total:bundle?.rounds.length||0,score:answers.filter(a=>a.correct).length}),bundle,answers};
  }
  if(action==='answers'&&method==='POST'){
    const body=await input(request);only(body,['round','choice']);
    if(![body.round,body.choice].every(n=>Number.isSafeInteger(n)&&n>=0&&n<32)) reject('Invalid round or choice');
    const outcome=await db(env,'rpc/learning_studio_answer',{method:'POST',body:{p_owner:user.id,p_course:id,p_round:body.round,p_choice:body.choice}});
    if(outcome==='unavailable') reject('Ready course not found',404);
    if(outcome==='invalid') reject('Invalid round or choice');
    if(outcome!=='ok') reject('Progress changed; reload this course',409);
    return {ok:true};
  }
  if(action==='retry'&&method==='POST'){
    only(await input(request),[]);
    if(!await db(env,'rpc/learning_studio_retry',{method:'POST',body:{p_owner:user.id,p_course:id}})) reject('No failed build is available for retry',409);
    return {ok:true};
  }
  reject('Course Studio route not found',404);
}
