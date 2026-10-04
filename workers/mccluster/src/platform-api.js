import { fail, reply } from './lib/http.js';

const encoder = new TextEncoder();

function serviceHeaders(env, extra={}) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type':'application/json', ...extra };
}
/* The network's limits (network_rate_limits_v2) refuse with their own
   SQLSTATEs and a sentence written for the member. Whatever route hit
   them, the member gets that sentence with the matching status. */
const LIMIT_STATUS={MN429:429,MN413:413,MN409:409};
function limitStatus(data,status){return LIMIT_STATUS[data?.code]||status}
async function service(env, path, init={}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: serviceHeaders(env, init.headers||{}) });
  const text = await res.text(); let data=null; try { data=text?JSON.parse(text):null; } catch { data=text; }
  if (!res.ok) throw Object.assign(new Error(data?.message || data?.error || 'Database request failed'), { status: limitStatus(data,res.status), detail:data });
  return data;
}
async function authUser(req, env) {
  const h=req.headers.get('authorization')||''; if(!h.toLowerCase().startsWith('bearer ')) return null;
  const res=await fetch(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:h}}); return res.ok?res.json():null;
}
async function userRpc(req, env, name, body={}) {
  const h=req.headers.get('authorization')||'';
  const res=await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:h,'content-type':'application/json'},body:JSON.stringify(body)});
  const text=await res.text(); let data=null; try{data=text?JSON.parse(text):null}catch{data=text}
  if(!res.ok) throw Object.assign(new Error(data?.message||data?.error||'RPC failed'),{status:limitStatus(data,res.status),detail:data}); return data;
}
async function currentMuid(env,userId){const r=await service(env,`m_auth_user_links?auth_user_id=eq.${encodeURIComponent(userId)}&is_primary=eq.true&select=m_uid&limit=1`);return r?.[0]?.m_uid||null}
/* Characters as the database counts them (char_length counts code points),
   not UTF-16 units: an emoji is one character, not two. */
