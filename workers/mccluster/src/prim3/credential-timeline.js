/* No registrar or MCP connection, no credentials, and no raw transcripts.
   An authenticated house owner records their own dated reading of official evidence. */
const KINDS = new Set(['exam','course','badge','certification','task']);
const STATES = new Set(['planned','studying','passed','completed']);
const DEST = new Set(['proposed','preapproved','posted']);
const EVIDENCE = new Set(['degree_audit','transcript','registrar']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ID=/^[a-zA-Z0-9_-]{1,64}$/;
const LINKS=Object.freeze([
  {school:'CT State Community College',url:'https://ctstate.edu/degree-works'},
  {school:'Southern Connecticut State University',url:'https://inside.southernct.edu/helpdesk/technical-support/myscsu/degreeworks'}
]);
const err=(msg,status=400)=>{throw Object.assign(new Error(msg),{status});};
const empty=()=>({version:1,goals:[],items:[]});
const key=s=>s.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
function keys(input,allowed) {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k))) err('Unexpected timeline fields');
}
function string(v,max,required=true) {
  if(typeof v!=='string'||v.length>max||required&&!v.trim()||/[\u0000-\u001f\u007f<>]/u.test(v) ||
    /(?:https?:\/\/|eyJ[a-zA-Z0-9_-]{16,}\.|\b\d{3}-\d{2}-\d{4}\b|\b(?:access_token|refresh_token|password|authorization)\s*[:=])/i.test(v))
    err('Use a short text label, not a link, private identifier or credential');
  return v.trim();
}
function day(value,name){
  if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))err('Invalid '+name);
  const d=new Date(value+'T00:00:00Z');if(!Number.isFinite(d.valueOf())||d.toISOString().slice(0,10)!==value)err('Invalid '+name);return value;
}
function list(v,max,name){if(!Array.isArray(v)||v.length>max)err('Invalid '+name);return v;}
function unique(v,name){if(new Set(v).size!==v.length)err('Duplicate '+name);return v;}
function id(v){if(typeof v!=='string'||!SAFE_ID.test(v))err('Invalid plan-local identifier');return v;}
function num(v,max){if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>max||Math.abs(v*100-Math.round(v*100))>1e-7)err('Invalid amount');return v;}
function member(set,v,label){if(!set.has(v))err('Invalid '+label);return v;}
export function normalizePlan(raw,today=new Date().toISOString().slice(0,10)){
  keys(raw,['version','goals','items','budget']);if(raw.version!==1)err('Expected version 1');
  const goals=list(raw.goals,20,'goals').map(g=>{keys(g,['id','label','school']);return {id:id(g.id),label:string(g.label,160),school:string(g.school,120)};});
  const goalIds=new Set(unique(goals.map(g=>g.id),'goal identifiers'));
  const items=list(raw.items,100,'items').map(i=>{
    keys(i,['id','label','kind','start','end','status','next_action','prerequisites','destinations','goal_ids','study_course_id']);
    const row={id:id(i.id),label:string(i.label,160),kind:member(KINDS,i.kind,'item kind'),start:day(i.start,'start date'),end:day(i.end,'end date'),
      status:member(STATES,i.status,'study status'),next_action:string(i.next_action??'',400,false),
      prerequisites:unique(list(i.prerequisites??[],12,'prerequisites').map(id),'prerequisites'),destinations:[]};
    if(row.end<row.start)err('End date must not precede start');
    if(row.status==='passed'&&!['exam','certification'].includes(row.kind))err('Passed applies to an exam or certification');
    if(i.goal_ids?.length){row.goal_ids=unique(list(i.goal_ids,12,'linked goals').map(id),'linked goals');if(row.goal_ids.some(g=>!goalIds.has(g)))err('Unknown goal');}
    else if(i.goal_ids!==undefined)list(i.goal_ids,12,'linked goals');
    if(i.study_course_id!==undefined&&i.study_course_id!==''){if(!UUID.test(i.study_course_id)||typeof i.study_course_id!=='string')err('Invalid linked practice course');row.study_course_id=i.study_course_id.toLowerCase();}
    row.destinations=list(i.destinations??[],8,'destinations').map(d=>{
      keys(d,['school','equivalent','credits','status','evidence_date','evidence_type']);
      const dest={school:string(d.school,120),equivalent:string(d.equivalent??'',120,false),credits:d.credits==null?null:num(d.credits,60),
        status:member(DEST,d.status,'credit status'),evidence_date:d.evidence_date??'',evidence_type:d.evidence_type??''};
      if(dest.status!=='proposed'){
        if(!/[\p{L}\p{N}]/u.test(dest.equivalent) || !EVIDENCE.has(dest.evidence_type) || day(dest.evidence_date,'evidence date')>today)err('A receiving school, equivalency and dated official evidence are required');
        if(dest.status==='posted'&&(!(dest.credits>0)||!['passed','completed'].includes(row.status)))err('Posted credit needs a completed item and a positive credit award');
      }else if(dest.evidence_date!==''||dest.evidence_type!=='')err('Proposed credit has no official evidence');
      return dest;
    });
    unique(row.destinations.map(d=>key(d.school)),'destination school for this item');
    return row;
  });
  const ids=new Set(unique(items.map(i=>i.id),'item identifiers')), seen=new Set(),active=new Set(),byId=new Map(items.map(i=>[i.id,i]));
  function visit(i){if(active.has(i.id))err('Prerequisites contain a cycle');if(seen.has(i.id))return;
    active.add(i.id);for(const dep of i.prerequisites){if(!ids.has(dep))err('Unknown prerequisite');visit(byId.get(dep));}active.delete(i.id);seen.add(i.id);}
  items.forEach(visit);
  const out={version:1,goals,items};
  if(raw.budget!==undefined){keys(raw.budget,['amount_usd','note']);out.budget={amount_usd:num(raw.budget.amount_usd,100000),note:string(raw.budget.note,400)};}
  return out;
}
export function creditSummary(plan){
  const schools=new Map();
  for(const i of plan.items)for(const d of i.destinations){
    const k=key(d.school);if(!schools.has(k))schools.set(k,{school:d.school,awards:new Map()});
    if(d.status!=='posted')continue;
    // A transcript entry is identified within ONE receiving school. Do not stack
    // two exams/transfers for the same equivalency or silently choose a disputed value.
    const eq=key(d.equivalent).replace(/[^\p{L}\p{N}]/gu,'');
    if(!eq)continue;
    const awards=schools.get(k).awards;
    if(!awards.has(eq))awards.set(eq,{display:d.equivalent,units:new Set()});
    awards.get(eq).units.add(Math.round(d.credits*100));
  }
  return [...schools.values()].map(({school,awards})=>{let cents=0;const conflicts=[];
    for(const {display,units} of awards.values()){if(units.size>1)conflicts.push(display);else cents+=[...units][0];}
    return {school,posted_credits:cents/100,conflicts};});
}
function evidenceState(plan) {
  return plan.items.flatMap(i=>i.destinations.filter(d=>d.status!=='proposed').map(d=>
    JSON.stringify([i.id,key(d.school),d.equivalent,d.credits,d.status,d.evidence_date,d.evidence_type]))).sort().join('\n');
}
async function intake(req) {
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type')||''))err('JSON is required');
  if(Number(req.headers.get('content-length'))>262144)err('Plan is too large',413);
  const reader=req.body?.getReader();if(!reader)err('Plan is required');let text='',size=0;const dec=new TextDecoder('utf-8',{fatal:true});
  try{for(;;){const {done,value}=await reader.read();if(done)break;
    size+=value.length;if(size>262144){await reader.cancel();err('Plan is too large',413);}text+=dec.decode(value,{stream:true});}return JSON.parse(text+dec.decode());
  }catch(e){if(e.status)throw e;err('Invalid plan JSON');}finally{reader.releaseLock();}
}
export async function routeCredentialTimeline(req,env,user,db){
  if(env.CREDENTIAL_TIMELINE_ENABLED!=='true')err('Credential timeline is not enabled',503);
  const mine='owner_id=eq.'+user.id;
  const getCurrent=async()=>{const rows=await db(env,'learning_studio_timelines?select=revision,plan&limit=1&'+mine);
    return rows[0]||{revision:0,plan:empty()};};
  if(req.method==='GET'){
    const {revision,plan}=await getCurrent();
    const practice=await db(env,'learning_studio_summary?select=id,title,completed,total,state&order=created_at.desc&limit=100&'+mine);
    return {ok:true,revision,plan,practice,credit_summary:creditSummary(plan),links:LINKS,school_connection:'manual'};
  }
  if(req.method!=='PUT')err('Method not allowed',405);
  const body=await intake(req);keys(body,['expected_revision','plan','confirm_evidence']);
  if(!Number.isSafeInteger(body.expected_revision)||body.expected_revision<0||body.expected_revision>=2147483647)err('Expected a revision');
  if(body.confirm_evidence!==undefined&&typeof body.confirm_evidence!=='boolean')err('Invalid evidence confirmation');
  const plan=normalizePlan(body.plan),prior=await getCurrent();
  if(prior.revision!==body.expected_revision)err('Timeline changed; reload the latest plan before saving',409);
  if(evidenceState(plan)!==evidenceState(prior.plan)&&body.confirm_evidence!==true)err('Confirm you checked the dated evidence from the receiving school');
  const linked=[...new Set(plan.items.map(i=>i.study_course_id).filter(Boolean))];
  if(linked.length){
    const owned=await db(env,'learning_studio_summary?select=id&'+mine+'&id=in.('+linked.join(',')+')');
    if(linked.some(id=>!owned.some(row=>row.id===id)))err('A linked practice course is unavailable',409);
  }
  const revision=await db(env,'rpc/learning_studio_save_timeline',{method:'POST',body:{p_owner:user.id,p_expected:body.expected_revision,p_plan:plan}});
  if(!Number.isInteger(revision)||revision!==body.expected_revision+1)err('Timeline changed; reload the latest plan before saving',409);
  return {ok:true,revision,plan,credit_summary:creditSummary(plan)};
}
