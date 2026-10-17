/* One navigation model for touch, tabs and keyboard. The Earth is outside this
   viewport and retains its scene, camera and selection across every chapter. */
(function(){
  'use strict';window.CR=window.CR||{};
  var sections=[['overview','Overview','The essential signals'],['audience','Audience','Reach, return visits and behavior'],['identity','Journeys','From first visit to account'],['content','Content','Music, attention and engagement'],['action','Action & business','Participation, proof and commerce'],['intelligence','World intelligence','Explore connected sources'],['cameras','Cameras','Catalog and verified image coverage'],['adaptive','Adaptive','Decisions and experiments'],['forensics','Site health','Errors and interrupted journeys'],['inventory','Data coverage','Sources, stored records and fields'],['setup','Setup','Properties and collection']];
  var reads=[['hourly','Hourly traffic','audience'],['daily','Daily traffic','audience'],['totals','Audience totals','audience'],['business','Accounts, music & sales','action',true],['pages','Page engagement','audience'],['sources','Referrers','audience'],['countries','Top countries','audience'],['geo','Globe coverage','overview'],['intel','Intelligence evidence','intelligence',true],['networks','Network breakdown','audience'],['contentEvents','Media events','content'],['content','Track activity','content'],['acquisition','Acquisition','audience'],['paths','Page transitions','audience'],['funnel','Conversion funnel','identity',true],['identity','Signup journeys','identity',true],['audienceScience','Listening behavior','audience',true],['experience','Adaptive decisions','adaptive',true],['countryTotals','Country visitors','overview'],['visitors','Returning visitors','audience',true],['flows','Session flows','audience',true],['errors','Site errors & friction','forensics',true],['coverage','Stored record counts','inventory',true],['missions','Mission assignments','action',true]];
  function applicable(S){return reads.filter(function(r){return (!r[3]||S.site==='__first_party__')&&(r[0]!=='hourly'||S.rangeId==='24h')&&(r[0]!=='daily'||S.rangeId!=='24h');});}
  function health(S){
    var rows=applicable(S),errors=S.errors||{},done=S.completed||{},failed=rows.filter(function(r){return errors[r[0]];}).length;
    return '<section class="cu-card cad-health"><h2>Data connections</h2><p class="cu-note">'+rows.filter(function(r){return done[r[0]]&&!errors[r[0]];}).length+' of '+rows.length+' reads ready'+(failed?' · '+failed+' unavailable':'')+'. Ready means the request succeeded; an empty dataset can still be ready. Camera checks and provider snapshots run when requested.</p><ul>'+rows.map(function(r){var error=errors[r[0]],status=error?'Unavailable':done[r[0]]?'Ready':'Waiting';return '<li><div><b>'+esc(r[1])+'</b><small>'+esc(error?(error.message||String(error)):status)+'</small></div><button type="button" data-cra-sec="'+r[2]+'" aria-label="Open '+esc(r[1])+'">'+status+' ↗</button></li>';}).join('')+'</ul></section>';
  }
  var scroll={},active='overview',timer;
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function entry(id){return sections.find(function(s){return s[0]===id;})||sections[0];}
  function render(S,content){
    var item=entry(S.section),index=sections.indexOf(item);
    return '<div class="cad-deck"><nav class="cad-tabs" role="tablist" aria-label="Analytics views">'+sections.map(function(s){var on=s[0]===S.section;return '<button type="button" role="tab" id="cad-tab-'+s[0]+'" aria-controls="cad-panel" aria-selected="'+on+'" tabindex="'+(on?'0':'-1')+'" data-cra-sec="'+s[0]+'">'+s[1]+'</button>';}).join('')+'</nav>'+
      '<div class="cad-chapter"><div><small>'+String(index+1).padStart(2,'0')+' / '+sections.length+'</small><h2>'+item[1]+'</h2><p>'+item[2]+'</p></div><div class="cad-arrows"><button type="button" data-cad-step="-1" aria-label="Previous analytics view"'+(index===0?' disabled':'')+'>←</button><button type="button" data-cad-step="1" aria-label="Next analytics view"'+(index===sections.length-1?' disabled':'')+'>→</button></div></div>'+
      '<section class="cad-body" id="cad-panel" role="tabpanel" tabindex="0" aria-labelledby="cad-tab-'+item[0]+'" data-cu-details>'+content+'</section>'+
      '<footer class="cad-footer"><span role="status">'+(S.loading?'Updating…':Object.keys(S.errors||{}).length?'Some reads unavailable':S.updatedAt?'Updated '+esc(new Date(S.updatedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})):'Ready')+'</span><button type="button" data-cad-health aria-label="Inspect data connections">Data status</button><button type="button" data-cad-refresh'+(S.loading?' disabled':'')+'>Refresh</button><button type="button" data-cad-auto aria-pressed="'+!!S.autoRefresh+'">Auto · '+(S.autoRefresh?'60s':'off')+'</button><span class="cad-swipe-hint">Swipe to change view</span></footer></div>';
  }
  function before(root){
    var body=root.querySelector('.cad-body');if(body)scroll[active]=body.scrollTop;
    var focus=document.activeElement, saved={};
    if(root.contains(focus))saved.focus=focus.id||null;
    saved.controls=[].map.call(root.querySelectorAll('input,textarea,select'),function(el){return{id:el.id,value:el.value,start:el.selectionStart,end:el.selectionEnd,source:el.getAttribute('data-source')};}).filter(function(el){return el.id;});
    saved.open=[].map.call(root.querySelectorAll('details[open]'),function(el){return el.querySelector('summary')?.textContent;});
    return saved;
  }
  function bind(root,S,select,refresh,saved){
    var changed=active!==S.section;active=S.section;
    var body=root.querySelector('.cad-body'),tabs=root.querySelector('.cad-tabs');
    if(body)body.scrollTop=scroll[active]||0;
    if(saved&&!changed){
      (saved.controls||[]).forEach(function(c){var el=document.getElementById(c.id);if(el&&root.contains(el)&&c.source===el.getAttribute('data-source')){el.value=c.value;if(c.id===saved.focus){el.focus({preventScroll:true});if(el.setSelectionRange&&c.start!=null)try{el.setSelectionRange(c.start,c.end);}catch(_){}}}});
      root.querySelectorAll('details').forEach(function(el){if((saved.open||[]).includes(el.querySelector('summary')?.textContent))el.open=true;});
    }
    function go(i,focus){var next=sections[Math.max(0,Math.min(sections.length-1,i))];if(next[0]===S.section)return;select(next[0]);if(focus){var b=document.getElementById('cad-tab-'+next[0]);if(b)b.focus({preventScroll:true});}}
    if(tabs){var selected=tabs.querySelector('[aria-selected="true"]');if(selected)tabs.scrollLeft=Math.max(0,selected.offsetLeft-tabs.offsetLeft-(tabs.clientWidth-selected.clientWidth)/2);
      tabs.onkeydown=function(ev){var i=sections.findIndex(function(s){return s[0]===S.section;});if(['ArrowLeft','ArrowRight','Home','End'].includes(ev.key)){ev.preventDefault();go(ev.key==='Home'?0:ev.key==='End'?sections.length-1:i+(ev.key==='ArrowRight'?1:-1),true);}};
    }
    root.querySelectorAll('[data-cad-step]').forEach(function(b){b.onclick=function(){go(sections.findIndex(function(s){return s[0]===S.section;})+Number(b.dataset.cadStep),true);};});
    var start=null;
    [body,root.querySelector('.cad-chapter')].filter(Boolean).forEach(function(surface){
      surface.addEventListener('touchstart',function(ev){
        start=null;if(ev.touches.length!==1||ev.target.closest('input,select,textarea,button,a,svg,canvas,.cra-table-wrap,.cra-chart__scroll,.cu-source-grid'))return;
        var el=ev.target;while(el&&el!==surface){if(el.scrollWidth>el.clientWidth+2&&/auto|scroll/.test(getComputedStyle(el).overflowX))return;el=el.parentElement;}
        start={x:ev.touches[0].clientX,y:ev.touches[0].clientY};
      },{passive:true});
      surface.addEventListener('touchend',function(ev){if(!start)return;var p=ev.changedTouches[0],dx=p.clientX-start.x,dy=p.clientY-start.y;start=null;if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.7)go(sections.findIndex(function(s){return s[0]===S.section;})+(dx<0?1:-1),false);},{passive:true});
      surface.addEventListener('touchcancel',function(){start=null;},{passive:true});
    });
    var statusButton=root.querySelector('[data-cad-health]');if(statusButton)statusButton.onclick=function(){select('inventory');};
    var button=root.querySelector('[data-cad-refresh]');if(button)button.onclick=refresh;
    button=root.querySelector('[data-cad-auto]');if(button)button.onclick=function(){S.autoRefresh=!S.autoRefresh;select(S.section);};
    clearTimeout(timer);
    if(S.autoRefresh)timer=setTimeout(function tick(){if(!S.autoRefresh)return;if(!document.hidden&&root.isConnected&&!S.loading&&!document.activeElement?.matches('input,textarea,select,[contenteditable=true]')&&!window.CR.analyticsCameras?.state.running)refresh();else timer=setTimeout(tick,60000);},60000);
  }
  function fit(host){
    if(!host||!host.isConnected)return;
    var app=host.querySelector('.cad-app');if(!app)return;
    var bottom=window.innerHeight-8;
    document.querySelectorAll('.appbar,.cr-bottom').forEach(function(el){var r=el.getBoundingClientRect();if(r.height&&r.top>0&&getComputedStyle(el).position==='fixed')bottom=Math.min(bottom,r.top-8);});
    app.style.setProperty('--cad-height',Math.max(320,bottom-app.getBoundingClientRect().top)+'px');
  }
  window.CR.analyticsDeck={render:render,bind:bind,before:before,fit:fit,sections:sections,health:health,reads:reads};
})();
