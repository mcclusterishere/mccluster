/* USAGE & BILLING. Real metering only — cost is never estimated here. */
import { all, endpoints } from '../api.js';
import { button, count, empty, esc, failure, fields, loading, panel, raw, table } from '../ui.js';

export default {
  async mount(root, { signal }) {
    const s = await all({
      plans: endpoints.platformPlans(),
      catalog: endpoints.platformCatalog(),
      compute: endpoints.computeCatalog(),
      balance: endpoints.computeBalance()
    });
    if (signal.aborted) return;
    const plans = s.plans.ok ? (s.plans.data?.plans || s.plans.data || []) : [];

    root.innerHTML = `<div class="op-grid">
      ${panel({ title:'Compute balance', span:'4', body: s.balance.ok
        ? fields(Object.entries(s.balance.data || {}).map(([k,v]) => [k, typeof v==='object'?`<span class="op-mono">${esc(JSON.stringify(v))}</span>`:esc(String(v))]))
        : failure(s.balance) })}
      ${panel({ title:'Fee model', span:'8', meta:'GET /v1/fees/quote', body: `
        <p class="op-state__hint" style="margin:0 0 .6rem">Quotes a real fee against a real app's policy.
        This is arithmetic the backend performs — not an estimate this console invents.</p>
        <div class="op-formgrid">
          <div class="op-formrow"><label class="op-label" for="feeApp">App key</label><input class="op-input" id="feeApp" placeholder="esmer-web"></div>
          <div class="op-formrow"><label class="op-label" for="feeAmt">Base amount (cents)</label><input class="op-input" id="feeAmt" type="number" value="10000"></div>
        </div>
        ${button('Quote', { action:'quote', variant:'primary' })}
        <div data-quote style="margin-top:.7rem"></div>` })}
      ${panel({ title:'Plans', span:'6', body: s.plans.ok
        ? (Array.isArray(plans) && plans.length
            ? table([{key:'key',label:'Plan',render:(r)=>esc(r.key||r.name||r.id)},
                     {key:'price_cents',label:'Price',align:'right',render:(r)=>count(r.price_cents)}],
                    plans, { idKey:'key' })
            : raw(s.plans.data, 'GET /v1/platform/plans'))
        : failure(s.plans) })}
      ${panel({ title:'Compute catalogue', span:'6', body: s.compute.ok
        ? raw(s.compute.data, 'GET /v1/compute/catalog') : failure(s.compute) })}
      ${panel({ title:'Provider COGS', body: `
        <p class="op-state__hint" style="margin:0">
          Reconciled provider cost lives in <span class="op-mono">compute_cost_ledger</span> and
          <span class="op-mono">media_cost_events</span>. Neither has a Worker read route, so this
          console cannot show realised spend. Recorded in the audit as the most valuable missing
          read endpoint. No figure is shown rather than an invented one.
        </p>` })}
    </div>`;

    const node = root.querySelector('[data-action="quote"]');
    if (node) node.addEventListener('click', async () => {
      const out = root.querySelector('[data-quote]');
      const app_key = root.querySelector('#feeApp').value.trim();
      const base_cents = root.querySelector('#feeAmt').value;
      if (!app_key) { out.innerHTML = empty('An app key is required.'); return; }
      node.disabled = true; out.innerHTML = loading('Quoting…');
      const r = await endpoints.feeQuote({ app_key, base_cents });
      node.disabled = false;
      out.innerHTML = r.ok ? raw(r.data, 'Quote') : failure(r);
    });
  }
};