function chars(value){return [...String(value||'')].length}
function uuidLike(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''))}
function uniq(values){return [...new Set((values||[]).filter(Boolean).map(String))]}
async function networkActors(env,muids=[]){
  const ids=uniq(muids).filter(uuidLike); if(!ids.length)return {};
  const inIds=ids.join(',');
  const [profiles,links]=await Promise.all([
    service(env,`network_profiles?m_uid=in.(${inIds})&select=m_uid,display_name,avatar_url,verification_state`),
    service(env,`m_auth_user_links?m_uid=in.(${inIds})&is_primary=eq.true&select=m_uid,auth_user_id`)
  ]);
  const authIds=uniq((links||[]).map(x=>x.auth_user_id));
  const platform=authIds.length?await service(env,`platform_profiles?user_id=in.(${authIds.join(',')})&select=user_id,mccluster_id`):[];
  const handleByUser=new Map((platform||[]).map(x=>[x.user_id,x.mccluster_id||'']));
  const handleByMuid=new Map((links||[]).map(x=>[x.m_uid,handleByUser.get(x.auth_user_id)||'']));
  const out={};
  for(const id of ids) out[id]={m_uid:id,display_name:'',headline:'',bio:'',avatar_url:'',banner_url:'',website_url:'',verification_state:'unverified',mccluster_id:handleByMuid.get(id)||''};
  for(const p of profiles||[]) out[p.m_uid]={...out[p.m_uid],...p,mccluster_id:handleByMuid.get(p.m_uid)||''};
  return out;
}
async function networkBlocked(env,a,b){
  if(!a||!b||a===b)return false;
  const [ab,ba]=await Promise.all([
    service(env,`network_blocks?blocker_m_uid=eq.${a}&blocked_m_uid=eq.${b}&select=blocker_m_uid&limit=1`),
    service(env,`network_blocks?blocker_m_uid=eq.${b}&blocked_m_uid=eq.${a}&select=blocker_m_uid&limit=1`)
  ]);
  return !!(ab?.length||ba?.length);
}
async function resolveMnetPerson(env,id){
  /* A person is named by their handle, or by their m_uid (live sessions
     and feed items carry the m_uid). */
  if(uuidLike(id)){
    const l=await service(env,`m_auth_user_links?m_uid=eq.${id}&order=is_primary.desc&select=auth_user_id&limit=1`);
    if(!l?.length)return null;
    const byUser=await service(env,`platform_profiles?user_id=eq.${l[0].auth_user_id}&select=user_id,display_name,avatar_url,mccluster_id&limit=1`);
    if(!byUser?.length)return null;
    const np=await service(env,`network_profiles?m_uid=eq.${id}&select=*&limit=1`);
    return {identity:byUser[0],m_uid:id,profile:np?.[0]||null};
  }
  const p=await service(env,`platform_profiles?mccluster_id=ilike.${encodeURIComponent(id)}&select=user_id,display_name,avatar_url,mccluster_id&limit=1`);
  if(!p?.length)return null;
  const links=await service(env,`m_auth_user_links?auth_user_id=eq.${p[0].user_id}&is_primary=eq.true&select=m_uid&limit=1`);
  const m_uid=links?.[0]?.m_uid;
  if(!m_uid)return null;
  const np=await service(env,`network_profiles?m_uid=eq.${m_uid}&select=*&limit=1`);
  return {identity:p[0],m_uid,profile:np?.[0]||null};
}
async function canReadNetworkProfile(env,muid,resolved){
  if(!resolved?.profile)return false;
  if(resolved.m_uid===muid)return true;
  if(!muid)return resolved.profile.visibility==='public';
  if(await networkBlocked(env,muid,resolved.m_uid))return false;
  if(resolved.profile.visibility==='public')return true;
  if(resolved.profile.visibility==='private')return false;
  if(resolved.profile.visibility==='network'){
    const rows=await service(env,`network_follows?follower_m_uid=eq.${muid}&followed_m_uid=eq.${resolved.m_uid}&status=eq.following&select=follower_m_uid&limit=1`);
    return !!rows?.length;
  }
  return false;
}
async function callMnetMedia(req,env,body){
  const auth=req.headers.get('authorization')||'';
  const res=await fetch(`${env.SUPABASE_URL}/functions/v1/mnet-media`,{
    method:'POST',
    headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:auth,'content-type':'application/json'},
    body:JSON.stringify(body||{})
  });
  const text=await res.text(); let data=null; try{data=text?JSON.parse(text):null}catch{data={error:text}}
  if(!res.ok)throw Object.assign(new Error(data?.error||'Media request failed'),{status:res.status,detail:data});
  return data;
}
async function canReadNetworkPost(env,muid,post){
  if(!post||post.deleted_at)return false;
  if(muid&&post.author_m_uid!==muid&&await networkBlocked(env,muid,post.author_m_uid))return false;
  if(post.visibility==='public'||post.author_m_uid===muid)return true;
  if(post.visibility==='private'||!muid)return false;
  if(post.visibility==='network'){
    const f=await service(env,`network_follows?follower_m_uid=eq.${muid}&followed_m_uid=eq.${post.author_m_uid}&status=eq.following&select=follower_m_uid&limit=1`);
    return !!f?.length;
  }
  return false;
}
async function hydratePostRows(env,posts=[],viewerMuid=null){
  if(!posts.length)return [];
  const ids=uniq(posts.map(p=>p.id)).filter(uuidLike);
  const [actors,reactions,replies,bookmarks]=await Promise.all([
    networkActors(env,posts.map(p=>p.author_m_uid)),
    ids.length?service(env,`network_reactions?post_id=in.(${ids.join(',')})&select=post_id,actor_m_uid,reaction`):[],
    ids.length?service(env,`network_posts?reply_to_id=in.(${ids.join(',')})&deleted_at=is.null&select=id,reply_to_id`):[],
    viewerMuid&&ids.length?service(env,`network_bookmarks?m_uid=eq.${viewerMuid}&post_id=in.(${ids.join(',')})&select=post_id`):[]
  ]);
  const rc=new Map(), replyc=new Map(), liked=new Set(), saved=new Set((bookmarks||[]).map(x=>x.post_id));
  for(const r of reactions||[]){rc.set(r.post_id,(rc.get(r.post_id)||0)+1);if(viewerMuid&&r.actor_m_uid===viewerMuid&&r.reaction==='like')liked.add(r.post_id)}
  for(const r of replies||[])replyc.set(r.reply_to_id,(replyc.get(r.reply_to_id)||0)+1);
  return posts.map(p=>({post:{...p,reaction_count:rc.get(p.id)||0,reply_count:replyc.get(p.id)||0,liked_by_me:liked.has(p.id),bookmarked_by_me:saved.has(p.id)},actor:actors[p.author_m_uid]||{m_uid:p.author_m_uid}}));
}
async function hydrateFeedItems(env,items=[],viewerMuid=null){
  if(!items.length)return [];
  const postIds=uniq(items.filter(x=>x.item_type==='post'&&x.post_id).map(x=>x.post_id)).filter(uuidLike);
  const posts=postIds.length?await service(env,`network_posts?id=in.(${postIds.join(',')})&deleted_at=is.null&select=id,author_m_uid,body,post_type,visibility,media,metadata,content_id,reply_to_id,created_at,updated_at,source_app_id,source_org_id`):[];
  const hydrated=await hydratePostRows(env,posts||[],viewerMuid);
  const postById=new Map(hydrated.map(x=>[x.post.id,x]));
  const actors=await networkActors(env,items.map(x=>x.actor_m_uid));
  return items.map(item=>{
    const hp=item.post_id?postById.get(item.post_id):null;
    return {...item,actor:(hp&&hp.actor)||actors[item.actor_m_uid]||{m_uid:item.actor_m_uid},post:hp?hp.post:null};
  }).filter(item=>item.item_type!=='post'||(item.post&&!item.post.reply_to_id));
}
function bytes(n=32){const a=new Uint8Array(n);crypto.getRandomValues(a);return [...a].map(b=>b.toString(16).padStart(2,'0')).join('')}
async function sha256(s){const d=await crypto.subtle.digest('SHA-256',encoder.encode(s));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')}
async function json(req){try{return await req.json()}catch{return {}}}

/* A POST MAY CARRY A TRACK. This is the seam between the catalogue and the
   network: the people who sign up here arrived because of a song, and until
   now a post had no way to name one. The track is shaped here rather than
   trusted, because metadata is free-form jsonb that goes straight to the
   database and then out to every reader — an unbounded object from a client
   is a stored-XSS surface and a storage bill. The catalogue itself lives in
   data/albums.json, not a table, so the post keeps the few fields needed to
   find and play the record again and the client resolves the rest. */
function postTrack(t){
  if(!t||typeof t!=='object')return null;
  const s=(v,n)=>typeof v==='string'&&v.trim()?v.trim().slice(0,n):null;
  const title=s(t.title,160); if(!title)return null;
  const out={title};
  const album=s(t.album,160), slug=s(t.albumSlug,120), art=s(t.art,400);
  if(album)out.album=album;
  if(slug&&/^[a-z0-9-]+$/i.test(slug))out.albumSlug=slug;
  /* a relative path inside this site, never an absolute URL somebody else controls */
  if(art&&!/^[a-z]+:/i.test(art)&&!art.startsWith('//'))out.art=art;
  return out;
}
/* A VIDEO MAY CARRY A CLIP. The create editor trims by reference rather
   than by re-encoding on a phone: the post keeps the whole upload and says
   which stretch of it to play, and the feed plays that stretch through a
   media fragment (#t=start,end). Bounded and numeric only, like the track. */
function postClip(c){
  if(!c||typeof c!=='object')return null;
  const n=v=>{const x=Number(v);return Number.isFinite(x)&&x>0?Math.min(Math.round(x),6*3600000):null};
  const out={},start=n(c.start_ms),end=n(c.end_ms);
  if(start!==null)out.start_ms=start;
  if(end!==null)out.end_ms=end;
  if(out.start_ms!==undefined&&out.end_ms!==undefined&&out.end_ms<=out.start_ms+250)return null;
  if(c.muted===true)out.muted=true;
  return Object.keys(out).length?out:null;
}
function postMetadata(b){
  const meta=(b.metadata&&typeof b.metadata==='object'&&!Array.isArray(b.metadata))?{...b.metadata}:{};
  delete meta.track; delete meta.clip;
  const track=postTrack(b.track||(b.metadata&&b.metadata.track));
  if(track)meta.track=track;
  const clip=postClip(b.clip||(b.metadata&&b.metadata.clip));
  if(clip)meta.clip=clip;
  return meta;
}

const CATALOG={
  name:'McCluster Platform API',version:'v1',base_url:'https://api.mccluster.org',
  auth:{users:'McCluster bearer session',developers:'Bearer mcc_live_* API key'},
  products:['identity','mnet','apps','fees','media','ai','social-publishing','client-connect','whip'],
  metering:{unit:'credits',note:'Credits are McCluster API usage units. They are not LLM tokens; AI endpoints may meter additional model usage separately.'},
  docs:'/v1/platform/catalog'
};

async function apiKeyPrincipal(req,env){
  const h=req.headers.get('authorization')||''; const raw=h.toLowerCase().startsWith('bearer mcc_')?h.slice(7).trim():''; if(!raw)return null;
  const prefix=raw.slice(0,16),hash=await sha256(raw);
  const rows=await service(env,`api_keys?key_prefix=eq.${encodeURIComponent(prefix)}&secret_hash=eq.${hash}&status=eq.active&select=id,consumer_id,scopes,expires_at&limit=1`);
  const key=rows?.[0]; if(!key)return null; if(key.expires_at&&Date.parse(key.expires_at)<Date.now())return null;
  const cs=await service(env,`api_consumers?id=eq.${key.consumer_id}&status=eq.active&select=*&limit=1`); const consumer=cs?.[0]; if(!consumer)return null;
  service(env,`api_keys?id=eq.${key.id}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({last_used_at:new Date().toISOString()})}).catch(()=>{});
  return {kind:'api_key',key,consumer};
}
function hasScope(p,scope){return !!p?.key?.scopes?.some(s=>s==='*'||s===scope||s===scope.split(':')[0]+':*')}
async function meter(env,p,product,endpoint,method,status=200,units=null,started=Date.now()){
  if(!p?.consumer)return; const products=await service(env,`api_products?product_key=eq.${encodeURIComponent(product)}&select=default_unit_cost&limit=1`).catch(()=>[]); const u=units||products?.[0]?.default_unit_cost||1;
  await service(env,'api_usage_events',{method:'POST',headers:{prefer:'return=minimal'},body:JSON.stringify({consumer_id:p.consumer.id,api_key_id:p.key?.id||null,product_key:product,endpoint,method,units:u,status_code:status,latency_ms:Date.now()-started})}).catch(()=>{});
  await service(env,'api_credit_ledger',{method:'POST',headers:{prefer:'return=minimal'},body:JSON.stringify({consumer_id:p.consumer.id,delta:-u,reason:'api_usage',reference_type:'endpoint',reference_id:endpoint})}).catch(()=>{});
}
async function developerOwner(req,env){const user=await authUser(req,env);if(!user)throw Object.assign(new Error('McCluster authentication required'),{status:401});const m_uid=await currentMuid(env,user.id);if(!m_uid)throw Object.assign(new Error('McCluster identity not provisioned'),{status:409});return {user,m_uid}}

async function handleDeveloper(req,env,path,url){
  const owner=await developerOwner(req,env);
  if(path==='/v1/developer/consumers'&&req.method==='GET') return reply(req,env,{consumers:await service(env,`api_consumers?owner_m_uid=eq.${owner.m_uid}&select=id,name,slug,status,plan_code,monthly_credit_limit,created_at&order=created_at.desc`)});
  if(path==='/v1/developer/consumers'&&req.method==='POST'){
    const b=await json(req); const name=String(b.name||'My integration').slice(0,80); const slug=(String(b.slug||name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50)||`integration-${Date.now()}`);
    const rows=await service(env,'api_consumers',{method:'POST',headers:{prefer:'return=representation'},body:JSON.stringify({owner_m_uid:owner.m_uid,name,slug})}); const c=rows?.[0];
    if(c) await service(env,'api_credit_ledger',{method:'POST',headers:{prefer:'return=minimal'},body:JSON.stringify({consumer_id:c.id,delta:10000,reason:'developer_grant'})});
    return reply(req,env,{consumer:c,developer_grant_credits:10000},201);
  }
  const keyCreate=path.match(/^\/v1\/developer\/consumers\/([0-9a-f-]{36})\/keys$/i);
  if(keyCreate&&req.method==='POST'){
    const cid=keyCreate[1]; const owned=await service(env,`api_consumers?id=eq.${cid}&owner_m_uid=eq.${owner.m_uid}&select=id&limit=1`); if(!owned?.length)return fail(req,env,'Consumer not found',404);
    const b=await json(req), raw=`mcc_live_${bytes(32)}`, prefix=raw.slice(0,16), hash=await sha256(raw); const scopes=Array.isArray(b.scopes)&&b.scopes.length?b.scopes:['mnet:read'];
    const rows=await service(env,'api_keys',{method:'POST',headers:{prefer:'return=representation'},body:JSON.stringify({consumer_id:cid,key_prefix:prefix,secret_hash:hash,name:String(b.name||'default').slice(0,80),scopes})});
    return reply(req,env,{key:{...rows?.[0],secret_hash:undefined},secret:raw,warning:'This secret is shown once. Store it securely.'},201);
  }
  if(keyCreate&&req.method==='GET'){
    const cid=keyCreate[1]; const owned=await service(env,`api_consumers?id=eq.${cid}&owner_m_uid=eq.${owner.m_uid}&select=id&limit=1`); if(!owned?.length)return fail(req,env,'Consumer not found',404);
    return reply(req,env,{keys:await service(env,`api_keys?consumer_id=eq.${cid}&select=id,key_prefix,name,scopes,status,last_used_at,expires_at,created_at&order=created_at.desc`)});
  }
  const usage=path.match(/^\/v1\/developer\/consumers\/([0-9a-f-]{36})\/usage$/i);
  if(usage&&req.method==='GET'){
    const cid=usage[1]; const owned=await service(env,`api_consumers?id=eq.${cid}&owner_m_uid=eq.${owner.m_uid}&select=id&limit=1`); if(!owned?.length)return fail(req,env,'Consumer not found',404);
    const rows=await service(env,`api_usage_events?consumer_id=eq.${cid}&select=product_key,endpoint,method,units,status_code,occurred_at&order=occurred_at.desc&limit=500`); const ledger=await service(env,`api_credit_ledger?consumer_id=eq.${cid}&select=delta`); const balance=(ledger||[]).reduce((a,x)=>a+Number(x.delta||0),0); return reply(req,env,{credit_balance:balance,usage:rows||[]});
  }
  return null;
}

/* ONE PATH FOR EVERY POST. The live composer and the scheduler both come
   through here, so a post published by the cron at 9pm has passed exactly
   the checks it would have passed if it had been sent by hand. */
async function prepareNetworkPost(env,muid,b,appKey){
  /* A long post is refused, never cut short: the member would lose what
     they wrote without knowing. The table enforces the same 2,000 for a
     post and 1,000 for a reply. */
  const body=String(b.body||'').trim();
  if(b.reply_to_id&&chars(body)>1000)return {error:'Replies are limited to 1,000 characters.',status:413};
  if(chars(body)>2000)return {error:'Posts are limited to 2,000 characters.',status:413};
  const rawMediaIds=Array.isArray(b.media_asset_ids)?b.media_asset_ids.filter(uuidLike).slice(0,10):[];
  const mediaIds=uniq(rawMediaIds);
  const rawPosterIds=Array.isArray(b.poster_asset_ids)
    ? b.poster_asset_ids.slice(0,rawMediaIds.length)
    : rawMediaIds.map(id=>(b.poster_by_media&&typeof b.poster_by_media==='object')?b.poster_by_media[id]||null:null);
  let assets=[],posterAssets=[],posterByMedia={};
  if(mediaIds.length){
    assets=await service(env,`network_media_assets?id=in.(${mediaIds.join(',')})&owner_m_uid=eq.${muid}&status=in.(ready,staged)&select=id,media_type,mime_type,width,height,duration_ms,alt_text`);
    if((assets||[]).length!==mediaIds.length)return {error:'One or more media assets are unavailable',status:400};
    const assetById=new Map((assets||[]).map(a=>[a.id,a]));
    const posterIds=uniq(rawPosterIds.filter(uuidLike));
    if(posterIds.length){
      posterAssets=await service(env,`network_media_assets?id=in.(${posterIds.join(',')})&owner_m_uid=eq.${muid}&status=in.(ready,staged)&select=id,media_type,mime_type,width,height,duration_ms,alt_text`);
      if((posterAssets||[]).length!==posterIds.length)return {error:'One or more video posters are unavailable',status:400};
      const posterById=new Map((posterAssets||[]).map(a=>[a.id,a]));
      for(let i=0;i<rawMediaIds.length;i++){
        const mediaId=rawMediaIds[i],posterId=rawPosterIds[i];
        if(!uuidLike(posterId))continue;
        if(assetById.get(mediaId)?.media_type!=='video')return {error:'Only video attachments can have posters',status:400};
        if(posterById.get(posterId)?.media_type!=='image')return {error:'Video posters must be images',status:400};
        posterByMedia[mediaId]=posterId;
      }
    }
  }
  if(!body&&!assets.length)return {error:'Post body or media is required',status:400};
  let parent=null,replyTo=b.reply_to_id?String(b.reply_to_id):null,visibility=['public','network','private'].includes(b.visibility)?b.visibility:'public';
  if(replyTo){if(!uuidLike(replyTo))return {error:'Invalid parent post',status:400};const p=await service(env,`network_posts?id=eq.${replyTo}&deleted_at=is.null&select=*&limit=1`);parent=p?.[0];if(!parent||!(await canReadNetworkPost(env,muid,parent)))return {error:'Parent post not found',status:404};visibility=parent.visibility}
  const apps=await service(env,`platform_apps?app_key=eq.${encodeURIComponent(appKey)}&select=id&limit=1`),postType=['post','update','share','announcement'].includes(b.post_type)?b.post_type:'post';
  /* A post can belong to a group. The membership is checked here rather
     than trusted from the body: the client sends a group id, the server
     decides whether this member is in it. A reply stays with its parent's
     group, because a thread that changes rooms halfway is not a thread. */
  let groupId=null;
  if(replyTo){groupId=parent?.group_id||null;}
  else if(b.group_id){
    const gid=String(b.group_id);
    if(!uuidLike(gid))return {error:'Invalid group',status:400};
    const mine=await service(env,`network_group_members?group_id=eq.${gid}&m_uid=eq.${muid}&state=eq.joined&select=group_id&limit=1`);
    if(!mine?.length)return {error:'Join the group before posting in it',status:403};
    groupId=gid;
  }
  return {assets:assets||[],posterAssets:posterAssets||[],draft:{body,media_asset_ids:mediaIds,poster_by_media:posterByMedia,visibility,post_type:postType,metadata:postMetadata(b),reply_to_id:replyTo,group_id:groupId,source_app_id:apps?.[0]?.id||null}};
}
async function insertNetworkPost(env,muid,draft,assets,scheduledPostId=null){
  const posters=draft.poster_by_media||{};
  const media=(assets||[]).map(a=>({asset_id:a.id,type:a.media_type,mime_type:a.mime_type,width:a.width||null,height:a.height||null,duration_ms:a.duration_ms||null,alt_text:a.alt_text||'',poster_asset_id:posters[a.id]||null}));
  const rows=await service(env,'network_posts',{method:'POST',headers:{prefer:'return=representation'},body:JSON.stringify({author_m_uid:muid,body:draft.body,post_type:draft.post_type,visibility:draft.visibility,media,metadata:draft.metadata,reply_to_id:draft.reply_to_id,group_id:draft.group_id,source_app_id:draft.source_app_id,scheduled_post_id:scheduledPostId})});
  const created=rows?.[0],ids=uniq([...(draft.media_asset_ids||[]),...Object.values(posters).filter(uuidLike)]);
  if(created&&ids.length)await service(env,`network_media_assets?id=in.(${ids.join(',')})&owner_m_uid=eq.${muid}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({post_id:created.id,status:'attached',updated_at:new Date().toISOString()})});
  return rows||[];
}
/* A time at least two minutes out and at most ninety days out. Anything
   sooner is "post now"; anything later is a calendar, not a schedule. */
