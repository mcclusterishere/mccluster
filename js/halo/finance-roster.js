/* Reviewed public corporate roles inside the existing owner Finance globe.
   Coordinates belong to public corporate business addresses, never to the people in the roster. */
(function(){
  'use strict';
  function mount(root,G,ask){
    const esc=x=>G.esc(String(x??''));
    let alive=true,locked=false,visible=true,generation=0,catalog=[],selected=null,detail=null,pins=null,labels=null,hover=null,hoverTimer=0,hovered=null;
    const quoteCache=new Map(),pinLabels=new Map();
    const viewer=()=>G.viewer?.(), C=G.cesium?.()||window.Cesium;
    root.innerHTML='<h4>Company leadership</h4><p>Public executive and board rosters. This directory does not assert that you own these stocks.</p>'+
      '<p data-r-status role="status"></p><div data-r-companies></div><button type="button" data-r-map>Show company addresses on globe</button><button type="button" data-r-clear>Clear company pins</button><button type="button" data-r-reload>Reload reviewed reference</button><div data-r-detail></div>';
    const $=s=>root.querySelector(s);
    function clearPins(){clearTimeout(hoverTimer);hoverTimer=0;hovered=null;if(hover){hover.destroy();hover=null;}pinLabels.clear();const v=viewer();if(v){if(pins)v.scene.primitives.remove(pins);if(labels)v.scene.primitives.remove(labels);v.scene.requestRender();}pins=labels=null;}
    function clear(){locked=true;generation++;selected=null;detail=null;catalog=[];quoteCache.clear();clearPins();$('[data-r-companies]').textContent='';$('[data-r-detail]').textContent='';$('[data-r-status]').textContent='Owner authentication required.';root.querySelectorAll('button').forEach(b=>b.disabled=true);}
    function safeHref(url){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
    function sourceLink(s){const href=safeHref(s.url);return href?'<a href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">'+esc(s.title)+'</a>':esc(s.title);}
    async function load(){const n=++generation;$('[data-r-status]').textContent='Loading reviewed issuer sources…';
      try{const d=await ask('leadership');if(!alive||locked||n!==generation)return;catalog=d.companies||[];
        $('[data-r-companies]').innerHTML=catalog.map(c=>'<button type="button" data-r-symbol="'+esc(c.symbol)+'" data-r-mic="'+esc(c.mic)+'">'+esc(c.symbol)+' · '+esc(c.name)+'</button>').join('');
        $('[data-r-status]').textContent=catalog.length+' reviewed companies · source facts, not live data. Refreshing reloads this reviewed version; it does not scrape issuers.';
        if(G.financeAutoMap)mapCompanies();
        if(selected)select(selected.symbol,selected.mic);
      }catch(e){if(!alive||n!==generation)return;if(e.status===401||e.status===403||e.code==='forbidden'){clear();return;}catalog=[];detail=null;clearPins();$('[data-r-companies]').textContent='';$('[data-r-detail]').textContent='';$('[data-r-status]').textContent='Leadership unavailable: '+String(e.code||'request failed').replaceAll('_',' ');}
    }
    async function select(symbol,mic){if(!alive||locked)return;const n=++generation;selected={symbol,mic};detail=null;$('[data-r-detail]').textContent='Loading '+symbol+' leadership…';
      try{const d=await ask('leadership?symbol='+encodeURIComponent(symbol)+(mic?'&mic='+encodeURIComponent(mic):''));if(!alive||locked||n!==generation)return;
        if(d.status!=='available'||!d.company){$('[data-r-detail]').textContent=d.reason||'No reviewed roster for this listing.';return;}
        detail=d;selected={symbol:d.company.ticker,mic:d.company.mic};paint();
      }catch(e){if(!alive||n!==generation)return;if(e.status===401||e.status===403||e.code==='forbidden'){clear();return;}$('[data-r-detail]').textContent='Leadership unavailable: '+String(e.code||'request failed').replaceAll('_',' ');}
    }
    function paint(){const d=detail,c=d.company,sourceById=new Map(d.sources.map(s=>[s.id,s]));
      const roles=c.people.flatMap(p=>p.roles.map(r=>({name:p.name,...r})));
      const group=(title,categories)=>'<h5>'+title+'</h5><ul>'+roles.filter(r=>categories.includes(r.category)).map(r=>'<li><strong>'+esc(r.name)+'</strong><br>'+esc(r.title)+'<br><small>Listed in source · checked '+esc(r.observed_at)+' · '+esc(r.freshness.state.replaceAll('_',' '))+
        (r.role_start?' · start '+esc(r.role_start):' · start not supplied')+(r.role_end?' · end '+esc(r.role_end):'')+'</small><br>'+r.source_ids.map(id=>sourceById.get(id)).filter(Boolean).map(sourceLink).join(' · ')+'</li>').join('')+'</ul>';
      const h=c.headquarters;
      $('[data-r-detail]').innerHTML='<h4>'+esc(c.name)+' · '+esc(c.ticker)+'</h4><p>Issuer '+esc(c.issuer_id)+' · '+esc(c.mic)+' · '+c.people.length+' people / '+roles.length+' listed roles.</p>'+
        (h?'<p>Company headquarters: '+esc(h.address)+'. Business address only, never a person’s location.</p>'+(h.geolocation?'<p>'+esc(h.geolocation.precision.replaceAll('_',' '))+' · '+esc(h.geolocation.note)+'</p><p>'+esc(h.geolocation.attribution)+(h.geolocation.license_url?' · <a href="'+esc(safeHref(h.geolocation.license_url)||'#')+'" target="_blank" rel="noopener noreferrer">'+esc(h.geolocation.license)+'</a>':'')+'</p><button type="button" data-r-locate>Locate company address</button>':'<p>No verified address coordinate. Nothing is placed on the globe.</p>'):'<p>Headquarters location unverified. Nothing is placed on the globe.</p>')+
        '<button type="button" data-f-ownership-issuer="'+esc(c.issuer_id)+'">Research ownership routes</button><button type="button" data-r-quote>Show financial snapshot</button><p data-r-quote-status role="status">Hover over a company pin or request its financial snapshot. Prices require the existing enabled source.</p>'+
        group('Executives',['executive','regional_executive'])+group('Board of directors',['director'])+
        ((c.scheduled_changes||[]).length?'<h5>Announced changes, separate from the observed roster</h5><ul>'+c.scheduled_changes.map(x=>'<li>'+esc(x.name)+' · '+esc(x.title)+' · effective '+esc(x.effective_at)+' · '+x.source_ids.map(id=>sourceById.get(id)).filter(Boolean).map(sourceLink).join(' · ')+'</li>').join('')+'</ul>':'')+
        '<details><summary>Coverage, freshness and source rights</summary><p>'+esc(c.coverage.executives)+'</p><p>'+esc(c.coverage.directors)+'</p><ul>'+[...c.coverage.limitations,...d.limitations].map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul><ul>'+d.sources.map(s=>'<li>'+sourceLink(s)+'<br>Published '+esc(s.published_at||'not supplied')+' · source as of '+esc(s.as_of||'not supplied')+' · retrieved '+esc(s.retrieved_at)+' · '+esc(s.retrieval_method||'')+(s.note?'<br>'+esc(s.note):'')+'</li>').join('')+'</ul><ul>'+d.licensing_audit.map(x=>'<li>'+esc(x.dataset)+': '+esc(x.finding)+'</li>').join('')+'</ul><p>Reviewed reference '+esc(d.reference_version)+'. Unknown term dates remain unknown; annual proxy nominees are not assumed elected.</p></details>';
    }
    function quoteText(d){const q=d?.quote;if(!q)return 'Financial data unavailable · '+String(d?.code||'not connected').replaceAll('_',' ');
      const price=x=>typeof x==='number'&&Number.isFinite(x)?'$'+x.toFixed(2):'unavailable';
      const age=Date.now()-Date.parse(q.as_of||''),state=q.status==='real_time'&&(!Number.isFinite(age)||age>30000||age< -1000)?'stale':q.status;
      return 'Snapshot · bid '+price(q.bid)+' / ask '+price(q.ask)+' USD\n'+String(state)+' · '+String(q.provider||'provider unspecified')+' · '+String(q.feed)+' · market '+String(q.session)+'\nAs of '+String(q.as_of||'unknown');
    }
    async function financials(symbol,mic){
      const key=symbol+':'+mic,old=quoteCache.get(key);
      if(old&&Date.now()-old.at<60000)return old.promise;
      const promise=ask('leadership-quote?symbol='+encodeURIComponent(symbol)+'&mic='+encodeURIComponent(mic)).catch(e=>({code:e.code||'unavailable'}));
      quoteCache.set(key,{at:Date.now(),promise});return promise;
    }
    async function paintQuote(symbol,mic){const data=await financials(symbol,mic);if(!alive||locked||!visible)return;
      if(selected?.symbol===symbol&&selected?.mic===mic&&$('[data-r-quote-status]'))$('[data-r-quote-status]').textContent=quoteText(data);
      const label=pinLabels.get(symbol+':'+mic);if(label&&hovered===symbol+':'+mic){label.text=symbol+' · company HQ\n'+quoteText(data);viewer()?.scene.requestRender();}
    }
    function mapCompanies(){clearPins();const v=viewer();if(!alive||locked||!visible||!v||!C)return;
      pins=v.scene.primitives.add(new C.PointPrimitiveCollection());labels=v.scene.primitives.add(new C.LabelCollection());
      const places=catalog.filter(c=>c.headquarters?.geolocation);
      for(const c of places){const h=c.headquarters,g=h.geolocation,pos=C.Cartesian3.fromDegrees(g.longitude,g.latitude,100),id={marketPick:true,financeCompany:true,symbol:c.symbol,mic:c.mic};
        pins.add({position:pos,pixelSize:12,color:C.Color.fromCssColorString('#f2b448'),outlineColor:C.Color.BLACK,outlineWidth:2,id,disableDepthTestDistance:Number.POSITIVE_INFINITY});
        const label=labels.add({position:pos,text:c.symbol+' · company HQ',font:'600 12px sans-serif',fillColor:C.Color.WHITE,outlineColor:C.Color.BLACK,outlineWidth:3,style:C.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new C.Cartesian2(0,-18),id,distanceDisplayCondition:new C.DistanceDisplayCondition(0,2e7)});pinLabels.set(c.symbol+':'+c.mic,label);
      }
      hover=new C.ScreenSpaceEventHandler(v.scene.canvas);hover.setInputAction(m=>{
        const id=v.scene.pick(m.endPosition)?.id,key=id?.financeCompany?id.symbol+':'+id.mic:null;
        if(key===hovered)return;clearTimeout(hoverTimer);
        for(const [k,label] of pinLabels)label.text=k.split(':')[0]+' · company HQ';hovered=key;v.scene.requestRender();
        if(key)hoverTimer=setTimeout(()=>void paintQuote(id.symbol,id.mic),200);
      },C.ScreenSpaceEventType.MOUSE_MOVE);
      v.scene.requestRender();$('[data-r-status]').textContent=places.length+' company business addresses shown. Pins do not locate executives; select a company to read its roster.';
    }
    function locate(){const g=detail?.company.headquarters?.geolocation,v=viewer();if(!g||!v||!visible||locked)return;mapCompanies();v.camera.flyTo({destination:C.Cartesian3.fromDegrees(g.longitude,g.latitude,3000),duration:1});}
    function click(e){const b=e.target.closest('button');if(!b||locked)return;if(b.dataset.rSymbol)select(b.dataset.rSymbol,b.dataset.rMic);if(b.hasAttribute('data-r-map'))mapCompanies();if(b.hasAttribute('data-r-clear'))clearPins();if(b.hasAttribute('data-r-reload'))load();if(b.hasAttribute('data-r-locate'))locate();if(b.hasAttribute('data-r-quote')&&detail)paintQuote(detail.company.ticker,detail.company.mic);}
    root.addEventListener('click',click);load();
    return {select,clear,setVisible(value){visible=!!value;if(!visible)clearPins();},destroy(){alive=false;generation++;clearPins();root.removeEventListener('click',click);root.textContent='';}};
  }
  window.HaloFinanceRoster=Object.freeze({mount});
})();
