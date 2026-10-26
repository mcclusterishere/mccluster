(function(){
 'use strict';
 const $=id=>document.getElementById(id),status=$('purchaseStatus');let generation=0,controller=new AbortController(),capabilities,quote;
 const stale=()=>Object.assign(new Error('Session changed'),{name:'AbortError'});
 async function api(path='',body,scope=generation){
  const token=await window.MCC_SUPA?.token?.();if(scope!==generation)throw stale();if(!token)throw new Error('Sign in to manage domain purchases.');
  const r=await fetch('https://api.mccluster.org/v1/creator-domain-orders'+path,{method:body?'POST':'GET',signal:controller.signal,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const b=await r.json();if(scope!==generation)throw stale();if(!r.ok)throw new Error(b.error||'Please retry');return b;
 }
 const el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
 function report(e,scope){if(scope===generation&&e.name!=='AbortError')status.textContent=e.message;}
 async function load(){
  const scope=++generation;controller.abort();controller=new AbortController();quote=null;capabilities=null;$('domainOrders').replaceChildren();$('contactChoice').replaceChildren();$('contactForm').reset();$('quoteForm').reset();$('orderForm').reset();$('purchaseForms').hidden=true;$('orderForm').hidden=true;status.textContent='Loading…';
  try{const b=await api('',undefined,scope);capabilities=b.capabilities;status.textContent=capabilities.reason;$('purchaseForms').hidden=!capabilities.purchase;
   for(const id of ['contactTerms','orderTerms'])if(/^https:\/\//.test(capabilities.terms_url||''))$(id).href=capabilities.terms_url;
   for(const c of b.contacts){const o=el('option','Contact saved '+new Date(c.created_at).toLocaleString());o.value=c.id;$('contactChoice').append(o);}
   for(const order of b.orders){const card=el('article','');card.append(el('h2','Order '+order.id),el('p',order.status.replaceAll('_',' ')));if(order.reason)card.append(el('p',order.reason));if(order.expires_at)card.append(el('p','Registered until '+new Date(order.expires_at).toLocaleDateString()));
    if(order.status==='awaiting_payment'&&capabilities.purchase){const btn=el('button','Resume checkout');btn.addEventListener('click',()=>checkout(order.id,scope).catch(e=>report(e,scope)));card.append(btn);}$('domainOrders').append(card);}
  }catch(e){report(e,scope);}
 }
 async function checkout(id,scope){const result=await api('/'+id+'/checkout',{},scope);if(scope!==generation)throw stale();if(!/^https:\/\/checkout\.stripe\.com\//.test(result.url||''))throw new Error('Checkout URL was not valid');location.assign(result.url);}
 $('contactForm').addEventListener('submit',async e=>{e.preventDefault();const scope=generation;if(!capabilities?.purchase)return;const body=Object.fromEntries(new FormData(e.target));body.consent=body.consent==='on';body.country=body.country.toUpperCase();body.terms_version=capabilities.terms_version;try{await api('/contacts',body,scope);if(scope===generation)await load();}catch(err){report(err,scope);}});
 $('quoteForm').addEventListener('submit',async e=>{e.preventDefault();const scope=generation;if(!capabilities?.purchase)return;try{const b=await api('/quotes',Object.fromEntries(new FormData(e.target)),scope);quote=b.quote;$('quoteSummary').textContent=`${quote.hostname} · ${quote.action} · ${quote.years} year(s) · $${(quote.total_cents/100).toFixed(2)} ${quote.currency}. Quote expires ${new Date(quote.expires_at).toLocaleTimeString()}.`;$('orderConsent').checked=false;$('orderForm').hidden=false;}catch(err){report(err,scope);}});
 $('orderForm').addEventListener('submit',async e=>{e.preventDefault();const scope=generation;if(!quote||!capabilities?.purchase)return;try{const b=await api('',{quote_id:quote.id,contact_id:$('contactChoice').value,consent:$('orderConsent').checked,terms_version:capabilities.terms_version},scope);await checkout(b.order.id,scope);}catch(err){report(err,scope);}});
 $('purchaseRefresh').addEventListener('click',load);window.addEventListener('mcc:auth-changed',load);load();
}());
