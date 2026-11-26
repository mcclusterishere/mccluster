/* A tenant projection of canonical public native posts, never a second feed store. */
import {reply} from './lib/http.js';
import {supabaseStore,fail} from './website-studio/service.mjs';
import {siteModuleEnabled} from './customer-site-modules.js';
import {handleManagedProjects} from './managed-projects.js';
import {handleMemberFronts} from './member-fronts.js';
export async function handleCustomerSiteWorld(request,env,deps={}){
 const url=new URL(request.url);if(url.pathname!=='/v1/customer-site/world')return null;
 const send=(b,s=200)=>{const r=reply(request,env,b,s);r.headers.set('cache-control','private, no-store');return r;};
 if(env.CUSTOMER_SITE_OFFER_ENABLED!=='true')return send({error:'Website World module is unavailable'},503);
 if(request.method!=='GET')return send({error:'Method not allowed'},405);
 try{
  const db=deps.db||supabaseStore(env,deps.fetchImpl),project=url.searchParams.get('project'),owner=url.searchParams.get('owner');let row,kind,key,page;
  if(project&&/^[a-z0-9][a-z0-9-]{2,39}$/.test(project)){
   row=(await db.select('managed_projects',{slug:'eq.'+project,removed_at:'is.null',limit:'1'}))[0];kind='project';key=project;
   if(row)page=await (deps.projectPublic||handleManagedProjects)(new Request('https://api.mccluster.org/v1/projects/'+project),env,deps);
  }else if(owner&&/^[0-9a-f-]{36}$/.test(owner)){
   row=(await db.select('member_fronts',{auth_user_id:'eq.'+owner,removed_at:'is.null',published:'not.is.null',limit:'1'}))[0];kind='front';key='me';
   if(row){row={...row,owner_user_id:row.auth_user_id,name:row.handle};page=await (deps.frontPublic||handleMemberFronts)(new Request('https://api.mccluster.org/v1/fronts/'+row.handle),env,{...deps,expectedAuthUserId:owner});}
  }
  if(!row||!page?.ok)throw fail(404,'Website is not public');
  if(!await siteModuleEnabled(db,row.owner_user_id,kind,key,'world'))throw fail(403,'World is switched off for this website');
  const filters={author_m_uid:'eq.'+row.m_uid,visibility:'eq.public',deleted_at:'is.null',removed_at:'is.null',reply_to_id:'is.null',group_id:'is.null',order:'created_at.desc',limit:'40'};
  // Project updates must be explicitly attributed to this site by its owner.
  // Personal fronts show their owner's public posts; never mix sibling project posts.
  if(kind==='project')filters['metadata->>site_project']='eq.'+key;
  const posts=await db.select('network_posts',filters,'id,body,created_at');
  return send({ok:true,name:row.name||row.handle,home:kind==='project'?'front.html?project='+encodeURIComponent(key):'front.html?u='+encodeURIComponent(row.handle),site_modules:{world:true,world_href:'customer-world.html'+url.search},posts:posts.map(p=>({id:p.id,body:typeof p.body==='string'?p.body:'',created_at:p.created_at,href:'mnet.html?view=feed&post='+encodeURIComponent(p.id)}))});
 }catch(e){return send({error:e.status?e.message:'Website World is unavailable'},e.status||503);}
}
