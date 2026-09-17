/* ============================================================
   CORE — AI OPERATIONS.

   The backend can ingest a natural-language task, enqueue typed jobs,
   run a health rollup on demand, retrieve context and record decisions.
   None of that had an interface. This is the surface that makes the
   autonomous half of McCluster operable.

   The honesty rule is sharper here than anywhere else: an autonomous
   system must never look more capable than it is. So every tab states
   what the backend actually supports, `GET /v1/ai/jobs/{id}` is the
   only job read available (there is no list endpoint), and that
   limitation is shown rather than papered over with a fabricated table.
   ============================================================ */

import { all, endpoints } from '../api.js';
import { ago, button, count, drawer, empty, esc, failure, fields, loading, metric, panel, pill, raw, stamp, toast } from '../ui.js';

/* Exactly the types `ai/router.js` accepts. Offering anything else
   would be a form that always 400s. */
const JOB_TYPES = [
  ['repo_health', 'Inspect a repository and report health'],
  ['local_analysis', 'Bounded local analysis on the host'],
  ['objective_reflection', 'Reflect on current objectives'],
  ['portfolio_plan', 'Produce a portfolio plan'],
  ['host_health', 'Read host health from the VPS'],
  ['code_patch', 'Draft an isolated code change (never auto-merges)'],
  ['game_studio_cycle', 'Run the PRIM3 production loop'],
  ['preview_deploy', 'Deploy a non-production preview']
];

const TABS = [
  ['overview', 'Overview'],
  ['jobs', 'Jobs'],
  ['compose', 'Composer'],
  ['health', 'Health'],
  ['context', 'Context'],
  ['decisions', 'Decisions']
];

function tabBar(active) {
  return `<div class="op-toolbar">${TABS.map(([id, label]) =>
    `<button class="op-chip ${active === id ? 'is-on' : ''}" data-tab="${id}">${esc(label)}</button>`
  ).join('')}</div>`;
}

/* ---------- job inspector ----------
   Human presentation first; raw payload behind a disclosure, per the
   brief. The output of a Core job is the whole reason an operator
   opens it, so it gets its own block rather than living in the dump. */
function openJob(job) {
  const status = job?.status;
  const output = job?.output;
  drawer({
    title: `${job.job_type || 'job'}`,
    subtitle: `${pill(status)} <span class="op-mono">${esc(job.id || '')}</span>`,
    actions: [],
    body: `
      ${fields([
        ['Status', pill(status)],
        ['Target', `${esc(job.target_type || '—')} · <span class="op-mono">${esc(job.target_id || '—')}</span>`],
        ['Attempts', `${count(job.attempts)} of ${count(job.max_attempts)}`],
        ['Priority', count(job.priority)],
        ['Created', `${esc(stamp(job.created_at))} <span class="op-state__hint">(${esc(ago(job.created_at))})</span>`],
        ['Updated', `${esc(stamp(job.updated_at))} <span class="op-state__hint">(${esc(ago(job.updated_at))})</span>`],
        ['Locked by', job.locked_by ? `<span class="op-mono">${esc(job.locked_by)}</span>` : '—'],
        ['Run after', job.run_after ? esc(stamp(job.run_after)) : '—']
      ])}
      ${job.last_error ? `
        <div class="op-state op-state--error" style="margin-top:.8rem">
          <b>Last error</b><span>${esc(job.last_error)}</span>
        </div>` : ''}
      ${output ? `
        <h3 style="margin:1rem 0 .4rem;font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--op-faint)">Output</h3>
        ${output.completion_evidence ? `
          <div class="op-state" style="padding:.5rem 0">
            ${pill('ok', 'completion evidence present')}
            <span class="op-mono" style="font-size:.7rem">${esc(output.completion_evidence.result_sha256 || '')}</span>
          </div>` : ''}
        <pre class="op-raw" style="margin:0;padding:.6rem;background:var(--op-bg);border:1px solid var(--op-line);border-radius:6px;font:400 .72rem/1.5 var(--op-mono);color:var(--op-dim);max-height:20rem;overflow:auto">${esc(JSON.stringify(output, null, 2))}</pre>`
        : '<p class="op-state__hint" style="margin-top:.8rem">No output recorded yet.</p>'}
      ${job.input ? raw(job.input, 'Input payload') : ''}
      ${raw(job, 'Full job record')}`
  });
}

/* ---------- tabs ---------- */

