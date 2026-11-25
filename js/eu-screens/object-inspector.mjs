/* Exact-object inspection over the canonical graph. No live calls or invented rack transit behavior. */
export function inspectObject(ss, assetId) {
  const asset = ss.sandbox.assetsById.get(assetId);
  if (!asset) throw new Error('Unknown registered object: ' + assetId);
  const links = [...ss.sandbox.connectionsById.values()].filter(c => c.from_asset_id === assetId || c.to_asset_id === assetId).map(c => {
    const outgoing = c.from_asset_id === assetId;
    const owner = ss.hardware?.catalog.find(d => d.ports.some(p => p.id === c.connection_id));
    const port = owner?.ports.find(p => p.id === c.connection_id);
    return { ...c, local_port: outgoing ? c.from_port : c.to_port, peer: outgoing ? c.to_asset_id : c.from_asset_id,
      peer_port: outgoing ? c.to_port : c.from_port, state: ss.connState(c.connection_id),
      operation: owner && port ? { owner: owner.id, port: port.id, peer: port.peer, disconnected: ss.hardware.machine(owner.id).disconnected.includes(port.id) } : null };
  });
  const relations = (ss.sandbox.registry.relationships || []).filter(r => r.from_asset_id === assetId || r.to_asset_id === assetId);
  return { asset, state: ss.state(assetId), links, relations, execution_target: 'SANDBOX', live_control_allowed: false };
}

export function operateObjectConnection(ss, assetId, connectionId, type) {
  if (ss.readOnly) throw new Error('WORKPLACE is inspection only.');
  if (!['connect', 'disconnect'].includes(type)) throw new Error('Unsupported connection action.');
  const link = inspectObject(ss, assetId).links.find(c => c.connection_id === connectionId);
  if (!link?.operation) throw new Error('Inspection only: rack transit switching and patching are not modeled.');
  return ss.hardware.act(link.operation.owner, { type, port: connectionId, peer: link.operation.peer });
}

export function mountObjectInspector(ctx, ss) {
  const root = ctx.view, esc = ctx.esc;
  let id = new URLSearchParams(globalThis.location.search).get('object') || ctx.screen?.asset_id;
  let message = '';
  const button = (peer, label) => ss.sandbox.assetsById.has(peer) ? `<button type="button" class="btn" data-object="${esc(peer)}">${esc(label || peer)}</button>` : `<span>${esc(peer)} · unresolved</span>`;
  function draw() {
    let data;
    try { data = inspectObject(ss, id); } catch (e) { root.textContent = e.message + ' No substitute object was selected.'; return; }
    const {asset, state, links, relations} = data;
    root.innerHTML = `<section style="display:grid;gap:14px;min-width:0;overflow-wrap:anywhere" data-object-inspector>
      <h2>${esc(asset.label || id)}</h2><code>${esc(id)}</code>
      <p>Sandbox inspection · ${esc(asset.classification?.asset_type || 'unclassified')} · ${esc(asset.location?.level_id || 'unassigned floor')}</p>
      <p>Modeled state: ${esc(state?.availability || 'unknown')}. Geometry: ${esc(asset.digital_representation?.geometry_status || 'unknown')}. Placement: ${esc(asset.location?.placement_authority || 'unverified')}. This is design intent, not verified installed hardware.</p>
      <p role="status" aria-live="polite">${esc(message)}</p>
      <h3>Recorded physical connections (${links.length})</h3>
      ${links.map(c => `<article class="card" style="display:grid;gap:8px"><b>${esc(c.local_port || 'Port unspecified')} · ${esc(c.cable_type)}</b><code>${esc(c.connection_id)}</code><span>Recorded peer port: ${esc(c.peer_port || 'unspecified')}</span>${button(c.peer)}<span>Sandbox link: ${esc(c.state?.availability || 'unknown')}</span>${c.operation ? `<span>Operates the computer-side cable on ${esc(c.operation.owner)}. Does not rewire the rack or change its routing.</span><button class="btn" type="button" data-link="${esc(c.connection_id)}" data-action="${c.operation.disconnected ? 'connect' : 'disconnect'}" ${ss.readOnly ? 'disabled' : ''}>${c.operation.disconnected ? 'Reconnect recorded cable' : 'Disconnect computer cable'}</button>` : '<span>Inspection only: transit port switching, arbitrary repatching and downstream propagation are not modeled.</span>'}</article>`).join('') || '<p>No recorded physical connections. This does not establish that the real object is wireless or self-powered.</p>'}
      <h3>Recorded relationships</h3>${relations.map(r => {const out=r.from_asset_id===id;return `<div class="card">${esc(out?'This object':'Peer')} ${esc(r.type)} ${esc(out?'peer':'this object')}: ${button(out?r.to_asset_id:r.from_asset_id)}</div>`;}).join('') || '<p>No registered relationships.</p>'}
      <h3>Defined observation points</h3>${(asset.points || []).map(p=>`<div class="card">${esc(p.semantic_name || p.point_id)} · ${esc(p.value_type || 'unspecified')} ${esc(p.units || '')}<br>Value not supplied by this inspector; no fabricated telemetry.</div>`).join('') || '<p>No observation points registered.</p>'}
      <p>No live controls. Switch chassis interiors, arbitrary patching, rack power isolation and component servicing require dedicated models before controls can be offered.</p>
      </section>`;
    for (const b of root.querySelectorAll('button')) { b.style.minHeight='44px'; b.style.fontSize='16px'; b.style.whiteSpace='normal'; }
  }
  root.onclick = e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.object) { id=b.dataset.object; message=''; const u=new URL(location.href);u.searchParams.set('object',id);history.replaceState(history.state,'',u);draw(); }
    else if (b.dataset.link) { try { const r=operateObjectConnection(ss,id,b.dataset.link,b.dataset.action);message=r.message; } catch(e) { message=e.message; } draw(); }
  };
  draw();
  return () => { root.onclick=null; };
}
