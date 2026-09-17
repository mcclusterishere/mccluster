/* SPATIAL — the globe stays the canvas; this is the chrome around it. */
import { panel } from '../ui.js';

export default {
  async mount(root) {
    root.innerHTML = `<div class="op-cols op-cols--3">
      ${panel({ title:'Catalogs & layers', body: `
        <p class="op-state__hint" style="margin:0">
          Seek First catalogs, registries and archive reads live under
          <span class="op-mono">/v1/seek-first/*</span> behind the house-owner gate.
        </p>` })}
      ${panel({ title:'Globe', body: `
        <div style="padding:1rem;text-align:center">
          <p style="margin:0 0 .8rem;color:var(--op-dim);font-size:.85rem">
            The Cesium globe is served by the Worker at
            <span class="op-mono">/internal/seek-first</span>, behind Cloudflare Access, with its own
            strict CSP that forbids embedding (<span class="op-mono">frame-ancestors 'none'</span>).
          </p>
          <p style="margin:0 0 .8rem;color:var(--op-faint);font-size:.8rem">
            It therefore cannot be framed inside this shell without weakening that policy — a
            deliberate compromise rather than an oversight.
          </p>
          <a class="op-btn op-btn--primary" href="https://api.mccluster.org/internal/seek-first" target="_blank" rel="noopener">
            Open the spatial console ↗
          </a>
        </div>` })}
      ${panel({ title:'Selection & governance', body: `
        <p class="op-state__hint" style="margin:0">
          Evidence, governance and diagnostics for a selected object are rendered inside the globe
          console itself, which owns that state. Duplicating the panel here would mean a second
          source of truth for the same selection.
        </p>` })}
    </div>`;
  }
};