function overview(sources) {
  const { ai, catalogue, bridge } = sources;
  /* Wrapped in a panel even on failure: a bare error block outside the
     grid reads as a broken page rather than as one unreadable source. */
  if (!ai.ok) {
    return `<div class="op-grid">
      ${panel({ title: 'Core execution', span: '6', body: failure(ai) })}
      ${panel({ title: 'Remote MCP bridge', span: '6', body: bridge.ok
        ? fields([['Bridge', esc(bridge.data?.bridge || '—')], ['Core reachable', pill(bridge.data?.core?.ok ?? 'unknown')]])
        : failure(bridge) })}
    </div>`;
  }
  const jobs = ai.data?.execution?.jobs || {};
  const health = ai.data?.system_health || {};
  return `
    <div class="op-grid">
      ${panel({ title: 'Execution', span: '6', body: `
        <div class="op-metrics">
          ${metric('Total', count(jobs.total))}
          ${metric('Running', count(jobs.running), { status: jobs.running ? 'busy' : 'idle' })}
          ${metric('Queued', count(jobs.queued), { status: jobs.queued ? 'pending' : 'idle' })}
          ${metric('Failed', count(jobs.failed), { status: jobs.failed ? 'bad' : 'ok' })}
        </div>
        <p class="op-state__hint" style="margin:.6rem 0 0">
          Queue table: <span class="op-mono">${esc(ai.data?.execution?.table || 'ops_agent_jobs')}</span>
        </p>` })}
      ${panel({ title: 'Health rollup', span: '6', body: fields([
        ['Overall', pill(health.overall || 'unknown')],
        ['Checked', health.checked_at ? `${esc(stamp(health.checked_at))} <span class="op-state__hint">(${esc(ago(health.checked_at))})</span>` : '—'],
        ['Stale', pill(health.stale ? 'warn' : 'ok', health.stale ? 'stale' : 'fresh')],
        ['Harness', esc(ai.data?.harness || '—')]
      ]) })}
      ${panel({ title: 'Context plane', span: '6', body: fields(
        Object.entries(ai.data?.context || {}).map(([key, value]) => [key, `<span class="op-mono">${esc(value)}</span>`])
      ) })}
      ${panel({ title: 'Remote MCP bridge', span: '6', body: bridge.ok
        ? fields([
            ['Bridge', esc(bridge.data?.bridge || '—')],
            ['MCP route', `<span class="op-mono">${esc(bridge.data?.mcp || '—')}</span>`],
            ['Protocol', esc(bridge.data?.protocol_version || '—')],
            ['Signed dispatch', pill(bridge.data?.signed_dispatch)],
            ['Core reachable', pill(bridge.data?.core?.ok ?? 'unknown')]
          ])
        : failure(bridge) })}
      ${catalogue.ok ? panel({ title: 'Harness catalogue', body: raw(catalogue.data, 'GET /v1/ai') }) : ''}
    </div>`;
}

/* There is no job *list* endpoint on the Worker — only
   GET /v1/ai/jobs/{id}. Saying so, and giving a real lookup, beats
   rendering a table the backend cannot fill. */
function jobsTab(params) {
  const filter = params.status || '';
  return `
    <div class="op-grid">
      ${panel({ title: 'Job lookup', span: '6', body: `
        <p class="op-state__hint" style="margin:0 0 .6rem">
          The Worker exposes <span class="op-mono">GET /v1/ai/jobs/{id}</span> but no list route,
          so jobs are opened by id. Counts come from
          <span class="op-mono">/v1/ai/status</span>${filter ? ` (filtered view requested: <b>${esc(filter)}</b>)` : ''}.
        </p>
        <div class="op-formrow">
          <label class="op-label" for="jobId">Job id</label>
          <input class="op-input" id="jobId" placeholder="uuid" spellcheck="false">
        </div>
        ${button('Open job', { action: 'lookup', variant: 'primary' })}
        <div data-job-result style="margin-top:.8rem"></div>` })}
      ${panel({ title: 'Why there is no table here', span: '6', body: `
        <p style="margin:0 0 .5rem">This is a real backend gap, recorded in the audit rather than hidden:</p>
        <ul style="margin:0;padding-left:1.1rem;color:var(--op-dim);font-size:.8rem;line-height:1.7">
          <li>counts exist (<span class="op-mono">/v1/ai/status</span>)</li>
          <li>single job read exists (<span class="op-mono">/v1/ai/jobs/{id}</span>)</li>
          <li>no paginated list, no filter-by-status route</li>
        </ul>
        <p class="op-state__hint" style="margin:.6rem 0 0">
          A narrow <span class="op-mono">GET /v1/ai/jobs?status=&limit=</span> reusing the existing
          house-owner gate would make this a full queue console. Not added here: the brief asked to
          avoid backend changes unless the frontend truly requires them, and the console is usable
          without it.
        </p>` })}
    </div>`;
}

