/* WHIP — owner/operator surface. Not the rider product. */
import { all, endpoints } from '../api.js';
import { ago, esc, failure, panel, pill, raw, table } from '../ui.js';

export default {
  async mount(root, { signal }) {
    const s = await all({
      operators: endpoints.whipOperators(), leads: endpoints.whipLeads(), identity: endpoints.whipIdentityStatus()
    });
    if (signal.aborted) return;
    const operators = s.operators.ok ? (s.operators.data?.operators || s.operators.data || []) : [];
    const leads = s.leads.ok ? (s.leads.data?.leads || s.leads.data || []) : [];

    root.innerHTML = `<div class="op-grid">
      ${panel({ title:'Operators', span:'6', meta:`${Array.isArray(operators)?operators.length:0}`, body: s.operators.ok
        ? (Array.isArray(operators) && operators.length
            ? table([
                { key:'name', label:'Operator', render:(r)=>esc(r.name||r.display_name||r.id) },
                { key:'role', label:'Role', render:(r)=>pill('idle', r.role||'—') },
                { key:'status', label:'Status', render:(r)=>pill(r.status) }
              ], operators, { idKey:'id' })
            : raw(s.operators.data, 'GET /api/operators/mine'))
        : failure(s.operators) })}
      ${panel({ title:'Sales leads', span:'6', meta:`${Array.isArray(leads)?leads.length:0}`, body: s.leads.ok
        ? (Array.isArray(leads) && leads.length
            ? table([
                { key:'name', label:'Lead', render:(r)=>esc(r.name||r.email||r.id) },
                { key:'status', label:'Status', render:(r)=>pill(r.status) },
                { key:'created_at', label:'Created', render:(r)=>esc(ago(r.created_at)) }
              ], leads, { idKey:'id' })
            : raw(s.leads.data, 'GET /api/sales/leads'))
        : failure(s.leads) })}
      ${panel({ title:'Identity gateway', span:'6', body: s.identity.ok
        ? raw(s.identity.data, 'GET /api/identity/status') : failure(s.identity) })}
      ${panel({ title:'Rides, drivers, rentals, payments', span:'6', body: `
        <p class="op-state__hint" style="margin:0">
          The Whip worker modules (<span class="op-mono">rides</span>,
          <span class="op-mono">rentals</span>, <span class="op-mono">stripe</span>) sit behind the
          identity gateway and expose rider- and driver-scoped routes, not operator reports.
          No owner-facing list route exists for rides, drivers, rentals or payments, so this console
          shows none rather than a fabricated table. Recorded in the audit.
        </p>` })}
    </div>`;
  }
};
