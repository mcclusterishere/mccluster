import test from 'node:test';
import assert from 'node:assert/strict';
import {activeBindings,validPoint,quoteFare,commercialRoute,signQuote,verifyQuote,approvedDriver,keyForBooking} from '../src/whip/booking-core.mjs';
import booking from '../src/whip/booking-router.mjs';
const ID='11111111-1111-4111-8111-111111111111',TENANT='22222222-2222-4222-8222-222222222222';
const origin=[-72.92888,41.30806],destination=[-72.92506,41.29886];
const secret='this-is-a-long-enough-32-byte-quote-signing-secret-only-in-fixtures';
const liveEnv={WHIP_RIDES_LIVE:'true',WHIP_LLC_TNC_REGISTRATION_CONFIRMED:'true',
 WHIP_LLC_INSURANCE_CONFIRMED:'true',WHIP_DRIVER_APPROVAL_GATE_ENABLED:'true',
 WHIP_COMMERCIAL_ROUTING_ACTIVE:'true',WHIP_BOOKING_SCHEMA_READY:'true',
 WHIP_TOMTOM_API_KEY:'test-only',WHIP_QUOTE_SIGNING_KEY:secret,
 STRIPE_SECRET_KEY:'test-only',STRIPE_PUBLISHABLE_KEY:'test-only',STRIPE_WEBHOOK_SECRET:'test-only'};
test('new rides, offers, dispatch, card authorization and online presence fail closed by default',async()=>{
 const env={ALLOWED_ORIGINS:'https://matthew.mccluster.org'};
 const cases=[['POST','/api/rides'],['POST','/api/rides/quote'],
   ['POST','/api/rides/'+ID+'/payment-intent'],['POST','/api/rides/'+ID+'/accept'],
   ['GET','/api/offers'],['PATCH','/api/drivers/'+ID+'/presence'],
   ['PATCH','/api/rides/'+ID+'/status']];
 for(const [method,path] of cases) {
   const res=await booking.fetch(new Request('https://api.mccluster.org'+path,{
     method,headers:{origin:'https://matthew.mccluster.org',
      ...(method==='POST'||method==='PATCH'?{'content-type':'application/json'}:{})},
     ...(method==='POST'||method==='PATCH'?{body:'{}'}:{})}),env,{});
   assert.equal(res.status,503,path);
   assert.equal((await res.json()).code,'service_not_live',path);
 }
});
test('service-status is an explicit honest anonymous read without invented availability',async()=>{
 const req=new Request('https://api.mccluster.org/api/service-status',{headers:{origin:'https://matthew.mccluster.org'}});
 const res=await booking.fetch(req,{ALLOWED_ORIGINS:'https://matthew.mccluster.org'},{});
 assert.equal(res.status,200);
 const json=await res.json();
 assert.equal(json.rides_live,false);assert.equal(json.booking_mode,'applications_only');
 assert.equal(res.headers.get('access-control-allow-origin'),'https://matthew.mccluster.org');
});
test('driver creation is blocked before reviewed consent schema',async()=>{
 const res=await booking.fetch(new Request('https://api.mccluster.org/api/drivers/me',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({application_consent:true})}),{},{});
 assert.equal(res.status,503);assert.equal((await res.json()).code,'driver_signup_not_ready');
});
test('activation requires all independent legal, pricing, payment and provider credentials',()=>{
 assert.equal(activeBindings({WHIP_RIDES_LIVE:'true'}).live,false);
 assert.equal(activeBindings(liveEnv).live,true);
 assert.equal(activeBindings({...liveEnv,WHIP_DRIVER_APPROVAL_GATE_ENABLED:'false'}).live,false);
 assert.equal(activeBindings({...liveEnv,STRIPE_WEBHOOK_SECRET:null}).live,false);
});
test('driver can only receive or accept rides after independent approval and unexpired checks',()=>{
 const d={approval_status:'approved',compliance_verified:true,
   license_expires_at:'2030-01-01T00:00:00Z',insurance_expires_at:'2030-01-01T00:00:00Z',
   screening_expires_at:'2030-01-01T00:00:00Z'};
 assert.equal(approvedDriver(d,Date.parse('2026-10-18')),true);
 for(const patch of [{approval_status:'pending'},{compliance_verified:false},
  {insurance_expires_at:'2025-01-01'},{screening_expires_at:null}])
  assert.equal(approvedDriver({...d,...patch},Date.parse('2026-10-18')),false);
});
test('strict coordinate, fare and client idempotency validation',()=>{
 for(const pt of [[null,1],[181,40],[0,Infinity],['-72',40],[0,0,0]])
   assert.throws(()=>validPoint(pt));
 assert.deepEqual(validPoint(origin),origin);
 assert.equal(quoteFare(1609,180,{baseCents:300,mileCents:200,minuteCents:50,minimumCents:1000}),1000);
 assert.throws(()=>quoteFare(1000,100,{baseCents:0,mileCents:0,minuteCents:0,minimumCents:1000}));
 assert.throws(()=>keyForBooking('aaa'));
 assert.equal(keyForBooking('driver-request-123456'),'driver-request-123456');
});
test('commercial routing always uses the fixed provider host, real road metrics, no client URLs',async()=>{
 const data=await commercialRoute(origin,destination,'fake-key',async(url)=>{
   const request=new URL(url);
   assert.equal(request.hostname,'api.tomtom.com');assert.equal(request.searchParams.get('key'),'fake-key');
   assert.equal(request.searchParams.get('travelMode'),'car');
   return new Response(JSON.stringify({routes:[{summary:{lengthInMeters:4012,travelTimeInSeconds:780}}]}),{status:200});
 });
 assert.deepEqual(data,{distanceMeters:4012,durationSeconds:780,provider:'tomtom-commercial'});
 await assert.rejects(commercialRoute(origin,destination,'key',async()=>new Response('{}',{status:429})),/unavailable/);
});
test('signed quote is bound to verified rider, geometry, fare, tenant and expiration',async()=>{
 const expires=Date.parse('2026-10-18T20:00:00Z');
 const p={v:1,sub:ID,tenant:TENANT,tier:'WE Standard',currency:'usd',origin,destination,
   pickupLabel:'New Haven Green',dropoffLabel:'Union Station, New Haven',
   fareCents:1800,platformFeeCents:54,meters:3800,seconds:700,
   expires,nonce:'a1b2c3d4e5f60708'};
 const token=await signQuote(p,secret);
 assert.deepEqual(await verifyQuote(token,secret,ID,expires-90000),p);
 await assert.rejects(verifyQuote(token,secret,'different-user',expires-90000));
 await assert.rejects(verifyQuote(token,secret,ID,expires+1));
 const [left,right]=token.split('.');
 await assert.rejects(verifyQuote(left.slice(0,-2)+'AA.'+right,secret,ID,expires-90000));
});