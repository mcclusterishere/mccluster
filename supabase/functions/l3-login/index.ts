const SB=Deno.env.get('SUPABASE_URL')!; const SRV=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const allowed=['https://mcclusterishere.github.io','http://localhost:8000','http://127.0.0.1:8000'];
function cors(req:Request){const o=req.headers.get('origin')||'';return {'Access-Control-Allow-Origin':allowed.includes(o)?o:'https://mcclusterishere.github.io','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'}}
const j=(req:Request,b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:cors(req)});
async function q(path:string,init:RequestInit={}){const h=new Headers(init.headers||{});h.set('apikey',SRV);h.set('Authorization',`Bearer ${SRV}`);if(init.body)h.set('Content-Type','application/json');const r=await fetch(`${SB}/rest/v1/${path}`,{...init,headers:h});if(!r.ok)throw new Error(await r.text());return r.text().then(t=>t?JSON.parse(t):null)}
async function sha(s:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
Deno.serve(async req=>{if(req.method==='OPTIONS')return new Response('ok',{headers:cors(req)});if(req.method!=='POST')return j(req,{error:'POST only'},405);
 const ip=(req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim();const ipHash=await sha(ip);
 const recent=await q(`l3_auth_attempts?ip_hash=eq.${ipHash}&success=eq.false&created_at=gte.${encodeURIComponent(new Date(Date.now()-15*60e3).toISOString())}&select=id`);if(Array.isArray(recent)&&recent.length>=12)return j(req,{error:'too_many_attempts'},429);
 const body=await req.json().catch(()=>({}));const mcclusterId=String(body.mccluster_id||'').trim().toLowerCase();const password=String(body.password||'');if(!mcclusterId||!password)return j(req,{error:'missing_credentials'},400);
 const profiles=await q(`platform_profiles?mccluster_id=ilike.${encodeURIComponent(mcclusterId)}&select=user_id,primary_email&limit=1`);const p=Array.isArray(profiles)?profiles[0]:null;
 if(!p){await q('l3_auth_attempts',{method:'POST',body:JSON.stringify({ip_hash:ipHash,mccluster_id:mcclusterId,success:false})});return j(req,{error:'invalid_credentials'},401)}
 const app=await q(`platform_apps?app_key=eq.level-3-media-web&select=id&limit=1`);const appId=app?.[0]?.id;const access=await q(`platform_user_apps?user_id=eq.${p.user_id}&app_id=eq.${appId}&select=role&limit=1`);if(!access?.[0])return j(req,{error:'not_authorized'},403);
 const r=await fetch(`${SB}/auth/v1/token?grant_type=password`,{method:'POST',headers:{'apikey':SRV,'Content-Type':'application/json'},body:JSON.stringify({email:p.primary_email,password})});const session=await r.json().catch(()=>({}));
 await q('l3_auth_attempts',{method:'POST',body:JSON.stringify({ip_hash:ipHash,mccluster_id:mcclusterId,success:r.ok})});if(!r.ok)return j(req,{error:'invalid_credentials'},401);
 return j(req,{access_token:session.access_token,refresh_token:session.refresh_token,expires_in:session.expires_in,user:session.user,token_type:session.token_type});
});