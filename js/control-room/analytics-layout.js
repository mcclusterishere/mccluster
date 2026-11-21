/* Presentation contract only. No endpoint, storage fallback or entitlement authority.
   A canonical owner-authorized adapter must be supplied by the integration owner. */
(function(root){
 'use strict';root.CR=root.CR||{};
 var groups=[['overview',['overview']],['audience',['audience','identity']],['content',['content','adaptive']],['action',['action']],['intelligence',['intelligence','cameras']],['inventory',['inventory','forensics','setup']]];
 var labels={overview:'Overview',audience:'Audience',identity:'Journeys',content:'Content',adaptive:'Adaptive',action:'Action & business',intelligence:'World intelligence',cameras:'Cameras',inventory:'Data & setup',forensics:'Site health',setup:'Setup'};
 function defaults(){return {version:1,order:groups.map(function(g){return g[0];}),defaults:Object.fromEntries(groups.map(function(g){return [g[0],g[1][0]];}))};}
 function validate(value){
  if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!=='defaults,order,version'||value.version!==1)throw Error('Unsupported layout format.');
  if(!Array.isArray(value.order)||value.order.length!==6||new Set(value.order).size!==6||value.order[0]!=='overview'||value.order.some(function(id){return !groups.some(function(g){return g[0]===id;});}))throw Error('Keep Overview first and all six views exactly once.');
  if(!value.defaults||Array.isArray(value.defaults)||Object.keys(value.defaults).sort().join(',')!==groups.map(function(g){return g[0];}).sort().join(','))throw Error('Every view needs a default detail.');
  groups.forEach(function(g){if(!g[1].includes(value.defaults[g[0]]))throw Error('Default detail must belong to its view.');});
  return {version:1,order:value.order.slice(),defaults:Object.assign({},value.defaults)};
 }
 function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function render(){return '<section class="cr-layout-editor" data-analytics-layout><h2>Analytics layout</h2><p>Keep Overview first. Arrange the other five views and choose the detail each opens. Every metric, route and data-status action remains available.</p><p role="status" aria-live="polite" data-layout-status>Shared layout saving is unavailable until the owner configuration service supports Analytics.</p><div data-layout-body></div><div class="cr-layout-actions"><button type="button" data-layout-reload>Reload saved layout</button><button type="button" data-layout-reset>Use default arrangement</button><button type="button" data-layout-save>Save layout</button></div></section>';}
 function bind(container,options){
  var host=container.querySelector('[data-analytics-layout]');if(!host||host.dataset.bound)return null;host.dataset.bound='true';
  options=options||{};var adapter=options.adapter,identity=options.identity,seq=0,disposed=false,busy=false,snapshot=null,account=null,draft=defaults();
  var status=host.querySelector('[data-layout-status]'),body=host.querySelector('[data-layout-body]');
  function note(text){status.textContent=text;}
  function buttons(){host.querySelectorAll('button,select').forEach(function(el){el.disabled=busy||!snapshot;});host.querySelector('[data-layout-reload]').disabled=busy||!adapter;host.querySelectorAll('[data-layout-up]').forEach(function(el){if(Number(el.dataset.layoutUp)<=1)el.disabled=true;});}
  function draw(){body.innerHTML='<ol>'+draft.order.map(function(id,index){var group=groups.find(function(g){return g[0]===id;});return '<li><div><b>'+esc(labels[id])+'</b><br><button type="button" data-layout-up="'+index+'" aria-label="Move '+esc(labels[id])+' earlier">Move earlier</button></div><label>Opening detail<select data-layout-default="'+id+'">'+group[1].map(function(detail){return '<option value="'+detail+'"'+(draft.defaults[id]===detail?' selected':'')+'>'+esc(labels[detail])+'</option>';}).join('')+'</select></label></li>';}).join('')+'</ol>';buttons();}
  function invalidate(){seq++;snapshot=null;account=null;busy=false;draft=defaults();body.innerHTML='';buttons();note('Access or account changed. Reload to verify owner access.');if(options.onInvalidate)options.onInvalidate();}
  function envelope(data){if(!data||data.schema!=='analytics-layout/v1'||typeof data.revision!=='string'||!data.revision||data.revision.length>200)throw Error('Unsupported layout response.');return {schema:data.schema,revision:data.revision,layout:validate(data.layout)};}
  async function run(save){
   if(busy||disposed||!adapter||typeof identity!=='function')return;
   if(save&&!snapshot)return;
   busy=true;var ticket=++seq,expected=snapshot&&snapshot.revision,value=validate(draft);buttons();note(save?'Saving…':'Loading…');
   try{
    var before=await identity();if(!before||account&&account!==before)throw Object.assign(Error('Account changed.'),{status:403});
    var result=await (save?adapter.save({expectedRevision:expected,layout:value}):adapter.load());
    var after=await identity();if(ticket!==seq||disposed||!host.isConnected)return;
    if(before!==after||!after)throw Object.assign(Error('Account changed.'),{status:403});
    var data=envelope(result);account=before;snapshot=data;draft=validate(data.layout);draw();
    if(options.onSaved)options.onSaved(validate(data.layout));note(save?'Layout saved by the owner service.':'Saved layout loaded.');
   }catch(error){if(ticket!==seq||disposed||!host.isConnected)return;
    if(error.status===401||error.status===403){invalidate();return;}
    // A failed write may have committed. Never retry using an uncertain revision.
    snapshot=null;buttons();note((error.status===409?'Layout changed elsewhere.':error.message||'Layout service unavailable.')+' Reload before editing or saving again.');
   }finally{if(ticket===seq&&!disposed){busy=false;buttons();}}
  }
  host.querySelector('[data-layout-reload]').onclick=function(){if(snapshot&&JSON.stringify(draft)!==JSON.stringify(snapshot.layout)&&!root.confirm('Discard unsaved layout changes and reload?'))return;run(false);};
  host.querySelector('[data-layout-save]').onclick=function(){run(true);};
  host.querySelector('[data-layout-reset]').onclick=function(){if(!snapshot||busy)return;draft=defaults();draw();note('Default arrangement prepared. Save to keep it.');};
  body.onclick=function(event){var button=event.target.closest('[data-layout-up]');if(!button||busy||!snapshot)return;var i=Number(button.dataset.layoutUp);if(i<=1)return;var id=draft.order[i];draft.order.splice(i,1);draft.order.splice(i-1,0,id);draw();body.querySelector('[data-layout-up="'+(i-1)+'"]').focus();note('Unsaved layout changes.');};
  body.onchange=function(event){var id=event.target.dataset.layoutDefault;if(!id||busy||!snapshot)return;draft.defaults[id]=event.target.value;validate(draft);note('Unsaved layout changes.');};
  function storage(event){if(event.key===null||event.key==='mccdb_session')invalidate();}
  root.addEventListener('mcc:auth-changed',invalidate);root.addEventListener('storage',storage);
  draw();if(adapter&&identity)run(false);
  return {invalidate:invalidate,dispose:function(){disposed=true;seq++;root.removeEventListener('mcc:auth-changed',invalidate);root.removeEventListener('storage',storage);}};
 }
 root.CR.analyticsLayout={defaults:defaults,validate:validate,render:render,bind:bind};
})(typeof window==='undefined'?globalThis:window);
