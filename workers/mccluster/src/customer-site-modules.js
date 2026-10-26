/* Customer configuration of existing capabilities. This is not the operator app registry
   or a second entitlement system. Global M Account membership remains independent. */
import {reply} from './lib/http.js';
import {supabaseStore, limitedBytes, fail} from './website-studio/service.mjs';

export const SITE_MODULES = Object.freeze([
  {key:'site', name:'Website', required:true, configurable:false, capability:'managed-projects', description:'Your profile, drafts, media and published website.'},
  {key:'world_discovery', name:'World discovery', required:false, configurable:true, capability:'world-directory', description:'Allow this website to appear in World after you create a public listing. Your personal World membership is separate.'},
  {key:'hosting', name:'Custom hosting', required:false, configurable:false, capability:'creator-domains', description:'Optional paid hosting. Availability and entitlement are checked in Domains.'},
  {key:'advertising', name:'Advertising', required:false, configurable:false, capability:null, description:'Planned. No ads or advertising requests are enabled.'}
]);

export async function siteModuleEnabled(db, owner, kind, key, module='world_discovery') {
  const rows=await db.select('customer_site_modules',{owner_user_id:'eq.'+owner,source_kind:'eq.'+kind,source_key:'eq.'+key,module_key:'eq.'+module,limit:'1'},'enabled');
  return rows[0]?.enabled===true;
}

export async function handleCustomerSiteModules(request,env,deps={}) {
  const url=new URL(request.url);if(url.pathname!=='/v1/customer-site/modules')return null;
  const send=(body,status=200)=>{const r=reply(request,env,body,status);r.headers.set('cache-control','private, no-store');r.headers.set('vary','Origin, Authorization');return r;};
  if(env.CUSTOMER_SITE_OFFER_ENABLED!=='true')return send({error:'Website module settings are not enabled yet',code:'unconfigured'},503);
  try {
    const db=deps.db||supabaseStore(env,deps.fetchImpl),actor=await db.actor(request);
    const key=url.searchParams.get('project')||'me',kind=key==='me'?'front':'project';
    if(kind==='project'){
      if(!/^[a-z0-9][a-z0-9-]{2,39}$/.test(key))throw fail(400,'Invalid website');
      const rows=await db.select('managed_projects',{slug:'eq.'+key,owner_user_id:'eq.'+actor.auth_uid,m_uid:'eq.'+actor.m_uid,removed_at:'is.null',limit:'1'},'slug');
      if(!rows.length)throw fail(404,'Website not found in your account');
    }
    if(request.method==='POST') {
      let b;try{b=JSON.parse(new TextDecoder().decode(await limitedBytes(request,2048)));}catch(e){throw fail(e.status||400,'Invalid module settings');}
      if(!b||Object.keys(b).some(k=>!['module','enabled'].includes(k))||typeof b.enabled!=='boolean'||!SITE_MODULES.some(m=>m.key===b.module&&m.configurable))throw fail(400,'Choose a configurable website module');
      await db.rpc('customer_site_module_set_v1',{p_user:actor.auth_uid,p_actor:actor.m_uid,p_kind:kind,p_key:key,p_module:b.module,p_enabled:b.enabled});
    } else if(request.method!=='GET')throw fail(405,'Method not allowed');
    const enabled=await siteModuleEnabled(db,actor.auth_uid,kind,key);
    return send({ok:true,source:{kind,key},modules:SITE_MODULES.map(m=>({...m,enabled:m.required||m.key==='world_discovery'&&enabled})),global_membership_unchanged:true});
  }catch(e){return send({error:e.status?e.message:'Website module settings are unavailable',code:e.status===404?'not_found':'unavailable'},e.status||503);}
}
