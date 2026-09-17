/* SYSTEM — edge, deploy fingerprint, route surface, bridge, house status. */
import { all, endpoints } from '../api.js';
import { count, esc, failure, fields, panel, pill, stamp, table } from '../ui.js';

export default {
  async mount(root, { signal }) {
    const s = await all({
      health: endpoints.health(), healthz: endpoints.healthz(), catalogue: endpoints.catalogue(),
      status: endpoints.status(), bridge: endpoints.coreBridge(), apps: endpoints.apps()
    });
    if (signal.aborted) return;

    const sha = s.healthz.ok ? String(s.healthz.data?.deployment_sha || '') : '';
    const exact = /^[0-9a-f]{40}$/.test(sha);
    const routes = s.catalogue.ok ? (s.catalogue.data?.routes || []) : [];

    root.innerHTML = `<div class="op-grid">
      ${panel({ title:'Edge', span:'6', body: s.healthz.ok ? fields([
        ['Service', esc(s.healthz.data?.service || '—')],
        ['Worker', esc(s.healthz.data?.worker || '—')],
        ['Deploy SHA', exact ? `<span class="op-mono">${esc(sha)}</span>`
          : `${pill('warn','unknown')} <span class="op-state__hint">The running Worker cannot name its own commit — a deploy path that does not stamp provenance.</span>`],
        ['Deploy ref', esc(s.healthz.data?.deployment_ref || '—')],
        ['Supabase project', `<span class="op-mono">${esc(s.healthz.data?.supabase_project_ref || '—')}</span>`],
        ['Checked', esc(stamp(s.healthz.data?.checked_at))]
      ]) : failure(s.healthz) })}
      ${panel({ title:'Capability flags', span:'6', body: s.healthz.ok
        ? fields(Object.entries(s.healthz.data?.capabilities || {}).map(([k,v]) => [k, pill(v)]))
        : failure(s.healthz) })}
      ${panel({ title:'Remote MCP bridge', span:'6', body: s.bridge.ok ? fields([
        ['Bridge', esc(s.bridge.data?.bridge || '—')],
        ['Route', `<span class="op-mono">${esc(s.bridge.data?.mcp || '—')}</span>`],
        ['Protocol', esc(s.bridge.data?.protocol_version || '—')],
        ['Signed dispatch', pill(s.bridge.data?.signed_dispatch)],
        ['Core', pill(s.bridge.data?.core?.ok ?? 'unknown')]
      ]) : failure(s.bridge) })}
      ${panel({ title:'House status', span:'6', body: s.status.ok ? fields([
        ['Operator', esc(s.status.data?.operator?.email || '—')],
        ['Database', pill(s.status.data?.database?.reachable)],
        ['Durable object', pill(s.status.data?.worker?.durable_object_bound)],
        ['Allowed origins', count(s.status.data?.worker?.allowed_origins)],
        ['Checked', esc(stamp(s.status.data?.checked_at))]
      ]) : failure(s.status) })}
      ${panel({ title:'Published route surface', meta:`${routes.length} routes`, body: s.catalogue.ok
        ? table([
            { key:'method', label:'Method', width:'90px' },
            { key:'path', label:'Path', render:(r)=>`<span class="op-mono">${esc(r.path)}</span>` },
            { key:'auth', label:'Auth', render:(r)=>pill(r.auth==='none'?'idle':r.auth==='house-owner'?'warn':'busy', r.auth) }
          ], routes, { idKey:'path' })
        : failure(s.catalogue) })}
    </div>`;
  }
};
