/* Native Work tools: Outreach and Operations. No legacy room iframe. */
(function(){
  "use strict";
  window.CR=window.CR||{};
  var O={supa:null,request:null,refresh:null,rerender:null,getState:null,
    outreach:{loaded:false,loading:false,error:null,stage:null,index:0,pick:null,templates:[],moves:[],pipeline:[],signals:{}},
    ops:{loaded:false,loading:false,error:null,tab:"orders",rightsRows:[],rightsFlags:{},gallery:null,prints:null}};
  function e(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function money(v){v=Number(v)||0;return"$"+(Math.round(v*100)/100).toLocaleString();}
  function ago(v){if(!v)return"—";var ms=Date.now()-new Date(v).getTime(),m=Math.max(0,Math.floor(ms/60000));if(m<60)return m+"m";var h=Math.floor(m/60);if(h<24)return h+"h";return Math.floor(h/24)+"d";}
  function note(msg,bad){return'<div class="cro-note'+(bad?" cro-note--bad":"")+'">'+e(msg)+'</div>';}
  function state(){return O.getState?O.getState():{};}
  function rerender(){if(O.rerender)O.rerender();}
  function fill(t,c){
    var me=location.origin,wall=c.event_id?me+"/walls/"+c.event_id+".html":me+"/walls.html";
    var map={name:(c.name||"").split(" ")[0],org:c.org||"your team",event:c.event_id?c.event_id.replace(/-/g," "):"a recent event",wall:wall,me:me,subject_prev:"photographs"};
    function sub(s){return String(s||"").replace(/\{\{(\w+)\}\}/g,function(_,k){return map[k]!=null?map[k]:"";});}
    return{subject:sub(t&&t.subject),body:sub(t&&t.body),id:t&&t.id,stage_to:t&&t.stage_to,wait:(t&&t.wait_days)||4};
  }
  function loadOutreach(){
    var x=O.outreach;if(x.loading)return Promise.resolve();x.loading=true;x.error=null;rerender();
    var path="crm_next_move?select=*"+(x.stage?"&stage=eq."+encodeURIComponent(x.stage):"");
    return Promise.all([O.supa("crm_templates?select=*&order=id"),O.supa(path),O.supa("crm_pipeline?select=*")])
      .then(function(r){x.templates=r[0]||[];x.moves=r[1]||[];x.pipeline=r[2]||[];var ids=x.moves.map(function(m){return m.id;}).slice(0,12);if(!ids.length){x.signals={};return null;}return O.supa("crm_signals?select=contact_id,kind,detail&contact_id=in.("+ids.join(",")+")&order=at.desc&limit=80").then(function(rows){x.signals={};(rows||[]).forEach(function(s){(x.signals[s.contact_id]=x.signals[s.contact_id]||[]).push(s);});});})
      .catch(function(err){x.error=err;}).then(function(){x.loading=false;x.loaded=true;rerender();});
  }
  function stageStrip(){
    var x=O.outreach,order=["new","contacted","replied","meeting","proposal","nurture","won"],by={};x.pipeline.forEach(function(p){by[p.stage]=p;});
    return'<div class="cro-chips">'+order.map(function(s){var p=by[s]||{n:0};return'<button type="button" class="cro-chip'+(x.stage===s?" is-on":"")+'" data-cro-stage="'+s+'">'+e(s)+' · '+e(p.n||0)+'</button>';}).join("")+'</div>';
  }
  function outreach(){
    var x=O.outreach;if(!x.loaded&&!x.loading)loadOutreach();
    if(x.loading&&!x.loaded)return note("Reading outreach queue…");
    if(x.error)return note("Outreach did not load: "+(x.error.message||x.error),true);
    var c=x.moves[x.index];
    var add='<details class="cro-details"><summary>+ Add contact</summary><div class="cro-details__body"><div class="cro-form cro-form--2"><label>Name<input id="croAddName"></label><label>Email<input id="croAddEmail" type="email"></label><label>Role<input id="croAddRole"></label><label>Organization<input id="croAddOrg"></label><label>Event ID<input id="croAddEvent"></label><label>Kind<select id="croAddKind"><option>press</option><option>county</option><option>nonprofit</option><option>brand</option><option>venue</option><option>agency</option></select></label></div><div class="cro-actions" style="margin-top:8px"><button class="cr-btn cr-btn--primary" type="button" data-cro-add>Add and queue</button></div></div></details>';
    if(!c)return'<div class="cro">'+stageStrip()+note("Desk clear. Nothing is due.")+add+'</div>';
    var picks=x.templates.filter(function(t){return!t.stage_from||t.stage_from===c.stage;});if(!picks.length)picks=x.templates;var t=x.pick?x.templates.find(function(q){return String(q.id)===String(x.pick);})||picks[0]:picks[0]||{},d=fill(t,c),sig=x.signals[c.id]||[];
    return'<div class="cro">'+stageStrip()+'<div class="cro-grid cro-grid--2"><section class="cro-card"><div class="cro-row__top"><div><span class="cro-pill">'+e(c.stage||"new")+'</span><h2 style="margin-top:8px">'+e(c.name||"Contact")+'</h2><div class="cro-meta">'+e([c.role,c.org].filter(Boolean).join(" · "))+'</div></div><b>'+e(x.moves.length-x.index-1)+' waiting</b></div><p>'+e(c.why||"Next follow-up selected by the canonical queue.")+'</p><div class="cro-heat"><span>heat</span><span class="cro-heat__bar"><i style="--pct:'+Math.max(0,Math.min(100,Number(c.heat_now)||0))+'%"></i></span><b>'+e(c.heat_now||0)+'</b></div>'+(sig.length?'<div class="cro-chips" style="margin-top:9px">'+sig.slice(0,6).map(function(s){return'<span class="cro-pill">'+e(String(s.kind||"").replace(/_/g," "))+(s.detail?" · "+e(s.detail):"")+'</span>';}).join("")+'</div>':"")+'</section><section class="cro-card"><h2>Message</h2><div class="cro-chips">'+picks.map(function(q){return'<button type="button" class="cro-chip'+(String(q.id)===String(t.id)?" is-on":"")+'" data-cro-template="'+e(q.id)+'">'+e(q.label||q.id)+'</button>';}).join("")+'</div><div class="cro-form" style="margin-top:8px"><label>Subject<input id="croSubject" value="'+e(d.subject)+'"></label><label>Message<textarea id="croBody">'+e(d.body)+'</textarea></label></div><div class="cro-actions" style="margin-top:8px"><button class="cr-btn cr-btn--primary" type="button" data-cro-send="'+e(c.id)+'" data-stage-to="'+e(d.stage_to||"contacted")+'" data-wait="'+e(d.wait||4)+'" data-template="'+e(t.id||"")+'"'+(c.email?"":" disabled")+'>'+(c.email?"Send it":"No email")+'</button><button class="cr-btn" type="button" data-cro-later>Later</button><button class="cr-btn" type="button" data-cro-nurture="'+e(c.id)+'">Nurture</button></div></section></div>'+add+'</div>';
  }
  function laneOf(r){var c=String(r&&r.campaign||"").toLowerCase();if(c==="print-shop")return"orders";if(c==="merch-shop")return"merch";if(c==="gallery-waitlist")return"waitlist";if(c==="tap-card")return"cards";return"bookings";}
  function priceFrom(r){var m=String(r.note||"").match(/\$([\d,.]+)/);return m?parseFloat(m[1].replace(/,/g,""))||0:0;}
  function loadOps(){
    var x=O.ops;if(x.loading)return Promise.resolve();x.loading=true;x.error=null;rerender();
    return Promise.all([
      fetch("data/gallery.json",{cache:"no-store"}).then(function(r){if(!r.ok)throw new Error("gallery "+r.status);return r.json();}),
      fetch("data/prints.json",{cache:"no-store"}).then(function(r){if(!r.ok)throw new Error("prints "+r.status);return r.json();}),
      O.supa("rights_flags?select=id,rights,note").catch(function(){return[];})
    ]).then(function(r){x.gallery=r[0];x.prints=r[1];x.rightsFlags={};(r[2]||[]).forEach(function(f){x.rightsFlags[f.id]=f.rights;});var rows=[];(x.prints.photos||[]).forEach(function(p){rows.push({id:p.id,label:p.title||p.id,base:p.rights||"editorial",media:[]});});(x.gallery.events||[]).forEach(function(ev){rows.push({id:ev.id,label:ev.title||ev.id,base:ev.rights||"editorial",media:(ev.media||[]).map(function(m){return m.id;}).filter(Boolean)});});x.rightsRows=rows;})
      .catch(function(err){x.error=err;}).then(function(){x.loading=false;x.loaded=true;rerender();});
  }
  function leadTable(rows){
    if(!rows.length)return note("Nothing in this lane.");
    return'<div class="cro-list">'+rows.map(function(r){return'<div class="cro-item" data-cro-lead="'+e(r.id)+'"><div class="cro-item__head"><div><strong>'+e(r.name||r.email||"Lead")+'</strong><div class="cro-meta">'+e(r.email||"")+' · '+e(ago(r.at||r.created_at))+'</div></div><span class="cro-pill">'+e(r.status||"new")+'</span></div>'+(r.note?'<div class="cro-meta">'+e(r.note)+'</div>':"")+'<div class="cro-actions">'+["new","replied","booked","closed"].map(function(st){return'<button class="cr-btn'+((r.status||"new")===st?" cr-btn--primary":"")+'" type="button" data-cro-lead-status="'+st+'" data-id="'+e(r.id)+'">'+e(st)+'</button>';}).join("")+'</div></div>';}).join("")+'</div>';
  }
  function rights(){
    var x=O.ops;if(!x.rightsRows.length)return note("No rights rows returned.");
    return'<div class="cro-tablewrap"><table class="cro-table"><thead><tr><th>Asset</th><th>Effective rights</th><th>Base</th><th></th></tr></thead><tbody>'+x.rightsRows.map(function(r){var eff=x.rightsFlags[r.id]||r.base;return'<tr><td><b>'+e(r.label)+'</b></td><td>'+e(eff)+'</td><td>'+e(r.base)+'</td><td><button class="cr-btn" type="button" data-cro-rights="'+e(r.id)+'" data-next="'+(eff==="released"?"editorial":"released")+'">'+(eff==="released"?"Make editorial":"Make released")+'</button></td></tr>';}).join("")+'</tbody></table></div>';
  }
  function operations(){
    var x=O.ops,st=state(),leads=st.leads||[];if(!x.loaded&&!x.loading)loadOps();
    var tabs=[["orders","Prints"],["merch","Merch"],["bookings","Bookings"],["cards","Cards"],["waitlist","Waitlist"],["walls","Walls"],["shop","Shop"],["rights","Rights"]];
    var body="";
    if(["orders","merch","bookings","cards","waitlist"].indexOf(x.tab)>=0)body=leadTable(leads.filter(function(r){return laneOf(r)===x.tab;}));
    else if(x.tab==="walls")body=x.gallery?'<div class="cro-list">'+(x.gallery.events||[]).map(function(ev){return'<div class="cro-item"><strong>'+e(ev.title||ev.id)+'</strong><div class="cro-meta">'+e(ev.date||ev.subtitle||"")+' · '+e((ev.media||[]).length)+' media</div></div>';}).join("")+'</div>':note("Walls data is loading…");
    else if(x.tab==="shop")body=x.prints?'<div class="cro-list">'+(x.prints.photos||[]).map(function(p){return'<div class="cro-item cro-media">'+(p.src?'<img src="'+e(p.src)+'" alt="">':'<div class="cro-media__ph">print</div>')+'<div><strong>'+e(p.title||p.id)+'</strong><div class="cro-meta">'+e(p.id||"")+'</div></div></div>';}).join("")+'</div>':note("Shop data is loading…");
    else body=rights();
    var orders=leads.filter(function(r){return["orders","merch"].indexOf(laneOf(r))>=0;}),rev=orders.reduce(function(a,r){return a+priceFrom(r);},0),week=Date.now()-7*86400000;
    return'<div class="cro"><div class="cro-statgrid"><div class="cro-stat"><b>'+e(orders.filter(function(r){return(r.status||"new")==="new";}).length)+'</b><span>orders to fill</span></div><div class="cro-stat"><b>'+e(money(rev))+'</b><span>ordered</span></div><div class="cro-stat"><b>'+e(leads.filter(function(r){return new Date(r.at||r.created_at).getTime()>week;}).length)+'</b><span>new · 7 days</span></div><div class="cro-stat"><b>'+e(leads.filter(function(r){return laneOf(r)==="waitlist";}).length)+'</b><span>waitlist</span></div></div><div class="cro-tabs">'+tabs.map(function(t){return'<button class="cro-tab'+(x.tab===t[0]?" is-on":"")+'" type="button" data-cro-opstab="'+t[0]+'">'+t[1]+'</button>';}).join("")+'</div>'+(x.error?note("Some operation sources did not load: "+(x.error.message||x.error),true):"")+body+'</div>';
  }
  function sendMail(c,subject,body,template,stageTo,wait,btn){
    btn.disabled=true;btn.textContent="Sending…";
    return window.MCC_SUPA.token().then(function(t){return fetch(window.MCC_SUPA.url+"/functions/v1/send-mail",{method:"POST",headers:{apikey:window.MCC_SUPA.key,Authorization:"Bearer "+t,"content-type":"application/json"},body:JSON.stringify({to:c.email,subject:subject,text:body,contact_id:c.id})});})
      .then(function(r){return r.ok?"sent":"manual";}).catch(function(){return"manual";})
      .then(function(how){var due=new Date();due.setDate(due.getDate()+(Number(wait)||4));return Promise.all([O.supa("crm_touches",{method:"POST",body:{contact_id:c.id,direction:"out",channel:"email",subject:subject,body:body,template_id:template,status:how==="sent"?"sent":"draft"}}),O.supa("crm_contacts?id=eq."+encodeURIComponent(c.id),{method:"PATCH",body:{stage:stageTo,last_touch:new Date().toISOString(),next_at:due.toISOString().slice(0,10)}})]).then(function(){if(how==="manual")location.href="mailto:"+encodeURIComponent(c.email)+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body);O.outreach.index=0;O.outreach.pick=null;return loadOutreach();});})
      .catch(function(err){btn.disabled=false;btn.textContent="Retry";throw err;});
  }
  function bind(root){
    if(!root)return;
    root.querySelectorAll("[data-cro-stage]").forEach(function(b){b.onclick=function(){var s=b.getAttribute("data-cro-stage");O.outreach.stage=O.outreach.stage===s?null:s;O.outreach.index=0;O.outreach.pick=null;loadOutreach();};});
    root.querySelectorAll("[data-cro-template]").forEach(function(b){b.onclick=function(){O.outreach.pick=b.getAttribute("data-cro-template");rerender();};});
    var later=root.querySelector("[data-cro-later]");if(later)later.onclick=function(){O.outreach.index++;O.outreach.pick=null;rerender();};
    root.querySelectorAll("[data-cro-nurture]").forEach(function(b){b.onclick=function(){var d=new Date();d.setDate(d.getDate()+30);O.supa("crm_contacts?id=eq."+encodeURIComponent(b.getAttribute("data-cro-nurture")),{method:"PATCH",body:{stage:"nurture",next_at:d.toISOString().slice(0,10)}}).then(function(){O.outreach.index=0;return loadOutreach();});};});
    root.querySelectorAll("[data-cro-send]").forEach(function(b){b.onclick=function(){var c=O.outreach.moves.find(function(x){return String(x.id)===String(b.getAttribute("data-cro-send"));});if(!c)return;sendMail(c,(root.querySelector("#croSubject")||{}).value||"",(root.querySelector("#croBody")||{}).value||"",b.getAttribute("data-template"),b.getAttribute("data-stage-to"),b.getAttribute("data-wait"),b).catch(function(err){alert(err.message||"Send failed");});};});
    var add=root.querySelector("[data-cro-add]");if(add)add.onclick=function(){var row={name:(root.querySelector("#croAddName")||{}).value.trim(),email:(root.querySelector("#croAddEmail")||{}).value.trim()||null,role:(root.querySelector("#croAddRole")||{}).value.trim()||null,org:(root.querySelector("#croAddOrg")||{}).value.trim()||null,event_id:(root.querySelector("#croAddEvent")||{}).value.trim()||null,org_kind:(root.querySelector("#croAddKind")||{}).value||"press",stage:"new"};if(!row.name)return;add.disabled=true;O.supa("crm_contacts",{method:"POST",body:row}).then(function(){O.outreach.index=0;return loadOutreach();}).catch(function(err){add.disabled=false;alert(err.message||"Could not add contact");});};
    root.querySelectorAll("[data-cro-opstab]").forEach(function(b){b.onclick=function(){O.ops.tab=b.getAttribute("data-cro-opstab");rerender();};});
    root.querySelectorAll("[data-cro-lead-status]").forEach(function(b){b.onclick=function(){b.disabled=true;O.request("/v1/leads/status",{method:"POST",body:{lead_id:b.getAttribute("data-id"),status:b.getAttribute("data-cro-lead-status")}}).then(function(){return O.refresh?O.refresh():null;}).catch(function(err){b.disabled=false;alert(err.message||"Status change failed");});};});
    root.querySelectorAll("[data-cro-rights]").forEach(function(b){b.onclick=function(){var id=b.getAttribute("data-cro-rights"),next=b.getAttribute("data-next"),row=O.ops.rightsRows.find(function(x){return String(x.id)===String(id);}),ids=[id].concat(row&&row.media||[]),body=ids.map(function(x){return{id:x,rights:next,note:"Set in McCluster Control"};});b.disabled=true;O.supa("rights_flags",{method:"POST",prefer:"resolution=merge-duplicates,return=representation",body:body}).then(function(rows){(rows||body).forEach(function(f){O.ops.rightsFlags[f.id]=f.rights||next;});rerender();}).catch(function(err){b.disabled=false;alert(err.message||"Rights change failed");});};});
  }
  window.CR.workTools={init:function(opts){O.supa=opts.supa;O.request=opts.request;O.refresh=opts.refresh;O.rerender=opts.render;O.getState=opts.getState;},render:function(view){return view==="outreach"?outreach():view==="operations"?operations():"";},bind:bind,loadOutreach:loadOutreach,loadOps:loadOps,state:O};
})();
