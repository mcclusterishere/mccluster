/* Whip Equipped booking sheet for the World travel planner.
 * Trips are quoted/created ONLY through the Whip server. This module never
 * synthesizes a price, a driver, a journey line, or a booking confirmation. */
export function attachWhipBooking({ panel, currentTrip, accountApi }) {
  if (!panel || typeof currentTrip !== 'function' || typeof accountApi !== 'function') return null;
  const button = document.createElement('button');
  button.type = 'button'; button.id = 'wtBookWhip'; button.textContent = 'Book inside Whip Equipped';
  panel.querySelector('#wtRideDirections')?.before(button);
  const dialog = document.createElement('dialog');
  dialog.id = 'wtWhipDialog'; dialog.className = 'we-book-dialog';
  dialog.setAttribute('aria-labelledby', 'wtWhipTitle');
  dialog.innerHTML = `
    <div class="we-book-head"><div><p class="we-book-kicker">WHIP EQUIPPED LLC</p>
      <h2 id="wtWhipTitle">Book your ride</h2></div>
      <button id="weBookClose" type="button" aria-label="Close Whip booking">×</button></div>
    <p id="weBookJourney"></p>
    <p id="weBookNotice">Get a verified street quote before requesting a driver. No ride is booked by opening this panel.</p>
    <p id="weBookStatus" role="status" aria-live="polite"></p>
    <div id="weBookPrice" class="we-book-price" hidden></div>
    <button id="weBookQuote" type="button" class="we-book-primary">Get Whip fare quote</button>
    <button id="weBookResume" type="button" class="we-book-primary" hidden>Resume my ride request</button>
    <button id="weBookConfirm" type="button" class="we-book-primary" hidden>Request this ride</button>
    <div id="weBookPayment" hidden>
      <p>Secure payment authorization</p>
      <div id="weBookPaymentElement"></div>
      <button id="weBookAuthorize" class="we-book-primary" type="button">Authorize payment</button>
    </div>
    <button id="weBookCancelRide" type="button" hidden>Cancel ride request</button>
    <p class="we-book-terms">Pickup and destination coordinates are sent to Whip Equipped only when you request a quote. A fare quote is not a reservation, payment authorization is not driver acceptance, and no pickup is promised until a cleared driver accepts.</p>
    <a href="https://matthew.mccluster.org/whip/driver/" id="weBookDriver">Are you a driver? Apply to Whip ↗</a>
  `;
  document.body.append(dialog);
  const $ = id => dialog.querySelector('#' + id);
  const responseData = async response => {
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'The booking service is unavailable.'), { status:response.status,code:data.code });
    return data;
  };
  const request = async (path,options={}) => {
    const api=accountApi();
    if (!api) throw new Error('Sign in with your M Account before booking.');
    return responseData(await api(path,options));
  };
  const money = cents => (Number(cents)/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
  // Persist only a random opaque ride ID in the current tab; server checks
  // M Account ownership again after the Stripe redirect.
  const SAVED_RIDE_KEY='mcc.whip.ride.v1',RIDE_MAX_AGE_MS=24*60*60*1000;
  let quote=null,quotedTrip='',requestId=null,ride=null,poll=null,payment=null,busy=false;
  function savedRideId(){
    try{
      const saved=JSON.parse(sessionStorage.getItem(SAVED_RIDE_KEY)||'null');
      return saved && /^[0-9a-f-]{36}$/i.test(saved.id) && Date.now()-saved.at<RIDE_MAX_AGE_MS
        && Date.now()>=saved.at ? saved.id : null;
    }catch{return null}
  }
  function rememberRide(id){
    if(!/^[0-9a-f-]{36}$/i.test(String(id||'')))return;
    try{sessionStorage.setItem(SAVED_RIDE_KEY,JSON.stringify({id,at:Date.now()}));}catch{}
  }
  function clearSavedRide(){try{sessionStorage.removeItem(SAVED_RIDE_KEY)}catch{}}
  function notify(message) { $('weBookStatus').textContent=String(message || ''); }
  function setBusy(on) {
    busy=on;
    for(const name of ['weBookQuote','weBookResume','weBookConfirm','weBookAuthorize','weBookCancelRide']) $(name).disabled=on;
  }
  function reset({keepRide=false}={}) {
    quote=null;quotedTrip='';requestId=null;
    if(!keepRide)ride=null;
    $('weBookPrice').hidden=true;$('weBookConfirm').hidden=true;$('weBookQuote').hidden=false;
    $('weBookResume').hidden=!savedRideId();
    $('weBookResume').textContent='Resume my ride request';
    $('weBookPayment').hidden=true;$('weBookCancelRide').hidden=!ride;
    $('weBookPaymentElement').replaceChildren();
    payment=null;
  }
  function trip() {
    const selected=currentTrip();
    if (!selected || !Array.isArray(selected.origin) || !Array.isArray(selected.destination))
      throw new Error('Choose a starting point and destination in Travel first.');
    return selected;
  }
  function fingerprint(value) {
    return JSON.stringify([value.origin,value.destination,value.pickup_label,value.dropoff_label]);
  }
  function statusForRide(r) {
    const labels = {REQUESTED:'Your request is awaiting a cleared driver after payment authorization.',
      OFFERED:'Whip is looking for a cleared driver.',
      ACCEPTED:'A cleared driver accepted your trip.',
      DRIVER_EN_ROUTE:'Your confirmed driver is on the way.',
      DRIVER_ARRIVED:'Your driver is at pickup.',
      VERIFIED:'Pickup verification complete.',
      IN_PROGRESS:'Your ride is in progress.',
      COMPLETED:'Trip complete.',CANCELED:'This trip was canceled.'};
    return labels[r.status] || 'Waiting for a verified trip update.';
  }
  function stopPolling(){if(poll!==null)clearInterval(poll);poll=null;}
  function startPolling(){
    stopPolling();
    poll=setInterval(async()=>{
      if(!dialog.open||!ride){stopPolling();return;}
      try{
        const data=await request('/api/rides/'+encodeURIComponent(ride.id));
        if(!data.ride)return;
        ride=data.ride;notify(statusForRide(ride));
        if(['COMPLETED','CANCELED'].includes(ride.status)){stopPolling();clearSavedRide();}
      }catch{notify('Trip updates are temporarily unavailable. Your booking record is still on Whip.');}
    },6000);
  }
  async function resumeSavedRide({fromRedirect=false}={}){
    const id=savedRideId();
    if(!id)return false;
    try{
      const response=await request('/api/rides/'+encodeURIComponent(id));
      const restored=response.ride;
      if(!restored||restored.id!==id)throw Error('The server could not verify this trip.');
      ride=restored;quote=null;requestId=null;payment=null;
      $('weBookJourney').textContent=[ride.pickup_label,ride.dropoff_label].filter(Boolean).join(' → ') || 'Saved Whip trip';
      $('weBookQuote').hidden=true;$('weBookConfirm').hidden=true;$('weBookPrice').hidden=true;
      $('weBookPayment').hidden=true;
      const ended=['CANCELED','COMPLETED'].includes(ride.status);
      const paid=['paid','authorized'].includes(ride.payment_status);
      $('weBookCancelRide').hidden=ended;
      $('weBookResume').hidden=paid||ended;
      $('weBookResume').textContent='Resume secure payment';
      notify(ended||paid?statusForRide(ride):
        'Your request was restored, but payment authorization is not confirmed. You can resume the payment. No pickup is promised.');
      if(ended)clearSavedRide();else startPolling();
      if(fromRedirect&&!dialog.open)dialog.showModal();
      return true;
    }catch(error){
      if([401,403,404].includes(error.status))clearSavedRide();
      notify('Unable to restore your previous request: '+(error.message||'Sign in and try again.'));
      if(fromRedirect&&!dialog.open)dialog.showModal();
      return false;
    }
  }
  button.onclick = () => {
    reset();stopPolling();
    if(savedRideId()){
      $('weBookJourney').textContent='Your previous Whip ride';
      notify('Resume your existing request before creating another one.');
      dialog.showModal();
      return;
    }
    try{
      const selected=trip();
      $('weBookJourney').textContent=(selected.pickup_label||'Selected pickup')+' → '+(selected.dropoff_label||'Selected destination');
      notify('');dialog.showModal();
    }catch(error){
      const status=panel.querySelector('#wtRideLocationStatus');if(status)status.textContent=error.message;
    }
  };
  $('weBookResume').onclick=async()=>{
    if(busy)return;
    setBusy(true);
    try{
      if(ride&&!['paid','authorized'].includes(ride.payment_status)){
        await authorizeRide();$('weBookResume').hidden=true;
      }else await resumeSavedRide();
    }catch(error){notify(error.message||'Payment could not be resumed.');}
    finally{setBusy(false)}
  };
  $('weBookClose').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{stopPolling();if(!busy)reset();});
  $('weBookQuote').onclick=async()=>{
    if(busy)return;
    setBusy(true);notify('Calculating a verified route and fare…');
    try{
      const selected=trip();
      const input={origin:selected.origin,destination:selected.destination,
        pickup_label:selected.pickup_label,dropoff_label:selected.dropoff_label,tier:'standard',
        tenant_slug:'whip-equipped'};
      const result=await request('/api/rides/quote',{method:'POST',body:input});
      quote=result.quote;quotedTrip=fingerprint(selected);
      $('weBookPrice').hidden=false;
      $('weBookPrice').textContent='WE Standard · '+money(quote.estimate.fare_cents)+' estimated total · '+
        quote.estimate.miles+' miles · '+quote.estimate.minutes+' min';
      const ready=result.booking_enabled===true;
      $('weBookConfirm').hidden=!ready;
      $('weBookQuote').hidden=ready;
      notify(ready?'Review the amount. Tap Request this ride to create an unpaid, unassigned request.':
        'Quote preview only. Whip Equipped has not opened live bookings. No charge or trip will be created.');
    }catch(error){reset();notify(error.message);}
    finally{setBusy(false);}
  };
  $('weBookConfirm').onclick=async()=>{
    if(busy||!quote)return;
    let chosen;
    try{chosen=trip();if(fingerprint(chosen)!==quotedTrip)throw Error('Your route changed. Please request a new quote.');}
    catch(error){reset();notify(error.message);return;}
    if(Date.parse(quote.expires_at)<=Date.now()){reset();notify('This quote expired. Request a fresh price.');return;}
    setBusy(true);notify('Submitting your exact quoted trip…');
    try{
      if(!requestId)requestId=crypto.randomUUID();
      const result=await request('/api/rides',{method:'POST',
        body:{quote_token:quote.token,request_id:requestId}});
      ride=result.ride;
      rememberRide(ride?.id);
      $('weBookConfirm').hidden=true;$('weBookQuote').hidden=true;
      $('weBookCancelRide').hidden=false;
      notify('Request saved. Secure payment authorization is required before a driver can accept.');
      await authorizeRide();
    }catch(error){notify(error.message);}
    finally{setBusy(false);}
  };
  async function loadStripe(){
    if(window.Stripe)return window.Stripe;
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://js.stripe.com/v3/';
      script.onload=resolve;script.onerror=()=>reject(Error('Secure payment could not load.'));
      document.head.append(script);
    });
    return window.Stripe;
  }
  async function authorizeRide(){
    if(!ride)return;
    const result=await request('/api/rides/'+encodeURIComponent(ride.id)+'/payment-intent',
      {method:'POST',body:{}});
    if(!result.client_secret||!result.publishable_key)throw Error('Secure ride payment is not configured.');
    const Stripe=await loadStripe();
    const stripe=Stripe(result.publishable_key,{stripeAccount:result.connected_account_id});
    const elements=stripe.elements({clientSecret:result.client_secret});
    const element=elements.create('payment');
    element.mount($('weBookPaymentElement'));
    payment={stripe,elements,element};
    $('weBookPayment').hidden=false;
    notify('Your ride request is saved. Authorize the quoted amount to make it eligible for matching.');
  }
  $('weBookAuthorize').onclick=async()=>{
    if(busy||!payment)return;
    setBusy(true);notify('Authorizing your payment securely…');
    try{
      const result=await payment.stripe.confirmPayment({
        elements:payment.elements,
        confirmParams:{return_url:(()=>{
          // Stripe never receives ride identifiers, locations or tokens.
          const url=new URL(location.origin+location.pathname);
          url.searchParams.set('we_ride_return','1');
          return url.href;
        })()},
        redirect:'if_required'
      });
      if(result.error)throw Error(result.error.message||'Payment authorization failed.');
      // Stripe is the payment source of truth. The Worker webhook confirms it
      // before a cleared Whip driver can actually accept an offer.
      $('weBookPayment').hidden=true;
      notify('Payment submitted for authorization. We will only match a driver after Whip verifies it.');
      startPolling();
    }catch(error){notify(error.message);}
    finally{setBusy(false);}
  };
  $('weBookCancelRide').onclick=async()=>{
    if(!ride||busy)return;
    setBusy(true);notify('Canceling your trip request…');
    try{
      const result=await request('/api/rides/'+encodeURIComponent(ride.id)+'/status',
        {method:'PATCH',body:{status:'CANCELED'}});
      ride=result.ride||ride;stopPolling();clearSavedRide();
      $('weBookCancelRide').hidden=true;$('weBookPayment').hidden=true;
      notify('Cancellation requested. Your payment release is handled by Whip and the payment provider.');
    }catch(error){notify(error.message);}
    finally{setBusy(false);}
  };
  window.addEventListener('mcc:auth-changed',()=>{
    if(!window.MCC?.session?.()?.access_token){
      stopPolling();clearSavedRide();
      if(dialog.open)dialog.close();
    }
  });
  // A return from payment authentication reloads this document. Rehydrate
  // only from same-tab state and an authorized server read.
  if(new URLSearchParams(location.search).get('we_ride_return')==='1'){
    const url=new URL(location.href);
    // Payment provider redirect artifacts must not linger in URL/history or
    // propagate through future referrer/analytics requests.
    for(const field of ['we_ride_return','payment_intent','payment_intent_client_secret',
      'redirect_status','setup_intent','setup_intent_client_secret'])
      url.searchParams.delete(field);
    history.replaceState(history.state,'',url.href);
    void resumeSavedRide({fromRedirect:true});
  }
  return {dialog,button,close:()=>dialog.close()};
}
