// ORCID 3-legged OAuth for Equity Uprise contributors.
// Start is authenticated. Callback consumes one-time state, exchanges the code,
// stores tokens in Supabase Vault, and records only Vault UUID references.
import { cors, db, json, orgBySlug, rpc, sha256Hex, verifyCaller } from "../_shared/eu-policy-os.ts";

const clientId=Deno.env.get("ORCID_CLIENT_ID")??"";
const clientSecret=Deno.env.get("ORCID_CLIENT_SECRET")??"";
const sandbox=(Deno.env.get("ORCID_ENV")??"sandbox")!=="production";
const webBase=sandbox?"https://sandbox.orcid.org":"https://orcid.org";
const redirectUri=Deno.env.get("ORCID_REDIRECT_URI")??"";

function page(title:string,body:string,status=200){return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><main style="font:16px/1.5 system-ui;max-width:680px;margin:12vh auto;padding:24px"><h1>${title}</h1><p>${body}</p></main></body></html>`,{status,headers:{"content-type":"text/html; charset=utf-8"}});}

async function integration(orgId:string){
  let r=(await db(`eu_integrations?org_id=eq.${orgId}&provider=eq.orcid&label=eq.member-api&select=*&limit=1`))?.[0];
  if(!r) r=(await db("eu_integrations",{method:"POST",body:JSON.stringify({org_id:orgId,provider:"orcid",integration_class:"identity",label:"member-api",credential_mode:"oauth-vault",scopes:["/authenticate","/activities/update"],capabilities:{work_write:true},config:{environment:sandbox?"sandbox":"production"},status:"pending"})}))?.[0];
  return r;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  const u=new URL(req.url); const action=u.searchParams.get("action")||"";
  try{
    if(action==="start"){
      if(req.method!=="POST")return json({error:"POST required"},405);
      if(!clientId||!clientSecret||!redirectUri)return json({error:"ORCID integration not configured",requires:["ORCID_CLIENT_ID","ORCID_CLIENT_SECRET","ORCID_REDIRECT_URI"]},503);
      const caller=await verifyCaller(req); if(!caller?.mUid)return json({error:"signed-in M identity required"},401);
      const org=await orgBySlug("mccluster"); await integration(org.id);
      const body=await req.json().catch(()=>({})); const raw=crypto.randomUUID()+crypto.randomUUID(); const stateHash=await sha256Hex(raw);
      await rpc("eu_oauth_state_create_service",{p_state_hash:stateHash,p_org:org.id,p_m_uid:caller.mUid,p_provider:"orcid",p_redirect_after:String(body.redirect_after??"").slice(0,1000),p_ttl_seconds:600});
      const auth=new URL(`${webBase}/oauth/authorize`);auth.searchParams.set("client_id",clientId);auth.searchParams.set("response_type","code");auth.searchParams.set("scope","/authenticate /activities/update");auth.searchParams.set("redirect_uri",redirectUri);auth.searchParams.set("state",raw);
      return json({ok:true,authorization_url:auth.toString(),expires_in:600});
    }
    if(action==="callback"){
      if(!clientId||!clientSecret||!redirectUri)return page("ORCID connection unavailable","The server is missing ORCID credentials.",503);
      const code=u.searchParams.get("code")||"", raw=u.searchParams.get("state")||""; if(!code||!raw)return page("ORCID connection failed","The callback was missing its authorization code or state.",400);
      const stateHash=await sha256Hex(raw); const state=await rpc("eu_oauth_state_consume_service",{p_state_hash:stateHash,p_provider:"orcid"}); const s=Array.isArray(state)?state[0]:state; if(!s?.org_id||!s?.m_uid)return page("ORCID connection expired","This authorization link is invalid, expired, or already used.",400);
      const form=new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:"authorization_code",code,redirect_uri:redirectUri});
      const tr=await fetch(`${webBase}/oauth/token`,{method:"POST",headers:{Accept:"application/json","content-type":"application/x-www-form-urlencoded"},body:form});const text=await tr.text();let tok:any={};try{tok=JSON.parse(text);}catch{}if(!tr.ok||!tok.access_token||!tok.orcid)return page("ORCID connection failed",`ORCID rejected the token exchange (${tr.status}).`,400);
      const integ=await integration(s.org_id); const access=await rpc("eu_vault_store_service",{p_secret:String(tok.access_token),p_name:`orcid-access-${s.m_uid}-${tok.orcid}`,p_description:"Equity Uprise ORCID contributor access token"}); const accessId=Array.isArray(access)?access[0]:access; let refreshId:any=null;if(tok.refresh_token){const x=await rpc("eu_vault_store_service",{p_secret:String(tok.refresh_token),p_name:`orcid-refresh-${s.m_uid}-${tok.orcid}`,p_description:"Equity Uprise ORCID contributor refresh token"});refreshId=Array.isArray(x)?x[0]:x;}
      const expires=tok.expires_in?new Date(Date.now()+Number(tok.expires_in)*1000).toISOString():null;
      const prior=(await db(`eu_oauth_connections?integration_id=eq.${integ.id}&m_uid=eq.${s.m_uid}&external_subject=eq.${encodeURIComponent(tok.orcid)}&select=id&limit=1`))?.[0];
      const payload={org_id:s.org_id,integration_id:integ.id,m_uid:s.m_uid,external_subject:String(tok.orcid),access_secret_id:accessId,refresh_secret_id:refreshId,scopes:String(tok.scope??"").split(/\s+/).filter(Boolean),expires_at:expires,status:"active",metadata:{name:tok.name??"",token_type:tok.token_type??"bearer",environment:sandbox?"sandbox":"production"}};
      if(prior)await db(`eu_oauth_connections?id=eq.${prior.id}`,{method:"PATCH",body:JSON.stringify(payload)});else await db("eu_oauth_connections",{method:"POST",body:JSON.stringify(payload)});
      await db(`eu_integrations?id=eq.${integ.id}`,{method:"PATCH",body:JSON.stringify({status:"connected",last_ok_at:new Date().toISOString(),last_sync_at:new Date().toISOString(),last_error:""})});
      const back=String(s.redirect_after||"");if(/^https:\/\//.test(back))return Response.redirect(back,302);return page("ORCID connected",`ORCID iD ${tok.orcid} is now authorized for Equity Uprise publication updates.`);
    }
    return json({error:"use ?action=start or ?action=callback"},400);
  }catch(e){console.error(e);return action==="callback"?page("ORCID connection failed","The connection could not be completed.",500):json({error:e instanceof Error?e.message:String(e)},500);}
});