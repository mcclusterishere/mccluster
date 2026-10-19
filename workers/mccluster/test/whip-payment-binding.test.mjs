/* Whip payment-binding contract: a Stripe event changes only the tenant and
   transaction it is bound to; duplicate deliveries apply once; ride
   transitions are claimed inside the database update; rental money is quoted
   by the server. Synthetic fixtures only; no real Stripe or customer data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { processStripeEvent, rentalQuote } from '../src/whip/worker.js';

const TENANT='22222222-2222-4222-8222-222222222222', OTHER='66666666-6666-4666-8666-666666666666';
const RIDE='33333333-3333-4333-8333-333333333333', RENTAL='77777777-7777-4777-8777-777777777777', USER='11111111-1111-4111-8111-111111111111';
const env={SUPABASE_URL:'https://fixture.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only',ALLOWED_ORIGIN:'https://matthew.mccluster.org',STRIPE_SECRET_KEY:'sk_test_fixture',PUBLIC_APP_URL:'https://matthew.mccluster.org'};
const json=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});
const param=(search,key)=>{const m=search.match(new RegExp('(?:^|[?&])'+key+'=eq\\.([^&]+)'));return m?decodeURIComponent(m[1]):null;};

function ledger(){
  const state={
    tenants:[{id:TENANT,slug:'whip-equipped',name:'Whip Fixture',stripe_account_id:'acct_owner',stripe_charges_enabled:true,white_label_enabled:false,platform_fee_percent:0.03,stripe_subscription_id:null},
             {id:OTHER,slug:'other',name:'Other Operator',stripe_account_id:'acct_other'}],
    rides:[{id:RIDE,tenant_id:TENANT,status:'IN_PROGRESS',driver_id:'drv-1',fare_cents:2500,payment_status:'authorized',stripe_payment_intent_id:'pi_ride',completed_at:null}],
    rentals:[{id:RENTAL,tenant_id:TENANT,total_cents:11770,payment_status:'checkout_created',stripe_checkout_session_id:'cs_rental',stripe_payment_intent_id:null}],
    events:new Map(),payments:[{id:'preexisting-payment',tenant_id:TENANT,resource_type:'rental',resource_id:RENTAL,stripe_checkout_session_id:'cs_rental'}],calls:[],stripe:[],raceAway:false,stripeFails:false,ridePatchThrows:false,existingSessionStatus:'open'
  };
  state.fetch=async(resource,options={})=>{
    const u=new URL(String(resource)),path=u.pathname,method=options.method||'GET',body=options.body&&!String(resource).includes('api.stripe.com')?JSON.parse(options.body):options.body||null;
    state.calls.push({path,query:u.search,method,body,headers:options.headers||{}});
    if(u.hostname==='api.stripe.com'){
      state.stripe.push({path,method,headers:options.headers||{}});
      if(state.stripeFails)return json({error:{message:'stripe down'}},500);
      if(path==='/v1/checkout/sessions'&&method==='POST')
        return json({id:'cs_rental_v1',status:'open',url:'https://checkout.stripe.com/fixture-v1'});
      if(path.startsWith('/v1/checkout/sessions/')&&method==='GET')
        return json({id:path.split('/').at(-1),status:state.existingSessionStatus,url:state.existingSessionStatus==='open'?'https://checkout.stripe.com/existing':null});
      return json({id:'pi_ride',status:'succeeded'});
    }
    if(path==='/auth/v1/user')return json({id:USER,email:'renter@example.invalid'});
    if(path==='/rest/v1/stripe_events'){
      const id=param(u.search,'event_id'),eventType=param(u.search,'event_type');
      if(method==='POST'){
        if(state.events.has(body.event_id))return json({code:'23505',message:'duplicate key value violates unique constraint "stripe_events_pkey"'},409);
        state.events.set(body.event_id,{...body,processed_at:new Date().toISOString()});
        return new Response('',{status:201});
      }
      const saved=state.events.get(id);
      const match=saved&&(!eventType||saved.event_type===eventType);
      if(method==='GET')return json(match?[saved]:[]);
      if(method==='PATCH'){if(match)Object.assign(saved,body);return json(match?[saved]:[]);}
      if(method==='DELETE'){if(match)state.events.delete(id);return new Response('',{status:204});}
    }
    if(path==='/rest/v1/tenants'){const id=param(u.search,'id'),acct=param(u.search,'stripe_account_id');const rows=state.tenants.filter(t=>(!id||t.id===id)&&(!acct||t.stripe_account_id===acct));if(method==='PATCH')rows.forEach(t=>Object.assign(t,body));return json(rows);}
    if(path==='/rest/v1/rides'){const id=param(u.search,'id'),st=param(u.search,'status'),drv=param(u.search,'driver_id');let rows=state.rides.filter(r=>(!id||r.id===id)&&(!st||r.status===st)&&(!drv||r.driver_id===drv));
      if(method==='PATCH'){if(state.ridePatchThrows)return json({message:'rides unavailable'},503);if(state.raceAway)rows=[];rows.forEach(r=>Object.assign(r,body));return json(rows);}return json(rows);}
    if(path==='/rest/v1/rental_bookings'){if(method==='POST'){const row={id:'new-booking',...body};state.rentals.push(row);return json([row],201);}const id=param(u.search,'id');const onlyNull=u.searchParams.get('stripe_checkout_session_id')==='is.null';const rows=state.rentals.filter(r=>r.id===id&&(!onlyNull||r.stripe_checkout_session_id==null));if(method==='PATCH')rows.forEach(r=>Object.assign(r,body));return json(rows);}
    if(path==='/rest/v1/rental_vehicles')return json([{id:'fixture-car',tenant_id:TENANT,daily_rate_cents:5000,location_label:'Lot A',available:true}]);
    if(path==='/rest/v1/payments'){
      if(method==='POST'){const row={id:'payment-'+(state.payments.length+1),...body};state.payments.push(row);return json([row],201);}
      const tenant=param(u.search,'tenant_id'),session=param(u.search,'stripe_checkout_session_id'),resource=param(u.search,'resource_id');
      return json(state.payments.filter(p=>(!tenant||p.tenant_id===tenant)&&(!session||p.stripe_checkout_session_id===session)&&(!resource||p.resource_id===resource)));
    }
    throw Error('Unexpected fixture request: '+method+' '+u.href);
  };
  return state;
}
async function withLedger(state,fn){const original=globalThis.fetch;globalThis.fetch=state.fetch;try{return await fn(state)}finally{globalThis.fetch=original}}
const req=(path,method,body)=>new Request('https://api.mccluster.org'+path,{method,headers:{authorization:'Bearer fixture-session','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const rideEvent=(id,object={},account='acct_owner')=>({id,type:'payment_intent.amount_capturable_updated',account,data:{object:{id:'pi_ride',amount:2500,currency:'usd',metadata:{kind:'ride',tenant_id:TENANT,resource_id:RIDE},...object}}});
const ridePatches=state=>state.calls.filter(c=>c.path==='/rest/v1/rides'&&c.method==='PATCH');

test('a bound ride authorization applies once and scopes the payments update to the tenant',{concurrency:false},async()=>{
  await withLedger(ledger(),async state=>{
    const result=await processStripeEvent(env,rideEvent('evt_ok'));
    assert.equal(result.applied,'payment_intent.amount_capturable_updated');
    assert.equal(state.rides[0].payment_status,'authorized');
    const payments=state.calls.find(c=>c.path==='/rest/v1/payments'&&c.method==='PATCH');
    assert.match(payments.query,new RegExp('tenant_id=eq\\.'+TENANT));
    assert.match(payments.query,/stripe_payment_intent_id=eq\.pi_ride/);
    const again=await processStripeEvent(env,rideEvent('evt_ok'));
    assert.deepEqual(again,{duplicate:true});
    assert.equal(ridePatches(state).length,1,'a redelivered event is never applied twice');
  });
});

test('concurrent duplicate deliveries never acknowledge unfinished work',{concurrency:false},async()=>{
  await withLedger(ledger(),async state=>{
    const results=await Promise.allSettled([processStripeEvent(env,rideEvent('evt_race')),processStripeEvent(env,rideEvent('evt_race'))]);
    assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.applied).length,1);
    assert.ok(results.every(r=>r.status==='fulfilled'||r.reason?.status===503),'unfinished duplicates ask Stripe to retry');
    assert.equal(ridePatches(state).length,1);
    assert.equal(state.events.get('evt_race').event_type,'payment_intent.amount_capturable_updated');
  });
});

test('an event is applied only to the tenant, intent and amount it is bound to',{concurrency:false},async()=>{
  const cases=[
    ['connected account of another operator',rideEvent('e1',{},'acct_other'),'account_mismatch'],
    ['platform event without a connected account',rideEvent('e2',{},null),'account_mismatch'],
    ['metadata naming another tenant',rideEvent('e3',{metadata:{kind:'ride',tenant_id:OTHER,resource_id:RIDE}}),'tenant_mismatch'],
    ['a different PaymentIntent than the ride stored',rideEvent('e4',{id:'pi_forged'}),'payment_intent_mismatch'],
    ['an amount that is not the fare',rideEvent('e5',{amount:100}),'amount_mismatch'],
    ['a currency that is not the ledger currency',rideEvent('e6',{currency:'eur'}),'amount_mismatch'],
    ['an unknown ride',rideEvent('e7',{metadata:{kind:'ride',tenant_id:TENANT,resource_id:'nope'}}),'ride_not_found']
  ];
  for(const [name,event,reason] of cases){
    await withLedger(ledger(),async state=>{
      const result=await processStripeEvent(env,event);
      assert.deepEqual(result,{duplicate:false,ignored:true,reason},name);
      assert.equal(ridePatches(state).length,0,name+': nothing changed');
      assert.equal(state.calls.filter(c=>c.path==='/rest/v1/payments'&&c.method==='PATCH').length,0,name+': no payment row changed');
      assert.ok(state.events.has(event.id),name+': the event is claimed so Stripe stops retrying it');
    });
  }
});

test('a failed application releases the claim so Stripe can redeliver',{concurrency:false},async()=>{
  await withLedger(ledger(),async state=>{
    state.ridePatchThrows=true;
    await assert.rejects(processStripeEvent(env,rideEvent('evt_fail')));
    assert.equal(state.events.has('evt_fail'),false);
    state.ridePatchThrows=false;
    assert.equal((await processStripeEvent(env,rideEvent('evt_fail'))).applied,'payment_intent.amount_capturable_updated');
  });
});

test('rental checkout sessions bind to the booking total and stored session; platform subscriptions never apply from a connected account',{concurrency:false},async()=>{
  const session=(id,object={},account='acct_owner')=>({id,type:'checkout.session.completed',account,data:{object:{id:'cs_rental',amount_total:11770,currency:'usd',payment_status:'paid',payment_intent:'pi_rental',metadata:{kind:'rental',tenant_id:TENANT,resource_id:RENTAL},...object}}});
  await withLedger(ledger(),async state=>{
    assert.equal((await processStripeEvent(env,session('s1'))).applied,'checkout.session.completed');
    assert.equal(state.rentals[0].payment_status,'paid');
    assert.deepEqual(await processStripeEvent(env,session('s2',{amount_total:1})),{duplicate:false,ignored:true,reason:'amount_mismatch'});
    assert.deepEqual(await processStripeEvent(env,session('s3',{id:'cs_other'})),{duplicate:false,ignored:true,reason:'session_mismatch'});
    assert.deepEqual(await processStripeEvent(env,session('s4',{},'acct_other')),{duplicate:false,ignored:true,reason:'account_mismatch'});
    const sub={id:'s5',type:'customer.subscription.updated',account:'acct_owner',data:{object:{id:'sub_1',status:'active',metadata:{tenant_id:TENANT}}}};
    assert.deepEqual(await processStripeEvent(env,sub),{duplicate:false,ignored:true,reason:'account_mismatch'});
    assert.equal(state.tenants[0].white_label_enabled,false);
  });
});

test('completing a ride claims the transition in the database and captures with an idempotency key',{concurrency:false},async()=>{
  await withLedger(ledger(),async state=>{
    const res=await worker.fetch(req('/api/rides/'+RIDE+'/status','PATCH',{status:'COMPLETED',driver_id:'drv-1'}),env);
    assert.equal(res.status,200,await res.text());
    const claim=ridePatches(state)[0];
    assert.match(claim.query,/status=eq\.IN_PROGRESS/,'the update requires the status this request read');
    assert.match(claim.query,/driver_id=eq\.drv-1/);
    assert.equal(claim.body.status,'COMPLETED');
    const capture=state.stripe.find(c=>/\/capture$/.test(c.path));
    assert.ok(capture,'the authorization is captured');
    assert.equal(capture.headers['Idempotency-Key'],'whip-ride-'+RIDE+'-capture');
    assert.equal(capture.headers['Stripe-Account'],'acct_owner');
  });
});

test('a concurrent transition loses cleanly: 409 and no money moves',{concurrency:false},async()=>{
  await withLedger(ledger(),async state=>{
    state.raceAway=true;
    const res=await worker.fetch(req('/api/rides/'+RIDE+'/status','PATCH',{status:'CANCELED'}),env);
    assert.equal(res.status,409);
    assert.equal(state.stripe.length,0);
  });
});

test('a failed capture gives the ride back its previous status',{concurrency:false},async()=>{
  await withLedger(ledger(),async state=>{
    state.stripeFails=true;
    const res=await worker.fetch(req('/api/rides/'+RIDE+'/status','PATCH',{status:'COMPLETED'}),env);
    assert.equal(res.status,502);
    const patches=ridePatches(state);
    assert.equal(patches.length,2);
    assert.match(patches[1].query,/status=eq\.COMPLETED/);
    assert.equal(patches[1].body.status,'IN_PROGRESS');
    assert.equal(state.rides[0].status,'IN_PROGRESS');
  });
});

test('rental bookings are priced by the server from dates, rate and catalogue; browser amounts are ignored',{concurrency:false},async()=>{
  await withLedger(ledger(),async state=>{
    const body={tenant_slug:'whip-equipped',vehicle_id:'fixture-car',start_at:'2026-11-01T10:00:00Z',end_at:'2026-11-03T18:00:00Z',extras:['refuel','refuel'],protection_plan:'standard',rental_days:99,extras_cents:1,protection_cents:1,tax_cents:1,total_cents:1};
    const res=await worker.fetch(req('/api/rentals/bookings','POST',body),env);
    const text=await res.text(); assert.equal(res.status,201,text);
    const {booking}=JSON.parse(text);
    assert.equal(booking.rental_days,3,'2 days 8 hours is three rental days');
    assert.equal(booking.daily_rate_cents,5000);
    assert.equal(booking.extras_cents,5500,'duplicate extras count once');
    assert.equal(booking.protection_cents,2700,'standard plan is per day');
    assert.equal(booking.tax_cents,Math.round((15000+5500+2700)*0.07));
    assert.equal(booking.total_cents,15000+5500+2700+booking.tax_cents);
    assert.equal(booking.platform_fee_cents,Math.round(booking.total_cents*0.03));
    const bad=await worker.fetch(req('/api/rentals/bookings','POST',{...body,extras:['jetpack']}),env);
    assert.equal(bad.status,400);
    const backwards=await worker.fetch(req('/api/rentals/bookings','POST',{...body,end_at:'2026-10-31T00:00:00Z'}),env);
    assert.equal(backwards.status,400);
    const plan=await worker.fetch(req('/api/rentals/bookings','POST',{...body,protection_plan:'platinum'}),env);
    assert.equal(plan.status,400);
    assert.equal(state.calls.filter(c=>c.path==='/rest/v1/rental_bookings'&&c.method==='POST').length,1);
  });
  assert.equal(rentalQuote({daily_rate_cents:1000},{white_label_enabled:true},{start_at:'2026-01-01T00:00:00Z',end_at:'2026-01-01T06:00:00Z',protection_plan:'none'}).total_cents,1070);
  assert.equal(rentalQuote({daily_rate_cents:0},{},{start_at:'2026-01-01T00:00:00Z',end_at:'2026-01-02T00:00:00Z'}).error,'Vehicle has no daily rate');
});

test('pending webhook claims return retryable 503, and crashed stale claims can be recovered',{concurrency:false},async()=>{
  await withLedger(ledger(),async state=>{
    const type='payment_intent.amount_capturable_updated';
    state.events.set('evt_pending',{event_type:'processing:'+Date.now()+':'+type});
    await assert.rejects(processStripeEvent(env,rideEvent('evt_pending')),e=>e.status===503);
    assert.equal(ridePatches(state).length,0,'a pending duplicate never applies concurrently');
    state.events.set('evt_crash',{event_type:'processing:'+(Date.now()-20*60_000)+':'+type});
    const recovered=await processStripeEvent(env,rideEvent('evt_crash'));
    assert.equal(recovered.applied,type);
    assert.equal(state.events.get('evt_crash').event_type,type,'completion records real Stripe type');
    assert.equal(state.events.get('evt_crash').processed_at!=null,true);
  });
});

test('recorded rental Checkout Session is reused, never replaced or charged again',{concurrency:false},async()=>{
  await withLedger(ledger(),async state=>{
    let res=await worker.fetch(req('/api/rentals/bookings/'+RENTAL+'/checkout','POST',{}),env);
    const first=await res.json();
    assert.equal(res.status,200,JSON.stringify(first));
    assert.equal(first?.session_id,'cs_rental');
    assert.equal(first?.reused,true);
    assert.equal(state.stripe.filter(x=>x.path==='/v1/checkout/sessions'&&x.method==='POST').length,0);
    state.existingSessionStatus='complete';
    res=await worker.fetch(req('/api/rentals/bookings/'+RENTAL+'/checkout','POST',{}),env);
    assert.equal(res.status,409,'a completed session is never silently replaced');
    state.existingSessionStatus='expired';
    res=await worker.fetch(req('/api/rentals/bookings/'+RENTAL+'/checkout','POST',{}),env);
    assert.equal(res.status,409,'an expired session requires a new booking');
  });
});

test('concurrent initial checkout requests share one Stripe session and one booking claim',{concurrency:false},async()=>{
  await withLedger(ledger(),async state=>{
    state.rentals[0].stripe_checkout_session_id=null;state.rentals[0].payment_status='unpaid';state.payments=[];
    const responses=await Promise.all([
      worker.fetch(req('/api/rentals/bookings/'+RENTAL+'/checkout','POST',{}),env),
      worker.fetch(req('/api/rentals/bookings/'+RENTAL+'/checkout','POST',{}),env)
    ]);
    const payloads=await Promise.all(responses.map(async r=>({status:r.status,body:await r.json()})));
    assert.equal(payloads.filter(r=>r.status===200).length,1,'one request wins registration');
    assert.equal(payloads.filter(r=>r.status===503).length,1,'the loser may not expose a checkout URL before the ledger exists');
    const retry=await worker.fetch(req('/api/rentals/bookings/'+RENTAL+'/checkout','POST',{}),env);
    assert.equal(retry.status,200,'the retry reuses the fully registered checkout');
    assert.equal((await retry.json()).session_id,'cs_rental_v1');
    const creations=state.stripe.filter(x=>x.path==='/v1/checkout/sessions'&&x.method==='POST');
    assert.equal(creations.length,2,'two requests reach Stripe but share one idempotency key');
    assert.ok(creations.every(c=>c.headers['Idempotency-Key']==='whip-rental-'+RENTAL+'-checkout-v1'));
    assert.equal(state.payments.length,1,'only the booking CAS winner records a payment');
    assert.equal(state.rentals[0].stripe_checkout_session_id,'cs_rental_v1');
  });
});

test('rental quote uses local calendar days across daylight saving changes',{concurrency:false},()=>{
  const vehicle={daily_rate_cents:5000};
  const tenant={white_label_enabled:false,platform_fee_percent:0.03};
  const fall=rentalQuote(vehicle,tenant,{
    start_at:'2026-10-31T10:00:00-04:00',end_at:'2026-11-02T10:00:00-05:00',
    time_zone:'America/New_York',protection_plan:'none'
  });
  assert.equal(fall.days,2,'two local days spanning 49 elapsed hours must cost two days');
  const late=rentalQuote(vehicle,tenant,{
    start_at:'2026-11-05T10:00:00-05:00',end_at:'2026-11-06T11:00:00-05:00',
    time_zone:'America/New_York',protection_plan:'none'
  });
  assert.equal(late.days,2,'a genuinely late return is a second billable day');
});

test('a stored session with no accounting row is never returned for payment',{concurrency:false},async()=>{
  await withLedger(ledger(),async state=>{
    state.payments=[];
    const res=await worker.fetch(req('/api/rentals/bookings/'+RENTAL+'/checkout','POST',{}),env);
    assert.equal(res.status,503);
    assert.equal(state.stripe.filter(x=>x.path==='/v1/checkout/sessions'&&x.method==='POST').length,0);
  });
});
