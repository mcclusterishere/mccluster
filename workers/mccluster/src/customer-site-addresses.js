import {reply} from './lib/http.js';
import {supabaseStore,limitedBytes,fail} from './website-studio/service.mjs';
import {handleManagedProjects} from './managed-projects.js';
import {handleMemberFronts} from './member-fronts.js';
export const SITE_RESERVED=new Set(['admin','api','assets','auth','account','company','control','css','data','docs','healthz','index','js','llms','main','mnet','music','news','platform','robots','scripts','sitemap','supabase','v1','workers','world','www','vaunt']);
const SLUG=/^[a-z0-9][a-z0-9-]{2,39}$/;
export async function handleCustomerSiteAddress(request,env,deps={}){
 const u=new URL(request.url);if(u.pathname!=='/v1/customer-site/address')return null;
 const send=(d,s=200)=>{const r=reply(request,env,d,s);r.headers.set('cache-control','private, no-store');return r;};
 if(env.CUSTOMER_SITE_OFFER_ENABLED!=='true')return send({error:'Free website addresses are not enabled yet'},503);
 try{
  const db=deps.db||supabaseStore(env,deps.fetchImpl),a=await db.actor(request),key=u.searchParams.get('project')||'me',kind=key==='me'?'front':'project';
  if(kind==='project'){
   if(!SLUG.test(key))throw fail(400,'Invalid project');
   if(!(await db.select('managed_projects',{slug:'eq.'+key,owner_user_id:'eq.'+a.auth_uid,m_uid:'eq.'+a.m_uid,removed_at:'is.null',limit:'1'},'slug')).length)throw fail(404,'Project not found in your account');
  }
  if(request.method==='POST'){
   let b;try{b=JSON.parse(new TextDecoder().decode(await limitedBytes(request,1024)));}catch{throw fail(400,'Address required');}
   if(!b||Object.keys(b).some(k=>k!=='slug')||!SLUG.test(b.slug)||SITE_RESERVED.has(b.slug))throw fail(400,'Choose an available address of 3–40 lowercase letters, numbers or hyphens');
   try{await db.rpc('customer_site_address_assign_v1',{p_user:a.auth_uid,p_actor:a.m_uid,p_kind:kind,p_key:key,p_slug:b.slug});}catch(e){if(e.status===409)throw fail(409,'This address or website already has an assignment');throw e;}
  }else if(request.method!=='GET')throw fail(405,'Method not allowed');
  const rows=await db.select('customer_site_addresses',{owner_user_id:'eq.'+a.auth_uid,source_kind:'eq.'+kind,source_key:'eq.'+key,limit:'1'},'slug');
  return send({ok:true,address:rows[0]?{slug:rows[0].slug,url:'https://mccluster.org/'+rows[0].slug}:null});
 }catch(e){return send({error:e.status?e.message:'Website addresses are unavailable'},e.status||503);}
}
export async function customerSiteAddressResponse(request,env={},fetchImpl=fetch,deps={}){
 const u=new URL(request.url);if(!['mccluster.org','www.mccluster.org'].includes(u.hostname)||env.CUSTOMER_SITE_OFFER_ENABLED!=='true')return null;
 // Only read-only public renderers are exposed on this host. Auth/editor/API
 // paths keep their existing routing and cannot acquire an alias binding.
 if(u.hostname==='mccluster.org'&&request.method==='GET'){
  if(/^\/v1\/fronts\/[a-z0-9][a-z0-9._-]{2,39}$/.test(u.pathname)&&!u.pathname.endsWith('/me'))return handleMemberFronts(new Request(u),env,{fetchImpl});
  if(/^\/v1\/projects\/[a-z0-9][a-z0-9-]{2,39}(?:\/tiles\/public)?$/.test(u.pathname))return handleManagedProjects(new Request(u),env,{fetchImpl});
 }
 const match=u.pathname.match(/^\/([a-z0-9][a-z0-9-]{2,39})\/?$/);if(!match||SITE_RESERVED.has(match[1]))return null;
 try{
  const db=deps.db||supabaseStore(env,fetchImpl),rows=await db.select('customer_site_addresses',{slug:'eq.'+match[1],limit:'1'}),alias=rows[0];
  if(!alias)return null; // preserve the pre-existing legacy redirect for unassigned paths
  if(u.hostname==='www.mccluster.org'||u.pathname.endsWith('/'))return Response.redirect('https://mccluster.org/'+match[1]+u.search,301);
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
  const project=alias.source_kind==='project';let key=alias.source_key;
  if(!project){const rows=await db.select('member_fronts',{auth_user_id:'eq.'+alias.owner_user_id,removed_at:'is.null',limit:'1'},'handle');key=rows[0]?.handle;}
  if(!key)return new Response('Website is not public',{status:404,headers:{'cache-control':'no-store'}});
  const publicRequest=new Request('https://api.mccluster.org'+(project?'/v1/projects/':'/v1/fronts/')+encodeURIComponent(key));
  const response=await (project?(deps.projectPublic||handleManagedProjects):(deps.frontPublic||handleMemberFronts))(publicRequest,env,{fetchImpl,expectedAuthUserId:alias.owner_user_id});
  if(!response.ok)return new Response('Website is not public',{status:404,headers:{'cache-control':'no-store'}});
  const data=await response.json(),tiles=data.presentation==='tiles';
  const page=await fetchImpl('https://matthew.mccluster.org/'+(tiles?'website-studio-view.html':'front.html'));
  if(!page.ok)throw fail(503,'Website presentation unavailable');
  const binding=JSON.stringify({handle:key,project:project?key:null,api:u.origin}).replace(/</g,'\\u003c');
  const html=(await page.text()).replace(/<head([^>]*)>/i,`<head$1><base href="https://matthew.mccluster.org/"><script>window.${tiles?'MCC_STUDIO_HOST':'MCC_FRONT_HOST'}=${binding};</script>`);
  return new Response(request.method==='HEAD'?null:html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
 }catch{return new Response('Website addresses are temporarily unavailable',{status:503,headers:{'cache-control':'no-store'}});}
}
