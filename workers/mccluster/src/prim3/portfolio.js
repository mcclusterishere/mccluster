import { reply, fail, allowedOrigins } from '../lib/http.js';
import CATALOG from '../../../../data/portfolio-progression.json' with {type:'json'};
import ROLES from '../../../../data/roles.json' with {type:'json'};
import { cleanDraft, initialDraft, project } from '../../../../js/portfolio-progression-model.mjs';
export const PORTFOLIO_PATH='/v1/portfolio-progression';
const error=(message,status=400)=>Object.assign(new Error(message),{status});
async function db(env,path,method='GET',body) {
  const res=await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`,{method,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
  if(!res.ok) throw error('Portfolio storage unavailable; no change confirmed',503);
  return res.json();
}
async function bodyOf(request) {
  const reader=request.body?.getReader(); if(!reader) throw error('JSON body required');
  const parts=[]; let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16000){await reader.cancel();throw error('Request too large',413);}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw error('Invalid JSON');}
}
async function credentialsFor(env,user) {
  return db(env,`learning_external_credentials?user_id=eq.${encodeURIComponent(user.id)}&verification_status=eq.reviewer_verified&select=external_program,issuer,title,verification_status,verified_by,verified_at,user_id&limit=1000`);
}
export async function handlePortfolio(request,env,{requireHouseOwner}) {
  const path=new URL(request.url).pathname;
  const send=(data,status=200)=>{const res=reply(request,env,data,status);res.headers.set('cache-control','no-store');return res;};
  try {
    if(path===`${PORTFOLIO_PATH}/public` && request.method==='GET') {
      const rows=await db(env,'learning_portfolio?key=eq.matthew&select=published,published_at&limit=1');
      return send({snapshot:rows[0]?.published||null,published_at:rows[0]?.published_at||null});
    }
    const user=await requireHouseOwner(request,env);
    if(![PORTFOLIO_PATH,`${PORTFOLIO_PATH}/preview`,`${PORTFOLIO_PATH}/publish`,`${PORTFOLIO_PATH}/unpublish`].includes(path)) throw error('Not found',404);
    if(!['GET','POST'].includes(request.method)) throw error('Method not allowed',405);
    const rows=await db(env,'learning_portfolio?key=eq.matthew&select=*&limit=1');
    const row=rows[0]||{revision:0,draft:initialDraft(CATALOG)};
    if(request.method==='GET') {
      if(path!==PORTFOLIO_PATH) throw error('Method not allowed',405);
      return send({draft:row.draft,revision:row.revision,published_at:row.published_at||null,credentials:await credentialsFor(env,user)});
    }
    const origin=request.headers.get('origin');
    if(origin&&!allowedOrigins(env).includes(origin)) throw error('Origin not allowed',403);
    const body=await bodyOf(request);
    if(!Number.isInteger(body.revision)||body.revision!==row.revision) throw error('Draft changed. Reload before retrying.',409);
    const draft=path===PORTFOLIO_PATH?cleanDraft(body.draft,CATALOG,ROLES):cleanDraft(row.draft,CATALOG,ROLES);
    let snapshot=null, digest=null;
    if(path.endsWith('/preview')||path.endsWith('/publish')) {
      const credentials=await credentialsFor(env,user);
      snapshot=project(draft,CATALOG,ROLES,credentials,{publicOnly:true});
      digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(snapshot))))).map(x=>x.toString(16).padStart(2,'0')).join('');
      if(path.endsWith('/preview')) return send({snapshot,digest,revision:row.revision});
      if(body.digest!==digest||body.confirm!=='PUBLISH') throw error('Preview the current snapshot and explicitly confirm publication',409);
    }
    const action=path===PORTFOLIO_PATH?'save':path.split('/').at(-1);
    const result=await db(env,'rpc/learning_portfolio_write','POST',{p_revision:row.revision,p_actor:user.id,p_action:action,p_draft:draft,p_snapshot:snapshot});
    if(!result) throw error('Draft changed. Reload before retrying.',409);
    return send({ok:true,revision:result.revision,published_at:result.published_at});
  } catch(e) {const res=fail(request,env,e.status?e.message:'Portfolio unavailable',e.status||503);res.headers.set('cache-control','no-store');return res;}
}
