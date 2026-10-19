/* Whip Equipped LLC: real, launch-gated booking orchestration.
 * External ride/payment APIs cannot accept client-picked fares or a self-
 * asserted driver role. The lifted satellite code remains byte-identical. */
import app from './identity-gateway.js';

import { bookingSettings, bookingReadiness, bookingLocations, calculateFare,
  signQuote, verifyQuote, bookingRequestId, bookingProblem, BOOKING_QUOTE_TTL_MS } from './booking-core.js';
import { boundedJson } from '../../../../js/travel/route-core.mjs';

const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store, private'};
const clean = (body,status=200)=>new Response(JSON.stringify(body),{status,headers:JSON_HEADERS});
const problem = (code,message,status=409)=>clean({code,error:message},status);
const fail = (code,message,status=409)=>Object.assign(new Error(message),{code,status});
const safeIds = s => typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const isLive = env=>bookingReadiness(env).live;
const readBody = req=>boundedJson(req,4096);
const serviceHeaders = env=>({
  apikey:env.SUPABASE_SERVICE_ROLE_KEY,
  authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,
  'content-type':'application/json'
});
async function service(env,path,init={},fetchFn=fetch) {
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw fail('database_unavailable','The booking database is not connected.',503);
  const res=await fetchFn(env.SUPABASE_URL+'/rest/v1/'+path,{
    ...init,headers:{...serviceHeaders(env),...(init.headers||{})}
  });
  const data=await res.json().catch(()=>null);
  if(!res.ok){
    if(res.status===404||res.status===409 || data?.code==='23505')
      throw fail('booking_conflict','The booking has already changed. Reload your trip.',409);
    if(data?.message?.includes('no_cleared_drivers'))throw fail('no_drivers','No cleared Whip drivers are available for booking right now.',409);
    throw fail('database_unavailable','The booking service is temporarily unavailable.',503);
  }
  return data;
}
async function signedIn(req,env,fetchFn=fetch) {
  const auth=req.headers.get('authorization')||'';
  if(!/^Bearer \S+$/.test(auth))throw fail('login_required','Sign in with your M Account to book a ride.',401);
  const response=await fetchFn(env.SUPABASE_URL+'/auth/v1/user',{
    headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:auth},redirect:'manual'
  });
  if(!response.ok)throw fail('login_required','Your login expired. Sign in again.',401);
  const user=await response.json();
  if(!user?.id || !safeIds(user.id))throw fail('login_required','Your account could not be verified.',401);
  return user;
}
async function tenantBySlug(env,slug,fetchFn){
  const rows=await service(env,'tenants?slug=eq.'+encodeURIComponent(slug)+
    '&select=id,slug,name,platform_fee_percent,white_label_enabled,stripe_charges_enabled,stripe_payouts_enabled,stripe_details_submitted&limit=1',{},fetchFn);
  if(!rows?.[0]||!safeIds(rows[0].id))throw fail('operator_unavailable','This Whip operator is unavailable.',404);
  return rows[0];
}
async function tenantById(env,id,fetchFn){
  const rows=await service(env,'tenants?id=eq.'+encodeURIComponent(id)+
    '&select=id,slug,name,platform_fee_percent,white_label_enabled,stripe_charges_enabled,stripe_payouts_enabled,stripe_details_submitted&limit=1',{},fetchFn);
  if(!rows?.[0]||!safeIds(rows[0].id))throw fail('operator_unavailable','This Whip operator is unavailable.',404);
  return rows[0];
}
const approvedClearance = (c,now) => c && c.approval_status==='approved'&&!!c.approved_at &&
  !!c.identity_checked_at&&!!c.background_checked_at&&!!c.local_authority_checked_at &&
  !c.revoked_at && Date.parse(c.insurance_expires_at)>now &&
  Date.parse(c.license_expires_at)>now;
async function driverClearance(env,req,driverId,fetchFn,now) {
  const user=await signedIn(req,env,fetchFn);
  const rows=await service(env,'drivers?auth_user_id=eq.'+encodeURIComponent(user.id)+
    '&id=eq.'+encodeURIComponent(driverId)+'&select=id,tenant_id,online&limit=1',{},fetchFn);
  const driver=rows?.[0];
  if(!driver||!safeIds(driver.id))throw fail('driver_access_denied','This driver profile does not belong to you.',403);
  const rows2=await service(env,'whip_driver_clearances?driver_id=eq.'+encodeURIComponent(driver.id)+
    '&tenant_id=eq.'+encodeURIComponent(driver.tenant_id)+'&select=*&limit=1',{},fetchFn);
  const c=rows2?.[0];
  if(!approvedClearance(c,now))
    throw fail('driver_not_approved','Whip operator clearance, licensing and insurance are required before accepting rides.',403);
  return driver;
}
const mode = val=>val && ['standard'].includes(val) ? val : 'standard';
const noLive = ()=>problem('service_not_live','Whip Equipped is accepting driver applications but is not dispatching paid rides yet.',503);
/* Reuse the canonical Durable Object quota and provider, not a second
 * uncontrolled upstream request path that can run up commercial API costs. */
