/* Native Control > System > Apps. Evidence and plan presentation, never a grant. */
(function(){
 'use strict';window.CR=window.CR||{};
 var current=null,epoch=0;
 var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
 var labels={available:'Available for registry inspection',locked:'Subscription requirement not met',unconfigured:'Configuration required',forbidden:'Permission denied',unavailable:'Evidence unavailable'};
 function render(){return '<section class="cr-panel cr-product-readiness" data-product-readiness><div class="cr-panel__head"><h2>Product widget readiness</h2></div><div class="cr-panel__body"><p>Check this workspace’s registered products and test approved plan presentation. These checks do not change subscriptions, publish configuration or grant access to product data.</p><button type="button" class="cr-btn" data-pwr-refresh>Refresh registry</button><div data-pwr-status role="status" aria-live="polite">Choose a workspace to check readiness.</div><div data-pwr-products></div><div data-pwr-report></div></div></section>';}
 function bind(root,opts){
  var host=root&&root.querySelector('[data-product-readiness]');if(!host||host.dataset.bound)return;host.dataset.bound='true';current=host;
  var sequence=0,report=null;
  var status=host.querySelector('[data-pwr-status]'),products=host.querySelector('[data-pwr-products]'),output=host.querySelector('[data-pwr-report]');
  function wipe(){report=null;output.innerHTML='';}
  function message(s){status.textContent=s;}
  async function run(path,options,apply){
   var ticket=++sequence,start=epoch;wipe();message('Checking…');
   try{var data=await opts.request(path,options);if(ticket!==sequence||start!==epoch||!host.isConnected)return;apply(data);}
   catch(e){if(ticket===sequence&&start===epoch&&host.isConnected)message('Could not verify readiness: '+(e.message||'request failed')+'. Refresh to retry.');}
  }
  function draw(data){
   if(!data||data.contract!=='mccluster-owner-product-readiness/v1'||data.org_id!==opts.orgId||!Array.isArray(data.widgets))throw Error('Unsupported readiness evidence');
   report=data;message('Checked '+new Date(data.checked_at).toLocaleString()+'. No changes were made.');
   output.innerHTML='<h3>'+esc(data.name)+'</h3><p>'+esc(data.next)+'</p>'+(data.state==='inspected'?'':'<p><strong>'+esc(labels[data.state]||data.state)+'</strong></p>')+data.widgets.map(function(w){return '<article><h4>'+esc(w.widget_id)+'</h4><p>Actual access: <strong>'+esc(labels[w.state]||w.state)+'</strong></p>'+(w.presentation?'<p><strong>Presentation simulation: '+esc(w.presentation.plan_code)+'</strong>. This plan would show the widget; actual access remains '+esc(w.allowed?'allowed for registry inspection':'denied')+'. No access or billing changed.</p>':'')+(w.preview_plans&&w.preview_plans.length?'<label>Approved presentation plan<select data-pwr-plan="'+esc(w.widget_id)+'">'+w.preview_plans.map(function(p){return '<option>'+esc(p)+'</option>';}).join('')+'</select></label><button type="button" class="cr-btn" data-pwr-preview="'+esc(w.widget_id)+'">Preview plan presentation</button>':'<p>No approved plan preview is configured for this widget.</p>')+'</article>';}).join('')+'<button type="button" class="cr-btn" data-pwr-export>Download readiness report</button>';
   output.querySelectorAll('[data-pwr-preview]').forEach(function(b){b.onclick=function(){var widget=b.getAttribute('data-pwr-preview'),select=Array.from(output.querySelectorAll('[data-pwr-plan]')).find(function(s){return s.getAttribute('data-pwr-plan')===widget;});inspect(data.app_key,widget,select.value);};});
   output.querySelector('[data-pwr-export]').onclick=function(){if(!report)return;var u=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download='product-readiness.json';a.click();setTimeout(function(){URL.revokeObjectURL(u);},0);};
  }
  function inspect(app,widget,plan){var body={org_id:opts.orgId,app_key:app};if(widget)body.widget_id=widget;if(plan)body.preview_plan=plan;return run('/v1/owner/product-widgets',{method:'POST',body:body},draw);}
  function load(){products.innerHTML='';if(!opts.orgId){message('Select an enabled workspace before checking products.');return;}
   return run('/v1/owner/product-widgets?org_id='+encodeURIComponent(opts.orgId),{},function(data){
    if(!data||data.contract!=='mccluster-owner-product-readiness/v1'||data.org_id!==opts.orgId||!Array.isArray(data.apps))throw Error('Unsupported registry evidence');
    if(!data.apps.length){message('No registered products were returned for this inspection.');return;}
    products.innerHTML='<label>Registered product<select data-pwr-app>'+data.apps.map(function(a){return '<option value="'+esc(a.app_key)+'">'+esc(a.name)+(a.enabled===false?' (disabled)':a.enabled===null?' (enablement unknown)':'')+'</option>';}).join('')+'</select></label><button type="button" class="cr-btn" data-pwr-inspect>Inspect selected product</button>';
    products.querySelector('[data-pwr-inspect]').onclick=function(){inspect(products.querySelector('[data-pwr-app]').value);};
    products.querySelector('[data-pwr-app]').onchange=function(){++sequence;wipe();message('Inspect the selected product to read fresh evidence.');};
    message(data.limited?'Showing the first 100 registry entries; this is a partial inventory.':'Registry loaded. Select a product to inspect.');
   });
  }
  host.querySelector('[data-pwr-refresh]').onclick=load;load();
 }
 function invalidate(){epoch++;if(current&&current.isConnected){current.querySelector('[data-pwr-products]').innerHTML='';current.querySelector('[data-pwr-report]').innerHTML='';current.querySelector('[data-pwr-status]').textContent='Account changed. Refresh to verify access again.';}}
 window.addEventListener('mcc:auth-changed',invalidate);window.addEventListener('storage',function(e){if(e.key==='mccdb_session'||e.key===null)invalidate();});
 window.CR.productReadiness={render:render,bind:bind};
})();
