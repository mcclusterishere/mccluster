/* Owner registry adapter: same private draft → preview → explicit publish →
   history/restore journey as the front editor. This version cannot grant access. */
(function(){
 'use strict';window.CR=window.CR||{};var epoch=0,current;
 var escape=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
 var canonical=function(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(function(k){return JSON.stringify(k)+':'+canonical(v[k]);}).join(',')+'}';return JSON.stringify(v);};
 var empty=function(){return {version:1,widgets:{}};};
 function render(){return '<section class="cr-panel" data-widget-editor><div class="cr-panel__head"><h2>Widget definitions</h2></div><div class="cr-panel__body"><p>Prepare widget definitions without activating access. All definitions stay unconfigured. Plan mappings and activation need separate review.</p><button class="cr-btn" data-wd-reload>Reload registry</button><p role="status" aria-live="polite" data-wd-status>Loading owner controls…</p><div data-wd-apps></div><div data-wd-content></div></div></section>';}
 function bind(root,opts){
  var host=root&&root.querySelector('[data-widget-editor]');if(!host||host.dataset.bound)return;host.dataset.bound='true';current=host;
  var status=host.querySelector('[data-wd-status]'),apps=host.querySelector('[data-wd-apps]'),content=host.querySelector('[data-wd-content]');
  var snapshot=null,previewed=null,seq=0,busy=false,account=null;
  function note(s){status.textContent=s;}
  function identity(){var s=window.MCC_SUPA||{};return Promise.resolve(s.token?s.token():null).then(function(t){if(!t){invalidate();throw Error('Sign in required');}try{return JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub||t;}catch(_){return t;}});}
  function rpc(name,args){return opts.supa('rpc/'+name,{method:'POST',body:args});}
  async function run(work,apply){
   if(busy)return;busy=true;var ticket=++seq,start=epoch;previewed=null;note('Checking…');
   host.querySelectorAll('button,select,input').forEach(function(e){e.disabled=true;});
   try{var before=await identity();if(account&&account!==before){invalidate();throw Error('Account changed. Reload the editor.');}account=before;var data=await work();if(before!==await identity()){invalidate();throw Error('Account changed. Reload the editor.');}
    if(ticket!==seq||start!==epoch||!host.isConnected)return;apply(data);
   }catch(e){if(ticket===seq&&start===epoch&&host.isConnected){note((e.message||'Service unavailable')+' Reload to recover.');}}
   finally{busy=false;if(ticket===seq&&start===epoch&&host.isConnected){host.querySelectorAll('button,select,input').forEach(function(e){e.disabled=false;});updatePublish();}}
  }
  function args(action,value,history){return {p_app_key:snapshot.app_key,p_action:action,p_expected_revision:snapshot.revision,p_expected_draft:snapshot.draft?snapshot.draft.revision:null,p_value:value||null,p_history_id:history||null};}
  function read(){var value=empty();content.querySelectorAll('[data-wd-row]').forEach(function(row){
   var key=row.querySelector('[data-wd-id]').value.trim(),cap=row.querySelector('[data-wd-cap]').value.trim(),kind=row.querySelector('[data-wd-kind]').value;
   if(!/^[a-z][a-z0-9._-]{0,79}$/.test(key)||['constructor','prototype','__proto__'].includes(key)||Object.hasOwn(value.widgets,key))throw Error('Use unique widget identifiers: letters, numbers, dot, dash or underscore.');
   var policy={configured:false};if(cap)policy.capability=cap;if(kind)policy.kind=kind;value.widgets[key]=policy;
  });return value;}
  function unchanged(){try{return snapshot&&snapshot.draft&&canonical(read())===canonical(snapshot.draft.config);}catch(_){return false;}}
  function updatePublish(){var button=content.querySelector('[data-wd-publish]');if(button)button.disabled=busy||!previewed||!unchanged();}
  function row(key,p){var el=document.createElement('fieldset');el.setAttribute('data-wd-row','');el.innerHTML='<legend>Unconfigured widget</legend><label>Widget identifier<input data-wd-id maxlength="80" value="'+escape(key)+'"></label><label>Proposed capability (optional)<input data-wd-cap maxlength="80" value="'+escape(p.capability||'')+'"></label><label>Proposed kind<select data-wd-kind><option value="">Undecided</option>'+['internal','included','subscription'].map(function(k){return '<option'+(p.kind===k?' selected':'')+'>'+k+'</option>';}).join('')+'</select></label><button class="cr-btn" data-wd-remove>Remove from draft</button>';
   el.querySelector('[data-wd-remove]').onclick=function(){el.remove();previewed=null;updatePublish();};return el;}
  function show(data){
   if(!data||data.schema!=='owner-widget-definitions/v1'||typeof data.revision!=='string')throw Error('Unsupported editor evidence');
   snapshot=data;previewed=null;var config=data.draft?data.draft.config:data.value||empty();
   // Unknown or active existing configuration must never be silently normalized.
   var editable=config&&config.version===1&&config.widgets&&typeof config.widgets==='object'&&!Array.isArray(config.widgets)&&Object.keys(config).every(function(k){return ['version','widgets'].includes(k);})&&Object.values(config.widgets).every(function(p){return p&&p.configured===false&&Object.keys(p).every(function(k){return ['configured','kind','capability'].includes(k);});});
   content.innerHTML='<p>Published revision '+escape(data.revision)+(data.draft?'; private draft '+escape(data.draft.revision):'; no saved draft')+'.</p>';
   if(!editable){content.innerHTML+='<p>This existing configuration requires separate review. It cannot be replaced by this editor.</p>';note('Configuration protected. No changes made.');return;}
   content.innerHTML+='<div data-wd-rows></div><button class="cr-btn" data-wd-add>Add widget</button><button class="cr-btn" data-wd-save>Save private draft</button><button class="cr-btn" data-wd-preview>Preview saved draft</button><button class="cr-btn" data-wd-publish disabled>Publish unconfigured definitions</button><button class="cr-btn" data-wd-discard>Discard saved draft</button><div data-wd-preview-result></div><h3>Publication history</h3><div data-wd-history></div>';
   var rows=content.querySelector('[data-wd-rows]');Object.entries(config.widgets).forEach(function(w){rows.appendChild(row(w[0],w[1]));});
   content.oninput=function(){previewed=null;updatePublish();};content.onchange=content.oninput;
   content.querySelector('[data-wd-add]').onclick=function(){if(rows.children.length>=16)return note('Maximum sixteen widgets.');rows.appendChild(row('',{}));previewed=null;updatePublish();};
   content.querySelector('[data-wd-save]').onclick=function(){var value;try{value=read();}catch(e){return note(e.message);}run(function(){return rpc('owner_widget_edit_v1',args('save',value));},function(d){show(d);note('Private draft saved. Preview it before publishing.');});};
   content.querySelector('[data-wd-preview]').onclick=function(){if(!unchanged())return note('Save this draft before previewing.');var value=read();run(function(){return rpc('owner_widget_edit_v1',args('preview',value));},function(d){if(d.schema!=='owner-widget-preview/v1'||d.grants_access!==false||canonical(d.config)!==canonical(value))throw Error('Invalid preview evidence');previewed=snapshot.draft.revision;content.querySelector('[data-wd-preview-result]').textContent='Private preview: '+Object.keys(value.widgets).length+' unconfigured widgets. No access grants, prices or subscriptions. Publication changes definitions only.';note('Private preview validated. Publish only when ready.');});};
   content.querySelector('[data-wd-publish]').onclick=function(){if(!previewed||!unchanged()||!window.confirm('Publish these unconfigured definitions to the registry? This does not activate widget access.'))return;run(function(){return rpc('owner_widget_edit_v1',args('publish'));},function(d){show(d);note('Unconfigured definitions published. Access remains inactive.');});};
   content.querySelector('[data-wd-discard]').onclick=function(){if(!window.confirm('Discard your saved private draft? Published definitions stay as they are.'))return;run(function(){return rpc('owner_widget_edit_v1',args('discard'));},function(d){show(d);note('Private draft discarded.');});};
   var history=content.querySelector('[data-wd-history]');(data.history||[]).forEach(function(h){var b=document.createElement('button');b.className='cr-btn';b.textContent='Restore revision '+h.id+' to private draft';b.onclick=function(){if(!window.confirm('Replace the private draft with this historical definition? Publication still requires preview and confirmation.'))return;run(function(){return rpc('owner_widget_edit_v1',args('restore',null,h.id));},function(d){show(d);note('History restored to private draft. Preview before publishing.');});};history.appendChild(b);});
   if(!(data.history||[]).length)history.textContent='No publication history yet.';
   note(data.draft&&data.draft.base_revision!==data.revision?'Draft is based on an older publication. Review current history before saving again.':'Definition loaded. All access remains unconfigured.');
  }
  function load(){account=null;snapshot=null;previewed=null;content.innerHTML='';apps.innerHTML='';run(function(){return rpc('owner_widget_snapshot_v1',{p_app_key:null});},function(d){
   if(d.schema!=='owner-widget-definitions/v1'||!Array.isArray(d.apps))throw Error('Unsupported registry evidence');
   apps.innerHTML='<label>Registered application<select data-wd-app>'+d.apps.map(function(a){return '<option value="'+escape(a.app_key)+'">'+escape(a.name)+'</option>';}).join('')+'</select></label><button class="cr-btn" data-wd-open>Open definitions</button>';
   apps.querySelector('[data-wd-open]').onclick=function(){if(snapshot&&!window.confirm('Reload definitions? Unsaved edits will be discarded.'))return;var key=apps.querySelector('select').value;content.innerHTML='';snapshot=null;run(function(){return rpc('owner_widget_snapshot_v1',{p_app_key:key});},show);};note('Choose an application. Registry definitions are global house configuration.');
  });}
  host.querySelector('[data-wd-reload]').onclick=function(){if(snapshot&&!window.confirm('Reload registry and discard unsaved edits?'))return;load();};load();
 }
 function invalidate(){epoch++;if(current&&current.isConnected){current.querySelector('[data-wd-content]').innerHTML='';current.querySelector('[data-wd-apps]').innerHTML='';current.querySelector('[data-wd-status]').textContent='Account changed. Reload to verify owner access.';current.querySelector('[data-wd-reload]').disabled=false;}}
 window.addEventListener('mcc:auth-changed',invalidate);window.addEventListener('storage',function(e){if(e.key==='mccdb_session'||e.key===null)invalidate();});
 window.CR.widgetDefinitions={render:render,bind:bind};
})();
