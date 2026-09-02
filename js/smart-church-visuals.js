(function(){
  "use strict";

  function q(sel,root){return (root||document).querySelector(sel)}
  function esc(v){return String(v==null?"":v).replace(/[&<>\"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]})}
  function money(v){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(v)}

  function ensureCss(){
    if(q('link[href*="smart-church-responsive.css"]'))return;
    var link=document.createElement("link");
    link.rel="stylesheet";link.href="css/smart-church-responsive.css?v=3";
    document.head.appendChild(link);
  }

  function proofCard(x){
    return '<article class="sc-proof" data-state="'+esc(x.state)+'">'+
      '<span class="sc-proof__state"><i aria-hidden="true"></i>'+esc(x.state)+'</span>'+
      '<b>'+esc(x.value)+' <small>'+esc(x.unit)+'</small></b>'+
      '<p><strong>'+esc(x.label)+'</strong><br>'+esc(x.detail)+'</p>'+
    '</article>';
  }

  function renderStory(data){
    var metrics=q("#scMetrics");if(!metrics||q("#s477Story"))return;
    var story=document.createElement("section");
    story.className="sc-story";story.id="s477Story";story.setAttribute("aria-label","S477 project evidence summary");
    story.innerHTML=
      '<article class="sc-story__hero">'+
        '<p class="sc-story__label">Current capital reference · Engineering Pack V2</p>'+
        '<strong class="sc-story__number">'+money(data.capital.baseline)+'<small>baseline</small></strong>'+
        '<p class="sc-story__copy"><b>This number is a design instrument, not a fundraiser headline.</b> It includes the current direct-buy reference architecture plus 10% design/procurement contingency. The website keeps the number visible while also showing exactly what is verified, designed, and still unresolved.</p>'+
        '<div class="sc-story__meta"><span>'+money(data.capital.subtotal)+' before contingency</span><span>'+money(data.capital.optionalLongDurationResilience)+' resilience option separate</span></div>'+
      '</article>'+
      '<div class="sc-proofrail" aria-label="Verified, designed and open project facts">'+data.proof.map(proofCard).join("")+'</div>';
    metrics.insertAdjacentElement("afterend",story);
  }

  function budgetRows(data){
    var max=Math.max.apply(null,data.capital.categories.map(function(x){return x.value}));
    return data.capital.categories.map(function(x){
      var pct=Math.max(3,(x.value/max)*100);
      return '<div class="sc-budget__row">'+
        '<span class="sc-budget__name">'+esc(x.name)+'</span>'+
        '<span class="sc-budget__track" aria-hidden="true"><i class="sc-budget__fill" style="display:block;width:'+pct.toFixed(1)+'%"></i></span>'+
        '<span class="sc-budget__value">'+money(x.value)+'</span>'+
      '</div>';
    }).join("");
  }

  function renderData(data){
    var anchor=q(".sc-ledger");if(!anchor||q("#s477DataGrid"))return;
    var grid=document.createElement("section");grid.className="sc-data-grid";grid.id="s477DataGrid";grid.setAttribute("aria-label","S477 budget and evidence sources");
    grid.innerHTML=
      '<article class="sc-data-card">'+
        '<p class="sc-data-kicker">Show the engineering math</p><h2>Where the baseline goes.</h2>'+
        '<p>The bars use the current Engineering Pack V2 category values. They are deliberately proportional, so a nontechnical visitor sees where the project is concentrated while an engineer can still read every dollar value.</p>'+
        '<div class="sc-budget">'+budgetRows(data)+'</div>'+
        '<p class="sc-budget__note">'+esc(data.capital.note)+'</p>'+
      '</article>'+
      '<article class="sc-data-card sc-lidar-card">'+
        '<p class="sc-data-kicker">Spatial evidence · official source</p><h2>'+esc(data.lidar.label)+'</h2>'+
        '<p>'+esc(data.lidar.status)+'. The statewide source stays authoritative; only a parcel-accurate S477 crop will be stored as a project derivative.</p>'+
        '<div class="sc-lidar-readout">'+
          '<div><b>'+esc(data.lidar.datasetId)+'</b><small>NOAA dataset ID</small></div>'+
          '<div><b>'+Number(data.lidar.tileCount).toLocaleString()+'</b><small>source tiles</small></div>'+
          '<div><b>'+esc(data.lidar.tileSize)+'</b><small>tile grid</small></div>'+
          '<div><b>'+esc(data.lidar.approxFullDataset)+'</b><small>full statewide source</small></div>'+
        '</div>'+
        '<div class="sc-lidar-actions"><a href="'+esc(data.lidar.viewer)+'" target="_blank" rel="noopener">Open 3D LiDAR</a><a href="'+esc(data.lidar.catalog)+'" target="_blank" rel="noopener">NOAA metadata</a><a href="data/s477/lidar/source-manifest.json">Source manifest</a></div>'+
        '<div class="sc-source-stack">'+
          '<a class="sc-source-card" href="docs/s477/records/2026-09-02-city-records-request.md"><span class="sc-source-card__top"><b>City plans + property jacket</b><span>'+esc(data.records.status)+'</span></span><p>'+esc(data.records.ask)+' Published search guidance: '+esc(data.records.publishedSearchWindow)+'.</p></a>'+
          '<a class="sc-source-card" href="data/s477/sources.json"><span class="sc-source-card__top"><b>Source registry</b><span>machine-readable</span></span><p>City GIS, parcel geometry, NOAA LiDAR, records process and project-engineering provenance in one index.</p></a>'+
        '</div>'+
      '</article>';
    anchor.parentNode.insertBefore(grid,anchor);
  }

  function tagBaseMetrics(){
    var metrics=document.querySelectorAll(".sc-metric");
    Array.prototype.forEach.call(metrics,function(card,i){card.setAttribute("data-metric-index",String(i+1));});
  }

  function boot(){
    ensureCss();tagBaseMetrics();
    fetch("data/s477/dashboard.json?v=3").then(function(r){if(!r.ok)throw new Error("dashboard unavailable");return r.json()}).then(function(data){renderStory(data);renderData(data)}).catch(function(){/* Base Smart Church remains fully usable. */});
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();
