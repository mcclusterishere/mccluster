/* Read-through, owner-only inspector. Source authorities retain every record. */
(function(){
 'use strict'; window.CR=window.CR||{};
 var S={data:null,error:'',busy:false,seq:0,kind:'actor',root:'actor:royce.r01'}, repaint=null;
 var kinds=['actor','organization','application','objective','agent_job','evidence','claim','briefing','decision','mission','outcome','actor_review','publication'];
 function owner(){return !!window.MCC_BAR&&window.MCC_BAR.admin()===true;}
 function esc(x){return String(x==null?'':x).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function pretty(x){return String(x||'unknown').replace(/_/g,' ');}
 function when(x){var d=new Date(x);return x&&Number.isFinite(d.getTime())?d.toLocaleString():'Time not recorded';}
 function href(x){try{var u=new URL(x);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:'';}catch(_){return '';}}
 function render(){
  if(!owner())return '';
  var d=S.data, nodes=d&&d.nodes||[], edges=d&&d.edges||[], labels={};nodes.forEach(function(n){labels[n.id]=n.label;});
  return '<section class="cu-card cg-card" aria-labelledby="cgTitle"><div class="cu-heading"><h2 id="cgTitle">Connected operations</h2><span class="cu-badge">Private · owner</span></div><p>Follow entities, events, evidence, decisions and outcomes. Each connection comes from an existing source record.</p>'+
   '<form id="cgBrowse"><label>Record type<select id="cgKind">'+kinds.map(function(k){return '<option value="'+k+'"'+(k===S.kind?' selected':'')+'>'+esc(pretty(k))+'</option>';}).join('')+'</select></label><button type="submit"'+(S.busy?' disabled':'')+'>Browse records</button><button type="button" data-cg-royce'+(S.busy?' disabled':'')+'>Explore Royce</button></form>'+
   (S.busy?'<p role="status">Reading connected records…</p>':'')+(S.error?'<p role="alert" class="cu-warning">'+esc(S.error)+'</p>':'')+
   (d?'<p>'+nodes.length+' records · '+edges.length+' connections · '+(d.root?'up to '+d.depth+' links from the selected record':'recent '+esc(pretty(S.kind))+' records')+(d.truncated?' · Sample limit reached; open a record to narrow the view.':'')+'</p><p class="cu-note">'+esc(d.basis)+'</p>'+(!nodes.length?'<p>No recorded '+esc(pretty(S.kind))+' data in this view. Missing records are not a verified negative finding.</p>':'')+
   '<div class="cg-nodes">'+nodes.map(function(n){var url=href(n.source&&n.source.url);return '<article class="cg-node"><small>'+esc(pretty(n.category))+' · '+esc(pretty(n.kind))+'</small><h3><button type="button" data-cg-node="'+esc(n.id)+'"'+(S.busy?' disabled':'')+'>'+esc(n.label||n.id)+'</button></h3><p>'+esc(pretty(n.status))+' · '+esc(when(n.occurred_at))+'</p>'+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open source ↗</a>':'')+'<details><summary>Evidence and record details</summary><pre>'+esc(JSON.stringify({source:n.source,detail:n.detail},null,2))+'</pre></details></article>';}).join('')+'</div>'+
   (edges.length?'<details open><summary>Recorded relationships</summary><ul class="cg-edges">'+edges.map(function(e){return '<li><button type="button" data-cg-node="'+esc(e.source)+'">'+esc(labels[e.source]||e.source)+'</button><span> '+esc(pretty(e.relation))+' → </span><button type="button" data-cg-node="'+esc(e.target)+'">'+esc(labels[e.target]||e.target)+'</button><small>Source: '+esc(e.provenance&&e.provenance.table||'typed ontology link')+'</small></li>';}).join('')+'</ul></details>':'<p>No explicit relationships recorded in this sample.</p>')+
   '<details><summary>Coverage across connected sources</summary><ul>'+kinds.map(function(k){var count=(d.counts||[]).find(function(c){return c.kind===k;});return '<li>'+esc(pretty(k))+': '+(count?Number(count.count).toLocaleString():'0')+'</li>';}).join('')+'</ul><p>Publication is an observed output. Audience impact and causation require separate measurements.</p></details>':'<p>Explore Royce’s real publication trail, or browse evidence and other existing records.</p>')+'</section>';
 }
 async function load(request,paint,root){
  if(!owner()||S.busy)return;var seq=++S.seq;S.busy=true;S.error='';S.data=null;S.root=root;paint();
  try{if(!await window.MCC_BAR.verifyAdmin()||!owner()||seq!==S.seq)return;
   var data=await request('/v1/intel/connections?kind='+encodeURIComponent(S.kind)+'&depth=3&limit=60'+(root?'&root='+encodeURIComponent(root):''));
   if(seq!==S.seq||!owner())return;
   if(!data||data.schema!=='connected-operations/v1'||!Array.isArray(data.nodes)||!Array.isArray(data.edges))throw Error('Connected records are unavailable.');S.data=data;
  }catch(e){if(seq===S.seq&&owner())S.error=e.message||'Unable to read connections.';}finally{if(seq===S.seq){S.busy=false;paint();}}
 }
 function bind(root,request,paint){repaint=paint;if(!owner())return;var form=root.querySelector('#cgBrowse');if(!form)return;
  form.onsubmit=function(e){e.preventDefault();S.kind=root.querySelector('#cgKind').value;load(request,paint,null);};
  root.querySelector('[data-cg-royce]').onclick=function(){S.kind='actor';load(request,paint,'actor:royce.r01');};
  root.querySelectorAll('[data-cg-node]').forEach(function(b){b.onclick=function(){load(request,paint,b.dataset.cgNode);};});
 }
 function clear(){++S.seq;S.data=null;S.error='';S.busy=false;if(repaint)repaint();}
 window.addEventListener('mcc:appbar-admin',function(){if(!owner())clear();});
 window.addEventListener('mcc:auth-changed',function(e){if(e.detail&&e.detail.signed_in===false)clear();});
 window.addEventListener('storage',function(e){if(e.key==='mccdb_session')clear();});
 window.CR.connections={render:render,bind:bind,state:S};
})();
