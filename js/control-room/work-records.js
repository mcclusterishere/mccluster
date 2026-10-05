/* Control · Work records: companies, tasks, orders, bookings and hand-made
   leads, read and written through the Worker (/v1/work/*, workers/mccluster/src/work.js).

   This replaces "+ New → open the legacy CRM creator". Nothing here talks to
   a table directly: every create and change goes through the membership-
   checked, audited route, and a refused write stays visibly refused.
   Until the migration is applied the routes answer work_not_provisioned and
   this module says so instead of rendering empty lists as if they were real. */
(function(){
  "use strict";
  window.CR=window.CR||{};
  var KINDS=["companies","tasks","orders","bookings"];
  var LABEL={lead:"Lead",companies:"Company",tasks:"Task",orders:"Order",bookings:"Booking"};
  var COMPANY_KINDS=["nonprofit","brand","agency","government","media","other"];
  var STATES={tasks:["open","doing","done"],orders:["open","paid","in_production","fulfilled","cancelled"],bookings:["proposed","confirmed","completed","cancelled"]};
  var W={request:null,render:null,orgId:null,leads:null,refreshLeads:null,
    rows:{companies:[],tasks:[],orders:[],bookings:[]},loaded:{},loading:{},error:{},
    unprov:{},form:null,busy:false,msg:null,bad:false};

  function e(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function ago(v){if(!v)return"—";var d=new Date(v);return isNaN(d)?"—":d.toLocaleDateString(undefined,{month:"short",day:"numeric"});}
  function money(c,cur){if(c==null)return"—";return(Number(c)/100).toLocaleString(undefined,{style:"currency",currency:(cur||"usd").toUpperCase()});}
  function note(msg,bad){return'<div class="cro-note'+(bad?" cro-note--bad":"")+'">'+e(msg)+'</div>';}
  function redraw(){if(W.render)W.render();}
  function org(){return W.orgId?W.orgId():null;}
  function val(id){var el=document.getElementById(id);return el?String(el.value||"").trim():"";}
  function isUnprovisioned(err){return err&&err.status===503&&err.detail&&(err.detail.code==="work_not_provisioned"||(err.detail.detail&&err.detail.detail.code==="work_not_provisioned"));}

  function load(kind,force){
    var o=org();if(!o||W.loading[kind]||(W.loaded[kind]&&!force))return Promise.resolve();
    W.loading[kind]=true;delete W.error[kind];
    return W.request("/v1/work/"+kind+"?org_id="+encodeURIComponent(o)+"&limit=200").then(function(d){
      W.rows[kind]=(d&&d[kind])||[];W.unprov[kind]=false;
    }).catch(function(err){
      if(isUnprovisioned(err))W.unprov[kind]=true;else W.error[kind]=err;
    }).then(function(){W.loading[kind]=false;W.loaded[kind]=true;redraw();});
  }
  function ensure(kinds){kinds.forEach(function(k){if(!W.loaded[k]&&!W.loading[k])load(k);});}

  function companyName(id){var c=W.rows.companies.find(function(x){return x.id===id;});return c?c.name:"";}
  function leadName(id){var l=(W.leads?W.leads():[]).find(function(x){return x.id===id;});return l?(l.name||l.email||"Lead"):"";}
  function companyOptions(sel){return'<option value="">None</option>'+W.rows.companies.map(function(c){return'<option value="'+e(c.id)+'"'+(c.id===sel?" selected":"")+'>'+e(c.name)+'</option>';}).join("");}
  function leadOptions(){return'<option value="">None</option>'+(W.leads?W.leads():[]).slice(0,200).map(function(l){return'<option value="'+e(l.id)+'">'+e(l.name||l.email||l.id)+'</option>';}).join("");}

  /* Companies live in the existing out_companies table. The Work schema is
     applied in production; this message is now a drift/failure state, not a
     normal setup step. */
  function unprovisionedNote(){
    return'<div class="cr-gap"><b>Work schema unavailable.</b><span>Production should include supabase/migrations/20261005044012_control_work_records_v1.sql. This response means the runtime and database are out of sync; nothing is invented locally.</span></div>';
  }

  /* The create form for one kind. Fields mirror what the Worker accepts;
     anything else would be dropped server-side anyway. */
  function fields(kind){
    if(kind==="lead")return'<label>Name<input id="wkName" maxlength="200" required></label><label>Email<input id="wkEmail" type="email" maxlength="320" required></label><label>What they want<input id="wkWant" maxlength="200" placeholder="Website, shoot, print…"></label><label>Campaign<input id="wkCampaign" maxlength="120"></label><label>Company<select id="wkCompany">'+companyOptions()+'</select></label><label class="cro-span-2">Note<textarea id="wkNote" rows="3" maxlength="4000"></textarea></label>';
    if(kind==="companies")return'<label>Name<input id="wkName" maxlength="200" required></label><label>Domain<input id="wkDomain" maxlength="253" placeholder="example.com"></label><label>Kind<select id="wkKind"><option value="">—</option>'+COMPANY_KINDS.map(function(k){return'<option value="'+k+'">'+k+'</option>';}).join("")+'</select></label><label>City<input id="wkCity" maxlength="120"></label><label class="cro-span-2">Notes<textarea id="wkNotes" rows="3" maxlength="4000"></textarea></label>';
    if(kind==="tasks")return'<label>Task<input id="wkTitle" maxlength="300" required></label><label>Due<input id="wkDue" type="datetime-local"></label><label>About a lead<select id="wkLead">'+leadOptions()+'</select></label><label class="cro-span-2">Detail<textarea id="wkDetail" rows="3" maxlength="4000"></textarea></label>';
    if(kind==="orders")return'<label>Order<input id="wkTitle" maxlength="300" required></label><label>Amount (USD)<input id="wkAmount" type="number" min="0" step="0.01" inputmode="decimal"></label><label>Lead<select id="wkLead">'+leadOptions()+'</select></label><label>Company<select id="wkCompany">'+companyOptions()+'</select></label>';
    return'<label>Booking<input id="wkTitle" maxlength="300" required></label><label>Location<input id="wkLocation" maxlength="300"></label><label>Starts<input id="wkStarts" type="datetime-local"></label><label>Ends<input id="wkEnds" type="datetime-local"></label><label>Lead<select id="wkLead">'+leadOptions()+'</select></label><label>Company<select id="wkCompany">'+companyOptions()+'</select></label><label class="cro-span-2">Note<textarea id="wkNote" rows="3" maxlength="4000"></textarea></label>';
  }
  function iso(v){if(!v)return null;var d=new Date(v);return isNaN(d)?null:d.toISOString();}
  function payload(kind){
    var o={org_id:org()};
    if(kind==="lead"){o.name=val("wkName");o.email=val("wkEmail")||null;o.want=val("wkWant")||null;o.campaign=val("wkCampaign")||null;o.company_id=val("wkCompany")||null;o.note=val("wkNote")||null;}
    else if(kind==="companies"){o.name=val("wkName");o.domain=val("wkDomain")||null;o.kind=val("wkKind")||null;o.city=val("wkCity")||null;o.notes=val("wkNotes")||null;}
    else if(kind==="tasks"){o.title=val("wkTitle");o.due_at=iso(val("wkDue"));o.detail=val("wkDetail")||null;var l=val("wkLead");if(l){o.related_type="lead";o.related_id=l;}}
    else if(kind==="orders"){o.title=val("wkTitle");var a=val("wkAmount");o.amount_cents=a===""?null:Math.round(Number(a)*100);o.lead_id=val("wkLead")||null;o.company_id=val("wkCompany")||null;}
    else{o.title=val("wkTitle");o.location=val("wkLocation")||null;o.starts_at=iso(val("wkStarts"));o.ends_at=iso(val("wkEnds"));o.lead_id=val("wkLead")||null;o.company_id=val("wkCompany")||null;o.note=val("wkNote")||null;}
    return o;
  }

  function renderForm(){
    if(!W.form)return"";
    var kind=W.form,chips=["lead"].concat(KINDS).map(function(k){return'<button type="button" class="cro-chip'+(k===kind?" is-on":"")+'" data-wk-form="'+k+'">'+e(LABEL[k])+'</button>';}).join("");
    var body=W.unprov[kind]?unprovisionedNote():'<div class="cro-form cro-form--2">'+fields(kind)+'</div>'+
      '<div class="cro-actions" style="margin-top:8px"><button class="cr-btn cr-btn--primary" type="button" data-wk-create="'+kind+'"'+(W.busy?" disabled":"")+'>'+(W.busy?"Saving…":"Create "+e(LABEL[kind].toLowerCase()))+'</button><button class="cr-btn" type="button" data-wk-cancel>Cancel</button></div>';
    return'<section class="cro-card cro" aria-label="Create a Work record"><h2>Create a record</h2><div class="cro-chips">'+chips+'</div>'+(W.msg?note(W.msg,W.bad):"")+body+
      '<p class="cro-meta">Written through api.mccluster.org, checked against your role in this workspace, and recorded in the audit ledger.</p></section>';
  }

  function stateSelect(kind,r){
    return'<select aria-label="State" data-wk-state="'+kind+'" data-id="'+e(r.id)+'">'+STATES[kind].map(function(s){return'<option value="'+s+'"'+(s===r.state?" selected":"")+'>'+e(s.replace(/_/g," "))+'</option>';}).join("")+'</select>';
  }
  function table(cols,rows,emptyText){
    if(!rows.length)return'<p class="cr-muted">'+e(emptyText)+'</p>';
    return'<div class="cr-table-wrap"><table class="cr-data-table"><thead><tr>'+cols.map(function(c){return'<th>'+e(c[0])+'</th>';}).join("")+'</tr></thead><tbody>'+
      rows.map(function(r){return'<tr>'+cols.map(function(c){return'<td>'+c[1](r)+'</td>';}).join("")+'</tr>';}).join("")+'</tbody></table></div>';
  }

  /* The stored records for one Work view, above whatever the view still
     derives from leads. */
  function section(kind){
    ensure(kind==="companies"?["companies"]:["companies",kind]);
    if(W.unprov[kind])return unprovisionedNote();
    if(W.loading[kind]&&!W.loaded[kind])return note("Reading "+kind+"…");
    if(W.error[kind])return note(LABEL[kind]+" records did not load: "+(W.error[kind].message||W.error[kind]),true);
    var rows=W.rows[kind],cols;
    if(kind==="companies"){
      var counts={};(W.leads?W.leads():[]).forEach(function(l){if(l.company_id)counts[l.company_id]=(counts[l.company_id]||0)+1;});
      cols=[["Company",function(r){return e(r.name)+(r.domain?'<div class="cro-meta">'+e(r.domain)+'</div>':"");}],["Kind",function(r){return e(r.kind||"—");}],["Outreach",function(r){return e(r.status||"—");}],["Leads",function(r){return e(counts[r.id]||0);}],["Added",function(r){return e(ago(r.created_at));}]];
    }else if(kind==="tasks"){
      cols=[["Task",function(r){return e(r.title)+(r.detail?'<div class="cro-meta">'+e(r.detail)+'</div>':"");}],["About",function(r){return e(r.related_type==="lead"?leadName(r.related_id)||"Lead":(r.related_type||"—"));}],["Due",function(r){return e(ago(r.due_at));}],["State",function(r){return stateSelect(kind,r);}]];
    }else if(kind==="orders"){
      cols=[["Order",function(r){return e(r.title);}],["Customer",function(r){return e(leadName(r.lead_id)||companyName(r.company_id)||"—");}],["Amount",function(r){return e(money(r.amount_cents,r.currency));}],["Placed",function(r){return e(ago(r.placed_at));}],["State",function(r){return stateSelect(kind,r);}]];
    }else{
      cols=[["Booking",function(r){return e(r.title)+(r.location?'<div class="cro-meta">'+e(r.location)+'</div>':"");}],["Contact",function(r){return e(leadName(r.lead_id)||companyName(r.company_id)||"—");}],["Starts",function(r){return e(r.starts_at?new Date(r.starts_at).toLocaleString():"—");}],["State",function(r){return stateSelect(kind,r);}]];
    }
    return(W.msg&&!W.form?note(W.msg,W.bad):"")+'<section class="cro-card"><div class="cro-row__top"><h2>'+e(LABEL[kind])+' records</h2><button class="cr-btn" type="button" data-wk-form="'+kind+'">+ New '+e(LABEL[kind].toLowerCase())+'</button></div>'+
      table(cols,rows,"No "+kind+" recorded yet.")+'</section>';
  }

  function openForm(view){
    var map={companies:"companies",tasks:"tasks",orders:"orders",bookings:"bookings"};
    W.form=map[view]||"lead";W.msg=null;W.bad=false;ensure(["companies"]);redraw();
  }

  function create(kind){
    if(!org()){W.msg="Pick a workspace first.";W.bad=true;redraw();return;}
    var body=payload(kind);
    if(!(body.name||body.title)){W.msg=(kind==="lead"||kind==="companies"?"A name":"A title")+" is required.";W.bad=true;redraw();return;}
    /* leads.email is NOT NULL: every lead surface keys on it. */
    if(kind==="lead"&&!body.email){W.msg="An email is required for a lead.";W.bad=true;redraw();return;}
    W.busy=true;W.msg=null;redraw();
    var path=kind==="lead"?"/v1/work/leads":"/v1/work/"+kind;
    W.request(path,{method:"POST",body:body}).then(function(){
      W.form=null;W.msg=null;
      if(kind==="lead"){if(W.refreshLeads)W.refreshLeads();}else load(kind,true);
    }).catch(function(err){
      if(isUnprovisioned(err)&&kind!=="lead")W.unprov[kind]=true;
      W.msg="Not saved: "+(isUnprovisioned(err)&&kind==="lead"?"linking a lead to a company needs the pending Work migration; leave Company empty for now":(err.message||err));W.bad=true;
    }).then(function(){W.busy=false;redraw();});
  }

  function setState(kind,id,next,el){
    var row=W.rows[kind].find(function(r){return r.id===id;});if(!row||row.state===next)return;
    var prev=row.state;row.state=next;if(el)el.disabled=true;
    W.request("/v1/work/"+kind+"/"+encodeURIComponent(id),{method:"PATCH",body:{org_id:org(),state:next}}).then(function(d){
      var fresh=d&&d[LABEL[kind].toLowerCase()];if(fresh)Object.assign(row,fresh);
    }).catch(function(err){
      /* A refused change must not look like one that worked. */
      row.state=prev;W.msg=LABEL[kind]+" not changed: "+(err.message||err);W.bad=true;
    }).then(function(){redraw();});
  }

  function onClick(ev){
    var t=ev.target.closest&&ev.target.closest("[data-wk-form],[data-wk-create],[data-wk-cancel]");if(!t)return;
    if(t.hasAttribute("data-wk-form")){W.form=t.getAttribute("data-wk-form");W.msg=null;ensure(["companies"]);redraw();window.scrollTo({top:0,behavior:"smooth"});}
    else if(t.hasAttribute("data-wk-create"))create(t.getAttribute("data-wk-create"));
    else if(t.hasAttribute("data-wk-cancel")){W.form=null;W.msg=null;redraw();}
  }
  function onChange(ev){
    var t=ev.target;if(!t||!t.hasAttribute||!t.hasAttribute("data-wk-state"))return;
    setState(t.getAttribute("data-wk-state"),t.getAttribute("data-id"),t.value,t);
  }

  window.CR.work={
    init:function(ctx){
      W.request=ctx.request;W.render=ctx.render;W.orgId=ctx.orgId;W.leads=ctx.leads;W.refreshLeads=ctx.refreshLeads;
      document.addEventListener("click",onClick);document.addEventListener("change",onChange);
    },
    reset:function(){W.loaded={};W.rows={companies:[],tasks:[],orders:[],bookings:[]};W.unprov={};},
    renderForm:renderForm,section:section,openForm:openForm,
    state:W
  };
})();
