/* ============================================================
   STUDIO — generation workspace.

   Models, recommendation, generation, live jobs and comparison in one
   frame, because the previous experience made an operator bounce
   between unrelated forms to answer one question ("which model, and
   did it work?").

   Jobs are polled through the real `GET /v1/media/jobs/{id}`; a job is
   only shown as complete when the backend says so. A bakeoff renders
   its variants side by side once assets exist, and shows the pending
   state honestly until then.
   ============================================================ */

import { endpoints } from '../api.js';
import { ago, button, count, drawer, empty, esc, failure, fields, loading, panel, pill, raw, stamp, table, toast } from '../ui.js';

const TABS = [['generate', 'Generate'], ['models', 'Models'], ['compare', 'Compare'], ['jobs', 'Jobs']];

/* Jobs live in memory for the session: the backend has no "my jobs"
   list route, so the console tracks what it started. Stated plainly on
   the Jobs tab rather than implied. */
const tracked = new Map();

function assetsOf(job) {
  const assets = job?.assets || job?.output?.assets || [];
  return Array.isArray(assets) ? assets : [];
}

function assetPreview(asset) {
  const url = asset?.url || asset?.public_url || asset?.download_url;
  if (!url) return '<div class="op-asset op-asset--none">no url</div>';
  const kind = String(asset?.mime_type || asset?.kind || '').toLowerCase();
  if (kind.includes('video')) return `<video class="op-asset" src="${esc(url)}" controls muted playsinline></video>`;
  if (kind.includes('image')) return `<img class="op-asset" src="${esc(url)}" alt="" loading="lazy">`;
  return `<a class="op-asset op-asset--file" href="${esc(url)}" target="_blank" rel="noopener">${esc(kind || 'asset')} ↗</a>`;
}

function jobCard(job) {
  const assets = assetsOf(job);
  return `
    <div class="op-jobcard" data-job="${esc(job.id)}">
      <div class="op-jobcard__head">
        ${pill(job.status)}
        <b>${esc(job.model_id || job.model || 'model')}</b>
        <time>${esc(ago(job.created_at))}</time>
      </div>
      ${assets.length ? `<div class="op-assets">${assets.slice(0, 3).map(assetPreview).join('')}</div>`
        : `<p class="op-state__hint" style="margin:.4rem 0 0">${esc(
            job.status === 'failed' ? (job.last_error || 'failed') : 'no asset yet'
          )}</p>`}
    </div>`;
}

function openJob(job) {
  drawer({
    title: job.model_id || job.model || 'generation job',
    subtitle: `${pill(job.status)} <span class="op-mono">${esc(job.id || '')}</span>`,
    body: `
      ${fields([
        ['Status', pill(job.status)],
        ['Model', esc(job.model_id || job.model || '—')],
        ['Capability', esc(job.capability || '—')],
        ['Created', esc(stamp(job.created_at))],
        ['Cost (cents)', job.cost_cents !== undefined ? count(job.cost_cents) : '—'],
        ['Provider', esc(job.provider || '—')]
      ])}
      ${assetsOf(job).length ? `<div class="op-assets" style="margin-top:.7rem">${assetsOf(job).map(assetPreview).join('')}</div>` : ''}
      ${job.last_error ? `<div class="op-state op-state--error" style="margin-top:.7rem"><b>Error</b><span>${esc(job.last_error)}</span></div>` : ''}
      ${raw(job, 'Full job record')}`
  });
}

async function poll(id, onUpdate, signal) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (signal?.aborted) return;
    const result = await endpoints.mediaJob(id);
    if (result.ok) {
      const job = result.data?.job || result.data;
      tracked.set(id, job);
      onUpdate(job);
      if (['done', 'succeeded', 'completed', 'failed', 'error', 'cancelled'].includes(String(job?.status || '').toLowerCase())) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
}

