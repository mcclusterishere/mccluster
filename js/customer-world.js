(async function(){
 'use strict';var posts=document.getElementById('worldPosts');
 // Fail closed until the server confirms this site's module and publication.
 window.MCC_SITE_POLICY={world:false};if(window.MCC_BAR?.sitePolicy)window.MCC_BAR.sitePolicy(window.MCC_SITE_POLICY);
 try{
  var params=new URLSearchParams(location.search),query=new URLSearchParams();if(params.has('project'))query.set('project',params.get('project'));else query.set('owner',params.get('owner')||'');
  var r=await fetch('https://api.mccluster.org/v1/customer-site/world?'+query,{cache:'no-store',signal:AbortSignal.timeout(15000)}),d=await r.json();if(!r.ok)throw Error(d.error||'World updates are unavailable.');
  document.getElementById('worldTitle').textContent=d.name+' · World';document.getElementById('worldHome').href=d.home;posts.replaceChildren();
  window.MCC_SITE_POLICY=d.site_modules;if(window.MCC_BAR?.sitePolicy)window.MCC_BAR.sitePolicy(d.site_modules);
  window.MCC_PAGE_PROFILE={name:d.name,home:d.home};if(window.MCC_BAR?.pageProfile)window.MCC_BAR.pageProfile(window.MCC_PAGE_PROFILE);
  (d.posts||[]).forEach(function(p){var article=document.createElement('article');article.className='site-card';var text=document.createElement('p');text.textContent=p.body;var link=document.createElement('a');link.href=p.href;link.textContent='Open post in World';article.append(text,link);posts.append(article);});
  if(!d.posts?.length)posts.textContent='No public updates are available for this website yet.';
 }catch(e){posts.textContent=e.message;}
})();
