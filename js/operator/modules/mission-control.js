/* ============================================================
   MISSION CONTROL.

   Aggregates the reads that actually exist into the six things an
   operator opens the console to learn. Every number traces to an
   endpoint; nothing on this page is computed from a placeholder.

   The design rule that matters here: a panel whose source failed shows
   the failure, not a zero. "0 failed jobs" and "could not read jobs"
   lead to opposite decisions, and only one of them is safe to act on.
   ============================================================ */

import { all, endpoints } from '../api.js';
import { ago, count, degraded, dot, empty, esc, failure, metric, panel, table, timeline } from '../ui.js';

/* NEEDS ATTENTION is derived only from conditions the backend really
   reports. No incident is invented: if a condition cannot be observed,
   it simply does not appear. */
function needsAttention({ status, ai, health, comms, bridge }) {
  const items = [];

  if (ai.ok) {
    const jobs = ai.data?.execution?.jobs || {};
    if (jobs.failed > 0) {
      items.push({
        severity: 'bad', title: `${jobs.failed} Core job${jobs.failed === 1 ? '' : 's'} failed`,
        detail: 'Recent executions ended in error.', go: ['core', { tab: 'jobs', status: 'failed' }]
      });
    }
    if (jobs.queued > 0) {
      items.push({
        severity: jobs.queued > 5 ? 'warn' : 'pending',
        title: `${jobs.queued} job${jobs.queued === 1 ? '' : 's'} queued`,
        detail: jobs.running === 0
          ? 'Nothing is running — the queue may not be draining.'
          : 'Waiting for a worker.',
        go: ['core', { tab: 'jobs', status: 'queued' }]
      });
    }
    const overall = ai.data?.system_health?.overall;
    if (overall && overall !== 'ok' && overall !== 'healthy') {
      items.push({
        severity: overall === 'unknown' ? 'warn' : 'bad',
        title: `System health reports "${overall}"`,
        detail: ai.data?.system_health?.stale ? 'The reading is stale.' : 'Latest rollup from Core.',
        go: ['core', { tab: 'health' }]
      });
    } else if (ai.data?.system_health?.stale) {
      items.push({
        severity: 'warn', title: 'System health reading is stale',
        detail: `Last checked ${ago(ai.data?.system_health?.checked_at)}.`,
        go: ['core', { tab: 'health' }]
      });
    }
  }

  if (health.ok === false) {
    items.push({ severity: 'bad', title: 'Public edge is not answering', detail: 'GET /health failed.', go: ['system', {}] });
  }
  if (status.ok && status.data?.database?.reachable === false) {
    items.push({ severity: 'bad', title: 'Database unreachable from the Worker', detail: 'Reported by /v1/status.', go: ['system', {}] });
  }
  if (bridge.ok === false && bridge.status && bridge.status !== 401 && bridge.status !== 403) {
    items.push({
      severity: 'warn', title: 'Remote MCP bridge is not healthy',
      detail: bridge.message || 'GET /v1/core failed.', go: ['system', {}]
    });
  }
  if (comms.ok) {
    const waiting = (comms.data?.threads || []).filter((thread) =>
      thread?.needs_owner || thread?.owner_required || thread?.state === 'needs_owner');
    if (waiting.length) {
      items.push({
        severity: 'warn', title: `${waiting.length} conversation${waiting.length === 1 ? '' : 's'} waiting for an owner`,
        detail: 'The assistant has handed these back.', go: ['comms', { queue: 'owner' }]
      });
    }
  }

  const order = { bad: 0, warn: 1, pending: 2 };
  return items.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
}

/* SYSTEM HEALTH as a compact table. Each row names the endpoint it came
   from, so an operator can tell what is actually being asserted. */
