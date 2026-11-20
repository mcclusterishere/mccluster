/* McCluster implementation adapter for the private Equity Uprise product.
 * Existing credentials, database/RLS, provider cache and owner checks stay here.
 * No new backend or identity authority is created by this adapter. */
import { createEnvironmentProofAdapter, ENVIRONMENT_PROOF_ERRORS } from './environment-proofs.js';
import { createMcClusterEnvironmentPlanning, ENVIRONMENT_PLANNING_ERROR_CODES } from './environment-planning-mccluster.js';
import { reply } from './lib/http.js';
import { bearerUser, sourceHealth } from './world-layers.js';
import { fetchWeather, fetchNatural } from './world-events.js';
import { fetchQuakes, fetchCyclones } from './world-halo-layers.js';
import { service, uuid } from './world-cctv.js';
import { isHouseOwner } from './world-access.js';
import { MODULE_POLICY_ERRORS } from './eup/modules.js';
import { environmentFeed as productFeed, clip } from '../../../vendor/equity-uprise/src/environment/evidence.mjs';
import { createEnvironmentServer } from '../../../vendor/equity-uprise/src/environment/server.mjs';
import { readModulePolicy as productPolicy, moduleRefusal } from '../../../vendor/equity-uprise/src/server/module-policy.mjs';
import { handleEnvironmentLayers } from './world-environment-layers.js';
import { OFF, gateAnswer, limitPublicRead, policyLoader, policyRead, sharedLayer } from './world-environment-guard.js';
/* the public timeline from the event store, and the public feed's USGS rows from the same store (E=UP slice S4) */
import { handleEnvironmentEvents, storeUsgsReader } from './world-environment-events.js';
export { ENVIRONMENT_PATH, ENVIRONMENT_TEAM, ENVIRONMENT_ACTIONS, environmentFacts } from '../../../vendor/equity-uprise/src/environment/evidence.mjs';
const PROVIDERS = { nws:fetchWeather, eonet:fetchNatural, usgs:fetchQuakes, nhc:fetchCyclones };
const installation = Object.freeze({
  schema:'equity-uprise.installation/v1',id:'mccluster',appOrigin:'https://mccluster.org',apiOrigin:'https://api.mccluster.org',
  brand:{name:'McCluster'},modules:{environment:true}
});
// Module policy is the persisted owner decision, read from the canonical store on every request
// (eup/modules.js -> eup_module_policy_read, service key, no cache), once per request
// (./world-environment-guard.js). There is no built-in policy and nothing defaults to on. Off, outage
// and no data are three answers (E=UP slice S0, 2026-11-19): a module never installed (the store's
// EUM01, no row) answers 404 module_disabled exactly as an installed, disabled one does; an unapplied
// schema, an unreachable store, missing secrets or a malformed answer make loadPolicy throw, and the
// pinned server answers 503 module_policy_unavailable.
// A database refusal of a write (the module guard's SQLSTATEs) is passed to the pinned server with
// the code and status it answers for the same state itself.
const MODULE_REFUSALS = MODULE_POLICY_ERRORS.consumer;
const MODULE_FAILURE_CODES = Object.freeze(Object.values(MODULE_REFUSALS).map(([, code]) => code));
/* Each feed source's health, added beside the pinned product's own source fields (id, label, url,
   status, fetched_at, observed_at, coverage, stale): why it is stale or unavailable, its last
   successful retrieval, and its attribution and licence (docs/control-plane/WORLD-ENVIRONMENT-CONTRACT.md). */
export const FEED_SOURCE_TERMS = Object.freeze({
  nws: Object.freeze({ attribution: 'NOAA National Weather Service', license: 'Public domain (U.S. Government work)' }),
  eonet: Object.freeze({ attribution: 'NASA Earth Observatory Natural Event Tracker (EONET)', license: 'NASA open data; each event names the sources EONET drew it from' }),
  usgs: Object.freeze({ attribution: 'U.S. Geological Survey, Earthquake Hazards Program', license: 'Public domain (U.S. Government work)' }),
  nhc: Object.freeze({ attribution: 'NOAA National Hurricane Center', license: 'Public domain (U.S. Government work)' })
});
/* `usgs`: a reader for the USGS source in place of USGS's live feed. The public answer passes the event store's
   (./world-environment-events.js storeUsgsReader: canonical ids and revisions, never a second id); the owner's live
   provider check (./eup/environment/owner.js) passes none and reads USGS itself. An outcome's `extra` fields are added back
   to its events by id, and its `reason` is the source's (E=UP slice S4). */
