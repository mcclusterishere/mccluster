/* Canonical acts are reviewed identities, never claims inferred from display names.
   Content/publication remain in managed_projects and its existing public renderer. */
import {reply} from './lib/http.js';
import {supabaseStore,limitedBytes,fail} from './website-studio/service.mjs';
import {isHouseOwner} from './world-access.js';
import {handleManagedProjects} from './managed-projects.js';
export const CANONICAL_ARTISTS=Object.freeze({
 'https://matthew.mccluster.org/#matthew-mccluster':{name:'McCluster',home:'matthew-mccluster.html',logo:'assets/img/m-mark.png'},
 'https://matthew.mccluster.org/catalogue.html#artist-equity-uprise':{name:'Equity Uprise',home:'platform-home.html',logo:'assets/img/equity-uprise-mark-white.png'}
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const knownArtist=id=>Object.hasOwn(CANONICAL_ARTISTS,id)?CANONICAL_ARTISTS[id]:null;
export async function handleCanonicalArtists(request,env,deps={}){
 const u=new URL(request.url),path=u.pathname;
 if(!['/v1/canonical-artists/resolve','/v1/canonical-artists/mine','/v1/canonical-artists/bind','/v1/canonical-artists/grant','/v1/canonical-artists/revoke'].includes(path))return null;
 const send=(body,status=200)=>{const r=reply(request,env,body,status);r.headers.set('cache-control','private, no-store');r.headers.set('vary','Origin, Authorization');return r;};
 try{
  const db=deps.db||supabaseStore(env,deps.fetchImpl),fetchImpl=deps.fetchImpl||fetch;
  if(path.endsWith('/resolve')){
   if(request.method!=='GET')throw fail(405,'Method not allowed');
   const id=u.searchParams.get('id'),known=knownArtist(id);if(!known)throw fail(404,'Artist unavailable');
   const rows=await db.select('canonical_artist_bindings',{artist_id:'eq.'+id,limit:'1'}),b=rows[0];
   if(!b)return send({ok:true,state:'unbound',...known});
   // A revoked/bound private identity never falls through to a matching name.
   if(b.revoked_at)throw fail(404,'Artist destination unavailable');
   if(!b.project_id)return send({ok:true,state:'unbound',...known});
   const [projects,links,people]=await Promise.all([
    db.select('managed_projects',{id:'eq.'+b.project_id,owner_user_id:'eq.'+b.owner_user_id,m_uid:'eq.'+b.m_uid,removed_at:'is.null',limit:'1'},'id,slug'),
    db.select('m_auth_user_links',{auth_user_id:'eq.'+b.owner_user_id,m_uid:'eq.'+b.m_uid,is_primary:'eq.true',limit:'1'},'m_uid'),
    db.select('m_people',{id:'eq.'+b.m_uid,status:'eq.active',limit:'1'},'id')
   ]);
   const project=projects[0];if(!project||!links.length||!people.length||!/^[a-z0-9][a-z0-9-]{2,39}$/.test(project.slug))throw fail(404,'Artist destination unavailable');
   const r=await (deps.projectPublic||handleManagedProjects)(new Request('https://api.mccluster.org/v1/projects/'+project.slug),env,{fetchImpl,expectedAuthUserId:b.owner_user_id,expectedProjectId:b.project_id});
   if(!r?.ok)throw fail(404,'Artist destination unavailable');
   const page=await r.json();
   const current=(await db.select('canonical_artist_bindings',{artist_id:'eq.'+id,revoked_at:'is.null',project_id:'eq.'+b.project_id,limit:'1'},'artist_id'))[0];
   if(!current)throw fail(404,'Artist destination unavailable');
   return send({ok:true,state:'bound',name:known.name,logo:known.logo,home:(page.presentation==='tiles'?'website-studio-view.html':'front.html')+'?project='+encodeURIComponent(project.slug)});
  }
  const actor=await db.actor(request);
  if(path.endsWith('/mine')){
   if(request.method!=='GET')throw fail(405,'Method not allowed');
   const rows=await db.select('canonical_artist_bindings',{owner_user_id:'eq.'+actor.auth_uid,m_uid:'eq.'+actor.m_uid,revoked_at:'is.null'},'artist_id,project_id');
   return send({ok:true,grants:rows.filter(b=>knownArtist(b.artist_id)).map(b=>({artist_id:b.artist_id,name:knownArtist(b.artist_id).name,project_id:b.project_id}))});
  }
  if(request.method!=='POST')throw fail(405,'Method not allowed');
  let b;try{b=JSON.parse(new TextDecoder().decode(await limitedBytes(request,2048)));}catch{throw fail(400,'Invalid binding request');}
  const action=path.split('/').pop(),allowed=action==='bind'?['artist_id','project_id']:action==='grant'?['artist_id','owner_user_id','provenance']:['artist_id','provenance'];
  if(!b||Array.isArray(b)||Object.keys(b).some(k=>!allowed.includes(k))||!knownArtist(b.artist_id))throw fail(400,'Choose a known canonical artist');
  if(action==='bind'){
   if(!UUID.test(b.project_id||''))throw fail(400,'Choose an owned project');
  }else{
   if(!(await isHouseOwner(env,actor.auth_uid,fetchImpl)))throw fail(403,'McCluster house owner access required');
   if(typeof b.provenance!=='string'||b.provenance.trim().length<10||b.provenance.length>500||action==='grant'&&!UUID.test(b.owner_user_id||''))throw fail(400,'Reviewed owner and provenance required');
  }
  try{await db.rpc('canonical_artist_binding_v1',{p_action:action,p_artist:b.artist_id,p_actor:actor.auth_uid,p_owner:b.owner_user_id||null,p_project:b.project_id||null,p_provenance:b.provenance?.trim()||null});}
  catch(e){throw fail(e.status||503,e.status===403?'This grant or project is no longer available to your account. Refresh your projects.':e.status===409?'This artist already has a grant or permanent binding. A reviewed authority change is required.':'Artist binding could not be confirmed. Refresh its status before trying again.');}
  return send({ok:true});
 }catch(e){return send({ok:false,error:e.status?e.message:'Artist binding is unavailable',code:e.status===404?'destination_unavailable':'binding_unavailable'},e.status||503);}
}
