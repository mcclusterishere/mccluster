// Whip Equipped LLC — real in-app booking boundary, disabled until legal,
// commercial routing, payments and driver-screening capabilities are reviewed.
// Existing Whip handlers stay unmodified and cannot accept client-supplied fares.
import app from './identity-gateway.js';
import {activeBindings,RIDES_MESSAGE,validPoint,validLabel,quoteFare,serverRates,
  commercialRoute,signQuote,verifyQuote,approvedDriver,keyForBooking} from './booking-core.mjs';
import {allowedOrigins} from '../lib/http.js';
const statusCode=error=>error instanceof TypeError||error instanceof RangeError?400:503;
function json(request,env,data,status=200) {
  const origin=request.headers.get('origin');
  const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','vary':'Origin'};
  if(origin&&allowedOrigins(env).includes(origin)) {
    headers['access-control-allow-origin']=origin;
    headers['access-control-allow-methods']='GET,POST,PATCH,OPTIONS';
    headers['access-control-allow-headers']='authorization,content-type,idempotency-key';
  }
  return new Response(JSON.stringify(data),{status,headers});
}
const unavailable=(request,env)=>json(request,env,{code:'service_not_live',rides_live:false,operator:'Whip Equipped LLC',error:RIDES_MESSAGE,
  driver_signup_url:'https://matthew.mccluster.org/whip/driver/'},503);