function composeTab() {
  return `
    <div class="op-grid">
      ${panel({ title: 'Give Core a task', span: '6', meta: 'POST /v1/ai/task', body: `
        <p class="op-state__hint" style="margin:0 0 .6rem">
          Natural language goes to the real ingress. Core decides how to decompose it;
          this console does not pre-interpret the text.
        </p>
        <div class="op-formrow">
          <label class="op-label" for="taskText">Task</label>
          <textarea class="op-textarea" id="taskText" placeholder="e.g. inspect mcclusterishere/mccluster and report repository health"></textarea>
        </div>
        ${button('Send to Core', { action: 'task', variant: 'primary' })}
        <div data-task-result style="margin-top:.7rem"></div>` })}
      ${panel({ title: 'Enqueue a typed job', span: '6', meta: 'POST /v1/ai/jobs', body: `
        <div class="op-formrow">
          <label class="op-label" for="jobType">Job type</label>
          <select class="op-select" id="jobType">
            ${JOB_TYPES.map(([id, label]) => `<option value="${id}">${esc(id)} — ${esc(label)}</option>`).join('')}
          </select>
        </div>
        <div class="op-formgrid">
          <div class="op-formrow">
            <label class="op-label" for="targetType">Target type</label>
            <input class="op-input" id="targetType" value="portfolio">
          </div>
          <div class="op-formrow">
            <label class="op-label" for="targetId">Target id</label>
            <input class="op-input" id="targetId" value="McCluster">
          </div>
        </div>
        <div class="op-formrow">
          <label class="op-label" for="jobInput">Input JSON</label>
          <textarea class="op-textarea" id="jobInput">{}</textarea>
        </div>
        ${button('Enqueue', { action: 'enqueue', variant: 'primary' })}
        <div data-enqueue-result style="margin-top:.7rem"></div>` })}
    </div>`;
}

function healthTab(sources) {
  const { systemHealth } = sources;
  return `
    <div class="op-grid">
      ${panel({
        title: 'System health', span: '12',
        actions: button('Run health check now', { action: 'refresh-health', variant: 'primary', size: 'sm' }),
        body: systemHealth.ok
          ? `<div data-health-body>${raw(systemHealth.data, 'Latest rollup — GET /v1/ai/system-health')}</div>`
          : failure(systemHealth)
      })}
    </div>`;
}

function contextTab() {
  return `
    <div class="op-grid">
      ${panel({ title: 'Retrieve context', span: '7', meta: 'POST /v1/ai/retrieve', body: `
        <p class="op-state__hint" style="margin:0 0 .6rem">
          Queries the private <span class="op-mono">ai_context</span> plane through the Worker.
          Raw conversations never render in this console; results come back as the harness returns them.
        </p>
        <div class="op-formrow">
          <label class="op-label" for="ctxQuery">Query</label>
          <input class="op-input" id="ctxQuery" placeholder="what did we decide about the sovereign media fabric?">
        </div>
        ${button('Retrieve', { action: 'retrieve', variant: 'primary' })}
        <div data-ctx-result style="margin-top:.7rem"></div>` })}
      ${panel({ title: 'Ingest', span: '5', body: `
        <p style="margin:0 0 .5rem">
          <span class="op-mono">POST /v1/ai/ingest</span> accepts a normalized conversation envelope
          from a provider adapter.
        </p>
        <p class="op-state__hint" style="margin:0">
          Deliberately not given a form: pasting a transcript into a browser is the exact
          path the privacy boundary in <span class="op-mono">AI-HARNESS.md</span> forbids.
          Ingestion belongs to adapters, not to an operator console.
        </p>` })}
    </div>`;
}

function decisionsTab() {
  return `
    <div class="op-grid">
      ${panel({ title: 'Record a decision', span: '7', meta: 'POST /v1/ai/decisions', body: `
        <p class="op-state__hint" style="margin:0 0 .6rem">
          Writes to the auditable decision record. There is no list endpoint, so this
          surface can write but not yet browse.
        </p>
        <div class="op-formrow">
          <label class="op-label" for="decTitle">Decision</label>
          <input class="op-input" id="decTitle" placeholder="Adopt staged Worker deploys with automatic rollback">
        </div>
        <div class="op-formrow">
          <label class="op-label" for="decRationale">Rationale</label>
          <textarea class="op-textarea" id="decRationale" placeholder="Why, and what was rejected."></textarea>
        </div>
        ${button('Record', { action: 'decide', variant: 'primary' })}
        <div data-dec-result style="margin-top:.7rem"></div>` })}
      ${panel({ title: 'Reading decisions back', span: '5', body: `
        <p class="op-state__hint" style="margin:0">
          <span class="op-mono">ai_context.decisions</span> is written through the Worker but has no
          read route, so this console cannot list history. Recorded in the audit as a gap.
        </p>` })}
    </div>`;
}

