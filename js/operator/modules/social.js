/* SOCIAL OPERATIONS.
 *
 * The backend carries accounts, campaigns, variant generation,
 * publishing, metrics and automations, and had no frontend whatsoever.
 * Publishing state is the thing an operator checks first, so failures
 * are never collapsed into a count — a failed publish shows its error.
 */
import { all, endpoints } from '../api.js';
import { ago, button, empty, esc, failure, loading, panel, pill, raw, table, toast } from '../ui.js';

const TABS = [['accounts','Accounts'],['campaigns','Campaigns'],['publishing','Publishing'],['automations','Automations']];

export default {
  async mount(root, { app, params, signal }) {
    const tab = params.tab || 'accounts';
    const s = await all({
      accounts: endpoints.socialAccounts(),
      campaigns: endpoints.socialCampaigns(),
      automations: endpoints.socialAutomations()
    });
    if (signal.aborted) return;

    const accounts = s.accounts.ok ? (s.accounts.data?.accounts || []) : [];
    const campaigns = s.campaigns.ok ? (s.campaigns.data?.campaigns || []) : [];
    const automations = s.automations.ok ? (s.automations.data?.automations || []) : [];

    const tabs = `<div class="op-toolbar">${TABS.map(([id,label]) =>
      `<button class="op-chip ${tab===id?'is-on':''}" data-tab="${id}">${esc(label)}</button>`).join('')}</div>`;

    const views = {
      accounts: () => panel({ title:'Connected accounts', meta:`${accounts.length}`, body:
        s.accounts.ok ? table([
          { key:'platform', label:'Platform' },
          { key:'handle', label:'Handle', render:(r)=>esc(r.handle||r.name||'—') },
          { key:'enabled', label:'State', render:(r)=>pill(r.enabled===false?'bad':'ok', r.enabled===false?'disabled':'connected') },
          { key:'updated_at', label:'Updated', render:(r)=>esc(ago(r.updated_at||r.created_at)) }
        ], accounts, { idKey:'id', emptyLabel:'No social accounts connected.',
                        emptyHint:'POST /v1/social/accounts connects one.' })
        : failure(s.accounts) }),

      campaigns: () => panel({ title:'Campaigns', meta:`${campaigns.length}`, body:
        s.campaigns.ok ? table([
          { key:'name', label:'Campaign', render:(r)=>esc(r.name||r.title||r.id) },
          { key:'status', label:'Status', render:(r)=>pill(r.status) },
          { key:'created_at', label:'Created', render:(r)=>esc(ago(r.created_at)) }
        ], campaigns, { idKey:'id', emptyLabel:'No campaigns.' })
        : failure(s.campaigns) }),

      publishing: () => `<div class="op-grid">
        ${panel({ title:'Publish', span:'6', meta:'POST /v1/social/publish', body: `
          <p class="op-state__hint" style="margin:0 0 .6rem">Publishing is a real, gated backend action.
          A failure is shown with the backend's own error — never as a silent success.</p>
          <div class="op-formrow"><label class="op-label" for="pubPost">Post id</label>
            <input class="op-input" id="pubPost" placeholder="uuid of an existing social post"></div>
          ${button('Publish now', { action:'publish', variant:'primary' })}
          <div data-pub style="margin-top:.7rem"></div>` })}
        ${panel({ title:'Generate variants', span:'6', meta:'POST /v1/social/variants/generate', body: `
          <div class="op-formrow"><label class="op-label" for="varCampaign">Campaign id</label>
            <input class="op-input" id="varCampaign"></div>
          ${button('Generate variants', { action:'variants', variant:'primary' })}
          <div data-var style="margin-top:.7rem"></div>` })}
      </div>`,

      automations: () => panel({ title:'Automations', meta:`${automations.length}`, body:
        s.automations.ok ? table([
          { key:'name', label:'Automation', render:(r)=>esc(r.name||r.kind||r.id) },
          { key:'enabled', label:'State', render:(r)=>pill(r.enabled) },
          { key:'updated_at', label:'Updated', render:(r)=>esc(ago(r.updated_at)) }
        ], automations, { idKey:'id', emptyLabel:'No automations configured.' })
        : failure(s.automations) })
    };

    root.innerHTML = `${tabs}<div style="margin-top:.7rem">${(views[tab]||views.accounts)()}</div>`;
    root.querySelectorAll('[data-tab]').forEach((c)=>c.addEventListener('click',()=>app.go('social',{tab:c.getAttribute('data-tab')})));

    const wire=(n,h)=>{const el=root.querySelector(`[data-action="${n}"]`); if(el) el.addEventListener('click',()=>h(el));};
    wire('publish', async (node) => {
      const id = root.querySelector('#pubPost').value.trim();
      const out = root.querySelector('[data-pub]');
      if (!id) { out.innerHTML = empty('A post id is required.'); return; }
      node.disabled = true; out.innerHTML = loading('Publishing…');
      const r = await endpoints.socialPublish({ post_id: id });
      node.disabled = false;
      out.innerHTML = r.ok ? raw(r.data,'Accepted') : failure(r);
      toast(r.ok ? 'Publish accepted.' : 'Publish refused.', r.ok ? 'ok' : 'bad');
    });
    wire('variants', async (node) => {
      const id = root.querySelector('#varCampaign').value.trim();
      const out = root.querySelector('[data-var]');
      if (!id) { out.innerHTML = empty('A campaign id is required.'); return; }
      node.disabled = true; out.innerHTML = loading('Generating…');
      const r = await endpoints.socialVariants({ campaign_id: id });
      node.disabled = false;
      out.innerHTML = r.ok ? raw(r.data,'Queued') : failure(r);
    });
  }
};
