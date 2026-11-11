/* Public environmental evidence and scoped participation, inside the existing
   World. Auth, membership, approval and capture eligibility remain server-owned. */
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const text = (value, max = 320) => typeof value === 'string' ? value.slice(0, max) : '';
export function safeURL(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function captureURL(value, assignment, origin = 'https://environment.invalid') {
  if (!uuid(assignment) || typeof value !== 'string') return '';
  try { const u = new URL(value, origin); return u.origin === new URL(origin).origin && u.pathname === '/live-mission.html' && u.searchParams.get('assignment') === assignment ? u.pathname + u.search : ''; } catch { return ''; }
}
export function normalizeFeed(body) {
  if (body?.schema !== 'world-environment/v1' || !Array.isArray(body.events) || !Array.isArray(body.sources)) throw new Error('Environmental data did not return a supported response.');
  const seen = new Set();
  const events = body.events.slice(0, 600).flatMap(row => {
    if (!row || typeof row.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:_./-]{0,299}$/.test(row.id || '') || seen.has(row.id) || !safeURL(row.source?.url)) return [];
    seen.add(row.id);
    const mapped = typeof row.lat === 'number' && typeof row.lon === 'number' && Number.isFinite(row.lat) && Number.isFinite(row.lon) && Math.abs(row.lat) <= 90 && Math.abs(row.lon) <= 180;
    return [{ ...row, lat:mapped ? row.lat : null, lon:mapped ? row.lon : null, title: text(row.title, 180), actions: Array.isArray(row.actions) ? row.actions.filter(a => a && typeof a === 'object' && typeof a.id === 'string' && typeof a.title === 'string').slice(0, 8) : [], source: { label: text(row.source.label, 120), url: safeURL(row.source.url) } }];
  });
  return { ...body, events, sources:body.sources.filter(s => s && typeof s === 'object').slice(0, 20), missions: (Array.isArray(body.missions) ? body.missions : []).filter(m => m && uuid(m.id)).slice(0, 200) };
}
export function normalizeAssignments(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).slice(0, 200).flatMap(row => {
    if (!row || !uuid(row.assignment_id) || !uuid(row.mission_id) || seen.has(row.assignment_id) || !['joined','in_progress','submitted','verified','rejected'].includes(row.status)) return [];
    seen.add(row.assignment_id);
    return [{ ...row, title:text(row.title,180), description:text(row.description,2000), event_id:text(row.event_id,300), source:{label:text(row.source?.label,120),url:safeURL(row.source?.url)} }];
  });
}
export function timeLabel(value) {
  const date = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(date) ? new Date(date).toLocaleString(undefined, { dateStyle:'medium', timeStyle:'short' }) : 'Not supplied by provider';
}
const owners = new WeakMap(); // host panel -> current mounted instance (audit EQ2)
export function mountEnvironment(w, d, adapter) {
  if (!adapter || typeof adapter.request !== 'function' || typeof adapter.token !== 'function' || typeof adapter.signIn !== 'function') throw new Error('An environmental host adapter is required.');
  const panel = adapter.panel || d.getElementById('wePanel'), frame = adapter.frame || d.getElementById('mnWorldFrame');
  if (!panel || !frame) return;
  const el = (tag, value = '', cls = '') => { const node = d.createElement(tag); node.textContent = value; if (cls) node.className = cls; return node; };
  const button = (label, action) => { const node = el('button', label); node.type = 'button'; node.onclick = action; return node; };
  const link = (label, href) => { const node = el('a', label); node.href = href; node.rel = 'noopener noreferrer'; node.target = '_blank'; return node; };
  const byId = id => panel.querySelector('#'+id);
  const mode = () => adapter.mode?.() || d.documentElement.dataset.worldMode;
  const active = () => mode() === 'environment';
  const send = data => adapter.sendGlobe ? adapter.sendGlobe(data) : frame.contentWindow?.postMessage(data, w.location.origin);
  const listeners = [];
  const listen = (type, fn) => { w.addEventListener(type,fn);listeners.push([type,fn]); };
  let destroyed = false;
  const instance = Symbol('environment-panel'); owners.set(panel, instance);
  // Every mutation captures the confirming identity and lifecycle generation up front
  // and hands both to the transport, which rechecks them after its own asynchronous
  // credential step and immediately before fetch (audit EQ1).
  const scope = (identity, epoch, current = () => true) => ({ expectedToken: identity, isCurrent: () => !destroyed && epoch === privateEpoch && owners.get(panel) === instance && current() });
  let feed = null, selected = '', search = '', requested = false, feedBusy = false, privateBusy = false, privateEpoch = 0, feedEpoch = 0;
  let proofEpoch=0,proofBusy=false,planningEpoch=0;
  let team = null, oversight = null, proofReviews=null, privateToken = null, abort = null, timer = null, joining = false, saving = false;
  const token = async () => {try{return await adapter.token()||null;}catch{return null;}};
  const sessionCurrent=async(identity,epoch)=>{const value=await token();return !destroyed&&epoch===privateEpoch&&value===identity;};
  panel.innerHTML = '<p class="we-eyebrow">Environmental Justice</p><h2 id="weTitle">See the evidence. Take action.</h2><p class="we-subtle">Government observations, their dates and practical missions on this same globe. An event is not proof of environmental injustice.</p><div class="we-toolbar"><button type="button" id="weRefresh">Refresh sources</button><span class="we-subtle" id="weFreshness"></span></div><p id="weStatus" class="we-message" role="status" aria-live="polite"></p><section class="we-team" id="weTeam" aria-label="Environmental Justice Team"></section><section id="weAssignments" class="we-team" aria-label="Your environmental missions" hidden data-private></section><section id="wePlanning" class="we-detail" aria-label="Owner news and sponsorship planning" hidden data-private></section><section id="weProof" class="we-detail" aria-label="Mission evidence" hidden data-private></section><section id="weDetail" class="we-detail" aria-label="Selected environmental observation" hidden></section><label class="we-filter">Find an observation<input id="weSearch" type="search" placeholder="Place or event" maxlength="120"></label><p id="weCount" class="we-subtle"></p><ul class="we-list" id="weEvents"></ul><details><summary>Sources, coverage and limitations</summary><ul class="we-source-list" id="weSources"></ul><p class="we-subtle">No marker does not mean a place is safe. Coverage and reporting delays vary. These feeds do not measure every pollutant, establish responsibility or replace official emergency instructions.</p></details><section id="weOwner" class="we-owner" aria-label="Owner mission oversight" hidden data-private></section>';
  const status = message => { if (!destroyed) byId('weStatus').textContent = message; };
  const signIn = () => adapter.signIn();
  const request = (path, options = {}) => adapter.request(path, options);
  function syncPins() {
    send({ type:'hu:environment-pins', on:active(), selected, items:active() && feed ? feed.events.filter(matches).filter(row => row.lat !== null && row.lon !== null).map(row => ({ id:row.id, title:row.title, lat:row.lat, lon:row.lon, stale:row.stale })) : [] });
  }
  const matches = row => !search || [row.title, row.category, row.source.label].join(' ').toLocaleLowerCase().includes(search);
  function select(id, fly) {
    if (!feed?.events.some(row => row.id === id)) return;
    adapter.revealPanel?.();
    selected = id; renderDetail(); renderList(); syncPins();
    if (fly && feed.events.find(row => row.id === id)?.lat !== null) send({ type:'hu:environment-focus', id });
    byId('weDetail').scrollIntoView?.({ block:'nearest', behavior:'auto' });
  }
  function renderList() {
    const list = byId('weEvents'); list.replaceChildren();
    const rows = feed?.events.filter(matches) || [];
    byId('weCount').textContent = feed ? `${rows.length} observations shown${feed.truncated ? " (source results limited)" : ""}. Select one here or on the globe.` : '';
    for (const row of rows) {
      const item = el('li'), control = button('', () => select(row.id, true));
      control.setAttribute('aria-pressed', String(selected === row.id));
      control.append(el('strong', row.title), el('small', `${row.category || 'Observation'} · ${row.source.label}${row.stale ? ' · Older observation' : ''}`), el('small', `Observed: ${timeLabel(row.observed_at)}`));
      item.append(control); list.append(item);
    }
    if (feed && !rows.length) list.append(el('li', search ? 'No observations match this search.' : 'No observations returned. Check source availability below.'));
  }
  function renderSources() {
    const list = byId('weSources'); list.replaceChildren();
    for (const source of feed?.sources || []) {
      const item = el('li'); item.append(el('strong', text(source.label, 120)), el('p', `${text(source.status, 60) || 'Availability unknown'} · ${text(source.coverage, 200)}`, 'we-subtle'), el('p', `Retrieved: ${timeLabel(source.fetched_at)}. Latest observation: ${timeLabel(source.observed_at)}.`, 'we-subtle')); list.append(item);
    }
  }
  function assignmentFor(id) { return normalizeAssignments(team?.assignments).find(a => a.mission_id === id); }
  function renderDetail() {
    if (destroyed) return;
    const box = byId('weDetail'), row = feed?.events.find(row => row.id === selected);
    box.hidden = !row; box.replaceChildren(); if (!row) return;
    box.append(button('Close observation', () => { selected = ''; renderDetail(); renderList(); syncPins(); }), el('p', text(row.category, 80), 'we-eyebrow'), el('h3', row.title));
    const facts = el('dl');
    for (const [key,value] of [['Observed',timeLabel(row.observed_at)],['Retrieved',timeLabel(row.fetched_at)],['Freshness',row.stale ? 'Older observation. Verify current official guidance.' : 'Provider observation. Not a continuous live feed.']]) facts.append(el('dt',key),el('dd',value));
    for (const fact of (Array.isArray(row.facts) ? row.facts : []).slice(0,16)) {
      if (fact && typeof fact.label==='string' && typeof fact.value==='string') facts.append(el('dt',text(fact.label,80)),el('dd',text(fact.value,320)));
    }
    facts.append(el('dt','Source'), (() => { const value=el('dd');value.append(link(row.source.label,row.source.url));return value; })()); box.append(facts);
    if (row.instructions) box.append(el('h4','Official instructions'),el('p',text(row.instructions,2000)));
    if (row.description) box.append(el('p',text(row.description,2000)));
    box.append(el('p', row.lat === null ? 'This report has no mapped point. Read the source for the affected area.' : row.location_kind === 'area_label' ? 'Marker labels a boundary of the reported area, not a precise incident location.' : 'Marker is the provider’s reported location; verify the affected area in the source.', 'we-subtle'));
    box.append(el('p','Stay out of restricted or hazardous areas. Do not handle debris, sample unknown substances, interrupt responders or record people without permission. Follow local emergency instructions.', 'we-safety'));
    box.append(el('h4','Useful work you can do'));
    for (const action of row.actions) {
      const card = el('article'); card.append(el('h4',text(action.title,180)),el('p',text(action.description,900)),el('p','Evidence: '+text(action.proof,500),'we-subtle'),el('p',text(action.safety,700),'we-subtle'));
      const mission = feed.missions.find(m => m.event_id === row.id && m.action_id === action.id && m.status === 'open');
      if (mission) {
        const assignment = assignmentFor(mission.id);
        if (assignment) {
          card.append(el('p','Your mission: '+text(assignment.status,60)));
          card.append(button('View your saved mission',()=>byId('weAssignments').scrollIntoView?.({block:'nearest',behavior:'auto'})));
        } else card.append(button('Join approved mission', () => joinMission(mission)));
      } else {
        const propose = button('Suggest this mission for review', () => proposeMission(row, action)); propose.disabled = saving; card.append(propose,el('p','A suggestion is reviewed by the owner before anyone can join.','we-subtle'));
      }
      if(oversight)card.append(button('Review daily news context',()=>openPlanning(row,action)));
      box.append(card);
    }
    if (feed.missions_unavailable) box.append(el('p','Mission availability could not be verified. Refresh to check again.','we-subtle'));
  }
  function renderAssignments() {
    if (destroyed) return;
    const box=byId('weAssignments');box.replaceChildren();box.hidden=!privateToken;
    if (!privateToken) return;
    box.append(el('h3','Your missions'),el('p','Your saved assignments stay here even when an observation leaves the feed. They are not shown to other visitors.','we-subtle'));
    if (!team) { box.append(el('p','Saved missions could not be confirmed. Check membership to try again.')); return; }
    const assignments=normalizeAssignments(team.assignments);
    if (!assignments.length) box.append(el('p','No saved environmental missions yet. Select an observation to find approved work or suggest a mission for review.'));
    if (team.assignments_limited) box.append(el('p','Showing your 200 most recent assignments. Older assignments remain saved.','we-subtle'));
    for (const assignment of assignments) {
      const card=el('article');
      card.append(el('h4',assignment.title || 'Environmental mission'),el('p','Your mission: '+text(assignment.status,60)));
      card.append(el('p','Mission availability: '+(text(assignment.mission_status,60) || 'Not confirmed'),'we-subtle'));
      if (assignment.description) card.append(el('p',assignment.description));
      if (assignment.source.url) card.append(link('Saved source: '+(assignment.source.label || 'Official report'),assignment.source.url),el('p','Observation saved with this mission: '+timeLabel(assignment.observed_at)+'. This is a historical source snapshot, not current conditions.','we-subtle'));
      if(safeURL(assignment.news_context?.url))card.append(el('h4','Reviewed news context'),el('p',text(assignment.news_context.title,1000)),link('Read reported news context',safeURL(assignment.news_context.url)),el('p','Reported headline claim, not verified environmental fact. GDELT seen time: '+timeLabel(assignment.news_context.seen_at),'we-subtle'));
      if (assignment.ends_at) card.append(el('p','Mission end: '+timeLabel(assignment.ends_at),'we-subtle'));
      if (feed?.events.some(row=>row.id===assignment.event_id)) card.append(button('View current observation',()=>select(assignment.event_id,true)));
      else card.append(el('p','This observation is not in the current feed. Check the official source before acting; your assignment has not been deleted.','we-subtle'));
      const href=captureURL(assignment.capture_path,assignment.assignment_id,w.location.origin);
      if (href) {
        const capture=link('Check recording availability',href);capture.removeAttribute('target');card.append(capture);
        card.append(el('p','This opens setup only. Service availability, permission and consent are checked separately. Nothing starts automatically.','we-subtle'));
      } else card.append(el('p',assignment.mission_status==='paused'||assignment.mission_status==='closed' ? 'This mission is paused or closed. Review its status before doing more work. Recording setup is not offered here.' : ['submitted','verified'].includes(assignment.status) ? 'Your work is saved for review or already verified. No new recording is needed here.' : 'Recording availability has not been confirmed.','we-subtle'));
      card.append(button('Open mission evidence',()=>openProof(assignment)));
      box.append(card);
    }
  }
  function closePlanning(){planningEpoch++;const box=byId('wePlanning');box.hidden=true;box.replaceChildren();}
  async function openPlanning(row,action){
    if(destroyed||!oversight)return;
    const epoch=++planningEpoch,identityEpoch=privateEpoch,identity=await token();
    if(destroyed||epoch!==planningEpoch||identityEpoch!==privateEpoch||!identity)return;
    const box=byId('wePlanning');box.hidden=false;box.replaceChildren(el('h3','Reviewed news and partnership preparation'),el('p','Loading retained headlines…'));box.scrollIntoView?.({block:'nearest'});
    const current=()=>!destroyed&&epoch===planningEpoch&&identityEpoch===privateEpoch;
    const currentIdentity=async()=>{const value=await token();return current()&&value===identity;};
    const call=(operation,body)=>request('/planning/'+operation,{method:'POST',auth:true,...scope(identity,identityEpoch,current),body:{eventId:row.id,actionId:action.id,...body}});
    try{
      const context=await call('context',{});if(!await currentIdentity())return;
      box.replaceChildren(button('Close planning',closePlanning),el('h3','Reviewed news and partnership preparation'),el('p',row.title));
      box.append(el('p',text(context.coverage,500)||'A bounded daily GDELT candidate pool, not automatic geographic or factual verification.','we-subtle'),el('p','Review the linked report and its relevance. Headlines are reported claims, not proof of environmental injustice. Approval here permits this news context only; a mission still needs a separate owner decision.','we-safety'));
      const statusLine=el('p','','we-message');statusLine.setAttribute('role','status');box.append(statusLine);
      const reviewed=el('section');reviewed.append(el('h4','Currently reviewed context'));
      for(const item of context.reviewed||[]){
        if(!uuid(item.review_id))continue;
        const card=el('article');card.append(el('p',text(item.title,1000)));
        if(safeURL(item.canonical_url))card.append(link('Read reviewed report',safeURL(item.canonical_url)));
        card.append(button('Suggest mission with this context',()=>proposeMission(row,action,item.review_id)));reviewed.append(card);
      }
      if(!context.reviewed?.length)reviewed.append(el('p','No current reviewed headline context is available for this observation.'));box.append(reviewed);
      const candidates=el('details');candidates.append(el('summary','Review daily headline candidates'));
      for(const article of (context.articles||[]).filter(a=>a.within_daily_window).slice(0,100)){
        const card=el('article');card.append(el('h4',text(article.title,1000)),el('p','GDELT seen time: '+timeLabel(article.seen_at)+'. Publisher publication time is not verified.','we-subtle'));
        if(safeURL(article.canonical_url))card.append(link('Inspect publisher report',safeURL(article.canonical_url)));
        const label=el('label','Why is this report relevant to the selected observation?'),rationale=el('textarea');rationale.rows=3;rationale.maxLength=2000;label.append(rationale);card.append(label);
        const approve=button('Approve this headline context',async()=>{
          if(approve.disabled||!current())return;if(!rationale.value?.trim()){statusLine.textContent='Explain relevance before approving a headline.';return;}
          if(!w.confirm('Approve this exact headline as context for the selected observation? This does not approve a mission or send outreach.'))return;
          approve.disabled=true;
          try{const result=await call('review',{articleId:article.id,revision:article.revision,headlineExcerpt:article.title,rationale:rationale.value.trim()});if(!await currentIdentity())return;if(!uuid(result.review_id))throw Error('Review was not confirmed.');status('News context review saved.');await openPlanning(row,action);}
          catch(error){if(await currentIdentity())statusLine.textContent=error.message||'Review was not confirmed. Reload before retrying.';}
          finally{approve.disabled=false;}
        });card.append(approve);candidates.append(card);
      }
      box.append(candidates);
      const sponsors=el('section');sponsors.append(el('h4','Potential sponsor preparation'),el('p','Candidates come from your existing CRM. Matching notes are only a hypothesis about fit. No recipient, consent, partnership, payment or outreach is established.','we-subtle'));
      const sponsorResults=el('div');
      const load=button('Find CRM sponsor candidates',async()=>{
        if(load.disabled||!current())return;load.disabled=true;
        try{const result=await call('companies',{});if(!await currentIdentity())return;sponsorResults.replaceChildren();
          for(const company of result.companies||result.candidates||[]){
            const card=el('article');card.append(el('h4',text(company.name,300)),el('p',text(company.alignmentExcerpt||company.alignment_excerpt,1500),'we-subtle'));
            const draftResult=el('div');
            const draft=button('Prepare partnership draft',async()=>{
              if(draft.disabled||!current())return;draft.disabled=true;
              try{const value=await call('sponsor-draft',{companyId:company.company_id||company.id,alignmentExcerpt:company.alignmentExcerpt||company.alignment_excerpt});if(!await currentIdentity())return;draftResult.replaceChildren(el('h4',text(value.subject,1000)),el('p',typeof value.body==='string'?value.body:'','we-draft'),el('p',text(value.citation_limitation,500),'we-subtle'),el('p','Draft only. No recipient selected and nothing sent. Obtain approval for a specific recipient, final content and any commitment before outreach.','we-safety'));}
              catch(error){if(await currentIdentity())statusLine.textContent=error.message||'Draft could not be prepared.';}
              finally{draft.disabled=false;}
            });card.append(draft,draftResult);sponsorResults.append(card);
          }
          if(!(result.companies||result.candidates||[]).length)statusLine.textContent='No evidenced CRM match was found for this reviewed context. No fit has been invented.';
        }catch(error){if(await currentIdentity())statusLine.textContent=error.message||'Sponsor candidates could not be checked.';}
        finally{load.disabled=false;}
      });sponsors.append(load,sponsorResults);box.append(sponsors);
    }catch(error){if(await currentIdentity())box.replaceChildren(button('Close planning',closePlanning),el('p',error.message||'News planning is unavailable. No review or mission was saved.'));}
  }
  function closeProof() { proofEpoch++;const box=byId('weProof');box.hidden=true;box.replaceChildren(); }
  async function openProof(assignment) {
    if(destroyed||proofBusy||!privateToken)return;
    const epoch=++proofEpoch,identityEpoch=privateEpoch,identity=await token();
    if(destroyed||epoch!==proofEpoch||identityEpoch!==privateEpoch||!identity)return;
    const box=byId('weProof');box.hidden=false;box.replaceChildren(el('h3','Mission evidence'),el('p','Loading your saved evidence…'));
    box.scrollIntoView?.({block:'nearest'});
    const requestScope=scope(identity,identityEpoch,()=>epoch===proofEpoch);
    const current=async()=>{const value=await token();return !destroyed&&epoch===proofEpoch&&identityEpoch===privateEpoch&&identity===value;};
    try {
      const state=await request('/assignments/'+assignment.assignment_id+'/proof',{auth:true,...requestScope});
      if(!await current())return;
      box.replaceChildren(button('Close evidence',closeProof),el('h3',assignment.title||'Mission evidence'));
      const note=el('p','','we-message');note.setAttribute('role','status');note.setAttribute('aria-live','polite');box.append(note);
      if(state.proof){box.append(el('p','Evidence review: '+text(state.proof.status,60)),el('p',text(state.proof.statement,4000)));if(safeURL(state.proof.proof_url))box.append(link('Submitted source link',safeURL(state.proof.proof_url)));if(state.proof.review_note)box.append(el('p','Reviewer feedback: '+text(state.proof.review_note,1000)));}
      else box.append(el('p','No evidence has been submitted yet.'));
      box.append(el('p',state.proof_published?'Your verified evidence is already posted to the feed. Changing a sharing choice does not remove an existing post.':state.post_id?'A verified-action card exists on the feed, but public proof has not been confirmed.':state.share?'Your saved choice allows a feed post after verification.':'Your evidence is private to you and authorized reviewers unless you explicitly choose to share it.','we-subtle'));
      if(state.can_submit===true){
        const form=el('form','','we-proof-form');
        const label=(caption,node)=>{const item=el('label',caption);item.append(node);form.append(item);return node;};
        const statement=el('textarea');statement.maxLength=4000;statement.minLength=20;statement.required=true;statement.rows=6;statement.value=text(state.proof?.statement,4000);label('What did you complete? Include dates, sources and what remains uncertain.',statement);
        const url=el('input');url.type='url';url.maxLength=2000;url.placeholder='https://…';url.value=safeURL(state.proof?.proof_url);label('Public evidence link (optional)',url);
        const consent=el('input');consent.type='checkbox';label('I checked this evidence, have permission to submit it, and removed other people’s private information.',consent);
        const share=el('input');share.type='checkbox';share.checked=false;label('After owner verification, I want this proof and statement posted to the public Action Network feed.',share);
        form.append(el('p','Submitting saves evidence for review. It does not verify the mission, award points or start a recording. Public proof is limited to 2,000 characters including the link; private statements may use 4,000. Sharing is off unless you select it above.','we-subtle'));
        const submit=button('Submit evidence for review',()=>{});submit.type='submit';form.append(submit);
        form.onsubmit=async event=>{
          event.preventDefault();if(!await current()||proofBusy)return;
          const value=statement.value.trim(),href=url.value.trim();
          if(!consent.checked||value.length<20||value.length>4000||href&&!safeURL(href)||share.checked&&(value.length+(href?href.length+2:0)>2000)){note.textContent='Add at least 20 characters, a valid HTTPS link if used, and confirm consent. Public proof plus its link must fit within 2,000 characters.';return;}
          proofBusy=true;submit.disabled=true;note.textContent='Saving evidence…';
          try {const result=await request('/assignments/'+assignment.assignment_id+'/proof',{method:'POST',auth:true,...requestScope,body:{proof_type:href?'link':'text',statement:value,proof_url:href||null,share:share.checked===true,consent:true}});if(!await current())return;if(!uuid(result.proof_id)||result.assignment_id!==assignment.assignment_id||result.status!=='submitted')throw Error('Evidence submission was not confirmed.');note.textContent=result.share?'Evidence submitted for review. Public sharing is requested after verification; no public post is confirmed yet.':'Evidence submitted for review with public sharing off.';status(note.textContent);await loadPrivate();}
          catch(error){if(await current())note.textContent=error.message||'Submission was not confirmed. Close and reopen evidence before retrying.';}
          finally{proofBusy=false;submit.disabled=false;}
        };box.append(form);
      }else box.append(el('p','New evidence is not available for this assignment’s current state.','we-subtle'));
      if(state.can_share===true&&!state.proof_published){
        const share=button('Post verified proof to the feed',async()=>{
          if(!await current()||proofBusy||!w.confirm('Post your verified evidence and statement to the public Action Network feed?'))return;
          proofBusy=true;share.disabled=true;
          try{const result=await request('/assignments/'+assignment.assignment_id+'/share',{method:'POST',auth:true,...requestScope,body:{share:true,consent:true}});if(!await current())return;note.textContent=uuid(result.post_id)&&result.proof_published===true?'Your verified proof post is confirmed on the feed.':'Your sharing choice was saved, but no public post is confirmed. Reopen evidence to check.';}
          catch(error){if(await current())note.textContent=error.message||'Sharing was not confirmed. Reopen evidence before retrying.';}
          finally{proofBusy=false;share.disabled=false;}
        });box.append(share);
      }
    }catch(error){if(await current())box.replaceChildren(button('Close evidence',closeProof),el('p',error.message||'Evidence could not be loaded. No change was made.'));}
  }
  function renderTeam() {
    if (destroyed) return;
    renderAssignments();
    const box = byId('weTeam'); box.replaceChildren(); box.append(el('h3','Environmental Justice Team'));
    if (!privateToken) { box.append(el('p','Explore without an account. Sign in to join the team and take part in approved missions.'),button('Sign in to participate',signIn)); return; }
    if (!team) { box.append(el('p','Team membership is not available yet. No membership has been assumed.'),button('Check membership', () => loadPrivate())); return; }
    const joined = team.membership?.joined === true;
    box.append(el('p',joined ? 'You are on the Environmental Justice Team.' : 'Join the team to help turn sourced environmental evidence into practical work.'));
    if (!joined) {
      const label = el('label','','we-consent'), check = el('input'); check.type='checkbox';check.id='weJoinConsent';label.append(check,el('span','I agree to join this team. Other team members can see my membership. The owner can review my mission assignments. I will follow safety guidance and obtain consent before recording.'));box.append(label);
    }
    const join = button(joined ? 'Leave the team' : 'Join the team', () => changeTeam(!joined)); join.disabled=joining;box.append(join);
  }
  function renderOwner() {
    if (destroyed) return;
    const box = byId('weOwner'); box.replaceChildren(); box.hidden=!oversight;
    if (!oversight) return;
    box.append(el('h3','Mission oversight'),el('p','Only the server-authorized owner sees this section. Review the source, safety and evidence requirements before opening a mission.','we-subtle'));
    const refresh = button('Refresh oversight', () => loadPrivate()); box.append(refresh);
    for (const mission of oversight.missions || []) {
      const card=el('article');card.append(el('h4',text(mission.title,180)),el('p',text(mission.description,1200)),el('p','Status: '+text(mission.status,60)));
      const source=mission.source_snapshot?.source;
      if (safeURL(source?.url)) card.append(link('Review '+text(source.label,120),safeURL(source.url)),el('p','Observed: '+timeLabel(mission.source_snapshot.observed_at),'we-subtle'));
      const news=mission.source_snapshot?.news_context;if(safeURL(news?.url))card.append(el('p','Reviewed news context: '+text(news.title,1000)),link('Inspect news context',safeURL(news.url)),el('p','Reported claim. Not a finding of environmental injustice.','we-subtle'));
      const controls=el('div','','we-actions');
      for (const [decision,label] of [['open','Approve mission'],['paused','Pause'],['closed','Close mission']]) {
        if (mission.status!==decision) controls.append(button(label,() => reviewMission(mission.id,decision)));
      }
      card.append(controls);
      for (const assignment of mission.assignments || []) card.append(el('p',`${text(assignment.display_name,120) || 'Member ' + text(assignment.user_id,40)} · ${text(assignment.status,60)}`,'we-subtle'));
      box.append(card);
    }
    if (!oversight.missions?.length) box.append(el('p','No environmental mission proposals yet.'));
    const proofs=el('section');proofs.append(el('h3','Review mission evidence'));
    if(!proofReviews)proofs.append(el('p','Evidence review is unavailable. No review queue has been assumed.','we-subtle'));
    else{
      for(const proof of (proofReviews.proofs||[]).slice(0,200)){
        if(!uuid(proof.proof_id))continue;
        const card=el('article');card.append(el('h4',text(proof.title,180)||'Environmental mission'),el('p',text(proof.statement,4000)),el('p','Review state: '+text(proof.status,60),'we-subtle'));
        if(safeURL(proof.proof_url))card.append(link('Inspect submitted source',safeURL(proof.proof_url)));
        card.append(el('p','Verification can award canonical points and may publish this evidence if the member opted to share. Check the evidence before deciding.','we-subtle'));
        if(proof.status==='pending'&&/^[a-f0-9]{32}$/.test(proof.proof_revision||'')){
          const label=el('label','Review note'),note=el('textarea');note.rows=3;note.maxLength=1000;label.append(note);card.append(label);
          card.append(button('Verify evidence',()=>reviewProof(proof.proof_id,'verified',note.value,proof.proof_revision)),button('Return for correction',()=>reviewProof(proof.proof_id,'rejected',note.value,proof.proof_revision)));
        }else if(proof.status==='pending')card.append(el('p','Refresh evidence before reviewing. No evidence revision was confirmed.','we-subtle'));
        proofs.append(card);
      }
      if(!proofReviews.proofs?.length)proofs.append(el('p','No environmental evidence is waiting for review.'));
      if(proofReviews.limited)proofs.append(el('p','The review list is limited. Review or refresh to see remaining items.','we-subtle'));
    }
    box.append(proofs);

  }
  async function reviewProof(id,decision,note='',revision) {
    if(destroyed||saving)return;
    const epoch=privateEpoch,identity=await token();
    if(destroyed||saving||epoch!==privateEpoch||!identity)return;
    if(decision==='rejected'&&note.trim().length<10){status('Add a useful correction note before returning evidence.');return;}
    if(!w.confirm(decision==='verified'?'Verify this evidence? Canonical rewards and the member’s requested public sharing may follow.':'Return this evidence for correction with your review note?'))return;
    saving=true;
    try{const result=await request('/proofs/'+id+'/review',{method:'POST',auth:true,...scope(identity,epoch),body:{decision,review_note:note.trim(),expected_revision:revision}});if(!await sessionCurrent(identity,epoch))return;if(result.proof_id!==id||result.status!==decision)throw Error('Evidence review was not confirmed.');status(decision==='verified'?'Evidence verified. The member can check their saved evidence for actual public-post status.':'Evidence returned with your correction note.');await loadPrivate();}
    catch(error){if(!destroyed&&epoch===privateEpoch)status(error.message||'Review was not confirmed. Refresh before retrying.');}
    finally{saving=false;}
  }
  async function loadPrivate() {
    if (destroyed) return;
    closeProof();closePlanning();
    const epoch=++privateEpoch, t=await token();
    if (destroyed || epoch!==privateEpoch) return;
    privateToken=t;team=null;oversight=null;proofReviews=null;renderTeam();renderOwner();renderDetail();
    if (!t) return;
    privateBusy=true;
    const [membership,owner,reviews]=await Promise.allSettled([request('/team',{auth:true}),request('/oversight',{auth:true}),request('/proofs',{auth:true})]);
    const currentToken = await token();
    if (destroyed || epoch!==privateEpoch || t!==currentToken) return;
    team=membership.status==='fulfilled' ? membership.value : null;
    oversight=owner.status==='fulfilled' ? owner.value : null;
    proofReviews=oversight&&reviews.status==='fulfilled'?reviews.value:null;
    privateBusy=false;renderTeam();renderOwner();renderDetail();
  }
  async function changeTeam(join) {
    if (destroyed || joining) return;
    if (join && !byId('weJoinConsent')?.checked) { status('Confirm the team’s safety and participation terms first.'); return; }
    const epoch=privateEpoch, identity=await token();
    if (destroyed || joining || epoch!==privateEpoch) return;
    if (!identity) { signIn(); return; }
    if (join===false && !w.confirm('Leave the Environmental Justice Team? This does not cancel missions you already joined.')) return;
    if (destroyed || epoch!==privateEpoch) return;
    joining=true;renderTeam();
    try { await request('/team',{method:'POST',auth:true,...scope(identity,epoch),body:{join}}); if(!await sessionCurrent(identity,epoch))return; status(join ? 'Team membership saved.' : 'You left the team.'); }
    catch(error) { if(!destroyed&&epoch===privateEpoch) status(error.status===401 ? 'Sign in before joining.' : 'Membership was not confirmed. Check the membership status below before trying again.'); }
    finally { joining=false;if(!destroyed)await loadPrivate(); }
  }
  async function proposeMission(row, action, newsReviewId=null) {
    if (destroyed || saving) return;
    const epoch=privateEpoch, currentToken=await token();
    if (destroyed || saving || epoch!==privateEpoch) return;
    if (!currentToken) { signIn(); return; }
    if (team?.membership?.joined !== true) { status('Join the Environmental Justice Team before suggesting a mission.'); byId('weTeam').scrollIntoView?.({block:'nearest'}); return; }
    saving=true;renderDetail();
    try { const result=await request('/missions/propose',{method:'POST',auth:true,...scope(currentToken,epoch),body:{event_id:row.id,action_id:action.id,...(newsReviewId?{news_review_id:newsReviewId}:{})}});if(!await sessionCurrent(currentToken,epoch))return;status(result.created===false?'This mission already exists. Its saved source context was not replaced; inspect the existing mission before opening it.':'Mission suggestion saved for owner review. It is not open for participation yet.');await loadPrivate(); }
    catch(error) {if(!destroyed&&epoch===privateEpoch)status(error.message || 'Suggestion was not confirmed. Check oversight before trying again.');}
    finally {saving=false;renderDetail();}
  }
  async function joinMission(mission) {
    if (destroyed || saving) return;
    const epoch=privateEpoch, currentToken=await token();
    if (destroyed || saving || epoch!==privateEpoch) return;
    if (!currentToken) { signIn(); return; }
    saving=true;panel.querySelectorAll('button').forEach(b=>b.disabled=true);
    try { const result=await request('/missions/'+encodeURIComponent(mission.id)+'/join',{method:'POST',auth:true,...scope(currentToken,epoch),body:{}}); if(!await sessionCurrent(currentToken,epoch))return; if(!uuid(result.assignment_id))throw new Error('No assignment was confirmed.');status('Mission joined. Your assignment is saved. Review recording availability and consent before starting.'); }
    catch(error) {if(!destroyed&&epoch===privateEpoch)status(error.message || 'No assignment confirmed. Refresh before trying again.');}
    finally {saving=false;if(!destroyed){panel.querySelectorAll('button').forEach(b=>b.disabled=false);await loadPrivate();}}
  }
  async function reviewMission(id,decision) {
    if (destroyed || saving) return;
    const epoch=privateEpoch, identity=await token();
    if (destroyed || saving || epoch!==privateEpoch || !identity) return;
    if (!w.confirm(`${decision==='open' ? 'Approve and open' : decision==='paused' ? 'Pause' : 'Close'} this environmental mission?`)) return;
    if (destroyed || epoch!==privateEpoch) return;
    saving=true;byId('weOwner').querySelectorAll('button').forEach(b=>b.disabled=true);
    try {await request('/missions/'+encodeURIComponent(id)+'/review',{method:'POST',auth:true,...scope(identity,epoch),body:{decision}});if(!await sessionCurrent(identity,epoch))return;status('Mission review saved.');await loadFeed();}
    catch(error) {if(!destroyed&&epoch===privateEpoch)status(error.message || 'Review was not confirmed. Refresh oversight before retrying.');}
    finally {saving=false;if(!destroyed)await loadPrivate();}
  }
  async function loadFeed() {
    if (destroyed || feedBusy) return;
    feedBusy=true;requested=true;const epoch=++feedEpoch;abort=new AbortController();byId('weRefresh').disabled=true;status('Checking government sources…');
    try {const body=normalizeFeed(await request('',{signal:abort.signal}));if(epoch!==feedEpoch)return;feed=body;if(!feed.events.some(row=>row.id===selected))selected='';byId('weFreshness').textContent='Checked '+timeLabel(new Date().toISOString());status(body.sources.some(s=>s.status==='unavailable') ? 'Some sources are unavailable. Available observations are shown below.' : 'Select an observation to inspect its dates, source and possible work.');}
    catch(error) {if(epoch!==feedEpoch)return;feed=null;selected='';status('Environmental sources are unavailable. No current observations can be confirmed. Refresh to try again.');}
    finally {if(epoch===feedEpoch){feedBusy=false;byId('weRefresh').disabled=false;renderList();renderSources();renderDetail();renderAssignments();syncPins();}}
  }
  function onMode() {
    if (destroyed) return;
    panel.hidden=!active();syncPins();clearInterval(timer);timer=null;
    if (active()) {if(!requested)void loadFeed();if(!privateBusy)void loadPrivate();timer=setInterval(()=>{if(active()&&!d.hidden)void loadFeed();},300000);}
  }
  byId('weRefresh').onclick=()=>{void loadFeed();void loadPrivate();};
  byId('weSearch').oninput=event=>{search=event.target.value.trim().toLocaleLowerCase();renderList();syncPins();};
  listen(adapter.modeEvent || 'environment:mode',onMode);
  listen(adapter.authEvent || 'environment:auth',()=>{closeProof();closePlanning();privateEpoch++;privateBusy=false;team=null;oversight=null;proofReviews=null;privateToken=null;renderTeam();renderOwner();renderDetail();if(active())void loadPrivate();});
  listen('storage',event=>{if(adapter.sessionStorageKey && event.key===adapter.sessionStorageKey){closeProof();closePlanning();privateEpoch++;privateBusy=false;team=null;oversight=null;proofReviews=null;privateToken=null;renderTeam();renderOwner();renderDetail();if(active())void loadPrivate();}});
  listen('message',event=>{if(event.origin!==w.location.origin||event.source!==frame.contentWindow)return;const data=event.data||{};if(data.type==='hu:globe-ready')syncPins();if(data.type==='hu:environment-selected'&&active())select(data.id,false);if(data.type==='hu:globe-unavailable'&&active())status('The interactive globe is unavailable. All available observations and actions are still accessible in this list.');});
  listen('pagehide',()=>{clearInterval(timer);abort?.abort();privateEpoch++;});
  listen('pageshow',event=>{if(event.persisted)onMode();});
  renderTeam();onMode();
  return {refresh:loadFeed,destroy(){
    // Idempotent, and only the current owner of the host panel may clear its DOM or
    // switch off the globe pins: a stale instance's late cleanup must not erase a
    // newer mount (audit EQ2).
    if (destroyed) return;
    destroyed=true;proofEpoch++;planningEpoch++;clearInterval(timer);abort?.abort();privateEpoch++;feedEpoch++;listeners.forEach(([type,fn])=>w.removeEventListener(type,fn));
    if (owners.get(panel)!==instance) return;
    owners.delete(panel);send({type:'hu:environment-pins',on:false,items:[]});panel.replaceChildren();panel.hidden=true; }};
}