export default {
  async mount(root, { app, params, signal }) {
    const tab = params.tab || 'overview';
    const sources = await all({
      ai: endpoints.aiStatus(),
      catalogue: endpoints.aiCatalogue(),
      bridge: endpoints.coreBridge(),
      systemHealth: tab === 'health' ? endpoints.aiSystemHealth() : Promise.resolve({ ok: true, data: null })
    });
    if (signal.aborted) return;

    const bodies = {
      overview: () => overview(sources),
      jobs: () => jobsTab(params),
      compose: () => composeTab(),
      health: () => healthTab(sources),
      context: () => contextTab(),
      decisions: () => decisionsTab()
    };
    root.innerHTML = `${tabBar(tab)}<div style="margin-top:.7rem">${(bodies[tab] || bodies.overview)()}</div>`;

    root.querySelectorAll('[data-tab]').forEach((chip) => {
      chip.addEventListener('click', () => app.go('core', { tab: chip.getAttribute('data-tab') }));
    });

    const act = (name, handler) => {
      const node = root.querySelector(`[data-action="${name}"]`);
      if (node) node.addEventListener('click', () => handler(node));
    };

    act('lookup', async (node) => {
      const id = root.querySelector('#jobId').value.trim();
      const out = root.querySelector('[data-job-result]');
      if (!id) { out.innerHTML = empty('Enter a job id.'); return; }
      node.disabled = true; out.innerHTML = loading('Reading job…');
      const result = await endpoints.aiJob(id);
      node.disabled = false;
      if (!result.ok) { out.innerHTML = failure(result); return; }
      const job = result.data?.job || result.data;
      out.innerHTML = `<p class="op-state__hint">Opened ${esc(job.job_type || 'job')} · ${esc(job.status || '')}</p>`;
      openJob(job);
    });

    act('task', async (node) => {
      const text = root.querySelector('#taskText').value.trim();
      const out = root.querySelector('[data-task-result]');
      if (!text) { out.innerHTML = empty('Describe the task first.'); return; }
      node.disabled = true; out.innerHTML = loading('Sending…');
      const result = await endpoints.aiTask({ task: text });
      node.disabled = false;
      if (!result.ok) { out.innerHTML = failure(result); toast('Core refused the task.', 'bad'); return; }
      out.innerHTML = raw(result.data, 'Core accepted');
      toast('Task sent to Core.', 'ok');
    });

    act('enqueue', async (node) => {
      const out = root.querySelector('[data-enqueue-result]');
      let input;
      try { input = JSON.parse(root.querySelector('#jobInput').value || '{}'); }
      catch { out.innerHTML = empty('Input is not valid JSON.'); return; }
      node.disabled = true; out.innerHTML = loading('Enqueuing…');
      const result = await endpoints.aiEnqueue({
        job_type: root.querySelector('#jobType').value,
        target_type: root.querySelector('#targetType').value.trim() || 'portfolio',
        target_id: root.querySelector('#targetId').value.trim() || 'McCluster',
        input
      });
      node.disabled = false;
      if (!result.ok) { out.innerHTML = failure(result); toast('Enqueue refused.', 'bad'); return; }
      out.innerHTML = raw(result.data, 'Queued');
      toast('Job queued.', 'ok');
    });

    act('refresh-health', async (node) => {
      node.disabled = true;
      const result = await endpoints.aiRefreshHealth({});
      node.disabled = false;
      if (!result.ok) { toast(result.message || 'Health run refused.', 'bad'); return; }
      toast('Health check requested.', 'ok');
      const body = root.querySelector('[data-health-body]');
      if (body) body.innerHTML = raw(result.data, 'Result of POST /v1/ai/system-health');
    });

    act('retrieve', async (node) => {
      const query = root.querySelector('#ctxQuery').value.trim();
      const out = root.querySelector('[data-ctx-result]');
      if (!query) { out.innerHTML = empty('Enter a query.'); return; }
      node.disabled = true; out.innerHTML = loading('Retrieving…');
      const result = await endpoints.aiRetrieve({ query });
      node.disabled = false;
      out.innerHTML = result.ok ? raw(result.data, 'Retrieved context') : failure(result);
    });

    act('decide', async (node) => {
      const title = root.querySelector('#decTitle').value.trim();
      const rationale = root.querySelector('#decRationale').value.trim();
      const out = root.querySelector('[data-dec-result]');
      if (!title) { out.innerHTML = empty('A decision needs a title.'); return; }
      node.disabled = true; out.innerHTML = loading('Recording…');
      const result = await endpoints.aiDecision({ title, rationale_summary: rationale });
      node.disabled = false;
      if (!result.ok) { out.innerHTML = failure(result); return; }
      out.innerHTML = raw(result.data, 'Recorded');
      toast('Decision recorded.', 'ok');
    });

    /* Deep link from the command palette: "Run host health". */
    if (tab === 'health' && params.run === '1') {
      const node = root.querySelector('[data-action="refresh-health"]');
      if (node) node.click();
    }
  }
};
