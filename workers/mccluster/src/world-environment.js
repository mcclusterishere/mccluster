/* McCluster implementation adapter for the private Equity Uprise product.
 * Existing credentials, database/RLS, provider cache and owner checks stay here.
 * No new backend or identity authority is created by this adapter. */
import { createEnvironmentProofAdapter, ENVIRONMENT_PROOF_ERRORS } from './environment-proofs.js';
import { createMcClusterEnvironmentPlanning, ENVIRONMENT_PLANNING_ERROR_CODES } from './environment-planning-mccluster.js';
import { reply } from './lib/http.js';
import { bearerUser, cachedLayer } from './world-layers.js';
import { fetchWeather, fetchNatural } from './world-events.js';
import { fetchQuakes, fetchCyclones } from './world-halo-layers.js';
import { service, uuid } from './world-cctv.js';
import { isHouseOwner } from './world-access.js';
import { readModulePolicy, MODULE_POLICY_ERRORS } from './eup/modules.js';
import { environmentFeed as productFeed, clip } from '../../../vendor/equity-uprise/src/environment/evidence.mjs';
import { createEnvironmentServer } from '../../../vendor/equity-uprise/src/environment/server.mjs';
export { ENVIRONMENT_PATH, ENVIRONMENT_TEAM, ENVIRONMENT_ACTIONS, environmentFacts } from '../../../vendor/equity-uprise/src/environment/evidence.mjs';
const PROVIDERS = { nws:fetchWeather, eonet:fetchNatural, usgs:fetchQuakes, nhc:fetchCyclones };
const installation = Object.freeze({
  schema:'equity-uprise.installation/v1',id:'mccluster',appOrigin:'https://mccluster.org',apiOrigin:'https://api.mccluster.org',
  brand:{name:'McCluster'},modules:{environment:true}
});
// Module policy is the persisted owner decision, read from the canonical store on every request
// (eup/modules.js -> eup_module_policy_read, service key, no cache). There is no built-in policy:
// a missing row, an unapplied schema, an unreachable store or a malformed answer makes loadPolicy
// throw, and the pinned server answers 503 module_policy_unavailable. Nothing defaults to on.
// A database refusal of a write (the module guard's SQLSTATEs) is passed to the pinned server with
// the code and status it answers for the same state itself.
const MODULE_REFUSALS = MODULE_POLICY_ERRORS.consumer;
const MODULE_FAILURE_CODES = Object.freeze(Object.values(MODULE_REFUSALS).map(([, code]) => code));
export async function environmentFeed(env,{fetchImpl=fetch,cacheImpl=null}={}) {
  return productFeed({readSource:spec=>cachedLayer({layer:spec.id,key:`consumer-environment-v1-${spec.id}`,ttl:spec.ttl,rows:spec.rows,fetcher:PROVIDERS[spec.id]},env,fetchImpl,cacheImpl)});
}
async function rpc(request, env, name, args, fetchImpl, privileged = false) {
  const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: privileged ? `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` : request.headers.get('authorization'), 'content-type': 'application/json'
  }, body: JSON.stringify(args) });
  if (!res.ok) {
    const failure = await res.json().catch(() => ({}));
    const refused = Object.hasOwn(MODULE_REFUSALS, failure?.code) ? MODULE_REFUSALS[failure.code] : Object.values(MODULE_REFUSALS).find(([, name]) => failure?.message === name);
    if (refused) throw Object.assign(new Error(refused[1]), { code: refused[1], status: refused[0] });
    let code = ['join_team_first','membership_blocked','identity_required','team_unavailable','mission_expired','source_expired','approved_environment_mission_required','proposal_limit','current_news_review_required','owner_only'].find(c => failure.message === c);
    code ||= ({ 'this mission is full': 'mission_full', 'this mission is not open': 'mission_not_open', 'regional mission not eligible for this member': 'mission_not_eligible' })[failure.message];
    throw Object.assign(new Error(code || 'persistence_unavailable'), { code });
  }
  return res.json();
}
async function missions(env, fetchImpl, owner = false) {
  const rows = await service(env, `action_environment_missions?select=event_id,action_id,mission_id,${owner ? 'source_snapshot,' : ''}action_missions!inner(id,title,description,status)&${owner ? '' : 'approved_by=not.is.null&action_missions.status=in.(open,paused,closed)&'}order=created_at.desc&limit=200`, fetchImpl);
  return rows.filter(r => uuid(r.mission_id) && r.action_missions).map(r => ({ id: r.mission_id, event_id: r.event_id, action_id: r.action_id, title: r.action_missions.title, description: r.action_missions.description, status: r.action_missions.status, ...(owner ? { source_snapshot: r.source_snapshot } : {}) }));
}
export async function handleWorldEnvironment(request, env, options = {}) {
  const { fetchImpl=fetch }=options;
  const planning=createMcClusterEnvironmentPlanning({request,env,fetchImpl,readEvent:async id=>(await environmentFeed(env,options)).events.find(event=>event.id===id)});
  const controller=createEnvironmentServer({
    proofs:createEnvironmentProofAdapter(request,env,{fetchImpl}),
    planning,failureCodes:[...ENVIRONMENT_PROOF_ERRORS,...ENVIRONMENT_PLANNING_ERROR_CODES,'current_news_review_required',...MODULE_FAILURE_CODES],
    installation,
    loadPolicy:()=>readModulePolicy(env,fetchImpl,'environment'),
    authenticate:async()=>{const user=await bearerUser(request,env,fetchImpl);return user?{id:user.id,installationId:installation.id}:null;},
    isOwner:({principal})=>isHouseOwner(env,principal.id,fetchImpl),
    readEvidence:()=>environmentFeed(env,options),
    response:(req,body,status)=>reply(req,env,body,status),
    repository:{
      listMissions:(_context,{owner})=>missions(env,fetchImpl,owner),
      listAssignments:(_context,ids)=>service(env,`action_mission_assignments?mission_id=in.(${ids.join(',')})&select=id,mission_id,user_id,m_uid,status&order=joined_at.desc&limit=2000`,fetchImpl),
      listProfiles:(_context,ids)=>service(env,`network_profiles?m_uid=in.(${ids.join(',')})&select=m_uid,display_name&limit=200`,fetchImpl),
      team:(_context,{join})=>rpc(request,env,'world_environment_team',{p_join:join},fetchImpl),
      propose:async({principal},{event,action,newsReviewId})=>{
        let news=null;
        if(newsReviewId){news=await planning.approvedContext({eventId:event.id,reviewId:newsReviewId,actionId:action.id});if(!news)throw Object.assign(new Error('current_news_review_required'),{code:'current_news_review_required',status:409});}
        return rpc(request,env,'world_environment_propose',{p_actor:principal.id,p_event:news?{...event,news_context:news}:event,p_action:action},fetchImpl,true);
      },
      review:({principal},{missionId,status})=>rpc(request,env,'world_environment_review',{p_actor:principal.id,p_mission:missionId,p_status:status},fetchImpl,true),
      join:(_context,{missionId})=>rpc(request,env,'world_environment_join',{p_mission:missionId},fetchImpl)
    }
  });
  return controller.handle(request);
}
