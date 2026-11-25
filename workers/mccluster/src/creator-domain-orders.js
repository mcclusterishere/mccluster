import { reply } from './lib/http.js';
import { domainStore, hostname } from './creator-domains.js';
import {contactVaultConfigured,sealRegistrant,registrantLoader} from './domains/registration-contact-vault.js';
import {registrationContact} from './domains/cloudflare-registration.js';
import {cloudflareRegistrationStore} from './domains/cloudflare-registration-store.js';
import {startCloudflareRegistration,reconcileCloudflareRegistration} from './domains/cloudflare-registration-flow.js';
import { fulfillDomainOrder } from './domains/namesilo.js';
export const DOMAIN_ORDERS_PREFIX = '/v1/creator-domain-orders';
const error = (message,status=409) => Object.assign(new Error(message),{status});
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||''));
export function domainPurchaseCapabilities(env,{provider,createDomainCheckout}={}) {
  const inline = provider?.capabilities?.contact_model === 'inline';
  const inlineReady=inline && provider.capabilities.mode==='sandbox' && ['quote','prepare','submit','status','ownership'].every(k=>typeof provider[k]==='function') && contactVaultConfigured(env) && env.CREATOR_CF_REGISTRATION_CHECKOUT_ENABLED==='true' && /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY||'');
  const complete = inline ? inlineReady : provider && ['quote','createContact','register','renew','verifyOwnership'].every(k=>typeof provider[k]==='function');
  const terms = /^https:\/\/[^\s]+$/.test(env.CREATOR_DOMAIN_TERMS_URL||'') && !!env.CREATOR_DOMAIN_TERMS_VERSION;
  const enabled = env.CREATOR_DOMAIN_SALES_ENABLED==='true' && complete && terms && typeof createDomainCheckout==='function' && /^\d+$/.test(env.CREATOR_DOMAIN_MARKUP_CENTS||'');
  return {purchase:!!enabled,renew:!!enabled&&!inline,contact_model:inline?'inline':'provider',sandbox:inline,terms_url:terms?env.CREATOR_DOMAIN_TERMS_URL:null,terms_version:terms?env.CREATOR_DOMAIN_TERMS_VERSION:null,reason:enabled?(inline?'Sandbox registration testing only. No real domain delivery. Renewal is unsupported.':'Review your quote and registrant details before paying.'):'Domain sales await registrar, checkout and registration terms configuration. No payment will be collected.'};
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
    const inline=provider?.capabilities?.contact_model==='inline';
    const caps=domainPurchaseCapabilities(env,options),rest=path.slice(DOMAIN_ORDERS_PREFIX.length).split('/').filter(Boolean);
    if(!rest.length&&request.method==='GET') {
      const orders=await db(`creator_domain_orders?${owner}&select=id,quote_id,status,reason,expires_at,created_at&order=created_at.desc&limit=100`);
      const contacts=await db(`creator_domain_contacts?${owner}&select=id,created_at${inline?',contact_kind,expires_at,deleted_at':''}&order=created_at.desc&limit=20`);
      if(inline){
        const attempts=await db(`creator_cf_registration_attempts?${owner}&select=order_id,status,outcome&limit=100`);
        for(const order of orders){const attempt=attempts.find(a=>a.order_id===order.id);if(attempt){order.status=attempt.status;order.reason=attempt.outcome?.reason||null;order.expires_at=attempt.outcome?.expires_at||null;}}
      }
      return send({capabilities:caps,orders,contacts:contacts.filter(c=>!c.deleted_at&&(!c.expires_at||Date.parse(c.expires_at)>Date.now()))});
    }
    if(rest.length===2&&rest[0]==='contacts'&&uuid(rest[1])&&request.method==='DELETE') {
      const rows=await db(`creator_domain_contacts?id=eq.${rest[1]}&${owner}&contact_kind=eq.inline&limit=1`);
      if(!rows[0])throw error('Contact not found',404);
      await db(`creator_domain_contacts?id=eq.${rest[1]}&${owner}&contact_kind=eq.inline`,{method:'PATCH',body:JSON.stringify({sealed_contact:null,deleted_at:new Date().toISOString()})});
      return send({ok:true});
    }
    if(rest.length===2&&uuid(rest[0])&&rest[1]==='status'&&request.method==='POST'&&inline) {
      if(provider.capabilities.mode!=='sandbox')throw error('Registration status provider is unavailable',503);
      const store=cloudflareRegistrationStore(env,{owner:user.id,fetchImpl});
      if(!await store.get(rest[0]))throw error('Registration attempt not found',404);
      const result=await reconcileCloudflareRegistration(rest[0],{store,provider,manual:true});
      return send({status:result.status,reason:result.outcome?.reason||null,expires_at:result.outcome?.expires_at||null});
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
      const prior=await db(`creator_domain_contacts?${owner}${inline?'&deleted_at=is.null&expires_at=gt.'+encodeURIComponent(new Date().toISOString()):''}&select=id&limit=20`);
      if(prior.length>=20)throw error('Contact limit reached. Use an existing registrant contact or contact support.');
      let payload;
      if(inline){
        // Country calling code cannot be guessed; require explicit +code.number.
        const contact=registrationContact({email:details.email,phone:details.phone,postal_info:{name:details.first_name+' '+details.last_name,address:{street:details.address,city:details.city,state:details.state,postal_code:details.postal_code,country_code:details.country}}});
        const id=crypto.randomUUID(),identity={id,auth_user_id:user.id,terms_version:caps.terms_version};
        payload={...identity,...await sealRegistrant(contact,identity,env),contact_kind:'inline',consent_at:new Date().toISOString(),expires_at:new Date(Date.now()+30*86400000).toISOString()};
      }else{
        const contact=await provider.createContact(details);
        if(!contact?.id||contact.verified!==true)throw error('Registrar contact could not be confirmed. No domain has been purchased.',503);
        payload={auth_user_id:user.id,provider_contact_id:contact.id,verified_at:new Date().toISOString(),terms_version:caps.terms_version,consent_at:new Date().toISOString()};
      }
      const rows=await db('creator_domain_contacts',{method:'POST',body:JSON.stringify(payload)});
      return send({contact:{id:rows[0].id,created_at:rows[0].created_at}},201);
    }
    if(rest[0]==='quotes'&&rest.length===1) {
      const domain=hostname(body.hostname),action=body.action||'register',years=Number(body.years||1);
      if(!['register','renew'].includes(action)||(action==='renew'&&!caps.renew))throw error('Invalid purchase type',400);
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
      const rows=await db('creator_domain_quotes',{method:'POST',body:JSON.stringify({auth_user_id:user.id,...(inline?{registrar:'cloudflare_sandbox'}:{}),hostname:domain,action,years,registrar_cents:quote.registrar_cents,total_cents:total,currency:'USD',expires_at:new Date(Date.now()+60*60*1000).toISOString()})});
      const {auth_user_id,registrar_cents,...publicQuote}=rows[0];return send({quote:publicQuote},201);
    }
    if(!rest.length) {
      if(!uuid(body.quote_id)||!uuid(body.contact_id)||body.consent!==true||body.terms_version!==caps.terms_version)throw error('Choose a quote and contact and accept current registration terms',400);
      const quotes=await db(`creator_domain_quotes?id=eq.${body.quote_id}&${owner}&limit=1`),contacts=await db(`creator_domain_contacts?id=eq.${body.contact_id}&${owner}&limit=1`);
      if(!quotes[0]||!contacts[0])throw error('Quote or contact not found',404);
      if(inline&&(quotes[0].registrar!=='cloudflare_sandbox'||contacts[0].contact_kind!=='inline'||contacts[0].deleted_at||Date.parse(contacts[0].expires_at)<=Date.now()||contacts[0].terms_version!==caps.terms_version))throw error('Save a current registration contact and quote',409);
      if(Date.parse(quotes[0].expires_at)<=Date.now())throw error('This quote expired. Request a new quote.');
      if(inline)await provider.prepare({hostname:quotes[0].hostname,years:quotes[0].years,registrant:await registrantLoader(env,fetchImpl)({owner:user.id,reference:contacts[0].id})});
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
      if(inline){
        if(q.registrar!=='cloudflare_sandbox'||q.action!=='register')throw error('Registration quote required',409);
        const contacts=await db(`creator_domain_contacts?id=eq.${order.contact_id}&${owner}&limit=1`);
        if(!contacts[0]||contacts[0].deleted_at||Date.parse(contacts[0].expires_at)<=Date.now()||contacts[0].terms_version!==caps.terms_version)throw error('Registrant contact expired or was removed',409);
        await provider.prepare({hostname:q.hostname,years:q.years,registrant:await registrantLoader(env,fetchImpl)({owner:user.id,reference:contacts[0].id})});
      }
      const session=await createDomainCheckout({id:order.id,auth_user_id:user.id,hostname:q.hostname,action:q.action,years:q.years,total_cents:q.total_cents,currency:q.currency,expires_at:q.expires_at});
      if(!session?.id||!/^https:\/\/checkout\.stripe\.com\//.test(session.url||''))throw error('Checkout could not be confirmed',503);
      await db(`creator_domain_orders?id=eq.${order.id}&${owner}&status=eq.awaiting_payment`,{method:'PATCH',body:JSON.stringify({checkout_session_id:session.id})});
      return send({url:session.url});
    }
    throw error('Route not found',404);
  }catch(e){return send({error:e instanceof SyntaxError?'Invalid request':e.status?e.message:e.noCharge?'Registration requirements could not be met. Check the contact and choose a supported domain. No payment was collected.':'Domain provider is unavailable. Please retry later.'},e instanceof SyntaxError?400:e.status||(e.noCharge?409:503));}
}
// Internal webhook bridge. Never expose a browser route to this function.
export async function recordDomainFunding(event,env,{fetchImpl=fetch}={}) {
  const {orderId,ownerUserId,eventId,sessionId,amountTotal,currency,paymentStatus,paidAt}=event;
  if(!uuid(orderId)||!uuid(ownerUserId)||!eventId||!sessionId||!Number.isSafeInteger(amountTotal)||amountTotal<=0||String(currency).toUpperCase()!=='USD'||paymentStatus!=='paid'||!Number.isFinite(Date.parse(paidAt)))throw error('Invalid verified domain funding event',400);
  const status=await domainStore(env,'rpc/fund_creator_domain_order',{method:'POST',body:JSON.stringify({order_id:orderId,owner_id:ownerUserId,event_id:eventId,session_id:sessionId,amount_cents:amountTotal,event_currency:'USD',paid_at:paidAt})},fetchImpl);
  return {status};
}
// Internal only: call exclusively AFTER the billing webhook verifies signature
// and retrieves the matching Checkout Session. Missing livemode is not false.
export async function handleVerifiedCloudflareDomainFunding(event,env,{fetchImpl=fetch,provider}={}) {
  if(event.livemode!==false||provider?.capabilities?.mode!=='sandbox'||! /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY||''))throw error('Verified sandbox funding is required',409);
  const funded=await recordDomainFunding(event,env,{fetchImpl});
  if(env.CREATOR_CF_REGISTRATION_EXECUTION_ENABLED!=='true'||!contactVaultConfigured(env))return funded;
  const owner=event.ownerUserId,db=(path,init)=>domainStore(env,path,init,fetchImpl);
  const orders=await db(`creator_domain_orders?id=eq.${event.orderId}&auth_user_id=eq.${owner}&limit=1`),order=orders[0];
  if(!order)return {status:'not_found'};
  const contacts=await db(`creator_domain_contacts?id=eq.${order.contact_id}&auth_user_id=eq.${owner}&limit=1`),contact=contacts[0];
  const store=cloudflareRegistrationStore(env,{owner,contactReference:contact?.id,contactSha256:contact?.contact_sha256,fetchImpl});
  if(await store.get(order.id))return reconcileCloudflareRegistration(order.id,{store,provider});
  if(funded.status!=='funded')return funded;
  if(!contact||contact.contact_kind!=='inline'||contact.deleted_at||Date.parse(contact.expires_at)<=Date.now()){
    await db(`creator_domain_orders?id=eq.${order.id}&auth_user_id=eq.${owner}&status=eq.funded`,{method:'PATCH',body:JSON.stringify({status:'refund_required',reason:'Saved registrant contact was removed or expired before submission'})});
    return {status:'refund_required'};
  }
  return startCloudflareRegistration(order.id,{store,provider,enabled:true,loadRegistrant:registrantLoader(env,fetchImpl),verifyFunding:async o=>o.auth_user_id===owner&&o.funded_event_id===event.eventId&&o.paid_cents===event.amountTotal&&o.currency===String(event.currency).toUpperCase()});
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
