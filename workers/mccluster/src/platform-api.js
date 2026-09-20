import { fail, reply } from './lib/http.js';

const encoder = new TextEncoder();

function serviceHeaders(env, extra={}) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type':'application/json', ...extra };
}
async function service(env, path, init={}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: serviceHeaders(env, init.headers||{}) });
  const text = await res.text(); let data=null; try { data=text?JSON.parse(text):null; } catch { data=text; }
  if (!res.ok) throw Object.assign(new Error(data?.message || data?.error || 'Database request failed'), { status: res.status, detail:data });
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
  if(!res.ok) throw Object.assign(new Error(data?.message||data?.error||'RPC failed'),{status:res.status,detail:data}); return data;
}
async function currentMuid(env,userId){const r=await service(env,`m_auth_user_links?auth_user_id=eq.${encodeURIComponent(userId)}&is_primary=eq.true&select=m_uid&limit=1`);return r?.[0]?.m_uid||null}
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
async function canReadNetworkPost(env,muid,post){
  if(!post||post.deleted_at)return false;
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
  const [actors,reactions,replies]=await Promise.all([
    networkActors(env,posts.map(p=>p.author_m_uid)),
    ids.length?service(env,`network_reactions?post_id=in.(${ids.join(',')})&select=post_id,actor_m_uid,reaction`):[],
    ids.length?service(env,`network_posts?reply_to_id=in.(${ids.join(',')})&deleted_at=is.null&select=id,reply_to_id`):[]
  ]);
  const rc=new Map(), replyc=new Map(), liked=new Set();
  for(const r of reactions||[]){rc.set(r.post_id,(rc.get(r.post_id)||0)+1);if(viewerMuid&&r.actor_m_uid===viewerMuid&&r.reaction==='like')liked.add(r.post_id)}
  for(const r of replies||[])replyc.set(r.reply_to_id,(replyc.get(r.reply_to_id)||0)+1);
  return posts.map(p=>({post:{...p,reaction_count:rc.get(p.id)||0,reply_count:replyc.get(p.id)||0,liked_by_me:liked.has(p.id)},actor:actors[p.author_m_uid]||{m_uid:p.author_m_uid}}));
}
async function hydrateFeedItems(env,items=[],viewerMuid=null){
  if(!items.length)return [];
  const postIds=uniq(items.filter(x=>x.item_type==='post'&&x.post_id).map(x=>x.post_id)).filter(uuidLike);
  const posts=postIds.length?await service(env,`network_posts?id=in.(${postIds.join(',')})&deleted_at=is.null&select=id,author_m_uid,body,post_type,visibility,media,metadata,reply_to_id,created_at,updated_at,source_app_id,source_org_id`):[];
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
    const id=decodeURIComponent(person[1]); const p=await service(env,`platform_profiles?mccluster_id=ilike.${encodeURIComponent(id)}&select=user_id,display_name,avatar_url,mccluster_id&limit=1`); if(!p?.length)return fail(req,env,'Person not found',404);
    const links=await service(env,`m_auth_user_links?auth_user_id=eq.${p[0].user_id}&is_primary=eq.true&select=m_uid&limit=1`); const targetMuid=links?.[0]?.m_uid; const np=targetMuid?await service(env,`network_profiles?m_uid=eq.${targetMuid}&select=*&limit=1`):[];
    let following=false; if(!external&&targetMuid){const me=await currentMuid(env,user.id);if(me&&me!==targetMuid){const f=await service(env,`network_follows?follower_m_uid=eq.${me}&followed_m_uid=eq.${targetMuid}&status=eq.following&select=follower_m_uid&limit=1`);following=!!f?.length}}
    if(external)await meter(env,external,'mnet.read',path,req.method,200,null,start); return reply(req,env,{identity:p[0],profile:np?.[0]||null,following});
  }
  if(path==='/v1/mnet/profile'&&req.method==='PATCH'){
    if(external)return fail(req,env,'Profile mutation requires a McCluster user session',403); const b=await json(req);
    if(b.mccluster_id!==undefined)await userRpc(req,env,'set_mccluster_id',{p_mccluster_id:String(b.mccluster_id||'').trim()});
    const data=await userRpc(req,env,'mnet_complete_surface_profile',{p_app_key:appKey,p_display_name:b.display_name||'',p_headline:b.headline||'',p_bio:b.bio||'',p_avatar_url:b.avatar_url||'',p_banner_url:b.banner_url||'',p_website_url:b.website_url||''}); return reply(req,env,data);
  }
  if(path==='/v1/mnet/posts'&&req.method==='POST'){
    if(external)return fail(req,env,'Post creation currently requires a McCluster user session',403); const b=await json(req),muid=await currentMuid(env,user.id); if(!muid)return fail(req,env,'McCluster identity unavailable',409);
    const body=String(b.body||'').trim().slice(0,20000),media=Array.isArray(b.media)?b.media:[]; if(!body&&!media.length)return fail(req,env,'Post body or media is required',400);
    let parent=null,replyTo=b.reply_to_id?String(b.reply_to_id):null,visibility=['public','network','private'].includes(b.visibility)?b.visibility:'public';
    if(replyTo){if(!uuidLike(replyTo))return fail(req,env,'Invalid parent post',400);const p=await service(env,`network_posts?id=eq.${replyTo}&deleted_at=is.null&select=*&limit=1`);parent=p?.[0];if(!parent||!(await canReadNetworkPost(env,muid,parent)))return fail(req,env,'Parent post not found',404);visibility=parent.visibility}
    const apps=await service(env,`platform_apps?app_key=eq.${encodeURIComponent(appKey)}&select=id&limit=1`),postType=['post','update','share','announcement'].includes(b.post_type)?b.post_type:'post';
    const rows=await service(env,'network_posts',{method:'POST',headers:{prefer:'return=representation'},body:JSON.stringify({author_m_uid:muid,body,post_type:postType,visibility,media,metadata:b.metadata&&typeof b.metadata==='object'?b.metadata:{},reply_to_id:replyTo,source_app_id:apps?.[0]?.id||null})});
    const hydrated=await hydratePostRows(env,rows||[],muid); return reply(req,env,{post:hydrated?.[0]?.post||rows?.[0],actor:hydrated?.[0]?.actor||null},201);
  }
  const replies=path.match(/^\/v1\/mnet\/posts\/([0-9a-f-]{36})\/replies$/i);
  if(replies&&req.method==='GET'){
    const parentRows=await service(env,`network_posts?id=eq.${replies[1]}&deleted_at=is.null&select=*&limit=1`),parent=parentRows?.[0]; if(!parent)return fail(req,env,'Post not found',404);
    let viewer=null;if(external){if(parent.visibility!=='public')return fail(req,env,'Post not found',404)}else{viewer=await currentMuid(env,user.id);if(!(await canReadNetworkPost(env,viewer,parent)))return fail(req,env,'Post not found',404)}
    const rows=await service(env,`network_posts?reply_to_id=eq.${replies[1]}&deleted_at=is.null&order=created_at.asc&select=id,author_m_uid,body,post_type,visibility,media,metadata,reply_to_id,created_at,updated_at,source_app_id,source_org_id`);
    const visible=external?(rows||[]).filter(x=>x.visibility==='public'):(rows||[]); const hydrated=await hydratePostRows(env,visible,viewer); if(external)await meter(env,external,'mnet.read',path,req.method,200,null,start); return reply(req,env,{replies:hydrated});
  }
  const react=path.match(/^\/v1\/mnet\/posts\/([0-9a-f-]{36})\/reactions$/i);
  if(react&&['POST','DELETE'].includes(req.method)){
    if(external)return fail(req,env,'Reaction mutation requires a McCluster user session',403); const b=await json(req),muid=await currentMuid(env,user.id); if(!muid)return fail(req,env,'McCluster identity unavailable',409); const reaction=String(b.reaction||'like').slice(0,40);
    if(req.method==='DELETE'){await service(env,`network_reactions?post_id=eq.${react[1]}&actor_m_uid=eq.${muid}&reaction=eq.${encodeURIComponent(reaction)}`,{method:'DELETE',headers:{prefer:'return=minimal'}});return reply(req,env,{reaction:null})}
    const rows=await service(env,'network_reactions',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({post_id:react[1],actor_m_uid:muid,reaction})}); return reply(req,env,{reaction:rows?.[0]},201);
  }
  const follow=path.match(/^\/v1\/mnet\/people\/([^/]+)\/follow$/);
  if(follow&&['POST','DELETE'].includes(req.method)){
    if(external)return fail(req,env,'Follow mutation requires a McCluster user session',403); const muid=await currentMuid(env,user.id),targetId=decodeURIComponent(follow[1]); const p=await service(env,`platform_profiles?mccluster_id=ilike.${encodeURIComponent(targetId)}&select=user_id&limit=1`); if(!p?.length)return fail(req,env,'Person not found',404); const ml=await service(env,`m_auth_user_links?auth_user_id=eq.${p[0].user_id}&is_primary=eq.true&select=m_uid&limit=1`); const target=ml?.[0]?.m_uid; if(!target)return fail(req,env,'Person identity unavailable',409);
    if(req.method==='POST'){await service(env,'network_follows',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({follower_m_uid:muid,followed_m_uid:target,status:'following'})});return reply(req,env,{following:true});}
    await service(env,`network_follows?follower_m_uid=eq.${muid}&followed_m_uid=eq.${target}`,{method:'DELETE',headers:{prefer:'return=minimal'}}); return reply(req,env,{following:false});
  }
  if(path==='/v1/mnet/notifications'&&req.method==='GET'){
    if(external)return fail(req,env,'Notifications require a McCluster user session',403); const muid=await currentMuid(env,user.id); const rows=await service(env,`network_notifications?recipient_m_uid=eq.${muid}&order=created_at.desc&limit=100&select=*`); return reply(req,env,{notifications:rows||[]});
  }
  return null;
}

export async function handlePlatformApi(req,env){
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return null;
  const url=new URL(req.url),path=url.pathname.replace(/\/+$/,'')||'/';
  if(path==='/v1/platform/catalog'&&req.method==='GET'){
    const [products,apps]=await Promise.all([service(env,'api_products?enabled=eq.true&order=product_key.asc&select=product_key,name,description,unit_name,default_unit_cost'),service(env,'platform_apps?enabled=eq.true&order=product_family.asc,name.asc&select=app_key,name,product_family,kind,public_url')]); return reply(req,env,{...CATALOG,api_products:products||[],apps:apps||[]});
  }
  if(path.startsWith('/v1/developer/')) return handleDeveloper(req,env,path,url);
  if(path==='/v1/mnet'||path.startsWith('/v1/mnet/')) return handleMnet(req,env,path,url);
  return null;
}
