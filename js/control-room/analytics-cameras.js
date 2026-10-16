/* Measured camera coverage over the canonical owner API. Checks are explicit,
   bounded and cancellable; decoded images never become invented live totals. */
(function () {
  'use strict';
  window.CR = window.CR || {};
  var C = { catalog: null, loading: false, error: null, checks: {}, running: false, generation: 0, provider: '', preview: null };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function count(v) { return v == null ? '—' : Number(v).toLocaleString(); }
  function stamp(v) { return v ? new Date(v).toLocaleString() : 'Not checked'; }
  function cameras() { return C.catalog ? C.catalog.cameras.filter(function(c) { return !C.provider || c.pack === C.provider; }) : []; }
  function totals(items) {
    var out = { verified: 0, failed: 0, unchecked: 0 };
    items.forEach(function(c) { var r=C.checks[c.id]; if (!r) out.unchecked++; else if(r.status==='verified')out.verified++; else out.failed++; });
    return out;
  }
  function metric(label,value,note) { return '<div class="cu-fact"><span>'+label+'</span><strong>'+count(value)+'</strong><small>'+esc(note||'')+'</small></div>'; }
  function render() {
    var items=cameras(), t=totals(items), all=C.catalog&&C.catalog.cameras, checked=items.length-t.unchecked;
    var controls='<div class="cad-camera-actions"><button type="button" data-camera-load'+(C.loading||C.running?' disabled':'')+'>'+(C.loading?'Reading catalog…':C.catalog?'Refresh catalog':'Load camera catalog')+'</button>'+
      '<button type="button" data-camera-check'+(!C.catalog||C.loading||C.running||!t.unchecked?' disabled':'')+'>Verify '+(C.provider?'this provider':'all feeds')+'</button>'+(C.running?'<button type="button" data-camera-stop>Stop checks</button>':'')+'</div>';
    if(!C.catalog)return '<section class="cu-card"><h2>Camera coverage</h2><p>Provider records and measured image checks from Hitman’s Halo.</p>'+controls+(C.error?'<p role="alert">'+esc(C.error)+'</p>':'<p>Load the current catalog to see the camera count and providers.</p>')+'</section>';
    var providers=C.catalog.packs.map(function(p) { var pt=totals(all.filter(function(c){return c.pack===p.name;}));return '<tr><th scope="row"><button type="button" data-camera-provider="'+esc(p.name)+'" aria-pressed="'+(C.provider===p.name)+'">'+esc(p.name)+'</button></th><td>'+count(p.cameras)+'</td><td>'+count(pt.verified)+'</td><td>'+count(pt.failed)+'</td><td>'+count(pt.unchecked)+'</td><td>'+esc(p.status||'unknown')+'<small>'+esc(stamp(p.fetched_at))+'</small></td></tr>'; }).join('');
    var latest=Object.values(C.checks).reduce(function(v,c){return c.checked_at>v?c.checked_at:v;},'');
    return '<div class="cu-metrics">'+metric('Catalog cameras',items.length,C.provider||'Distinct cameras with coordinates')+metric('Verified image feeds',checked?t.verified:null,checked?'Decoded in this check session':'Run feed verification')+metric('Failed checks',checked?t.failed:null,'At the time checked')+metric('Not checked',t.unchecked,'No assumed availability')+'</div>'+
      '<section class="cu-card"><div class="cu-heading"><h2>Camera coverage</h2><span class="cu-badge">'+checked+' / '+items.length+' checked</span></div><p>Catalog read '+esc(stamp(C.catalog.retrieved_at))+' · Last check '+esc(stamp(latest))+'</p>'+controls+
      (C.provider?'<button type="button" data-camera-provider="">All providers</button>':'')+
      '<progress max="'+Math.max(1,items.length)+'" value="'+checked+'" aria-label="Camera verification progress"></progress>'+
      '<p class="cu-note">'+count(C.catalog.stale_count)+' retained catalog records · Image availability is checked now; capture time is shown when supplied. Video-only feeds without a snapshot are not counted as verified images.</p>'+
      (C.error?'<p role="alert">'+esc(C.error)+'</p>':'')+
      '<div class="cra-table-wrap"><table class="cra-table cad-camera-table"><thead><tr><th>Provider</th><th>Catalog</th><th>Verified</th><th>Failed</th><th>Unchecked</th><th>Catalog status</th></tr></thead><tbody>'+providers+'</tbody></table></div></section>'+
      (C.preview?'<section class="cu-card cad-camera-preview"><img src="'+esc(C.preview.image)+'" alt="Last successfully decoded camera snapshot"><div><h2>'+esc(C.preview.name)+'</h2><p>Checked '+esc(stamp(C.preview.checked_at))+'</p><p>Captured '+esc(C.preview.captured_at?stamp(C.preview.captured_at):'time unavailable')+'</p></div></section>':'');
  }
  async function decode(check) {
    if(check.status!=='image_received'||!/^data:image\/(jpeg|png|webp);base64,/.test(check.image||''))return false;
    var image=new Image(); image.src=check.image;
    try { await image.decode(); return image.naturalWidth>0&&image.naturalHeight>0; } catch (_) { return false; }
  }
  async function load(request,paint) {
    if(C.loading||C.running)return;
    var gen=C.generation;
    C.loading=true;C.error=null;paint();
    try { var catalog=await request('/v1/analytics/cameras');if(gen!==C.generation)return;if(!catalog.ok||!Array.isArray(catalog.cameras))throw new Error('Camera catalog did not answer');C.catalog=catalog;
      // Verification belongs to the catalog actually checked, not a refreshed snapshot.
      C.checks={};C.preview=null;
    } catch(err){C.error=err.message||'Camera catalog unavailable';}
    C.loading=false;paint();
  }
  async function verify(request,paint) {
    if(C.running||!C.catalog)return;
    var gen=++C.generation, pending=cameras().filter(function(c){return !C.checks[c.id];});
    C.running=true;C.error=null;paint();
    try {
      for(var at=0;at<pending.length;at+=4){
        if(gen!==C.generation||document.hidden)break;
        var batch=pending.slice(at,at+4),result=await request('/v1/analytics/cameras/check',{method:'POST',body:{ids:batch.map(function(c){return c.id;})}});
        if(gen!==C.generation)break;
        if(!Array.isArray(result.checks))throw new Error('Feed checks did not answer');
        for(var check of result.checks){
          var camera=batch.find(function(c){return c.id===check.id;});if(!camera)continue;
          var verified=await decode(check);if(gen!==C.generation)break;
          C.checks[check.id]={status:verified?'verified':'unavailable',checked_at:check.checked_at,captured_at:check.captured_at};
          if(verified)C.preview={name:camera.name||camera.id,image:check.image,checked_at:check.checked_at,captured_at:check.captured_at};
          delete check.image;
        }
        paint();
      }
    } catch(err){C.error=err.message||'Feed verification stopped';}
    C.running=false;paint();
  }
  function bind(root,request,paint) {
    var loadButton=root.querySelector('[data-camera-load]');if(loadButton)loadButton.onclick=function(){load(request,paint);};
    var check=root.querySelector('[data-camera-check]');if(check)check.onclick=function(){verify(request,paint);};
    var stop=root.querySelector('[data-camera-stop]');if(stop)stop.onclick=function(){C.generation++;};
    root.querySelectorAll('[data-camera-provider]').forEach(function(b){b.onclick=function(){C.provider=b.getAttribute('data-camera-provider');paint();};});
  }
  window.CR.analyticsCameras={render:render,bind:bind,state:C,load:load,totals:totals};
  function clear(){C.generation++;C.catalog=null;C.checks={};C.preview=null;C.error=null;C.running=false;C.loading=false;}
  window.addEventListener('mcc:auth-changed',function(event){if(event.detail&&event.detail.signed_in===false)clear();});
  window.addEventListener('storage',function(event){if(event.key==='mccdb_session')clear();});
})();
