/* Native Control · Create · Song Test.

   The owner's read of "Was this song racist? Why?": per song, how the
   listeners voted and every reason they gave. Listeners only ever see the
   split; the reasons are read here, under the owner's row-level access
   to public.song_verdicts. Which songs carry the test is public.song_tests. */
(function(){
  "use strict";
  window.CR=window.CR||{};
  var S={supa:null,rerender:null,loading:false,loaded:false,error:null,tests:[],answers:[],track:null,filter:"all"};
  var LABEL={yes:"Yes",no:"No",unsure:"Not sure"};
  function e(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function note(t,bad){return'<div class="cro-note'+(bad?" cro-note--bad":"")+'">'+e(t)+'</div>';}
  function redraw(){if(S.rerender)S.rerender();}
  function load(){
    if(S.loading)return Promise.resolve();
    S.loading=true;S.error=null;redraw();
    return Promise.all([
      S.supa("song_tests?select=*&order=album.asc,sort.asc"),
      S.supa("song_verdicts?select=track_key,verdict,why,created_at,updated_at&order=updated_at.desc&limit=5000")
    ]).then(function(out){
      S.tests=out[0]||[];S.answers=out[1]||[];
      if(!S.track&&S.tests.length)S.track=S.tests[0].track_key;
    }).catch(function(err){S.error=err;}).then(function(){S.loading=false;S.loaded=true;redraw();});
  }
  function render(){
    if(!S.loaded&&!S.loading)load();
    var head=S.loading&&!S.loaded?note("Loading the song test…"):S.error?note("The song test could not be read: "+(S.error.message||S.error)+". If the table is missing, the song test migration has not been applied.",true):"";
    if(!S.tests.length)return'<div class="cro">'+head+(S.loaded&&!S.error?note("No song carries the test yet."):"")+'</div>';
    var chips='<div class="cro-chips">'+S.tests.map(function(t){var n=S.answers.filter(function(a){return a.track_key===t.track_key;}).length;return'<button class="cro-chip'+(t.track_key===S.track?" is-on":"")+'" type="button" data-crs-track="'+e(t.track_key)+'">'+e(t.label)+' · '+n+'</button>';}).join("")+'</div>';
    var rows=S.answers.filter(function(a){return a.track_key===S.track;}),total=rows.length,c={yes:0,no:0,unsure:0};
    rows.forEach(function(a){c[a.verdict]=(c[a.verdict]||0)+1;});
    var stats='<div class="cro-statgrid">'+["yes","no","unsure"].map(function(k){return'<div class="cro-stat"><b>'+(total?Math.round(c[k]/total*100):0)+'%</b><span>'+LABEL[k]+' · '+c[k]+'</span></div>';}).join("")+'<div class="cro-stat"><b>'+total+'</b><span>answers</span></div></div>';
    var filt='<div class="cro-chips" style="margin-top:10px">'+[["all","All"],["yes","Yes"],["no","No"],["unsure","Not sure"]].map(function(f){return'<button class="cro-chip'+(S.filter===f[0]?" is-on":"")+'" type="button" data-crs-filter="'+f[0]+'">'+f[1]+'</button>';}).join("")+'</div>';
    var shown=rows.filter(function(a){return S.filter==="all"||a.verdict===S.filter;});
    var list=shown.length?'<div class="cro-list">'+shown.map(function(a){return'<div class="cro-row"><div class="cro-row__top"><b>'+e(LABEL[a.verdict]||a.verdict)+'</b><span class="cro-meta">'+e(new Date(a.updated_at||a.created_at).toLocaleString())+'</span></div><div>'+e(a.why)+'</div></div>';}).join("")+'</div>':note(total?"No answers with that verdict.":"Nobody has answered this one yet.");
    return'<div class="cro">'+head+chips+'<section class="cro-card" style="margin-top:10px"><h2>Was this song racist?</h2>'+stats+filt+'<div style="margin-top:10px">'+list+'</div><p class="cro-meta" style="margin-top:8px">Listeners see the split after they answer; only you see the reasons. An answer counts only from someone the server heard listen to the whole song.</p></section></div>';
  }
  function bind(root){
    if(!root)return;
    root.querySelectorAll("[data-crs-track]").forEach(function(b){b.onclick=function(){S.track=b.getAttribute("data-crs-track");S.filter="all";redraw();};});
    root.querySelectorAll("[data-crs-filter]").forEach(function(b){b.onclick=function(){S.filter=b.getAttribute("data-crs-filter");redraw();};});
  }
  window.CR.songTest={init:function(opts){S.supa=opts.supa;S.rerender=opts.render;},render:render,bind:bind,load:load,state:S};
})();
