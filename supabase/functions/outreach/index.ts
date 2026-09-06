// OUTREACH — org-scoped campaign preparation and sending behind McCluster control authority.
// verify_jwt MUST remain on. Service-role calls are accepted only from trusted internal
// functions and must carry the original actor in control_actor.

const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const PUBLIC_FN = Deno.env.get("PUBLIC_FUNCTIONS_URL") ?? `${SB}/functions/v1`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, "content-type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}: ${text.slice(0,300)}`);
  return text ? JSON.parse(text) : null;
}
async function rpc(name: string, body: Record<string, unknown>) {
  const r = await fetch(`${SB}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`rpc ${name} ${r.status}: ${text.slice(0,300)}`);
  return text ? JSON.parse(text) : null;
}
function jwt(req: Request): { sub: string | null; role: string | null } {
  const raw = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const part = raw.split(".")[1];
  if (!part) return { sub: null, role: null };
  try {
    const pad = part.replace(/-/g,"+").replace(/_/g,"/");
    const p = JSON.parse(atob(pad + "=".repeat((4-pad.length%4)%4)));
    return { sub: typeof p.sub === "string" ? p.sub : null, role: typeof p.role === "string" ? p.role : null };
  } catch { return { sub: null, role: null }; }
}
function actorFor(req: Request, body: Record<string, unknown>): string | null {
  const p = jwt(req);
  if (p.role === "service_role") {
    const delegated = String(body.control_actor ?? "");
    return /^[0-9a-f-]{36}$/i.test(delegated) ? delegated : null;
  }
  return p.sub;
}
async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2,"0")).join("");
}

const PLACEHOLDER_ADDRESS = "SET REAL POSTAL ADDRESS BEFORE SENDING";
type Sender = { id:string; from_name:string; from_email:string; reply_to:string|null; postal_address:string; verified:boolean };
type Campaign = { id:string; org_id:string; name:string; sender_id:string; subject:string; body_text:string; body_html:string|null; audience:Record<string,unknown>; audience_kind:"warm"|"cold"; status:string; throttle_per_hour:number; approved_by:string|null };

async function loadCampaign(id: string): Promise<{ c: Campaign; s: Sender }> {
  const rows = await db(`out_campaigns?id=eq.${id}&select=*&limit=1`);
  if (!rows?.length) throw new Error("no such campaign");
  const c = rows[0] as Campaign;
  const sr = await db(`out_sender_identities?id=eq.${c.sender_id}&select=*&limit=1`);
  if (!sr?.length) throw new Error("campaign has no sender identity");
  return { c, s: sr[0] as Sender };
}

async function authorize(actor:string, org:string, capability:string, resourceId:string, requestHash:string|null, approvalId:string|null) {
  return await rpc("control_authorize_service", {
    p_actor: actor, p_org: org, p_capability: capability,
    p_resource_type: "campaign", p_resource_id: resourceId,
    p_request_hash: requestHash, p_approval_id: approvalId,
  });
}
async function record(org:string, actor:string, capability:string, id:string, action:string, hash:string|null, approval:string|null, metadata:Record<string,unknown>) {
  return await rpc("control_record_command_service", {
    p_org:org,p_actor:actor,p_actor_kind:"human",p_capability:capability,p_resource_type:"campaign",p_resource_id:id,p_action:action,
    p_request_hash:hash,p_idempotency_key:null,p_approval_id:approval,p_status:"allowed",p_metadata:metadata,
  });
}
async function finish(command:string|null, ok:boolean, result?:unknown, error?:string) {
  if (!command) return;
  await rpc("control_finish_command_service", { p_command:command,p_status:ok?"executed":"failed",p_result:ok?(result??null):null,p_error:ok?null:(error??"failed") }).catch(()=>{});
}
async function acquire(org:string, id:string, actor:string, action:string) {
  return await rpc("control_acquire_lease_service", { p_org:org,p_resource_key:`campaign:${id}`,p_actor:actor,p_actor_kind:"human",p_purpose:`outreach:${action}`,p_ttl_seconds:180 });
}
async function release(org:string,id:string,lease:string|null) {
  if (!lease) return;
  await rpc("control_release_lease_service", { p_org:org,p_resource_key:`campaign:${id}`,p_lease:lease }).catch(()=>{});
}

function blockers(c: Campaign, s: Sender): string[] {
  const out:string[]=[];
  if (!RESEND_KEY) out.push("no RESEND_API_KEY is configured, so nothing can send");
  if (!s.verified) out.push(`the sending domain for ${s.from_email} is not verified with the provider yet`);
  if (!s.postal_address || s.postal_address===PLACEHOLDER_ADDRESS) out.push("the sender has no real postal address, which CAN-SPAM requires in the message body");
  if (!c.subject.trim()) out.push("the subject is empty");
  if (!c.body_text.trim()) out.push("the body is empty");
  if (c.status==="paused") out.push("the campaign is paused");
  if (c.status==="done") out.push("the campaign has already finished");
  if (c.audience_kind==="cold" && !c.approved_by) out.push("a cold campaign has to be approved by an authorised owner before it sends");
  return out;
}
function render(tpl:string, vars:Record<string,string>) { return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g,(_m,k:string)=>vars[k]??""); }
const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
function withFooter(bodyText:string,s:Sender,unsubUrl:string) {
  const text=`${bodyText}\n\n—\n${s.from_name}\n${s.postal_address}\n\nUnsubscribe: ${unsubUrl}`;
  const html=`<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#101b2c">${escapeHtml(bodyText).replace(/\n/g,"<br>")}<hr style="border:0;border-top:1px solid #ddd;margin:24px 0"><div style="font-size:12px;color:#6d7581">${escapeHtml(s.from_name)}<br>${escapeHtml(s.postal_address)}<br><br><a href="${unsubUrl}" style="color:#3157d5">Unsubscribe</a> from these emails.</div></div>`;
  return { text, html };
}
async function audienceQuery(c:Campaign) {
  const a=c.audience??{}; const parts=[`org_id=eq.${c.org_id}`,"select=id,email,name,company_id,consent,unsub_token"];
  if(c.audience_kind==="warm") parts.push("consent=in.(inquired,opted_in)");
  if(typeof a.consent==="string") parts.push(`consent=eq.${encodeURIComponent(a.consent)}`);
  parts.push("limit=5000"); return `out_contacts?${parts.join("&")}`;
}
async function build(campaignId:string) {
  const {c}=await loadCampaign(campaignId); const contacts=await db(await audienceQuery(c))??[];
  const supp=await db(`out_suppressions?org_id=eq.${c.org_id}&select=address`)??[];
  const blocked=new Set(supp.map((s:{address:string})=>s.address.toLowerCase())); let queued=0,skipped=0;
  const rows=contacts.map((ct:{id:string;email:string})=>{const addr=ct.email.toLowerCase();const b=blocked.has(addr);if(b)skipped++;else queued++;return{campaign_id:c.id,org_id:c.org_id,contact_id:ct.id,address:addr,state:b?"skipped":"queued",skip_reason:b?"on the suppression list":null};});
  if(rows.length) await db("out_recipients",{method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify(rows)});
  return {audience:contacts.length,queued,skipped};
}
async function sendBatch(campaignId:string,max:number) {
  const {c,s}=await loadCampaign(campaignId); const stop=blockers(c,s); if(stop.length) return{sent:0,failed:0,blocked:stop};
  const perTick=Math.max(1,Math.ceil(c.throttle_per_hour/6)); const take=Math.min(max||perTick,perTick,200);
  const queue=await db(`out_recipients?campaign_id=eq.${c.id}&state=eq.queued&select=id,address,contact_id&limit=${take}`)??[];
  if(!queue.length){await db(`out_campaigns?id=eq.${c.id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"done"})});return{sent:0,failed:0,done:true};}
  if(c.status!=="sending") await db(`out_campaigns?id=eq.${c.id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"sending"})});
  let sent=0,failed=0;
  for(const r of queue){
    const still=await db(`out_suppressions?org_id=eq.${c.org_id}&address=eq.${encodeURIComponent(r.address)}&select=address&limit=1`);
    if(still?.length){await db(`out_recipients?id=eq.${r.id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({state:"skipped",skip_reason:"suppressed before send"})});continue;}
    const ct=r.contact_id?(await db(`out_contacts?id=eq.${r.contact_id}&select=name,unsub_token,company_id&limit=1`))?.[0]:null;
    let companyName=""; if(ct?.company_id){const co=await db(`out_companies?id=eq.${ct.company_id}&select=name&limit=1`);companyName=co?.[0]?.name??"";}
    const unsubUrl=`${PUBLIC_FN}/unsubscribe?t=${ct?.unsub_token??""}`; const vars={name:ct?.name??"",first_name:(ct?.name??"").split(" ")[0]??"",company:companyName,unsubscribe_url:unsubUrl};
    const body=render(c.body_text,vars); const {text,html}=withFooter(body,s,unsubUrl);
    try{
      const res=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${RESEND_KEY}`,"content-type":"application/json"},body:JSON.stringify({from:`${s.from_name} <${s.from_email}>`,to:[r.address],reply_to:s.reply_to??undefined,subject:render(c.subject,vars),text,html:c.body_html?render(c.body_html,vars):html,headers:{"List-Unsubscribe":`<${unsubUrl}>`,"List-Unsubscribe-Post":"List-Unsubscribe=One-Click"}})});
      const payload=await res.json().catch(()=>({})); if(!res.ok) throw new Error(payload?.message??`resend ${res.status}`);
      await db(`out_recipients?id=eq.${r.id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({state:"sent",provider_id:payload?.id??null,sent_at:new Date().toISOString(),attempts:1})});
      await db("out_events",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({org_id:c.org_id,recipient_id:r.id,address:r.address,type:"sent"})}).catch(()=>{}); sent++;
    }catch(e){failed++;await db(`out_recipients?id=eq.${r.id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({state:"failed",last_error:String(e).slice(0,400),attempts:1})}).catch(()=>{});await db("out_events",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({org_id:c.org_id,recipient_id:r.id,address:r.address,type:"failed",detail:{error:String(e).slice(0,300)}})}).catch(()=>{});}
  }
  return{sent,failed};
}
async function stats(campaignId:string){const{c,s}=await loadCampaign(campaignId);const counts=await db(`out_recipients?campaign_id=eq.${c.id}&select=state`)??[];const by:Record<string,number>={};for(const r of counts)by[r.state]=(by[r.state]??0)+1;const events=await db(`out_events?org_id=eq.${c.org_id}&select=type&order=at.desc&limit=2000`)??[];const ev:Record<string,number>={};for(const e of events)ev[e.type]=(ev[e.type]??0)+1;return{campaign:{id:c.id,name:c.name,status:c.status,audience_kind:c.audience_kind},recipients:by,events:ev,blocked_by:blockers(c,s)};}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json({error:"POST only"},405);
  let p:Record<string,unknown>;try{p=await req.json();}catch{return json({error:"bad json"},400);}
  const actor=actorFor(req,p); if(!actor) return json({error:"authenticated actor required"},401);
  const action=String(p.action??""); const id=String(p.campaign_id??""); if(!/^[0-9a-f-]{36}$/i.test(id)) return json({error:"campaign_id required"},400);
  let loaded:{c:Campaign;s:Sender}; try{loaded=await loadCampaign(id);}catch(e){return json({error:String(e).slice(0,300)},404);}
  const capability=action==="stats"?"campaign.read":action==="build"?"campaign.prepare":action==="pause"?"campaign.pause":action==="send"?"campaign.send":"";
  if(!capability) return json({error:"unknown action"},400);
  const requestHash=await sha256({action,campaign_id:id,max:Number(p.max??0)}); const approvalId=/^[0-9a-f-]{36}$/i.test(String(p.approval_id??""))?String(p.approval_id):null;
  const decision=await authorize(actor,loaded.c.org_id,capability,id,requestHash,approvalId);
  if(!decision?.allowed) return json({error:"forbidden",reason:decision?.reason??"capability_denied",capability,resource_type:"campaign",resource_id:id,request_hash:requestHash,approval_required:decision?.reason==="approval_required"||decision?.reason==="approval_invalid"},403);
  if(action==="send"&&decision.approved_by){await db(`out_campaigns?id=eq.${id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({approved_by:decision.approved_by})});loaded.c.approved_by=decision.approved_by;}
  if(action==="stats") return json({ok:true,...(await stats(id))});
  let lease:string|null=null; let command:string|null=null;
  try{
    lease=await acquire(loaded.c.org_id,id,actor,action);
    command=await record(loaded.c.org_id,actor,capability,id,action,requestHash,approvalId,{source:"outreach-edge"});
    let out:unknown;
    if(action==="build") out=await build(id);
    else if(action==="pause"){await db(`out_campaigns?id=eq.${id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"paused"})});out={status:"paused"};}
    else out=await sendBatch(id,Number(p.max??0));
    await finish(command,true,out); return json({ok:true,...(out as Record<string,unknown>)});
  }catch(e){await finish(command,false,null,String(e).slice(0,400));return json({error:String(e).slice(0,300)},500);}
  finally{await release(loaded.c.org_id,id,lease);}
});
