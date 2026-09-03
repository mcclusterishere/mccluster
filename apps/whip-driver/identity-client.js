(() => {
  const SESSION_KEY='we-driver-session';
  const getSession=()=>JSON.parse(localStorage.getItem(SESSION_KEY)||'null');
  const apiBase=()=>((new URLSearchParams(location.search).get('api')||localStorage.getItem('we-api-base')||'https://api.mccluster.org').replace(/\/$/,''));
  let stripePromise=null;
  function loadStripe(){
    if(window.Stripe)return Promise.resolve(window.Stripe);
    if(stripePromise)return stripePromise;
    stripePromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://js.stripe.com/v3/';s.onload=()=>resolve(window.Stripe);s.onerror=()=>reject(new Error('Could not load secure identity verification'));document.head.appendChild(s)});return stripePromise;
  }
  async function api(path,options={}){
    const base=apiBase(),session=getSession();if(!base)throw new Error('WE Core is not configured');if(!session?.access_token)throw new Error('Sign in first');
    const res=await fetch(base+path,{...options,headers:{'content-type':'application/json',authorization:`Bearer ${session.access_token}`,...(options.headers||{})}});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||'Verification request failed');return data;
  }
  function notice(text){
    let el=document.querySelector('#identityDriverNotice');if(!el){el=document.createElement('div');el.id='identityDriverNotice';el.style.cssText='position:fixed;left:16px;right:16px;bottom:95px;z-index:9000;background:#101010;color:white;border:1px solid #383838;border-radius:16px;padding:14px 16px;font:600 13px -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 12px 35px #0006';document.body.appendChild(el)}el.textContent=text;el.hidden=!text;
  }
  async function verifyDriver(){
    let status=await api('/api/identity/status?purpose=driver');if(status.verified)return true;
    const created=await api('/api/identity/session',{method:'POST',body:JSON.stringify({purpose:'driver'})});
    if(!created.already_verified){
      const config=await api('/api/config?tenant=whip-equipped');if(!config.stripe_publishable_key)throw new Error('Stripe publishable key is not configured');
      const Stripe=await loadStripe(),stripe=Stripe(config.stripe_publishable_key);notice('Complete driver license + selfie verification to go online.');
      const result=await stripe.verifyIdentity(created.client_secret);if(result.error)throw new Error(result.error.message||'Identity verification was not completed');
    }
    notice('Confirming driver identity…');
    for(let i=0;i<12;i++){status=await api('/api/identity/status?purpose=driver');if(status.verified){notice('Identity verified. You can receive paid ride requests.');setTimeout(()=>notice(''),2200);return true}await new Promise(r=>setTimeout(r,1200))}
    throw new Error('Identity verification is still processing. Try Go online again shortly.');
  }
  document.addEventListener('DOMContentLoaded',()=>{
    const button=document.querySelector('#goOnline');if(!button)return;const original=button.onclick;
    button.onclick=async event=>{
      const session=getSession();
      if(!session?.access_token){return original?.call(button,event)}
      try{
        const profile=await api('/api/drivers/me');
        if(!profile.driver)return original?.call(button,event);
        button.disabled=true;button.textContent='Verifying identity…';
        if(await verifyDriver())return original?.call(button,event);
      }catch(error){console.error(error);notice(error.message||'Driver verification required')}
      finally{button.disabled=false;button.textContent='Go online'}
    };
  });
})();