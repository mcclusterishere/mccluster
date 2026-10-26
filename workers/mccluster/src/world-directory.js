/* Explicit owner opt-in directory. No scraped entities, visitor coordinates or inferred locations. */
import { reply } from './lib/http.js';
export const WORLD_DIRECTORY_PREFIX='/v1/world-directory';
export const DIRECTORY_TYPES=['business','service','project'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG=/^[a-z0-9][a-z0-9-]{2,39}$/;
const CATEGORIES=['creative','music','technology','education','home','professional','community','other'];
const unavailable=[{type:'event',reason:'Customer event ownership and publication are not connected to this directory.'},{type:'campaign',reason:'Campaign ownership and publication are not connected to this directory.'}];
const fields='id,owner_user_id,m_uid,source_kind,source_key,entity_type,title,description,category,location_label,service_area,online_only,is_listed,updated_at';
const clean=(v,max)=>typeof v==='string'?v.trim().replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max):'';
export async function handleWorldDirectory(request,env,{fetchImpl=fetch}={}){
 const url=new URL(request.url),path=url.pathname.replace(/\/+$/,'');
 if(path!==WORLD_DIRECTORY_PREFIX&&!path.startsWith(WORLD_DIRECTORY_PREFIX+'/'))return null;
 const send=(body,status=200)=>{const r=reply(request,env,body,status);r.headers.set('cache-control','private, no-store');return r;};
 const err=(message,status,code)=>send({ok:false,error:message,code},status);
 if(!env?.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return err('World directory is not configured',503,'unavailable');
 async function db(query,init={}){
  const r=await fetchImpl(env.SUPABASE_URL+'/rest/v1/'+query,{...init,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json',prefer:'return=representation',...init.headers}});
  const body=await r.json().catch(()=>null);if(!r.ok)throw Object.assign(new Error('Directory unavailable'),{status:body?.code==='23505'?409:503});return body;
 }
 // Every result is rechecked against its source; metadata alone cannot publish a hidden page.
 async function available(rows){
  if(!rows.length)return [];
  const ids=[...new Set(rows.map(r=>r.m_uid).filter(x=>UUID.test(x)))];
  const profiles=ids.length?await db(`network_profiles?m_uid=in.(${ids.join(',')})&visibility=eq.public&discoverable=eq.true&select=m_uid,visibility,discoverable`):[];
  const open=new Set(profiles.filter(p=>p.visibility==='public'&&p.discoverable===true).map(p=>p.m_uid));
  const projects=[...new Set(rows.filter(r=>r.source_kind==='project'&&SLUG.test(r.source_key)).map(r=>r.source_key))];
  const frontIds=[...new Set(rows.filter(r=>r.source_kind==='front'&&UUID.test(r.m_uid)).map(r=>r.m_uid))];
  const [p,f]=await Promise.all([
   projects.length?db(`managed_projects?slug=in.(${projects.join(',')})&removed_at=is.null&published=not.is.null&select=slug,owner_user_id,m_uid,published_at`):[],
   frontIds.length?db(`member_fronts?m_uid=in.(${frontIds.join(',')})&removed_at=is.null&published=not.is.null&select=m_uid,auth_user_id,handle,published_at`):[]
  ]);
  return rows.flatMap(r=>{
   if(!open.has(r.m_uid))return [];
   const source=r.source_kind==='project'?p.find(p=>p.slug===r.source_key&&p.owner_user_id===r.owner_user_id&&p.m_uid===r.m_uid):f.find(f=>f.m_uid===r.m_uid&&f.auth_user_id===r.owner_user_id);
   if(!source?.published_at)return [];
   const href=r.source_kind==='project'?'front.html?project='+encodeURIComponent(r.source_key):'front.html?u='+encodeURIComponent(source.handle);
   return [{id:r.id,type:r.entity_type,title:r.title,description:r.description,category:r.category,location:r.online_only?'Online':r.location_label,service_area:r.online_only?'':r.service_area,online_only:r.online_only,href,provenance:'Owner-provided listing linked to an owned published page',source:{kind:r.source_kind,key:r.source_kind==='project'?r.source_key:source.handle},updated_at:r.updated_at}];
  });
 }
 try{
  if(path===WORLD_DIRECTORY_PREFIX&&request.method==='GET'){
   const type=url.searchParams.get('type')||'',category=url.searchParams.get('category')||'',online=url.searchParams.get('online')||'';
   if(type&&!DIRECTORY_TYPES.includes(type))return err('This entity type is not supported by the directory',400,'unsupported_type');
   if(category&&!CATEGORIES.includes(category))return err('Unknown category',400,'invalid_category');
   if(online&&!['true','false'].includes(online))return err('Invalid online filter',400,'invalid_filter');
   const q=clean(url.searchParams.get('q'),120).match(/[\p{L}\p{N}]+/gu)?.join(' & ')||'';
   const location=clean(url.searchParams.get('location'),100).replace(/[^\p{L}\p{N} -]/gu,'');
   let query=`world_directory_listings?is_listed=eq.true&select=${fields}&order=updated_at.desc,id&limit=101`;
   if(type)query+='&entity_type=eq.'+type;
   if(category)query+='&category=eq.'+category;
   if(online)query+='&online_only=eq.'+online;
   if(q)query+='&search_document=fts(simple).'+encodeURIComponent(q);
   if(location)query+='&location_search=ilike.'+encodeURIComponent('*'+location+'*');
   const rows=await db(query),items=await available(rows.slice(0,100));
   return send({ok:true,items,truncated:rows.length>100,supported_types:DIRECTORY_TYPES,unavailable_types:unavailable,categories:CATEGORIES,coverage:'Opt-in owner listings only. Refine filters when the first 100 candidates are reached.'});
  }
  if(path!==WORLD_DIRECTORY_PREFIX+'/me')return err('Not found',404,'not_found');
  const auth=request.headers.get('authorization')||'';if(!/^Bearer \S+$/i.test(auth))return err('Sign in to manage listings',401,'signin');
  const r=await fetchImpl(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:auth}});
  const user=r.ok?await r.json():null;if(!UUID.test(user?.id||''))return err('Sign in to manage listings',401,'signin');
  const links=await db(`m_auth_user_links?auth_user_id=eq.${user.id}&is_primary=eq.true&select=m_uid&limit=1`),muid=links?.[0]?.m_uid;
  if(!UUID.test(muid||''))return err('Complete your M Account first',409,'profile_required');
  const owner=`owner_user_id=eq.${user.id}&m_uid=eq.${muid}`;
  if(request.method==='GET'){
   const [rows,projects,fronts]=await Promise.all([
    db(`world_directory_listings?${owner}&select=${fields}&order=updated_at.desc&limit=100`),
    db(`managed_projects?owner_user_id=eq.${user.id}&m_uid=eq.${muid}&removed_at=is.null&select=slug,name&limit=100`),
    db(`member_fronts?auth_user_id=eq.${user.id}&m_uid=eq.${muid}&removed_at=is.null&select=handle&limit=1`)
   ]);
   const visible=new Set((await available(rows.filter(r=>r.is_listed))).map(r=>r.id));
   return send({ok:true,listings:rows.map(r=>({...r,publicly_available:visible.has(r.id)})),sources:[...fronts.map(f=>({kind:'front',key:'me',name:'Personal page @'+f.handle})),...projects.map(p=>({kind:'project',key:p.slug,name:p.name}))],categories:CATEGORIES,supported_types:DIRECTORY_TYPES});
  }
  if(request.method!=='POST'&&request.method!=='DELETE')return err('Method not allowed',405,'method');
  const b=await request.json().catch(()=>null);if(!b||typeof b!=='object'||Array.isArray(b))return err('JSON object required',400,'invalid');
  if(request.method==='DELETE'){
   if(!UUID.test(b.id||''))return err('Valid listing ID required',400,'invalid');
   const rows=await db(`world_directory_listings?${owner}&id=eq.${b.id}`,{method:'DELETE'});
   return rows?.length?send({ok:true}):err('Listing not found in your account',404,'not_found');
  }
  if(['owner_user_id','m_uid','latitude','longitude','lat','lon','href','source_url'].some(k=>k in b))return err('Ownership, coordinates and destination links are not client-assigned',400,'protected_fields');
  if(!DIRECTORY_TYPES.includes(b.entity_type)||!CATEGORIES.includes(b.category))return err('Choose a supported type and category',400,'invalid');
  if(!['front','project'].includes(b.source_kind)||(b.source_kind==='project'&&!SLUG.test(b.source_key||''))||(b.source_kind==='front'&&b.source_key!=='me'))return err('Choose one of your pages',400,'invalid_source');
  const sources=b.source_kind==='project'?await db(`managed_projects?owner_user_id=eq.${user.id}&m_uid=eq.${muid}&slug=eq.${b.source_key}&removed_at=is.null&select=slug`):await db(`member_fronts?auth_user_id=eq.${user.id}&m_uid=eq.${muid}&removed_at=is.null&select=handle`);
  if(!sources.length)return err('Page not found in your account',404,'not_found');
  const title=clean(b.title,100),description=clean(b.description,500),location=clean(b.location_label,100),area=clean(b.service_area,160);
  if(!title||typeof b.online_only!=='boolean'||typeof b.is_listed!=='boolean'||(!b.online_only&&!location))return err('Provide a title and either online-only or a public locality',400,'invalid');
  if(b.is_listed&&b.location_consent!==true)return err('Confirm that your listing details are intended for public display',400,'consent_required');
  const record={owner_user_id:user.id,m_uid:muid,source_kind:b.source_kind,source_key:b.source_key,entity_type:b.entity_type,title,description,category:b.category,online_only:b.online_only,location_label:b.online_only?'':location,service_area:b.online_only?'':area,is_listed:b.is_listed,updated_at:new Date().toISOString()};
  let saved;
  if(b.id){if(!UUID.test(b.id))return err('Invalid listing ID',400,'invalid');saved=await db(`world_directory_listings?${owner}&id=eq.${b.id}`,{method:'PATCH',body:JSON.stringify(record)});if(!saved.length)return err('Listing not found in your account',404,'not_found');}
  else saved=await db('world_directory_listings',{method:'POST',body:JSON.stringify(record)});
  return send({ok:true,listing:saved[0],publicly_available:(await available(saved.filter(r=>r.is_listed))).length>0});
 }catch(e){return err(e.status===409?'A listing already exists for this page and type. Edit it instead.':'World directory is unavailable. Try again later.',e.status===409?409:503,e.status===409?'duplicate':'unavailable');}
}
