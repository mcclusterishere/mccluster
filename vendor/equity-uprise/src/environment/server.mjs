import { defineInstallation } from '../installation/config.mjs';
import { readModulePolicy, moduleRefusal } from '../server/module-policy.mjs';
import { ENVIRONMENT_PATH, clip } from './evidence.mjs';
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const FAILURE_CODES = new Set(['join_team_first','membership_blocked','identity_required','team_unavailable','mission_expired','source_expired','approved_environment_mission_required','proposal_limit','mission_full','mission_not_open','mission_not_eligible','assignment_not_found','proof_not_found','owner_only','sign_in_required','proof_consent_required','share_boolean_required','invalid_proof','invalid_decision','proof_immutable','mission_not_taking_proof','proof_already_used','review_not_authorized','self_review_forbidden','proof_requires_live_capture','proof_changed']);
const defaultResponse = (_request, body, status) => new Response(JSON.stringify(body), { status, headers: { 'content-type':'application/json; charset=utf-8', 'x-content-type-options':'nosniff' } });
async function boundedInput(request, limit = 4096) {
  if (Number(request.headers.get('content-length')) > limit) throw new Error('invalid_request');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid_request');
  const parts = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error('invalid_request'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const input = JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(bytes));
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_request');
  return input;
}
function publicMission(row) {
  if (!row || !uuid(row.id) || !['open','paused','closed'].includes(row.status)) return [];
  return [{ id:row.id, event_id:row.event_id, action_id:row.action_id, title:clip(row.title,180), description:clip(row.description,2000), status:row.status }];
}
/** A request controller, not an identity service or database. All authority and
 * persistence belong to the supplied installation adapters. */