export default {
  async mount(root, { app, params, signal }) {
    const tab = params.tab || 'generate';
    const modelsResult = await endpoints.mediaModels();
    if (signal.aborted) return;

    const models = modelsResult.ok ? (modelsResult.data?.models || []) : [];
    const capabilities = [...new Set(models.map((model) => model.capability).filter(Boolean))].sort();

    const tabs = `<div class="op-toolbar">${TABS.map(([id, label]) =>
      `<button class="op-chip ${tab === id ? 'is-on' : ''}" data-tab="${id}">${esc(label)}</button>`).join('')}</div>`;

    const modelOptions = (filter) => models
      .filter((model) => !filter || model.capability === filter)
      .map((model) => `<option value="${esc(model.id)}">${esc(model.id)} · ${esc(model.capability || '')}</option>`)
      .join('');

    const views = {
      generate: () => `
        <div class="op-cols op-cols--2">
          ${panel({ title: 'New generation', body: modelsResult.ok ? `
            <div class="op-formrow">
              <label class="op-label" for="capSel">Capability</label>
              <select class="op-select" id="capSel">
                <option value="">any</option>
                ${capabilities.map((capability) => `<option value="${esc(capability)}">${esc(capability)}</option>`).join('')}
              </select>
            </div>
            <div class="op-formrow">
              <label class="op-label" for="modelSel">Model</label>
              <select class="op-select" id="modelSel">${modelOptions('')}</select>
            </div>
            <div class="op-formrow">
              <label class="op-label" for="prompt">Prompt</label>
              <textarea class="op-textarea" id="prompt" placeholder="a detailed futuristic motorcycle, studio lighting"></textarea>
            </div>
            <div style="display:flex;gap:.4rem">
              ${button('Generate', { action: 'generate', variant: 'primary' })}
              ${button('Recommend a model', { action: 'recommend' })}
            </div>
            <div data-gen-result style="margin-top:.7rem"></div>`
            : failure(modelsResult) })}
          ${panel({ title: 'This session’s jobs', meta: `${tracked.size} tracked`, body:
            `<div data-live>${tracked.size
              ? [...tracked.values()].map(jobCard).join('')
              : empty('No jobs started yet in this session.')}</div>` })}
        </div>`,

      models: () => panel({
        title: 'Model registry', meta: `${models.length} enabled`,
        body: modelsResult.ok
          ? table([
              { key: 'id', label: 'Model', render: (row) => `<span class="op-mono">${esc(row.id)}</span>` },
              { key: 'capability', label: 'Capability' },
              { key: 'provider', label: 'Provider' },
              { key: 'features', label: 'Features', render: (row) =>
                Object.entries(row.features || {}).filter(([, on]) => on).map(([key]) => pill('idle', key)).join(' ') || '—' }
            ], models, { idKey: 'id', emptyLabel: 'No models enabled.' })
          : failure(modelsResult)
      }),

      compare: () => panel({
        title: 'Director Compare', meta: 'POST /v1/media/bakeoff',
        body: modelsResult.ok ? `
          <p class="op-state__hint" style="margin:0 0 .6rem">
            Fans one prompt across 2–5 models as a single tracked bakeoff. Outputs appear side by
            side as each job completes.
          </p>
          <div class="op-formrow">
            <label class="op-label" for="bakeModels">Models (ctrl/cmd-click, 2–5)</label>
            <select class="op-select" id="bakeModels" multiple size="7">${modelOptions('')}</select>
          </div>
          <div class="op-formrow">
            <label class="op-label" for="bakePrompt">Prompt</label>
            <textarea class="op-textarea" id="bakePrompt"></textarea>
          </div>
          ${button('Run bakeoff', { action: 'bakeoff', variant: 'primary' })}
          <div data-bake-result style="margin-top:.7rem"></div>
          <div class="op-assets" data-bake-grid style="margin-top:.7rem"></div>`
          : failure(modelsResult)
      }),

      jobs: () => panel({
        title: 'Tracked jobs', meta: `${tracked.size}`,
        body: tracked.size
          ? `${table([
              { key: 'id', label: 'Job', render: (row) => `<span class="op-mono op-truncate">${esc(row.id)}</span>` },
              { key: 'status', label: 'Status', render: (row) => pill(row.status) },
              { key: 'model_id', label: 'Model' },
              { key: 'created_at', label: 'Created', render: (row) => esc(ago(row.created_at)) }
            ], [...tracked.values()], { idKey: 'id' })}
            <p class="op-state__hint" style="padding:.5rem .7rem">
              The backend has no "list my media jobs" route, so this shows what this browser session
              started. Open a job by id from Core if you need one from another session.
            </p>`
          : empty('No jobs tracked in this session.',
              'The media API has no list endpoint; the console remembers what it started.')
      })
    };

    root.innerHTML = `${tabs}<div style="margin-top:.7rem">${(views[tab] || views.generate)()}</div>`;

    root.querySelectorAll('[data-tab]').forEach((chip) => {
      chip.addEventListener('click', () => app.go('studio', { tab: chip.getAttribute('data-tab') }));
    });

    const capSel = root.querySelector('#capSel');
    if (capSel) {
      capSel.addEventListener('change', () => {
        root.querySelector('#modelSel').innerHTML = modelOptions(capSel.value);
      });
    }

    const refreshLive = () => {
      const live = root.querySelector('[data-live]');
      if (!live) return;
      live.innerHTML = tracked.size ? [...tracked.values()].map(jobCard).join('') : empty('No jobs started yet in this session.');
      live.querySelectorAll('[data-job]').forEach((node) => {
        node.addEventListener('click', () => {
          const job = tracked.get(node.getAttribute('data-job'));
          if (job) openJob(job);
        });
      });
    };

    const wire = (name, handler) => {
      const node = root.querySelector(`[data-action="${name}"]`);
      if (node) node.addEventListener('click', () => handler(node));
    };

    wire('generate', async (node) => {
      const prompt = root.querySelector('#prompt').value.trim();
      const modelId = root.querySelector('#modelSel').value;
      const out = root.querySelector('[data-gen-result]');
      if (!prompt) { out.innerHTML = empty('A prompt is required.'); return; }
      node.disabled = true; out.innerHTML = loading('Submitting…');
      const result = await endpoints.mediaGenerate({ model_id: modelId, prompt, input: { prompt } });
      node.disabled = false;
      if (!result.ok) { out.innerHTML = failure(result); toast('Generation refused.', 'bad'); return; }
      const job = result.data?.job || result.data;
      out.innerHTML = `<p class="op-state__hint">Job ${esc(job.id || '')} accepted.</p>`;
      tracked.set(job.id, job);
      refreshLive();
      toast('Generation queued.', 'ok');
      poll(job.id, refreshLive, signal);
    });

    wire('recommend', async (node) => {
      const out = root.querySelector('[data-gen-result]');
      const capability = root.querySelector('#capSel').value;
      if (!capability) { out.innerHTML = empty('Pick a capability to get a recommendation.'); return; }
      node.disabled = true; out.innerHTML = loading('Ranking models…');
      const result = await endpoints.mediaRecommend({ capability, preference: 'quality', top_k: 3 });
      node.disabled = false;
      out.innerHTML = result.ok ? raw(result.data, 'Recommendation') : failure(result);
    });

    wire('bakeoff', async (node) => {
      const select = root.querySelector('#bakeModels');
      const ids = [...select.selectedOptions].map((option) => option.value);
      const prompt = root.querySelector('#bakePrompt').value.trim();
      const out = root.querySelector('[data-bake-result]');
      if (ids.length < 2 || ids.length > 5) { out.innerHTML = empty('Select between 2 and 5 models.'); return; }
      if (!prompt) { out.innerHTML = empty('A prompt is required.'); return; }
      node.disabled = true; out.innerHTML = loading('Starting bakeoff…');
      const result = await endpoints.mediaBakeoff({ model_ids: ids, prompt, input: { prompt } });
      node.disabled = false;
      if (!result.ok) { out.innerHTML = failure(result); return; }
      out.innerHTML = raw(result.data, 'Bakeoff accepted');
      const jobs = result.data?.jobs || result.data?.variants || [];
      const grid = root.querySelector('[data-bake-grid]');
      jobs.forEach((job) => {
        if (!job?.id) return;
        tracked.set(job.id, job);
        poll(job.id, () => {
          grid.innerHTML = jobs.map((entry) => jobCard(tracked.get(entry.id) || entry)).join('');
        }, signal);
      });
      grid.innerHTML = jobs.map(jobCard).join('');
      toast(`Bakeoff started across ${jobs.length} models.`, 'ok');
    });

    refreshLive();
  }
};
