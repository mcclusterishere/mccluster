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
   for(const order of b.orders){const card=el('article','');card.append(el('h2','Order '+order.id),el('p',order.status.replaceAll('_',' ')));if(order.reason)card.append(el('p',order.reason));if(order.expires_at)card.append(el('p','Registered until '+new Date(order.expires_at).toLocaleDateString()));
    if(capabilities.contact_model==='inline'&&['processing','submit_started','action_required','reconciliation_required'].includes(order.status)){const check=el('button','Check registration status');check.addEventListener('click',async()=>{check.disabled=true;try{await api('/'+order.id+'/status',{},scope);if(scope===generation)await load();}catch(e){report(e,scope);if(scope===generation)check.disabled=false;}});card.append(check);}
    if(order.status==='awaiting_payment'&&capabilities.purchase){const btn=el('button','Resume checkout');btn.addEventListener('click',()=>checkout(order.id,scope).catch(e=>report(e,scope)));card.append(btn);}$('domainOrders').append(card);}
  }catch(e){report(e,scope);}
 }
 async function checkout(id,scope){const result=await api('/'+id+'/checkout',{},scope);if(scope!==generation)throw stale();if(!/^https:\/\/checkout\.stripe\.com\//.test(result.url||''))throw new Error('Checkout URL was not valid');location.assign(result.url);}
 $('contactForm').addEventListener('submit',async e=>{e.preventDefault();const scope=generation;if(!capabilities?.purchase)return;const body=Object.fromEntries(new FormData(e.target));body.consent=body.consent==='on';body.country=body.country.toUpperCase();body.terms_version=capabilities.terms_version;try{await api('/contacts',body,scope);if(scope===generation)await load();}catch(err){report(err,scope);}});
 $('quoteForm').addEventListener('submit',async e=>{e.preventDefault();const scope=generation;if(!capabilities?.purchase)return;try{const b=await api('/quotes',Object.fromEntries(new FormData(e.target)),scope);quote=b.quote;$('quoteSummary').textContent=`${quote.hostname} · ${quote.action} · ${quote.years} year(s) · $${(quote.total_cents/100).toFixed(2)} ${quote.currency}. Quote expires ${new Date(quote.expires_at).toLocaleTimeString()}.`;$('orderConsent').checked=false;$('orderForm').hidden=false;}catch(err){report(err,scope);}});
 $('orderForm').addEventListener('submit',async e=>{e.preventDefault();const scope=generation;if(!quote||!capabilities?.purchase)return;try{const b=await api('',{quote_id:quote.id,contact_id:$('contactChoice').value,consent:$('orderConsent').checked,terms_version:capabilities.terms_version},scope);await checkout(b.order.id,scope);}catch(err){report(err,scope);}});
 $('purchaseRefresh').addEventListener('click',load);window.addEventListener('mcc:auth-changed',load);load();
}());
