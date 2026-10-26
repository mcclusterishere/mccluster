import {reply,fail} from './lib/http.js';
import {sb,requireOrgRole,railFor} from './connect.js';
import {sitePlanSubscriptions,isActiveSitePlan} from './creator-entitlement.js';
import {stripeRequest,retrieveConnectedAccount,connectedAccountReady} from './whip/stripe.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const live=env=>/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY||'');
function configured(env){return !!env.STRIPE_SECRET_KEY&&!!env.CREATOR_STRIPE_WEBHOOK_SECRET&&env.CREATOR_STORE_ENABLED==='true'&&(/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)||env.CREATOR_COMMERCE_ALLOW_LIVE==='true')}
export async function recordCreatorStorePayment(payment,env){return sb(env,'rpc/record_creator_store_payment',{method:'POST',body:JSON.stringify({p_event:payment.eventId,p_order:payment.orderId,p_session:payment.sessionId,p_account:payment.accountId,p_intent:payment.paymentIntentId,p_amount:payment.amountTotal,p_currency:payment.currency,p_email:payment.email||null,p_shipping:payment.shipping||null,p_paid_at:payment.paidAt})})}
export async function recordCreatorStoreRefund(payment,env){return sb(env,'rpc/record_creator_store_refund',{method:'POST',body:JSON.stringify({p_event:payment.eventId,p_order:payment.orderId,p_account:payment.accountId,p_charge:payment.chargeId,p_intent:payment.paymentIntentId,p_amount:payment.amount,p_refunded:payment.refunded,p_currency:payment.currency})})}
export async function handleCreatorStore(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(!path.startsWith('/v1/creator-store/'))return null;
 const respond=(data,status=200)=>{const res=reply(request,env,data,status);res.headers.set('cache-control','no-store');return res};
 try{
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return fail(request,env,'Store unavailable',503);
 if(path==='/v1/creator-store/product'&&request.method==='GET'){
  const id=url.searchParams.get('id');if(!UUID.test(id||''))return fail(request,env,'Invalid product',400);
  const rows=await sb(env,'creator_products?id=eq.'+id+'&status=eq.live&select=id,title,description,kind,amount_cents,currency');
  if(!rows?.[0])return fail(request,env,'Product unavailable',404);
  return respond({product:rows[0],checkout_configured:configured(env)});
 }
 if(path==='/v1/creator-store/order'&&request.method==='GET'){
  const id=url.searchParams.get('id'),token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');if(!UUID.test(id||'')||!UUID.test(token||''))return fail(request,env,'Invalid order link',400);
  const rows=await sb(env,'creator_store_orders?id=eq.'+id+'&access_hash=eq.'+await sha(token)+'&select=id,title,status,amount_cents,currency,fulfillment_note');
  if(!rows?.[0])return fail(request,env,'Order not found',404);return respond({order:rows[0]});
 }
 if(path==='/v1/creator-store/checkout'&&request.method==='POST'){
  if(!configured(env))return fail(request,env,'Store checkout is not configured',503);
  const body=await request.json();if(!UUID.test(body.product_id||'')||!UUID.test(body.request_id||'')||!UUID.test(body.access_token||''))return fail(request,env,'Invalid checkout request',400);
  const order=await sb(env,'rpc/reserve_creator_store_order',{method:'POST',body:JSON.stringify({p_id:body.request_id,p_product:body.product_id,p_access_hash:await sha(body.access_token),p_livemode:live(env)})});
  if(order.status!=='pending')return fail(request,env,'This order is already paid. Check your order status.',409);
  const account=await retrieveConnectedAccount(env,order.stripe_account_id);if(!connectedAccountReady(account))return fail(request,env,'Seller cannot accept payments currently',409);
  const checkout=await stripeRequest(env,'checkout/sessions',{
   mode:'payment',line_items:[{quantity:1,price_data:{currency:order.currency,unit_amount:order.amount_cents,product_data:{name:order.title}}}],
   metadata:{creator_store_order_id:order.id,mccluster_org_id:order.org_id},
   payment_intent_data:{metadata:{creator_store_order_id:order.id,mccluster_org_id:order.org_id}},
   success_url:'https://matthew.mccluster.org/customer-checkout.html?order='+order.id+'#token='+body.access_token,
   cancel_url:'https://matthew.mccluster.org/customer-checkout.html?product='+order.product_id,
   ...(order.kind==='physical'?{shipping_address_collection:{allowed_countries:['US']}}:{})
  },{account:order.stripe_account_id,idempotencyKey:'creator-store-'+order.id});
  if(!checkout.id||!checkout.url)throw Error('Provider checkout missing');
  await sb(env,'creator_store_orders?id=eq.'+order.id+'&status=eq.pending&checkout_session_id=is.null',{method:'PATCH',body:JSON.stringify({checkout_session_id:checkout.id})});
  return respond({url:checkout.url});
 }
 const body=request.method==='GET'?{}:await request.json().catch(()=>({}));
 const {org,user}=await requireOrgRole(request,env,request.method==='GET'?url.searchParams.get('org'):body.org);
 if(path==='/v1/creator-store/products'&&request.method==='GET')return respond({products:await sb(env,'creator_products?org_id=eq.'+org.id+'&order=created_at.desc&limit=100')});
 if(path==='/v1/creator-store/orders'&&request.method==='GET')return respond({orders:await sb(env,'creator_store_orders?org_id=eq.'+org.id+'&order=created_at.desc&limit=100&select=id,title,kind,amount_cents,currency,status,buyer_email,shipping_details,fulfillment_note,created_at')});
 if(path==='/v1/creator-store/fulfill'&&request.method==='POST'){
  if(!UUID.test(body.order_id||'')||typeof body.note!=='string'||body.note.trim().length<3||body.note.length>2000)return fail(request,env,'Enter delivery or service completion details',400);
  const rows=await sb(env,'creator_store_orders?id=eq.'+body.order_id+'&org_id=eq.'+org.id+'&status=eq.paid',{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'fulfilled',fulfillment_note:body.note,fulfilled_at:new Date().toISOString()})});
  if(!rows?.length)return fail(request,env,'Order not found or not awaiting fulfillment',409);return respond({fulfilled:true});
 }
 if(path==='/v1/creator-store/products'&&request.method==='POST'){
  if(!(await sitePlanSubscriptions(user.id,env)).some(p=>p.org_id===org.id&&isActiveSitePlan(p)))return fail(request,env,'Active owned plan required',403);
  const title=String(body.title||'').trim(),description=String(body.description||'');
  if(!title||title.length>120||description.length>4000||!['physical','service'].includes(body.kind)||!Number.isInteger(body.amount_cents)||body.amount_cents<50||body.amount_cents>1000000||!['draft','live','archived'].includes(body.status))return fail(request,env,'Invalid product details',400);
  if(body.status==='live'){if(!configured(env))return fail(request,env,'Checkout must be configured before listing products',503);const rail=await railFor(env,org.id);if(!rail?.stripe_account_id||!connectedAccountReady(await retrieveConnectedAccount(env,rail.stripe_account_id)))return fail(request,env,'Complete seller payment onboarding before listing products',409)}
  const product={title,description,kind:body.kind,amount_cents:body.amount_cents,status:body.status,updated_at:new Date().toISOString()};
  if(body.id&&!UUID.test(body.id))return fail(request,env,'Invalid product',400);
  const rows=await sb(env,body.id?'creator_products?id=eq.'+body.id+'&org_id=eq.'+org.id:'creator_products',{method:body.id?'PATCH':'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(body.id?product:{...product,org_id:org.id})});
  if(!rows?.[0])return fail(request,env,'Product not found',404);return respond({product:rows[0]});
 }
 return fail(request,env,'Unknown store action',404);
 }catch(error){return fail(request,env,error.status===403?'You do not own this workspace':error.status===401?'Sign in required':'Store request failed. Refresh and retry; no payment is confirmed by this response.',[401,403,404].includes(error.status)?error.status:503)}
}