function serviceRows(sources) {
  const { health, healthz, status, ai, bridge, comms, media, social, platform } = sources;
  const rows = [
    { service: 'Edge worker', source: 'GET /health', ok: health.ok,
      note: health.ok ? (health.data?.service || 'mccluster') : health.message },
    { service: 'Deploy fingerprint', source: 'GET /healthz', ok: healthz.ok,
      note: healthz.ok
        ? (/^[0-9a-f]{40}$/.test(String(healthz.data?.deployment_sha || ''))
            ? String(healthz.data.deployment_sha).slice(0, 12)
            : `sha ${healthz.data?.deployment_sha || 'unknown'}`)
        : healthz.message,
      warn: healthz.ok && !/^[0-9a-f]{40}$/.test(String(healthz.data?.deployment_sha || '')) },
    { service: 'Database', source: 'GET /v1/status', ok: status.ok ? status.data?.database?.reachable : null,
      note: status.ok ? (status.data?.database?.reachable ? 'reachable' : 'unreachable') : status.message },
    { service: 'Core / AI harness', source: 'GET /v1/ai/status', ok: ai.ok,
      note: ai.ok ? `${ai.data?.harness || 'harness'} · health ${ai.data?.system_health?.overall || 'unknown'}` : ai.message },
    { service: 'Remote MCP bridge', source: 'GET /v1/core', ok: bridge.ok,
      note: bridge.ok ? `${bridge.data?.bridge || 'core-mcp'} · signed ${bridge.data?.signed_dispatch ? 'yes' : 'no'}` : bridge.message },
    { service: 'Communications', source: 'GET /v1/comms', ok: comms.ok,
      note: comms.ok ? (comms.data?.transport || 'relay') : comms.message },
    { service: 'Media', source: 'GET /v1/media/models', ok: media.ok,
      note: media.ok ? `${(media.data?.models || []).length} models enabled` : media.message },
    { service: 'Social', source: 'GET /v1/social/accounts', ok: social.ok,
      note: social.ok ? `${(social.data?.accounts || []).length} accounts` : social.message },
    { service: 'Platform API', source: 'GET /v1/platform/catalog', ok: platform.ok,
      note: platform.ok ? 'catalogue readable' : platform.message }
  ];
  return rows;
}

/* ACTIVITY has no unified backend endpoint. Rather than invent one, it
   is composed client-side from reads that already happened, and the
   panel says so — an operator should never mistake this for an audit
   log with retention guarantees. */
function composeActivity(sources) {
  const events = [];
  const { ai, comms, social, status } = sources;

  if (ai.ok) {
    const jobs = ai.data?.execution?.jobs || {};
    events.push({
      at: Date.now(), status: jobs.failed ? 'bad' : 'ok',
      title: `Core queue: ${count(jobs.running)} running, ${count(jobs.queued)} queued, ${count(jobs.failed)} failed`,
      detail: `of ${count(jobs.total)} total · GET /v1/ai/status`
    });
    if (ai.data?.system_health?.checked_at) {
      events.push({
        at: ai.data.system_health.checked_at,
        status: ai.data.system_health.overall === 'ok' ? 'ok' : 'warn',
        title: `System health rollup: ${ai.data.system_health.overall}`,
        detail: ai.data.system_health.stale ? 'reading is stale' : 'fresh reading'
      });
    }
  }
  if (comms.ok) {
    (comms.data?.threads || []).slice(0, 6).forEach((thread) => {
      events.push({
        at: thread.last_message_at || thread.updated_at || thread.created_at,
        status: thread.owner_active || thread.state === 'owner' ? 'ai' : 'idle',
        title: `Thread ${thread.contact_label || thread.contact || thread.id || ''}`.trim(),
        detail: thread.last_message_preview || thread.state || 'conversation'
      });
    });
  }
  if (social.ok) {
    (social.data?.accounts || []).slice(0, 4).forEach((account) => {
      events.push({
        at: account.updated_at || account.created_at,
        status: account.enabled === false ? 'warn' : 'ok',
        title: `Social account ${account.platform || ''} ${account.handle || account.name || ''}`.trim(),
        detail: account.enabled === false ? 'disabled' : 'connected'
      });
    });
  }
  if (status.ok && status.data?.checked_at) {
    events.push({ at: status.data.checked_at, status: 'ok', title: 'House status read', detail: 'GET /v1/status' });
  }

  return events
    .filter((event) => event.at)
    .sort((a, b) => Date.parse(String(b.at)) - Date.parse(String(a.at)))
    .slice(0, 14);
}

