/* DEVELOPER — apps, consumers, scopes. Secrets are never rendered. */
import { all, endpoints } from '../api.js';
import { ago, empty, esc, failure, panel, pill, raw, table } from '../ui.js';

export default {
  async mount(root, { signal }) {
    const s = await all({
      apps: endpoints.apps(),
      consumers: endpoints.developerConsumers(),
      catalog: endpoints.platformCatalog()
    });
    if (signal.aborted) return;
    const apps = s.apps.ok ? (s.apps.data?.apps || []) : [];
    const consumers = s.consumers.ok ? (s.consumers.data?.consumers || s.consumers.data || []) : [];

    root.innerHTML = `<div class="op-grid">
      ${panel({ title:'Registered apps', span:'6', meta:`${apps.length}`, body: s.apps.ok
        ? table([
            { key:'app_key', label:'Key', render:(r)=>`<span class="op-mono">${esc(r.app_key)}</span>` },
            { key:'name', label:'Name' },
            { key:'product_family', label:'Family' },
            { key:'kind', label:'Kind', render:(r)=>pill('idle', r.kind||'—') }
          ], apps, { idKey:'app_key' })
        : failure(s.apps) })}
      ${panel({ title:'API consumers', span:'6', meta:`${Array.isArray(consumers)?consumers.length:0}`, body: s.consumers.ok
        ? (Array.isArray(consumers) && consumers.length
            ? table([
                { key:'name', label:'Consumer', render:(r)=>esc(r.name||r.id) },
                { key:'status', label:'Status', render:(r)=>pill(r.status) },
                { key:'created_at', label:'Created', render:(r)=>esc(ago(r.created_at)) }
              ], consumers, { idKey:'id' })
            : empty('No API consumers.'))
        : failure(s.consumers) })}
      ${panel({ title:'Platform catalogue', body: s.catalog.ok ? raw(s.catalog.data,'GET /v1/platform/catalog') : failure(s.catalog) })}
      ${panel({ title:'Keys and secrets', body: `
        <p class="op-state__hint" style="margin:0">
          API key material is deliberately not rendered here. The backend issues keys through
          <span class="op-mono">POST /v1/developer/consumers</span>; a console that lists secrets
          turns one compromised browser session into a credential leak. Rotation belongs on a
          surface with its own confirmation, which this branch does not add.
        </p>` })}
    </div>`;
  }
};
