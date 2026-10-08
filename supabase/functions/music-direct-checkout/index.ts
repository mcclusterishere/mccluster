import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const stripe = new Stripe(Deno.env.get("STRIPE_SK")!);
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession:false, autoRefreshToken:false } });
const SITE = "https://matthew.mccluster.org";
const cors = {"Access-Control-Allow-Origin":SITE,"Access-Control-Allow-Headers":"apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST") return json({error:"POST required"},405);
  const body=await req.json().catch(()=>({}));
  const offerKey=String(body.offer_key||"").trim();
  if(!/^[a-z0-9][a-z0-9-]{2,79}$/.test(offerKey)) return json({error:"invalid offer"},400);

  const {data:offer,error}=await admin.from("music_direct_offers")
    .select("offer_key,title,price_cents,currency,campaign_key,purpose_statement,active")
    .eq("offer_key",offerKey).eq("active",true).limit(1).maybeSingle();
  if(error||!offer) return json({error:"offer unavailable"},404);
  if(!Number.isInteger(offer.price_cents)||offer.price_cents<50) return json({error:"offer price unavailable"},409);

  const orderId=crypto.randomUUID();
  const metadata={kind:"music_direct_sale",music_direct_order_id:orderId,music_direct_offer_key:offer.offer_key,campaign_key:offer.campaign_key||""};
  let session:Stripe.Checkout.Session;
  try{
    session=await stripe.checkout.sessions.create({
      mode:"payment",
      customer_creation:"always",
      billing_address_collection:"auto",
      line_items:[{price_data:{
        currency:offer.currency||"usd",
        unit_amount:offer.price_cents,
        product_data:{name:offer.title,description:String(offer.purpose_statement||"Full MP3 purchase.").slice(0,450),metadata:{music_direct_offer_key:offer.offer_key}}
      },quantity:1}],
      metadata,
      payment_intent_data:{metadata},
      allow_promotion_codes:false,
      success_url:`${SITE}/end-racism.html?track_purchase=success&session_id={CHECKOUT_SESSION_ID}#track`,
      cancel_url:`${SITE}/end-racism.html?track_purchase=canceled#track`
    });
  }catch(e){
    console.error("music direct checkout",e);
    return json({error:"checkout unavailable"},502);
  }

  const {error:insertError}=await admin.from("music_direct_orders").insert({
    id:orderId,offer_key:offer.offer_key,stripe_checkout_session_id:session.id,
    amount_cents:offer.price_cents,currency:offer.currency||"usd",status:"pending",metadata
  });
  if(insertError){
    try{await stripe.checkout.sessions.expire(session.id);}catch(_){}
    console.error("music direct order insert",insertError);
    return json({error:"could not record checkout"},500);
  }
  return json({ok:true,url:session.url,order_id:orderId});
});
