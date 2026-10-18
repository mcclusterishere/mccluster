/* Public historical work plus separately owned provider webpages. The archive
   never creates mission assignments, awards points, or exposes claim tokens. */
(function () {
  'use strict';
  var PROJECT='docket-516r-2025', PAGE='docket-516r-cohort.html';
  var API='https://api.mccluster.org/v1/action-archive/';
  var promise=null, current=null, worldMode='travel',globeReady=false;
  var pendingEventFocus=new URLSearchParams(location.search).get('completed');
  var mounted=new WeakSet(), mountedSeries=new WeakSet(), doc=document;
  function el(tag,cls,text){var n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;}
  function safeUrl(value){try{var u=new URL(String(value||''),location.href);return u.protocol==='https:'||u.origin===location.origin?u.href:null;}catch(_){return null;}}
  function link(label,url,cls,external){var a=el('a',cls,label),safe=safeUrl(url);if(safe)a.href=safe;if(external){a.target='_blank';a.rel='noopener noreferrer';}return a;}
  function button(label,fn,cls){var b=el('button',cls||'dc-button',label);b.type='button';b.onclick=fn;return b;}
  function pageUrl(slug){return PAGE+'?person='+encodeURIComponent(slug);}
  function profileUrl(p){return 'cohort-profile.html?project='+encodeURIComponent(PROJECT)+'&person='+encodeURIComponent(p.slug);}
  function participantUrl(slug){var p=current&&current.participants.find(function(x){return x.slug===slug;});return p&&p.provider_page===null?profileUrl(p):pageUrl(slug);}
  function bodyOf(data){return data&&data.archive||data&&data.data||data;}
  function valid(data){return data&&data.project&&Array.isArray(data.participants)&&Array.isArray(data.works)&&data.project.slug===PROJECT;}
  async function fetchJson(url,timeout){
    var c=new AbortController(),t=setTimeout(function(){c.abort();},timeout);
    try{
      var r=await fetch(url,{signal:c.signal,headers:{accept:'application/json'}});
      if(!r.ok)throw Object.assign(Error('Archive is unavailable'),{status:r.status});
      var data;
      try{data=await r.json();}
      catch(e){
        // Headers may arrive before an aborted or interrupted body read. Keep
        // those transport errors transient; malformed JSON remains authoritative.
        if(e&&(e.name==='AbortError'||e.name==='TypeError'))throw e;
        throw Object.assign(Error('Archive is unavailable'),{status:r.status});
      }
      return bodyOf(data);
    }finally{clearTimeout(t);}
  }
  function load(){
    if(!promise)promise=(async function(){
      var data;try{data=await fetchJson(API+PROJECT,5000);if(!valid(data))throw Object.assign(Error('Invalid archive'),{status:200});}
      catch(e){if(e.status!=null&&(e.status<500||e.status>599))throw e;data=await fetchJson('data/action/docket-516r-archive.json',8000);}
      if(!valid(data))throw Error('Archive is unavailable');
      current=data;return data;
    })().catch(function(e){promise=null;current=null;throw e;});
    return promise;
  }
  function eventDay(e){var d=new Date(e&&e.starts_at);return Number.isNaN(d.valueOf())?'2025':d.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:e.timezone||'America/New_York'});}
  function stats(data){var wrap=el('div','dc-stats');[[data.works.length,'completed songs'],[data.participants.length,'cohort contributors'],[data.event?1:0,'live capstone']].forEach(function(x){var s=el('span');s.append(el('b','',x[0]),doc.createTextNode(x[1]));wrap.append(s);});return wrap;}
  function roles(p){return (p.project_roles||p.roles||[]).join(' · ');}
  function badge(){return el('span','dc-badge','Past cohort · organizer confirmed');}
  function mediaCard(m){
    var wrap=el('div','dc-recording'),url=safeUrl(m.url);
    wrap.append(el('p','dc-recording__title',m.title||m.version_label||'Recording'));
    if(m.version_label&&m.version_label!==m.title)wrap.append(el('p','dc-small',m.version_label));
    var canonical=m.kind==='audio'&&safeUrl(m.release_url);
    if(canonical)wrap.append(link('Play in Music →',canonical,'dc-button'));
    else if(url&&m.kind!=='audio'&&m.playback==='direct'){
      var player=el('video');player.controls=true;player.preload='none';player.playsInline=true;
      var poster=safeUrl(m.poster_url);if(poster)player.poster=poster;
      player.src=url;player.setAttribute('aria-label',m.title||'Watch recording');wrap.append(player);
    }else if(url){wrap.append(link(m.kind==='audio'?'Listen in the archive ↗':'Watch in the archive ↗',url,'dc-button',true));}
    if(m.archive_version&&m.archive_version.url)wrap.append(link('2025 archive recording ↗',m.archive_version.url,'dc-small',true));
    return wrap;
  }
  function workCard(work,open){
    var box=el('details','dc-work');box.id=work.slug||work.id;if(open)box.open=true;
    var summary=el('summary','',work.title);summary.append(el('span','dc-work__meta','Completed · '+(work.year||2025)+' · Write a Song'));box.append(summary);
    if(Array.isArray(work.credits)&&work.credits.length){var ul=el('ul','dc-work__credits');work.credits.forEach(function(c){
      var li=el('li');if(c.participant_slug)li.append(link(c.display_name,participantUrl(c.participant_slug)));else li.append(doc.createTextNode(c.display_name||'Contributor'));
      li.append(doc.createTextNode(' · '+(c.role||'Contributor')));ul.append(li);
    });box.append(ul);}
    (work.recordings||[]).forEach(function(m){box.append(mediaCard(m));});
    (work.assets||[]).forEach(function(m){box.append(mediaCard(m));});
    return box;
  }
  function eventCard(data,preview){
    var e=data.event;if(!e)return el('div');
    var box=el('section',preview?'dc-preview__event':'dc-event');box.id=preview?'dcPreviewCapstone':'capstone';
    box.append(el(preview?'h3':'h2','',e.title||'The capstone'));
    box.append(el('p','',eventDay(e)+' · '+e.venue));
    box.append(el('p','dc-small',e.public_title||''),el('p','dc-small',e.address||''));
    var actions=el('div','dc-actions');if(e.recording_url)actions.append(link(e.recording_label||'Watch the archived livestream',e.recording_url,'dc-button',true));
    if(doc.getElementById('mnWorldFrame'))actions.append(button('Show on the globe',function(){focusEvent(e);}));
    else actions.append(link('See on the globe','mnet.html?mode=missions&completed='+encodeURIComponent(e.slug),'dc-button'));
    box.append(actions);
    if(Array.isArray(e.work_ids)&&e.work_ids.length){
      var feed=el('section','dc-event-feed');feed.append(el('h3','','Event feed'));
      var list=el('ol','dc-event-feed__list');
      e.work_ids.forEach(function(id){
        var w=data.works.find(function(item){return (item.slug||item.id)===id;});if(!w)return;
        var li=el('li');li.append(link(w.title,PAGE+'#'+encodeURIComponent(id),'dc-button'));
        var media=[].concat(w.assets||[],w.recordings||[]).find(function(m){return m&&m.url;});
        if(media)li.append(link(media.kind==='audio'?'Listen ↗':'Watch ↗',media.url,'dc-small',true));
        list.append(li);
      });feed.append(list);box.append(feed);
    }return box;
  }
  function postToGlobe(message){var f=doc.getElementById('mnWorldFrame');if(f&&f.contentWindow)f.contentWindow.postMessage(message,location.origin);}
  function eventPayload(e){return {id:e.slug,title:'Docket 516R · completed capstone',latitude:e.latitude,longitude:e.longitude,date:String(e.starts_at||'').slice(0,10),url:new URL(PAGE+'#capstone',location.href).href};}
  function sendEventFocus(e){postToGlobe({type:'hu:focus-place',lat:e.latitude,lon:e.longitude,label:e.venue+' · completed capstone'});}
  function syncMap(){
    var events=current&&current.event&&worldMode==='missions'?[eventPayload(current.event)]:[];
    postToGlobe({type:'hu:completed-missions',events:events,on:worldMode==='missions'});
    if(globeReady&&events.length&&pendingEventFocus===current.event.slug){pendingEventFocus=null;sendEventFocus(current.event);}
  }
  function focusEvent(e){pendingEventFocus=e.slug;syncMap();}
  async function mount(host){
    if(!host||mounted.has(host))return;mounted.add(host);host.classList.add('dc-preview');
    try{
      var data=await load();host.replaceChildren(el('p','dc-kicker','Completed by the 2025 cohort'),el('h2','','Docket 516R'),el('p','',data.project.summary||''),stats(data));
      var songs=el('ul','dc-preview__songs');data.works.slice(0,3).forEach(function(w){var li=el('li');li.append(link(w.title,PAGE+'#'+encodeURIComponent(w.slug||w.id)));songs.append(li);});
      host.append(songs,link('Explore the songs and the cohort →',PAGE,'dc-button dc-button--primary'),eventCard(data,true));syncMap();
    }catch(_){mounted.delete(host);host.replaceChildren(el('h2','','Docket 516R'),el('p','','The archive could not load right now.'),link('Open the cohort archive',PAGE,'dc-button'));}
  }

  /* Completed work is a reusable series surface: no duplicated song players,
     no invented recording locations and no new mission assignments. */
  async function mountSeries(host){
    if(!host||mountedSeries.has(host))return;
    mountedSeries.add(host);
    try{
      var data=await load(),works=data.works.filter(function(w){return w&&w.status==='completed'&&(w.id||w.slug);});
      host.replaceChildren();
      if(!works.length){host.append(el('p','dc-small','No completed missions are published yet.'));return;}
      var series=el('details','dc-series');
      var summary=el('summary','dc-series__summary'),name=el('span','dc-series__name');
      name.append(el('strong','',data.project.title||'Docket 516R'),el('small','','Write a Song · '+works.length+' completed · '+(data.project.year||2025)));
      summary.append(name,el('span','dc-series__chevron','View series ↓'));series.append(summary);
      var body=el('div','dc-series__body'),card=el('article','dc-series__card');
      card.tabIndex=0;card.setAttribute('aria-label','Completed mission card. Use left and right arrows to browse.');
      var controls=el('div','dc-series__controls'),position=el('span','dc-series__position');
      var previous=button('← Previous',function(){move(-1);},'dc-series__previous');
      var next=button('Next →',function(){move(1);},'dc-series__next');
      controls.append(previous,position,next);
      var detail=el('dialog','dc-series__dialog');detail.setAttribute('aria-label','Completed mission details');
      detail.addEventListener('close',function(){detail.querySelectorAll('audio,video').forEach(function(media){media.pause();});});
      var index=0;
      function focusGlobe(){
        if(!data.event)return;
        if(window.MCC_WORLD_MODE&&window.MCC_WORLD_MODE.get()!=='missions')window.MCC_WORLD_MODE.set('missions');
        focusEvent(data.event);
        var world=doc.getElementById('mnWorld');if(world)world.scrollIntoView({block:'start',behavior:'smooth'});
      }
      function showDetail(work){
        var contents=el('div','dc-series__detail');
        contents.append(button('Close ✕',function(){detail.close();},'dc-series__close'));
        contents.append(el('p','dc-kicker','Completed mission · Write a Song'),el('h2','',work.title));
        contents.append(el('p','dc-small','Completed by the '+(data.project.year||2025)+' Equity Rise cohort. The public work and verified credits are collected below.'));
        var credits=work.credits||[];
        if(credits.length){
          var creditList=el('ul','dc-work__credits');
          credits.forEach(function(c){
            var li=el('li');
            if(c.participant_slug)li.append(link(c.display_name,participantUrl(c.participant_slug)));
            else li.append(doc.createTextNode(c.display_name||'Contributor'));
            li.append(doc.createTextNode(' · '+(c.role||'Contributor')));creditList.append(li);
          });contents.append(creditList);
        }
        (work.recordings||[]).forEach(function(m){contents.append(mediaCard(m));});
        (work.assets||[]).forEach(function(m){contents.append(mediaCard(m));});
        if(data.event){
          contents.append(el('p','dc-small','This song belongs to the Docket 516R series. The globe pin marks the documented cohort showcase, not an unverified recording address.'));
          contents.append(button('Show cohort showcase on globe',focusGlobe,'dc-button'));
        }
        contents.append(link('See the full cohort record',PAGE+'#'+encodeURIComponent(work.slug||work.id),'dc-button'));
        detail.replaceChildren(contents);
        if(typeof detail.showModal==='function')detail.showModal();
      }
      function paint(){
        var work=works[index],recording=(work.recordings||[]).find(function(m){return m&&safeUrl(m.release_url);});
        position.textContent=(index+1)+' / '+works.length;
        previous.disabled=index===0;next.disabled=index===works.length-1;
        card.replaceChildren(el('p','dc-kicker','Completed · '+(work.year||data.project.year||2025)),
          el('h3','',work.title),el('p','dc-series__type','Write a Song · Write the Change'));
        var credited=(work.credits||[]).map(function(c){return c.display_name;}).filter(Boolean);
        if(credited.length)card.append(el('p','dc-series__credits',credited.join(' · ')));
        var media=el('p','dc-series__media',
          (work.recordings||[]).length+' recording'+((work.recordings||[]).length===1?'':'s')+
          ' · '+(work.assets||[]).length+' visual'+((work.assets||[]).length===1?'':'s'));
        card.append(media);
        var actions=el('div','dc-series__actions');
        actions.append(button('Read full mission',function(){showDetail(work);},'dc-button'));
        if(recording)actions.append(link('Play in Music →',recording.release_url,'dc-button dc-button--primary'));
        if(data.event)actions.append(button('Show on globe',focusGlobe,'dc-button'));
        card.append(actions);
      }
      function move(step){index=Math.max(0,Math.min(works.length-1,index+step));paint();card.focus({preventScroll:true});}
      card.addEventListener('keydown',function(e){
        if(e.target!==card||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;
        if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();move(e.key==='ArrowLeft'?-1:1);}
      });
      var start=null;
      card.addEventListener('pointerdown',function(e){if(e.isPrimary&&e.button===0&&!e.target.closest('a,button'))start={id:e.pointerId,x:e.clientX,y:e.clientY};});
      card.addEventListener('pointerup',function(e){if(!start||start.id!==e.pointerId)return;
        var dx=e.clientX-start.x,dy=e.clientY-start.y;start=null;
        if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5)move(dx<0?1:-1);
      });
      card.addEventListener('pointercancel',function(){start=null;});
      body.append(card,controls,link('Explore the full Docket 516R series →',PAGE,'dc-series__archive'));
      series.append(body);host.append(series,detail);paint();syncMap();
    }catch(e){
      mountedSeries.delete(host);
      host.replaceChildren(el('p','dc-small','Completed missions could not load.'),
        link('View the cohort archive',PAGE,'dc-button'));
      throw e;
    }
  }
  function ensureMap(){return load().then(function(){syncMap();}).catch(function(){});}
  function personCard(p){var a=el('article','dc-person');a.append(link(p.display_name,participantUrl(p.slug),'dc-person__name'),el('p','',roles(p)),badge());var actions=el('div','dc-actions');if(p.provider_page!==null)actions.append(link('Webpage',pageUrl(p.slug),'dc-button'));actions.append(link('Profile',profileUrl(p),'dc-button'));a.append(actions);return a;}
  async function authed(path,init){if(!window.MCC||!MCC.api)throw Error('Sign in to edit your webpage.');var r=await MCC.api('/v1/action-archive/'+path,init);var d=await r.json();if(!r.ok)throw Error(d.message||d.error||'The change could not be saved.');return d;}
  async function ownerEditor(host,p,applyPage){
    if(!window.MCC||!MCC.session||!MCC.session())return;
    var me;try{me=await authed('me?project='+encodeURIComponent(PROJECT));}catch(_){return;}
    if(!me.participant||me.participant.slug!==p.slug)return;
    var content=me.provider_page||me.participant.provider_page||p.provider_page||{},form=el('form','dc-edit');
    form.append(el('h2','','Your webpage'));
    var fields={};[['headline','Headline',300],['bio','About you',4000],['website_url','Website',2048]].forEach(function(f){var label=el('label','',f[1]),input=el(f[0]==='bio'?'textarea':'input');input.name=f[0];input.maxLength=f[2];input.value=content[f[0]]||'';if(f[0]==='website_url'){input.type='url';input.placeholder='https://';}fields[f[0]]=input;label.append(input);form.append(label);});
    var save=el('button','dc-button dc-button--primary','Save webpage');save.type='submit';var status=el('p','dc-status');status.setAttribute('role','status');form.append(save,status);
    form.onsubmit=async function(ev){ev.preventDefault();save.disabled=true;status.textContent='Saving…';try{var data={project_slug:PROJECT};Object.keys(fields).forEach(function(k){data[k]=fields[k].value.trim();});var saved=await authed('pages/'+encodeURIComponent(p.slug),{method:'POST',body:data});if(saved.saved!==true||!saved.provider_page)throw Error('The service did not confirm your saved webpage. Please try again.');applyPage(saved.provider_page);status.textContent='Your webpage is saved.';promise=null;}catch(e){status.textContent=e.message;}finally{save.disabled=false;}};
    host.append(form);
  }
  function openHash(host){
    if(!location.hash)return;var id;try{id=decodeURIComponent(location.hash.slice(1));}catch(_){return;}
    var target=doc.getElementById(id);if(!target||!host.contains(target))return;
    if(target.tagName==='DETAILS')target.open=true;
    setTimeout(function(){if(target.isConnected)target.scrollIntoView({block:'start'});},0);
  }
  function renderPerson(host,data,slug){
    var p=data.participants.find(function(x){return x.slug===slug;});
    if(!p){host.replaceChildren(el('h1','','Page not found'),link('Back to the cohort',PAGE,'dc-button'));return;}
    if(p.provider_page===null){doc.title='Webpage unavailable · Docket 516R cohort';host.replaceChildren(el('h1','','Webpage unavailable'),el('p','','This cohort webpage is not published.'),link('View cohort profile',profileUrl(p),'dc-button'),link('Back to the cohort',PAGE,'dc-button'));return;}
    var page=p.provider_page||{};doc.title=(page.title||p.display_name)+' · Docket 516R cohort';
    host.replaceChildren(link('← Docket 516R cohort',PAGE,'dc-small'),el('p','dc-kicker','Equity Rise · 2025 cohort'),el('h1','',page.title||p.display_name));
    var headline=el('p','dc-intro',page.headline||roles(p));host.append(headline,badge());
    var bio=el('p','dc-intro dc-bio',page.bio||'Contributor to the Equity Rise 2025 cohort and the Docket 516R project.');host.append(bio);
    var actions=el('div','dc-actions');actions.append(link('View profile',profileUrl(p),'dc-button'));
    function applyPage(content){
      p.provider_page=content;headline.textContent=content.headline||roles(p);bio.textContent=content.bio||'Contributor to the Equity Rise 2025 cohort and the Docket 516R project.';
      var previous=actions.querySelector('[data-provider-website]');if(previous)previous.remove();
      if(content.website_url){var website=link('Visit website ↗',content.website_url,'dc-button',true);website.setAttribute('data-provider-website','');actions.append(website);}
    }
    applyPage(page);
    host.append(actions);
    var works=data.works.filter(function(w){return (w.credits||[]).some(function(c){return c.participant_slug===p.slug;});});
    var section=el('section','dc-section');section.append(el('h2','','The work'));
    if(works.length){var list=el('div','dc-grid');works.forEach(function(w){list.append(workCard(w,false));});section.append(list);}
    else section.append(el('p','','Project contribution: '+roles(p)+'. Individual song credits are being completed with the cohort.'),link('Explore the project recordings',PAGE+'#songs','dc-button'));
    host.append(section);
    if(p.claim_status!=='claimed')host.append(el('p','dc-small','This webpage was prepared by the cohort organizer. An invitation lets its owner claim it and add their own details.'));
    ownerEditor(host,p,applyPage);openHash(host);
  }
  function renderProject(host,data){
    var hero=el('header','dc-hero'),intro=el('div');intro.append(el('p','dc-kicker','Equity Rise · 2025 cohort'),el('h1','',data.project.title),el('p','dc-intro',data.project.summary),stats(data));
    var nav=el('div','dc-actions');nav.append(link('Listen to the songs','#songs','dc-button dc-button--primary'),link('Meet the cohort','#people','dc-button'));hero.append(intro);intro.append(nav);
    if(safeUrl(data.project.image_url)){var img=el('img','dc-hero__image');img.src=safeUrl(data.project.image_url);img.alt='Community gathering from the Docket 516R project';hero.append(img);}
    host.replaceChildren(hero);
    var songs=el('section','dc-section');songs.id='songs';songs.append(el('h2','','The completed song missions'),el('p','dc-small','Each song is one completed mission. Alternate mixes and music videos stay with that song.'));
    var grid=el('div','dc-grid');data.works.forEach(function(w){grid.append(workCard(w,false));});songs.append(grid);host.append(songs);
    var people=el('section','dc-section');people.id='people';people.append(el('h2','','The cohort'),el('p','','Artists, producers and engineers, with their own profiles and webpages.'));
    var cards=el('div','dc-grid dc-grid--people');data.participants.forEach(function(p){cards.append(personCard(p));});people.append(cards);host.append(people);
    var event=el('section','dc-section');event.append(eventCard(data,false));host.append(event);
    var extra=(data.media||[]).filter(function(m){return m.kind==='cohort_video'||m.kind==='cohort_promo'||m.id===PROJECT+':cohort-promo';});
    if(extra.length){var media=el('section','dc-section');media.append(el('h2','','From the cohort'));extra.forEach(function(m){media.append(mediaCard(m));});host.append(media);}
    var links=el('div','dc-actions');links.append(link('Try Write a Song','mnet.html?mission=053cbd0d-6bdb-49c6-bd80-8c5b8be36068','dc-button dc-button--primary'),link('Explore the public record',data.project.canonical_url||'docket-516.html','dc-button'));host.append(links);
    openHash(host);
  }
  window.addEventListener('mcc:world-mode',function(e){worldMode=e.detail&&e.detail.mode||'travel';syncMap();});
  window.addEventListener('message',function(e){
    var f=doc.getElementById('mnWorldFrame');if(!f||e.source!==f.contentWindow||e.origin!==location.origin)return;
    var d=e.data||{};if(d.type==='hu:globe-ready'){globeReady=true;syncMap();}
    if(d.type==='hu:completed-selected'&&current&&current.event&&d.eventId===current.event.slug){
      var tab=doc.querySelector('.mn-swipe__filters [data-status="completed"]');
      if(tab&&tab.getAttribute('aria-selected')!=='true')tab.click();
      var target=doc.getElementById('dcPreviewCapstone')||doc.getElementById('mnCompletedMissions');
      if(target)target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'});
    }
  });
  window.DocketCohortShowcase={mount:mount,mountSeries:mountSeries,ensureMap:ensureMap};
  var page=doc.getElementById('docketCohortPage');
  window.addEventListener('hashchange',function(){if(page)openHash(page);});
  if(page)load().then(function(data){var person=new URLSearchParams(location.search).get('person');if(person)renderPerson(page,data,person);else renderProject(page,data);}).catch(function(){page.replaceChildren(el('h1','','Docket 516R'),el('p','','The archive could not load right now.'),link('Open the released recordings','album.html?album=equity-uprise','dc-button'));});
})();

