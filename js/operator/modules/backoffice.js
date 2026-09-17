/* BACK OFFICE — commerce and rights state, read where a route exists. */
import { sbSelect } from '../supabase.js';
import { ago, esc, failure, panel, pill, table } from '../ui.js';

export default {
  async mount(root, { signal }) {
    const rights = await sbSelect('rights_flags?select=*&order=created_at.desc&limit=100');
    if (signal.aborted) return;
    root.innerHTML = `<div class="op-grid">
      ${panel({ title:'Rights flags', meta: rights.ok?`${rights.data.length}`:'', body: rights.ok
        ? table([
            { key:'subject', label:'Subject', render:(r)=>esc(r.subject||r.name||r.id) },
            { key:'flag', label:'Flag', render:(r)=>pill('idle', r.flag||r.kind||'—') },
            { key:'state', label:'State', render:(r)=>pill(r.state||r.status) },
            { key:'created_at', label:'Created', render:(r)=>esc(ago(r.created_at)) }
          ], rights.data, { idKey:'id', emptyLabel:'No rights flags.' })
        : failure(rights) })}
      ${panel({ title:'Orders, bookings and payments', body: `
        <p class="op-state__hint" style="margin:0">
          Commerce lives in Supabase (<span class="op-mono">payments</span>,
          <span class="op-mono">rental_bookings</span>, <span class="op-mono">stripe_events</span>,
          <span class="op-mono">deal_payments</span>) and in Supabase Edge Functions
          (<span class="op-mono">checkout</span>, <span class="op-mono">pay-now</span>,
          <span class="op-mono">stripe-webhook</span>), none of which expose an operator read route
          through the Worker. Reading money tables straight from the browser would put revenue data
          behind nothing but RLS, so this console does not. Named in the audit as the correct place
          for a narrow, house-owner-gated Worker endpoint.
        </p>` })}
    </div>`;
  }
};
