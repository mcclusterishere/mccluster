/* PR493's template/revision/private-media contracts attached to the existing managed project owner.
   No alternate identity, project registry, entitlement grant or public media bucket. */
import {reply} from './lib/http.js';
import {siteModuleProjection} from './customer-site-modules.js';
import {assertDocument} from '../../../js/website-studio/contract.mjs';
import {supabaseStore,resolveDocument,limitedBytes,handleWebsiteStudio,fail} from './website-studio/service.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRICES=['CREATOR_STARTER_MONTHLY_PRICE_ID','CREATOR_STARTER_ANNUAL_PRICE_ID','CREATOR_PLUS_MONTHLY_PRICE_ID','CREATOR_PLUS_ANNUAL_PRICE_ID','CREATOR_PRO_MONTHLY_PRICE_ID','CREATOR_PRO_ANNUAL_PRICE_ID','CREATOR_BUSINESS_MONTHLY_PRICE_ID','CREATOR_BUSINESS_ANNUAL_PRICE_ID'];
async function json(request){try{return JSON.parse(new TextDecoder().decode(await limitedBytes(request,40000)));}catch(e){if(e.status)throw e;throw fail(400,'Invalid JSON');}}
async function profile(db,muid){const rows=await db.select('network_profiles',{m_uid:'eq.'+muid,limit:'1'},'visibility');return rows[0]?.visibility||null;}
export async function projectTileAccess(db,env,user,org,{fetchImpl=fetch,provider=false}={}){
 if(!UUID.test(user||'')||!UUID.test(org||''))throw fail(403,'Choose an active paid workspace');
 const memberships=await db.select('org_members',{org_id:'eq.'+org,profile_id:'eq.'+user,role:'in.(owner,admin)',limit:'1'},'org_id');
 const allowed=new Set(PRICES.map(k=>env[k]).filter(Boolean));
 const subscriptions=await db.select('creator_billing_subscriptions',{owner_user_id:'eq.'+user,org_id:'eq.'+org,status:'eq.active',current_period_end:'gt.'+new Date().toISOString()},'stripe_subscription_id,stripe_price_id,status,current_period_end');
 const valid=subscriptions.filter(s=>s.status==='active'&&Date.parse(s.current_period_end)>Date.now()&&allowed.has(s.stripe_price_id));
 if(!memberships.length||!valid.length)throw fail(403,'An active paid workspace you own is required for tile publication');
 if(!provider)return;
 if(!env.STRIPE_SECRET_KEY)throw fail(503,'Subscription verification is not configured');
 for(const s of valid){
  const r=await fetchImpl('https://api.stripe.com/v1/subscriptions/'+encodeURIComponent(s.stripe_subscription_id),{headers:{authorization:'Bearer '+env.STRIPE_SECRET_KEY},signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw fail(503,'Subscription verification is unavailable');const current=await r.json();
  if(current.status==='active'&&current.metadata?.mccluster_user_id===user&&current.items?.data?.some(i=>i.price?.id===s.stripe_price_id))return;
 }
 throw fail(403,'Subscription is no longer active');
}
export async function handleProjectTiles(request,env,deps={}){
 const path=new URL(request.url).pathname;
 // Keep PR493's one registered-media and compute API; do not mount its competing legacy drafts/publisher.
 if(/^\/v1\/creator-sites\/studio\/(?:assets(?:\/|$)|uploads$|processor\/)/.test(path))return handleWebsiteStudio(request,env,{...deps,fetch:deps.fetchImpl||deps.fetch});
 const match=path.match(/^\/v1\/projects\/([a-z0-9][a-z0-9-]{2,39})\/tiles(?:\/(templates|preview|publish|public))?$/);
 if(!match)return null;
 const send=(body,status=200)=>{const r=reply(request,env,body,status);r.headers.set('cache-control','private, no-store');r.headers.set('vary','Origin, Authorization');return r;};
 if(env.WEBSITE_STUDIO_ENABLED!=='true')return send({error:'Tile studio is not enabled yet',code:'unconfigured'},503);
 try{
  const db=deps.db||supabaseStore(env,deps.fetchImpl||deps.fetch),slug=match[1],action=match[2]||'',publicRead=action==='public'&&request.method==='GET';
  const actor=publicRead?null:await db.actor(request);
  if(actor&&deps.expectedAuthUserId&&deps.expectedAuthUserId!==actor.auth_uid)throw fail(404,'Project unavailable');
  const filters={slug:'eq.'+slug,limit:'1'};
  if(actor){filters.owner_user_id='eq.'+actor.auth_uid;filters.m_uid='eq.'+actor.m_uid;}
  if(deps.expectedAuthUserId)filters.owner_user_id='eq.'+deps.expectedAuthUserId;
  if(deps.expectedProjectId)filters.id='eq.'+deps.expectedProjectId;
  const rows=await db.select('managed_projects',filters),project=rows[0];
  if(!project||project.removed_at)throw fail(404,'Project unavailable');
  const visibility=await profile(db,project.m_uid);
  if(publicRead){
   if(project.presentation!=='tiles'||!project.studio_revision_id||visibility!=='public')throw fail(404,'Project is not public');
   if(project.studio_org_id)await projectTileAccess(db,env,project.owner_user_id,project.studio_org_id);
   else if(env.CUSTOMER_SITE_OFFER_ENABLED!=='true')throw fail(503,'Free website publication is not enabled');
   const revisions=await db.select('creator_site_revisions',{id:'eq.'+project.studio_revision_id,owner_m_uid:'eq.'+project.m_uid,draft_id:'eq.'+project.studio_draft_id,limit:'1'});
   if(!revisions[0])throw fail(404,'Published revision unavailable');
   return send({...await resolveDocument(db,project.m_uid,revisions[0].document,'publish'),project:slug,revision:revisions[0].draft_revision,published_at:project.studio_published_at,site_modules:await siteModuleProjection(env,project.owner_user_id,'project',slug,deps.fetchImpl,db)});
  }
  if(action==='templates'&&request.method==='GET')return send({templates:await db.select('creator_site_template_versions',{status:'eq.active'},'template_key,version,definition,guidance')});
  const draft=project.studio_draft_id?(await db.select('creator_site_drafts',{id:'eq.'+project.studio_draft_id,owner_m_uid:'eq.'+actor.m_uid,limit:'1'}))[0]:null;
  if(!action&&request.method==='GET')return send({project:slug,draft:draft||null,presentation:project.presentation||'front',published_revision:project.studio_revision_id||null,profile_visibility:visibility,free_publication:env.CUSTOMER_SITE_OFFER_ENABLED==='true'});
  if(!action&&request.method==='PUT'){
   const b=await json(request);assertDocument(b.document);if(!Number.isSafeInteger(b.expected_revision)||b.expected_revision<0)throw fail(400,'Expected revision required');
   const saved=await db.rpc('project_tile_save_v1',{p_user:actor.auth_uid,p_actor:actor.m_uid,p_slug:slug,p_expected:b.expected_revision,p_document:b.document});return send(saved);
  }
  if(action==='preview'&&request.method==='POST'){
   if(!draft)throw fail(409,'Save your template draft first');return send(await resolveDocument(db,actor.m_uid,draft.document));
  }
  if(action==='publish'&&request.method==='POST'){
   const b=await json(request);if(!draft||b.expected_revision!==draft.revision||b.confirm_public!==true)throw fail(409,'Save and review the current revision before publishing');
   if(visibility!=='public')throw fail(409,'Set your profile public before publishing');
   if(project.registry_key)throw fail(409,'This project has a protected repository presentation');
   const free=env.CUSTOMER_SITE_OFFER_ENABLED==='true';
   if(!free)await projectTileAccess(db,env,actor.auth_uid,b.org_id,{fetchImpl:deps.fetchImpl||fetch,provider:true});
   if(draft.document.tiles.some(t=>!t.source_ref))throw fail(400,'Each tile needs approved media');
   await resolveDocument(db,actor.m_uid,draft.document,'publish');
   const result=await db.rpc(free?'project_tile_publish_free_v1':'project_tile_publish_v1',{p_user:actor.auth_uid,p_actor:actor.m_uid,p_slug:slug,p_expected:draft.revision,...(free?{}:{p_org:b.org_id})});
   return send({...result,published:true,presentation:'tiles',url:'https://matthew.mccluster.org/website-studio-view.html?project='+slug});
  }
  return send({error:'Method not allowed'},405);
 }catch(e){return send({error:e.status?e.message:e instanceof TypeError?e.message:'Tile studio temporarily unavailable'},e.status||(e instanceof TypeError?400:503));}
}
