/* CRM — operator workflow over the real leads table. */
import { sbSelect } from '../supabase.js';
import { ago, drawer, esc, failure, fields, panel, pill, raw, stamp, table, bindTable } from '../ui.js';

const STAGES = ['all','new','contacted','qualified','won','lost'];

export default {
  async mount(root, { app, params, signal }) {
    const stage = params.stage || 'all';
    const q = (params.q || '').toLowerCase();
    const result = await sbSelect('leads?select=*&order=created_at.desc&limit=200');
    if (signal.aborted) return;

    if (!result.ok) {
      root.innerHTML = panel({ title:'CRM', body: failure(result) });
      return;
    }
    let rows = result.data;
    if (stage !== 'all') rows = rows.filter((r)=>String(r.status||r.stage||'new').toLowerCase()===stage);
    if (q) rows = rows.filter((r)=>JSON.stringify(r).toLowerCase().includes(q));

    root.innerHTML = `
      <div class="op-toolbar">
        ${STAGES.map((s)=>`<button class="op-chip ${stage===s?'is-on':''}" data-stage="${s}">${esc(s)}</button>`).join('')}
        <input class="op-input" id="crmQ" placeholder="Search leads…" value="${esc(params.q||'')}" style="max-width:220px;margin-left:auto">
      </div>
      ${panel({ title:'Leads', meta:`${rows.length} of ${result.data.length}`, body: table([
        { key:'name', label:'Lead', render:(r)=>esc(r.name||r.email||r.id) },
        { key:'email', label:'Email', render:(r)=>`<span class="op-mono op-truncate">${esc(r.email||'—')}</span>` },
        { key:'want', label:'Wants', render:(r)=>`<span class="op-truncate">${esc(r.want||'—')}</span>` },
        { key:'status', label:'Stage', render:(r)=>pill(r.status||r.stage||'new') },
        { key:'created_at', label:'Created', render:(r)=>esc(ago(r.created_at)) }
      ], rows, { idKey:'id', emptyLabel:'No leads match.' }) })}`;

    root.querySelectorAll('[data-stage]').forEach((c)=>c.addEventListener('click',()=>
      app.go('crm',{ stage:c.getAttribute('data-stage'), ...(params.q?{q:params.q}:{}) })));
    const search = root.querySelector('#crmQ');
    search.addEventListener('keydown',(e)=>{ if(e.key==='Enter') app.go('crm',{ stage, q:search.value.trim() }); });

    bindTable(root, rows, (row) => drawer({
      title: row.name || row.email || 'lead',
      subtitle: pill(row.status||row.stage||'new'),
      body: `${fields([
        ['Email', esc(row.email||'—')],
        ['Wants', esc(row.want||'—')],
        ['Note', esc(row.note||'—')],
        ['Created', `${esc(stamp(row.created_at))} <span class="op-state__hint">(${esc(ago(row.created_at))})</span>`]
      ])}
      <p class="op-state__hint" style="margin-top:.8rem">
        Stage changes are not wired: there is no Worker route for lead mutation, and writing to
        PostgREST from this console would bypass the control-plane authority layer. Read-only by
        choice, not by omission.
      </p>
      ${raw(row,'Lead record')}`
    }), 'id');
  }
};
