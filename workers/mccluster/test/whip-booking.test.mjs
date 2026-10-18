/* Whip booking trust boundary; all auth, provider and database calls are
 * isolated fixtures. Never contacts production or creates a real booking. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createManualPaymentIntent } from '../src/whip/stripe.js';
import { bookingReadiness, bookingLocations, calculateFare, signQuote, verifyQuote, bookingSettings } from '../src/whip/booking-core.js';
import { createWhipBookingGate } from '../src/whip/booking-gate.js';
globalThis.crypto ||= webcrypto;

const RIDER='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const TENANT='33333333-3333-4333-8333-333333333333';
const DRIVER='44444444-4444-4444-8444-444444444444';
const RIDE='55555555-5555-4555-8555-555555555555';
const REQUEST='66666666-6666-4666-8666-666666666666';
const QUOTE='77777777-7777-4777-8777-777777777777';
const NOW=Date.parse('2026-10-18T19:00:00Z');
const ORIGIN=[-72.929,41.308],DESTINATION=[-72.925,41.299];
const route={origin:ORIGIN,destination:DESTINATION,mode:'drive',distanceMeters:1609.344,durationSeconds:600,
  geometry:[ORIGIN,[-72.927,41.305],DESTINATION],provider:'TomTom',traffic:true};
const env=()=>({
  SUPABASE_URL:'https://fixture.supabase.invalid',
  SUPABASE_SERVICE_ROLE_KEY:'server-only-fixture',
  TRAVEL_ROUTING_PROVIDER:'tomtom',TRAVEL_TOMTOM_API_KEY:'fixture-tomtom',
  WHIP_FARE_BASE_CENTS:'250',WHIP_FARE_PER_MILE_CENTS:'160',
  WHIP_FARE_PER_MINUTE_CENTS:'35',WHIP_FARE_BOOKING_CENTS:'100',
  WHIP_FARE_MIN_CENTS:'900',WHIP_FARE_TAX_BPS:'0',WHIP_FARES_APPROVED:'true',
  WHIP_BOOKING_QUOTE_SECRET:'fixture-one-hundred-percent-secret-not-for-production',
  WHIP_RIDES_LIVE:'true',WHIP_LAUNCH_APPROVED:'true',
  WHIP_BOOKING_DATABASE_READY:'true',
  STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture',
  STRIPE_PUBLISHABLE_KEY:'pk_test_fixture',ALLOW_DEMO_IDENTITIES:'false'
});
const trip=()=>({origin:ORIGIN,destination:DESTINATION,
  pickup_label:'New Haven Green',dropoff_label:'Union Station',tenant_slug:'whip-equipped',tier:'standard'});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const request=(path,method='POST',body={},actor=RIDER)=>new Request('https://api.mccluster.org'+path,{
  method,headers:{'content-type':'application/json',authorization:'Bearer '+actor},
  body:['GET','HEAD'].includes(method)?undefined:JSON.stringify(body)
});
function fixture({user=RIDER,clearance='approved',reused=false}={}){
  const calls=[],delegated=[],routes=[];
  const api=async(url,options={})=>{
    const loc=new URL(url);
    calls.push({path:loc.pathname,search:loc.search,method:options.method||'GET',
      body:options.body?JSON.parse(options.body):null});
    if(loc.pathname==='/auth/v1/user')return json({id:user});
    if(loc.pathname==='/rest/v1/tenants')return json([{id:TENANT,slug:'whip-equipped',
      name:'Whip Equipped LLC',white_label_enabled:false,platform_fee_percent:0.03,
      stripe_charges_enabled:true,stripe_payouts_enabled:true,stripe_details_submitted:true}]);
    if(loc.pathname==='/rest/v1/drivers')return json([{id:DRIVER,tenant_id:TENANT,online:true}]);
    if(loc.pathname==='/rest/v1/whip_driver_clearances')return json([{
      driver_id:DRIVER,tenant_id:TENANT,approval_status:clearance,approved_at:new Date(NOW-2000).toISOString(),
      identity_checked_at:new Date(NOW-2000).toISOString(),background_checked_at:new Date(NOW-2000).toISOString(),
      local_authority_checked_at:new Date(NOW-2000).toISOString(),
      insurance_expires_at:new Date(NOW+86400000).toISOString(),license_expires_at:new Date(NOW+86400000).toISOString(),
      revoked_at:null
    }]);
    if(loc.pathname==='/rest/v1/whip_booking_idempotency')return json([]);
    if(loc.pathname==='/rest/v1/rpc/whip_reserve_booking_v1')return json({ride:{
      id:RIDE,rider_id:RIDER,tenant_id:TENANT,status:'REQUESTED',payment_status:'unpaid',
      fare_cents:options.body?JSON.parse(options.body).p_fare_cents:null
    },reused});
    throw Error('Unexpected backend fixture request: '+loc.pathname);
  };
  const next={fetch:async r=>{delegated.push({path:new URL(r.url).pathname,method:r.method});return json({ok:true})}};
  const gate=createWhipBookingGate(next,{fetch:api,route:async p=>{routes.push(p);return route},
    now:()=>NOW,randomId:()=>QUOTE});
  return {api,gate,calls,routes,delegated};
}
const signedQuote=async()=>signQuote({
  v:1,quote_id:QUOTE,sub:RIDER,tenant_id:TENANT,
  origin:ORIGIN,destination:DESTINATION,pickup_label:'New Haven Green',
  dropoff_label:'Union Station',tier:'standard',fare_cents:900,platform_fee_cents:27,
  miles:1,minutes:10,iat:NOW,exp:NOW+120000
},env());

test('pricing requires all operator-reviewed numerical fields and refuses fabricated totals',()=>{
  assert.equal(bookingSettings(env()).taxBps,0);
  assert.deepEqual(calculateFare(route,env(),0.03),{
    fare_cents:900,platform_fee_cents:27,miles:1,minutes:10,
    breakdown:{base_cents:250,distance_cents:160,time_cents:350,
      booking_cents:100,minimum_adjustment_cents:40,tax_cents:0}
  });
  assert.throws(()=>calculateFare({...route,distanceMeters:Infinity},env(),0.03));
  assert.throws(()=>calculateFare(route,{...env(),WHIP_FARE_BASE_CENTS:'NaN'},0.03));
  assert.throws(()=>bookingLocations({...trip(),origin:[-72.929,99]}));
  assert.throws(()=>bookingLocations({...trip(),tier:'executive'}));
});
test('quote signature binds rider, fare, route, quote expiry and cannot be edited or replayed by another account',async()=>{
  const token=await signedQuote();
  const payload=await verifyQuote(token,env(),RIDER,NOW);
  assert.equal(payload.fare_cents,900);
  await assert.rejects(()=>verifyQuote(token,env(),OTHER,NOW),/expired|different rider/i);
  await assert.rejects(()=>verifyQuote(token,env(),RIDER,NOW+120001),/expired/i);
  const [a,b]=token.split('.');
  const forged=a.slice(0,-2)+'aa'+'.'+b;
  await assert.rejects(()=>verifyQuote(forged,env(),RIDER,NOW));
  const altered=await signQuote({...payload,fare_cents:0},env());
  await assert.rejects(()=>verifyQuote(altered,env(),RIDER,NOW),/expired|different rider/i);
});
test('launch is closed without commercial routing, signed quotes, payment, approvals, or demo-safe auth',()=>{
  assert.equal(bookingReadiness(env()).live,true);
  for(const patch of [
    {TRAVEL_ROUTING_PROVIDER:'fossgis-pilot'},
    {WHIP_RIDES_LIVE:'false'}, {WHIP_LAUNCH_APPROVED:'false'},
    {WHIP_BOOKING_DATABASE_READY:'false'}, {WHIP_FARES_APPROVED:'false'},
    {STRIPE_WEBHOOK_SECRET:''},{WHIP_BOOKING_QUOTE_SECRET:''},
    {ALLOW_DEMO_IDENTITIES:'true'}
  ])assert.equal(bookingReadiness({...env(),...patch}).live,false,JSON.stringify(patch));
});
test('no production config: service status is honest, old unsigned fares cannot create bookings, and offers are closed',async()=>{
  const fixtureEnv={...env(),WHIP_RIDES_LIVE:'false'},f=fixture();
  const status=await f.gate.fetch(new Request('https://api.mccluster.org/api/service-status'),fixtureEnv);
  assert.equal((await status.json()).rides_live,false);
  const forged=await f.gate.fetch(request('/api/rides','POST',{fare_cents:1,pickup_label:'A',dropoff_label:'B'}),fixtureEnv);
  assert.equal(forged.status,428);
  const offers=await f.gate.fetch(new Request('https://api.mccluster.org/api/offers'),fixtureEnv);
  assert.deepEqual(await offers.json(),{offers:[],service_live:false});
  const presence=await f.gate.fetch(request('/api/drivers/'+DRIVER+'/presence','PATCH',{online:true}),fixtureEnv);
  assert.equal(presence.status,503);
  assert.equal(f.calls.filter(c=>c.path.endsWith('/rpc/whip_reserve_booking_v1')).length,0);
  assert.equal(f.delegated.length,0);
});
test('quote requires a commercial route provider and never guesses road distance or arrival',async()=>{
  const f=fixture();
  const disabled=await f.gate.fetch(request('/api/rides/quote','POST',trip()),{...env(),TRAVEL_ROUTING_PROVIDER:'fossgis-pilot'});
  assert.equal(disabled.status,503);assert.equal(f.routes.length,0);
  const quoted=await f.gate.fetch(request('/api/rides/quote','POST',{...trip(),fare_cents:1,miles:1000}),env());
  const payload=await quoted.json();
  assert.equal(quoted.status,200);
  assert.equal(payload.quote.estimate.fare_cents,900);
  assert.equal(payload.quote.route.geometry.length,3);
  assert.equal(payload.quote.tier,'WE Standard');
  assert.equal(f.routes.length,1);
  assert.equal(f.routes[0].mode,'drive');
  assert.equal(f.calls.some(c=>c.path.endsWith('/rides')),false);
});
test('confirmed booking consumes only rider-bound MAC quote and atomic SQL RPC, not browser prices or driver IDs',async()=>{
  const f=fixture(),token=await signedQuote();
  const response=await f.gate.fetch(request('/api/rides','POST',{quote_token:token,request_id:REQUEST}),env());
  assert.equal(response.status,201);
  const body=await response.json();
  assert.equal(body.ride.status,'REQUESTED');
  assert.equal(body.payment_required,true);
  const rpc=f.calls.find(c=>c.path==='/rest/v1/rpc/whip_reserve_booking_v1');
  assert.equal(rpc.body.p_fare_cents,900);
  assert.equal(rpc.body.p_rider_auth_user_id,RIDER);
  assert.equal(rpc.body.p_pickup_lon,ORIGIN[0]);
  assert.equal(f.delegated.length,0);
  const forged=await f.gate.fetch(request('/api/rides','POST',
    {quote_token:token,request_id:REQUEST,fare_cents:1,driver_id:DRIVER}),env());
  assert.equal(forged.status,400);
  assert.equal(f.calls.filter(c=>c.path==='/rest/v1/rpc/whip_reserve_booking_v1').length,1);
});
test('booking rejects another rider and does not call SQL',async()=>{
  const token=await signedQuote(),f=fixture({user:OTHER});
  const res=await f.gate.fetch(request('/api/rides','POST',{quote_token:token,request_id:REQUEST},OTHER),env());
  assert.equal(res.status,409);
  assert.equal(f.calls.filter(c=>c.path.includes('/rpc/')).length,0);
});
test('only manually cleared drivers may go online, see offers and accept a trip',async()=>{
  const f=fixture({clearance:'pending'});
  const on=await f.gate.fetch(request('/api/drivers/'+DRIVER+'/presence','PATCH',{online:true}),env());
  assert.equal(on.status,403);
  const offers=await f.gate.fetch(request('/api/offers','GET'),env());
  assert.equal(offers.status,403);
  const accept=await f.gate.fetch(request('/api/rides/'+RIDE+'/accept','POST',{}),env());
  assert.equal(accept.status,403);
  assert.equal(f.delegated.length,0);
  const cleared=fixture();
  const granted=await cleared.gate.fetch(request('/api/drivers/'+DRIVER+'/presence','PATCH',{online:true}),env());
  assert.equal(granted.status,200);assert.equal(cleared.delegated.length,1);
});
test('old or externally created rides cannot open payment intents',async()=>{
  const f=fixture();
  const res=await f.gate.fetch(request('/api/rides/'+RIDE+'/payment-intent','POST',{}),env());
  assert.equal(res.status,403);assert.equal(f.delegated.length,0);
});

test('driver clearance status is read-only and never inferred from a member\'s self-edited vehicle profile',async()=>{
  const approved=fixture(),pending=fixture({clearance:'pending'});
  const a=await approved.gate.fetch(request('/api/drivers/clearance','GET'),env());
  assert.equal(a.status,200);
  const good=await a.json();
  assert.deepEqual({status:good.approval_status,canDrive:good.can_drive},
    {status:'approved',canDrive:true});
  const p=await pending.gate.fetch(request('/api/drivers/clearance','GET'),env());
  assert.equal(p.status,200);
  assert.equal((await p.json()).can_drive,false);
  assert.equal(pending.delegated.length,0);
});

test('repeated payment intent creation uses one Stripe idempotency identity', {concurrency:false},async()=>{
  const original=globalThis.fetch,requests=[];
  try{
    globalThis.fetch=async(resource,options)=>{
      requests.push({url:String(resource),method:options.method,headers:options.headers,body:options.body});
      return json({id:'pi_fixture',client_secret:'pi_fixture_secret',status:'requires_payment_method'});
    };
    const settings={STRIPE_SECRET_KEY:'sk_test_fixture'};
    const input={kind:'ride',resourceId:RIDE,amountCents:900,applicationFeeCents:27,
      tenantId:TENANT,connectedAccountId:'acct_fixture'};
    await createManualPaymentIntent(settings,input);
    await createManualPaymentIntent(settings,input);
    assert.equal(requests.length,2);
    assert.equal(requests[0].headers['Idempotency-Key'],'whip-ride-'+RIDE);
    assert.equal(requests[1].headers['Idempotency-Key'],requests[0].headers['Idempotency-Key']);
    assert.equal(requests[0].headers['Stripe-Account'],'acct_fixture');
  }finally{globalThis.fetch=original;}
});
test('the rider can recover a saved ride after Stripe redirect without leaking trip data in the return URL',async()=>{
  const ui=await readFile(new URL('../../../js/travel/whip-booking.mjs',import.meta.url),'utf8');
  const backend=await readFile(new URL('../src/whip/worker.js',import.meta.url),'utf8');
  assert.match(ui,/SAVED_RIDE_KEY='mcc\.whip\.ride\.v1'/);
  assert.match(ui,/resumeSavedRide\(\{fromRedirect:true\}\)/);
  assert.match(ui,/request\('\/api\/rides\/'.*?encodeURIComponent\(id\)/);
  assert.match(ui,/return_url:\(\(\)=>\{/);
  assert.match(ui,/url\.searchParams\.set\('we_ride_return','1'\)/);
  assert.doesNotMatch(ui,/return_url:.*ride\.id/);
  assert.match(ui,/clearSavedRide\(\)/);
  assert.match(ui,/weBookCancelRide/);
  assert.match(backend,/retrievePaymentIntent\(env, ride\.stripe_payment_intent_id, t\.stripe_account_id\)/);
  assert.match(backend,/metadata\?\.resource_id !== ride\.id/);
});
