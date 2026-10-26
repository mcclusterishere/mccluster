import {assertDocument,resourceBindings} from '../../../../js/website-studio/contract.mjs';
const PREFIX='/v1/creator-sites/studio';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILES={'desktop.mp4':'video/mp4','phone.mp4':'video/mp4','video.mp4':'video/mp4','poster.jpg':'image/jpeg','panorama.jpg':'image/jpeg','audio.m4a':'audio/mp4'};
export const fail=(status,message)=>Object.assign(new Error(message),{status});
export async function limitedBytes(request,limit){
 if(Number(request.headers.get('content-length'))>limit)throw fail(413,'Request too large');
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();let total=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();throw fail(413,'Request too large');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}return bytes;
}
const json=async r=>{try{return JSON.parse(new TextDecoder().decode(await limitedBytes(r,40000)));}catch(e){if(e.status)throw e;throw fail(400,'Invalid JSON');}};
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))).map(x=>x.toString(16).padStart(2,'0')).join('');
const secret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join('');
const id=value=>{if(!UUID.test(value||''))throw fail(400,'Invalid identifier');return value;};
const cloneSafeDoc=d=>{try{return assertDocument(d);}catch(e){throw fail(400,e.message);}};
function assertSettings(s){
 if(!s||!['music','native_video','transition','immersive360'].includes(s.kind))throw fail(400,'Unsupported media purpose');
 if(Object.keys(s).some(k=>!['kind','in_ms','out_ms','focal_x','focal_y'].includes(k)))throw fail(400,'Unsupported preparation setting');
 const start=s.in_ms??0,end=s.out_ms??null;
 if(!Number.isSafeInteger(start)||start<0||start>600000||end!==null&&(!Number.isSafeInteger(end)||end<=start||end>600000))throw fail(400,'Invalid segment');
 if(s.kind==='transition'&&(end===null||end-start<1000||end-start>12000))throw fail(400,'Select a 1–12 second transition');
 for(const x of [s.focal_x??.5,s.focal_y??.5])if(!Number.isFinite(x)||x<0||x>1)throw fail(400,'Invalid crop');
 return {kind:s.kind,in_ms:start,out_ms:end,focal_x:s.focal_x??.5,focal_y:s.focal_y??.5};
}
export function supabaseStore(env,fetcher=fetch){
 const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)||!env.SUPABASE_SERVICE_ROLE_KEY)throw fail(503,'Studio storage unavailable');
 const serviceHeaders={apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY};
 async function raw(p,init={}){const r=await fetcher(base+p,{...init,headers:{...serviceHeaders,...init.headers},signal:AbortSignal.timeout(15000)});if(!r.ok){const b=await r.json().catch(()=>({}));throw fail(b.code==='40001'?409:b.code==='42501'?403:b.code==='54000'?429:503,'Studio operation failed'+(b.code==='40001'?': the draft changed. Reload before saving.':''));}return r;}
 const data=async(p,init)=>{const r=await raw(p,init);return r.status===204?null:r.json();};
 const select=(table,filters,columns='*')=>{const q=new URLSearchParams({...filters,select:columns});return data('/rest/v1/'+table+'?'+q);};
 const patch=(table,filters,body)=>raw('/rest/v1/'+table+'?'+new URLSearchParams(filters),{method:'PATCH',headers:{'content-type':'application/json',prefer:'return=minimal'},body:JSON.stringify(body)});
 const sign=async(path,upload=false)=>{const d=await data('/storage/v1/object/'+(upload?'upload/sign/':'sign/')+'mnet-media/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(upload?{}:{expiresIn:300})});const u=d.signedURL||d.signedUrl||d.url;if(typeof u!=='string')throw fail(503,'Media signing unavailable');const resolved=new URL(u.startsWith('/object/')?'/storage/v1'+u:u,base);if(resolved.origin!==new URL(base).origin)throw fail(503,'Unexpected media origin');return resolved.href;};
 return {
  async actor(request){const bearer=request.headers.get('authorization')||'';if(!/^Bearer \S{10,8192}$/.test(bearer))throw fail(401,'Sign in first');
   const r=await fetcher(base+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:bearer},signal:AbortSignal.timeout(10000)});if(!r.ok)throw fail(401,'Sign in first');const user=await r.json();id(user.id);
   const links=await select('m_auth_user_links',{auth_user_id:'eq.'+user.id,is_primary:'eq.true',limit:'1'},'m_uid');const uid=links[0]?.m_uid;if(!uid)throw fail(403,'Complete your M Account setup');
   const people=await select('m_people',{id:'eq.'+uid,status:'eq.active',limit:'1'},'id');if(!people.length)throw fail(403,'Account is not active');return {m_uid:uid,auth_uid:user.id};},
  select,patch,sign,
  rpc(name,args){return data('/rest/v1/rpc/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)});},
  async exists(path,expected){const r=await raw('/storage/v1/object/authenticated/mnet-media/'+path,{method:'HEAD'});if(Number(r.headers.get('content-length'))!==expected)throw fail(400,'Uploaded size differs from the registered source');},
  async put(path,bytes,type){return raw('/storage/v1/object/mnet-media/'+path,{method:'POST',headers:{'content-type':type,'x-upsert':'true'},body:bytes});}
 };
}
async function ownedDraft(db,actor,draftID){const rows=await db.select('creator_site_drafts',{id:'eq.'+id(draftID),owner_m_uid:'eq.'+actor.m_uid,limit:'1'});if(!rows.length)throw fail(404,'Draft unavailable');return rows[0];}
async function asset(db,owner,key,purpose='preview'){
 const rows=await db.select('creator_site_media_state',{asset_id:'eq.'+id(key),owner_m_uid:'eq.'+owner,limit:'1'});const a=rows[0];
 if(!a||a.state!=='ready'||!a.output_manifest||purpose==='publish'&&!a.public_approved)throw fail(409,'Media is not ready or approved');return a;
}
export async function resolveDocument(db,owner,document,purpose='preview'){
 cloneSafeDoc(document);const media={};
 for(const b of resourceBindings(document,{activeOnly:true})){
  if(b.role==='offer'||b.ref.type==='music_recording')throw fail(409,'This existing music/offer adapter is not enabled. Use your own approved audio upload without a sale button for the pilot.');
  let key=b.ref.key;
  if(b.ref.type==='network_post'){
   const posts=await db.select('network_posts',{id:'eq.'+id(key),author_m_uid:'eq.'+owner,deleted_at:'is.null',removed_at:'is.null',limit:'1'},'id,visibility,media');const p=posts[0];
   if(!p||purpose==='publish'&&p.visibility!=='public')throw fail(409,'The pinned post is unavailable or private');
   const linked=Array.isArray(p.media)?p.media.find(x=>UUID.test(x.media_asset_id||x.asset_id||'')):null;
   key=linked?.media_asset_id||linked?.asset_id;if(!key)throw fail(409,'This post needs a registered media-asset connection');
  }
  const a=await asset(db,owner,key,purpose);if(a.kind!==b.kind&&!(b.role==='transition'&&a.kind==='transition'))throw fail(409,'Wrong media type for this tile');
  if(b.role==='transition'&&(a.settings.in_ms!==b.in_ms||a.settings.out_ms!==b.out_ms))throw fail(409,'Re-prepare the transition after changing its segment');
  const files=a.output_manifest.files;if(!Array.isArray(files))throw fail(409,'Prepared manifest unavailable');
  const url=async name=>{if(!files.some(f=>f.name===name))return null;return db.sign(a.source_path.replace(/original$/,'prepared/'+name));};
  media[`${b.tile_id}:${b.role}`]=a.kind==='transition'?{desktop_url:await url('desktop.mp4'),phone_url:await url('phone.mp4'),poster_url:await url('poster.jpg')}:
   {url:await url(a.kind==='music'?'audio.m4a':a.kind==='immersive360'?'panorama.jpg':'video.mp4'),poster_url:a.kind==='native_video'?await url('poster.jpg'):null};
 }
 return {document,media,expires_in:300};
}
export async function handleWebsiteStudio(request,env,deps={}){
 const url=new URL(request.url);if(!url.pathname.startsWith(PREFIX+'/'))return null;
 const origins=new Set(['https://matthew.mccluster.org','https://mccluster.org','https://humanuprise.com',...(deps.origins||[])]);const origin=request.headers.get('origin');
 const headers={'content-type':'application/json','cache-control':'private, no-store','vary':'Origin','x-content-type-options':'nosniff'};
 if(origin&&origins.has(origin)){headers['access-control-allow-origin']=origin;headers['access-control-allow-headers']='authorization,content-type';headers['access-control-allow-methods']='GET,POST,PUT,OPTIONS';}
 const answer=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(origin&&!origins.has(origin))return answer({error:'Origin not allowed'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(env.WEBSITE_STUDIO_ENABLED!=='true')return answer({error:'Website Studio is not enabled yet'},503);
 try{
 const db=deps.db||supabaseStore(env,deps.fetch),p=url.pathname.slice(PREFIX.length);
 if(p==='/templates'&&request.method==='GET')return answer({templates:await db.select('creator_site_template_versions',{status:'eq.active'},'template_key,version,definition,guidance')});
 if(p.startsWith('/public/')&&request.method==='GET'){
  const slug=p.slice(8);if(!/^site-[a-f0-9]{32}$/.test(slug))throw fail(404,'Site unavailable');
  const rows=await db.select('creator_published_sites',{slug:'eq.'+slug,limit:'1'},'studio_revision_id,org_id');const rev=rows[0]?.studio_revision_id;if(!rev)throw fail(404,'Site unavailable');
  const snapshots=await db.select('creator_site_revisions',{id:'eq.'+id(rev),limit:'1'}),s=snapshots[0];if(!s)throw fail(404,'Site unavailable');
  const access=await db.select('creator_site_access',{owner_m_uid:'eq.'+s.owner_m_uid,org_id:'eq.'+rows[0].org_id,enabled:'eq.true',expires_at:'gt.'+new Date().toISOString(),limit:'1'},'org_id');if(!access.length)throw fail(404,'Site unavailable');
  return answer(await resolveDocument(db,s.owner_m_uid,s.document,'publish'));
 }
 if(p.startsWith('/processor/')){
  const m=p.match(/^\/processor\/([a-f0-9-]{36})(?:\/files\/([a-z.]+))?(?:\/(finish|fail))?$/);if(!m)throw fail(404,'Unknown processor route');
  const key=id(m[1]),bearer=request.headers.get('authorization')||'';if(!/^Bearer [a-f0-9]{64}$/.test(bearer))throw fail(401,'Job capability required');const hash=await sha(bearer.slice(7));
  const rows=await db.select('creator_site_media_state',{asset_id:'eq.'+key,ticket_hash:'eq.'+hash,ticket_expires_at:'gt.'+new Date().toISOString(),state:'in.(queued,processing)',limit:'1'}),a=rows[0];if(!a)throw fail(403,'Job capability expired');
  if(m[2]&&request.method==='PUT'){
   const name=m[2];if(!FILES[name])throw fail(400,'Unsupported derivative');const bytes=await limitedBytes(request,32*1024*1024);if(!bytes.length)throw fail(400,'Empty derivative');
   await db.put(a.source_path.replace(/original$/,'prepared/'+name),bytes,FILES[name]);return answer({name,bytes:bytes.length,sha256:await sha(bytes)});
  }
  if(m[3]&&request.method==='POST'){
   const b=await json(request);if(m[3]==='finish'){
    const expected=a.kind==='transition'?['desktop.mp4','phone.mp4','poster.jpg']:a.kind==='music'?['audio.m4a']:a.kind==='immersive360'?['panorama.jpg']:['video.mp4','poster.jpg'];
    if(b.version!=='studio-native-1'||b.kind!==a.kind||!Array.isArray(b.files)||b.files.length!==expected.length||!expected.every(n=>b.files.some(f=>f.name===n&&Number.isSafeInteger(f.bytes)&&f.bytes>0&&f.bytes<=33554432&&/^[a-f0-9]{64}$/.test(f.sha256))))throw fail(400,'Invalid prepared manifest');
    // Confirm every expected output exists. Processor ticket is only issued to
    // the private canonical compute job, never the uploading member.
    for(const f of b.files)await db.exists(a.source_path.replace(/original$/,'prepared/'+f.name),f.bytes);
   }
   await db.rpc('studio_finish_v2',{p_id:key,p_ticket_hash:hash,p_manifest:m[3]==='finish'?b:null,p_error:m[3]==='fail'?'Media preparation failed':null});return answer({ok:true});
  }
  if(request.method==='GET'){await db.patch('creator_site_media_state',{asset_id:'eq.'+key},{state:'processing'});return answer({source_url:await db.sign(a.source_path),settings:a.settings,expected_bytes:a.expected_bytes});}
  throw fail(405,'Method not allowed');
 }
 const actor=await db.actor(request);
 if(p==='/drafts'&&request.method==='GET')return answer({drafts:await db.select('creator_site_drafts',{owner_m_uid:'eq.'+actor.m_uid,order:'updated_at.desc',limit:'3'})});
 if(p==='/assets'&&request.method==='GET')return answer({assets:await db.select('creator_site_media_state',{owner_m_uid:'eq.'+actor.m_uid,state:'neq.withdrawn',order:'created_at.desc',limit:'100'},'asset_id,kind,state,settings,public_approved,error')});
 if(p==='/uploads'&&request.method==='POST'){
  const b=await json(request);if(!Number.isSafeInteger(b.bytes)||b.bytes<1||b.bytes>67108864)throw fail(400,'Use a file no larger than 64 MiB');if(b.rights_confirmed!==true)throw fail(400,'Confirm that you may use this media');
  const s=assertSettings(b.settings),key=crypto.randomUUID();const r=await db.rpc('studio_register_upload_v2',{p_actor:actor.m_uid,p_id:key,p_bytes:b.bytes,p_kind:s.kind,p_settings:s});return answer({asset_id:key,upload_url:await db.sign(r.path,true),state:'awaiting_upload'});
 }
 const am=p.match(/^\/assets\/([a-f0-9-]{36})\/(complete|approve|withdraw)$/);
 if(am&&request.method==='POST'){
  const key=id(am[1]);const rows=await db.select('creator_site_media_state',{asset_id:'eq.'+key,owner_m_uid:'eq.'+actor.m_uid,limit:'1'});const a=rows[0];if(!a)throw fail(404,'Asset unavailable');
  if(am[2]==='complete'){
   if(env.WEBSITE_STUDIO_PROCESSOR_ENABLED!=='true')throw fail(503,'Automatic preparation is not enabled yet. Your upload is retained.');
   await db.exists(a.source_path,Number(a.expected_bytes));const ticket=secret();return answer(await db.rpc('studio_queue_v2',{p_actor:actor.m_uid,p_id:key,p_auth_uid:actor.auth_uid,p_ticket_hash:await sha(ticket),p_ticket:ticket,p_origin:'https://api.mccluster.org'}));
  }
  const b=await json(request);if(am[2]==='approve'&&b.public_approved!==true)throw fail(400,'Explicit public media approval required');
  await db.patch('creator_site_media_state',{asset_id:'eq.'+key,owner_m_uid:'eq.'+actor.m_uid},am[2]==='approve'?{public_approved:true}:{state:'withdrawn',public_approved:false,ticket_hash:null});return answer({ok:true});
 }
 const dm=p.match(/^\/drafts\/([a-f0-9-]{36})(?:\/(preview|publish))?$/);
 if(dm){const key=id(dm[1]);
  if(request.method==='PUT'&&!dm[2]){const b=await json(request);cloneSafeDoc(b.document);if(!Number.isSafeInteger(b.expected_revision)||b.expected_revision<0)throw fail(400,'Expected revision required');return answer(await db.rpc('studio_save_v2',{p_actor:actor.m_uid,p_id:key,p_expected:b.expected_revision,p_document:b.document}));}
  const d=await ownedDraft(db,actor,key);
  if(request.method==='GET'&&!dm[2])return answer(d);
  if(request.method==='POST'&&dm[2]==='preview')return answer(await resolveDocument(db,actor.m_uid,d.document));
  if(request.method==='POST'&&dm[2]==='publish'){
   const b=await json(request);if(b.expected_revision!==d.revision||b.confirm_public!==true)throw fail(409,'Review the latest saved draft before publishing');
   if(d.document.tiles.some(t=>!t.source_ref))throw fail(400,'Each tile needs media; replace the 360 tile type when it is not needed');
   await resolveDocument(db,actor.m_uid,d.document,'publish');const result=await db.rpc('studio_publish_v2',{p_actor:actor.m_uid,p_id:key,p_expected:d.revision});
   return answer({published:true,...result,url:'https://matthew.mccluster.org/website-studio-view.html?site='+encodeURIComponent(result.slug)});
  }
 }
 throw fail(404,'Studio route unavailable');
 }catch(e){return answer({error:e.status?e.message:'Studio temporarily unavailable'},e.status||503);}
}