function scheduleTime(value){
  const t=Date.parse(String(value||''));
  if(!Number.isFinite(t))return {error:'That time could not be read'};
  const now=Date.now();
  if(t<now+120000)return {error:'Pick a time at least two minutes from now, or post now'};
  if(t>now+90*86400000)return {error:'Schedule within the next 90 days'};
  return {at:new Date(t).toISOString()};
}
function scheduledView(row){
  if(!row)return null;
  const p=row.payload||{};
  return {id:row.id,publish_at:row.publish_at,status:row.status,error:row.error||'',body:String(p.body||'').slice(0,280),media_count:(p.media_asset_ids||[]).length,visibility:p.visibility||'public',track:p.metadata?.track||null,created_at:row.created_at||null};
}
/* THE CRON HALF. Each due row is claimed with a conditional PATCH
   (scheduled -> publishing) so two overlapping runs can never publish the
   same post twice; whichever run loses the claim simply moves on. */
export async function publishDueNetworkPosts(env,{limit=20}={}){
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return {published:0,failed:0};
  const out={published:0,failed:0},now=new Date(),stale=new Date(now.getTime()-15*60000).toISOString();
  let due;
  try{
    const [scheduled,recoverable]=await Promise.all([
      service(env,`network_scheduled_posts?status=eq.scheduled&publish_at=lte.${encodeURIComponent(now.toISOString())}&order=publish_at.asc&limit=${limit}&select=id,author_m_uid,payload,status`),
      service(env,`network_scheduled_posts?status=eq.publishing&updated_at=lt.${encodeURIComponent(stale)}&order=updated_at.asc&limit=${limit}&select=id,author_m_uid,payload,status`)
    ]);
    due=[...(scheduled||[]),...(recoverable||[])].slice(0,limit);
  }catch(e){if(e?.detail?.code==='PGRST205'||e?.status===404)return out;throw e;}
  for(const row of due||[]){
    const stamp=new Date().toISOString();
    /* If a previous run inserted the post and died before acknowledging the
       schedule, converge on that post instead of creating a duplicate. */
    const existing=await service(env,`network_posts?scheduled_post_id=eq.${row.id}&select=id&limit=1`).catch(()=>[]);
    if(existing?.length){
      await service(env,`network_scheduled_posts?id=eq.${row.id}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({status:'published',post_id:existing[0].id,error:'',updated_at:stamp})});
      out.published++; continue;
    }
    const expected=row.status||'scheduled';
    const claimed=await service(env,`network_scheduled_posts?id=eq.${row.id}&status=eq.${expected}`,{method:'PATCH',headers:{prefer:'return=representation'},body:JSON.stringify({status:'publishing',updated_at:stamp})});
    if(!claimed?.length)continue;
    try{
      const p=row.payload||{};
      const prepared=await prepareNetworkPost(env,row.author_m_uid,{...p,reply_to_id:null},p.app_key||'mnet-web');
      if(prepared.error)throw new Error(prepared.error);
      let rows;
      try{rows=await insertNetworkPost(env,row.author_m_uid,prepared.draft,prepared.assets,row.id);}
      catch(e){
        /* The unique scheduled_post_id constraint is the final idempotency
           fence if two recovery attempts race. */
        if(e?.detail?.code!=='23505')throw e;
        rows=await service(env,`network_posts?scheduled_post_id=eq.${row.id}&select=id&limit=1`);
        if(!rows?.length)throw e;
      }
      await service(env,`network_scheduled_posts?id=eq.${row.id}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({status:'published',post_id:rows?.[0]?.id||null,error:'',updated_at:new Date().toISOString()})});
      out.published++;
    }catch(e){
      await service(env,`network_scheduled_posts?id=eq.${row.id}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({status:'failed',error:String(e?.message||'Publishing failed').slice(0,400),updated_at:new Date().toISOString()})}).catch(()=>{});
      out.failed++;
    }
  }
  return out;
}

/* CLOUDFLARE STREAM, for live. Needs CF_ACCOUNT_ID and a Stream-scoped
   CF_STREAM_TOKEN; without them going live answers 503 and nothing else
   changes. */
function liveEnabled(env){return !!(env.CF_ACCOUNT_ID&&env.CF_STREAM_TOKEN)}
async function cfStream(env,method,path,body){
  const res=await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}/stream${path}`,{method,headers:{authorization:`Bearer ${env.CF_STREAM_TOKEN}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const data=await res.json().catch(()=>null);
  if(!res.ok||data?.success===false)throw Object.assign(new Error(data?.errors?.[0]?.message||'Cloudflare Stream request failed'),{status:502,detail:data});
  return data?.result??null;
}
/* Ending deletes the Stream input first, so the publish URL dies with the
   broadcast even if the database write after it fails. */
async function endLiveSession(env,sess,byUser,reason){
  if(sess.cf_input_uid&&liveEnabled(env))await cfStream(env,'DELETE',`/live_inputs/${sess.cf_input_uid}`).catch(e=>{if(!/not.?found/i.test(String(e?.message)))throw e;});
  await service(env,`network_live_sessions?id=eq.${sess.id}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({status:'ended',ended_at:new Date().toISOString(),ended_by:byUser,end_reason:reason})});
}
/* A broadcaster whose tab crashed or lost signal never sends /end. The
   five-minute cron ends anything with no heartbeat for three minutes and
   deletes its Stream input, so a publish URL cannot outlive its broadcast. */
export async function reapStaleLiveSessions(env,{limit=20}={}){
  const cutoff=new Date(Date.now()-3*60*1000).toISOString();
  const rows=await service(env,`network_live_sessions?status=in.(starting,live)&or=(last_seen_at.lt.${cutoff},and(last_seen_at.is.null,created_at.lt.${cutoff}))&select=id,cf_input_uid&limit=${limit}`);
  let ended=0;
  for(const s of rows||[]){await endLiveSession(env,s,null,'stale');ended++;}
  return {ended};
}
/* The limits only ever look back 24 hours, so anything older than two days
   in their ledger is dead weight. */
export async function pruneNetworkRateEvents(env){
  const cutoff=new Date(Date.now()-2*24*60*60*1000).toISOString();
  await service(env,`network_rate_events?at=lt.${cutoff}`,{method:'DELETE',headers:{prefer:'return=minimal'}});
}

async function handleMnet(req,env,path,url){
  const external=await apiKeyPrincipal(req,env);
  const user=external?null:await authUser(req,env);
  if(!external&&!user) return fail(req,env,'Authentication required',401);
  const start=Date.now();
  if(external&&!hasScope(external,req.method==='GET'?'mnet:read':'mnet:write')) return fail(req,env,'API key scope does not allow this operation',403);
  const appKey=url.searchParams.get('app_key')||'mnet-web';

  if(path==='/v1/mnet/bootstrap'&&req.method==='GET'){
    if(external)return fail(req,env,'Bootstrap requires a McCluster user session',403);
    return reply(req,env,await userRpc(req,env,'mnet_surface_bootstrap',{p_app_key:appKey}));
  }
  if(path==='/v1/mnet/feed'&&req.method==='GET'){
    const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit')||25))), fetchLimit=Math.min(100,Math.max(limit,limit*3));
    if(external){
      const before=url.searchParams.get('before'),beforeFilter=before?`&occurred_at=lt.${encodeURIComponent(before)}`:'';
      const rows=await service(env,`network_feed_items?visibility=eq.public${beforeFilter}&order=occurred_at.desc&limit=${fetchLimit}&select=*`);
      const hydrated=(await hydrateFeedItems(env,rows||[],null)).slice(0,limit),cursor=(rows||[]).length===fetchLimit?rows[rows.length-1]?.occurred_at||null:null;
      await meter(env,external,'mnet.read',path,req.method,200,null,start); return reply(req,env,{items:hydrated,scope:'public',next_before:cursor});
    }
    const muid=await currentMuid(env,user.id);
    const data=await userRpc(req,env,'mnet_surface_feed',{p_app_key:appKey,p_limit:fetchLimit,p_before:url.searchParams.get('before')||null});
    const hydrated=(await hydrateFeedItems(env,data||[],muid)).slice(0,limit),cursor=(data||[]).length===fetchLimit?data[data.length-1]?.occurred_at||null:null;
    return reply(req,env,{items:hydrated,next_before:cursor});
  }
  const person=path.match(/^\/v1\/mnet\/people\/([^/]+)$/);
  if(person&&req.method==='GET'){
    const id=decodeURIComponent(person[1]),resolved=await resolveMnetPerson(env,id); if(!resolved)return fail(req,env,'Person not found',404);
    const me=external?null:await currentMuid(env,user.id);
    if(!(await canReadNetworkProfile(env,me,resolved)))return fail(req,env,'Person not found',404);
    let following=false,blocked=false,muted=false,followers=0,followingCount=0,posts=0;
    if(me&&me!==resolved.m_uid){
      const [f,b,m]=await Promise.all([
        service(env,`network_follows?follower_m_uid=eq.${me}&followed_m_uid=eq.${resolved.m_uid}&status=eq.following&select=follower_m_uid&limit=1`),
        service(env,`network_blocks?blocker_m_uid=eq.${me}&blocked_m_uid=eq.${resolved.m_uid}&select=blocker_m_uid&limit=1`),
        service(env,`network_mutes?muter_m_uid=eq.${me}&muted_m_uid=eq.${resolved.m_uid}&select=muter_m_uid,expires_at&limit=1`)
      ]);
      following=!!f?.length;blocked=!!b?.length;muted=!!m?.length;
    }
    const [fc,fg,pc]=await Promise.all([
      service(env,`network_follows?followed_m_uid=eq.${resolved.m_uid}&status=eq.following&select=follower_m_uid`),
      service(env,`network_follows?follower_m_uid=eq.${resolved.m_uid}&status=eq.following&select=followed_m_uid`),
      service(env,`network_posts?author_m_uid=eq.${resolved.m_uid}&deleted_at=is.null&reply_to_id=is.null&select=id,visibility`)
    ]);
    followers=(fc||[]).length;followingCount=(fg||[]).length;
    posts=(pc||[]).filter(x=>resolved.m_uid===me||x.visibility==='public'||(x.visibility==='network'&&following)).length;
    if(external)await meter(env,external,'mnet.read',path,req.method,200,null,start);
    return reply(req,env,{identity:resolved.identity,profile:resolved.profile,following,blocked,muted,counts:{followers,following:followingCount,posts}});
  }
  if(path==='/v1/mnet/profile'&&req.method==='PATCH'){
    if(external)return fail(req,env,'Profile mutation requires a McCluster user session',403); const b=await json(req);
    if(b.mccluster_id!==undefined)await userRpc(req,env,'set_mccluster_id',{p_mccluster_id:String(b.mccluster_id||'').trim()});
    const data=await userRpc(req,env,'mnet_complete_surface_profile',{p_app_key:appKey,p_display_name:b.display_name||'',p_headline:b.headline||'',p_bio:b.bio||'',p_avatar_url:b.avatar_url||'',p_banner_url:b.banner_url||'',p_website_url:b.website_url||''}); return reply(req,env,data);
  }
  if(path==='/v1/mnet/posts'&&req.method==='POST'){
    if(external)return fail(req,env,'Post creation currently requires a McCluster user session',403);
    const b=await json(req),muid=await currentMuid(env,user.id); if(!muid)return fail(req,env,'McCluster identity unavailable',409);
    const prepared=await prepareNetworkPost(env,muid,b,appKey);
    if(prepared.error)return fail(req,env,prepared.error,prepared.status||400);
    /* POST NOW, OR LATER. A publish_at in the future holds the post in
       network_scheduled_posts and the five-minute cron publishes it, running
       every check above again at that moment: media still owned and ready,
       still a member of the group. Replies are never scheduled; a reply
       belongs to the moment it answers. */
    if(b.publish_at!==undefined&&b.publish_at!==null&&b.publish_at!==''){
      const when=scheduleTime(b.publish_at);
      if(when.error)return fail(req,env,when.error,400);
      if(prepared.draft.reply_to_id)return fail(req,env,'A reply goes out when you send it',400);
      try{
        const rows=await service(env,'network_scheduled_posts',{method:'POST',headers:{prefer:'return=representation'},body:JSON.stringify({author_m_uid:muid,publish_at:when.at,payload:{...prepared.draft,app_key:appKey}})});
        return reply(req,env,{scheduled:scheduledView(rows?.[0])},201);
      }catch(e){
        if(e?.detail?.code==='PGRST205'||e?.status===404)return fail(req,env,'Scheduling is not switched on yet. Post now, or try again later.',503);
        throw e;
      }
    }
    const rows=await insertNetworkPost(env,muid,prepared.draft,prepared.assets);
    const created=rows?.[0];
    const hydrated=await hydratePostRows(env,rows||[],muid); return reply(req,env,{post:hydrated?.[0]?.post||created,actor:hydrated?.[0]?.actor||null},201);
  }
  if(path==='/v1/mnet/scheduled'&&req.method==='GET'){
    if(external)return fail(req,env,'Scheduled posts require a McCluster user session',403);
    const muid=await currentMuid(env,user.id); if(!muid)return fail(req,env,'McCluster identity unavailable',409);
    try{
      const rows=await service(env,`network_scheduled_posts?author_m_uid=eq.${muid}&status=in.(scheduled,publishing,failed)&order=publish_at.asc&limit=50&select=id,publish_at,status,payload,error,created_at`);
      return reply(req,env,{scheduled:(rows||[]).map(scheduledView)});
    }catch(e){
      if(e?.detail?.code==='PGRST205'||e?.status===404)return reply(req,env,{scheduled:[],available:false});
      throw e;
    }
  }
  const scheduledOne=path.match(/^\/v1\/mnet\/scheduled\/([0-9a-f-]{36})$/i);
  if(scheduledOne&&req.method==='DELETE'){
    if(external)return fail(req,env,'Scheduled posts require a McCluster user session',403);
    const muid=await currentMuid(env,user.id); if(!muid)return fail(req,env,'McCluster identity unavailable',409);
    const out=await service(env,`network_scheduled_posts?id=eq.${scheduledOne[1]}&author_m_uid=eq.${muid}&status=in.(scheduled,failed)`,{method:'PATCH',headers:{prefer:'return=representation'},body:JSON.stringify({status:'cancelled',updated_at:new Date().toISOString()})});
    if(!out?.length)return fail(req,env,'That post is not waiting any more',404);
    return reply(req,env,{cancelled:true,id:scheduledOne[1]});
  }
  /* ---------------- GROUPS ----------------
     Rooms inside the network. The list is readable by anyone signed in,
     because that is how you find one to join; everything else is scoped to
     the caller's own membership. */
  if(path==='/v1/mnet/groups'&&req.method==='GET'){
    if(external)return fail(req,env,'Groups require a McCluster user session',403);
    const muid=await currentMuid(env,user.id); if(!muid)return fail(req,env,'McCluster identity unavailable',409);
    const [all,mine]=await Promise.all([
      service(env,'network_groups?select=id,slug,name,purpose,visibility,member_count,organization_id,group_type,front_page_url&order=member_count.desc,name.asc'),
      service(env,`network_group_members?m_uid=eq.${muid}&state=eq.joined&select=group_id`)
    ]);
    const joined=new Set((mine||[]).map(r=>r.group_id));
    return reply(req,env,{groups:(all||[]).map(g=>({...g,joined:joined.has(g.id)}))});
  }
  const groupOne=path.match(/^\/v1\/mnet\/groups\/([a-z0-9-]{1,64})$/i);
  if(groupOne&&req.method==='GET'){
    if(external)return fail(req,env,'Groups require a McCluster user session',403);
    const muid=await currentMuid(env,user.id); if(!muid)return fail(req,env,'McCluster identity unavailable',409);
    const rows=await service(env,`network_groups?slug=eq.${encodeURIComponent(groupOne[1])}&select=id,slug,name,purpose,visibility,member_count,organization_id,group_type,front_page_url&limit=1`);
    const group=rows?.[0]; if(!group)return fail(req,env,'Group not found',404);
    const mine=await service(env,`network_group_members?group_id=eq.${group.id}&m_uid=eq.${muid}&state=eq.joined&select=group_id&limit=1`);
    const posts=await service(env,`network_posts?group_id=eq.${group.id}&deleted_at=is.null&reply_to_id=is.null&order=created_at.desc&limit=40&select=id,author_m_uid,body,post_type,visibility,media,metadata,content_id,reply_to_id,group_id,created_at,updated_at,source_app_id,source_org_id`);
    /* The same hydration the feed uses, so a post reads identically in a
       group and in the open feed. */
    const items=await hydratePostRows(env,posts||[],muid);
    let organization=null,campaigns=[];
    if(group.organization_id){
      const orgs=await service(env,`network_organizations?id=eq.${group.organization_id}&select=id,slug,name,organization_type,description,website_url,verification_state&limit=1`);
      organization=orgs?.[0]||null;
      campaigns=await service(env,`action_campaigns?group_id=eq.${group.id}&status=in.(live,paused)&select=id,slug,status,title,kicker,headline,current_phase,people_goal&order=sort.asc`);
    }
    return reply(req,env,{group:{...group,joined:!!mine?.length},organization,campaigns,items});
  }
  const groupJoin=path.match(/^\/v1\/mnet\/groups\/([a-z0-9-]{1,64})\/membership$/i);
  if(groupJoin&&['POST','DELETE'].includes(req.method)){
    if(external)return fail(req,env,'Groups require a McCluster user session',403);
    const muid=await currentMuid(env,user.id); if(!muid)return fail(req,env,'McCluster identity unavailable',409);
    const rows=await service(env,`network_groups?slug=eq.${encodeURIComponent(groupJoin[1])}&select=id,visibility&limit=1`);
    const group=rows?.[0]; if(!group)return fail(req,env,'Group not found',404);
    if(req.method==='DELETE'){
      await service(env,`network_group_members?group_id=eq.${group.id}&m_uid=eq.${muid}`,{method:'DELETE',headers:{prefer:'return=minimal'}});
      return reply(req,env,{joined:false});
    }
    if(group.visibility==='invite')return fail(req,env,'This group is invitation only',403);
    const state=group.visibility==='request'?'requested':'joined';
    await service(env,'network_group_members',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({group_id:group.id,m_uid:muid,state})});
    return reply(req,env,{joined:state==='joined',requested:state==='requested'});
  }
  const replies=path.match(/^\/v1\/mnet\/posts\/([0-9a-f-]{36})\/replies$/i);
  if(replies&&req.method==='GET'){
    const parentRows=await service(env,`network_posts?id=eq.${replies[1]}&deleted_at=is.null&select=*&limit=1`),parent=parentRows?.[0]; if(!parent)return fail(req,env,'Post not found',404);
    let viewer=null;if(external){if(parent.visibility!=='public')return fail(req,env,'Post not found',404)}else{viewer=await currentMuid(env,user.id);if(!(await canReadNetworkPost(env,viewer,parent)))return fail(req,env,'Post not found',404)}
    const rows=await service(env,`network_posts?reply_to_id=eq.${replies[1]}&deleted_at=is.null&order=created_at.asc&select=id,author_m_uid,body,post_type,visibility,media,metadata,content_id,reply_to_id,created_at,updated_at,source_app_id,source_org_id`);
    const visible=external?(rows||[]).filter(x=>x.visibility==='public'):(rows||[]); const hydrated=await hydratePostRows(env,visible,viewer); if(external)await meter(env,external,'mnet.read',path,req.method,200,null,start); return reply(req,env,{replies:hydrated});
  }
  const react=path.match(/^\/v1\/mnet\/posts\/([0-9a-f-]{36})\/reactions$/i);
  if(react&&['POST','DELETE'].includes(req.method)){
    if(external)return fail(req,env,'Reaction mutation requires a McCluster user session',403);
    const b=await json(req),muid=await currentMuid(env,user.id); if(!muid)return fail(req,env,'McCluster identity unavailable',409);
    const posts=await service(env,`network_posts?id=eq.${react[1]}&deleted_at=is.null&select=*&limit=1`),post=posts?.[0];
    if(!post||!(await canReadNetworkPost(env,muid,post)))return fail(req,env,'Post not found',404);
    const reaction=String(b.reaction||'like').slice(0,40);
    if(req.method==='DELETE'){await service(env,`network_reactions?post_id=eq.${react[1]}&actor_m_uid=eq.${muid}&reaction=eq.${encodeURIComponent(reaction)}`,{method:'DELETE',headers:{prefer:'return=minimal'}});return reply(req,env,{reaction:null})}
    const rows=await service(env,'network_reactions',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({post_id:react[1],actor_m_uid:muid,reaction})}); return reply(req,env,{reaction:rows?.[0]},201);
  }
  const follow=path.match(/^\/v1\/mnet\/people\/([^/]+)\/follow$/);
  if(follow&&['POST','DELETE'].includes(req.method)){
    if(external)return fail(req,env,'Follow mutation requires a McCluster user session',403);
    const muid=await currentMuid(env,user.id),targetId=decodeURIComponent(follow[1]),resolved=await resolveMnetPerson(env,targetId);
    if(!muid||!resolved)return fail(req,env,'Person not found',404);
    const target=resolved.m_uid;if(target===muid)return fail(req,env,'You cannot follow yourself',400);
    if(await networkBlocked(env,muid,target))return fail(req,env,'Person not found',404);
    if(req.method==='POST'){await service(env,'network_follows',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({follower_m_uid:muid,followed_m_uid:target,status:'following'})});return reply(req,env,{following:true});}
    await service(env,`network_follows?follower_m_uid=eq.${muid}&followed_m_uid=eq.${target}`,{method:'DELETE',headers:{prefer:'return=minimal'}}); return reply(req,env,{following:false});
  }
  if(path==='/v1/mnet/notifications/read'&&req.method==='POST'){
    if(external)return fail(req,env,'Notifications require a McCluster user session',403); const muid=await currentMuid(env,user.id); if(!muid)return fail(req,env,'McCluster identity unavailable',409);
    const readAt=new Date().toISOString(); await service(env,`network_notifications?recipient_m_uid=eq.${muid}&read_at=is.null`,{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({read_at:readAt})}); return reply(req,env,{ok:true,read_at:readAt});
  }
  if(path==='/v1/mnet/notifications'&&req.method==='GET'){
    if(external)return fail(req,env,'Notifications require a McCluster user session',403); const muid=await currentMuid(env,user.id); const rows=await service(env,`network_notifications?recipient_m_uid=eq.${muid}&order=created_at.desc&limit=100&select=*`); return reply(req,env,{notifications:rows||[]});
  }
  if(path==='/v1/mnet/discover'&&req.method==='GET'){
    if(external)return fail(req,env,'Discovery requires a McCluster user session',403);
    const data=await userRpc(req,env,'mnet_discover',{p_query:String(url.searchParams.get('q')||'').slice(0,120),p_limit:Math.min(100,Math.max(1,Number(url.searchParams.get('limit')||25)))});
    return reply(req,env,{people:data||[]});
  }

  const personPosts=path.match(/^\/v1\/mnet\/people\/([^/]+)\/posts$/);
  if(personPosts&&req.method==='GET'){
    const resolved=await resolveMnetPerson(env,decodeURIComponent(personPosts[1])); if(!resolved)return fail(req,env,'Person not found',404);
    const viewer=external?null:await currentMuid(env,user.id);
    if(!(await canReadNetworkProfile(env,viewer,resolved)))return fail(req,env,'Person not found',404);
    const limit=Math.min(50,Math.max(1,Number(url.searchParams.get('limit')||20))),before=url.searchParams.get('before');
    const rows=await service(env,`network_posts?author_m_uid=eq.${resolved.m_uid}&reply_to_id=is.null&deleted_at=is.null${before?`&created_at=lt.${encodeURIComponent(before)}`:''}&order=created_at.desc&limit=${limit+1}&select=*`);
    const visible=[];
    for(const post of rows||[]){if(external?(post.visibility==='public'):(await canReadNetworkPost(env,viewer,post)))visible.push(post)}
    const page=visible.slice(0,limit),hydrated=await hydratePostRows(env,page,viewer);
    let next=null;
    if(visible.length>limit)next=page[page.length-1]?.created_at||null;
    else if((rows||[]).length>limit)next=rows[rows.length-1]?.created_at||null;
    if(external)await meter(env,external,'mnet.read',path,req.method,200,null,start);
    return reply(req,env,{posts:hydrated,next_before:next});
  }

  const postOne=path.match(/^\/v1\/mnet\/posts\/([0-9a-f-]{36})$/i);
  if(postOne&&req.method==='GET'){
    const rows=await service(env,`network_posts?id=eq.${postOne[1]}&deleted_at=is.null&select=*&limit=1`),post=rows?.[0];if(!post)return fail(req,env,'Post not found',404);
    let viewer=null;if(external){if(post.visibility!=='public')return fail(req,env,'Post not found',404)}else{viewer=await currentMuid(env,user.id);if(!(await canReadNetworkPost(env,viewer,post)))return fail(req,env,'Post not found',404)}
    const hydrated=await hydratePostRows(env,[post],viewer);return reply(req,env,hydrated[0]||{post});
  }
  if(postOne&&req.method==='PATCH'){
    if(external)return fail(req,env,'Post mutation requires a McCluster user session',403);
    const muid=await currentMuid(env,user.id),rows=await service(env,`network_posts?id=eq.${postOne[1]}&deleted_at=is.null&select=*&limit=1`),post=rows?.[0];
    if(!post||post.author_m_uid!==muid)return fail(req,env,'Post not found',404);
    const b=await json(req),patch={updated_at:new Date().toISOString()};
    if(b.body!==undefined){patch.body=String(b.body||'').trim();const cap=post.reply_to_id?1000:2000;if(chars(patch.body)>cap)return fail(req,env,`${post.reply_to_id?'Replies':'Posts'} are limited to ${cap.toLocaleString('en-US')} characters.`,413);}
    if(b.visibility!==undefined&&!post.reply_to_id&&['public','network','private'].includes(b.visibility))patch.visibility=b.visibility;
    if(!String(patch.body===undefined?post.body:patch.body).trim()&&!(post.media||[]).length)return fail(req,env,'Post body or media is required',400);
    const out=await service(env,`network_posts?id=eq.${post.id}&author_m_uid=eq.${muid}`,{method:'PATCH',headers:{prefer:'return=representation'},body:JSON.stringify(patch)});
    const hydrated=await hydratePostRows(env,out||[],muid);return reply(req,env,hydrated[0]||{post:out?.[0]});
  }
  if(postOne&&req.method==='DELETE'){
    if(external)return fail(req,env,'Post mutation requires a McCluster user session',403);
    const muid=await currentMuid(env,user.id),rows=await service(env,`network_posts?id=eq.${postOne[1]}&author_m_uid=eq.${muid}&deleted_at=is.null&select=id&limit=1`);
    if(!rows?.length)return fail(req,env,'Post not found',404);
    const at=new Date().toISOString();await service(env,`network_posts?id=eq.${postOne[1]}&author_m_uid=eq.${muid}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({deleted_at:at,updated_at:at})});
    return reply(req,env,{deleted:true});
  }

  if(path==='/v1/mnet/blocks'&&req.method==='GET'){
    if(external)return fail(req,env,'Blocked people require a McCluster user session',403);
    const muid=await currentMuid(env,user.id);
    const rows=await service(env,`network_blocks?blocker_m_uid=eq.${muid}&order=created_at.desc&limit=200&select=blocked_m_uid,created_at`);
    const actors=await networkActors(env,(rows||[]).map(x=>x.blocked_m_uid));
    return reply(req,env,{blocks:(rows||[]).map(x=>({...x,profile:actors[x.blocked_m_uid]||{m_uid:x.blocked_m_uid}}))});
  }

  if(path==='/v1/mnet/bookmarks'&&req.method==='GET'){
    if(external)return fail(req,env,'Bookmarks require a McCluster user session',403);
    const muid=await currentMuid(env,user.id),marks=await service(env,`network_bookmarks?m_uid=eq.${muid}&order=created_at.desc&limit=100&select=post_id,created_at`);
    const ids=uniq((marks||[]).map(x=>x.post_id)).filter(uuidLike);
    const rows=ids.length?await service(env,`network_posts?id=in.(${ids.join(',')})&deleted_at=is.null&select=*`):[];
    const visible=[];for(const post of rows||[]){if(await canReadNetworkPost(env,muid,post))visible.push(post)}
    const hydrated=await hydratePostRows(env,visible,muid),byId=new Map(hydrated.map(x=>[x.post.id,x]));
    return reply(req,env,{bookmarks:(marks||[]).map(m=>({...m,item:byId.get(m.post_id)||null})).filter(x=>x.item)});
  }
  const bookmark=path.match(/^\/v1\/mnet\/posts\/([0-9a-f-]{36})\/bookmark$/i);
  if(bookmark&&['POST','DELETE'].includes(req.method)){
    if(external)return fail(req,env,'Bookmarks require a McCluster user session',403);const muid=await currentMuid(env,user.id);
    const rows=await service(env,`network_posts?id=eq.${bookmark[1]}&deleted_at=is.null&select=*&limit=1`),post=rows?.[0];if(!post||!(await canReadNetworkPost(env,muid,post)))return fail(req,env,'Post not found',404);
    if(req.method==='POST'){await service(env,'network_bookmarks',{method:'POST',headers:{prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({m_uid:muid,post_id:post.id})});return reply(req,env,{bookmarked:true});}
    await service(env,`network_bookmarks?m_uid=eq.${muid}&post_id=eq.${post.id}`,{method:'DELETE',headers:{prefer:'return=minimal'}});return reply(req,env,{bookmarked:false});
  }

  const safety=path.match(/^\/v1\/mnet\/people\/([^/]+)\/(block|mute)$/);
  if(safety&&['POST','DELETE'].includes(req.method)){
    if(external)return fail(req,env,'Safety controls require a McCluster user session',403);
    const muid=await currentMuid(env,user.id),resolved=await resolveMnetPerson(env,decodeURIComponent(safety[1]));if(!muid||!resolved)return fail(req,env,'Person not found',404);
    const target=resolved.m_uid;if(target===muid)return fail(req,env,'Invalid target',400);
    if(safety[2]==='block'){
      if(req.method==='POST'){
        await service(env,'network_blocks',{method:'POST',headers:{prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({blocker_m_uid:muid,blocked_m_uid:target})});
        await Promise.all([
          service(env,`network_follows?follower_m_uid=eq.${muid}&followed_m_uid=eq.${target}`,{method:'DELETE',headers:{prefer:'return=minimal'}}),
          service(env,`network_follows?follower_m_uid=eq.${target}&followed_m_uid=eq.${muid}`,{method:'DELETE',headers:{prefer:'return=minimal'}})
        ]);
        return reply(req,env,{blocked:true});
      }
      await service(env,`network_blocks?blocker_m_uid=eq.${muid}&blocked_m_uid=eq.${target}`,{method:'DELETE',headers:{prefer:'return=minimal'}});return reply(req,env,{blocked:false});
    }
    if(req.method==='POST'){const b=await json(req),expires=b.expires_at||null;await service(env,'network_mutes',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({muter_m_uid:muid,muted_m_uid:target,expires_at:expires})});return reply(req,env,{muted:true});}
    await service(env,`network_mutes?muter_m_uid=eq.${muid}&muted_m_uid=eq.${target}`,{method:'DELETE',headers:{prefer:'return=minimal'}});return reply(req,env,{muted:false});
  }

  if(path==='/v1/mnet/reports'&&req.method==='POST'){
    if(external)return fail(req,env,'Reports require a McCluster user session',403);
    const muid=await currentMuid(env,user.id),b=await json(req),types=['post','profile','message','media'],reasons=['spam','harassment','hate','violence','sexual','impersonation','copyright','privacy','self_harm','other'];
    const targetType=String(b.target_type||''),reason=String(b.reason||'other'),targetId=String(b.target_id||'').slice(0,200);
    if(!types.includes(targetType)||!reasons.includes(reason)||!targetId)return fail(req,env,'Invalid report',400);
    const rows=await service(env,'network_reports',{method:'POST',headers:{prefer:'return=representation'},body:JSON.stringify({reporter_m_uid:muid,target_type:targetType,target_id:targetId,reason,details:String(b.details||'').slice(0,4000)})});
    return reply(req,env,{report:rows?.[0]},201);
  }

  if(path==='/v1/mnet/conversations'&&req.method==='GET'){
    if(external)return fail(req,env,'Messages require a McCluster user session',403);
    const muid=await currentMuid(env,user.id),members=await service(env,`network_conversation_members?m_uid=eq.${muid}&member_state=neq.left&select=conversation_id,member_state,last_read_at&order=joined_at.desc`);
    const ids=uniq((members||[]).map(x=>x.conversation_id)).filter(uuidLike);if(!ids.length)return reply(req,env,{conversations:[]});
    const [convos,allMembers,messages]=await Promise.all([
      service(env,`network_conversations?id=in.(${ids.join(',')})&select=*&order=last_message_at.desc.nullslast,updated_at.desc`),
      service(env,`network_conversation_members?conversation_id=in.(${ids.join(',')})&member_state=neq.left&select=conversation_id,m_uid,role,member_state,last_read_at`),
      service(env,`network_messages?conversation_id=in.(${ids.join(',')})&deleted_at=is.null&select=id,conversation_id,sender_m_uid,body,media,created_at&order=created_at.desc&limit=300`)
    ]);
    const actors=await networkActors(env,(allMembers||[]).map(x=>x.m_uid)),last=new Map();for(const m of messages||[]){if(!last.has(m.conversation_id))last.set(m.conversation_id,m)}
    const myState=new Map((members||[]).map(x=>[x.conversation_id,x]));
    const out=(convos||[]).map(cv=>({conversation:cv,my:myState.get(cv.id),members:(allMembers||[]).filter(x=>x.conversation_id===cv.id).map(x=>({...x,profile:actors[x.m_uid]||{m_uid:x.m_uid}})),last_message:last.get(cv.id)||null}));
    return reply(req,env,{conversations:out});
  }
  if(path==='/v1/mnet/conversations'&&req.method==='POST'){
    if(external)return fail(req,env,'Messages require a McCluster user session',403);const b=await json(req);let target=String(b.target_m_uid||'');
    if(!uuidLike(target)&&b.mccluster_id){const resolved=await resolveMnetPerson(env,String(b.mccluster_id));target=resolved?.m_uid||''}
    if(!uuidLike(target))return fail(req,env,'Target person is required',400);
    const id=await userRpc(req,env,'mnet_open_direct',{p_target_m_uid:target});return reply(req,env,{conversation_id:id},201);
  }
  const convo=path.match(/^\/v1\/mnet\/conversations\/([0-9a-f-]{36})$/i);
  if(convo&&req.method==='GET'){
    if(external)return fail(req,env,'Messages require a McCluster user session',403);const muid=await currentMuid(env,user.id);
    const mine=await service(env,`network_conversation_members?conversation_id=eq.${convo[1]}&m_uid=eq.${muid}&member_state=neq.left&select=*&limit=1`);if(!mine?.length)return fail(req,env,'Conversation not found',404);
    const [cv,members]=await Promise.all([service(env,`network_conversations?id=eq.${convo[1]}&select=*&limit=1`),service(env,`network_conversation_members?conversation_id=eq.${convo[1]}&member_state=neq.left&select=*`)]);
    const actors=await networkActors(env,(members||[]).map(x=>x.m_uid));return reply(req,env,{conversation:cv?.[0]||null,my:mine[0],members:(members||[]).map(x=>({...x,profile:actors[x.m_uid]||{m_uid:x.m_uid}}))});
  }
  const accept=path.match(/^\/v1\/mnet\/conversations\/([0-9a-f-]{36})\/accept$/i);
  if(accept&&req.method==='POST'){if(external)return fail(req,env,'Messages require a McCluster user session',403);const ok=await userRpc(req,env,'mnet_accept_conversation',{p_conversation_id:accept[1]});return reply(req,env,{accepted:!!ok});}
  const messages=path.match(/^\/v1\/mnet\/conversations\/([0-9a-f-]{36})\/messages$/i);
  if(messages&&req.method==='GET'){
    if(external)return fail(req,env,'Messages require a McCluster user session',403);const muid=await currentMuid(env,user.id),mine=await service(env,`network_conversation_members?conversation_id=eq.${messages[1]}&m_uid=eq.${muid}&member_state=neq.left&select=*&limit=1`);if(!mine?.length)return fail(req,env,'Conversation not found',404);
    const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit')||50))),before=url.searchParams.get('before');
    const rows=await service(env,`network_messages?conversation_id=eq.${messages[1]}&deleted_at=is.null${before?`&created_at=lt.${encodeURIComponent(before)}`:''}&order=created_at.desc&limit=${limit+1}&select=*`);
    const page=(rows||[]).slice(0,limit),cursor=(rows||[]).length>limit?page[page.length-1]?.created_at||null:null,actors=await networkActors(env,page.map(x=>x.sender_m_uid));await userRpc(req,env,'mnet_mark_conversation_read',{p_conversation_id:messages[1]}).catch(()=>null);
    return reply(req,env,{messages:page.slice().reverse().map(x=>({...x,sender:actors[x.sender_m_uid]||{m_uid:x.sender_m_uid}})),next_before:cursor});
  }
  if(messages&&req.method==='POST'){
    if(external)return fail(req,env,'Messages require a McCluster user session',403);const b=await json(req),id=await userRpc(req,env,'mnet_send_message',{p_conversation_id:messages[1],p_body:String(b.body||''),p_media:Array.isArray(b.media)?b.media:[]});
    return reply(req,env,{message_id:id},201);
  }

  if(path==='/v1/mnet/media/upload-url'&&req.method==='POST'){if(external)return fail(req,env,'Media upload requires a McCluster user session',403);const b=await json(req);return reply(req,env,await callMnetMedia(req,env,{action:'upload-url',file_name:b.file_name,mime_type:b.mime_type,byte_size:b.byte_size,alt_text:b.alt_text}));}
  if(path==='/v1/mnet/media/finalize'&&req.method==='POST'){if(external)return fail(req,env,'Media upload requires a McCluster user session',403);const b=await json(req);return reply(req,env,await callMnetMedia(req,env,{action:'finalize',asset_id:b.asset_id,width:b.width,height:b.height,duration_ms:b.duration_ms}));}
  if(path==='/v1/mnet/media/discard'&&req.method==='POST'){if(external)return fail(req,env,'Media cleanup requires a McCluster user session',403);const b=await json(req);return reply(req,env,await callMnetMedia(req,env,{action:'discard',asset_id:b.asset_id}));}
  /* GOVERNED LIVE.
     Live is an Action Network program surface, not a follower entitlement.
     The database returns the caller's bounded host capability; the Worker
     validates that capability against a persistent Home/Mission room before
     it creates a one-use Cloudflare Stream input. Audience presence is
     private and only aggregate outcome/retention counts leave the Worker. */
  if(path.startsWith('/v1/mnet/live')){
    if(external)return fail(req,env,'Live requires a McCluster user session',403);
    const hostContext=async()=>await userRpc(req,env,'live_host_context',{});
    const liveAdmin=async()=>(await userRpc(req,env,'eu_is_admin',{}))===true;
    const cleanCategory=(v)=>String(v||'').toLowerCase().trim();
    const cleanKind=(v)=>String(v||'').toLowerCase().trim();
    const roomSlug=(title)=>{const root=String(title||'room').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,62)||'room';return `${root}-${crypto.randomUUID().slice(0,6)}`};

    if(path==='/v1/mnet/live/eligibility'&&req.method==='GET'){
      const eligibility=await hostContext();
      return reply(req,env,{...eligibility,enabled:liveEnabled(env),stage_transport:'single_host_stream'});
    }

    if(path==='/v1/mnet/live/options'&&req.method==='GET'){
      const muid=await currentMuid(env,user.id);if(!muid)return fail(req,env,'Your Action identity is not ready yet',409);
      const eligibility=await hostContext();
      const [categories,rooms,missions,music]=await Promise.all([
        service(env,'network_live_categories?enabled=eq.true&select=key,label,description,sort&order=sort.asc'),
        service(env,`network_live_rooms?owner_m_uid=eq.${muid}&status=eq.active&select=id,slug,title,description,room_kind,category_key,action_mission_id,cohort_id,music_object_id,seat_limit,support_enabled&order=updated_at.desc&limit=50`),
        service(env,'action_missions?status=eq.open&select=id,campaign_id,title,description,domain,starts_at,ends_at&order=created_at.desc&limit=100'),
        service(env,'music_catalog_objects?status=eq.active&select=id,catalog_key,album_slug,album_title,track_title,artist_name,credit_line,artwork_path,canonical_url&order=album_title.asc,track_title.asc&limit=250')
      ]);
      return reply(req,env,{
        eligibility:{...eligibility,enabled:liveEnabled(env)},
        categories:categories||[],rooms:rooms||[],missions:missions||[],music:music||[],
        room_kinds:[{key:'home',label:'Home room'},{key:'mission',label:'Mission room'}],
        stage:{roles:['cohost','guest'],transport:'single_host_stream',multi_seat_ready:false}
      });
    }

    if(path==='/v1/mnet/live/directory'&&req.method==='GET'){
      const kind=cleanKind(url.searchParams.get('kind')),category=cleanCategory(url.searchParams.get('category'));
      if(kind&&!['home','mission'].includes(kind))return fail(req,env,'Unknown live room type',400);
      const categories=await service(env,'network_live_categories?enabled=eq.true&select=key');
      const categorySet=new Set((categories||[]).map(x=>x.key));
      if(category&&!categorySet.has(category))return fail(req,env,'Unknown live category',400);
      const cutoff=new Date(Date.now()-2*60*1000).toISOString();
      const filters=[`status=eq.live`,`last_seen_at=gt.${encodeURIComponent(cutoff)}`];
      if(kind)filters.push(`room_kind=eq.${encodeURIComponent(kind)}`);
      if(category)filters.push(`category_key=eq.${encodeURIComponent(category)}`);
      const rows=await service(env,`network_live_sessions?${filters.join('&')}&select=id,host_m_uid,title,status,whep_url,post_id,started_at,last_seen_at,room_id,room_kind,category_key,action_mission_id,music_object_id,cohort_id,seat_limit,support_enabled&order=started_at.desc&limit=50`);
      const ids=(rows||[]).map(x=>x.id).filter(uuidLike);
      if(!ids.length)return reply(req,env,{sessions:[],kind:kind||'all',category:category||'all'});
      const missionIds=uniq(rows.map(x=>x.action_mission_id)).filter(uuidLike),musicIds=uniq(rows.map(x=>x.music_object_id)).filter(uuidLike),roomIds=uniq(rows.map(x=>x.room_id)).filter(uuidLike);
      const [metrics,actors,missions,music,rooms]=await Promise.all([
        service(env,'rpc/network_live_session_metrics',{method:'POST',body:JSON.stringify({p_session_ids:ids})}),
        networkActors(env,rows.map(x=>x.host_m_uid)),
        missionIds.length?service(env,`action_missions?id=in.(${missionIds.join(',')})&select=id,campaign_id,title,description,domain,status`):[],
        musicIds.length?service(env,`music_catalog_objects?id=in.(${musicIds.join(',')})&select=id,catalog_key,album_slug,album_title,track_title,artist_name,credit_line,artwork_path,canonical_url`):[],
        roomIds.length?service(env,`network_live_rooms?id=in.(${roomIds.join(',')})&select=id,slug,title,description`):[]
      ]);
      const mm=new Map((metrics||[]).map(x=>[x.session_id,x])),mi=new Map((missions||[]).map(x=>[x.id,x])),mu=new Map((music||[]).map(x=>[x.id,x])),rm=new Map((rooms||[]).map(x=>[x.id,x]));
      const sessions=(rows||[]).map(s=>({...s,host:actors[s.host_m_uid]||{m_uid:s.host_m_uid},room:rm.get(s.room_id)||null,mission:mi.get(s.action_mission_id)||null,music:mu.get(s.music_object_id)||null,metrics:mm.get(s.id)||{unique_viewers:0,engaged_viewers:0,joined:0,submitted:0,verified:0,score:0,score_basis:s.room_kind==='mission'?'verified_actions_per_viewer':'engaged_viewers_60s'}}));
      if(kind)sessions.sort((a,b)=>Number(b.metrics?.score||0)-Number(a.metrics?.score||0)||new Date(b.started_at||0)-new Date(a.started_at||0));
      else sessions.sort((a,b)=>new Date(b.started_at||0)-new Date(a.started_at||0));
      return reply(req,env,{sessions,kind:kind||'all',category:category||'all'});
    }

    if(path==='/v1/mnet/live/admin/grants'&&req.method==='GET'){
      if(!(await liveAdmin()))return fail(req,env,'Not found',404);
      const rows=await service(env,'network_live_host_grants?select=id,m_uid,basis,cohort_id,org_id,allowed_categories,max_stage_seats,support_allowed,status,starts_at,expires_at,note,created_at&order=created_at.desc&limit=200');
      return reply(req,env,{grants:rows||[]});
    }
    if(path==='/v1/mnet/live/admin/grants'&&req.method==='POST'){
      if(!(await liveAdmin()))return fail(req,env,'Not found',404);
      const b=await json(req),muid=String(b.m_uid||'');
      if(!uuidLike(muid))return fail(req,env,'A valid Action identity is required',400);
      const basis=String(b.basis||'cohort'),category=cleanCategory(b.category);
      if(!['cohort','client_project','staff'].includes(basis))return fail(req,env,'Unknown live grant basis',400);
      const categories=await service(env,`network_live_categories?key=eq.${encodeURIComponent(category)}&enabled=eq.true&select=key&limit=1`);
      if(!categories?.length)return fail(req,env,'Choose an enabled live category',400);
      const cohortId=basis==='cohort'&&uuidLike(b.cohort_id)?b.cohort_id:null,orgId=basis==='client_project'&&uuidLike(b.org_id)?b.org_id:null;
      if(basis==='cohort'&&!cohortId)return fail(req,env,'Choose the cohort that authorizes this host',400);
      if(basis==='client_project'&&!orgId)return fail(req,env,'Choose the client organization that authorizes this host',400);
      const scope=`m_uid=eq.${muid}&basis=eq.${basis}&status=eq.active&cohort_id=${cohortId?'eq.'+cohortId:'is.null'}&org_id=${orgId?'eq.'+orgId:'is.null'}`;
      const existing=await service(env,`network_live_host_grants?${scope}&select=*&limit=1`);
      let grant;
      if(existing?.[0]){
        const cats=uniq([...(existing[0].allowed_categories||[]),category]).slice(0,5);
        const out=await service(env,`network_live_host_grants?id=eq.${existing[0].id}`,{method:'PATCH',headers:{prefer:'return=representation'},body:JSON.stringify({allowed_categories:cats,note:String(b.note||existing[0].note||'').slice(0,500),updated_at:new Date().toISOString()})});
        grant=out?.[0]||null;
      }else{
        const out=await service(env,'network_live_host_grants',{method:'POST',headers:{prefer:'return=representation'},body:JSON.stringify({m_uid:muid,basis,cohort_id:cohortId,org_id:orgId,allowed_categories:[category],max_stage_seats:Math.min(4,Math.max(1,Number(b.max_stage_seats)||4)),support_allowed:false,note:String(b.note||'').slice(0,500),created_by:user.id})});
        grant=out?.[0]||null;
      }
      return reply(req,env,{grant},201);
    }
    const revokeGrant=path.match(/^\/v1\/mnet\/live\/admin\/grants\/([0-9a-f-]{36})$/i);
    if(revokeGrant&&req.method==='DELETE'){
      if(!(await liveAdmin()))return fail(req,env,'Not found',404);
      const rows=await service(env,`network_live_host_grants?id=eq.${revokeGrant[1]}&status=eq.active`,{method:'PATCH',headers:{prefer:'return=representation'},body:JSON.stringify({status:'revoked',updated_at:new Date().toISOString()})});
      if(!rows?.length)return fail(req,env,'Live grant not found',404);
      return reply(req,env,{revoked:true,id:revokeGrant[1]});
    }

    if(path==='/v1/mnet/live'&&req.method==='POST'){
      const eligibility=await hostContext();
      if(!eligibility?.can_host)return fail(req,env,'Going live requires an active cohort, client-project or staff grant.',403);
      if(!liveEnabled(env))return fail(req,env,'Live video is not switched on yet.',503);
      const b=await json(req),title=String(b.title||'').trim().slice(0,120);
      if(!title)return fail(req,env,'Give this broadcast a title.',400);
      const muid=await currentMuid(env,user.id);if(!muid)return fail(req,env,'Your Action identity is not ready yet',409);
      const allowed=new Set(Array.isArray(eligibility.allowed_categories)?eligibility.allowed_categories:[]);
      let room=null;
      if(uuidLike(b.room_id)){
        const rr=await service(env,`network_live_rooms?id=eq.${b.room_id}&status=eq.active&select=*&limit=1`);
        room=rr?.[0]||null;
        if(!room)return fail(req,env,'That live room is not available',404);
        if(room.owner_m_uid&&room.owner_m_uid!==muid)return fail(req,env,'That live room is not yours',403);
      }else{
        const roomKind=cleanKind(b.room_kind),category=cleanCategory(b.category_key);
        if(!['home','mission'].includes(roomKind))return fail(req,env,'Choose Home room or Mission room',400);
        if(!allowed.has(category))return fail(req,env,'That live category is not in your host grant',403);
        let missionId=null,cohortId=null,musicId=null;
        if(roomKind==='mission'){
          missionId=uuidLike(b.action_mission_id)?b.action_mission_id:null;
          if(!missionId)return fail(req,env,'A Mission room must attach an open mission',400);
          const missions=await service(env,`action_missions?id=eq.${missionId}&status=eq.open&select=id,starts_at,ends_at&limit=1`);
          const mission=missions?.[0];
          if(!mission||mission.starts_at&&Date.parse(mission.starts_at)>Date.now()||mission.ends_at&&Date.parse(mission.ends_at)<=Date.now())return fail(req,env,'That mission is not open right now',409);
        }
        if(uuidLike(b.music_object_id)){
          const music=await service(env,`music_catalog_objects?id=eq.${b.music_object_id}&status=eq.active&select=id&limit=1`);
          if(!music?.length)return fail(req,env,'That song is not in the active catalogue',409);
          musicId=b.music_object_id;
        }
        /* The grant authorizes the host/category. A room only carries a cohort
           when a future operator flow assigns one explicitly; do not infer a
           cohort from whichever active grant happens to be returned first. */
        cohortId=null;
        const roomTitle=String(b.room_title||title).trim().slice(0,120);
        const seatLimit=Math.min(4,Math.max(1,Number(eligibility.max_stage_seats)||1));
        const rows=await service(env,'network_live_rooms',{method:'POST',headers:{prefer:'return=representation'},body:JSON.stringify({slug:roomSlug(roomTitle),owner_m_uid:muid,title:roomTitle,description:String(b.room_description||'').trim().slice(0,1000),room_kind:roomKind,category_key:category,action_mission_id:missionId,cohort_id:cohortId,music_object_id:musicId,seat_limit:seatLimit,support_enabled:false})});
        room=rows?.[0]||null;
      }
      if(!room)return fail(req,env,'Could not resolve the live room',409);
      if(!allowed.has(room.category_key))return fail(req,env,'That room category is not in your host grant',403);
      if(room.room_kind==='mission'){
        const missions=await service(env,`action_missions?id=eq.${room.action_mission_id}&status=eq.open&select=id,starts_at,ends_at&limit=1`);
        const mission=missions?.[0];
        if(!mission||mission.starts_at&&Date.parse(mission.starts_at)>Date.now()||mission.ends_at&&Date.parse(mission.ends_at)<=Date.now())return fail(req,env,'The mission attached to this room is not open right now',409);
      }
      const open=await service(env,`network_live_sessions?host_user_id=eq.${user.id}&status=in.(starting,live)&select=id,cf_input_uid`);
      for(const o of open||[])await endLiveSession(env,o,user.id,'replaced');
      const input=await cfStream(env,'POST','/live_inputs',{meta:{name:`action-network-live ${room.slug} ${muid}`},recording:{mode:'off'}});
      const whip=input?.webRTC?.url,whep=input?.webRTCPlayback?.url;
      if(!input?.uid||!whip||!whep){if(input?.uid)await cfStream(env,'DELETE',`/live_inputs/${input.uid}`).catch(()=>{});return fail(req,env,'Cloudflare did not return a live input.',502);}
      const rows=await service(env,'network_live_sessions',{method:'POST',headers:{prefer:'return=representation'},body:JSON.stringify({host_m_uid:muid,host_user_id:user.id,title,status:'starting',cf_input_uid:input.uid,whep_url:whep,room_id:room.id,room_kind:room.room_kind,category_key:room.category_key,action_mission_id:room.action_mission_id,cohort_id:room.cohort_id,music_object_id:room.music_object_id,seat_limit:room.seat_limit,support_enabled:false})});
      const sess=rows?.[0];
      return reply(req,env,{session:{id:sess.id,title:sess.title,whep_url:whep,status:sess.status,room_id:room.id,room_kind:room.room_kind,category_key:room.category_key,action_mission_id:room.action_mission_id,music_object_id:room.music_object_id,seat_limit:room.seat_limit},room,whip_url:whip,stage:{transport:'single_host_stream',multi_seat_ready:false}},201);
    }

    const watch=path.match(/^\/v1\/mnet\/live\/([0-9a-f-]{36})\/watch$/i);
    if(watch&&req.method==='POST'){
      const muid=await currentMuid(env,user.id);if(!muid)return fail(req,env,'Your Action identity is not ready yet',409);
      const rows=await service(env,`network_live_sessions?id=eq.${watch[1]}&status=eq.live&select=id,host_m_uid,last_seen_at&limit=1`),sess=rows?.[0];
      if(!sess||!sess.last_seen_at||Date.parse(sess.last_seen_at)<Date.now()-2*60*1000)return fail(req,env,'That broadcast is no longer live',410);
      if(sess.host_m_uid!==muid){
        await service(env,'network_live_audience',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({session_id:sess.id,viewer_m_uid:muid,last_seen_at:new Date().toISOString()})});
      }
      return reply(req,env,{id:sess.id,ok:true});
    }

    const one=path.match(/^\/v1\/mnet\/live\/([0-9a-f-]{36})\/(on-air|heartbeat|end|publish)$/i);
    if(one){
      const rows=await service(env,`network_live_sessions?id=eq.${one[1]}&select=*&limit=1`),sess=rows?.[0];
      if(!sess)return fail(req,env,'Broadcast not found',404);
      const host=sess.host_user_id===user.id,act=one[2].toLowerCase();
      if(act==='end'&&req.method==='POST'){
        const desk=!host&&await liveAdmin();
        if(!host&&!desk)return fail(req,env,'Broadcast not found',404);
        if(sess.status!=='ended')await endLiveSession(env,sess,user.id,desk?'desk':'host');
        return reply(req,env,{id:sess.id,status:'ended'});
      }
      if(!host)return fail(req,env,'Broadcast not found',404);
      if(sess.status==='ended')return fail(req,env,'This broadcast has ended.',410);
      const now=new Date().toISOString();
      if(act==='on-air'&&req.method==='POST'){
        let postId=sess.post_id;
        if(!postId){
          const apps=await service(env,`platform_apps?app_key=eq.mccluster-web&enabled=eq.true&select=id&limit=1`);
          const posts=await service(env,'network_posts',{method:'POST',headers:{prefer:'return=representation'},body:JSON.stringify({author_m_uid:sess.host_m_uid,body:`Live now: ${sess.title}`,post_type:'update',visibility:'public',metadata:{live:{session_id:sess.id,room_id:sess.room_id,room_kind:sess.room_kind,category_key:sess.category_key,mission_id:sess.action_mission_id,music_object_id:sess.music_object_id}},source_app_id:apps?.[0]?.id||null})});
          postId=posts?.[0]?.id||null;
        }
        await service(env,`network_live_sessions?id=eq.${sess.id}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({status:'live',started_at:sess.started_at||now,last_seen_at:now,post_id:postId})});
        return reply(req,env,{id:sess.id,status:'live',post_id:postId});
      }
      if(act==='heartbeat'&&req.method==='POST'){
        await service(env,`network_live_sessions?id=eq.${sess.id}&status=eq.live`,{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({last_seen_at:now})});
        return reply(req,env,{id:sess.id,ok:true});
      }
      if(act==='publish'&&req.method==='GET'){
        const input=await cfStream(env,'GET',`/live_inputs/${sess.cf_input_uid}`);
        if(!input?.webRTC?.url)return fail(req,env,'The live input is gone. Start a new broadcast.',410);
        return reply(req,env,{whip_url:input.webRTC.url,whep_url:sess.whep_url});
      }
    }
    return fail(req,env,'Not found',404);
  }
  /* MISSION PROOF MEDIA, for the reviewer only. A proof upload is the
     member's own unattached file, which the media function will not sign for
     anyone else. The desk asks here: the caller must be the owner desk, the
     file must be the one recorded on that proof, and it must belong to the
     member who submitted it. The link expires in fifteen minutes. */
  const proofMedia=path.match(/^\/v1\/mnet\/missions\/proofs\/([0-9a-f-]{36})\/media$/i);
  if(proofMedia&&req.method==='GET'){
    if(external)return fail(req,env,'Proof review requires a McCluster user session',403);
    if((await userRpc(req,env,'eu_is_admin',{}))!==true)return fail(req,env,'Proof not found',404);
    const proofs=await service(env,`action_proofs?id=eq.${proofMedia[1]}&select=id,metadata,assignment_id&limit=1`),proof=proofs?.[0];
    const assetId=proof?.metadata?.asset_id;
    if(!proof||!uuidLike(assetId))return fail(req,env,'Proof has no upload',404);
    const [assignments,assets]=await Promise.all([
      service(env,`action_mission_assignments?id=eq.${proof.assignment_id}&select=m_uid&limit=1`),
      service(env,`network_media_assets?id=eq.${assetId}&select=id,bucket_id,object_path,owner_m_uid,media_type,mime_type&limit=1`)
    ]);
    const asset=assets?.[0];
    if(!asset||!assignments?.[0]||asset.owner_m_uid!==assignments[0].m_uid)return fail(req,env,'Proof has no upload',404);
    const res=await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(asset.bucket_id)}/${String(asset.object_path).split('/').map(encodeURIComponent).join('/')}`,{method:'POST',headers:serviceHeaders(env),body:JSON.stringify({expiresIn:900})});
    const signed=await res.json().catch(()=>null);
    if(!res.ok||!signed?.signedURL)return fail(req,env,'Could not sign the upload',502);
    return reply(req,env,{url:`${env.SUPABASE_URL}/storage/v1${signed.signedURL}`,media_type:asset.media_type,mime_type:asset.mime_type,expires_in:900});
  }
  /* THE OWNER'S TWO LEVERS. Both check mnet_is_admin() inside the function
     rather than here, so the rule lives beside the data and a future caller
     cannot route around it. */
  const pin=path.match(/^\/v1\/mnet\/posts\/([0-9a-f-]{36})\/pin$/i);
  if(pin&&['POST','DELETE'].includes(req.method)){
    if(external)return fail(req,env,'Moderation requires a McCluster user session',403);
    return reply(req,env,await userRpc(req,env,'mnet_admin_set_pinned',{p_post_id:pin[1],p_pinned:req.method==='POST'}));
  }
  const removal=path.match(/^\/v1\/mnet\/posts\/([0-9a-f-]{36})\/removal$/i);
  if(removal&&req.method==='POST'){
    if(external)return fail(req,env,'Moderation requires a McCluster user session',403);
    const b=await json(req);
    return reply(req,env,await userRpc(req,env,'mnet_admin_remove_post',{p_post_id:removal[1],p_reason:String(b.reason||'').slice(0,400)}));
  }

  const mediaUrl=path.match(/^\/v1\/mnet\/media\/([0-9a-f-]{36})\/url$/i);
  if(mediaUrl&&req.method==='GET'){if(external)return fail(req,env,'Media access requires a McCluster user session',403);return reply(req,env,await callMnetMedia(req,env,{action:'view-url',asset_id:mediaUrl[1]}));}

  return null;
}

/* THE FASHION BUREAU OF INVESTIGATION (fbi_board_v1). The fun front of Be
   Authentic: Legit Checks, fake Sightings, and the Most Wanted board.
   Everything is about what somebody is wearing, never who they are: no
   faces unless you turned yourself in, a city at most, and nothing public
   until the owner approves it. Votes earn nothing. */
const FBI_KINDS=['legit_check','sighting','most_wanted'];
const FBI_VOTES={legit_check:['legit','cap'],sighting:['legit','cap'],most_wanted:['guilty','acquitted']};
function fbiText(v,max){return [...String(v==null?'':v).replace(/\s+/g,' ').trim()].slice(0,max).join('')}
/* The streets have spoken once at least five people voted and seven in ten
   agree. Until then the case is still under investigation. */
export function fbiVerdict(row){
  const [yes,no]=row.kind==='most_wanted'?[Number(row.guilty||0),Number(row.acquitted||0)]:[Number(row.cap||0),Number(row.legit||0)];
  const total=yes+no;
  if(total<5)return {verdict:'under_investigation',total};
  if(yes/total>=0.7)return {verdict:row.kind==='most_wanted'?'guilty':'cap',total};
  if(no/total>=0.7)return {verdict:row.kind==='most_wanted'?'acquitted':'legit',total};
  return {verdict:'hung_jury',total};
}
async function fbiPhotos(env,ids){
  const list=uniq(ids).filter(uuidLike);if(!list.length)return {};
  const assets=await service(env,`network_media_assets?id=in.(${list.join(',')})&select=id,bucket_id,object_path`);
  const out={};const byBucket={};
  for(const a of assets||[])(byBucket[a.bucket_id]=byBucket[a.bucket_id]||[]).push(a);
  for(const [bucket,rows] of Object.entries(byBucket)){
    const res=await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(bucket)}`,{method:'POST',headers:serviceHeaders(env),body:JSON.stringify({expiresIn:3600,paths:rows.map(r=>r.object_path)})});
    const signed=await res.json().catch(()=>[]);
    if(!res.ok||!Array.isArray(signed))continue;
    for(const r of rows){const hit=signed.find(x=>x.path===r.object_path&&x.signedURL);if(hit)out[r.id]=`${env.SUPABASE_URL}/storage/v1${hit.signedURL}`;}
  }
  return out;
}
async function fbiCards(env,rows,muid,{withStatus=false}={}){
  const photos=await fbiPhotos(env,(rows||[]).flatMap(r=>r.media_asset_ids||[]));
  let mine={};
  if(muid&&rows?.length){const v=await service(env,`fbi_votes?m_uid=eq.${muid}&case_id=in.(${rows.map(r=>r.id).join(',')})&select=case_id,vote`);for(const x of v||[])mine[x.case_id]=x.vote;}
  return (rows||[]).map(r=>({id:r.id,kind:r.kind,title:r.title,details:r.details,item:r.item,charge:r.charge,city:r.city,self_surrender:!!r.self_surrender,published_at:r.published_at||null,
    photos:(r.media_asset_ids||[]).map(id=>photos[id]).filter(Boolean),
    tally:{legit:Number(r.legit||0),cap:Number(r.cap||0),guilty:Number(r.guilty||0),acquitted:Number(r.acquitted||0)},
    ...fbiVerdict(r),my_vote:mine[r.id]||null,
    ...(withStatus?{status:r.status,removal_reason:r.removal_reason||null,created_at:r.created_at,reports:r.reports??undefined}:{})}));
}
async function handleFbi(req,env,path,url){
  const optionalUser=async()=>{const u=await authUser(req,env);return u?{user:u,muid:await currentMuid(env,u.id)}:null};
  const needUser=async()=>{const s=await optionalUser();if(!s||!s.muid)throw Object.assign(new Error('Sign in to do that'),{status:401});return s};
  const isDesk=async()=>(await userRpc(req,env,'eu_is_admin',{}).catch(()=>false))===true;

  if(path==='/v1/fbi/board'&&req.method==='GET'){
    const kind=url.searchParams.get('kind');
    if(kind&&!FBI_KINDS.includes(kind))return fail(req,env,'Unknown case type',400);
    const limit=Math.min(50,Math.max(1,Number(url.searchParams.get('limit'))||30));
    const rows=await service(env,`fbi_board?select=*${kind?`&kind=eq.${kind}`:''}&order=published_at.desc&limit=${limit}`);
    const s=req.headers.get('authorization')?await optionalUser().catch(()=>null):null;
    return reply(req,env,{cases:await fbiCards(env,rows,s?.muid)});
  }
  const one=path.match(/^\/v1\/fbi\/cases\/([0-9a-f-]{36})$/i);
  if(one&&req.method==='GET'){
    const rows=await service(env,`fbi_board?id=eq.${one[1]}&select=*&limit=1`);
    if(!rows?.length)return fail(req,env,'Case not found',404);
    const s=req.headers.get('authorization')?await optionalUser().catch(()=>null):null;
    return reply(req,env,{case:(await fbiCards(env,rows,s?.muid))[0]});
  }
  if(path==='/v1/fbi/cases'&&req.method==='POST'){
    const {muid}=await needUser(),b=await json(req);
    const kind=String(b.kind||'');
    if(!FBI_KINDS.includes(kind))return fail(req,env,'Pick Legit Check, Sighting or Most Wanted',400);
    const title=fbiText(b.title,80);if(title.length<3)return fail(req,env,'Give the case a title',400);
    const surrender=kind==='most_wanted'&&b.self_surrender===true;
    if(!surrender&&b.no_faces_attested!==true)return fail(req,env,'Photos must show the shoes or the fit, not anybody\'s face. Tick the box to confirm.',400);
    const ids=uniq(Array.isArray(b.media_asset_ids)?b.media_asset_ids:[]).filter(uuidLike).slice(0,4);
    if(!ids.length)return fail(req,env,'Add at least one photo',400);
    /* Evidence must be uploaded and finished (ready), and it is reserved
       (attached) before the case is written, so it cannot be discarded
       later and a desk or a voter never sees a case with its photos gone.
       The reservation is conditional, so one photo cannot back two cases. */
    const assets=await service(env,`network_media_assets?id=in.(${ids.join(',')})&owner_m_uid=eq.${muid}&status=eq.ready&select=id,media_type`);
    if((assets||[]).length!==ids.length||assets.some(a=>a.media_type!=='image'))return fail(req,env,'Photos only, fully uploaded, and only ones you uploaded',400);
    const assetFilter=`network_media_assets?id=in.(${ids.join(',')})&owner_m_uid=eq.${muid}`;
    const reserved=await service(env,`${assetFilter}&status=eq.ready&post_id=is.null`,{method:'PATCH',headers:{prefer:'return=representation'},body:JSON.stringify({status:'attached',updated_at:new Date().toISOString()})});
    const release=()=>service(env,`${assetFilter}&status=eq.attached&post_id=is.null`,{method:'PATCH',headers:{prefer:'return=minimal'},body:JSON.stringify({status:'ready',updated_at:new Date().toISOString()})}).catch(()=>{});
    if((reserved||[]).length!==ids.length){await release();return fail(req,env,'Those photos are already in use',409);}
    let rows;
    try{rows=await service(env,'fbi_cases',{method:'POST',headers:{prefer:'return=representation'},body:JSON.stringify({kind,reporter_m_uid:muid,title,details:fbiText(b.details,500),item:fbiText(b.item,80),charge:fbiText(b.charge,80),city:fbiText(b.city,40),media_asset_ids:ids,self_surrender:surrender,no_faces_attested:b.no_faces_attested===true})});}
    catch(e){await release();throw e;}
    return reply(req,env,{case:{id:rows?.[0]?.id,status:'pending'}},201);
  }
  const vote=path.match(/^\/v1\/fbi\/cases\/([0-9a-f-]{36})\/vote$/i);
  if(vote&&req.method==='POST'){
    const {muid}=await needUser(),b=await json(req);
    const rows=await service(env,`fbi_cases?id=eq.${vote[1]}&status=eq.public&select=id,kind,reporter_m_uid&limit=1`),c=rows?.[0];
    if(!c)return fail(req,env,'Case not found',404);
    if(c.reporter_m_uid===muid)return fail(req,env,'You can\'t vote on your own case',403);
    if(!FBI_VOTES[c.kind].includes(b.vote))return fail(req,env,'That vote does not fit this case',400);
    await service(env,'fbi_votes',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({case_id:c.id,m_uid:muid,vote:b.vote})});
    const fresh=await service(env,`fbi_board?id=eq.${c.id}&select=*&limit=1`);
    return reply(req,env,{case:(await fbiCards(env,fresh,muid))[0]});
  }
  const report=path.match(/^\/v1\/fbi\/cases\/([0-9a-f-]{36})\/report$/i);
  if(report&&req.method==='POST'){
    const {muid}=await needUser(),b=await json(req);
    await service(env,'fbi_reports',{method:'POST',headers:{prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({case_id:report[1],m_uid:muid,reason:fbiText(b.reason,300)})});
    return reply(req,env,{reported:true});
  }
  if(path==='/v1/fbi/mine'&&req.method==='GET'){
    const {muid}=await needUser();
    const rows=await service(env,`fbi_cases?reporter_m_uid=eq.${muid}&select=*&order=created_at.desc&limit=30`);
    return reply(req,env,{cases:await fbiCards(env,rows,null,{withStatus:true})});
  }
  /* THE DESK: the owner approves or removes. Nothing reaches the board
     without this. */
  if(path==='/v1/fbi/desk'&&req.method==='GET'){
    if(!(await isDesk()))return fail(req,env,'Not found',404);
    const rows=await service(env,'fbi_cases?status=eq.pending&select=*&order=created_at.asc&limit=50');
    const reports=rows?.length?await service(env,`fbi_reports?case_id=in.(${rows.map(r=>r.id).join(',')})&select=case_id,reason`):[];
    for(const r of rows||[])r.reports=(reports||[]).filter(x=>x.case_id===r.id).map(x=>x.reason).filter(Boolean);
    return reply(req,env,{cases:await fbiCards(env,rows,null,{withStatus:true})});
  }
  const review=path.match(/^\/v1\/fbi\/cases\/([0-9a-f-]{36})\/review$/i);
  if(review&&req.method==='POST'){
    if(!(await isDesk()))return fail(req,env,'Not found',404);
    const b=await json(req);
    if(!['public','removed'].includes(b.decision))return fail(req,env,'Approve or remove',400);
    const now=new Date().toISOString();
    const rows=await service(env,`fbi_cases?id=eq.${review[1]}`,{method:'PATCH',headers:{prefer:'return=representation'},body:JSON.stringify(b.decision==='public'?{status:'public',reviewed_at:now,published_at:now,removal_reason:null}:{status:'removed',reviewed_at:now,removal_reason:fbiText(b.reason,300)||null})});
    if(!rows?.length)return fail(req,env,'Case not found',404);
    return reply(req,env,{case:{id:rows[0].id,status:rows[0].status}});
  }
  return fail(req,env,'Not found',404);
}

export async function handlePlatformApi(req,env){
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return null;
  const url=new URL(req.url),path=url.pathname.replace(/\/+$/,'')||'/';
  if(path==='/v1/platform/catalog'&&req.method==='GET'){
    const [products,apps]=await Promise.all([service(env,'api_products?enabled=eq.true&order=product_key.asc&select=product_key,name,description,unit_name,default_unit_cost'),service(env,'platform_apps?enabled=eq.true&order=product_family.asc,name.asc&select=app_key,name,product_family,kind,public_url')]); return reply(req,env,{...CATALOG,api_products:products||[],apps:apps||[]});
  }
  if(path.startsWith('/v1/developer/')) return handleDeveloper(req,env,path,url);
  if(path==='/v1/mnet'||path.startsWith('/v1/mnet/')) return handleMnet(req,env,path,url);
  if(path.startsWith('/v1/fbi/')) return handleFbi(req,env,path,url);
  return null;
}