async function quotaControlledStreetRoute(input,env) {
  if (!env.HereTenantAgent)throw fail('route_quota_unavailable','The commercial routing capacity is not connected.',503);
  const id=env.HereTenantAgent.idFromName('travel:street-routing:mccluster');
  const outcome=await env.HereTenantAgent.get(id).routeTravel(input);
  if (!outcome?.route)throw fail('route_unavailable',typeof outcome?.error==='string'
    ? outcome.error:'Verified street routing is temporarily unavailable.',
    Number.isInteger(outcome?.status)?outcome.status:503);
  return outcome.route;
}
export function createWhipBookingGate(next=app,options={}) {
  const runRoute=options.route || quotaControlledStreetRoute;
  const fetchFn=options.fetch || fetch;
  const now=options.now || Date.now;
  const randomId=options.randomId || (()=>crypto.randomUUID());
  return {async fetch(req,env,ctx){
    const url=new URL(req.url),path=url.pathname.replace(/\/+$/,'')||'/';
    if(req.method==='OPTIONS')return next.fetch(req,env,ctx);

    if(path==='/api/service-status'&&req.method==='GET'){
      const ready=bookingReadiness(env);
      return clean({operator:'Whip Equipped LLC',rides_live:ready.live,
        quote_supported:ready.commercialRouting&&ready.prices&&ready.quoteAuth,
        driver_signup_url:'https://matthew.mccluster.org/whip/driver/',
        message:ready.live?'Ride booking is connected. A ride is confirmed only when a cleared driver accepts.':
          'Ride booking is in preparation. No live driver or fare has been promised.'});
    }

    if(path==='/api/drivers/clearance'&&req.method==='GET'){
      try{
        const u=await signedIn(req,env,fetchFn);
        const rows=await service(env,'drivers?auth_user_id=eq.'+encodeURIComponent(u.id)+
          '&select=id,tenant_id&limit=1',{},fetchFn);
        const driver=rows?.[0];
        if(!driver)return clean({driver_id:null,approval_status:'not_applied',can_drive:false});
        const clears=await service(env,'whip_driver_clearances?driver_id=eq.'+encodeURIComponent(driver.id)+
          '&tenant_id=eq.'+encodeURIComponent(driver.tenant_id)+
          '&select=approval_status,approved_at,identity_checked_at,background_checked_at,local_authority_checked_at,insurance_expires_at,license_expires_at,revoked_at&limit=1',{},fetchFn);
        const clearance=clears?.[0]||null;
        return clean({driver_id:driver.id,
          approval_status:clearance?.approval_status||'pending',
          can_drive:!!approvedClearance(clearance,now())&&isLive(env),
          service_live:isLive(env)});
      }catch(error){const p=bookingProblem(error);return clean(p,p.status)}
    }

    if(path==='/api/rides'&&req.method==='POST' || path==='/api/rides/quote'&&req.method==='POST'){
      try{
        const user=await signedIn(req,env,fetchFn),body=await readBody(req);
        if(path==='/api/rides/quote'){
          if(env.TRAVEL_ROUTING_PROVIDER!=='tomtom'||!env.TRAVEL_TOMTOM_API_KEY)
            return problem('commercial_routing_required','Commercial street directions must be connected before Whip can quote paid rides.',503);
          if(env.WHIP_FARES_APPROVED!=='true')
            return problem('fares_not_approved','Whip fares are not yet approved for customers.',503);
          bookingSettings(env);
          const input=bookingLocations(body),tenant=await tenantBySlug(env,input.tenant_slug,fetchFn);
          const route=await runRoute({origin:input.origin,destination:input.destination,mode:'drive'},env);
          const fee=tenant.white_label_enabled?0:Number(tenant.platform_fee_percent);
          const estimate=calculateFare(route,env,fee);
          const issuedAt=now(),quoteId=randomId();
          const payload={v:1,quote_id:quoteId,sub:user.id,tenant_id:tenant.id,
            origin:input.origin,destination:input.destination,
            pickup_label:input.pickup_label,dropoff_label:input.dropoff_label,tier:'standard',
            fare_cents:estimate.fare_cents,platform_fee_cents:estimate.platform_fee_cents,
            miles:estimate.miles,minutes:estimate.minutes,iat:issuedAt,exp:issuedAt+BOOKING_QUOTE_TTL_MS};
          const token=await signQuote(payload,env);
          return clean({quote:{token,id:quoteId,expires_at:new Date(payload.exp).toISOString(),tier:'WE Standard',
            operator:tenant.name,estimate,route:{geometry:route.geometry,origin:route.origin,
              destination:route.destination,distanceMeters:route.distanceMeters,durationSeconds:route.durationSeconds}},
            booking_enabled:isLive(env)&&tenant.stripe_charges_enabled===true&&tenant.stripe_payouts_enabled===true,
            notice:'A quote is not a confirmed ride. Booking requires a cleared available driver and secure payment authorization.'});
        }
        // Legacy /api/rides accepted arbitrary fare_cents. Reject old payloads
        // without any database writes even when the live gate is disabled.
        if(!body||typeof body.quote_token!=='string')
          return problem('quote_required','Get a verified Whip fare quote before requesting a ride.',428);
        if(!isLive(env))return noLive();
        const requestId=bookingRequestId(body.request_id);
        if(Object.keys(body).some(k=>!['quote_token','request_id'].includes(k)))
          return problem('untrusted_booking_fields','Book using only the signed quote and a request ID.',400);
        const quote=await verifyQuote(body.quote_token,env,user.id,now());
        const tenant=await tenantById(env,quote.tenant_id,fetchFn);
        if(tenant.stripe_charges_enabled!==true || tenant.stripe_payouts_enabled!==true ||
          tenant.stripe_details_submitted!==true)
          return problem('payments_not_ready','The Whip operator is not ready to accept ride payments.',503);
        const result=await service(env,'rpc/whip_reserve_booking_v1',{method:'POST',
          body:JSON.stringify({p_tenant_id:tenant.id,p_rider_auth_user_id:user.id,
            p_request_id:requestId,p_quote_id:quote.quote_id,
            p_pickup_label:quote.pickup_label,p_pickup_lon:quote.origin[0],p_pickup_lat:quote.origin[1],
            p_dropoff_label:quote.dropoff_label,p_dropoff_lon:quote.destination[0],p_dropoff_lat:quote.destination[1],
            p_miles:quote.miles,p_minutes:quote.minutes,p_fare_cents:quote.fare_cents,
            p_platform_fee_cents:quote.platform_fee_cents,p_ride_tier:'WE Standard'})},fetchFn);
        if(!result?.ride||!safeIds(result.ride.id))throw fail('database_unavailable','The ride was not created.',503);
        return clean({ride:result.ride,reused:result.reused===true,
          payment_required:!['authorized','paid'].includes(result.ride.payment_status),
          notice:'Ride request received, not yet accepted. A cleared driver must accept after payment authorization.'},
          result.reused===true?200:201);
      }catch(error){const p=bookingProblem(error);return clean(p,p.status)}
    }

    const acceptance=path.match(/^\/api\/rides\/([0-9a-f-]+)\/accept$/i);
    const presence=path.match(/^\/api\/drivers\/([0-9a-f-]+)\/presence$/i);
    if(acceptance&&req.method==='POST' || path==='/api/offers'&&req.method==='GET' ||
      presence&&req.method==='PATCH'){
      try{
        if(!isLive(env)){
          if(path==='/api/offers'&&req.method==='GET')return clean({offers:[],service_live:false});
          if(presence&&req.method==='PATCH'){
            const b=await readBody(req.clone());
            if(b.online!==true)return next.fetch(req,env,ctx);
          }
          return noLive();
        }
        if(presence){
          const b=await readBody(req.clone());
          if(b.online!==true)return next.fetch(req,env,ctx);
          await driverClearance(env,req,presence[1],fetchFn,now());
        }
        if(acceptance || path==='/api/offers'){
          const user=await signedIn(req,env,fetchFn);
          const drivers=await service(env,'drivers?auth_user_id=eq.'+encodeURIComponent(user.id)+
            '&select=id,tenant_id,online&limit=1',{},fetchFn);
          if(!drivers?.[0])return problem('driver_not_approved','Your Whip driver profile has not been approved.',403);
          await driverClearance(env,req,drivers[0].id,fetchFn,now());
        }
        return next.fetch(req,env,ctx);
      }catch(error){const p=bookingProblem(error);return clean(p,p.status)}
    }

    const payment=path.match(/^\/api\/rides\/([0-9a-f-]+)\/payment-intent$/i);
    if(payment&&req.method==='POST'){
      if(!isLive(env))return noLive();
      try{
        const ids=await service(env,'whip_booking_idempotency?ride_id=eq.'+
          encodeURIComponent(payment[1])+'&select=ride_id&limit=1',{},fetchFn);
        if(!ids?.length)return problem('legacy_ride_unverified','This trip was not created from a verified Whip quote.',403);
      }catch(error){const p=bookingProblem(error);return clean(p,p.status)}
    }
    return next.fetch(req,env,ctx);
  }};
}
export default createWhipBookingGate();
