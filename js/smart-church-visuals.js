(function(){
  "use strict";

  function q(sel,root){return (root||document).querySelector(sel)}
  function esc(v){return String(v==null?"":v).replace(/[&<>\"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]})}
  function money(v){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(v)}

  function ensureCss(){
    if(!q('link[href*="smart-church-responsive.css"]')){
      var link=document.createElement("link");link.rel="stylesheet";link.href="css/smart-church-responsive.css?v=4";document.head.appendChild(link);
    }
    if(!q("#s477LidarInlineCss")){
      var style=document.createElement("style");style.id="s477LidarInlineCss";style.textContent=
        '.sc-lidar-live{margin:clamp(2.6rem,7vh,5rem) 0 0}.sc-lidar-live__head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1rem;align-items:end;margin-bottom:1rem}.sc-lidar-live__head h2{font-family:var(--display);font-size:clamp(2.5rem,6vw,5rem);font-weight:400;line-height:.9;text-transform:uppercase}.sc-lidar-live__head p{max-width:48rem;margin-top:.6rem;color:var(--s477-muted);font-size:.88rem;line-height:1.6}.sc-lidar-live__badge{border:1px solid var(--s477-line);border-radius:999px;padding:.65rem .8rem;color:var(--s477-gold);font-size:.62rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}.sc-lidar-live__frame{position:relative;overflow:hidden;border:1px solid var(--s477-line);border-radius:22px;background:#090807;box-shadow:0 30px 90px -55px #000}.sc-lidar-live iframe{display:block;width:100%;height:min(72vh,760px);min-height:520px;border:0;background:#090807}.sc-lidar-live__note{display:flex;justify-content:space-between;gap:1rem;padding:.8rem 1rem;border-top:1px solid var(--s477-line);color:var(--s477-muted);font-size:.68rem;line-height:1.5}.sc-lidar-live__note b{color:var(--cream)}@media(max-width:700px){.sc-lidar-live__head{grid-template-columns:1fr}.sc-lidar-live__badge{justify-self:start}.sc-lidar-live__frame{margin-left:calc(-1 * clamp(1rem,3.5vw,2.6rem));margin-right:calc(-1 * clamp(1rem,3.5vw,2.6rem));border-radius:0;border-left:0;border-right:0}.sc-lidar-live iframe{height:68vh;min-height:460px}.sc-lidar-live__note{flex-direction:column}}';document.head.appendChild(style);
    }
  }

  function proofCard(x){return '<article class="sc-proof" data-state="'+esc(x.state)+'"><span class="sc-proof__state"><i aria-hidden="true"></i>'+esc(x.state)+'</span><b>'+esc(x.value)+' <small>'+esc(x.unit)+'</small></b><p><strong>'+esc(x.label)+'</strong><br>'+esc(x.detail)+'</p></article>'}

  function renderStory(data){
    var metrics=q("#scMetrics");if(!metrics||q("#s477Story"))return;
    var story=document.createElement("section");story.className="sc-story";story.id="s477Story";story.setAttribute("aria-label","S477 project evidence summary");
    story.innerHTML='<article class="sc-story__hero"><p class="sc-story__label">Current capital reference · Engineering Pack V2</p><strong class="sc-story__number">'+money(data.capital.baseline)+'<small>baseline</small></strong><p class="sc-story__copy"><b>This number is a design instrument, not a fundraiser headline.</b> It includes the current direct-buy reference architecture plus 10% design/procurement contingency. The website keeps the number visible while also showing exactly what is verified, designed, and still unresolved.</p><div class="sc-story__meta"><span>'+money(data.capital.subtotal)+' before contingency</span><span>'+money(data.capital.optionalLongDurationResilience)+' resilience option separate</span></div></article><div class="sc-proofrail" aria-label="Verified, designed and open project facts">'+data.proof.map(proofCard).join("")+'</div>';
    metrics.insertAdjacentElement("afterend",story);
  }

  function renderLidarViewer(){
    var twin=q(".sc-twin");if(!twin||q("#s477LidarLive"))return;
    var section=document.createElement("section");section.className="sc-lidar-live";section.id="s477LidarLive";section.setAttribute("aria-labelledby","s477LidarLiveTitle");
    section.innerHTML='<div class="sc-lidar-live__head"><div><p class="sc-kicker">Real spatial evidence · browser 3D</p><h2 id="s477LidarLiveTitle">Grab the site. Rotate it.</h2><p>This is not a screenshot and not a decorative model. The viewer consumes the actual NOAA point-cloud subset generated for S477. Drag to orbit, zoom through the site, switch between classification and elevation, or isolate building-class points. When the City parcel geometry arrives, the same pipeline tightens this buffered crop to the authoritative site boundary.</p></div><span class="sc-lidar-live__badge">Interactive · touch + mouse</span></div><div class="sc-lidar-live__frame"><iframe src="s477-lidar.html" title="Interactive 3D LiDAR point cloud for S477" loading="lazy" allow="fullscreen"></iframe><div class="sc-lidar-live__note"><span><b>Current geometry:</b> NOAA 2023 classified LiDAR · preliminary buffered site crop</span><span><b>Next fusion:</b> City plans + X5/Marble interior model</span></div></div>';
    twin.insertAdjacentElement("afterend",section);
  }

  function budgetRows(data){var max=Math.max.apply(null,data.capital.categories.map(function(x){return x.value}));return data.capital.categories.map(function(x){var pct=Math.max(3,(x.value/max)*100);return '<div class="sc-budget__row"><span class="sc-budget__name">'+esc(x.name)+'</span><span class="sc-budget__track" aria-hidden="true"><i class="sc-budget__fill" style="display:block;width:'+pct.toFixed(1)+'%"></i></span><span class="sc-budget__value">'+money(x.value)+'</span></div>'}).join("")}

  function renderData(data){
    var anchor=q(".sc-ledger");if(!anchor||q("#s477DataGrid"))return;
    var grid=document.createElement("section");grid.className="sc-data-grid";grid.id="s477DataGrid";grid.setAttribute("aria-label","S477 budget and evidence sources");
    grid.innerHTML='<article class="sc-data-card"><p class="sc-data-kicker">Show the engineering math</p><h2>Where the baseline goes.</h2><p>The bars use the current Engineering Pack V2 category values. They are deliberately proportional, so a nontechnical visitor sees where the project is concentrated while an engineer can still read every dollar value.</p><div class="sc-budget">'+budgetRows(data)+'</div><p class="sc-budget__note">'+esc(data.capital.note)+'</p></article><article class="sc-data-card sc-lidar-card"><p class="sc-data-kicker">Spatial evidence · official source</p><h2>'+esc(data.lidar.label)+'</h2><p>The official statewide survey is the source-of-truth dataset. S477 now has its own browser viewer and automated crop pipeline; the City parcel polygon will tighten the current buffered site subset without changing the viewer architecture.</p><div class="sc-lidar-readout"><div><b>'+esc(data.lidar.datasetId)+'</b><small>NOAA dataset ID</small></div><div><b>'+Number(data.lidar.tileCount).toLocaleString()+'</b><small>source tiles</small></div><div><b>'+esc(data.lidar.tileSize)+'</b><small>tile grid</small></div><div><b>'+esc(data.lidar.approxFullDataset)+'</b><small>full statewide source</small></div></div><div class="sc-lidar-actions"><a href="s477-lidar.html">Open S477 3D viewer</a><a href="'+esc(data.lidar.catalog)+'" target="_blank" rel="noopener">NOAA metadata</a><a href="data/s477/lidar/source-manifest.json">Source manifest</a></div><div class="sc-source-stack"><a class="sc-source-card" href="docs/s477/records/2026-09-02-city-records-request.md"><span class="sc-source-card__top"><b>City plans + property jacket</b><span>'+esc(data.records.status)+'</span></span><p>'+esc(data.records.ask)+' Published search guidance: '+esc(data.records.publishedSearchWindow)+'.</p></a><a class="sc-source-card" href="data/s477/sources.json"><span class="sc-source-card__top"><b>Source registry</b><span>machine-readable</span></span><p>City GIS, parcel geometry, NOAA LiDAR, records process and project-engineering provenance in one index.</p></a></div></article>';
    anchor.parentNode.insertBefore(grid,anchor);
  }

  function tagBaseMetrics(){Array.prototype.forEach.call(document.querySelectorAll(".sc-metric"),function(card,i){card.setAttribute("data-metric-index",String(i+1))})}
  function boot(){ensureCss();tagBaseMetrics();renderLidarViewer();fetch("data/s477/dashboard.json?v=4").then(function(r){if(!r.ok)throw new Error("dashboard unavailable");return r.json()}).then(function(data){renderStory(data);renderData(data)}).catch(function(){})}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();