export function createEnvironmentServer({ installation, loadPolicy, authenticate, isOwner, readEvidence, repository, response = defaultResponse, proofs = null, planning = null, failureCodes = [], allowLocalhost = false }) {
  const allowedFailures=new Set([...FAILURE_CODES,...failureCodes.filter(code=>typeof code==='string'&&/^[a-z_]{1,80}$/.test(code))]);
  const config = defineInstallation(installation, { allowLocalhost });
  for (const fn of [loadPolicy, authenticate, isOwner, readEvidence, response]) if (typeof fn !== 'function') throw new TypeError('Explicit server authority adapters are required.');
  for (const name of ['listMissions','listAssignments','listProfiles','team','propose','review','join']) if (typeof repository?.[name] !== 'function') throw new TypeError(`Missing repository adapter: ${name}.`);
  // Capture method references; replacing a method later has no effect. Adapters
  // remain trusted authority: their closures/receiver dependencies must be
  // permanently installation-scoped. Binding alone cannot enforce that.
  const repo = Object.freeze(Object.fromEntries(['listMissions','listAssignments','listProfiles','team','propose','review','join'].map(name => [name, repository[name].bind(repository)])));
  const send = (request, body, status = 200) => {
    const result = response(request, body, status);
    result.headers.set('cache-control','private, no-store'); result.headers.set('vary','origin, authorization'); return result;
  };
  const error = (request, code, status) => send(request, { ok:false, code }, status);
  return Object.freeze({ async handle(request) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    if (path !== ENVIRONMENT_PATH && !path.startsWith(ENVIRONMENT_PATH+'/')) return null;
    // Missing or cross-install policy never falls back to enabled. Every request
    // reloads authoritative server policy; there is no module-level singleton.
    let policy;
    try { policy = readModulePolicy(await loadPolicy({ installationId:config.id, moduleId:'environment' }), config.id, 'environment'); }
    catch { return error(request,'module_policy_unavailable',503); }
    const refusal = !config.modules.environment ? { code:'module_disabled', status:404 } : moduleRefusal(policy, request.method);
    if (refusal) return error(request,refusal.code,refusal.status);
    const context = Object.freeze({ installationId:config.id, request, policy });
    if (path === ENVIRONMENT_PATH) {
      if (request.method !== 'GET') return error(request,'method_not_allowed',405);
      let feed;
      try { feed = await readEvidence(context); } catch { return error(request,'evidence_unavailable',503); }
      if (!feed || feed.schema !== 'world-environment/v1' || !Array.isArray(feed.events) || !Array.isArray(feed.sources)) return error(request,'evidence_unavailable',503);
      feed = { ...feed };
      try { feed.missions = (await repo.listMissions(context,{ owner:false })).slice(0,200).flatMap(publicMission); feed.missions_unavailable=false; }
      catch { feed.missions=[];feed.missions_unavailable=true; }
      return send(request,feed);
    }
    let principal;
    try { principal = await authenticate(context); } catch { return error(request,'identity_unavailable',503); }
    if (!principal || !uuid(principal.id) || principal.installationId !== config.id) return error(request,'sign_in_required',401);
    const actor = Object.freeze({ ...context, principal:Object.freeze({ id:principal.id, installationId:config.id }) });
    const review = path.match(/^\/v1\/world\/environment\/missions\/([0-9a-f-]+)\/(review|join)$/i);
    const planningMethod=new Map([['context','context'],['review','review'],['mission','plan'],['sponsor-draft','sponsorDraft'],['companies','companies']]).get(path.startsWith(ENVIRONMENT_PATH+'/planning/')?path.slice((ENVIRONMENT_PATH+'/planning/').length):'');
    const proofAssignment=path.match(/^\/v1\/world\/environment\/assignments\/([0-9a-f-]+)\/(proof|share)$/i);
    const proofReview=path.match(/^\/v1\/world\/environment\/proofs\/([0-9a-f-]+)\/review$/i);
    const proofList=path===ENVIRONMENT_PATH+'/proofs';
    const ownerList = path === ENVIRONMENT_PATH+'/missions' || path === ENVIRONMENT_PATH+'/oversight';
    if (ownerList || review?.[2] === 'review' || proofList || proofReview || planningMethod) {
      let owner;
      try { owner = await isOwner(actor); } catch { return error(request,'authorization_unavailable',503); }
      if (owner !== true) return error(request,'owner_only',403);
    }
    if (ownerList && request.method === 'GET') {
      try {
        const list = (await repo.listMissions(actor,{owner:true})).filter(row=>row && uuid(row.id)).slice(0,200).map(row=>({ ...row }));
        if (path.endsWith('/oversight') && list.length) {
          const assignments = (await repo.listAssignments(actor,list.map(m=>m.id))).slice(0,2000);
          const people = [...new Set(assignments.map(a=>a.m_uid).filter(uuid))].slice(0,200);
          const profiles = people.length ? await repo.listProfiles(actor,people) : [];
          const names = new Map(profiles.map(p=>[p.m_uid,clip(p.display_name,80)]));
          for (const m of list) {
            m.assignments=assignments.filter(a=>a.mission_id===m.id && uuid(a.id)).map(a=>({assignment_id:a.id,user_id:a.user_id,m_uid:a.m_uid,display_name:names.get(a.m_uid)||null,status:a.status}));
            m.assignments_truncated=assignments.length>=2000;
          }
        }
        return send(request,{ok:true,missions:list});
      } catch { return error(request,'persistence_unavailable',503); }
    }
    if (request.method !== 'POST' && !((path === ENVIRONMENT_PATH+'/team' || proofList || proofAssignment?.[2]==='proof') && request.method === 'GET')) return error(request,'method_not_allowed',405);
    let input = {};
    if (request.method === 'POST') { try { input = await boundedInput(request,proofAssignment||planningMethod?24576:4096); } catch { return error(request,'invalid_request',400); } }
    // Recheck after any async auth/evidence work, immediately before the
    // repository call. The host must also check transactionally for a durable
    // cross-process drain guarantee; this controller is not a database lock.
    const mutationGate = async () => {
      let latest;
      try { latest=readModulePolicy(await loadPolicy({installationId:config.id,moduleId:'environment'}),config.id,'environment'); }
      catch { return error(request,'module_policy_unavailable',503); }
      const gate=moduleRefusal(latest,'POST'); if(gate)return error(request,gate.code,gate.status);
      if(latest.revision!==policy.revision)return error(request,'module_policy_changed',409);
      return null;
    };
    try {
      if(planningMethod){
        if(request.method!=='POST')return error(request,'method_not_allowed',405);
        if(typeof planning?.[planningMethod]!=='function')return error(request,'planning_unavailable',503);
        const denied=await mutationGate();if(denied)return denied;
        const result=await planning[planningMethod](input);
        if(!result||typeof result!=='object'||Array.isArray(result))throw Error('invalid_planning_result');
        return send(request,{ok:true,...result});
      }
      if (proofList || proofReview || proofAssignment) {
        const operation=proofList?'list':proofReview?'review':proofAssignment[2]==='share'?'share':request.method==='GET'?'read':'submit';
        if(typeof proofs?.[operation]!=='function')return error(request,'proof_service_unavailable',503);
        if(proofList && request.method!=='GET')return error(request,'method_not_allowed',405);
        const assignmentId=proofAssignment?.[1],proofId=proofReview?.[1];
        if((assignmentId&&!uuid(assignmentId))||(proofId&&!uuid(proofId)))return error(request,'invalid_request',400);
        if(request.method==='POST'){
          if(operation==='submit' && (!['text','link'].includes(input.proof_type)||typeof input.statement!=='string'||input.statement.trim().length<20||input.statement.length>4000||typeof input.share!=='boolean'||input.consent!==true))return error(request,'invalid_proof',400);
          if(operation==='submit'){
            if(input.proof_type==='link'){
              try{const u=new URL(input.proof_url);if(u.protocol!=='https:'||u.username||u.password||typeof input.proof_url!=='string'||input.proof_url.length>2000)throw Error();}catch{return error(request,'invalid_proof',400);}
            }else if(input.proof_url!=null&&input.proof_url!=='')return error(request,'invalid_proof',400);
          }
          if(operation==='share' && (typeof input.share!=='boolean'||(input.share&&input.consent!==true)))return error(request,'sharing_consent_required',400);
          if(operation==='review' && (!['verified','rejected'].includes(input.decision)||typeof input.review_note!=='string'||input.review_note.length>1000||typeof input.expected_revision!=='string'||!/^[a-f0-9]{32}$/.test(input.expected_revision)))return error(request,'invalid_review',400);
          const denied=await mutationGate();if(denied)return denied;
        }
        const result=await proofs[operation](actor,{assignmentId,proofId,...(operation==='submit'?{proof_type:input.proof_type,statement:input.statement.trim(),proof_url:input.proof_type==='link'?input.proof_url:null,share:input.share,consent:input.consent}:operation==='share'?{share:input.share,consent:input.consent}:operation==='review'?{decision:input.decision,review_note:input.review_note,expected_revision:input.expected_revision}: {})});
        if(!result||typeof result!=='object'||Array.isArray(result))throw Error('invalid_proof_result');
        if(operation==='submit'&&(!uuid(result.proof_id)||result.assignment_id!==assignmentId||result.status!=='submitted'))throw Error('invalid_proof_result');
        if(['read','share'].includes(operation)&&result.assignment_id!==assignmentId)throw Error('invalid_proof_result');
        if(operation==='list'&&!Array.isArray(result.proofs))throw Error('invalid_proof_result');
        if(operation==='review'&&(result.proof_id!==proofId||result.status!==input.decision))throw Error('invalid_proof_result');
        return send(request,{ok:true,...result});
      }
      if (path === ENVIRONMENT_PATH+'/team') {
        if (request.method === 'POST' && typeof input.join !== 'boolean') return error(request,'join_boolean_required',400);
        if(request.method==='POST'){const denied=await mutationGate();if(denied)return denied;}
        const state=await repo.team(actor,{join:request.method==='GET'?null:input.join});
        return send(request,{ok:true,team:{slug:state.slug,name:state.name},membership:{joined:state.joined===true},assignments_limited:(state.assignments||[]).length>200,assignments:(state.assignments||[]).slice(0,200).filter(a=>uuid(a.assignment_id)&&uuid(a.mission_id)).map(a=>({mission_id:a.mission_id,assignment_id:a.assignment_id,status:a.status,title:clip(a.title,180),description:clip(a.description,2000),event_id:clip(a.event_id,300),mission_status:clip(a.mission_status,60),observed_at:a.observed_at||null,ends_at:a.ends_at||null,news_context:a.news_context?.schema==='environment-news-attribution/v1'?{title:clip(a.news_context.title,1000),url:clip(a.news_context.url,2000),seen_at:a.news_context.seen_at||null,notice:clip(a.news_context.notice,500)}:null,source:{label:clip(a.source?.label,120),url:clip(a.source?.url,2000)},capture_path:a.capture_available===true && a.mission_status==='open' && ['joined','in_progress','rejected'].includes(a.status)?`live-mission.html?assignment=${a.assignment_id}`:null,capture_label:'Check recording availability'}))});
      }
      if (path === ENVIRONMENT_PATH+'/missions/propose') {
        const feed=await readEvidence(actor), event=feed.events.find(e=>e.id===input.event_id), action=event?.actions.find(a=>a.id===input.action_id);
        if(!event||!action)return error(request,'current_event_and_action_required',409);
        const denied=await mutationGate();if(denied)return denied;
        if(input.news_review_id!==undefined&&!uuid(input.news_review_id))return error(request,'invalid_request',400);
        if(input.news_review_id&&await isOwner(actor)!==true)return error(request,'owner_only',403);
        const result=await repo.propose(actor,{event,action,...(input.news_review_id?{newsReviewId:input.news_review_id}:{})});
        return send(request,{ok:true,...result});
      }
      if(review&&uuid(review[1])) {
        if(review[2]==='review') {
          if(!['open','paused','closed'].includes(input.decision))return error(request,'invalid_decision',400);
          if(input.decision==='open') {
            const records=await repo.listMissions(actor,{owner:true}),mission=records.find(m=>m.id===review[1]),feed=await readEvidence(actor);
            if(!mission||!feed.events.some(e=>e.id===mission.event_id&&e.actions.some(a=>a.id===mission.action_id)))return error(request,'current_event_and_action_required',409);
          }
          const denied=await mutationGate();if(denied)return denied;
          const result=await repo.review(actor,{missionId:review[1],status:input.decision});
          return send(request,{ok:true,...result});
        }
        const denied=await mutationGate();if(denied)return denied;
        const result=await repo.join(actor,{missionId:review[1]});
        if(!uuid(result.assignment_id))throw new Error('invalid_assignment');
        return send(request,{ok:true,...result,capture_path:['joined','in_progress','rejected'].includes(result.status)?`live-mission.html?assignment=${result.assignment_id}`:null,capture_label:'Check recording availability'});
      }
      return error(request,'not_found',404);
    } catch(failure) {
      const code=allowedFailures.has(failure?.code)?failure.code:null;
      return error(request,code||'persistence_unavailable',code?([400,403,404,409,503].includes(failure.status)?failure.status:409):503);
    }
  } });
}
