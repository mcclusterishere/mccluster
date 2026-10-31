(function(){
 'use strict';
 var $=id=>document.getElementById(id), search=$('directorySearch'),form=$('listingForm'),ownerEpoch=0,searchEpoch=0;
 var categories=['creative','music','technology','education','home','professional','community','other'];
 function node(tag,text,cls){var n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;}
 document.querySelectorAll('[data-categories]').forEach(select=>categories.forEach(c=>{var o=node('option',c);o.value=c;select.appendChild(o);}));
 async function api(path,init={},owner=false){
  var headers={'Content-Type':'application/json'},session,epoch=ownerEpoch;
  if(owner){session=await window.MCC.refreshIfNeeded();if(epoch!==ownerEpoch)throw new Error('Account changed. Reopen your listings.');if(!session?.access_token)throw new Error('Sign in through Account to manage your listings.');headers.Authorization='Bearer '+session.access_token;}
  var controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{var r=await fetch('https://api.mccluster.org/v1/world-directory'+path,{...init,headers,signal:controller.signal,cache:'no-store'}),b=await r.json();
   if(owner&&(epoch!==ownerEpoch||window.MCC.session()?.access_token!==session.access_token))throw new Error('Account changed. Reopen your listings.');
   if(!r.ok)throw new Error(b.error||'Directory unavailable. Try again.');return b;
  }finally{clearTimeout(timeout);}
 }
 async function browse(){
  var seq=++searchEpoch;$('directoryResults').replaceChildren();$('directoryStatus').textContent='Searching…';
  var params=new URLSearchParams(new FormData(search));
  try{var data=await api('?'+params);if(seq!==searchEpoch)return;
   $('directoryStatus').textContent=data.items.length?data.items.length+' results'+(data.truncated?' · Showing the first matching candidates; narrow your search.':''):data.truncated?'No public listings among the first matching candidates. Narrow your search.':'No public listings match. Try another search.';
   data.items.forEach(item=>{var c=node('article','','site-card');c.append(node('h2',item.title),node('p',item.type+' · '+item.category),node('p',item.description),node('p',item.online_only?'Online':item.location+(item.service_area?' · Serves '+item.service_area:'')),node('p',item.provenance));
    // Only canonical owned page routes are navigable, even if a malformed response arrives.
    if(/^front\.html\?(?:project|u)=[a-zA-Z0-9_.%-]+$/.test(item.href)){var a=node('a','Open page','site-action');a.href=item.href;c.appendChild(a);} $('directoryResults').appendChild(c);
   });
  }catch(e){if(seq===searchEpoch)$('directoryStatus').textContent='Directory unavailable. '+e.message;}
 }
 function locationState(){['location_label','service_area'].forEach(k=>{form.elements[k].disabled=form.elements.online_only.checked;});}
 function reset(){form.reset();form.elements.id.value='';locationState();}
 async function manage(){
  var epoch=ownerEpoch;$('ownerDirectory').hidden=true;$('ownerListings').replaceChildren();$('ownerStatus').textContent='Loading your listings…';
  try{var data=await api('/me',{},true);if(epoch!==ownerEpoch)return;
   form.elements.source.replaceChildren();data.sources.forEach(s=>{var o=node('option',s.name);o.value=s.kind+':'+s.key;form.elements.source.appendChild(o);});
   $('ownerStatus').textContent=data.sources.length?'Your public status is checked against each page and your profile.':'Create a page in Your site dashboard before making a listing.';
   data.listings.forEach(item=>{var c=node('section','','site-card');c.append(node('h3',item.title),node('p',item.publicly_available?'Visible in directory':item.is_listed?'Listing saved · page or profile is not public':'Not listed'));
    var edit=node('button','Edit listing','site-action');edit.type='button';edit.onclick=()=>{reset();['id','title','description','category','entity_type','location_label','service_area'].forEach(k=>form.elements[k].value=item[k]||'');form.elements.source.value=item.source_kind+':'+item.source_key;form.elements.online_only.checked=item.online_only;form.elements.is_listed.checked=item.is_listed;locationState();form.scrollIntoView({behavior:'smooth'});};
    var remove=node('button','Remove listing','site-action');remove.type='button';remove.onclick=async()=>{remove.disabled=true;try{await api('/me',{method:'DELETE',body:JSON.stringify({id:item.id})},true);if(epoch!==ownerEpoch)return;await manage();browse();}catch(e){if(epoch===ownerEpoch)$('ownerStatus').textContent=e.message;}finally{remove.disabled=false;}};c.append(edit,remove);$('ownerListings').appendChild(c);
   });reset();form.querySelector('[type=submit]').disabled=!data.sources.length;$('ownerDirectory').hidden=false;
  }catch(e){if(epoch===ownerEpoch)$('ownerStatus').textContent=e.message;}
 }
 form.onsubmit=async e=>{e.preventDefault();var epoch=ownerEpoch,button=form.querySelector('[type=submit]'),b=Object.fromEntries(new FormData(form)),source=(b.source||'').split(':');delete b.source;if(!b.id)delete b.id;b.source_kind=source[0];b.source_key=source[1];['online_only','is_listed','location_consent'].forEach(k=>b[k]=form.elements[k].checked);button.disabled=true;
  try{var data=await api('/me',{method:'POST',body:JSON.stringify(b)},true);if(epoch!==ownerEpoch)return;await manage();$('ownerStatus').textContent=data.publicly_available?'Listing saved and visible in directory.':'Listing saved. It is not public in the directory; review your listing opt-in, page publication and profile visibility and discovery setting.';browse();}catch(e){if(epoch===ownerEpoch)$('ownerStatus').textContent=e.message;}finally{button.disabled=false;}
 };
 function clearOwner(){ownerEpoch++;$('ownerDirectory').hidden=true;$('ownerListings').replaceChildren();form.elements.source.replaceChildren();reset();$('ownerStatus').textContent='Account changed. Reopen your listings.';}
 search.onsubmit=e=>{e.preventDefault();browse();};$('manageDirectory').onclick=manage;$('newListing').onclick=reset;form.elements.online_only.onchange=locationState;
 window.addEventListener('mcc:auth-changed',clearOwner);window.addEventListener('storage',e=>{if(!e.key||['mccdb_session','mcc_sess_keep'].includes(e.key))clearOwner();});
 var params=new URLSearchParams(location.search);['q','type','category','location','online'].forEach(k=>{if(params.has(k))search.elements[k].value=params.get(k);});browse();
})();
