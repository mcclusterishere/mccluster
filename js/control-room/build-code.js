/* Native Control · Create · Build · Code.

   The first governed production good: a bounded objective becomes one
   canonical `code_patch` job through the `code.build` capability, runs in an
   isolated worktree on McCluster Core, and can only end as a draft PR for
   human review. This module shows exactly what the server stored: no
   invented progress, no "done" without a stored completion, and a draft PR
   link is labelled "reported" until it is read back independently. */
(function(){
  "use strict";
  window.CR=window.CR||{};
  var ROUTE="/v1/ai/build/code", STORE="cr_build_code_last", POLL_MS=8000;
  var S={request:null,rerender:null,orgId:null,status:null,statusError:null,loadingStatus:false,form:{repository:"",task:"",title:"",paths:""},key:null,submitting:false,submitError:null,job:null,receipt:null,receiptError:null,loadingReceipt:false,timer:null,lastRefresh:null};
  function e(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function note(t,bad){return'<div class="cro-note'+(bad?" cro-note--bad":"")+'">'+e(t)+'</div>';}
  function redraw(){if(S.rerender)S.rerender();}
  function uuid(){return window.crypto&&typeof window.crypto.randomUUID==="function"?window.crypto.randomUUID():null;}
  function remember(){try{if(S.job)localStorage.setItem(STORE,JSON.stringify({job_id:S.job,key:S.key,at:new Date().toISOString()}));else localStorage.removeItem(STORE);}catch(_){}}
  function recall(){try{var raw=localStorage.getItem(STORE);var v=raw?JSON.parse(raw):null;return v&&/^[0-9a-f-]{36}$/i.test(v.job_id||"")?v:null;}catch(_){return null;}}
  function when(iso){if(!iso)return"";var d=new Date(iso);return isNaN(d)?"":d.toLocaleString();}
  function loadStatus(){
    if(S.loadingStatus||!S.request)return Promise.resolve();
    S.loadingStatus=true;S.statusError=null;redraw();
    return S.request(ROUTE).then(function(d){S.status=d||null;if(!S.form.repository&&d&&d.repositories&&d.repositories.length)S.form.repository=d.repositories[0];})
      .catch(function(err){S.statusError=err;}).then(function(){S.loadingStatus=false;redraw();});
  }
  function loadReceipt(){
    if(!S.job||!S.request)return Promise.resolve();
    S.loadingReceipt=true;S.receiptError=null;redraw();
    return S.request(ROUTE+"/"+S.job).then(function(d){S.receipt=d&&d.receipt||null;S.lastRefresh=new Date().toISOString();})
      .catch(function(err){S.receiptError=err;if(err&&err.status===404){S.receipt={state:"unknown",reason:"job_not_found"};}})
      .then(function(){S.loadingReceipt=false;redraw();schedule();});
  }
  function schedule(){
    clearTimeout(S.timer);S.timer=null;
    var st=S.receipt&&S.receipt.state;
    if(S.job&&(st==="queued"||st==="running"||st==="awaiting_approval")&&!document.hidden)S.timer=setTimeout(loadReceipt,POLL_MS);
  }
  function paths(){return S.form.paths.split(/\n|,/).map(function(x){return x.trim();}).filter(Boolean);}
  function submit(){
    if(S.submitting||!S.request)return;
    if(!S.key)S.key=uuid();
    if(!S.key){S.submitError=new Error("This browser cannot create an idempotency key.");redraw();return;}
    S.submitting=true;S.submitError=null;redraw();
    S.request(ROUTE,{method:"POST",body:{repository:S.form.repository,task:S.form.task.trim(),title:S.form.title.trim(),allowed_paths:paths(),idempotency_key:S.key}})
      .then(function(d){S.job=d&&d.job_id||null;S.receipt=d&&d.receipt||null;S.lastRefresh=new Date().toISOString();remember();schedule();})
      .catch(function(err){S.submitError=err;})
      .then(function(){S.submitting=false;redraw();});
  }
  function reset(){clearTimeout(S.timer);S.timer=null;S.job=null;S.receipt=null;S.receiptError=null;S.key=uuid();S.submitError=null;remember();redraw();}
  var STATE_LABEL={queued:"Queued",running:"Running",awaiting_approval:"Awaiting owner approval",completed:"Completed",failed:"Failed",cancelled:"Cancelled",unknown:"Unknown",unavailable:"Unavailable"};
  var STATE_TEXT={queued:"Stored in the canonical job ledger. The Core runner on OVH claims queued work; nothing has executed yet.",running:"Claimed by a Core runner and executing in an isolated worktree.",awaiting_approval:"A pending owner approval is recorded for this build.",completed:"The runner finished. Read what it reported below; a draft PR is not verified until it is read back from GitHub.",failed:"The runner stopped with an error. The job ledger keeps the reason.",cancelled:"The job will not run.",unknown:"The ledger did not return a state this product recognizes. Nothing is assumed."};
  function receiptCard(){
    var r=S.receipt;
    if(!S.job)return"";
    if(!r)return'<section class="cro-card crb-receipt" data-crb-state="loading"><h2>Build receipt</h2>'+(S.loadingReceipt?note("Reading the job ledger…"):S.receiptError?note("The receipt could not be read: "+e(S.receiptError.message||S.receiptError),true):"")+'</section>';
    var st=r.state||"unknown",rep=r.reported||{};
    var head='<div class="crb-state crb-state--'+e(st)+'"><b>'+e(STATE_LABEL[st]||st)+'</b><span>'+e(STATE_TEXT[st]||"")+'</span></div>';
    var meta='<dl class="crb-meta">'+
      '<dt>Correlation</dt><dd><code>'+e(r.correlation_id||S.job)+'</code></dd>'+
      '<dt>Repository</dt><dd>'+e(r.repository||"")+'</dd>'+
      (r.title?'<dt>Title</dt><dd>'+e(r.title)+'</dd>':"")+
      '<dt>Scope</dt><dd>'+(r.allowed_paths&&r.allowed_paths.length?e(r.allowed_paths.join(", ")):"whole repository (executor policy still applies)")+'</dd>'+
      '<dt>Attempts</dt><dd>'+e(r.attempts||0)+' of '+e(r.max_attempts||"?")+'</dd>'+
      '<dt>Queued</dt><dd>'+e(when(r.created_at))+'</dd>'+
      '<dt>Updated</dt><dd>'+e(when(r.updated_at))+'</dd>'+
      (r.locked_by?'<dt>Runner</dt><dd>'+e(r.locked_by)+'</dd>':"")+
      '</dl>';
    var out="";
    if(r.last_error)out+=note("Runner error: "+r.last_error,true);
    if(rep.branch||rep.draft_pr||rep.summary||rep.forbidden){
      out+='<div class="crb-reported"><h3>Reported by Core</h3>';
      if(rep.summary)out+='<p>'+e(rep.summary)+'</p>';
      if(rep.branch)out+='<p>Branch <code>'+e(rep.branch)+'</code>'+(rep.pushed?' · pushed':' · not pushed')+'</p>';
      if(rep.draft_pr)out+='<p><a href="'+e(rep.draft_pr)+'" target="_blank" rel="noopener noreferrer">Draft PR</a> <span class="cro-meta">reported, not verified</span></p>';
      if(rep.forbidden&&rep.forbidden.length)out+=note("Refused paths: "+rep.forbidden.join("; "),true);
      if(rep.tests)out+='<details><summary>Test output</summary><pre class="crb-pre">'+e(JSON.stringify(rep.tests,null,1))+'</pre></details>';
      if(rep.agent_output_tail)out+='<details><summary>Runner log tail</summary><pre class="crb-pre">'+e(rep.agent_output_tail)+'</pre></details>';
      out+='</div>';
    }
    var verify='<p class="cro-meta">'+(r.verification&&r.verification.draft_pr_verified?'Draft PR verified on GitHub.':'No independent GitHub read-back has happened yet; nothing on this receipt is treated as merged or deployed.')+'</p>';
    var actions='<div class="crb-actions"><button class="cr-btn" type="button" data-crb="refresh"'+(S.loadingReceipt?" disabled":"")+'>Refresh</button><button class="cr-btn cr-btn--ghost" type="button" data-crb="new">Start another build</button></div>'+(S.lastRefresh?'<p class="cro-meta">Read '+e(when(S.lastRefresh))+'</p>':"");
    return'<section class="cro-card crb-receipt" data-crb-state="'+e(st)+'"><h2>Build receipt</h2>'+head+meta+out+verify+actions+'</section>';
  }
  function formCard(){
    var s=S.status;
    if(!s)return"";
    var disabled=!s.enabled;
    var repos=(s.repositories||[]).map(function(r){return'<option value="'+e(r)+'"'+(r===S.form.repository?" selected":"")+'>'+e(r)+'</option>';}).join("");
    var contract='<ul class="crb-contract"><li>Capability <code>'+e(s.capability)+'</code> · risk <b>'+e(s.risk)+'</b> · '+e(s.approval)+'</li><li>Output: a <b>draft pull request only</b>. Core never merges, deploys or edits protected paths.</li><li>Budget: '+e(s.max_attempts)+' attempts on McCluster-owned compute; no paid provider.</li></ul>';
    return'<section class="cro-card"><h2>Build · Code</h2>'+contract+
      (disabled?'<div class="crb-state crb-state--unavailable"><b>Unavailable</b><span>'+e(s.unavailable_reason==="control_build_code_disabled"?"Control Build is switched off on the API. Nothing can be queued until the owner enables it.":"The build route is not available.")+'</span></div>':"")+
      '<form class="crb-form" data-crb-form><label><span>Repository</span><select class="cr-input" name="repository"'+(disabled?" disabled":"")+'>'+repos+'</select></label>'+
      '<label><span>Objective</span><textarea class="cr-textarea" name="task" rows="5" maxlength="'+e(s.limits&&s.limits.task_max||20000)+'" placeholder="One bounded change, described so a reviewer can judge the draft PR."'+(disabled?" disabled":"")+'>'+e(S.form.task)+'</textarea></label>'+
      '<label><span>Title (optional)</span><input class="cr-input" name="title" maxlength="'+e(s.limits&&s.limits.title_max||500)+'" value="'+e(S.form.title)+'"'+(disabled?" disabled":"")+'></label>'+
      '<label><span>Allowed paths (one per line, optional)</span><textarea class="cr-textarea" name="paths" rows="3" placeholder="js/travel&#10;scripts/test"'+(disabled?" disabled":"")+'>'+e(S.form.paths)+'</textarea></label>'+
      '<p class="cro-meta">Protected locations are refused twice: here and by the Core executor. Workflows, migrations, systemd units, credentials and secrets are never in scope.</p>'+
      (S.submitError?note(S.submitError.message||String(S.submitError),true):"")+
      '<div class="crb-actions"><button class="cr-btn cr-btn--primary" type="submit"'+(disabled||S.submitting?" disabled":"")+'>'+(S.submitting?"Queuing…":"Queue build")+'</button></div></form></section>';
  }
  function render(){
    if(!S.status&&!S.loadingStatus&&!S.statusError)loadStatus();
    var head=S.loadingStatus&&!S.status?note("Reading the build contract…"):S.statusError?note("The build route could not be read: "+(S.statusError.message||S.statusError),true):"";
    return'<div class="cro crb">'+head+receiptCard()+(S.job?"":formCard())+'</div>';
  }
  function bind(root){
    if(!root)return;
    var form=root.querySelector("[data-crb-form]");
    if(form){
      form.addEventListener("input",function(ev){var t=ev.target;if(t&&t.name&&S.form.hasOwnProperty(t.name))S.form[t.name]=t.value;});
      form.addEventListener("submit",function(ev){ev.preventDefault();submit();});
    }
    root.querySelectorAll("[data-crb]").forEach(function(b){b.onclick=function(){var a=b.getAttribute("data-crb");if(a==="refresh")loadReceipt();else if(a==="new")reset();};});
  }
  function init(opts){
    S.request=opts.request;S.rerender=opts.render;S.orgId=opts.orgId||null;
    if(!S.key)S.key=uuid();
    var last=recall();
    if(last){S.job=last.job_id;S.key=last.key||S.key;loadReceipt();}
    document.addEventListener("visibilitychange",function(){if(document.hidden){clearTimeout(S.timer);S.timer=null;}else schedule();});
  }
  window.CR.buildCode={init:init,render:render,bind:bind,state:S,ROUTE:ROUTE};
})();
