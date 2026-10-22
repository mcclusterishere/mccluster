/* Whip audit regressions (2026-10-20): strict booleans for check-in and driver
   presence, role-bound rental status, server-checked pickup PIN, offers
   projection, nullish platform fee, static service-worker and operator-room
   escaping. Synthetic in-memory PostgREST fixture; never contacts production. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import chain from '../src/whip/identity-gateway.js';
import worker, { rentalQuote, DRIVER_OFFER_FIELDS } from '../src/whip/worker.js';
import { createWhipBookingGate } from '../src/whip/booking-gate.js';

const TENANT='22222222-2222-4222-8222-222222222222';
const RENTER='11111111-1111-4111-8111-111111111111', OPERATOR='88888888-8888-4888-8888-888888888888';
const RIDER='99999999-9999-4999-8999-999999999999', DRIVER_USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DRIVER='44444444-4444-4444-8444-444444444444', RIDE='33333333-3333-4333-8333-333333333333';
const RENTAL='77777777-7777-4777-8777-777777777777';
const USERS={renter:RENTER,operator:OPERATOR,rider:RIDER,driver:DRIVER_USER};
const env={SUPABASE_URL:'https://fixture.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only',ALLOWED_ORIGIN:'https://matthew.mccluster.org',
  WHIP_RIDES_LIVE:'true',WHIP_LAUNCH_APPROVED:'true',ALLOW_DEMO_IDENTITIES:'false'};
const json=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});
const later=new Date(Date.now()+86400000).toISOString(), earlier=new Date(Date.now()-86400000).toISOString();

function db({rental={},ride={},role='dispatcher',renterVerified=true}={}){
  const state={calls:[],tables:{
    rental_bookings:[{id:RENTAL,tenant_id:TENANT,renter_id:RENTER,vehicle_id:'car',status:'CHECKIN_REQUIRED',payment_status:'paid',
      license_verified:false,pretrip_photos_complete:false,pickup_instructions_seen:false,return_photos_complete:false,fuel_return_confirmed:false,...rental}],
    rides:[{id:RIDE,tenant_id:TENANT,rider_id:RIDER,driver_id:DRIVER,status:'DRIVER_ARRIVED',payment_status:'authorized',pickup_pin:'a1b2c3',
      pickup_label:'Green',dropoff_label:'Station',fare_cents:900,platform_fee_cents:27,ride_tier:'WE Standard',rider_name:'Rider',requested_at:earlier,...ride}],
    operator_members:role?[{tenant_id:TENANT,auth_user_id:OPERATOR,role}]:[],
    identity_verifications:[...(renterVerified?[{user_id:RENTER,purpose:'renter',status:'verified',created_at:earlier}]:[]),
      {user_id:DRIVER_USER,purpose:'driver',status:'verified',created_at:earlier}],
    drivers:[{id:DRIVER,tenant_id:TENANT,auth_user_id:DRIVER_USER,online:true,identity_verified:true,display_name:'D',license_plate:'X'}],
    whip_driver_clearances:[{driver_id:DRIVER,tenant_id:TENANT,approval_status:'approved',approved_at:earlier,identity_checked_at:earlier,
      background_checked_at:earlier,local_authority_checked_at:earlier,license_expires_at:later,insurance_expires_at:later,revoked_at:null}],
    tenants:[{id:TENANT,slug:'whip-equipped',name:'Whip Fixture'}],
    rental_vehicles:[{id:'car',tenant_id:TENANT}]
  }};
  const match=(row,key,value)=>{
    if(value.startsWith('eq.'))return String(row[key])===decodeURIComponent(value.slice(3));
    if(value==='is.null')return row[key]==null;
    const list=/^(not\.)?in\.\((.*)\)$/.exec(value);
    if(list){const has=list[2].split(',').includes(String(row[key]));return list[1]?row[key]!=null&&!has:has;}
    throw Error('Unsupported filter '+key+'='+value);
  };
  state.fetch=async(resource,options={})=>{
    const u=new URL(String(resource)),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
    state.calls.push({path:u.pathname,search:u.search,method,body});
    if(u.pathname==='/auth/v1/user'){const who=USERS[String(options.headers?.authorization||'').replace(/^Bearer /,'')];return who?json({id:who,email:who+'@example.invalid'}):json({},401);}
    const table=u.pathname.replace('/rest/v1/','');const rows=state.tables[table];if(!rows)throw Error('Unexpected fixture request '+method+' '+u.href);
    let hits=rows;for(const [k,v] of u.searchParams)if(!['select','order','limit'].includes(k))hits=hits.filter(r=>match(r,k,v));
    if(method==='PATCH')hits.forEach(r=>Object.assign(r,body));
    const select=u.searchParams.get('select');
    return json(select&&select!=='*'?hits.map(r=>Object.fromEntries(select.split(',').filter(f=>f in r).map(f=>[f,r[f]]))):hits);
  };
  return state;
}
async function run(state,fn){const original=globalThis.fetch;globalThis.fetch=state.fetch;try{return await fn(state)}finally{globalThis.fetch=original}}
const req=(path,method,body,who)=>new Request('https://api.mccluster.org'+path,{method,headers:{authorization:'Bearer '+who,'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
const patches=(state,table)=>state.calls.filter(c=>c.path==='/rest/v1/'+table&&c.method==='PATCH');

test('check-in flags must be real booleans: "true", 1 and "yes" cannot skip Stripe Identity',{concurrency:false},async()=>{
  for(const value of ['true',1,'yes']){
    await run(db({renterVerified:false}),async state=>{
      const res=await chain.fetch(req('/api/rentals/bookings/'+RENTAL+'/checkin','PATCH',{license_verified:value},'renter'),env);
      assert.equal(res.status,400,JSON.stringify(value));
      assert.equal(patches(state,'rental_bookings').length,0);
      assert.equal(state.tables.rental_bookings[0].license_verified,false);
    });
  }
  await run(db({renterVerified:false}),async state=>{
    const res=await chain.fetch(req('/api/rentals/bookings/'+RENTAL+'/checkin','PATCH',{license_verified:true},'renter'),env);
    assert.equal(res.status,409,'a real true still requires verification');
    assert.equal(patches(state,'rental_bookings').length,0);
  });
  await run(db(),async state=>{
    const res=await chain.fetch(req('/api/rentals/bookings/'+RENTAL+'/checkin','PATCH',{license_verified:true},'renter'),env);
    assert.equal(res.status,200,await res.clone().text());
    assert.equal(state.tables.rental_bookings[0].license_verified,true);
  });
  await run(db(),async state=>{
    // The core refuses coercion too, even if a future gateway forwards the body untouched.
    const res=await worker.fetch(req('/api/rentals/bookings/'+RENTAL+'/checkin','PATCH',{pretrip_photos_complete:'yes'},'renter'),env);
    assert.equal(res.status,400);
    assert.equal(patches(state,'rental_bookings').length,0);
  });
});

test('driver presence requires a real boolean at every gate and in the core',{concurrency:false},async()=>{
  for(const value of ['true',1,'yes']){
    await run(db(),async state=>{
      const res=await chain.fetch(req('/api/drivers/'+DRIVER+'/presence','PATCH',{online:value},'driver'),env);
      assert.equal(res.status,400);
      const core=await worker.fetch(req('/api/drivers/'+DRIVER+'/presence','PATCH',{online:value},'driver'),env);
      assert.equal(core.status,400);
      assert.equal(patches(state,'drivers').length,0);
    });
  }
  const delegated=[];
  const gate=createWhipBookingGate({fetch:async()=>{delegated.push(1);return json({ok:true})}},{fetch:async()=>json([])});
  for(const live of [env,{...env,WHIP_RIDES_LIVE:'false'}]){
    const res=await gate.fetch(req('/api/drivers/'+DRIVER+'/presence','PATCH',{online:'true'},'driver'),live);
    assert.equal(res.status,400);
  }
  assert.equal(delegated.length,0);
  await run(db(),async state=>{
    const res=await worker.fetch(req('/api/drivers/'+DRIVER+'/presence','PATCH',{online:false},'driver'),env);
    assert.equal(res.status,200);
    assert.equal(state.tables.drivers[0].online,false);
  });
});

test('a renter cannot skip check-in, act as the operator, or complete without the return checks',{concurrency:false},async()=>{
  const status=(who,next,setup)=>run(db({rental:setup}),async state=>{
    const res=await chain.fetch(req('/api/rentals/bookings/'+RENTAL+'/status','PATCH',{status:next},who),env);
    return {status:res.status,booking:state.tables.rental_bookings[0],state};
  });
  let r=await status('renter','READY_FOR_PICKUP',{status:'CHECKIN_REQUIRED'});
  assert.equal(r.status,403,'check-in cannot be skipped by the renter');
  assert.equal(r.booking.status,'CHECKIN_REQUIRED');
  r=await status('renter','COMPLETED',{status:'RETURN_DUE'});
  assert.equal(r.status,403,'return checks are required');
  assert.equal(r.booking.status,'RETURN_DUE');
  r=await status('renter','COMPLETED',{status:'RETURN_DUE',return_photos_complete:true,fuel_return_confirmed:true});
  assert.equal(r.status,200);assert.equal(r.booking.status,'COMPLETED');
  r=await status('renter','CANCELED',{status:'CHECKIN_REQUIRED'});
  assert.equal(r.status,200);
  r=await status('renter','ACTIVE',{status:'READY_FOR_PICKUP'});
  assert.equal(r.status,200,'self-service pickup after check-in and payment');
  r=await status('renter','RETURN_DUE',{status:'ACTIVE'});
  assert.equal(r.status,200);
  r=await status('operator','READY_FOR_PICKUP',{status:'CHECKIN_REQUIRED'});
  assert.equal(r.status,200,'a dispatcher may clear a booking for pickup');
  r=await run(db({role:'finance'}),async state=>{
    const res=await chain.fetch(req('/api/rentals/bookings/'+RENTAL+'/status','PATCH',{status:'READY_FOR_PICKUP'},'operator'),env);
    return {status:res.status,booking:state.tables.rental_bookings[0]};
  });
  assert.equal(r.status,403,'finance may read but not drive the rental');
  assert.equal(r.booking.status,'CHECKIN_REQUIRED');
});

test('pickup requires the booking renter\'s identity, not the caller\'s',{concurrency:false},async()=>{
  await run(db({rental:{status:'READY_FOR_PICKUP'},renterVerified:false}),async state=>{
    // The operator is identity-verified as a renter themselves; that must not stand in for the renter.
    state.tables.identity_verifications.push({user_id:OPERATOR,purpose:'renter',status:'verified',created_at:earlier});
    const res=await chain.fetch(req('/api/rentals/bookings/'+RENTAL+'/status','PATCH',{status:'ACTIVE'},'operator'),env);
    assert.equal(res.status,409);
    assert.equal(state.tables.rental_bookings[0].status,'READY_FOR_PICKUP');
    const lookup=state.calls.filter(c=>c.path==='/rest/v1/identity_verifications');
    assert.ok(lookup.every(c=>c.search.includes('user_id=eq.'+RENTER)));
  });
  await run(db({rental:{status:'READY_FOR_PICKUP'}}),async state=>{
    const res=await chain.fetch(req('/api/rentals/bookings/'+RENTAL+'/status','PATCH',{status:'ACTIVE'},'operator'),env);
    assert.equal(res.status,200);
  });
});

test('drivers never receive the pickup PIN and must submit it to verify the rider',{concurrency:false},async()=>{
  await run(db(),async state=>{
    const driverView=await (await chain.fetch(req('/api/rides/'+RIDE,'GET',undefined,'driver'),env)).json();
    assert.equal(driverView.ride.id,RIDE);
    assert.equal('pickup_pin' in driverView.ride,false);
    const riderView=await (await chain.fetch(req('/api/rides/'+RIDE,'GET',undefined,'rider'),env)).json();
    assert.equal(riderView.ride.pickup_pin,'a1b2c3','the rider still sees their own code');
    const active=await (await chain.fetch(req('/api/drivers/'+DRIVER+'/active','GET',undefined,'driver'),env)).json();
    assert.equal(active.ride.id,RIDE);assert.equal('pickup_pin' in active.ride,false);

    for(const body of [{status:'VERIFIED'},{status:'VERIFIED',pickup_pin:'000000'},{status:'VERIFIED',pickup_pin:123456}]){
      const res=await chain.fetch(req('/api/rides/'+RIDE+'/status','PATCH',body,'driver'),env);
      assert.equal(res.status,403,JSON.stringify(body));
      assert.equal(state.tables.rides[0].status,'DRIVER_ARRIVED');
    }
    const ok=await chain.fetch(req('/api/rides/'+RIDE+'/status','PATCH',{status:'VERIFIED',pickup_pin:' A1B2C3 '},'driver'),env);
    assert.equal(ok.status,200,await ok.clone().text());
    assert.equal(state.tables.rides[0].status,'VERIFIED');
    assert.equal('pickup_pin' in (await ok.json()).ride,false);
  });
  await run(db({ride:{pickup_pin:null}}),async state=>{
    const res=await chain.fetch(req('/api/rides/'+RIDE+'/status','PATCH',{status:'VERIFIED',pickup_pin:''},'driver'),env);
    assert.equal(res.status,403,'a ride without a code cannot be verified');
  });
});

test('offers expose only what the driver app needs: no rider account id or PIN',{concurrency:false},async()=>{
  const fields=DRIVER_OFFER_FIELDS.split(',');
  assert.equal(fields.includes('pickup_pin'),false);assert.equal(fields.includes('rider_id'),false);
  const app=await readFile(new URL('../../../whip/driver/app.js',import.meta.url),'utf8');
  for(const f of new Set([...app.matchAll(/\br\.([a-z_]+)/g)].map(m=>m[1])))assert.ok(fields.includes(f),'offer field used by driver app: '+f);
  await run(db({ride:{status:'REQUESTED',driver_id:null}}),async state=>{
    const res=await chain.fetch(req('/api/offers','GET',undefined,'driver'),env);
    const body=await res.json();
    assert.equal(res.status,200,JSON.stringify(body));
    assert.equal(body.offers.length,1);
    assert.equal('pickup_pin' in body.offers[0],false);assert.equal('rider_id' in body.offers[0],false);
    const q=state.calls.find(c=>c.path==='/rest/v1/rides');
    assert.equal(new URLSearchParams(q.search).get('select'),DRIVER_OFFER_FIELDS);
  });
  await run(db({ride:{status:'REQUESTED',driver_id:null}}),async state=>{
    const res=await worker.fetch(req('/api/offers','GET',undefined,'driver'),env);
    const body=await res.json();
    assert.equal('pickup_pin' in body.offers[0],false);assert.equal('rider_id' in body.offers[0],false);
  });
  await run(db({ride:{status:'REQUESTED',driver_id:null}}),async state=>{
    const res=await chain.fetch(req('/api/rides/'+RIDE+'/accept','POST',{},'driver'),env);
    assert.equal(res.status,200,await res.clone().text());
    assert.equal('pickup_pin' in (await res.json()).ride,false);
  });
});

test('the driver app submits the PIN to the server instead of comparing it locally',async()=>{
  const app=await readFile(new URL('../../../whip/driver/app.js',import.meta.url),'utf8');
  assert.equal(app.includes('pickup_pin||'),false);
  assert.match(app,/setRideStatus\('VERIFIED',\{pickup_pin:pin\}\)/);
  const html=await readFile(new URL('../../../whip/driver/index.html',import.meta.url),'utf8');
  assert.match(html,/id="pinInput"[^>]*maxlength="6"/,'the six-character pickup code fits');
});

test('a configured zero platform fee stays zero',()=>{
  const body={start_at:'2026-01-01T00:00:00Z',end_at:'2026-01-02T00:00:00Z',protection_plan:'none'};
  assert.equal(rentalQuote({daily_rate_cents:1000},{slug:'whip-equipped',platform_fee_percent:0},body).platform_fee_cents,0);
  assert.equal(rentalQuote({daily_rate_cents:1000},{slug:'whip-equipped'},body).platform_fee_cents,Math.round(1070*0.03));
});

test('Whip service workers cache only same-origin static files, never API or authorized responses',async()=>{
  for(const [app,name] of [['driver','we-driver-v2'],['rentals','we-rentals-v2'],['rider','whip-equipped-v4']]){
    const source=await readFile(new URL(`../../../whip/${app}/sw.js`,import.meta.url),'utf8');
    const listeners={},stored=[],deleted=[];
    const cache={addAll:async()=>{},put:async r=>{stored.push(r.url)}};
    const sandbox={URL,Response,Promise,
      self:{location:{origin:'https://matthew.mccluster.org'},addEventListener:(t,f)=>{listeners[t]=f},skipWaiting(){},clients:{claim(){}}},
      caches:{open:async()=>cache,keys:async()=>['we-driver-v1','we-rentals-v1','whip-equipped-v3',name],delete:async k=>{deleted.push(k);return true},match:async()=>undefined},
      fetch:async()=>Object.defineProperty(new Response('{}',{status:200}),'type',{value:'basic'})};
    vm.runInNewContext(source,sandbox);
    let waited;listeners.activate({waitUntil:p=>{waited=p}});await waited;
    assert.deepEqual(deleted.sort(),['we-driver-v1','we-rentals-v1','whip-equipped-v3'].filter(k=>k!==name).sort(),app+': old caches are deleted');
    const handled=[];
    const fire=async(url,init={},extra={})=>{const r=new Request(url,init);const request=new Proxy(r,{get:(t,k)=>k in extra?extra[k]:typeof t[k]==='function'?t[k].bind(t):t[k]});
      let p=null;listeners.fetch({request,respondWith:x=>{p=x}});if(p){handled.push(url);await p;await new Promise(r=>setTimeout(r,0));}};
    await fire('https://api.mccluster.org/api/rentals/bookings/x');
    await fire('https://fixture.supabase.co/rest/v1/rides');
    await fire('https://matthew.mccluster.org/whip/'+app+'/data.json',{headers:{authorization:'Bearer t'}});
    await fire('https://matthew.mccluster.org/whip/'+app+'/?booking_id=secret',{},{mode:'navigate',destination:'document'});
    await fire('https://matthew.mccluster.org/whip/'+app+'/styles.css');
    assert.deepEqual(handled,['https://matthew.mccluster.org/whip/'+app+'/?booking_id=secret','https://matthew.mccluster.org/whip/'+app+'/styles.css'],app);
    assert.deepEqual(stored,['https://matthew.mccluster.org/whip/'+app+'/styles.css'],app+': only the static asset is stored');
  }
});

test('operator room escapes vehicle and activity fields before writing HTML',async()=>{
  const source=await readFile(new URL('../../../whip/rider/operator.js',import.meta.url),'utf8');
  for(const raw of ['${v.name}','${v.category}','${v.location_label}','${v.seats}','${primary}','${secondary||\'\'}','${right}'])
    assert.equal(source.includes(raw),false,'unescaped '+raw);
  const esc=vm.runInNewContext(source.match(/const esc=(.*?\);)/)[1].replace(/;$/,''));
  assert.equal(esc('<img src=x onerror="a">\'&'),'&lt;img src=x onerror=&quot;a&quot;&gt;&#39;&amp;');
});