export default {
  async mount(root, { app, signal }) {
    const sources = await all({
      health: endpoints.health(),
      healthz: endpoints.healthz(),
      status: endpoints.status(),
      ai: endpoints.aiStatus(),
      bridge: endpoints.coreBridge(),
      comms: endpoints.commsThreads(),
      media: endpoints.mediaModels(),
      social: endpoints.socialAccounts(),
      platform: endpoints.platformCatalog()
    });
    if (signal.aborted) return;

    const attention = needsAttention(sources);
    const services = serviceRows(sources);
    const counts = sources.status.ok ? (sources.status.data?.counts || {}) : null;
    const jobs = sources.ai.ok ? (sources.ai.data?.execution?.jobs || {}) : null;

    const attentionBody = sources.degraded.length === 9
      ? failure(sources.status)
      : attention.length
        ? `<ul class="op-timeline">${attention.map((item) => `
            <li class="op-timeline__item" data-go="${esc(item.go[0])}" data-params="${esc(JSON.stringify(item.go[1]))}" style="cursor:pointer">
              ${dot(item.severity)}
              <div>
                <p class="op-timeline__title">${esc(item.title)}</p>
                <p class="op-timeline__detail">${esc(item.detail)}</p>
              </div>
              <time>open →</time>
            </li>`).join('')}</ul>`
        : empty('Nothing is asking for you.', 'No failed jobs, no stuck queue, no degraded service in the reads that answered.');

    root.innerHTML = `
      ${degraded(sources.degraded.map((name) => name), 'Panels below marked unreadable are unknown, not zero.')}
      <div class="op-grid">
        ${panel({
          title: 'Needs attention', span: '8',
          meta: attention.length ? `${attention.length} open` : 'clear',
          body: attentionBody
        })}
        ${panel({
          title: 'Active work', span: '4',
          body: jobs ? `<div class="op-metrics">
              ${metric('Running', count(jobs.running), { status: jobs.running > 0 ? 'busy' : 'idle' })}
              ${metric('Queued', count(jobs.queued), { status: jobs.queued > 0 ? 'pending' : 'idle' })}
              ${metric('Failed', count(jobs.failed), { status: jobs.failed > 0 ? 'bad' : 'ok' })}
              ${metric('Total', count(jobs.total))}
            </div>
            <p class="op-state__hint" style="margin:.5rem 0 0">Counts from <code>GET /v1/ai/status</code>. Open Core for the job table.</p>`
            : failure(sources.ai)
        })}
        ${panel({
          title: 'System health', span: '8',
          meta: 'live reads',
          body: table([
            { key: 'service', label: 'Service', render: (row) => `${dot(row.warn ? 'warn' : row.ok)} ${esc(row.service)}` },
            { key: 'note', label: 'State', render: (row) => `<span class="op-truncate" title="${esc(row.note || '')}">${esc(row.note || '—')}</span>` },
            { key: 'source', label: 'Source', render: (row) => `<span class="op-mono">${esc(row.source)}</span>` }
          ], services, { idKey: 'service' })
        })}
        ${panel({
          title: 'Business pulse', span: '4',
          body: counts ? `<div class="op-metrics">
              ${metric('Apps enabled', count(counts.apps_enabled))}
              ${metric('Briefs filed', count(counts.site_requests))}
              ${metric('Inbound msgs', count(counts.inbox_messages_in))}
              ${metric('Conversations', count(counts.conversations))}
            </div>
            ${(sources.status.data?.channels || []).length ? `<p class="op-state__hint" style="margin:.5rem 0 0">Channels: ${(sources.status.data.channels).map((channel) => `${esc(channel.key)} ${channel.enabled ? 'on' : 'off'}`).join(' · ')}</p>` : ''}`
            : failure(sources.status)
        })}
        ${panel({
          title: 'Activity', span: '6',
          meta: 'composed client-side',
          body: `${timeline(composeActivity(sources))}
            <p class="op-state__hint" style="margin:.6rem 0 0">
              There is no unified audit endpoint in the backend. This is assembled from the
              reads on this page, so it is a recent-state view — not a retained event log.
            </p>`
        })}
        ${panel({
          title: 'Usage & spend', span: '6',
          body: `<div class="op-metrics">
              ${metric('Media models', sources.media.ok ? count((sources.media.data?.models || []).length) : '—', { status: sources.media.ok ? 'ok' : 'warn' })}
              ${metric('Platform plans', '—', { sub: 'see Usage & Billing' })}
            </div>
            <p class="op-state__hint" style="margin:.5rem 0 0">
              Cost is never estimated here. Real provider spend lives behind the metering and
              COGS endpoints — open <a href="#/usage">Usage &amp; Billing</a>.
            </p>`
        })}
      </div>`;

    root.querySelectorAll('[data-go]').forEach((node) => {
      node.addEventListener('click', () => {
        app.go(node.getAttribute('data-go'), JSON.parse(node.getAttribute('data-params') || '{}'));
      });
    });
  }
};
