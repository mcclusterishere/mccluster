/* The existing Create Projects workspace's private authoring view.
   Plans use media_workflows; takes use media_jobs/assets; references use
   media_entities. This module never publishes a page or assembles a video. */
(function () {
  'use strict';
  window.CR = window.CR || {};
  var C, S = { node: null, list: [], refs: [], projects: [], saved: null, draft: null, scene: '', dirty: false, busy: false, message: '', quote: null, takes: {}, epoch: 0 };
  var e = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); };
  var copy = function (x) { return JSON.parse(JSON.stringify(x)); };
  function api(path, method, body) { return C.request('/v1/' + path + (method ? '' : (path.indexOf('?') < 0 ? '?' : '&') + 'org_id=' + encodeURIComponent(C.orgId() || '')), method ? { method: method, body: Object.assign({ org_id: C.orgId() }, body) } : undefined); }
  function scene() { return S.draft && S.draft.scenes.find(function (s) { return s.id === S.scene; }); }
  function models() { var c = window.CR.media && CR.media.state.catalog; return c && c.ok && c.data && (c.data.models || c.data) || []; }
  function model() { var s = scene(); return s && models().find(function (m) { return m.id === s.model_id; }); }
  function fields(m) { return Object.entries(m && m.parameter_schema && m.parameter_schema.properties || {}).map(function(x){return[x[0],Object.assign({},x[1],{type:x[1].type||(x[1].enum&&typeof x[1].enum[0])})];}).filter(function (x) { return x[0] !== 'prompt' && ['string','number','integer','boolean','array'].indexOf(x[1].type) >= 0; }); }
  function say(message) { S.message = message; var n = S.node && S.node.querySelector('[data-plan-message]'); if (n) n.textContent = message; }
  function field(label, name, value, multiline) { return '<label>' + e(label) + (multiline ? '<textarea rows="' + multiline + '" data-plan-field="' + name + '">' + e(value) + '</textarea>' : '<input data-plan-field="' + name + '" value="' + e(value) + '">') + '</label>'; }
  function option(value, label, selected) { return '<option value="' + e(value) + '"' + (value === selected ? ' selected' : '') + '>' + e(label) + '</option>'; }
  function mark() { S.dirty = true; S.quote = null; say('Unsaved changes'); var b = S.node.querySelector('[data-plan-action="generate"]'); if (b) b.disabled = true; }
  function collect() {
    if (!S.node || !S.draft) return;
    S.node.querySelectorAll('[data-plan-field]').forEach(function (n) {
      var key = n.dataset.planField, s = scene();
      if (key.indexOf('scene.') === 0) { if (s) s[key.slice(6)] = n.value; }
      else S.draft[key] = n.value;
    });
    var s = scene(); if (!s) return;
    S.node.querySelectorAll('[data-plan-input]').forEach(function (n) {
      s.input = s.input || {}; var value = n.type === 'checkbox' ? n.checked : n.value;
      if (n.dataset.kind === 'number' || n.dataset.kind === 'integer') value = value === '' ? undefined : Number(value);
      if (n.dataset.kind === 'array') value = String(value).split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
      if (value === '' || value === undefined) delete s.input[n.dataset.planInput]; else s.input[n.dataset.planInput] = value;
    });
  }
  async function list() {
    var result = await api('media/plans'); S.list = result.plans || [];
    var deps = await Promise.allSettled([api('media/references'), api('work/projects')]);
    if (deps[0].status === 'fulfilled') S.refs = deps[0].value.references || [];
    if (deps[1].status === 'fulfilled') S.projects = deps[1].value.projects || [];
    if (deps.some(function (d) { return d.status === 'rejected'; })) say('Plans loaded; a reference or project list is unavailable.');
  }
  async function open(id) {
    if (S.dirty) throw new Error('Save or download and discard your current draft before opening another plan.');
    var epoch = ++S.epoch, r = await api('media/plans/' + encodeURIComponent(id)); if (epoch !== S.epoch) return;
    S.saved = r.saved; S.draft = copy(r.saved.plan); S.scene = S.draft.scenes[0] && S.draft.scenes[0].id || ''; S.quote = null; S.takes = {}; say('Opened saved revision ' + r.saved.revision); paint();
  }
  async function save() {
    collect(); var previous = S.saved, draft = copy(S.draft), epoch = S.epoch;
    S.draftId = S.draftId || crypto.randomUUID();
    var r = await api('media/plans' + (previous ? '/' + previous.id : ''), previous ? 'PATCH' : 'POST', { client_id: S.draftId, plan: draft, expected_revision: previous && previous.revision, expected_hash: previous && previous.hash });
    if (epoch !== S.epoch) return;
    S.saved = r.saved; S.dirty = false; say('Saved revision ' + r.saved.revision + '. Reload checks the saved copy.'); await list();
  }
  function download(name, value) { var url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); }
  function inputHtml(m, s) {
    var props = fields(m), required = m && m.parameter_schema && m.parameter_schema.required || [];
    if (!props.length) return '<p class="cr-muted">This model has no declared reference controls. Its prompt is available; reference-driven generation requires a model with declared inputs.</p>';
    return props.map(function (x) {
      var key = x[0], p = x[1], v = (s.input || {})[key], label = p.title || key.replace(/_/g, ' ');
      var attr = ' data-plan-input="' + e(key) + '" data-kind="' + e(p.type) + '"';
      var control;
      if (p.enum) control = '<select' + attr + '>' + option('', 'Choose…', v) + p.enum.map(function (a) { return option(String(a), String(a), String(v)); }).join('') + '</select>';
      else if (p.type === 'boolean') control = '<input type="checkbox"' + attr + (v ? ' checked' : '') + '>';
      else if (p.type === 'array') control = '<textarea rows="2"' + attr + ' placeholder="One reference URL per line">' + e((v || []).join('\n')) + '</textarea>';
      else control = '<input' + attr + ' type="' + (p.type === 'number' || p.type === 'integer' ? 'number' : 'text') + '"' + (p.minimum != null ? ' min="' + p.minimum + '"' : '') + (p.maximum != null ? ' max="' + p.maximum + '"' : '') + ' value="' + e(v) + '">';
      return '<label>' + e(label) + (required.indexOf(key) >= 0 ? ' (required)' : '') + control + '</label>';
    }).join('');
  }
  function takesHtml(s) {
    return (s.takes || []).map(function (t) {
      var result = S.takes[t.job_id], job = result && result.job, assets = result && result.assets || [];
      return '<div class="cr-plan-take"><b>' + e(job && job.status || 'Saved take — check status') + '</b><small>' + e(t.job_id) + '</small>' + assets.map(function (a) {
        var url = a.url || a.signed_url || '', safe = /^https:\/\//.test(url), media = '';
        if (safe && /video/.test(a.media_type || a.type || '')) media = '<video controls preload="metadata" src="' + e(url) + '"></video>';
        else if (safe && /image/.test(a.media_type || a.type || '')) media = '<img alt="Generated take" src="' + e(url) + '">';
        return media + '<button type="button" class="cr-btn" data-plan-select="' + e(a.id) + '" data-job="' + e(t.job_id) + '"' + (job && job.status === 'completed' ? '' : ' disabled') + '>' + (s.selected_asset_id === a.id ? 'Selected' : 'Use this take') + '</button>';
      }).join('') + '</div>';
    }).join('') || '<p class="cr-muted">No takes yet. Saving or estimating never generates media.</p>';
  }
  function view() {
    var d = S.draft, s = scene(), m = model();
    var html = '<section class="cr-plan"><h2>Story → scenes → review</h2><p>Write your story, keep your references, then make and choose each scene.</p><div class="cr-plan-actions"><select data-plan-open aria-label="Saved production plan">' + option('', 'Open a saved plan…', '') + S.list.map(function (p) { return option(p.id, p.name, S.saved && S.saved.id); }).join('') + '</select><button class="cr-btn" data-plan-action="list">Refresh plans</button><button class="cr-btn" data-plan-action="new">New plan</button></div><p role="status" data-plan-message>' + e(S.message) + '</p>';
    if (!d) return html + '</section>';
    html += '<div class="cr-plan-actions"><button class="cr-btn cr-btn--primary" data-plan-action="save">Save plan</button><button class="cr-btn" data-plan-action="reload">Reload saved</button><button class="cr-btn" data-plan-action="export-draft">Export working copy</button><button class="cr-btn" data-plan-action="discard">Download and discard changes</button><button class="cr-btn" data-plan-action="export">Export saved timeline</button><a class="cr-btn" href="control.html#create:front-page">Preview front page</a></div>';
    if (S.saved) html += '<p>Saved revision ' + S.saved.revision + (S.dirty ? ' · working changes' : '') + '</p><label>Recover an earlier revision<select data-plan-restore>' + option('', 'Choose…', '') + S.saved.history.map(function (h) { return option(String(h.revision), 'Revision ' + h.revision, ''); }).join('') + '</select></label>';
    html += '<details open><summary>Story and canon</summary><div class="cr-plan-fields">' + field('Title','title',d.title) + field('Source / canon reference','source_ref',d.source_ref) + '<label>Work project<select data-plan-field="work_project_id">' + option('', 'Unassigned',d.work_project_id) + S.projects.map(function (p) { return option(p.id,p.title,d.work_project_id); }).join('') + '</select></label>' + field('Current canon and open decisions','canon',d.canon,4) + field('Episode script','script',d.script,8) + '<label>Bring in a Markdown or text draft<input type="file" data-plan-import accept=".md,.txt,text/plain,text/markdown"></label></div></details>';
    html += '<details><summary>Characters and references</summary><p>Keep your own face, character, wardrobe and location references here. Adding one does not generate or publish anything.</p><div class="cr-plan-fields"><label>Name<input data-ref="name"></label><label>Reference image URL<input data-ref="url" type="url"></label><label>Keep consistent<textarea data-ref="prompt"></textarea></label><label><input type="checkbox" data-ref="owned"> This is my reference, or I have permission to use it</label><button class="cr-btn" data-plan-action="reference">Save reference</button></div><ul>' + S.refs.map(function (r) { return '<li>' + e(r.name) + '</li>'; }).join('') + '</ul></details>';
    html += '<details open><summary>Scenes</summary><div class="cr-plan-actions"><select data-plan-scene aria-label="Scene">' + d.scenes.map(function (x,i) { return option(x.id,(i+1) + '. ' + (x.title || 'Untitled scene'),S.scene); }).join('') + '</select><button class="cr-btn" data-plan-action="add-scene">Add scene</button><button class="cr-btn" data-plan-action="up">Move earlier</button><button class="cr-btn" data-plan-action="down">Move later</button></div>';
    if (s) {
      html += '<div class="cr-plan-fields">' + field('Scene title','scene.title',s.title) + field('Script / shot','scene.script',s.script,3) + field('Generation prompt','scene.prompt',s.prompt,3) + field('Continuity notes','scene.reference_notes',s.reference_notes,2) + field('Soundtrack association (leave unassigned until verified)','scene.soundtrack',s.soundtrack) + '<label>Reference<select data-plan-reference>' + option('','Choose a saved reference…','') + S.refs.map(function (r) { return option(r.id,r.name,''); }).join('') + '</select></label><label>Model<select data-plan-model>' + option('','Choose…',s.model_id) + models().filter(function (x) { return x.provider === 'fal'; }).map(function (x) { return option(x.id,x.display_name || x.provider_model_id,s.model_id); }).join('') + '</select></label>' + inputHtml(m,s) + '</div>';
      html += '<div class="cr-plan-actions"><button class="cr-btn" data-plan-action="estimate">Check cost</button><button class="cr-btn cr-btn--primary" data-plan-action="generate"' + (!S.quote || s.submission && s.submission.state === 'uncertain' ? ' disabled' : '') + '>Generate this scene</button><button class="cr-btn" data-plan-action="takes">Refresh takes</button></div>' + (S.quote ? '<p>Estimate: $' + (S.quote.estimate.estimated_cost_usd_micros / 1000000).toFixed(4) + ' · ' + e(S.quote.provider) + '. Actual cost may differ.</p>' : '') + (s.submission && s.submission.state === 'uncertain' ? '<p>A previous submission needs checking in Library before another take. It may already have been accepted.</p><button class="cr-btn" data-plan-action="resolve-submission">I checked Library; allow another take</button>' : '') + '<div class="cr-plan-takes">' + takesHtml(s) + '</div>';
    }
    return html + '</details><p class="cr-muted">Timeline export records selected takes and gaps. It is an editing manifest, not a rendered episode. Drafts and source text stay private.</p></section>';
  }
  async function action(name) {
    collect(); var s = scene();
    if (name === 'list') { await list(); return; }
    if (name === 'new') { if (S.dirty) throw new Error('Save or download and discard the current draft before starting another.'); ++S.epoch; S.saved = null; S.draftId = crypto.randomUUID(); S.draft = {title:'Untitled story',source_ref:'',canon:'',script:'',work_project_id:'',scenes:[]}; S.scene = ''; S.dirty = true; return; }
    if (name === 'save') { await save(); return; }
    if (name === 'reload') { if (!S.saved) throw new Error('Save this plan first.'); if (S.dirty) throw new Error('Save or download and discard your working changes before reloading.'); await open(S.saved.id); return; }
    if (name === 'discard') { download('production-working-copy.json',{kind:'unsaved-working-copy',plan:S.draft}); S.draft=S.saved?copy(S.saved.plan):null; S.scene=S.draft&&S.draft.scenes[0]&&S.draft.scenes[0].id||''; S.dirty=false; S.quote=null; say('Working copy downloaded; changes discarded from this view.'); return; }
    if (name === 'export-draft') { download('production-working-copy.json',{kind:'unsaved-working-copy',plan:S.draft}); say('Working copy exported. It has not been saved to the backend.'); return; }
    if (name === 'export') {
      if (!S.saved) throw new Error('Save a revision first.');
      download('production-timeline-r' + S.saved.revision + '.json',{kind:'episode-editing-manifest',rendered_video:false,plan_id:S.saved.id,revision:S.saved.revision,hash:S.saved.hash,title:S.saved.plan.title,scenes:S.saved.plan.scenes.map(function(x,i){return{order:i+1,scene_id:x.id,title:x.title,duration:x.input && x.input.duration || null,asset_id:x.selected_asset_id || null,take:(x.takes || []).find(function(t){return t.asset_id === x.selected_asset_id;}) || null,soundtrack:x.soundtrack || null,status:x.selected_asset_id?'selected':'unassigned'};})}); say('Exported saved revision ' + S.saved.revision + '. Unsaved changes are excluded.'); return;
    }
    if (name === 'add-scene') { s = {id:'scene-' + crypto.randomUUID(),title:'New scene',script:'',prompt:'',reference_notes:'',soundtrack:'',status:'draft',input:{},takes:[]}; S.draft.scenes.push(s); S.scene = s.id; mark(); return; }
    if (name === 'up' || name === 'down') { var i=S.draft.scenes.indexOf(s), j=i+(name==='up'?-1:1); if(i>=0 && j>=0 && j<S.draft.scenes.length){S.draft.scenes.splice(i,1);S.draft.scenes.splice(j,0,s);mark();} return; }
    if (name === 'reference') { var get=function(k){return S.node.querySelector('[data-ref="'+k+'"]');}; await api('media/references','POST',{name:get('name').value,url:get('url').value,prompt:get('prompt').value,owned:get('owned').checked}); await list(); say('Reference saved'); return; }
    if (!s) throw new Error('Choose a scene first.');
    if (name === 'estimate') { var q=await api('media/estimate','POST',{model_id:s.model_id,prompt:s.prompt,input:s.input || {}}); if(!q.estimate.available)throw new Error('A reliable estimate is unavailable for these settings. Generation stays off.'); S.quote=q; say('Estimate ready. Generate is a separate paid action.'); return; }
    if (name === 'resolve-submission') { s.submission.state='checked'; mark(); await save(); say('Prior submission marked checked. Check cost again before generating.'); return; }
    if (name === 'generate') {
      if (!S.quote) throw new Error('Check the cost for these settings first.');
      if(s.submission && s.submission.state==='uncertain')throw new Error('Check the earlier submission in Library first.');
      var quote=S.quote; s.submission={state:'uncertain',started_at:new Date().toISOString()}; await save();
      var r;try{r=await api('media/generate','POST',{model_id:s.model_id,prompt:s.prompt,input:s.input || {},expected_quote_hash:quote.quote_hash,budget_cents:Math.max(1,Math.ceil(quote.estimate.estimated_cost_usd_micros/10000))});}catch(err){S.quote=null;throw new Error('Submission could not be confirmed. Check Library before trying again. '+err.message);}
      if(!r.job || !r.job.id)throw new Error('Submission outcome is uncertain. Check the media Library before generating again.');
      s.submission={state:'accepted',job_id:r.job.id}; s.takes.push({job_id:r.job.id,plan_revision:S.saved.revision,plan_hash:S.saved.hash,model_id:s.model_id}); S.dirty=true; S.quote=null;
      try { await save(); } catch(err) { say('Job '+r.job.id+' was accepted, but its plan link could not be saved. Keep this draft and check Library; do not regenerate.'); throw new Error(S.message); }
      if(CR.media.trackExisting)CR.media.trackExisting(r.job,s.title); say('Scene queued. Refresh takes to compare results.'); return;
    }
    if (name === 'takes') { for (var t of s.takes || []) S.takes[t.job_id]=await api('media/jobs/'+t.job_id); say('Take status refreshed'); }
  }
  function paint() {
    if (!S.node) S.node=document.createElement('div'); S.node.innerHTML=view();
    S.node.querySelectorAll('input,textarea,select').forEach(function(n){n.disabled=S.busy;});
    S.node.querySelectorAll('[data-plan-field],[data-plan-input]').forEach(function(n){n.oninput=function(){collect();mark();};n.onchange=function(){collect();mark();};});
    S.node.querySelectorAll('[data-plan-action]').forEach(function(b){if(S.busy)b.disabled=true;b.onclick=function(){run(function(){return action(b.dataset.planAction);});};});
    var n=S.node.querySelector('[data-plan-open]'); if(n)n.onchange=function(){var value=this.value;if(value)run(function(){return open(value);});};
    n=S.node.querySelector('[data-plan-scene]');if(n)n.onchange=function(){collect();S.scene=this.value;S.quote=null;paint();};
    n=S.node.querySelector('[data-plan-model]');if(n)n.onchange=function(){collect();scene().model_id=this.value;scene().input={};fields(model()).forEach(function(x){if(x[1].default!==undefined)scene().input[x[0]]=x[1].default;});mark();paint();};
    n=S.node.querySelector('[data-plan-restore]');if(n)n.onchange=function(){if(S.dirty){say("Save or download and discard your changes before recovering a revision.");this.value="";return;}var value=this.value,h=S.saved.history.find(function(x){return String(x.revision)===value;});if(h){S.draft=copy(h.plan);S.scene=S.draft.scenes[0]&&S.draft.scenes[0].id || '';mark();say('Recovered revision '+h.revision+' as a working draft. Save creates a new revision.');paint();}};
    n=S.node.querySelector('[data-plan-import]');if(n)n.onchange=function(){var f=this.files[0];if(!f)return;if(f.size>200000){say('Import is limited to 200 KB');return;}run(async function(){S.draft.script=await f.text();S.draft.source_ref=f.name;mark();say('Imported into the working draft; save when ready.');});};
    n=S.node.querySelector('[data-plan-reference]');if(n)n.onchange=function(){var value=this.value,r=S.refs.find(function(x){return x.id===value;}),s=scene(),p=fields(model()).find(function(x){return /image.*urls?$|reference.*urls?$/.test(x[0]);});if(!r||!s)return;if(!p){say('Choose a model with a declared image reference input first.');return;}s.input[p[0]]=p[1].type==='array'?[r.attributes.url]:r.attributes.url;s.reference_notes=[s.reference_notes,r.name+': '+(r.canonical_prompt||'')].filter(Boolean).join('\n');mark();paint();};
    S.node.querySelectorAll('[data-plan-select]').forEach(function(b){b.onclick=function(){var s=scene(),id=b.dataset.planSelect,t=s.takes.find(function(t){return t.job_id===b.dataset.job;});t.asset_id=id;s.selected_asset_id=id;s.status='selected';mark();paint();};});
  }
  async function run(fn){if(S.busy)return;collect();S.busy=true;S.node.querySelectorAll('input,textarea,select,button').forEach(function(n){n.disabled=true;});try{await fn();}catch(err){say(err.message||'The request failed; your working copy is still here.');}finally{S.busy=false;paint();}}
  window.CR.productionPlan={init:function(ctx){C=ctx;},render:function(){return '<div data-production-plan></div>';},bind:function(root){var org=C.orgId();if(S.org!==org){S.epoch++;S.org=org;S.list=[];S.refs=[];S.projects=[];S.saved=null;S.draft=null;S.scene='';S.dirty=false;S.quote=null;S.takes={};S.message='';paint();}var h=root.querySelector('[data-production-plan]');if(!h)return;if(!S.node)paint();h.appendChild(S.node);},state:S};
})();
