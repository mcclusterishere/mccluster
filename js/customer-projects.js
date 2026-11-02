(function () {
  'use strict';
  var offersTemplate=new URLSearchParams(location.search).get('template')==='offers';
  if(offersTemplate){var account=document.querySelector('a[href="account.html?next=customer-projects.html"]');if(account)account.href='account.html?next='+encodeURIComponent('customer-projects.html?template=offers');}
  var list=document.getElementById('projectList'), message=document.getElementById('projectMessage'), form=document.getElementById('projectCreate'), generation=0;
  function node(tag,text) { var n=document.createElement(tag); n.textContent=text; return n; }
  async function api(path, init, artist) {
    var seq=generation;
    var session=await window.MCC.refreshIfNeeded();
    if(seq!==generation)throw new Error('Account changed. Refresh your projects.');
    if (!session || !session.access_token) throw Object.assign(new Error('Sign in through Account to manage your projects.'),{status:401});
    var token=session.access_token, controller=new AbortController(), timeout=setTimeout(function(){controller.abort();},12000);
    try {
      var url=/^\/v2\//.test(path)?'https://api.mccluster.org'+path:'https://api.mccluster.org/v1/'+(artist?'canonical-artists':'projects')+path;
      var r=await fetch(url,Object.assign({},init,{signal:controller.signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},cache:'no-store'}));
      var data=await r.json().catch(function(){return null;});
      if (seq!==generation||window.MCC.session()?.access_token !== token) throw new Error('Account changed. Refresh your projects.');
      if (!r.ok) throw Object.assign(new Error((data&&data.error) || 'Projects are unavailable. Try again later.'),{status:r.status,body:data});
      return data;
    } finally { clearTimeout(timeout); }
  }
  /* the versioned client for one project (js/editor-revisions.js): api() takes {method, body} with a plain object body */
  function versioned(slug){var V=window.MCC_EDITOR_V2;return V?V.owned(function(path,opts){opts=opts||{};return api(path,{method:opts.method||'GET',body:opts.body?JSON.stringify(opts.body):undefined});},'projects',slug):null;}
  function explain(err,what){var V=window.MCC_EDITOR_V2;return V?V.explain(V.classify(err),what):err.message;}
  /* Withdraw: a revision-carrying soft removal that keeps the draft, history, address and ID (v3 contract). The legacy
     DELETE is the path only where the versioned API reports itself unconfigured, and then never on a newer save. */
  async function withdraw(p,status){
    var client=versioned(p.slug),state=null;
    var V=window.MCC_EDITOR_V2;
    if(!client){status.textContent='Not withdrawn: the revision client is not loaded. Reload the page.';return false;}
    var legacy=false;
    try{state=await client.read();if(!V.wellFormed(state))throw Object.assign(new Error('malformed'),{malformed:true,status:200});}
    catch(e){var c=V.classify(e);if(V.legacyAllowed(c,null))legacy=true;else{status.textContent=explain(e,'withdrawn')+' Nothing was changed; reload and try again.';return false;}}
    if(!legacy){
      try{await client.withdraw(state.revision);return true;}
      catch(e){status.textContent=explain(e,'withdrawn')+(e&&e.status===409?' Refresh your projects and try again.':'');return false;}
    }
    var latest=(await api('')).projects.find(function(x){return x.slug===p.slug;});
    if(!latest||latest.updated_at!==p.updated_at){status.textContent='Not removed: this project changed since the list was loaded. Refresh your projects and look again.';return false;}
    await api('/'+encodeURIComponent(p.slug),{method:'DELETE'});return true;
  }
  async function recover(p,status){
    var client=versioned(p.slug);if(!client){status.textContent='Recovery needs the versioned editor, which is not switched on here.';return false;}
    try{var state=await client.read();if(!state.owner_withdrawn){status.textContent='This project was not withdrawn by you here, so it cannot be recovered from this screen.';return false;}await client.recover(state.revision);return true;}
    catch(e){status.textContent=explain(e,'recovered');return false;}
  }
  async function artistBindings(projects,seq){
    var data;try{data=await api('/mine',null,true);}catch(_){return;}
    if(seq!==generation||!Array.isArray(data.grants)||!data.grants.length)return;
    var section=node('section','');section.className='site-card';section.id='artistBindings';section.append(node('h2','Artist destinations'));
    section.append(node('p','Reviewed identities assigned to your account. Accepting a project is permanent; publishing and profile privacy still control visitor access.'));
    data.grants.forEach(function(grant){
      var row=node('div',''),label=node('label',grant.name),status=node('p','');status.setAttribute('role','status');
      if(grant.project_id){var project=projects.find(function(p){return p.id===grant.project_id;});row.append(node('h3',grant.name),node('p',project?'Bound to '+project.name:'Bound project is unavailable.'));}
      else{
        var select=node('select','');select.style.fontSize='16px';select.style.maxWidth='100%';select.append(node('option','Choose your project'));select.firstChild.value='';
        projects.filter(function(p){return p.id&&!p.removed_at;}).forEach(function(p){var option=node('option',p.name);option.value=p.id;select.append(option);});label.append(select);
        var accept=node('button','Bind artist destination');accept.type='button';accept.className='site-action';accept.disabled=true;select.onchange=function(){accept.disabled=!select.value;};
        accept.onclick=async function(){if(seq!==generation)return;var chosen=select.value;if(!chosen)return;accept.disabled=true;select.disabled=true;
          try{await api('/bind',{method:'POST',body:JSON.stringify({artist_id:grant.artist_id,project_id:chosen})},true);if(seq===generation)load();}
          catch(e){if(seq===generation){status.textContent=e.message;accept.disabled=false;select.disabled=false;}}
        };row.append(label,accept);
      }
      row.append(status);section.append(row);
    });list.append(section);
  }
  async function load() {
    var seq=++generation; list.replaceChildren(); message.textContent='Loading your projects…';
    try {
      var data=await api(''); if(seq!==generation)return;
      message.textContent=data.projects.length ? '' : 'No projects yet. Create your first draft above.';
      data.projects.forEach(function(p){
        if(!/^[a-z0-9][a-z0-9-]{2,39}$/.test(p.slug))return;
        var c=node('section',''); c.className='site-card'; c.appendChild(node('h2',p.name));
        var status=node('p','');status.setAttribute('role','status');
        c.appendChild(node('p',p.removed_at ? 'Withdrawn · draft, history and address retained · not public' : p.published_at ? 'Publication saved · check public availability in editor' : 'Private draft'));
        if(p.removed_at){var back=node('button','Recover project');back.type='button';back.className='site-action';
          back.addEventListener('click',async function(){back.disabled=true;status.textContent='Recovering…';try{if(await recover(p,status)){status.textContent='Recovered as an unpublished draft. Open it to review, then publish.';await load();}}catch(e){status.textContent=e.message;}finally{back.disabled=false;}});
          c.appendChild(back);}
        if(!p.removed_at){var a=node('a','Edit project');a.className='site-action';a.href='project-studio.html?project='+encodeURIComponent(p.slug);c.appendChild(a);
          var tile=node('a','Edit three-tile template');tile.className='site-action';tile.href='website-studio.html?project='+encodeURIComponent(p.slug);c.appendChild(tile);
          var modules=node('a','Website modules');modules.className='site-action';modules.href='customer-site.html?project='+encodeURIComponent(p.slug);c.appendChild(modules);
          var remove=node('button','Withdraw project');remove.type='button';remove.className='site-action';
          remove.addEventListener('click',async function(){
            if(!window.confirm('Withdraw '+p.name+'? Its page stops being public. Your draft, history and address are kept, and you can recover it here.'))return;
            remove.disabled=true;status.textContent='Withdrawing…';try{if(await withdraw(p,status))await load();}
            catch(e){status.textContent=e.message;}finally{remove.disabled=false;}
          });c.appendChild(remove);
        }
        c.appendChild(status);
        list.appendChild(c);
      });
      artistBindings(data.projects,seq);
    } catch(e){if(seq===generation) message.textContent=e.message;}
  }
  form.addEventListener('submit',async function(e){e.preventDefault();var button=form.querySelector('button');button.disabled=true;
    try {var data=await api('',{method:'POST',body:JSON.stringify({name:document.getElementById('projectName').value,slug:document.getElementById('projectSlug').value})}); location.href='project-studio.html?project='+encodeURIComponent(data.slug)+(offersTemplate?'&template=offers':'');}
    catch(e){message.textContent=e.message;}finally{button.disabled=false;}
  });
  document.getElementById('projectRetry').addEventListener('click',load);
  window.addEventListener('mcc:auth-changed',load);
  window.addEventListener('storage',function(e){if(!e.key || ['mccdb_session','mcc_sess_keep'].includes(e.key))load();});
  load();
})();
