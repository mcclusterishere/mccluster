import { reply } from './lib/http.js';
import { domainStore, hostname } from './creator-domains.js';
import { fulfillDomainOrder } from './domains/namesilo.js';
export const DOMAIN_ORDERS_PREFIX = '/v1/creator-domain-orders';
const error = (message,status=409) => Object.assign(new Error(message),{status});
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||''));
export function domainPurchaseCapabilities(env,{provider,createDomainCheckout}={}) {
  const complete = provider && ['quote','createContact','register','renew','verifyOwnership'].every(k=>typeof provider[k]==='function');
  const terms = /^https:\/\/[^\s]+$/.test(env.CREATOR_DOMAIN_TERMS_URL||'') && !!env.CREATOR_DOMAIN_TERMS_VERSION;
  const enabled = env.CREATOR_DOMAIN_SALES_ENABLED==='true' && complete && terms && typeof createDomainCheckout==='function' && /^\d+$/.test(env.CREATOR_DOMAIN_MARKUP_CENTS||'');
  return {purchase:!!enabled,renew:!!enabled,terms_url:terms?env.CREATOR_DOMAIN_TERMS_URL:null,terms_version:terms?env.CREATOR_DOMAIN_TERMS_VERSION:null,reason:enabled?'Review your quote and registrant details before paying.':'Domain sales await registrar, checkout and registration terms configuration. No payment will be collected.'};
}
export async function handleCreatorDomainOrders(request,env,options={}) {
  const {fetchImpl=fetch,provider,createDomainCheckout,authorizeEntitlement=async()=>false}=options;
  const path=new URL(request.url).pathname.replace(/\/$/,'');
  if(path!==DOMAIN_ORDERS_PREFIX&&!path.startsWith(DOMAIN_ORDERS_PREFIX+'/'))return null;
  const send=(body,status=200)=>{const r=reply(request,env,body,status);r.headers.set('cache-control','no-store');return r;};
  try {
    if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw error('Domain sales storage is not configured',503);
    const authorization=request.headers.get('authorization');
    if(!/^Bearer \S+$/i.test(authorization||''))throw error('Sign in to manage domain purchases',401);
    const response=await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{authorization,apikey:env.SUPABASE_SERVICE_ROLE_KEY}});
    const user=response.ok?await response.json():null;
    if(!uuid(user?.id)||user.is_anonymous)throw error('Sign in to manage domain purchases',401);
    const db=(path,init)=>domainStore(env,path,init,fetchImpl),owner=`auth_user_id=eq.${user.id}`;
    const caps=domainPurchaseCapabilities(env,options),rest=path.slice(DOMAIN_ORDERS_PREFIX.length).split('/').filter(Boolean);
    if(!rest.length&&request.method==='GET') {
      const orders=await db(`creator_domain_orders?${owner}&select=id,quote_id,status,reason,expires_at,created_at&order=created_at.desc&limit=100`);
      const contacts=await db(`creator_domain_contacts?${owner}&select=id,created_at&order=created_at.desc&limit=20`);
      return send({capabilities:caps,orders,contacts});
    }
    if(!caps.purchase)throw error(caps.reason,503);
    if(request.method!=='POST')throw error('Route not found',404);
    if(!await authorizeEntitlement(user.id,env,fetchImpl))throw error('An active site plan is required',402);
    const raw=await request.text();if(raw.length>8192)throw error('Request too large',413);
    const body=raw?JSON.parse(raw):{};
    if(rest[0]==='contacts'&&rest.length===1) {
      if(body.consent!==true||body.terms_version!==caps.terms_version)throw error('Review and accept the current registration terms',400);
      const details={};
      for(const key of ['first_name','last_name','address','city','state','postal_code','country','email','phone']) {
        const v=String(body[key]||'').trim();if(!v||v.length>200||/[\x00-\x1f]/.test(v))throw error('Complete the registrant contact details',400);details[key]=v;
      }
      if(!/^[A-Z]{2}$/.test(details.country)||!/^\+\d[\d .-]{6,25}$/.test(details.phone)||!/^\S+@\S+\.\S+$/.test(details.email))throw error('Use a two-letter country code, valid email and international phone number',400);
      const prior=await db(`creator_domain_contacts?${owner}&select=id&limit=20`);
      if(prior.length>=20)throw error('Contact limit reached. Use an existing registrant contact or contact support.');
      // Adapter must confirm contact creation. Raw addresses are sent only to registrar, never logged/stored here.
      const contact=await provider.createContact(details);
      if(!contact?.id||contact.verified!==true)throw error('Registrar contact could not be confirmed. No domain has been purchased.',503);
      const rows=await db('creator_domain_contacts',{method:'POST',body:JSON.stringify({auth_user_id:user.id,provider_contact_id:contact.id,verified_at:new Date().toISOString(),terms_version:caps.terms_version,consent_at:new Date().toISOString()})});
      return send({contact:{id:rows[0].id,created_at:rows[0].created_at}},201);
    }
    if(rest[0]==='quotes'&&rest.length===1) {
      const domain=hostname(body.hostname),action=body.action||'register',years=Number(body.years||1);
      if(!['register','renew'].includes(action))throw error('Invalid purchase type',400);
      if(!Number.isInteger(years)||years<1||years>10)throw error('Choose between one and ten years',400);
      if(action==='renew') {
        // Renewal allowed only for a purchase recorded for this customer, never an arbitrary account domain.
        const owned=await db(`creator_domain_orders?${owner}&status=eq.fulfilled&select=quote_id,contact_id`);
        const quotes=await db(`creator_domain_quotes?${owner}&hostname=eq.${domain}&select=id`);
        const purchase=owned.find(o=>quotes.some(q=>o.quote_id===q.id));
        if(!purchase)throw error('This account has no completed purchase for that domain',404);
        const contacts=await db(`creator_domain_contacts?id=eq.${purchase.contact_id}&${owner}&limit=1`);
        const check=await provider.verifyOwnership({hostname:domain,registrant_contact_id:contacts[0]?.provider_contact_id});
        if(!check?.owned||!check?.registrant_matches)throw error('Registrar ownership must be confirmed before renewal');
      }
      const quote=await provider.quote(domain,action,years);
      if(quote?.available!==true||quote?.premium===true||quote?.currency!=='USD'||!Number.isSafeInteger(quote?.registrar_cents)||quote.registrar_cents<=0)throw error('A standard-price quote is not available for this domain');
      const total=quote.registrar_cents+Number(env.CREATOR_DOMAIN_MARKUP_CENTS);
      if(!Number.isSafeInteger(total)||total>1000000)throw error('Domain price cannot be offered',503);
      const rows=await db('creator_domain_quotes',{method:'POST',body:JSON.stringify({auth_user_id:user.id,hostname:domain,action,years,registrar_cents:quote.registrar_cents,total_cents:total,currency:'USD',expires_at:new Date(Date.now()+60*60*1000).toISOString()})});
      const {auth_user_id,registrar_cents,...publicQuote}=rows[0];return send({quote:publicQuote},201);
    }
    if(!rest.length) {
      if(!uuid(body.quote_id)||!uuid(body.contact_id)||body.consent!==true||body.terms_version!==caps.terms_version)throw error('Choose a quote and contact and accept current registration terms',400);
      const quotes=await db(`creator_domain_quotes?id=eq.${body.quote_id}&${owner}&limit=1`),contacts=await db(`creator_domain_contacts?id=eq.${body.contact_id}&${owner}&limit=1`);
      if(!quotes[0]||!contacts[0])throw error('Quote or contact not found',404);
      if(Date.parse(quotes[0].expires_at)<=Date.now())throw error('This quote expired. Request a new quote.');
      const existing=await db(`creator_domain_orders?quote_id=eq.${body.quote_id}&${owner}&limit=1`);
      const rows=existing.length?existing:await db('creator_domain_orders',{method:'POST',body:JSON.stringify({auth_user_id:user.id,quote_id:body.quote_id,contact_id:body.contact_id,terms_version:caps.terms_version})});
      return send({order:{id:rows[0].id,status:rows[0].status}},existing.length?200:201);
    }
    if(rest.length===2&&uuid(rest[0])&&rest[1]==='checkout') {
      const rows=await db(`creator_domain_orders?id=eq.${rest[0]}&${owner}&limit=1`),order=rows[0];
      if(!order)throw error('Order not found',404);
      if(order.status!=='awaiting_payment')throw error('This order cannot collect another payment');
      const quotes=await db(`creator_domain_quotes?id=eq.${order.quote_id}&${owner}&limit=1`),q=quotes[0];
      if(!q||Date.parse(q.expires_at)<=Date.now()+31*60*1000)throw error('This quote is too close to expiry for checkout. Request a new quote.');
      const session=await createDomainCheckout({id:order.id,auth_user_id:user.id,hostname:q.hostname,action:q.action,years:q.years,total_cents:q.total_cents,currency:q.currency,expires_at:q.expires_at});
      if(!session?.id||!/^https:\/\/checkout\.stripe\.com\//.test(session.url||''))throw error('Checkout could not be confirmed',503);
      await db(`creator_domain_orders?id=eq.${order.id}&${owner}&status=eq.awaiting_payment`,{method:'PATCH',body:JSON.stringify({checkout_session_id:session.id})});
      return send({url:session.url});
    }
    throw error('Route not found',404);
  }catch(e){return send({error:e instanceof SyntaxError?'Invalid request':e.status?e.message:'Domain provider is unavailable. Please retry later.'},e instanceof SyntaxError?400:e.status||503);}
}
// Internal webhook bridge. Never expose a browser route to this function.
export async function recordDomainFunding(event,env,{fetchImpl=fetch}={}) {
  const {orderId,ownerUserId,eventId,sessionId,amountTotal,currency,paymentStatus,paidAt}=event;
  if(!uuid(orderId)||!uuid(ownerUserId)||!eventId||!sessionId||!Number.isSafeInteger(amountTotal)||amountTotal<=0||String(currency).toUpperCase()!=='USD'||paymentStatus!=='paid'||!Number.isFinite(Date.parse(paidAt)))throw error('Invalid verified domain funding event',400);
  const status=await domainStore(env,'rpc/fund_creator_domain_order',{method:'POST',body:JSON.stringify({order_id:orderId,owner_id:ownerUserId,event_id:eventId,session_id:sessionId,amount_cents:amountTotal,event_currency:'USD',paid_at:paidAt})},fetchImpl);
  return {status};
}
export async function fulfillStoredDomainOrder(orderId,env,{fetchImpl=fetch,provider}={}) {
  if(env.CREATOR_DOMAIN_SALES_ENABLED!=='true'||!provider?.verifyOwnership)throw error('Registrar fulfillment is not configured',503);
  let claimed;
  const store={
    claim:async id => { claimed = await domainStore(env,'rpc/claim_creator_domain_order',{method:'POST',body:JSON.stringify({order_id:id})},fetchImpl); return claimed; },
    finish:async(id,outcome)=>{
      if(outcome.status==='fulfilled') {
        const verification=await provider.verifyOwnership({hostname:claimed.hostname,registrant_contact_id:claimed.registrant_contact_id}).catch(()=>null);
        if(!verification?.owned||!verification?.registrant_matches||!Number.isFinite(Date.parse(verification.expires_at)))outcome={status:'reconciliation_required',reason:'Registrar ownership/contact/expiry could not be confirmed'};
        else outcome.expires_at=verification.expires_at;
      }
      await domainStore(env,`creator_domain_orders?id=eq.${id}&status=eq.executing`,{method:'PATCH',body:JSON.stringify({...outcome,updated_at:new Date().toISOString()})},fetchImpl);
      return outcome;
    }
  };
  const registrar = Object.fromEntries(['register','renew'].map(action => [action, async args => {
    const current = await provider.quote(args.domain, action, args.years);
    if(!current?.available || current.premium || current.currency !== 'USD' || current.registrar_cents !== claimed.registrar_cents) throw Object.assign(new Error('Registrar price or availability changed; payment needs review/refund'), { noCharge: true });
    return provider[action](args);
  }]));
  return fulfillDomainOrder(orderId,{store,registrar,enabled:true});
}
