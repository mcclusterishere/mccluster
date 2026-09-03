(() => {
  const SESSION_KEY='we-renter-session';
  const getSession=()=>JSON.parse(localStorage.getItem(SESSION_KEY)||'null');
  const apiBase=()=>((new URLSearchParams(location.search).get('api')||localStorage.getItem('we-api-base')||'https://api.mccluster.org').replace(/\/$/,''));
  let stripePromise=null;
  function loadStripe(){
    if(window.Stripe)return Promise.resolve(window.Stripe);
    if(stripePromise)return stripePromise;
    stripePromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://js.stripe.com/v3/';s.onload=()=>resolve(window.Stripe);s.onerror=()=>reject(new Error('Could not load secure identity verification'));document.head.appendChild(s)});
    return stripePromise;
  }
  async function api(path,options={}){
    const base=apiBase(),session=getSession();if(!base)throw new Error('WE Core is not configured');
    const headers={'content-type':'application/json',...(options.headers||{})};if(session?.access_token)headers.authorization=`Bearer ${session.access_token}`;
    const res=await fetch(base+path,{...options,headers});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||'Verification request failed');return data;
  }
  function setText(text){const el=document.querySelector('#licenseStatus');if(el)el.textContent=text}
  async function verify(){
    const button=document.querySelector('#licenseCheck'),session=getSession();if(!button)return false;if(!session?.access_token)throw new Error('Sign in before verifying your license');
    button.disabled=true;setText('Opening secure ID verification…');
    try{
      let current=await api('/api/identity/status?purpose=renter');
      if(!current.verified){
        const created=await api('/api/identity/session',{method:'POST',body:JSON.stringify({purpose:'renter'})});
        if(!created.already_verified){
          if(!created.client_secret)throw new Error('Identity session did not return a client secret');
          const config=await api('/api/config?tenant=whip-equipped');
          if(!config.stripe_publishable_key)throw new Error('Stripe publishable key is not configured');
          const Stripe=await loadStripe();
          const stripe=Stripe(config.stripe_publishable_key);
          const result=await stripe.verifyIdentity(created.client_secret);
          if(result.error)throw new Error(result.error.message||'Identity verification was not completed');
        }
      }
      setText('Confirming verification…');
      for(let i=0;i<12;i++){
        current=await api('/api/identity/status?purpose=renter');
        if(current.verified){
          const bookingId=localStorage.getItem('we-current-rental-booking');
          if(!bookingId)throw new Error('No current rental booking was found');
          await api(`/api/rentals/bookings/${encodeURIComponent(bookingId)}/checkin`,{method:'PATCH',body:JSON.stringify({license_verified:true})});
          button.classList.add('done');setText('License verified');return true;
        }
        await new Promise(r=>setTimeout(r,1200));
      }
      throw new Error('Verification is still processing. Try again in a moment.');
    }finally{button.disabled=false}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    const button=document.querySelector('#licenseCheck');if(!button)return;
    button.onclick=async()=>{try{await verify()}catch(error){console.error(error);setText(error.message||'Unable to verify license')}};
  });
})();