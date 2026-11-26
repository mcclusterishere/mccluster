/* Architecture-only server boundary. No provider adapter, activation flag,
   network request, creative, revenue promise or payout side effect exists. */
import {reply} from './lib/http.js';
import {supabaseStore,fail} from './website-studio/service.mjs';
export const AD_PLACEMENTS=Object.freeze({profile_footer:'display',project_inline:'display',music_between_tracks:'audio'});
export function disabledAdvertisingDecision({owner,kind,key,placement}){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner||'')||!['front','project'].includes(kind)||(kind==='front'?key!=='me':!/^[a-z0-9][a-z0-9-]{2,39}$/.test(key||'')))throw fail(400,'Invalid owned website');
 if(!Object.hasOwn(AD_PLACEMENTS,placement))throw fail(400,'Unknown advertising placement');
 if(kind==='front'&&placement==='project_inline'||kind==='project'&&placement==='profile_footer')throw fail(400,'Placement does not belong to this website type');
 return {status:'disabled',reason:'architecture_only',placement,format:AD_PLACEMENTS[placement],fill:null,provider:null,external_requests:0,continue_content:true,no_fill:AD_PLACEMENTS[placement]==='audio'?'continue_playback':'collapse',arbitrary_track_interruption:false,economics:null,domain_purchase_required:false};
}
export async function handleCustomerSiteAdvertising(request,env,deps={}){
 const u=new URL(request.url);if(u.pathname!=='/v1/customer-site/advertising')return null;
 const send=(b,s=200)=>{const r=reply(request,env,b,s);r.headers.set('cache-control','private, no-store');return r;};
 try{
  if(request.method!=='GET')throw fail(405,'Method not allowed');
  if([...u.searchParams.keys()].some(k=>!['project','placement'].includes(k)))throw fail(400,'Unsupported advertising parameters');
  const db=deps.db||supabaseStore(env,deps.fetchImpl),actor=await db.actor(request),key=u.searchParams.get('project')||'me',kind=key==='me'?'front':'project';
  const decision=disabledAdvertisingDecision({owner:actor.auth_uid,kind,key,placement:u.searchParams.get('placement')});
  if(kind==='project'&&!(await db.select('managed_projects',{slug:'eq.'+key,owner_user_id:'eq.'+actor.auth_uid,m_uid:'eq.'+actor.m_uid,removed_at:'is.null',limit:'1'},'slug')).length)throw fail(404,'Website not found in your account');
  return send({ok:true,source:{kind,key},decision});
 }catch(e){return send({error:e.status?e.message:'Advertising policy is unavailable'},e.status||503);}
}