export async function environmentFeed(env,{fetchImpl=fetch,cacheImpl=null,usgs=null}={}) {
  const outcomes=new Map();
  const feed=await productFeed({readSource:async spec=>{
    const outcome=spec.id==='usgs'&&typeof usgs==='function'?await usgs(spec):await sharedLayer({layer:spec.id,key:`consumer-environment-v1-${spec.id}`,ttl:spec.ttl,rows:spec.rows,fetcher:PROVIDERS[spec.id]},env,fetchImpl,cacheImpl);
    outcomes.set(spec.id,outcome);return outcome;
  }});
  return {...feed,events:feed.events.map(e=>{const x=outcomes.get(e.source?.id)?.extra?.get?.(e.id);return x?{...e,...x}:e;}),sources:feed.sources.map(source=>{
    const health=sourceHealth({...source,...FEED_SOURCE_TERMS[source.id]},outcomes.get(source.id));
    /* USGS's summary feed says when it was GENERATED (metadata.generated, which the shared reader keeps as observed_at for the
       owner's Halo layer); the source's latest observation is the newest origin time among the quakes served (E=UP slice S0, E6) */
    const observed=source.id==='usgs'?newestObserved(feed.events,'usgs'):source.observed_at;
    const own=outcomes.get(source.id)?.reason;
    return {...source,observed_at:observed,reason:typeof own==='string'?own:health.reason,last_success_at:health.last_success_at,attribution:health.attribution,license:health.license};
  })};
}
function newestObserved(events,provider){
  let best=null;
  for(const e of Array.isArray(events)?events:[]){
    if(!e||e.source?.id!==provider)continue;
    const t=Date.parse(e.observed_at);
    if(Number.isFinite(t)&&(best===null||t>best))best=t;
  }
  return best===null?null:new Date(best).toISOString();
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
/* The gate of the public environmental layers (./world-environment-layers.js): the same persisted
   policy as GET /v1/world/environment, read once per request with the service key and judged by the
   pinned product's own rules (vendor module-policy.mjs), in the order its server applies them. A
   module never installed is off, 404 module_disabled, as a disabled one is; an unapplied, unreachable
   or malformed policy is 503 module_policy_unavailable; draining refuses writes only (these routes are
   reads). Never defaulted to on. `read` is the request's one read (policyRead); without one it reads. */
export async function environmentGate(request, env, fetchImpl = fetch, read = policyRead(env, fetchImpl)) {
  const first = await read();
  if (first.refusal) return first.refusal;
  let policy;
  try { policy = productPolicy(first.policy, installation.id, 'environment'); }
  catch { return { code: 'module_policy_unavailable', status: 503 }; }
  if (!installation.modules.environment) return { code: 'module_disabled', status: 404 };
  return moduleRefusal(policy, request.method);
}
export async function handleWorldEnvironment(request, env, options = {}) {
  const { fetchImpl=fetch }=options;
  /* a client past its share of the public reads is told so before anything is read (release security review SEC-2) */
  const limited=limitPublicRead(request,env,options.limits);
  if(limited)return limited;
  const read=policyRead(env,fetchImpl);
  const gate=()=>environmentGate(request,env,fetchImpl,read);
  const events=await handleEnvironmentEvents(request,env,{...options,gate});
  if(events)return events;
  const layer=await handleEnvironmentLayers(request,env,{...options,gate});
  if(layer)return layer;
  /* a module never installed is off, before the pinned server, which would call any failed read an outage */
  if((await read()).refusal===OFF)return gateAnswer(request,env,{ok:false,code:OFF.code},OFF.status);
  /* the public feed: its USGS rows from the event store, the same canonical ids as the timeline (E=UP slice S4) */
  const publicFeed=()=>environmentFeed(env,{...options,usgs:storeUsgsReader(env,options)});
  const planning=createMcClusterEnvironmentPlanning({request,env,fetchImpl,readEvent:async id=>(await publicFeed()).events.find(event=>event.id===id)});
  const controller=createEnvironmentServer({
    proofs:createEnvironmentProofAdapter(request,env,{fetchImpl}),
    planning,failureCodes:[...ENVIRONMENT_PROOF_ERRORS,...ENVIRONMENT_PLANNING_ERROR_CODES,'current_news_review_required',...MODULE_FAILURE_CODES],
    installation,
    loadPolicy:policyLoader(read,env,fetchImpl),
    authenticate:async()=>{const user=await bearerUser(request,env,fetchImpl);return user?{id:user.id,installationId:installation.id}:null;},
    isOwner:({principal})=>isHouseOwner(env,principal.id,fetchImpl),
    readEvidence:publicFeed,
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
