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
  const accept=request.method==='POST'?path.match(/^\\/api\\/rides\\/([0-9a-f-]{36})\\/accept$/i):null;
  const offers=path==='/api/offers'&&request.method==='GET';
  const presence=/^\/api\/drivers\/([0-9a-f-]{36})\/presence$/i.test(path)&&request.method==='PATCH';
  const rideStatus=/^\/api\/rides\/([0-9a-f-]{36})\/status$/i.test(path)&&request.method==='PATCH';
  const cancelRide=rideStatus&&String((await request.clone().json().catch(()=>({}))).status||'').toUpperCase()==='CANCELED';
  const applying=path==='/api/drivers/me'&&request.method==='POST';
  const operatorReview=request.method==='POST'?path.match(/^\\/api\\/operators\\/([0-9a-f-]{36})\\/drivers\\/([0-9a-f-]{36})\\/review$/i):null;
  if(applying) {
    if(env.WHIP_DRIVER_APPLICATION_SCHEMA_READY!=='true')return json(request,env,{code:'driver_signup_not_ready',
      error:'Driver applications need an approved consent migration before they can be saved.'},503);
    try {
      const user=await auth(request,env),body=await jsonBody(request);
      const allowed=new Set(['tenant_slug','display_name','license_plate','phone','vehicle_make','vehicle_model','vehicle_color','seats','application_consent','consent_version']);
      if(Object.keys(body).some(k=>!allowed.has(k)))throw new TypeError('Driver application contains a restricted field.');
      if(body.application_consent!==true||body.consent_version!=='whip-driver-application-v1')
        throw new TypeError('Read and accept the current Whip Equipped driver application consent.');
      if(body.tenant_slug!=='whip-equipped')throw new TypeError('Unsupported operator.');
      const displayName=validLabel(body.display_name),plate=String(body.license_plate||'').trim().toUpperCase();
      if(plate.length<2||plate.length>16||!/^[A-Z0-9 -]+$/.test(plate))throw new TypeError('Enter your registered license plate.');
      const seats=Number(body.seats||4);
      if(!Number.isInteger(seats)||seats<1||seats>8)throw new TypeError('Enter the number of passenger seats.');
      const existing=await one(env,'drivers?auth_user_id=eq.'+encodeURIComponent(user.id)+'&select=*');
      if(existing)return json(request,env,{driver:existing,approved:false,already_received:true});
      const tenant=await one(env,'tenants?slug=eq.whip-equipped&select=id');
      if(!tenant)throw new Error('Whip Equipped operator is unavailable.');
      const values={tenant_id:tenant.id,auth_user_id:user.id,display_name:displayName,license_plate:plate,
        phone:String(body.phone||'').trim().slice(0,35)||null,vehicle_make:String(body.vehicle_make||'').trim().slice(0,50)||null,
        vehicle_model:String(body.vehicle_model||'').trim().slice(0,50)||null,vehicle_color:String(body.vehicle_color||'').trim().slice(0,35)||null,
        seats,online:false,approval_status:'pending',compliance_verified:false,
        application_consent_at:new Date().toISOString(),application_consent_version:body.consent_version};
      const rows=await rest(env,'drivers?select=*',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(values)});
      return json(request,env,{driver:rows?.[0],approved:false,message:'Application received. A driver may not receive or accept rides until independently screened and approved.'},201);
    }catch(e){return json(request,env,{error:e.status===503?'Driver sign-up is not ready.':e.message},e.status||statusCode(e));}
  }
  if(operatorReview) {
    try{
      const user=await auth(request,env),body=await jsonBody(request);
      const [_,tenantId,driverId]=operatorReview;
      const allowed=new Set(['action','evidence_reference','license_expires_at','insurance_expires_at','screening_expires_at']);
      if(Object.keys(body).some(k=>!allowed.has(k)))throw new TypeError('Restricted driver review field.');
      const membership=await one(env,'operator_members?tenant_id=eq.'+tenantId+'&auth_user_id=eq.'+encodeURIComponent(user.id)+'&role=in.(owner,admin)&select=id');
      if(!membership)return json(request,env,{error:'Whip Equipped operator review requires an owner or admin role.'},403);
      if(!['approved','rejected','suspended'].includes(body.action))throw new TypeError('Invalid review decision.');
      const evidence=String(body.evidence_reference||'').trim();
      if(evidence.length<20||evidence.length>200)throw new TypeError('A documented evidence reference is required.');
      const result=await rest(env,'rpc/whip_review_driver',{method:'POST',body:JSON.stringify({
        p_tenant_id:tenantId,p_driver_id:driverId,p_reviewer_id:user.id,p_action:body.action,p_evidence_reference:evidence,
        p_license_expires_at:body.license_expires_at||null,p_insurance_expires_at:body.insurance_expires_at||null,
        p_screening_expires_at:body.screening_expires_at||null})});
      return json(request,env,{review:result});
    }catch(e){return json(request,env,{error:e.status===503?'Driver review is not ready.':e.message},e.status||statusCode(e));}
  }

  if((guardedRide||quoted||payment||accept||offers||presence||(rideStatus&&!cancelRide))&&!activeBindings(env).live)
    return unavailable(request,env);
  if(cancelRide||!(guardedRide||quoted||payment||accept||offers||presence||rideStatus))return app.fetch(request,env,ctx);
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
    if(offers||presence||accept||(rideStatus&&!cancelRide)) {
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