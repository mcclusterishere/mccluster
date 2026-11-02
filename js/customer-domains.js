(function () {
  'use strict';
  const root = document.getElementById('domains'), status = document.getElementById('domainStatus');
  let targets = [];
  const targetSelect = document.getElementById('domainTarget');
  let generation = 0, controller = new AbortController();
  const stale = () => Object.assign(new Error('Session changed'), { name: 'AbortError' });
  async function api(path = '', method = 'GET', body, scope = generation) {
    const token = await window.MCC_SUPA?.token?.();
    if (scope !== generation) throw stale();
    if (!token) throw new Error('Sign in with your M Account to manage domains.');
    const r = await fetch('https://api.mccluster.org/v1/creator-domains' + path, { method, signal: controller.signal, headers: { authorization: 'Bearer ' + token, 'content-type':'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const b = await r.json(); if (scope !== generation) throw stale(); if (!r.ok) throw new Error(b.error || 'Please retry shortly'); return b;
  }
  function el(tag, text) { const n = document.createElement(tag); n.textContent = text; return n; }
  /* status words that do not overstate: a verified TXT record is not a live site; reconciliation is not a failure to retry */
  function statusWords(s) { return { ownership_pending: 'ownership not yet verified · add the TXT record, then verify again', dns_pending: 'ownership verified · your CNAME does not point at the routing target yet', tls_pending: 'ownership and CNAME verified · certificate not active yet · verify again later', active: 'routing and certificate active', error: 'last check failed · see the message below, fix the record, verify again', reconciliation_required: 'needs a reviewed provider check · do not create another connection' }[s] || String(s || '').replaceAll('_', ' '); }
  async function load() {
    const scope = ++generation; controller.abort(); controller = new AbortController();
    targets = []; targetSelect.replaceChildren(); targetSelect.disabled = true;
    root.replaceChildren(); document.getElementById('connect').disabled = true; status.textContent = 'Loading…';
    let b; try { b = await api('', 'GET', undefined, scope); } catch (e) { if (scope === generation && e.name !== 'AbortError') status.textContent = e.message; return; }
    if (scope !== generation) return; status.textContent = b.capabilities.reason; document.getElementById('connect').disabled = !b.capabilities.connect; root.replaceChildren();
    targets = b.targets || [];
    targets.forEach((target, i) => { const option = el('option',target.label); option.value=String(i); targetSelect.append(option); });
    targetSelect.disabled = !targets.length;
    if (!targets.length) document.getElementById('connect').disabled = true;
    for (const row of b.domains) {
      const card = el('article',''); card.append(el('h2',row.hostname), el('p','Status: ' + statusWords(row.status) + ' · Certificate: ' + (row.ssl_status || 'not requested')));
      /* the provider snapshot behind a verified connection expires 24 hours after the last check and nothing refreshes it
         unattended (a documented gate, docs/productization/20261102-domain/HANDOFF.md): say when, and offer the refresh */
      if (row.last_checked_at && ['active','tls_pending','dns_pending'].includes(row.status)) {
        const checked = Date.parse(row.last_checked_at), left = isFinite(checked) ? checked + 24*3600*1000 - Date.now() : NaN;
        const note = el('p', !isFinite(left) ? 'Last check time unreadable; verify again to be sure routing stays current.' : left <= 0 ? 'Provider verification has lapsed (last checked ' + new Date(checked).toLocaleString() + '). Routing may stop until you verify again; nothing refreshes it automatically yet.' : left < 6*3600*1000 ? 'Provider verification lapses in about ' + Math.max(1, Math.round(left/3600000)) + ' hour(s) (last checked ' + new Date(checked).toLocaleString() + '). Verify again before then; nothing refreshes it automatically yet.' : 'Provider verification current until about ' + new Date(checked + 24*3600*1000).toLocaleString() + '; it is not refreshed automatically yet.');
        note.className = left <= 0 ? 'domain-lapsed' : ''; card.append(note);
      }
      if (row.target) card.append(el('p','Site: ' + row.target.slug));
      if (row.last_error) card.append(el('p',row.last_error));
      if (row.connection_note) card.append(el('p',row.connection_note));
      if(row.status!=='reconciliation_required'){
        card.append(el('p','Add these records at your DNS provider. Keep the ownership TXT record in place. DNS changes can take time; retry verification after they propagate.'));
        card.append(el('pre', row.records.map(r => `${r.type} ${r.name}\n${r.value}`).join('\n\n')));
        if(row.routing_candidate?.requires_public_cname&&row.routing_candidate.value){card.append(el('p','For a hostname that supports a public CNAME, the configured routing target is below. Do not replace apex A/AAAA records using this candidate; apex support needs a separate verified connection plan.'),el('pre','CNAME '+row.routing_candidate.name+'\n'+row.routing_candidate.value));}
        if (row.provider_records.length) card.append(el('p','Additional hosting/certificate verification records:'),el('pre',JSON.stringify(row.provider_records,null,2)));
      }
      for (const [label,path,method] of [['Verify again','/verify','POST'],['Disconnect','','DELETE']]) {
        if(row.status==='reconciliation_required')continue;
        const btn = el('button',label); btn.type='button'; btn.addEventListener('click',async () => { btn.disabled=true; try { await api('/'+row.id+path,method,undefined,scope); if (scope === generation) await load(); } catch(e) { if (scope === generation && e.name !== 'AbortError') { status.textContent=e.message; btn.disabled=false; } } }); card.append(btn);
      }
      if(row.status==='reconciliation_required')card.append(el('p','This connection needs a reviewed provider ownership check. Refresh status after reconciliation; creating another claim cannot safely recover it.'));
      root.append(card);
    }
  }
  document.getElementById('domainForm').addEventListener('submit',async e => { e.preventDefault(); const scope = generation; const btn=document.getElementById('connect'); btn.disabled=true; try { await api('','POST',{hostname:document.getElementById('hostname').value,target:targets[Number(targetSelect.value)]},scope); if (scope === generation) await load(); } catch(err) { if (scope === generation && err.name !== 'AbortError') { status.textContent=err.message; btn.disabled=false; } } });
  document.getElementById('domainRefresh').addEventListener('click', load);
  window.addEventListener('mcc:auth-changed', load);
  load();
}());
