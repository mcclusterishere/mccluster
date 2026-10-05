/* Control · Work records: companies, tasks, orders, bookings, hand-made
   leads, and the post-sale graph (relationships, service projects,
   deliverables, renewals, payments), read and written through the Worker
   (/v1/work/*, workers/mccluster/src/work.js).

   This replaces "+ New → open the legacy CRM creator". Nothing here talks to
   a table directly: every create and change goes through the membership-
   checked, audited route, and a refused write stays visibly refused.
   If a table is missing the routes answer work_not_provisioned and this
   module says so instead of rendering empty lists as if they were real.

   People stay leads and out_contacts, companies stay out_companies: the
   post-sale records link to them rather than copying them. A payment the
   owner records is labelled owner-recorded; only a provider reconciler can
   mark one verified, and this module never sends that field. */
(function(){
  "use strict";
  window.CR=window.CR||{};
  var KINDS=["companies","tasks","orders","bookings","relationships","projects","deliverables","renewals","payments"];
  var POST_SALE=["relationships","projects","deliverables","renewals","payments"];
  var LABEL={lead:"Lead",companies:"Company",tasks:"Task",orders:"Order",bookings:"Booking",relationships:"Relationship",projects:"Project",deliverables:"Deliverable",renewals:"Renewal",payments:"Payment"};
  /* The response key for one record of a kind (POST returns { task: … }). */
  var ONE={companies:"company",tasks:"task",orders:"order",bookings:"booking",relationships:"relationship",projects:"project",deliverables:"deliverable",renewals:"renewal",payments:"payment"};
  var COMPANY_KINDS=["nonprofit","brand","agency","government","media","other"];
  var REL_TYPES=["client","prospect","partner","sponsor","vendor","collaborator","other"];
  var DELIVERABLE_KINDS=["file","site","media","report","campaign","other"];
  var CADENCES=["monthly","quarterly","annual","one_time","custom"];
  var PROVIDERS=["manual","stripe","square","other"];
  var APPROVAL=["not_requested","pending","approved","changes_requested"];
  var STATES={tasks:["open","doing","done"],orders:["open","paid","in_production","fulfilled","cancelled"],bookings:["proposed","confirmed","completed","cancelled"],
    relationships:["active","paused","ended"],projects:["planned","active","on_hold","delivered","closed","cancelled"],deliverables:["planned","in_progress","delivered","accepted","rejected"],
    renewals:["upcoming","renewed","lapsed","cancelled"],payments:["due","pending","paid","failed","refunded","cancelled"]};
  function emptyRows(){var r={contacts:[]};KINDS.forEach(function(k){r[k]=[];});return r;}
  var W={request:null,render:null,orgId:null,leads:null,refreshLeads:null,
    rows:emptyRows(),loaded:{},loading:{},error:{},
    unprov:{},form:null,busy:false,msg:null,bad:false,history:null};

  function e(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function ago(v){if(!v)return"—";var d=new Date(v);return isNaN(d)?"—":d.toLocaleDateString(undefined,{month:"short",day:"numeric"});}
  function day(v){if(!v)return"—";var d=new Date(v);return isNaN(d)?"—":d.toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"});}
  function money(c,cur){if(c==null)return"—";return(Number(c)/100).toLocaleString(undefined,{style:"currency",currency:(cur||"usd").toUpperCase()});}
  function words(v){return String(v||"").replace(/_/g," ");}
  function note(msg,bad){return'<div class="cro-note'+(bad?" cro-note--bad":"")+'">'+e(msg)+'</div>';}
  function redraw(){if(W.render)W.render();}
  function org(){return W.orgId?W.orgId():null;}
  function val(id){var el=document.getElementById(id);return el?String(el.value||"").trim():"";}
  function isUnprovisioned(err){return err&&err.status===503&&err.detail&&(err.detail.code==="work_not_provisioned"||(err.detail.detail&&err.detail.detail.code==="work_not_provisioned"));}
  function migrationOf(err){var d=err&&err.detail;return(d&&(d.migration||(d.detail&&d.detail.migration)))||"";}

  function load(kind,force){
    var o=org();if(!o||W.loading[kind]||(W.loaded[kind]&&!force))return Promise.resolve();
    W.loading[kind]=true;delete W.error[kind];
    return W.request("/v1/work/"+kind+"?org_id="+encodeURIComponent(o)+"&limit=200").then(function(d){
      W.rows[kind]=(d&&d[kind])||[];W.unprov[kind]=false;
    }).catch(function(err){
      if(isUnprovisioned(err))W.unprov[kind]=migrationOf(err)||true;else W.error[kind]=err;
    }).then(function(){W.loading[kind]=false;W.loaded[kind]=true;redraw();});
  }
  function ensure(kinds){kinds.forEach(function(k){if(!W.loaded[k]&&!W.loading[k])load(k);});}
  /* What each kind's form and table need to name its links. */
  var NEEDS={companies:["companies"],tasks:["companies"],orders:["companies"],bookings:["companies"],
    relationships:["companies","contacts"],projects:["companies","relationships","orders"],deliverables:["projects"],
    renewals:["companies","relationships","projects"],payments:["companies","projects","orders"]};

  function byId(kind,id){return id?W.rows[kind].find(function(x){return x.id===id;}):null;}
  function companyName(id){var c=byId("companies",id);return c?c.name:"";}
  function leadName(id){var l=(W.leads?W.leads():[]).find(function(x){return x.id===id;});return l?(l.name||l.email||"Lead"):"";}
  function contactName(id){var c=byId("contacts",id);return c?(c.name||c.email||"Contact"):"";}
  function titleOf(kind,id){var r=byId(kind,id);return r?(r.title||r.name||""):"";}
  function party(r){return companyName(r.company_id)||contactName(r.contact_id)||leadName(r.lead_id)||titleOf("relationships",r.relationship_id)||"—";}
  function options(rows,sel,label){return'<option value="">None</option>'+rows.slice(0,200).map(function(r){return'<option value="'+e(r.id)+'"'+(r.id===sel?" selected":"")+'>'+e(label(r))+'</option>';}).join("");}
  function companyOptions(sel){return options(W.rows.companies,sel,function(c){return c.name;});}
  function leadOptions(){return options(W.leads?W.leads():[],null,function(l){return l.name||l.email||l.id;});}
  function rowOptions(kind){return options(W.rows[kind],null,function(r){return r.title||r.name||r.email||r.id;});}
  function choice(id,values,first){return'<select id="'+id+'">'+(first?'<option value="">'+e(first)+'</option>':"")+values.map(function(v){return'<option value="'+v+'">'+e(words(v))+'</option>';}).join("")+'</select>';}

  /* A missing table is deployment drift; the response names the migration. */
  function unprovisionedNote(kind){
    var m=typeof W.unprov[kind]==="string"?W.unprov[kind]:(POST_SALE.indexOf(kind)>=0?"supabase/migrations/20261005075808_control_post_sale_work_v1.sql":"supabase/migrations/20261005044012_control_work_records_v1.sql");
    return'<div class="cr-gap"><b>Work schema unavailable.</b><span>Production should include '+e(m)+'. This response means the runtime and database are out of sync; nothing is invented locally.</span></div>';
  }

  /* The create form for one kind. Fields mirror what the Worker accepts;
     anything else would be dropped server-side anyway. */
  function fields(kind){
    if(kind==="lead")return'<label>Name<input id="wkName" maxlength="200" required></label><label>Email<input id="wkEmail" type="email" maxlength="320" required></label><label>What they want<input id="wkWant" maxlength="200" placeholder="Website, shoot, print…"></label><label>Campaign<input id="wkCampaign" maxlength="120"></label><label>Company<select id="wkCompany">'+companyOptions()+'</select></label><label class="cro-span-2">Note<textarea id="wkNote" rows="3" maxlength="4000"></textarea></label>';
    if(kind==="companies")return'<label>Name<input id="wkName" maxlength="200" required></label><label>Domain<input id="wkDomain" maxlength="253" placeholder="example.com"></label><label>Kind<select id="wkKind"><option value="">—</option>'+COMPANY_KINDS.map(function(k){return'<option value="'+k+'">'+k+'</option>';}).join("")+'</select></label><label>City<input id="wkCity" maxlength="120"></label><label class="cro-span-2">Notes<textarea id="wkNotes" rows="3" maxlength="4000"></textarea></label>';
    if(kind==="tasks")return'<label>Task<input id="wkTitle" maxlength="300" required></label><label>Due<input id="wkDue" type="datetime-local"></label><label>About a lead<select id="wkLead">'+leadOptions()+'</select></label><label>About a project<select id="wkProject">'+rowOptions("projects")+'</select></label><label class="cro-span-2">Detail<textarea id="wkDetail" rows="3" maxlength="4000"></textarea></label>';
    if(kind==="orders")return'<label>Order<input id="wkTitle" maxlength="300" required></label><label>Amount (USD)<input id="wkAmount" type="number" min="0" step="0.01" inputmode="decimal"></label><label>Lead<select id="wkLead">'+leadOptions()+'</select></label><label>Company<select id="wkCompany">'+companyOptions()+'</select></label>';
    if(kind==="bookings")return'<label>Booking<input id="wkTitle" maxlength="300" required></label><label>Location<input id="wkLocation" maxlength="300"></label><label>Starts<input id="wkStarts" type="datetime-local"></label><label>Ends<input id="wkEnds" type="datetime-local"></label><label>Lead<select id="wkLead">'+leadOptions()+'</select></label><label>Company<select id="wkCompany">'+companyOptions()+'</select></label><label class="cro-span-2">Note<textarea id="wkNote" rows="3" maxlength="4000"></textarea></label>';
    if(kind==="relationships")return'<label>Relationship<input id="wkTitle" maxlength="300" required placeholder="Acme · website client"></label><label>Type'+choice("wkRelType",REL_TYPES)+'</label><label>Company<select id="wkCompany">'+companyOptions()+'</select></label><label>Contact<select id="wkContact">'+rowOptions("contacts")+'</select></label><label>Lead<select id="wkLead">'+leadOptions()+'</select></label><label>Since<input id="wkStarted" type="date"></label><label class="cro-span-2">Notes<textarea id="wkNotes" rows="3" maxlength="4000"></textarea></label><p class="cro-meta cro-span-2">Pick at least one of company, contact or lead: a relationship links the canonical records, it does not copy them.</p>';
    if(kind==="projects")return'<label>Project<input id="wkTitle" maxlength="300" required></label><label>Company<select id="wkCompany">'+companyOptions()+'</select></label><label>Relationship<select id="wkRelationship">'+rowOptions("relationships")+'</select></label><label>From order<select id="wkOrder">'+rowOptions("orders")+'</select></label><label>Starts<input id="wkStarts" type="date"></label><label>Due<input id="wkDue" type="date"></label><label>Budget (USD)<input id="wkAmount" type="number" min="0" step="0.01" inputmode="decimal"></label><label class="cro-span-2">Scope<textarea id="wkSummary" rows="3" maxlength="4000"></textarea></label>';
    if(kind==="deliverables")return'<label>Project<select id="wkProject" required>'+rowOptions("projects")+'</select></label><label>Deliverable<input id="wkTitle" maxlength="300" required placeholder="Site handoff, final edit, report…"></label><label>Type'+choice("wkDelKind",DELIVERABLE_KINDS)+'</label><label>Due<input id="wkDue" type="date"></label><label class="cro-span-2">Artifact (https)<input id="wkUrl" type="url" maxlength="2000" placeholder="https://…"></label><label class="cro-span-2">Note<textarea id="wkNote" rows="3" maxlength="4000"></textarea></label>';
    if(kind==="renewals")return'<label>Renewal<input id="wkTitle" maxlength="300" required placeholder="Annual hosting, monthly management…"></label><label>Cadence'+choice("wkCadence",CADENCES)+'</label><label>Company<select id="wkCompany">'+companyOptions()+'</select></label><label>Relationship<select id="wkRelationship">'+rowOptions("relationships")+'</select></label><label>Project<select id="wkProject">'+rowOptions("projects")+'</select></label><label>Renews<input id="wkRenews" type="date"></label><label>Amount (USD)<input id="wkAmount" type="number" min="0" step="0.01" inputmode="decimal"></label><label class="cro-span-2">Note<textarea id="wkNote" rows="3" maxlength="4000"></textarea></label>';
    return'<label>Payment<input id="wkTitle" maxlength="300" required placeholder="Deposit, balance, monthly…"></label><label>Amount (USD)<input id="wkAmount" type="number" min="0" step="0.01" inputmode="decimal" required></label><label>State'+choice("wkPayState",["due","pending","paid"])+'</label><label>Provider'+choice("wkProvider",PROVIDERS)+'</label><label>Provider reference<input id="wkRef" maxlength="200" placeholder="pi_… / Square payment id"></label><label>Due<input id="wkDue" type="date"></label><label>Company<select id="wkCompany">'+companyOptions()+'</select></label><label>Project<select id="wkProject">'+rowOptions("projects")+'</select></label><label>Order<select id="wkOrder">'+rowOptions("orders")+'</select></label><label class="cro-span-2">Note<textarea id="wkNote" rows="2" maxlength="4000"></textarea></label><p class="cro-meta cro-span-2">Recorded by you, labelled owner-recorded. A payment becomes provider-verified only when a Stripe or Square reconciler confirms it.</p>';
  }
  function iso(v){if(!v)return null;var d=new Date(v);return isNaN(d)?null:d.toISOString();}
  function centsOf(id){var a=val(id);return a===""?null:Math.round(Number(a)*100);}
  function payload(kind){
    var o={org_id:org()};
    if(kind==="lead"){o.name=val("wkName");o.email=val("wkEmail")||null;o.want=val("wkWant")||null;o.campaign=val("wkCampaign")||null;o.company_id=val("wkCompany")||null;o.note=val("wkNote")||null;}
    else if(kind==="companies"){o.name=val("wkName");o.domain=val("wkDomain")||null;o.kind=val("wkKind")||null;o.city=val("wkCity")||null;o.notes=val("wkNotes")||null;}
    else if(kind==="tasks"){o.title=val("wkTitle");o.due_at=iso(val("wkDue"));o.detail=val("wkDetail")||null;var l=val("wkLead"),p=val("wkProject");if(p){o.related_type="project";o.related_id=p;}else if(l){o.related_type="lead";o.related_id=l;}}
    else if(kind==="orders"){o.title=val("wkTitle");o.amount_cents=centsOf("wkAmount");o.lead_id=val("wkLead")||null;o.company_id=val("wkCompany")||null;}
    else if(kind==="bookings"){o.title=val("wkTitle");o.location=val("wkLocation")||null;o.starts_at=iso(val("wkStarts"));o.ends_at=iso(val("wkEnds"));o.lead_id=val("wkLead")||null;o.company_id=val("wkCompany")||null;o.note=val("wkNote")||null;}
    else if(kind==="relationships"){o.title=val("wkTitle");o.relationship_type=val("wkRelType")||null;o.company_id=val("wkCompany")||null;o.contact_id=val("wkContact")||null;o.lead_id=val("wkLead")||null;o.started_at=iso(val("wkStarted"));o.notes=val("wkNotes")||null;}
    else if(kind==="projects"){o.title=val("wkTitle");o.company_id=val("wkCompany")||null;o.relationship_id=val("wkRelationship")||null;o.order_id=val("wkOrder")||null;o.starts_at=iso(val("wkStarts"));o.due_at=iso(val("wkDue"));o.budget_cents=centsOf("wkAmount");o.summary=val("wkSummary")||null;}
    else if(kind==="deliverables"){o.project_id=val("wkProject")||null;o.title=val("wkTitle");o.kind=val("wkDelKind")||null;o.due_at=iso(val("wkDue"));o.artifact_url=val("wkUrl")||null;o.note=val("wkNote")||null;}
    else if(kind==="renewals"){o.title=val("wkTitle");o.cadence=val("wkCadence")||null;o.company_id=val("wkCompany")||null;o.relationship_id=val("wkRelationship")||null;o.project_id=val("wkProject")||null;o.renews_at=iso(val("wkRenews"));o.amount_cents=centsOf("wkAmount");o.note=val("wkNote")||null;}
    else{o.title=val("wkTitle");o.amount_cents=centsOf("wkAmount");o.state=val("wkPayState")||null;o.provider=val("wkProvider")||null;o.provider_reference=val("wkRef")||null;o.due_at=iso(val("wkDue"));o.company_id=val("wkCompany")||null;o.project_id=val("wkProject")||null;o.order_id=val("wkOrder")||null;o.note=val("wkNote")||null;}
    return o;
  }

  function renderForm(){
    if(!W.form)return"";
    var kind=W.form,chips=["lead"].concat(KINDS).map(function(k){return'<button type="button" class="cro-chip'+(k===kind?" is-on":"")+'" data-wk-form="'+k+'">'+e(LABEL[k])+'</button>';}).join("");
    var body=W.unprov[kind]?unprovisionedNote(kind):'<div class="cro-form cro-form--2">'+fields(kind)+'</div>'+
      '<div class="cro-actions" style="margin-top:8px"><button class="cr-btn cr-btn--primary" type="button" data-wk-create="'+kind+'"'+(W.busy?" disabled":"")+'>'+(W.busy?"Saving…":"Create "+e(LABEL[kind].toLowerCase()))+'</button><button class="cr-btn" type="button" data-wk-cancel>Cancel</button></div>';
    return'<section class="cro-card cro" aria-label="Create a Work record"><h2>Create a record</h2><div class="cro-chips">'+chips+'</div>'+(W.msg?note(W.msg,W.bad):"")+body+
      '<p class="cro-meta">Written through api.mccluster.org, checked against your role in this workspace, and recorded in the audit ledger.</p></section>';
  }

  function select(kind,r,field,values){
    return'<select aria-label="'+e(words(field))+'" data-wk-field="'+field+'" data-wk-kind="'+kind+'" data-id="'+e(r.id)+'">'+values.map(function(s){return'<option value="'+s+'"'+(s===r[field]?" selected":"")+'>'+e(words(s))+'</option>';}).join("")+'</select>';
  }
  function stateSelect(kind,r){return select(kind,r,"state",STATES[kind]);}
  function historyButton(key,r,label){return'<button class="cr-btn cr-btn--ghost" type="button" data-wk-history="'+key+'" data-id="'+e(r.id)+'" data-title="'+e(label||r.title||r.name||"")+'">History</button>';}
  function table(cols,rows,emptyText){
    if(!rows.length)return'<p class="cr-muted">'+e(emptyText)+'</p>';
    return'<div class="cr-table-wrap"><table class="cr-data-table"><thead><tr>'+cols.map(function(c){return'<th>'+e(c[0])+'</th>';}).join("")+'</tr></thead><tbody>'+
      rows.map(function(r){return'<tr>'+cols.map(function(c){return'<td>'+c[1](r)+'</td>';}).join("")+'</tr>';}).join("")+'</tbody></table></div>';
  }
  function verification(r){
    return r.verification==="provider_verified"
      ?'<span class="cr-state cr-state--ok">provider verified</span>'
      :'<span class="cr-state cr-state--warn">owner recorded</span>';
  }

  /* One client's history: every linked record and its audit trail, read
     from the canonical tables by GET /v1/work/history. */
  function loadHistory(key,id,title){
    var o=org();if(!o)return;
    W.history={key:key,id:id,title:title||"",loading:true,data:null,error:null};redraw();
    W.request("/v1/work/history?org_id="+encodeURIComponent(o)+"&"+key+"="+encodeURIComponent(id)).then(function(d){
      if(!W.history||W.history.id!==id)return;W.history.data=d;
    }).catch(function(err){if(W.history&&W.history.id===id)W.history.error=err;}).then(function(){if(W.history&&W.history.id===id){W.history.loading=false;redraw();}});
  }
  function renderHistory(){
    var h=W.history;if(!h)return"";
    var head='<div class="cro-row__top"><h2>History · '+e(h.title||words(h.key.replace(/_id$/,"")))+'</h2><button class="cr-btn" type="button" data-wk-history-close>Close</button></div>';
    if(h.loading)return'<section class="cro-card cro-history">'+head+note("Reading the linked records…")+'</section>';
    if(h.error)return'<section class="cro-card cro-history">'+head+note("History did not load: "+(h.error.message||h.error),true)+'</section>';
    var d=h.data||{},t=d.totals||{},rec=d.records||{};
    var kpis='<div class="cro-kpis">'+
      [["Billed",money(t.billed_cents)],["Paid",money(t.paid_cents)],["Provider verified",money(t.provider_verified_cents)],["Open deliverables",String(t.open_deliverables||0)],["Next renewal",day(t.next_renewal_at)]]
        .map(function(k){return'<div><small>'+e(k[0])+'</small><b>'+e(k[1])+'</b></div>';}).join("")+'</div>';
    var counts=["relationships","projects","orders","bookings","deliverables","renewals","payments","tasks"].map(function(k){return(rec[k]||[]).length+" "+k;}).join(" · ");
    var items=(d.timeline||[]).slice(0,60).map(function(ev){
      return'<li><span class="cro-meta">'+e(day(ev.at))+' · '+e(ev.kind)+'</span><b>'+e(ev.title)+'</b>'+(ev.state?' <span class="cro-meta">'+e(words(ev.state))+'</span>':"")+'</li>';
    }).join("");
    return'<section class="cro-card cro-history">'+head+kpis+'<p class="cro-meta">'+e(counts)+'</p>'+
      (items?'<ol class="cro-timeline">'+items+'</ol>':'<p class="cr-muted">Nothing is linked to this record yet.</p>')+'</section>';
  }

  /* The stored records for one Work view, above whatever the view still
     derives from leads. */
  function section(kind){
    ensure(NEEDS[kind].concat([kind]).filter(function(k,i,a){return a.indexOf(k)===i;}));
    var history=renderHistory();
    if(W.unprov[kind])return history+unprovisionedNote(kind);
    if(W.loading[kind]&&!W.loaded[kind])return history+note("Reading "+kind+"…");
    if(W.error[kind])return history+note(LABEL[kind]+" records did not load: "+(W.error[kind].message||W.error[kind]),true);
    var rows=W.rows[kind],cols;
    if(kind==="companies"){
      var counts={};(W.leads?W.leads():[]).forEach(function(l){if(l.company_id)counts[l.company_id]=(counts[l.company_id]||0)+1;});
      cols=[["Company",function(r){return e(r.name)+(r.domain?'<div class="cro-meta">'+e(r.domain)+'</div>':"");}],["Kind",function(r){return e(r.kind||"—");}],["Outreach",function(r){return e(r.status||"—");}],["Leads",function(r){return e(counts[r.id]||0);}],["Added",function(r){return e(ago(r.created_at));}],["",function(r){return historyButton("company_id",r,r.name);}]];
    }else if(kind==="tasks"){
      cols=[["Task",function(r){return e(r.title)+(r.detail?'<div class="cro-meta">'+e(r.detail)+'</div>':"");}],["About",function(r){return e(r.related_type==="lead"?leadName(r.related_id)||"Lead":(r.related_type==="project"?titleOf("projects",r.related_id)||"Project":(r.related_type||"—")));}],["Due",function(r){return e(ago(r.due_at));}],["State",function(r){return stateSelect(kind,r);}]];
    }else if(kind==="orders"){
      cols=[["Order",function(r){return e(r.title);}],["Customer",function(r){return e(leadName(r.lead_id)||companyName(r.company_id)||"—");}],["Amount",function(r){return e(money(r.amount_cents,r.currency));}],["Placed",function(r){return e(ago(r.placed_at));}],["State",function(r){return stateSelect(kind,r);}]];
    }else if(kind==="bookings"){
      cols=[["Booking",function(r){return e(r.title)+(r.location?'<div class="cro-meta">'+e(r.location)+'</div>':"");}],["Contact",function(r){return e(leadName(r.lead_id)||companyName(r.company_id)||"—");}],["Starts",function(r){return e(r.starts_at?new Date(r.starts_at).toLocaleString():"—");}],["State",function(r){return stateSelect(kind,r);}]];
    }else if(kind==="relationships"){
      cols=[["Relationship",function(r){return e(r.title)+'<div class="cro-meta">'+e(words(r.relationship_type))+'</div>';}],["With",function(r){return e(party(r));}],["Since",function(r){return e(day(r.started_at||r.created_at));}],["State",function(r){return stateSelect(kind,r);}],["",function(r){return historyButton("relationship_id",r);}]];
    }else if(kind==="projects"){
      cols=[["Project",function(r){return e(r.title)+(r.summary?'<div class="cro-meta">'+e(r.summary)+'</div>':"");}],["Client",function(r){return e(party(r));}],["Due",function(r){return e(day(r.due_at));}],["Budget",function(r){return e(money(r.budget_cents,r.currency));}],["State",function(r){return stateSelect(kind,r);}],["",function(r){return historyButton("project_id",r);}]];
    }else if(kind==="deliverables"){
      cols=[["Deliverable",function(r){return e(r.title)+'<div class="cro-meta">'+e(words(r.kind))+(r.artifact_url?' · <a href="'+e(r.artifact_url)+'" target="_blank" rel="noopener noreferrer">artifact</a>':"")+'</div>';}],["Project",function(r){return e(titleOf("projects",r.project_id)||"—");}],["Due",function(r){return e(day(r.due_at));}],["State",function(r){return stateSelect(kind,r);}],["Approval",function(r){return select(kind,r,"approval_state",APPROVAL)+(r.approved_at?'<div class="cro-meta">approved '+e(day(r.approved_at))+'</div>':"");}]];
    }else if(kind==="renewals"){
      cols=[["Renewal",function(r){return e(r.title)+'<div class="cro-meta">'+e(words(r.cadence))+'</div>';}],["Client",function(r){return e(party(r));}],["Renews",function(r){return e(day(r.renews_at));}],["Amount",function(r){return e(money(r.amount_cents,r.currency));}],["State",function(r){return stateSelect(kind,r);}]];
    }else{
      /* Verification sits in the first column so it is visible at phone width without scrolling the table. */
      cols=[["Payment",function(r){return e(r.title)+'<div class="cro-meta">'+e(r.provider||"manual")+(r.provider_reference?" · "+e(r.provider_reference):"")+'</div>'+verification(r);}],["Amount",function(r){return e(money(r.amount_cents,r.currency));}],["State",function(r){return stateSelect(kind,r);}],["For",function(r){return e(titleOf("projects",r.project_id)||titleOf("orders",r.order_id)||party(r));}],["Due / paid",function(r){return e(r.paid_at?"paid "+day(r.paid_at):day(r.due_at));}]];
    }
    return history+(W.msg&&!W.form?note(W.msg,W.bad):"")+'<section class="cro-card"><div class="cro-row__top"><h2>'+e(LABEL[kind])+' records</h2><button class="cr-btn" type="button" data-wk-form="'+kind+'">+ New '+e(LABEL[kind].toLowerCase())+'</button></div>'+
      table(cols,rows,"No "+kind+" recorded yet.")+'</section>';
  }

  function openForm(view){
    W.form=KINDS.indexOf(view)>=0?view:"lead";W.msg=null;W.bad=false;
    ensure(NEEDS[W.form]||["companies"]);redraw();
  }

  function create(kind){
    if(!org()){W.msg="Pick a workspace first.";W.bad=true;redraw();return;}
    var body=payload(kind);
    if(!(body.name||body.title)){W.msg=(kind==="lead"||kind==="companies"?"A name":"A title")+" is required.";W.bad=true;redraw();return;}
    /* leads.email is NOT NULL: every lead surface keys on it. */
    if(kind==="lead"&&!body.email){W.msg="An email is required for a lead.";W.bad=true;redraw();return;}
    if(kind==="deliverables"&&!body.project_id){W.msg="A deliverable belongs to a project.";W.bad=true;redraw();return;}
    if(kind==="payments"&&body.amount_cents==null){W.msg="A payment needs an amount.";W.bad=true;redraw();return;}
    if(kind==="relationships"&&!(body.company_id||body.contact_id||body.lead_id)){W.msg="Pick a company, contact or lead for this relationship.";W.bad=true;redraw();return;}
    W.busy=true;W.msg=null;redraw();
    var path=kind==="lead"?"/v1/work/leads":"/v1/work/"+kind;
    W.request(path,{method:"POST",body:body}).then(function(){
      W.form=null;W.msg=null;
      if(kind==="lead"){if(W.refreshLeads)W.refreshLeads();}else load(kind,true);
    }).catch(function(err){
      if(isUnprovisioned(err)&&kind!=="lead")W.unprov[kind]=migrationOf(err)||true;
      W.msg="Not saved: "+(isUnprovisioned(err)&&kind==="lead"?"linking a lead to a company needs the pending Work migration; leave Company empty for now":(err.message||err));W.bad=true;
    }).then(function(){W.busy=false;redraw();});
  }

  function setField(kind,id,field,next,el){
    var row=W.rows[kind].find(function(r){return r.id===id;});if(!row||row[field]===next)return;
    var prev=row[field];row[field]=next;if(el)el.disabled=true;
    var body={org_id:org()};body[field]=next;
    W.request("/v1/work/"+kind+"/"+encodeURIComponent(id),{method:"PATCH",body:body}).then(function(d){
      var fresh=d&&d[ONE[kind]];if(fresh)Object.assign(row,fresh);
    }).catch(function(err){
      /* A refused change must not look like one that worked. */
      row[field]=prev;W.msg=LABEL[kind]+" not changed: "+(err.message||err);W.bad=true;
    }).then(function(){redraw();});
  }

  function onClick(ev){
    var t=ev.target.closest&&ev.target.closest("[data-wk-form],[data-wk-create],[data-wk-cancel],[data-wk-history],[data-wk-history-close]");if(!t)return;
    if(t.hasAttribute("data-wk-form")){W.form=t.getAttribute("data-wk-form");W.msg=null;ensure(NEEDS[W.form]||["companies"]);redraw();window.scrollTo({top:0,behavior:"smooth"});}
    else if(t.hasAttribute("data-wk-create"))create(t.getAttribute("data-wk-create"));
    else if(t.hasAttribute("data-wk-cancel")){W.form=null;W.msg=null;redraw();}
    else if(t.hasAttribute("data-wk-history"))loadHistory(t.getAttribute("data-wk-history"),t.getAttribute("data-id"),t.getAttribute("data-title"));
    else if(t.hasAttribute("data-wk-history-close")){W.history=null;redraw();}
  }
  function onChange(ev){
    var t=ev.target;if(!t||!t.hasAttribute||!t.hasAttribute("data-wk-field"))return;
    setField(t.getAttribute("data-wk-kind"),t.getAttribute("data-id"),t.getAttribute("data-wk-field"),t.value,t);
  }

  window.CR.work={
    init:function(ctx){
      W.request=ctx.request;W.render=ctx.render;W.orgId=ctx.orgId;W.leads=ctx.leads;W.refreshLeads=ctx.refreshLeads;
      document.addEventListener("click",onClick);document.addEventListener("change",onChange);
    },
    reset:function(){W.loaded={};W.rows=emptyRows();W.unprov={};W.history=null;},
    renderForm:renderForm,section:section,openForm:openForm,
    kinds:KINDS.slice(),postSale:POST_SALE.slice(),
    state:W
  };
})();
