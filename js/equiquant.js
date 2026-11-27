/* Private Equity Quantized workspace. Project membership and every write are
   resolved by the canonical Worker. History keeps only an opaque selection. */
(() => {
  'use strict';
  const byId = id => document.getElementById('eq-' + id);
  const workspace = window.MCC_WORKSPACE;
  const roles = [
    'Conceptualization', 'Data curation', 'Formal analysis', 'Funding acquisition',
    'Investigation', 'Methodology', 'Project administration', 'Resources', 'Software',
    'Supervision', 'Validation', 'Visualization', 'Writing – original draft', 'Writing – review & editing'
  ];
  const scenarioNames = { pooled: 'Pooled', group_levels: 'Group levels', group_slopes: 'Group slopes' };
  let active = null;
  let projects = [];
  let selected = null;
  let createAttempt = null;
  let busy = false;
  let generation = 0;

  function message(text, error = false) {
    byId('status').textContent = text;
    byId('status').toggleAttribute('data-error', error);
  }

  function make(tag, value) {
    const el = document.createElement(tag);
    el.textContent = value;
    return el;
  }

  function itemList(id, items, empty, line) {
    const list = byId(id);
    list.replaceChildren();
    if (!items.length) list.append(make('li', empty));
    for (const item of items) {
      const li = document.createElement('li');
      li.append(line(item));
      list.append(li);
    }
  }

  function setBusy(value) {
    busy = value;
    byId('desk').inert = value;
    byId('desk').setAttribute('aria-busy', String(value));
  }

  function remember(projectId) {
    history.replaceState({ org: active.orgId, profile: active.profile.id, projectId }, '');
  }

  function resetProject() {
    selected = null;
    byId('project').hidden = true;
    byId('content').hidden = true;
    byId('release').hidden = true;
    byId('accept').hidden = true;
    for (const id of ['invite-form', 'evidence-form', 'review-form']) byId(id).reset();
    for (const id of ['heading', 'members', 'evidence-list', 'review-options', 'credits',
      'release-record', 'membership', 'release-status', 'review-run', 'algorithms-lab']) byId(id).replaceChildren();
  }

  function clearDesk() {
    generation++;
    setBusy(false);
    active = null;
    createAttempt = null;
    projects = [];
    resetProject();
    byId('desk').hidden = true;
    byId('signin').hidden = true;
    byId('retry').hidden = true;
    byId('projects').replaceChildren();
    byId('who').textContent = '';
    byId('create-form').reset();
  }

  function api(action, projectId, data = {}) {
    const body = { org_id: active.orgId, action, data };
    if (projectId) body.project_id = projectId;
    return workspace.api('/v1/equiquant', { method: 'POST', body });
  }

  async function task(work) {
    if (busy) return;
    const token = generation;
    setBusy(true);
    try {
      await work(() => token === generation);
    } catch (error) {
      if (token !== generation) return;
      if (error.status === 401 || error.status === 403) {
        clearDesk();
        byId(error.status === 401 ? 'signin' : 'retry').hidden = false;
      }
      message(error.message || 'The request failed. Refresh to try again.', true);
    } finally {
      if (token === generation) setBusy(false);
    }
  }

  function paintProjects() {
    itemList('projects', projects, 'No projects or invitations yet.', project => {
      const button = make('button', project.title);
      button.type = 'button';
      if (project.id === selected?.id) button.setAttribute('aria-current', 'true');
      button.addEventListener('click', () => task(async current => {
        await openProject(project, current);
        if (current()) byId('heading').focus();
      }));
      return button;
    });
  }

  function paintProject(project) {
    if (selected?.id !== project.id) resetProject();
    selected = project;
    remember(project.id);
    byId('heading').textContent = project.title;
    byId('project').hidden = false;
    const invited = project.membership === 'invited';
    byId('accept').hidden = !invited;
    byId('content').hidden = invited;
    byId('membership').textContent = invited ? 'You have been invited to this private project.' :
      project.membership === 'owner' ? 'Project owner' : 'Project member';
    paintProjects();
  }

  function paintState(state) {
    const project = state.project;
    const index = projects.findIndex(p => p.id === project.id);
    if (index < 0) projects.unshift(project);
    else projects[index] = project;
    paintProject(project);
    const runs = state.runs || [];
    const targets = Array.isArray(state.targets) ? state.targets.filter(target => target?.id) : [];
    const canReview = project.membership === 'owner' && ['owner', 'staff'].includes(active.role);
    byId('invite-form').hidden = !canReview;
    const names = new Map(state.evidence.map(entry => [entry.profile_id, entry.credit_name]));
    itemList('members', state.members, 'No other project members.', member => {
      const mine = member.profile_id === active.profile.id;
      const name = names.get(member.profile_id) || (mine ? 'You' : 'Workspace member');
      const detail = document.createElement('details');
      detail.append(make('summary', name + ' · ' + member.status), make('code', member.profile_id));
      return detail;
    });
    itemList('evidence-list', state.evidence, 'No contributions recorded yet.', evidence => {
      const entry = make('div', evidence.credit_name + ' · ' + evidence.role);
      entry.append(make('span', evidence.statement));
      return entry;
    });
    window.EquityQuantizedLab.render(byId('algorithms-lab'), {
      runs, dataset: state.dataset, targets,
      onRun: (scenario, target) => mutate('replay', { scenario, target }, 'Replay request recorded.')
    });
    const completed = runs.filter(window.EquityQuantizedLab.verifiedRun);
    const release = state.release;
    byId('review-form').hidden = !canReview || !!release || !completed.length || !state.evidence.length;
    byId('release').hidden = !release;
    const verifiedRelease = release && window.EquityQuantizedLab.verifiedRun(release.run);
    byId('citation').hidden = !verifiedRelease;
    byId('release-status').textContent = release ?
      (verifiedRelease ? 'Private release credits approved.' :
        'Historical release credits. This record lacks verified execution evidence for a citation export.') :
      'The project owner can approve selected contributions after a replay completes.';
    const targetLabel = id => targets.find(target => target.id === id)?.label || id;
    byId('review-run').replaceChildren(...completed.map(run => {
      const ex = run.execution;
      const label = [scenarioNames[run.scenario] || run.scenario, targetLabel(ex.target), ex.precision];
      const alternatives = completed.filter(other => other.scenario === run.scenario && other.execution.target === ex.target);
      if (alternatives.length > 1) label.push(ex.hardware_sha256.slice(0, 10), run.job_id.slice(0, 8));
      return new Option(label.join(' · '), run.job_id);
    }));
    byId('review-options').replaceChildren();
    byId('confirm').checked = false;
    for (const evidence of state.evidence) {
      const label = document.createElement('label');
      label.className = 'eq-check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = evidence.id;
      label.append(box, document.createTextNode(evidence.credit_name + ' · ' + evidence.role + ' — ' + evidence.statement));
      byId('review-options').append(label);
    }
    if (!release) return;
    itemList('credits', release.credits, 'No approved credits.', credit =>
      make('span', credit.credit_name + ' · ' + credit.role));
    const record = byId('release-record');
    record.replaceChildren();
    for (const [term, value] of [
      ['Reviewed by', release.reviewed_by], ['Reviewed at', release.reviewed_at],
      ['Selected model', scenarioNames[release.run.scenario] || release.run.scenario],
      ...(verifiedRelease ? [['Verified execution target', targetLabel(release.run.execution.target)],
        ['Arithmetic precision', release.run.execution.precision]] : []),
      ['Core job', release.run.job_id],
      ['Dataset DOI', release.run.dataset_doi], ['Source commit', release.run.source_commit],
      ['Observations SHA-256', release.run.observations_sha256], ['Result SHA-256', release.run.result_sha256]
    ]) record.append(make('dt', term), make('dd', value));
  }

  async function openProject(project, current) {
    if (project.membership === 'invited') {
      paintProject(project);
      message('Invitation available.');
      return;
    }
    const state = await api('state', project.id);
    if (current()) { paintState(state); message('Project loaded.'); }
  }

  async function refresh(current) {
    const result = await api('list');
    if (!current()) return;
    projects = result.projects;
    const saved = history.state;
    const wanted = saved?.org === active.orgId && saved.profile === active.profile.id ? saved.projectId : null;
    const project = projects.find(p => p.id === wanted) || projects[0];
    if (project) await openProject(project, current);
    else { resetProject(); paintProjects(); message('Workspace loaded.'); }
  }

  async function load() {
    clearDesk();
    const token = generation;
    message('Opening your workspace…');
    try {
      const identity = await workspace.ready();
      if (token !== generation) return;
      active = workspace.current();
      if (identity.error) throw new Error('Your workspace could not be verified. Reload to try again.');
      if (!active.signedIn) {
        message('Sign in to open your projects.');
        byId('signin').hidden = false;
        return;
      }
      const requestedOrg = new URLSearchParams(location.search).get('org');
      if (requestedOrg && requestedOrg !== active.orgId) {
        if (!workspace.select(requestedOrg)) throw new Error('This account cannot open the selected workspace.');
        active = workspace.current();
      }
      if (!active.orgId) { message('This account has no enabled workspace.'); return; }
      byId('workspace').replaceChildren(...active.workspaces.filter(org => org.enabled)
        .map(org => new Option(org.name, org.org_id, false, org.org_id === active.orgId)));
      byId('who').textContent = active.profile.id;
      byId('create-form').hidden = !['owner', 'staff'].includes(active.role);
      byId('desk').hidden = false;
      await task(refresh);
    } catch (error) {
      if (token !== generation) return;
      message(error.message, true);
      byId('retry').hidden = false;
    }
  }

  function mutate(action, data, notice, reset) {
    return task(async current => {
      const state = await api(action, selected.id, data);
      if (!current()) return;
      if (reset) byId(reset).reset();
      paintState(state);
      message(notice);
    });
  }

  function submit(id, handler) {
    byId(id).addEventListener('submit', event => { event.preventDefault(); handler(); });
  }

  byId('role').append(new Option('Select your role', ''), ...roles.map(role => new Option(role, role)));
  byId('workspace').addEventListener('change', () => {
    const orgId = byId('workspace').value;
    if (!workspace.select(orgId)) return;
    const url = new URL(location.href);
    if (url.searchParams.has('org')) {
      url.searchParams.set('org', orgId);
      history.replaceState(history.state, '', url);
    }
    load();
  });
  byId('retry').addEventListener('click', () => location.reload());
  byId('refresh').addEventListener('click', () => task(refresh));
  byId('accept').addEventListener('click', () => mutate('accept', {}, 'Invitation accepted.'));
  submit('create-form', () => task(async current => {
    const title = byId('title').value.trim();
    if (!createAttempt || createAttempt.title !== title) createAttempt = { title, id: crypto.randomUUID() };
    const state = await api('create', createAttempt.id, { title });
    if (!current()) return;
    createAttempt = null;
    byId('create-form').reset();
    paintState(state);
    message('Private project created.');
  }));
  submit('invite-form', () => mutate('invite', {profile_id: byId('profile').value.trim()},
    'Invitation saved for this workspace member.', 'invite-form'));
  submit('evidence-form', () => mutate('evidence', {
    role: byId('role').value, credit_name: byId('name').value.trim(),
    statement: byId('statement').value.trim(), consent: byId('consent').checked
  }, 'Your contribution evidence was recorded.', 'evidence-form'));
  submit('review-form', () => {
    const ids = [...byId('review-options').querySelectorAll('input:checked')].map(el => el.value);
    if (!ids.length) { message('Select at least one contribution to credit.', true); return; }
    mutate('review', { job_id: byId('review-run').value, evidence_ids: ids, confirmed: byId('confirm').checked },
      'Reviewed release credits saved.');
  });
  byId('citation').addEventListener('click', () => task(async current => {
    const { citation, filename } = await api('citation', selected.id);
    if (!current()) return;
    const blob = new Blob([JSON.stringify(citation, null, 2) + '\n'], { type: 'application/vnd.citationstyles.csl+json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message('Citation metadata downloaded.');
  }));
  window.MCC.onAccountChange(() => { clearDesk(); location.reload(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { clearDesk(); location.reload(); } });
  load();
})();
