/* Owner-only presentation inside the canonical Control page. Opt in with
   ?workspace=1. Backend routes remain authoritative. No new auth/data store. */
(function () {
  'use strict';
  const C = window.CR && window.CR.workspaceCore;
  if (!C || new URLSearchParams(location.search).get('workspace') !== '1') return;
  const A = window.CR.analytics;
  const initialHash = location.hash;
  const get = id => document.getElementById(id);
  let active = false, disposed = false, blocked = false, ownerId = '', ownerOrg = '', ownerToken = '', epoch = 0, verifying = null;
  let header = null, tools = null, observer = null, cachedHost = null, frame = null;
  let scene = 'black', lastRoute = '', queued = false, lastVerified = 0, frameRequestAt = 0;
  let abort = null, haloTimer = 0;
  const lastPages = {...C.defaults};
  const originalMount = A && A.mount;
  const announce = text => { const node = get('cwStatus'); if (node && node.textContent !== text) node.textContent = text; };
  const token = () => window.MCC_SUPA?.token ? window.MCC_SUPA.token() : Promise.resolve(null);
  function wantedWorkspace() {
    const id = new URLSearchParams(location.search).get('org');
    if (id) return id;
    try { return localStorage.getItem('mcc.control.org'); } catch (_) { return null; }
  }
  function restoreMount(host) {
    if (cachedHost && cachedHost !== host && cachedHost.querySelector('[data-cra-panel]')) {
      host.replaceChildren(...Array.from(cachedHost.childNodes));
    }
    cachedHost = host;
    originalMount(host);
    if (A.state.globe?.setActive) A.state.globe.setActive(scene === 'black' && !document.hidden);
  }
  // Preserve the existing analytics DOM, camera and selection across page changes.
  // No clone and no second analytics instance. The original renderers still run.
  if (A) A.mount = function (host) {
    if (blocked) { host.replaceChildren(); return; }
    if (!active) return originalMount(host);
    restoreMount(host); schedule();
  };
  function go(hash) {
    if (!active) return;
    const route = C.resolve(hash);
    if (location.hash === route.hash) { sync(); return; }
    location.hash = route.hash;
  }
  function element(tag, className, text) {
    const node = document.createElement(tag); node.className = className;
    if (text) node.textContent = text; return node;
  }
  function install() {
    if (active || disposed || !get('crApp')) return;
    active = true; document.body.dataset.controlWorkspace = 'owner';
    document.body.dataset.cwScene = 'black'; document.body.dataset.cwLayout = 'balanced';
    header = element('header','cw-header'); header.id = 'cwHeader';
    header.innerHTML = '<div class="cw-brand"><img src="assets/img/hm-mark-wide.webp" alt="McCluster"><span>CONTROL ROOM <b>OWNER PREVIEW</b></span></div>'+
      '<nav class="cw-pages" aria-label="Owner workspace">'+C.pages.map(p=>'<button type="button" data-cw-page="'+p+'">'+p[0].toUpperCase()+p.slice(1)+'</button>').join('')+'</nav>'+
      '<div class="cw-actions"><button type="button" id="cwAsk" aria-label="Search or ask McCluster">Ask McCluster <kbd>⌘K</kbd></button><button type="button" id="cwAccount">Account</button></div>';
    tools = element('div','cw-tools'); tools.id='cwTools';
    tools.innerHTML='<div class="cw-location"><span class="cw-eyebrow" id="cwEyebrow">PRIVATE WORKSPACE</span><strong id="cwPlace">Worldwide</strong></div>'+
      '<div class="cw-tools__choices"><label id="cwRouteWrap" hidden>Workspace section<select id="cwRoute" aria-label="Workspace section"></select></label>'+
      '<div class="cw-intelligence-tools"><div class="cw-segment" aria-label="Intelligence scene" role="group"><button type="button" data-cw-scene="black" aria-pressed="true">Black globe</button><button type="button" data-cw-scene="halo" aria-pressed="false" aria-label="Hitman’s Halo"><span class="cw-halo-long">Hitman’s </span>Halo</button></div>'+
      '<button type="button" id="cwSources" aria-expanded="false" aria-controls="cwSourcePanel">Sources</button>'+
      '<button type="button" id="cwLayout" aria-label="Expand the inspector" aria-pressed="false">Details</button></div></div>';
    const status = element('p','cw-status'); status.id='cwStatus'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
    header.appendChild(status);
    const panel=element('section','cw-source-panel'); panel.id='cwSourcePanel'; panel.hidden=true;
    panel.setAttribute('aria-label','Intelligence sources');
    panel.innerHTML='<header><h2>Sources & boundaries</h2><button type="button" id="cwSourcesClose">Close</button></header>'+
      '<p>The black globe shows the selected analytical geography. World signals remain separate from site activity; proximity is not evidence of a relationship.</p>'+
      '<div id="cwSourceRows"></div><p>Country and state analytics use approximate geography and existing aggregation thresholds. Nothing here identifies a visitor’s physical route.</p>';
    const app=get('crApp'); app.prepend(header,tools,panel);
    get('cwAsk').onclick=()=>get('crCommandOpen').click();
    get('cwAccount').onclick=event=>{event.stopPropagation();get('crAccount').click();};
    header.querySelectorAll('[data-cw-page]').forEach(button=>button.onclick=()=>go(lastPages[button.dataset.cwPage]));
    tools.querySelectorAll('[data-cw-scene]').forEach(button=>button.onclick=()=>setScene(button.dataset.cwScene));
    get('cwRoute').onchange=e=>go(e.target.value);
    get('cwSources').onclick=()=>{
      panel.hidden=!panel.hidden; get('cwSources').setAttribute('aria-expanded',String(!panel.hidden));
      if (!panel.hidden) { sources(); get('cwSourcesClose').focus(); }
    };
    get('cwSourcesClose').onclick=()=>{panel.hidden=true;get('cwSources').setAttribute('aria-expanded','false');get('cwSources').focus();};
    get('cwLayout').onclick=()=>{
      const full=document.body.dataset.cwLayout!=='details';
      if(full && frame)closeHalo();
      document.body.dataset.cwLayout=full?'details':'balanced';
      get('cwLayout').textContent=full?'Show globe':'Details';
      get('cwLayout').setAttribute('aria-label',full?'Show the globe':'Expand the inspector');
      get('cwLayout').setAttribute('aria-pressed',String(full));
      A?.state.globe?.setActive(!full && scene==='black' && !document.hidden);
      requestAnimationFrame(()=>A?.state.globe?.resize());
    };
    // Move, don't reproduce, the existing authenticated workspace selector.
    const org=get('crOrgWrap'); if(org) header.querySelector('.cw-actions').prepend(org);
    get('crOrgSelect')?.addEventListener('change',event=>{
      if(active && event.target.value!==ownerOrg)revoke('Workspace changed. Owner preview closed while Control reloads.');
    });
    cachedHost=A?.state.host || null;
    observer=new MutationObserver(records=>{
      // Ignore the renderer's changing credit/tooltip DOM: a paint must not
      // cause a resize/requestRender feedback loop in an otherwise idle globe.
      if(records.some(r=>r.type==='attributes'||r.target===get('crSurface')||
          r.target.id==='crAnalyticsMount'||r.target.closest?.('[data-cra-panel]')))schedule();
    });
    observer.observe(get('crSurface'),{childList:true,subtree:true});
    observer.observe(document.body,{attributes:true,attributeFilter:['data-cr-surface']});
    if (!initialHash || ['#intelligence','#operations','#studio'].includes(initialHash)) go(initialHash?C.resolve(initialHash).hash:'#analytics');
    sync();
  }
  function schedule(){if(queued||!active)return;queued=true;queueMicrotask(()=>{queued=false;sync();});}
  function sync() {
    if (!active || !header) return;
    const route=C.resolve(location.hash), isIntel=route.page==='intelligence';
    document.body.dataset.cwPage=route.page;
    header.querySelectorAll('[data-cw-page]').forEach(b=>{
      const on=b.dataset.cwPage===route.page;
      if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
    });
    if(route.hash!=='#ai')lastPages[route.page]=route.hash;
    if(lastRoute!==route.hash){
      if(!isIntel) closeHalo();
      if(A?.state.globe?.setActive)A.state.globe.setActive(isIntel&&scene==='black'&&!document.hidden&&document.body.dataset.cwLayout!=='details');
      get('cwSourcePanel').hidden=true;get('cwSources').setAttribute('aria-expanded','false');
      const select=get('cwRoute');select.replaceChildren();
      const list=C.routes.filter(r=>r.page===route.page);
      [...new Set(list.map(r=>r.group))].forEach(group=>{
        const opt=document.createElement('optgroup');opt.label=group;
        list.filter(r=>r.group===group).forEach(r=>{const option=document.createElement('option');option.value=r.hash;option.textContent=r.label;opt.appendChild(option);});select.appendChild(opt);
      });
      lastRoute=route.hash;
      requestAnimationFrame(()=>A?.state.globe?.resize());
    }
    get('cwRouteWrap').hidden=isIntel;get('cwRoute').value=route.hash;
    tools.querySelector('.cw-intelligence-tools').hidden=!isIntel;
    const ctx=C.context(A?.state);
    const names=A?.state.geo.places;
    const selected=ctx.country?(names?.[ctx.country]?.[2]||ctx.country)+(ctx.state?' / '+ctx.state:''):'Worldwide';
    const place=isIntel?selected:route.label;
    if(get('cwPlace').textContent!==place)get('cwPlace').textContent=place;
    get('cwEyebrow').textContent=isIntel?(scene==='halo'?'PRIVATE HALO SCENE':'PRIVATE INTELLIGENCE'):route.page.toUpperCase()+' · EXISTING CONTROL WORKFLOWS';
    if(isIntel) {
      announce(scene==='black'?'Owner preview · existing data and permissions. No public interface changed.':'Halo uses its own camera and source permissions. Analytics filters remain in this inspector.');
      if(A?.state.globe?.setActive)A.state.globe.setActive(scene==='black'&&!document.hidden&&document.body.dataset.cwLayout!=='details');
    } else announce('Selected geography stays in Intelligence. These records are not automatically filtered by it.');
  }
  function sources() {
    const rows=get('cwSourceRows');if(!rows||!A)return;
    rows.replaceChildren();
    A.geo.layers.forEach(layer=>{
      const card=element('article','cw-source');
      const button=element('button','',layer.label);button.type='button';button.setAttribute('aria-pressed',String(A.state.geo.layer===layer.id));
      button.onclick=()=>{A.state.geo.layer=layer.id;A.geo.select({country:A.state.geo.region,state:A.state.geo.state},false);sources();};
      const info=element('p','',layer.source);
      const state=element('small','',layer.id==='intel'?(A.state.data.intel?.ok?'Evidence loaded for this period':(A.state.errors.intel?.status===503?'Not enabled · nothing plotted':'No verified response in this view')):'Uses the current analytics response; see its loading/error state');
      card.append(button,info,state);rows.appendChild(card);
    });
    const halo=element('article','cw-source');halo.innerHTML='<strong>Hitman’s Halo</strong><p>Separate scene and independently authorized feeds. No private analytics rows, banks, or provider secrets are sent to it. CCTV media and paid feeds require Halo’s own access checks.</p>';rows.appendChild(halo);
  }
  async function sendHaloToken(expectedFrame) {
    if(!active||!frame||frame!==expectedFrame||scene!=='halo'||document.hidden)return;
    const current=await token();
    if(!active||frame!==expectedFrame||!current||current!==ownerToken)return;
    // Token comes from the existing auth service; only authority is the server check.
    frame.contentWindow.postMessage({type:'mccluster:halo-owner-token',token:current},C.HALO_ORIGIN);
  }
  function closeHalo() {
    clearTimeout(haloTimer);
    if(frame){try{frame.contentWindow.postMessage({type:'mccluster:halo-owner-token:clear'},C.HALO_ORIGIN);}catch(_){}frame.remove();frame=null;}
    get('cwHaloPanel')?.remove();scene='black';document.body.dataset.cwScene='black';
    tools?.querySelectorAll('[data-cw-scene]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.cwScene==='black')));
  }
  async function setScene(next) {
    if(!active||C.resolve(location.hash).page!=='intelligence')return;
    if(next==='black'){closeHalo();A?.state.globe?.setActive(!document.hidden&&document.body.dataset.cwLayout!=='details');sync();return;}
    if(next!=='halo'||frame)return;
    if(!C.PARENT_ORIGINS.includes(location.origin)) {announce('The secure Halo session bridge requires a recognized McCluster host. Black globe remains available.');return;}
    if(!(await verify()))return;
    const stage=get('crSurface').querySelector('[data-cra-stage]');if(!stage)return;
    scene='halo';document.body.dataset.cwScene='halo';
    document.body.dataset.cwLayout='balanced';get('cwLayout').textContent='Details';get('cwLayout').setAttribute('aria-pressed','false');
    A?.state.globe?.setActive(false);
    const holder=element('section','cw-halo');holder.id='cwHaloPanel';
    const note=element('div','cw-halo-note','Opening the full Halo product…');note.id='cwHaloNote';
    const link=element('a','','Open separately ↗');link.href=C.HALO_ORIGIN+'/';link.target='_blank';link.rel='noopener noreferrer';
    note.appendChild(link);holder.appendChild(note);
    frame=document.createElement('iframe');frame.title='Hitman’s Halo private scene';frame.referrerPolicy='no-referrer';
    frame.allow='fullscreen';frame.src=C.HALO_ORIGIN+'/';
    const mine=frame;
    frame.addEventListener('load',()=>{if(frame!==mine)return;sendHaloToken(mine);});
    holder.appendChild(frame);stage.appendChild(holder);
    haloTimer=setTimeout(()=>{if(frame===mine)get('cwHaloNote').firstChild.textContent='If Halo is blocked or needs sign-in, open it separately. ';},12000);
    tools.querySelectorAll('[data-cw-scene]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.cwScene==='halo')));
    sync();
  }
  function revoke(message) {
    blocked=true;document.body.dataset.cwBlocked='true';
    ++epoch;ownerToken='';active=false;lastVerified=0;
    closeHalo();observer?.disconnect();observer=null;
    A?.state.globe?.destroy();if(A)A.state.globe=null;
    cachedHost?.replaceChildren();cachedHost=null;
    // Remove any private mounted view on loss of verified owner authority.
    get('crSurface')?.replaceChildren();if(get('crApp'))get('crApp').hidden=true;
    get('crPalette')?.classList.remove('is-open');get('crPalette')?.setAttribute('aria-hidden','true');
    if(get('crPaletteInput'))get('crPaletteInput').value='';get('crPaletteResults')?.replaceChildren();
    get('crAccountMenu')?.classList.remove('is-open');if(get('crAccountEmail'))get('crAccountEmail').textContent='signed out';
    get('crInspectorBody')?.replaceChildren();
    if(get('cpGate'))get('cpGate').hidden=false;
    const org=get('crOrgWrap');if(org)get('crOrgSelect')&&document.querySelector('.cr-topbar__meta')?.prepend(org);
    header?.remove();tools?.remove();get('cwSourcePanel')?.remove();header=tools=null;
    ['controlWorkspace','cwPage','cwScene','cwLayout'].forEach(key=>delete document.body.dataset[key]);
    if(get('cpNote'))get('cpNote').textContent=message||'Owner access must be verified again.';
  }
  async function verify() {
    if(disposed||blocked)return false;if(verifying)return verifying;
    const mine=++epoch;
    verifying=(async()=>{
      const current=await token();
      if(!current){if(active)revoke('Sign in to your owner account.');return false;}
      abort=new AbortController();const timeout=setTimeout(()=>abort?.abort(),8000);
      try{
        const response=await fetch('https://api.mccluster.org/v1/workspaces/me',{headers:{authorization:'Bearer '+current,accept:'application/json'},cache:'no-store',redirect:'error',signal:abort.signal});
        const data=response.ok?await response.json():null;
        if(mine!==epoch||disposed)return false;
        const latest=await token();if(latest!==current)return false;
        if(!response.ok||!data?.profile?.id||!C.isOwnerWorkspace(data,wantedWorkspace())){
          if(active)revoke('The private preview is available only in the verified McCluster owner workspace.');
          else if(get('cpNote'))get('cpNote').textContent='The private preview is unavailable for this account or workspace.';
          return false;
        }
        if(ownerId && ownerId!==data.profile.id){revoke('Account changed. Reload Control to avoid carrying another account’s data.');return false;}
        ownerId=data.profile.id;ownerOrg=C.selectedWorkspace(data,wantedWorkspace()).org_id;ownerToken=current;lastVerified=Date.now();install();if(frame)sendHaloToken(frame);return true;
      }catch(_){if(mine===epoch&&active)revoke('Owner verification is unavailable. Private workspace closed safely.');return false;}
      finally{clearTimeout(timeout);abort=null;}
    })().finally(()=>{verifying=null;});
    return verifying;
  }
  window.addEventListener('message',event=>{
    if(!active||!frame||!C.acceptsHaloRequest(event,frame.contentWindow)||document.hidden)return;
    const now=Date.now();if(now-frameRequestAt<1000)return;frameRequestAt=now;
    const mine=frame;verify().then(ok=>{if(ok)sendHaloToken(mine);});
  });
  window.addEventListener('hashchange',schedule);
  window.addEventListener('mcc:auth-changed',event=>{
    if(event.detail?.signed_in===false){abort?.abort();revoke('Signed out.');return;}
    if(blocked){location.reload();return;}verify();
  });
  window.addEventListener('storage',event=>{if(event.key==='mccdb_session'){abort?.abort();++epoch;if(active)revoke('Session changed. Reload Control to verify the current owner account.');verify();}});
  document.addEventListener('visibilitychange',()=>{
    A?.state.globe?.setActive(active&&!document.hidden&&C.resolve(location.hash).page==='intelligence'&&scene==='black'&&document.body.dataset.cwLayout!=='details');
    if(document.hidden&&frame){closeHalo();sync();}
    if(!document.hidden)verify();
  });
  document.addEventListener('click',event=>{
    if(!active)return;
    const a=event.target.closest?.('a[href]');if(!a||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button)return;
    const url=new URL(a.href,location.href);
    if(url.origin===location.origin&&url.pathname===location.pathname&&url.hash&&!url.search){event.preventDefault();go(url.hash);}
  });
  document.addEventListener('keydown',event=>{
    if(blocked&&(event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();event.stopImmediatePropagation();return;}
    if(event.key==='Escape'&&active&&!get('cwSourcePanel').hidden){get('cwSourcesClose').click();}
  });
  const timer=setInterval(()=>{if(!document.hidden&&(!active||Date.now()-lastVerified>60000))verify();},15000);
  window.addEventListener('pagehide',()=>{disposed=true;abort?.abort();clearInterval(timer);revoke();});
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  function boot(){verify();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
