import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const stripe = new Stripe(Deno.env.get("STRIPE_SK")!);
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession:false, autoRefreshToken:false } });
const SITE="https://matthew.mccluster.org";
const cors={"Access-Control-Allow-Origin":SITE,"Access-Control-Allow-Headers":"apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});

async function ensurePaid(session:Stripe.Checkout.Session){
  const orderId=String(session.metadata?.music_direct_order_id||"");
  const offerKey=String(session.metadata?.music_direct_offer_key||"");
  if(session.metadata?.kind!=="music_direct_sale"||!orderId||!offerKey) throw Object.assign(new Error("not a direct music purchase"),{status:400});
  if(session.payment_status!=="paid") throw Object.assign(new Error("payment not complete"),{status:409});

  const {data:order}=await admin.from("music_direct_orders").select("id,offer_key,status,customer_email").eq("id",orderId).eq("offer_key",offerKey).limit(1).maybeSingle();
  if(!order) throw Object.assign(new Error("order not found"),{status:404});
  const email=String(session.customer_details?.email||session.customer_email||order.customer_email||"").toLowerCase();
  if(order.status!=="paid"){
    await admin.from("music_direct_orders").update({
      status:"paid",customer_email:email,
      stripe_payment_intent_id:typeof session.payment_intent==="string"?session.payment_intent:null,
      paid_at:new Date().toISOString(),updated_at:new Date().toISOString()
    }).eq("id",orderId);
  }
  let {data:ent}=await admin.from("music_direct_entitlements").select("id,download_count,revoked_at").eq("order_id",orderId).limit(1).maybeSingle();
  if(!ent){
    const inserted=await admin.from("music_direct_entitlements").insert({order_id:orderId,offer_key:offerKey,customer_email:email}).select("id,download_count,revoked_at").single();
    ent=inserted.data;
  }
  if(!ent||ent.revoked_at) throw Object.assign(new Error("entitlement unavailable"),{status:403});
  return {orderId,offerKey,email,ent};
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST") return json({error:"POST required"},405);
  const body=await req.json().catch(()=>({}));
  const sessionId=String(body.session_id||"").trim();
  if(!/^cs_(?:test|live)_[A-Za-z0-9]+$/.test(sessionId)) return json({error:"invalid checkout session"},400);
  try{
    const session=await stripe.checkout.sessions.retrieve(sessionId);
    const paid=await ensurePaid(session);
    const {data:offer}=await admin.from("music_direct_offers")
      .select("title,asset_bucket,asset_path,download_name,purpose_statement,active")
      .eq("offer_key",paid.offerKey).eq("active",true).limit(1).maybeSingle();
    if(!offer) return json({error:"offer unavailable"},404);
    const {data:signed,error}=await admin.storage.from(offer.asset_bucket).createSignedUrl(offer.asset_path,900,{download:offer.download_name});
    if(error||!signed?.signedUrl) throw new Error(error?.message||"could not sign download");
    await admin.from("music_direct_entitlements").update({
      download_count:Number(paid.ent.download_count||0)+1,last_download_at:new Date().toISOString()
    }).eq("id",paid.ent.id);
    return json({ok:true,title:offer.title,url:signed.signedUrl,expires_in:900,purpose_statement:offer.purpose_statement});
  }catch(e){
    const status=Number((e as {status?:number})?.status)||500;
    console.error("music direct access",e);
    return json({error:e instanceof Error?e.message:"download unavailable"},status);
  }
});
