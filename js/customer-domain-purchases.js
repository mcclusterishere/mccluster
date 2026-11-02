(function(){
 'use strict';
 const $=id=>document.getElementById(id),status=$('purchaseStatus');let generation=0,controller=new AbortController(),capabilities,quote;
 const stale=()=>Object.assign(new Error('Session changed'),{name:'AbortError'});
 async function api(path='',body,scope=generation,method=body?'POST':'GET'){
  const token=await window.MCC_SUPA?.token?.();if(scope!==generation)throw stale();if(!token)throw new Error('Sign in to manage domain purchases.');
  const r=await fetch('https://api.mccluster.org/v1/creator-domain-orders'+path,{method,signal:controller.signal,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const b=await r.json();if(scope!==generation)throw stale();if(!r.ok)throw new Error(b.error||'Please retry');return b;
 }
 const el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
 function report(e,scope){if(scope===generation&&e.name!=='AbortError')status.textContent=e.message;}
 async function load(){
  const scope=++generation;controller.abort();controller=new AbortController();quote=null;capabilities=null;$('savedContacts').replaceChildren();$('domainOrders').replaceChildren();$('contactChoice').replaceChildren();$('contactForm').reset();$('quoteForm').reset();$('orderForm').reset();$('purchaseForms').hidden=true;$('orderForm').hidden=true;status.textContent='Loading…';
  try{const b=await api('',undefined,scope);capabilities=b.capabilities;status.textContent=capabilities.reason;$('purchaseForms').hidden=!capabilities.purchase;
   for(const id of ['contactTerms','orderTerms'])if(/^https:\/\//.test(capabilities.terms_url||''))$(id).href=capabilities.terms_url;
   $('quoteForm').querySelector('option[value=renew]').disabled=!capabilities.renew;
   for(const c of b.contacts){const o=el('option','Contact saved '+new Date(c.created_at).toLocaleString());o.value=c.id;$('contactChoice').append(o);if(c.contact_kind==='inline'){const card=el('article','Contact saved '+new Date(c.created_at).toLocaleString());card.append(el('p','Encrypted contact expires '+new Date(c.expires_at).toLocaleDateString()+'. Deleting it prevents new submissions using this saved contact; already submitted registrations cannot be undone here.'));const remove=el('button','Delete saved contact');remove.addEventListener('click',async()=>{remove.disabled=true;try{await api('/contacts/'+c.id,undefined,scope,'DELETE');if(scope===generation)await load();}catch(e){report(e,scope);if(scope===generation)remove.disabled=false;}});card.append(remove);$('savedContacts').append(card);}}
   for(const order of b.orders){const card=el('article','');card.append(el('h2','Order '+order.id),el('p',statusWords(order.status)));if(order.reason)card.append(el('p',order.reason));if(order.expires_at)card.append(el('p','Registered until '+new Date(order.expires_at).toLocaleDateString()+' (the paid annual term; it does not end with any included platform month)'));
    if(capabilities.contact_model==='inline'&&['processing','submit_started','action_required','reconciliation_required'].includes(order.status)){const check=el('button','Check registration status');check.addEventListener('click',async()=>{check.disabled=true;try{await api('/'+order.id+'/status',{},scope);if(scope===generation)await load();}catch(e){report(e,scope);if(scope===generation)check.disabled=false;}});card.append(check);}
    if(order.status==='awaiting_payment'&&capabilities.purchase){const btn=el('button','Resume checkout');btn.addEventListener('click',()=>checkout(order.id,scope).catch(e=>report(e,scope)));card.append(btn);}$('domainOrders').append(card);}
   platformAccess(b.orders,scope);
  }catch(e){report(e,scope);}
 }
 /* the order's status in words that do not overstate it: a charge is not a registration; refund_required is not a refund */
 function statusWords(s){
  return {awaiting_payment:'Awaiting payment · nothing registered yet',funded:'Paid · registration not yet submitted',processing:'Paid · registration in progress · not confirmed',submit_started:'Paid · submitted to the registrar · awaiting its answer',action_required:'Paid · the registrar needs something more before it registers',registered_pending_reconciliation:'Paid · registrar reported a registration · registrant and charge still being reconciled (not yet confirmed)',fulfilled:'Registered and reconciled',reconciliation_required:'Paid · an uncertain provider result needs a reviewed check; nothing is resubmitted automatically',refund_required:'A refund is required · it has NOT been processed yet; contact support',failed:'Failed · nothing registered'}[s]||String(s||'').replaceAll('_',' ');
 }
 /* the workspace's platform access and the included month's cancellation (js/platform-access.js) */
 async function platformAccess(orders,scope){
  const PA=window.MCC_PLATFORM_ACCESS,host=$('platformAccess');if(!PA||!host)return;host.replaceChildren(el('h2','Included platform month'));
  host.append(el('p','A verified annual domain registration can include one month of platform access for the workspace it was bought for. The server decides what that covers; check it here, and cancel the included month here if you want to. Cancelling does not cancel the domain, your site or a separate paid subscription.'));
  let token;try{token=await window.MCC_SUPA?.token?.();}catch(_){token=null;}if(scope!==generation)return;
  if(!token){host.append(el('p','Sign in to check access.'));return;}
  const ent=await fetch('https://api.mccluster.org/v1/creator-billing/entitlement',{headers:{authorization:'Bearer '+token},cache:'no-store',signal:controller.signal}).then(r=>r.json()).catch(()=>null);if(scope!==generation)return;
  const workspaces=(ent&&Array.isArray(ent.workspaces)?ent.workspaces:[]).filter(w=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(w?.org_id||''));
  if(!workspaces.length){host.append(el('p','No workspace is linked to your account yet, so there is no included month to check.'));return;}
  const form=document.createElement('form'),ws=el('select',''),app=el('select',''),go=el('button','Check access'),out=document.createElement('div');go.type='submit';ws.setAttribute('aria-label','Workspace');app.setAttribute('aria-label','App');
  workspaces.forEach(w=>{const o=el('option','Workspace '+w.org_id);o.value=w.org_id;ws.append(o);});
  const apps=await PA.apps(controller.signal);if(scope!==generation)return;
  (apps||[]).forEach(a=>{if(!/^[a-z0-9][a-z0-9._-]{1,99}$/.test(a.app_key||''))return;const o=el('option',a.name||a.app_key);o.value=a.app_key;app.append(o);});
  if(!app.children.length){const o=el('option','App catalogue unavailable');o.value='';app.append(o);}
  form.append(ws,app,go);host.append(form,out);
  const fulfilled=orders.filter(o=>['fulfilled','registered_pending_reconciliation','refund_required'].includes(o.status)).map(o=>o.id);
  form.onsubmit=async e=>{e.preventDefault();if(!app.value)return;go.disabled=true;out.replaceChildren(el('p','Checking…'));
   try{const r=await PA.access(token,app.value,ws.value,controller.signal);if(scope!==generation)return;
    PA.render(out,r,{orderIds:fulfilled,onCancel:async orderId=>{const c=await PA.cancel(token,orderId,ws.value);if(scope!==generation)return;
     if(c.ok){out.append(el('p','Cancelled. The included month is off for this workspace; the domain stays registered for its term.'));const again=await PA.access(token,app.value,ws.value,controller.signal);if(scope===generation)PA.render(out,again,{orderIds:fulfilled,onCancel:null});}
     else out.append(el('p',c.status===404?'No included month is recorded for that order.':c.status===403?'That workspace or order is not yours to cancel.':c.status===503?'Cancellation is not switched on for this site yet.':'Cancellation was not confirmed. Nothing changed; try again.'));}});
   }finally{if(scope===generation)go.disabled=false;}};
 }
 async function checkout(id,scope){const result=await api('/'+id+'/checkout',{},scope);if(scope!==generation)throw stale();if(!/^https:\/\/checkout\.stripe\.com\//.test(result.url||''))throw new Error('Checkout URL was not valid');location.assign(result.url);}
 $('contactForm').addEventListener('submit',async e=>{e.preventDefault();const scope=generation;if(!capabilities?.purchase)return;const body=Object.fromEntries(new FormData(e.target));body.consent=body.consent==='on';body.country=body.country.toUpperCase();body.terms_version=capabilities.terms_version;try{await api('/contacts',body,scope);if(scope===generation)await load();}catch(err){report(err,scope);}});
 $('quoteForm').addEventListener('submit',async e=>{e.preventDefault();const scope=generation;if(!capabilities?.purchase)return;try{const b=await api('/quotes',Object.fromEntries(new FormData(e.target)),scope);quote=b.quote;$('quoteSummary').textContent=`${quote.hostname} · ${quote.action} · ${quote.years} year(s) · $${(quote.total_cents/100).toFixed(2)} ${quote.currency}. Quote expires ${new Date(quote.expires_at).toLocaleTimeString()}. This is the price for the quoted term only: no renewal price is quoted, nothing renews automatically`+(capabilities.renew?', and renewal is a separate order you place yourself.':', and renewal is not available through this screen yet.')+' Payment is not registration: your order shows "Registered and reconciled" only after the registrar confirms it.';$('orderConsent').checked=false;$('orderForm').hidden=false;}catch(err){report(err,scope);}});
 $('orderForm').addEventListener('submit',async e=>{e.preventDefault();const scope=generation;if(!quote||!capabilities?.purchase)return;try{const b=await api('',{quote_id:quote.id,contact_id:$('contactChoice').value,consent:$('orderConsent').checked,terms_version:capabilities.terms_version},scope);await checkout(b.order.id,scope);}catch(err){report(err,scope);}});
 $('purchaseRefresh').addEventListener('click',load);window.addEventListener('mcc:auth-changed',load);load();
}());
