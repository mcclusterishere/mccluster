import {createAddressSearch,currentPosition} from '../js/travel/address-search.mjs';
// Whip Equipped LLC rider booking. Never fake quotes, vehicles or driver ETAs.
const $=id=>document.getElementById(id);
const apiBase='https://api.mccluster.org';
const search=createAddressSearch();
const state={ready:false,points:{pickup:null,dropoff:null},quote:null,bookingKey:null,ride:null,
  stripe:null,elements:null,payment:null,poll:null};
const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(cents)||0)/100);
const distance=meters=>(meters/1609.344).toFixed(1)+' mi';
const safeText=(node,text)=>{node.textContent=String(text||'');};
const note=text=>safeText($('weMessage'),text);
function show(id,on=true){$(id).hidden=!on;}
function inputsReady(){return !!(state.points.pickup&&state.points.dropoff);}
function resetQuote(){
  state.quote=null;state.bookingKey=null;show('weQuoteCard',false);show('wePayCard',false);
  $('weQuote').disabled=!state.ready||!inputsReady()||!!state.ride;
}
async function call(path,method='GET',body=null,headers={}) {
  if(!window.MCC?.api)throw Error('Sign in with your M Account to continue.');
  const r=await window.MCC.api(path,{method,body,headers});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error(data.error||data.message||'The booking service is unavailable.'),{status:r.status,code:data.code});
  return data;
}
async function status() {
  state.ready=false;$('weQuote').disabled=true;
  try {
    const r=await fetch(apiBase+'/api/service-status',{credentials:'omit',cache:'no-store'});
    const data=await r.json();
    state.ready=!!r.ok&&data.rides_live===true;
    $('weService').dataset.ready=String(state.ready);
    safeText($('weService'),state.ready
      ?'Booking open · Whip Equipped LLC. Final confirmation requires payment authorization and an approved driver.'
      :data.message||'Whip Equipped is accepting driver applications. Passenger rides are not live.');
  }catch{
    $('weService').dataset.ready='false';
    safeText($('weService'),'Ride service status could not be verified. No payment or ride request can be submitted.');
  }
  $('weQuote').disabled=!state.ready||!inputsReady();
}
function bindSearch(inputId,resultsId,key){
  const input=$(inputId),list=$(resultsId);
  let seq=0,controller,timer;
  const close=()=>{seq++;clearTimeout(timer);controller?.abort();list.hidden=true;input.setAttribute('aria-expanded','false');};
  input.addEventListener('input',()=>{
    close();state.points[key]=null;resetQuote();
    const phrase=input.value.trim();if(phrase.length<3)return;
    const current=seq,signal=(controller=new AbortController()).signal;
    timer=setTimeout(async()=>{
      try{
        const rows=await search(phrase,signal);
        if(signal.aborted||current!==seq||phrase!==input.value.trim())return;
        list.replaceChildren();
        for(const row of rows){
          const b=document.createElement('button');
          b.type='button';b.setAttribute('role','option');b.textContent=row.label;
          b.addEventListener('click',()=>{
            close();state.points[key]={label:row.label,coordinates:row.coordinates};
            input.value=row.label;note('');
            resetQuote();
          });
          list.append(b);
        }
        if(!rows.length){
          const small=document.createElement('small');small.textContent='No exact match. Enter a street address or nearby known place.';
          list.append(small);
        }
        list.hidden=false;input.setAttribute('aria-expanded','true');
      }catch(e){if(current===seq&&!signal.aborted)note('Address search is unavailable. Please retry with a specific full address.');}
    },450);
  });
  input.addEventListener('keydown',e=>{
    if(e.key==='Escape'){close();return}
    if(e.key==='ArrowDown'&&!list.hidden){e.preventDefault();list.querySelector('button')?.focus();}
  });
  list.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();close();input.focus();}
  });
  document.addEventListener('pointerdown',e=>{if(!list.contains(e.target)&&e.target!==input)close();});
}
bindSearch('wePickup','wePickupResults','pickup');
bindSearch('weDropoff','weDropoffResults','dropoff');
$('weLocate').addEventListener('click',async()=>{
  try{
    $('weLocate').disabled=true;note('Requesting your current location…');
    const coordinates=await currentPosition();
    state.points.pickup={label:'GPS-selected pickup point (confirm entrance with driver)',coordinates};
    $('wePickup').value=state.points.pickup.label;
    resetQuote();note('Current GPS point selected. Before travel, confirm the safe and legal pickup entrance.');
  }catch(error){note(error.message);}
  finally{$('weLocate').disabled=false;}
});
$('weQuote').addEventListener('click',async()=>{
  if(!state.ready||!inputsReady())return;
  if(!window.MCC?.session?.()?.access_token){note('Sign in with your M Account before requesting an exact price.');return;}
  const btn=$('weQuote');btn.disabled=true;
  try{
    const data=await call('/api/rides/quote','POST',{
      tenant_slug:'whip-equipped',mode:'drive',
      origin:state.points.pickup.coordinates,destination:state.points.dropoff.coordinates,
      pickup_label:state.points.pickup.label,dropoff_label:state.points.dropoff.label
    });
    if(!data.quote_token||!data.quote?.fare_cents)throw Error('The operator did not return a usable quote.');
    state.quote=data;state.bookingKey=null;
    safeText($('weFare'),money(data.quote.fare_cents));
    safeText($('weDistance'),distance(data.quote.distance_meters)+' · '+Math.max(1,Math.round(data.quote.duration_seconds/60))+' min estimate');
    safeText($('weQuoteExpiry'),'Price expires at '+new Date(data.quote.expires_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})+'. No ride is reserved yet.');
    show('weQuoteCard');note('Server-verified fare ready. Nothing has been charged.');
  }catch(e){note(e.message);show('weQuoteCard',false);}
  finally{btn.disabled=!state.ready||!inputsReady();}
});
function loadStripe(){
  if(window.Stripe)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='https://js.stripe.com/v3/';
    script.onload=resolve;script.onerror=()=>reject(Error('The secure payment form could not load.'));document.head.append(script);
  });
}
async function cancelRequest(){
  if(!state.ride)return;
  await call('/api/rides/'+encodeURIComponent(state.ride.id)+'/status','PATCH',{status:'CANCELED'});
  stopPolling();safeText($('weRideStatus'),'Request canceled.');
  safeText($('weRideDetails'),'No vehicle is assigned through this request.');
  show('wePayCard',false);show('weCancelRide',false);
}
$('weConfirm').addEventListener('click',async()=>{
  if(!state.ready||!state.quote||state.ride)return;
  const btn=$('weConfirm');btn.disabled=true;note('Preparing a secure request…');
  try{
    const expiry=Date.parse(state.quote.quote.expires_at);
    if(!Number.isFinite(expiry)||expiry<=Date.now())throw Error('Fare expired. Request a new quote before booking.');
    if(!state.bookingKey)state.bookingKey=crypto.randomUUID().replace(/-/g,'');
    const submission=await call('/api/rides','POST',{quote_token:state.quote.quote_token},
      {'idempotency-key':state.bookingKey});
    if(!submission.ride?.id)throw Error('The request was not persisted.');
    state.ride=submission.ride;
    safeText($('weRideStatus'),'Awaiting card authorization');
    show('weRideCard');
    const payment=await call('/api/rides/'+encodeURIComponent(state.ride.id)+'/payment-intent','POST',{});
    if(!payment.client_secret||!payment.publishable_key||!payment.connected_account_id)
      throw Error('The secure card authorization could not be prepared.');
    await loadStripe();
    state.stripe=window.Stripe(payment.publishable_key,{stripeAccount:payment.connected_account_id});
    state.elements=state.stripe.elements({clientSecret:payment.client_secret,appearance:{theme:'night'}});
    state.payment=state.elements.create('payment');state.payment.mount('#wePaymentElement');
    show('wePayCard');show('weQuoteCard',false);note('');
  }catch(e){
    note(e.message+' Your payment has not been confirmed. Review any existing request before trying again.');
  }finally{btn.disabled=false;}
});
$('wePay').addEventListener('click',async()=>{
  if(!state.payment||!state.ride)return;
  const btn=$('wePay');btn.disabled=true;
  safeText($('wePaymentNotice'),'Authorizing payment with Stripe…');
  try{
    const result=await state.stripe.confirmPayment({elements:state.elements,redirect:'if_required'});
    if(result.error)throw new Error(result.error.message||'Payment authorization failed.');
    const payment=result.paymentIntent;
    if(!['requires_capture','processing','succeeded'].includes(payment?.status))
      throw new Error('Payment is not authorized. Current status: '+String(payment?.status||'unknown'));
    show('wePayCard',false);
    safeText($('weRideStatus'),'Card authorization submitted. Waiting for an available, approved driver.');
    safeText($('weRideDetails'),'Your request remains pending until Whip Equipped verifies payment and a driver accepts.');
    startPolling();
  }catch(e){safeText($('wePaymentNotice'),e.message);}
  finally{btn.disabled=false;}
});
$('weCancelPayment').onclick=async()=>{try{await cancelRequest();}catch(e){note(e.message);}};
$('weCancelRide').onclick=async()=>{try{await cancelRequest();}catch(e){note(e.message);}};
function renderRide(ride){
  state.ride=ride;
  const payment=String(ride.payment_status||'');
  const accepted=['ACCEPTED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','VERIFIED','IN_PROGRESS','COMPLETED'].includes(ride.status);
  const paid=['authorized','paid'].includes(payment);
  if(accepted&&paid&&ride.driver_id){
    safeText($('weRideStatus'),'Driver confirmed · '+String(ride.driver_name||'Whip Equipped driver'));
    safeText($('weRideDetails'),[ride.driver_vehicle,ride.driver_plate,ride.driver_rating?'Rating '+ride.driver_rating:''].filter(Boolean).join(' · '));
    safeText($('weRideCaution'),'You have a confirmed driver assignment. Verify the vehicle and driver before entering. Keep the app open for status updates.');
  }else if(ride.status==='REQUESTED'){
    safeText($('weRideStatus'),paid?'Awaiting an approved driver':'Waiting for payment authorization');
    safeText($('weRideDetails'),paid?'Your request is open for verified Whip Equipped drivers. No vehicle has accepted yet.':'Payment is not yet authorized; no driver is being dispatched.');
  }else if(ride.status==='CANCELED'){
    safeText($('weRideStatus'),'Request canceled');stopPolling();$('weCancelRide').hidden=true;
  }else if(ride.status==='COMPLETED'){safeText($('weRideStatus'),'Ride completed');stopPolling();$('weCancelRide').hidden=true;}
}
function startPolling(){
  stopPolling();
  const next=async()=>{
    if(!state.ride)return;
    try{const data=await call('/api/rides/'+encodeURIComponent(state.ride.id));if(data.ride)renderRide(data.ride);}
    catch(e){note('Ride status could not be updated. Your request is not newly confirmed.');}
  };
  void next();state.poll=setInterval(next,6500);
}
function stopPolling(){if(state.poll!==null){clearInterval(state.poll);state.poll=null;}}
window.addEventListener('pagehide',stopPolling);
window.addEventListener('mcc:auth-changed',()=>{stopPolling();state.quote=null;state.ride=null;location.reload();});
void status();
