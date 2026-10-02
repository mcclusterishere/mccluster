import { authzResponse, hasCapability, orgIdBySlug, requireOrgCapability } from "../_shared/authz.ts";

const SB=Deno.env.get("SUPABASE_URL")!, SRV=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ORG_SLUG=Deno.env.get("INTAKE_ORG_SLUG")??"jnh-elevate";
const DEVICE_TOKEN=Deno.env.get("SOCIAL_AGENT_DEVICE_TOKEN")??"";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type,x-device-token","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"content-type":"application/json"}});
async function db(path:string,init:RequestInit={}){const r=await fetch(`${SB}/rest/v1/${path}`,{...init,headers:{apikey:SRV,Authorization:`Bearer ${SRV}`,"content-type":"application/json",Prefer:"return=representation",...(init.headers??{})}});const t=await r.text();if(!r.ok)throw new Error(`db ${r.status}: ${t.slice(0,300)}`);return t?JSON.parse(t):null;}
function safeEq(a:string,b:string){if(!a||!b||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
async function deviceAuth(req:Request,p:Record<string,unknown>){const supplied=req.headers.get("x-device-token")??"";if(!DEVICE_TOKEN||!safeEq(supplied,DEVICE_TOKEN))throw new Error("device unauthorized");const id=String(p.device_id??"");if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error("device_id required");return id;}
async function event(org:string,device:string|null,job:string|null,kind:string,detail:unknown={}){await db("social_agent_events",{method:"POST",body:JSON.stringify({org_id:org,device_id:device,job_id:job,kind,detail})});}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"POST only"},405);
 let p:Record<string,unknown>;try{p=await req.json();}catch{return json({error:"bad json"},400);}
 const action=String(p.action??"");
 try{
  const org=await orgIdBySlug(ORG_SLUG);
  if(action.startsWith("device-")){
   const device=await deviceAuth(req,p);
   const found=(await db(`social_agent_devices?id=eq.${device}&org_id=eq.${org}&select=id,status&limit=1`))?.[0];
   if(!found||found.status==="disabled")return json({error:"device unavailable"},403);
   await db(`social_agent_devices?id=eq.${device}`,{method:"PATCH",body:JSON.stringify({status:"online",last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
   if(action==="device-pull"){
    const jobs=await db(`social_agent_jobs?org_id=eq.${org}&state=eq.queued&or=(device_id.is.null,device_id.eq.${device})&select=id,platform,action,media_url,caption,payload,created_at&order=created_at.asc&limit=1`)??[];
    if(!jobs.length)return json({ok:true,job:null});
    const job=jobs[0];
    await db(`social_agent_jobs?id=eq.${job.id}&state=eq.queued`,{method:"PATCH",body:JSON.stringify({state:"claimed",device_id:device,claimed_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
    await event(org,device,job.id,"claimed");
    return json({ok:true,job});
   }
   if(action==="device-report"){
    const job=String(p.job_id??""),state=String(p.state??"");
    if(!["running","succeeded","failed"].includes(state))return json({error:"bad state"},400);
    const patch:any={state,updated_at:new Date().toISOString()};
    if(state==="succeeded"){patch.finished_at=new Date().toISOString();patch.external_id=p.external_id?String(p.external_id):null;}
    if(state==="failed"){patch.finished_at=new Date().toISOString();patch.failure=String(p.failure??"device failed").slice(0,1000);}
    await db(`social_agent_jobs?id=eq.${job}&org_id=eq.${org}&device_id=eq.${device}`,{method:"PATCH",body:JSON.stringify(patch)});
    await event(org,device,job,"device_"+state,p.detail??{});
    return json({ok:true});
   }
   return json({error:"unknown device action"},400);
  }

  const need=action==="enqueue"||action==="cancel"?"social.queue":"social.read";
  const {caller}=await requireOrgCapability(req,org,need,{type:"org",id:org});
  if(action==="status"){
   const [devices,jobs]=await Promise.all([
    db(`social_agent_devices?org_id=eq.${org}&select=*&order=created_at.asc`),
    db(`social_agent_jobs?org_id=eq.${org}&select=*&order=created_at.desc&limit=50`)
   ]);
   return json({ok:true,devices:devices??[],jobs:jobs??[]});
  }
  if(action==="register-device"){
   if(!(await hasCapability(caller,org,"social.publish")))return json({error:"social.publish required"},403);
   const name=String(p.name??"iPhone worker").trim().slice(0,80);
   const rows=await db("social_agent_devices",{method:"POST",body:JSON.stringify({org_id:org,name,platform:"ios",status:"offline",capabilities:["instagram_ui"]})});
   return json({ok:true,device:rows?.[0]??null});
  }
  if(action==="enqueue"){
   const media=String(p.media_url??"").trim(),caption=String(p.caption??"").trim();
   if(!media)return json({error:"media_url required"},400);
   if(!/^https:\/\//i.test(media))return json({error:"media_url must be https"},400);
   if(caption.length>2200)return json({error:"caption too long"},400);
   const approved=(await hasCapability(caller,org,"social.publish"))?caller.id:null;
   const rows=await db("social_agent_jobs",{method:"POST",body:JSON.stringify({org_id:org,device_id:p.device_id||null,platform:"instagram",action:"publish_reel",state:approved?"queued":"draft",media_url:media,caption,payload:p.payload??{},approved_by:approved})});
   if(rows?.[0])await event(org,rows[0].device_id,rows[0].id,approved?"queued":"drafted",{});
   return json({ok:true,job:rows?.[0]??null,requires_approval:!approved});
  }
  if(action==="cancel"){
   const id=String(p.job_id??"");
   await db(`social_agent_jobs?id=eq.${id}&org_id=eq.${org}&state=in.(draft,queued,claimed)`,{method:"PATCH",body:JSON.stringify({state:"cancelled",updated_at:new Date().toISOString()})});
   await event(org,null,id,"cancelled",{by:caller.id});
   return json({ok:true});
  }
  return json({error:"unknown action"},400);
 }catch(e){const refusal=authzResponse(e,cors);if(refusal)return refusal;console.error("social-agent",e);return json({error:String(e).slice(0,300)},500);}
});