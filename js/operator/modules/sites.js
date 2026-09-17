/* SITES & CLIENTS — the app registry as the client spine. */
import { all, endpoints } from '../api.js';
import { count, drawer, esc, failure, fields, panel, pill, raw, table, bindTable } from '../ui.js';

export default {
  async mount(root, { signal }) {
    const s = await all({ apps: endpoints.apps(), status: endpoints.status() });
    if (signal.aborted) return;
    if (!s.apps.ok) { root.innerHTML = panel({ title:'Sites & Clients', body: failure(s.apps) }); return; }
    const apps = s.apps.data?.apps || [];
    const families = [...new Set(apps.map((a)=>a.product_family).filter(Boolean))];

    root.innerHTML = `<div class="op-grid">
      ${panel({ title:'Registered applications', meta:`${apps.length} across ${families.length} families`, body: table([
        { key:'name', label:'Client / app' },
        { key:'app_key', label:'Key', render:(r)=>`<span class="op-mono">${esc(r.app_key)}</span>` },
        { key:'product_family', label:'Family' },
        { key:'kind', label:'Kind', render:(r)=>pill('idle', r.kind||'—') },
        { key:'public_url', label:'Site', render:(r)=>r.public_url
            ? `<a href="${esc(r.public_url)}" target="_blank" rel="noopener">${esc(r.public_url.replace(/^https?:\/\//,''))} ↗</a>` : '—' }
      ], apps, { idKey:'app_key' }) })}
      ${panel({ title:'Requests & briefs', span:'6', body: s.status.ok
        ? fields([['Briefs filed', count(s.status.data?.counts?.site_requests)],
                  ['Conversations', count(s.status.data?.counts?.conversations)]])
        : failure(s.status) })}
      ${panel({ title:'Plan, usage & billing per client', span:'6', body: `
        <p class="op-state__hint" style="margin:0">
          <span class="op-mono">/v1/apps</span> returns identity and public URL only. Per-client plan,
          usage and billing live in the platform tables with no per-app read route, so a client record
          cannot yet show them. This is the single biggest gap for the Business section.
        </p>` })}
    </div>`;

    bindTable(root, apps, (row) => drawer({
      title: row.name, subtitle: `<span class="op-mono">${esc(row.app_key)}</span>`,
      body: `${fields([
        ['Family', esc(row.product_family||'—')],
        ['Kind', esc(row.kind||'—')],
        ['Bundle id', row.bundle_id?`<span class="op-mono">${esc(row.bundle_id)}</span>`:'—'],
        ['Public URL', row.public_url?`<a href="${esc(row.public_url)}" target="_blank" rel="noopener">${esc(row.public_url)}</a>`:'—']
      ])}${raw(row,'App record')}`
    }), 'app_key');
  }
};