async function auth(req,env) {
  const bearer=req.headers.get('authorization')||'';
  if(!/^Bearer \S+$/i.test(bearer))throw Object.assign(new Error('Sign in with an M Account first.'),{status:401});
  const result=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{
    apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:bearer},cache:'no-store'});
  if(!result.ok)throw Object.assign(new Error('Your sign-in has expired.'),{status:401});
  const user=await result.json();
  if(!user?.id)throw Object.assign(new Error('No account found.'),{status:401});
  return user;
}
async function rest(env,path,init={}) {
  const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{
    ...init,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,
      'content-type':'application/json',...(init.headers||{})},cache:'no-store'});
  const data=await r.json().catch(()=>null);
  if(!r.ok)throw Object.assign(new Error('Booking store is not ready.'),{status:503});
  return data;
}
const one=async(env,path)=>(await rest(env,path))?.[0]||null;
async function driverFor(req,env) {
  const user=await auth(req,env);
  return {user,driver:await one(env,'drivers?auth_user_id=eq.'+encodeURIComponent(user.id)+'&select=*')};
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function jsonBody(req) {
  if(!/^application\/json(?:;|$)/i.test(req.headers.get('content-type')||''))throw new TypeError('JSON required.');
  const text=await req.text();
  if(text.length>4096)throw new TypeError('Ride request too large.');
  const body=JSON.parse(text);
  if(!body||typeof body!=='object'||Array.isArray(body))throw new TypeError('Invalid booking data.');
  return body;
}
export default { async fetch(request,env,ctx) {
  const url=new URL(request.url),path=url.pathname.replace(/\/+$/,'')||'/';
  if(path==='/api/service-status'&&request.method==='GET') {
    const status=activeBindings(env);
    return json(request,env,{operator:'Whip Equipped LLC',rides_live:status.live,
      booking_mode:status.live?'payment_authorization_then_verified_driver_acceptance':'applications_only',
      driver_signup_url:'https://matthew.mccluster.org/whip/driver/',
      message:status.live?'Booking requires a quote, card authorization and a confirmed driver.':RIDES_MESSAGE});
  }
  // Never pass unverified legacy fare submissions through to the lifted Worker.
  const guardedRide=path==='/api/rides'&&request.method==='POST';
  const quoted=path==='/api/rides/quote'&&request.method==='POST';
  const payment=/^\/api\/rides\/([0-9a-f-]{36})\/payment-intent$/i.test(path)&&request.method==='POST';
  const accept=/^\/api\/rides\/([0-9a-f-]{36})\/accept$/i.exec(path);
  const offers=path==='/api/offers'&&request.method==='GET';
  const presence=/^\/api\/drivers\/([0-9a-f-]{36})\/presence$/i.test(path)&&request.method==='PATCH';
  const rideStatus=/^\/api\/rides\/([0-9a-f-]{36})\/status$/i.test(path)&&request.method==='PATCH';
  if((guardedRide||quoted||payment||accept||offers||presence||rideStatus)&&!activeBindings(env).live)
    return unavailable(request,env);
  if(!(guardedRide||quoted||payment||accept||offers||presence||rideStatus))return app.fetch(request,env,ctx);
  try {
    if(quoted) {
      const user=await auth(request,env),body=await jsonBody(request);
      if(body.tenant_slug!=='whip-equipped'||body.mode&&body.mode!=='drive')throw new TypeError('Only Whip Equipped driving quotes are supported.');
      const origin=validPoint(body.origin),destination=validPoint(body.destination);
      const pickupLabel=validLabel(body.pickup_label),dropoffLabel=validLabel(body.dropoff_label);
      const tenant=await one(env,'tenants?slug=eq.whip-equipped&select=id,slug,platform_fee_percent,stripe_charges_enabled');
      if(!tenant?.stripe_charges_enabled)throw Object.assign(new Error('Operator payments are not ready.'),{status:503});
      const route=await commercialRoute(origin,destination,env.WHIP_TOMTOM_API_KEY);
      const fareCents=quoteFare(route.distanceMeters,route.durationSeconds,serverRates(env));
      const feePercent=Number(tenant.platform_fee_percent);
      if(!Number.isFinite(feePercent)||feePercent<0||feePercent>0.25)throw new TypeError('Operator fee configuration is invalid.');
      const platformFeeCents=Math.round(fareCents*feePercent);
      const expires=Date.now()+120000;
      const payload={v:1,sub:user.id,tenant:tenant.id,tier:'WE Standard',currency:'usd',
        origin,destination,pickupLabel,dropoffLabel,fareCents,platformFeeCents,
        meters:route.distanceMeters,seconds:route.durationSeconds,expires,nonce:crypto.randomUUID().replace(/-/g,'')};
      const quoteToken=await signQuote(payload,env.WHIP_QUOTE_SIGNING_KEY);
      return json(request,env,{quote_token:quoteToken,quote:{tier:payload.tier,operator:'Whip Equipped LLC',currency:'usd',
        fare_cents:fareCents,distance_meters:route.distanceMeters,duration_seconds:route.durationSeconds,
        expires_at:new Date(expires).toISOString(),payment_note:'Card authorization precedes driver matching. No ride is confirmed until a verified driver accepts.'}});
    }
    if(guardedRide) {
      const user=await auth(request,env),body=await jsonBody(request);
      const p=await verifyQuote(body.quote_token,env.WHIP_QUOTE_SIGNING_KEY,user.id);
      const key=keyForBooking(request.headers.get('idempotency-key'));
      if(!uuid.test(user.id))throw new TypeError('Account ID is not valid.');
      const data=await rest(env,'rpc/whip_submit_booked_request',{method:'POST',body:JSON.stringify({
        p_tenant_id:p.tenant,p_rider_id:user.id,p_pickup_label:p.pickupLabel,
        p_pickup_lat:p.origin[1],p_pickup_lng:p.origin[0],p_dropoff_label:p.dropoffLabel,
        p_dropoff_lat:p.destination[1],p_dropoff_lng:p.destination[0],
        p_fare_cents:p.fareCents,p_platform_fee_cents:p.platformFeeCents,
        p_miles:Number((p.meters/1609.344).toFixed(2)),p_minutes:Math.ceil(p.seconds/60),
        p_booking_key:key})});
      if(!data?.ride?.id)throw new Error('The booking could not be created.');
      return json(request,env,{ride:data.ride,reused:data.reused===true,
        confirmed:false,next_step:'authorize_payment_then_wait_for_verified_driver'},data.reused?200:201);
    }
    if(offers||presence||accept||(rideStatus&&request.method==='PATCH')) {
      const {driver}=await driverFor(request,env);
      if(!approvedDriver(driver))return json(request,env,{error:'Whip Equipped driver screening or credentials are not approved.'},403);
      if(accept) {
        if(!uuid.test(accept[1]))throw new TypeError('Invalid ride.');
        const result=await rest(env,'rpc/whip_accept_authorized_ride',{method:'POST',body:JSON.stringify({
          p_driver_id:driver.id,p_ride_id:accept[1]})});
        if(!result?.ride?.id)return json(request,env,{error:'Ride no longer available or driver is already assigned.'},409);
        return json(request,env,{ride:result.ride,confirmed:true});
      }
    }
    return app.fetch(request,env,ctx);
  } catch(error) {
    // Provider, PostgREST and Stripe details are never reflected to clients.
    return json(request,env,{error:error instanceof SyntaxError?'Malformed booking request.':error?.message||'The ride could not be requested.'},
      error?.status||statusCode(error));
  }
}};