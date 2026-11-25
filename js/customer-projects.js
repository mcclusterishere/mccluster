(function () {
  'use strict';
  var list=document.getElementById('projectList'), message=document.getElementById('projectMessage'), form=document.getElementById('projectCreate'), generation=0;
  function node(tag,text) { var n=document.createElement(tag); n.textContent=text; return n; }
  async function api(path, init) {
    var session=await window.MCC.refreshIfNeeded();
    if (!session || !session.access_token) throw new Error('Sign in through Account to manage your projects.');
    var token=session.access_token, controller=new AbortController(), timeout=setTimeout(function(){controller.abort();},12000);
    try {
      var r=await fetch('https://api.mccluster.org/v1/projects'+path,Object.assign({},init,{signal:controller.signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},cache:'no-store'}));
      var data=await r.json();
      if (window.MCC.session()?.access_token !== token) throw new Error('Account changed. Refresh your projects.');
      if (!r.ok) throw new Error(data.error || 'Projects are unavailable. Try again later.');
      return data;
    } finally { clearTimeout(timeout); }
  }
  async function load() {
    var seq=++generation; list.replaceChildren(); message.textContent='Loading your projects…';
    try {
      var data=await api(''); if(seq!==generation)return;
      message.textContent=data.projects.length ? '' : 'No projects yet. Create your first draft above.';
      data.projects.forEach(function(p){
        if(!/^[a-z0-9][a-z0-9-]{2,39}$/.test(p.slug))return;
        var c=node('section',''); c.className='site-card'; c.appendChild(node('h2',p.name));
        c.appendChild(node('p',p.removed_at ? 'Removed · address retained' : p.published_at ? 'Publication saved · check public availability in editor' : 'Private draft'));
        if(!p.removed_at){var a=node('a','Edit project');a.className='site-action';a.href='project-studio.html?project='+encodeURIComponent(p.slug);c.appendChild(a);
          var tile=node('a','Edit three-tile template');tile.className='site-action';tile.href='website-studio.html?project='+encodeURIComponent(p.slug);c.appendChild(tile);
          var remove=node('button','Remove project');remove.type='button';remove.className='site-action';
          remove.addEventListener('click',async function(){
            if(!window.confirm('Remove '+p.name+'? Its page will stop being public and its address cannot be reused.'))return;
            remove.disabled=true;try{await api('/'+encodeURIComponent(p.slug),{method:'DELETE'});await load();}
            catch(e){message.textContent=e.message;remove.disabled=false;}
          });c.appendChild(remove);
        }
        list.appendChild(c);
      });
    } catch(e){if(seq===generation) message.textContent=e.message;}
  }
  form.addEventListener('submit',async function(e){e.preventDefault();var button=form.querySelector('button');button.disabled=true;
    try {var data=await api('',{method:'POST',body:JSON.stringify({name:document.getElementById('projectName').value,slug:document.getElementById('projectSlug').value})}); location.href='project-studio.html?project='+encodeURIComponent(data.slug);}
    catch(e){message.textContent=e.message;}finally{button.disabled=false;}
  });
  document.getElementById('projectRetry').addEventListener('click',load);
  window.addEventListener('mcc:auth-changed',load);
  window.addEventListener('storage',function(e){if(!e.key || ['mccdb_session','mcc_sess_keep'].includes(e.key))load();});
  load();
})();
