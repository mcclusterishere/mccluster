import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SB, SRV, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "content-type":"application/json; charset=utf-8", "cache-control":"no-store" },
});
const allowed = new Map<string,string>([
  ["image/jpeg","image"],["image/png","image"],["image/webp","image"],["image/avif","image"],["image/gif","image"],
  ["video/mp4","video"],["video/webm","video"],["video/quicktime","video"],
  ["audio/mpeg","audio"],["audio/mp4","audio"],["audio/wav","audio"],["audio/x-m4a","audio"],
  ["application/pdf","file"],
]);

function cleanName(v: unknown) {
  return String(v||"file").slice(0,180).replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"") || "file";
}
async function caller(req: Request) {
  const h=req.headers.get("authorization")||"";
  const token=h.toLowerCase().startsWith("bearer ")?h.slice(7):"";
  if(!token) return null;
  const {data,error}=await admin.auth.getUser(token);
  if(error||!data.user) return null;
  const {data:links}=await admin.from("m_auth_user_links").select("m_uid").eq("auth_user_id",data.user.id).eq("is_primary",true).limit(1);
  return {user:data.user,mUid:links?.[0]?.m_uid||null};
}
async function blocked(a:string,b:string){
  const {count:ab}=await admin.from("network_blocks").select("*",{count:"exact",head:true}).eq("blocker_m_uid",a).eq("blocked_m_uid",b);
  if(Number(ab||0)>0)return true;
  const {count:ba}=await admin.from("network_blocks").select("*",{count:"exact",head:true}).eq("blocker_m_uid",b).eq("blocked_m_uid",a);
  return Number(ba||0)>0;
}
async function canReadPost(viewer:string,post:any){
  if(!post||post.deleted_at)return false;
  if(await blocked(viewer,post.author_m_uid))return false;
  if(post.author_m_uid===viewer||post.visibility==="public")return true;
  if(post.visibility==="network"){
    const {count}=await admin.from("network_follows").select("*",{count:"exact",head:true})
      .eq("follower_m_uid",viewer).eq("followed_m_uid",post.author_m_uid).eq("status","following");
    return Number(count||0)>0;
  }
  return false;
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST") return json({error:"POST required"},405);
  const who=await caller(req);
  if(!who?.mUid)return json({error:"authentication required"},401);
  const body=await req.json().catch(()=>({}));
  const action=String(body.action||"");

  try{
    if(action==="upload-url"){
      const mime=String(body.mime_type||"").toLowerCase();
      const mediaType=allowed.get(mime);
      if(!mediaType)return json({error:"unsupported media type"},415);
      const bytes=Number(body.byte_size||0);
      if(!Number.isFinite(bytes)||bytes<1||bytes>524288000)return json({error:"invalid file size"},400);
      const filename=cleanName(body.file_name);
      const path=`${who.user.id}/${crypto.randomUUID()}-${filename}`;
      const {data:grant,error}=await admin.storage.from("mnet-media").createSignedUploadUrl(path);
      if(error||!grant?.token)return json({error:error?.message||"could not create upload"},500);
      const {data:asset,error:insertError}=await admin.from("network_media_assets").insert({
        owner_m_uid:who.mUid,bucket_id:"mnet-media",object_path:path,media_type:mediaType,mime_type:mime,
        byte_size:bytes,alt_text:String(body.alt_text||"").slice(0,1000),status:"staged"
      }).select("id,object_path,media_type,mime_type,status").single();
      if(insertError)return json({error:insertError.message},500);
      return json({ok:true,asset,upload:{path:grant.path||path,token:grant.token,signed_url:grant.signedUrl||null}});
    }

    if(action==="finalize"){
      const id=String(body.asset_id||"");
      const {data:asset}=await admin.from("network_media_assets").select("*").eq("id",id).eq("owner_m_uid",who.mUid).limit(1).maybeSingle();
      if(!asset)return json({error:"asset not found"},404);
      const parts=String(asset.object_path).split("/");
      const name=parts.pop()||"";
      const folder=parts.join("/");
      const {data:list,error:listError}=await admin.storage.from(asset.bucket_id).list(folder,{search:name,limit:10});
      if(listError||!(list||[]).some(x=>x.name===name))return json({error:"upload not found"},409);
      const patch:any={status:"ready",updated_at:new Date().toISOString()};
      if(Number.isFinite(Number(body.width)))patch.width=Math.max(1,Math.floor(Number(body.width)));
      if(Number.isFinite(Number(body.height)))patch.height=Math.max(1,Math.floor(Number(body.height)));
      if(Number.isFinite(Number(body.duration_ms)))patch.duration_ms=Math.max(0,Math.floor(Number(body.duration_ms)));
      const {data:updated,error}=await admin.from("network_media_assets").update(patch).eq("id",id).select("id,media_type,mime_type,width,height,duration_ms,alt_text,status").single();
      if(error)return json({error:error.message},500);
      return json({ok:true,asset:updated});
    }

    if(action==="view-url"){
      const id=String(body.asset_id||"");
      const {data:asset}=await admin.from("network_media_assets").select("*").eq("id",id).neq("status","deleted").limit(1).maybeSingle();
      if(!asset)return json({error:"asset not found"},404);
      let visible=asset.owner_m_uid===who.mUid;
      if(!visible&&asset.post_id){
        const {data:post}=await admin.from("network_posts").select("id,author_m_uid,visibility,deleted_at").eq("id",asset.post_id).limit(1).maybeSingle();
        visible=await canReadPost(who.mUid,post);
      }
      if(!visible)return json({error:"asset not found"},404);
      const {data,error}=await admin.storage.from(asset.bucket_id).createSignedUrl(asset.object_path,3600);
      if(error||!data?.signedUrl)return json({error:error?.message||"could not sign asset"},500);
      return json({ok:true,asset_id:asset.id,url:data.signedUrl,expires_in:3600,media_type:asset.media_type,mime_type:asset.mime_type,alt_text:asset.alt_text});
    }

    return json({error:"unknown action"},400);
  }catch(e){
    console.error("mnet-media",e);
    return json({error:e instanceof Error?e.message:String(e)},500);
  }
});