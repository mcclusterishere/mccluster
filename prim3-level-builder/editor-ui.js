(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.keys(item).sort().reduce((sorted, key) => { sorted[key] = item[key]; return sorted; }, Object.create(null)) : item);
  const uid = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const fmt = n => n > 0 ? `+${n}` : String(n).replace('-', '−');
  const LOCAL_ACTIVE = 'prim3.forge.active.v1';
  const LOCAL_DRAFTS = 'prim3.forge.drafts.v1';
  // The play test hands the document to the canonical game (prim3-transit.html?level=forge), which reads this key
  // through js/prim3-tactics/levels/forge.mjs. There is no second engine: the Forge only authors.
  const PLAYTEST_KEY = 'prim3.forge.playtest.v1';
  const PLAY_URL = '../prim3-transit.html?level=forge&new=1';
  const model = window.P3LevelModel;
  // One copy of the White Industrial kit: the game's (assets/3d/prim3-kit/white-industrial/); the Forge reads it in place.
  const KIT = '../assets/3d/prim3-kit/white-industrial/';
  // The game's own rules: forge.mjs exports the document into the levels/*.mjs shape and checks it with the
  // vendored resolver (computeReach). Loaded once; until it arrives a playable check reports that it is loading.
  let rules = window.PRIM3ForgeRules || null;
  const rulesReady = rules ? Promise.resolve(rules)
    : import('../js/prim3-tactics/levels/forge.mjs').then(m => { rules = m; if (state.doc) renderValidation(); return m; }).catch(() => null);
  const state = {
    doc: null, selected: null, assetId: null, tool: 'select', category: 'All', search: '',
    undo: [], redo: [], linkStart: null, savedAt: null, draftDirty: false, drag: null
  };
  let renderer, canvas, boundCanvas, saveTimer, toastTimer, compiled, catalog = [], assetMap = new Map();
  // A revision is adopted only after an explicit cloud load or a successful write.
  // Device drafts intentionally do not restore this authority across page loads.
  let cloudBinding = null, cloudBusy = false, documentEpoch = 0, dialogGeneration = 0;
  const cloud = window.P3LevelClient;
  const missionTools = [
    { id: 'mission:E', name: 'Entry deployment', category: 'Mission', glyph: 'E', hint: 'Player / Entry' },
    { id: 'mission:R', name: 'Recon deployment', category: 'Mission', glyph: 'R', hint: 'Player / Recon' },
    { id: 'mission:T', name: 'Tech deployment', category: 'Mission', glyph: 'T', hint: 'Player / Technical' },
    { id: 'mission:hostile', name: 'Hostile deployment', category: 'Mission', glyph: 'H', hint: 'Enemy / Guard' },
    { id: 'mission:extraction', name: 'Extraction zone', category: 'Mission', glyph: '↗', hint: 'Mission / Exit' }
  ];
  const icon = name => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`); svg.append(use); return svg;
  };
  function notice(message, error = false) {
    $('status-message').textContent = message;
    $('toast').textContent = message;
    $('toast').classList.toggle('error', error);
    $('toast').hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 5500 : 3200);
  }
  function issues(result) {
    return (Array.isArray(result) ? result : []).map(item => typeof item === 'string' ? item : item.message || item.reason || JSON.stringify(item));
  }
  function validate(playable = false) {
    let result;
    try { result = model.validate(state.doc, { playable }); }
    catch (error) { return { ok: false, errors: [error.message], warnings: [] }; }
    if (!playable || !result.ok) return result;
    if (!rules) return { ok: false, errors: ['The PRIM3 game rules are still loading.'], warnings: result.warnings };
    const verdict = rules.validateForgeLevel(state.doc);
    return { ok: verdict.ok, errors: verdict.errors, warnings: [...new Set([...result.warnings, ...verdict.warnings])] };
  }
  function bounds() {
    const b = state.doc.bounds;
    return { minX: b.minX ?? b.min ?? -64, maxX: b.maxX ?? b.max ?? 63, minY: b.minY ?? b.min ?? -64, maxY: b.maxY ?? b.max ?? 63 };
  }
  function getSelected() {
    const s = state.selected;
    if (!s) return null;
    if (s.kind === 'object') return state.doc.objects.find(o => o.id === s.id) || null;
    if (s.kind === 'spawn') return state.doc.spawns.find(o => o.id === s.id) || null;
    if (s.kind === 'connection') return state.doc.connections.find(o => o.id === s.id) || null;
    if (s.kind === 'extraction') return state.doc.extraction;
    return null;
  }
  function selectedName() {
    const item = getSelected();
    if (!item) return '';
    if (state.selected.kind === 'object') return assetMap.get(item.assetId)?.name || item.assetId;
    if (state.selected.kind === 'spawn') return `${item.id} / ${item.team === 'enemy' ? 'Hostile' : item.role === 'T' ? 'Technical' : item.role === 'R' ? 'Recon' : 'Entry'}`;
    if (state.selected.kind === 'connection') return `${item.type === 'ladder' ? 'Ladder' : 'Stair'} link`;
    return 'Extraction zone';
  }
  function footprint(item) {
    try { return model.boundsFor(item); }
    catch (_) { const a = assetMap.get(item.assetId); return { x: item.x, y: item.y, w: a?.width || 1, d: a?.depth || 1 }; }
  }
  function selectionBox(item = getSelected()) {
    if (!item) return null;
    if (state.selected?.kind === 'object') return { ...footprint(item), elevation: item.elevation || 0, h: item.elevation || 0 };
    if (state.selected?.kind === 'extraction') { const r = item.radius || 8; return { x: item.x - r, y: item.y - r, w: r * 2, d: r * 2, elevation: 0 }; }
    if (state.selected?.kind === 'spawn') return { x: item.x, y: item.y, w: 1, d: 1, elevation: compiled?.heightAt(item) || 0 };
    return null;
  }
  function updateOverlay(ghost) {
    if (!renderer) return;
    const selected = getSelected();
    renderer.setOverlay({
      selectedId: state.selected?.kind === 'spawn' ? state.selected.id : null,
      selectionBox: ghost || selectionBox(),
      path: state.selected?.kind === 'connection' && selected ? [selected.from, selected.to] : state.linkStart ? [state.linkStart] : [],
      reachable: []
    });
  }
  function snapshot() {
    return {
      selectedId: state.selected?.kind === 'spawn' ? state.selected.id : 'E', gateOpen: false,
      turn: 1, phase: 'player', status: 'active', hackProgress: 0, medkitUsed: false,
      units: state.doc.spawns.map(s => ({ hp: 10, maxHp: 10, ap: 2, maxAp: 2, dead: false, extracted: false, visible: true, ...s }))
    };
  }
  function synchronizeWorld(preserveCamera = true) {
    compiled = model.compile(state.doc);
    const camera = preserveCamera && renderer ? { ...renderer.camera } : null;
    const view = renderer?.view || '3d';
    if (renderer && typeof renderer.setLevel === 'function') {
      renderer.setLevel(compiled);
    } else {
      renderer?.destroy();
      canvas = $('level-canvas');
      renderer = new window.P3Renderer(canvas, compiled, { onPick: handlePick, editor: true });
    }
    canvas = renderer.canvas || $('level-canvas');
    renderer.setState(snapshot());
    if (camera) { Object.assign(renderer.camera, camera); renderer.setView(view); renderer.resize(); }
    else { renderer.overview(); }
    updateOverlay();
    bindCanvas();
    $('renderer-mode').textContent = renderer.getMode() === 'webgl' ? '3D / WEBGL' : '3D / COMPATIBILITY';
    $('initializing').hidden = true;
  }
  function setPanel(panel) {
    $('forge').dataset.panel = panel;
    document.querySelectorAll('.mobile-tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.panel === panel)));
    $('desktop-objects').textContent = panel === 'objects' ? 'Asset library' : 'Scene objects';
    requestAnimationFrame(() => renderer?.resize());
  }
  function setTool(tool, assetId = null) {
    if (tool === 'move' && !getSelected()) { notice('Select an object or deployment before moving it.'); return; }
    state.tool = tool; state.assetId = tool === 'place' ? assetId : null;
    if (tool !== 'link') state.linkStart = null;
    document.querySelectorAll('[data-tool]').forEach(b => { const active = b.dataset.tool === tool; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
    $('placement-banner').hidden = tool === 'select';
    $('link-controls').hidden = tool !== 'link';
    const asset = assetMap.get(assetId) || missionTools.find(a => a.id === assetId);
    $('mode-label').textContent = `SCENE / ${tool === 'place' ? 'PLACE' : tool.toUpperCase()}`;
    if (tool === 'place') { $('placement-label').textContent = asset?.name || 'Place asset'; $('placement-hint').textContent = 'Tap to place · Esc to finish'; }
    if (tool === 'move') { $('placement-label').textContent = `Move ${selectedName()}`; $('placement-hint').textContent = 'Tap the new position'; }
    if (tool === 'link') { $('placement-label').textContent = 'Add traversal link'; $('placement-hint').textContent = 'Tap the first endpoint'; }
    document.querySelectorAll('.asset-card').forEach(card => { card.classList.toggle('active', card.dataset.asset === assetId); card.setAttribute('aria-pressed', String(card.dataset.asset === assetId)); });
    updateOverlay();
  }
  function select(kind, id, focus = false, switchPanel = false) {
    state.selected = kind ? { kind, id } : null;
    if (!getSelected()) state.selected = null;
    renderInspector(); renderObjects(); drawSector(); updateOverlay();
    if (switchPanel && state.selected) setPanel('inspect');
    const obj = getSelected();
    if (focus && obj) {
      const n = kind === 'connection' ? obj.from : obj;
      renderer.focus({ x: n.x, y: n.y, layer: n.layer || 0 });
    }
  }
  function change(mutator, message, options = {}) {
    const previous = clone(state.doc);
    try {
      mutator(state.doc);
      const check = validate(false);
      if (!check.ok) throw new Error(issues(check.errors)[0] || 'This change is outside the level limits.');
      state.undo.push(previous); if (state.undo.length > 60) state.undo.shift(); state.redo.length = 0;
      state.draftDirty = true;
      synchronizeWorld(); renderAll(); scheduleSave();
      if (message) notice(message);
      return true;
    } catch (error) {
      state.doc = previous;
      if (options.silent !== true) notice(error.message || 'That change could not be applied.', true);
      try { synchronizeWorld(); renderAll(); } catch (_) {}
      return false;
    }
  }
  function history(direction) {
    const from = direction === 'undo' ? state.undo : state.redo;
    const to = direction === 'undo' ? state.redo : state.undo;
    if (!from.length) return;
    to.push(clone(state.doc)); state.doc = from.pop(); state.selected = null; state.draftDirty = true;
    synchronizeWorld(); renderAll(); scheduleSave(); notice(direction === 'undo' ? 'Change undone.' : 'Change restored.');
  }
  function scheduleSave() {
    clearTimeout(saveTimer); $('save-status').textContent = 'This device · saving…';
    saveTimer = setTimeout(() => saveDraft(false), 550);
  }
  function readDrafts() {
    try { const value = JSON.parse(localStorage.getItem(LOCAL_DRAFTS) || '[]'); return Array.isArray(value) ? value : []; }
    catch (_) { return []; }
  }
  function archiveBeforeReplacement(doc) {
    if (!doc) return;
    try {
      const drafts = readDrafts(), serialized = stableJSON(doc);
      if (!drafts.some(entry => entry.recovery && entry.document?.id === doc.id && stableJSON(entry.document) === serialized)) {
        drafts.unshift({ document: clone(doc), savedAt: new Date().toISOString(), recovery: true });
      }
      localStorage.setItem(LOCAL_DRAFTS, JSON.stringify(drafts.slice(0, 40)));
    } catch (_) {
      throw new Error('The current draft could not be protected on this device. Export its JSON before replacing it.');
    }
  }
  function saveDraft(explicit = true) {
    clearTimeout(saveTimer);
    try {
      const now = new Date().toISOString();
      localStorage.setItem(LOCAL_ACTIVE, JSON.stringify({ document: state.doc, savedAt: now }));
      if (explicit) {
        const drafts = readDrafts().filter(d => d.recovery || d.document?.id !== state.doc.id);
        drafts.unshift({ document: clone(state.doc), savedAt: now });
        localStorage.setItem(LOCAL_DRAFTS, JSON.stringify(drafts.slice(0, 40)));
        state.draftDirty = false;
      }
      state.savedAt = now; $('save-status').textContent = 'Saved on this device';
      if (explicit) notice('Draft saved on this device. Export JSON to keep a portable copy.');
      return true;
    } catch (_) {
      $('save-status').textContent = 'Device storage unavailable';
      if (explicit) notice('This browser could not save the draft. Use Export level JSON to keep it.', true);
      return false;
    }
  }
  function loadDocument(doc, label, preserveHistory = false) {
    const before = state.doc;
    state.doc = clone(doc);
    const result = validate(false);
    if (!result.ok) { state.doc = before; throw new Error(issues(result.errors)[0] || 'This level file is not supported.'); }
    try { archiveBeforeReplacement(before); }
    catch (error) { state.doc = before; throw error; }
    state.doc.connections ||= []; state.doc.spawns ||= []; state.doc.objects ||= [];
    cloudBinding = null; documentEpoch++;
    if (preserveHistory && before) state.undo.push(clone(before)); else state.undo = [];
    state.redo = []; state.selected = null; state.draftDirty = true;
    setTool('select'); synchronizeWorld(false); renderAll(); scheduleSave();
    if (label) notice(label);
  }
  function renderAll() {
    if (document.activeElement !== $('level-title')) $('level-title').value = state.doc.title;
    const b = bounds(), count = state.doc.objects.length;
    $('bounds-label').textContent = `${b.maxX - b.minX + 1} × ${b.maxY - b.minY + 1}`;
    $('geometry-status').textContent = `${b.maxX - b.minX + 1} × ${b.maxY - b.minY + 1} SECTOR`;
    $('object-count').textContent = `${count} OBJECT${count === 1 ? '' : 'S'}`;
    $('mobile-count').textContent = count;
    $('undo').disabled = !state.undo.length; $('redo').disabled = !state.redo.length;
    renderInspector(); renderObjects(); drawSector(); renderValidation(); renderCloudControls();
  }
  function renderAssets() {
    const activeCategories = ['All', ...new Set(catalog.filter(a => !['spawn-marker', 'extraction-marker', 'relay-terminal'].includes(a.id)).map(a => a.category || 'Other')), 'Mission'];
    $('category-tabs').replaceChildren(...activeCategories.map(category => {
      const button = document.createElement('button'); button.textContent = category; button.className = category === state.category ? 'active' : '';
      button.setAttribute('aria-pressed', String(category === state.category));
      button.onclick = () => { state.category = category; renderAssets(); };
      return button;
    }));
    const assets = [...catalog.filter(a => !['spawn-marker', 'extraction-marker', 'relay-terminal'].includes(a.id)), ...missionTools]
      .filter(a => (state.category === 'All' || a.category === state.category) && `${a.name} ${a.category} ${a.description || ''}`.toLowerCase().includes(state.search));
    $('asset-grid').replaceChildren();
    if (!assets.length) { const p = document.createElement('p'); p.className = 'empty-list'; p.textContent = 'No matching assets. Try another name or category.'; p.style.gridColumn = '1 / -1'; $('asset-grid').append(p); }
    for (const asset of assets) {
      const button = document.createElement('button'); button.className = 'asset-card'; button.dataset.asset = asset.id; button.draggable = true;
      button.classList.toggle('active', state.assetId === asset.id); button.setAttribute('aria-pressed', String(state.assetId === asset.id));
      button.title = `${asset.name}. Drag into the scene, or select and tap to place.`;
      const preview = document.createElement('span'); preview.className = 'asset-preview';
      if (asset.glyph) {
        const glyph = document.createElement('span'); glyph.className = 'mission-glyph'; glyph.textContent = asset.glyph;
        if (asset.id === 'mission:hostile') { glyph.style.color = '#a55348'; glyph.style.borderColor = '#c39d8e'; glyph.style.background = '#fff5ed'; }
        preview.append(glyph);
      } else {
        const img = document.createElement('img'); img.src = `${KIT}previews/${encodeURIComponent(asset.id)}.png`; img.alt = ''; img.loading = 'lazy';
        img.onerror = () => { img.remove(); preview.append(icon('box')); }; preview.append(img);
      }
      const add = document.createElement('span'); add.className = 'asset-add'; add.textContent = '+';
      const name = document.createElement('span'); name.className = 'asset-name'; name.textContent = asset.name;
      const rounded = value => String(Math.round(Number(value || 0) * 100) / 100);
      const dim = document.createElement('span'); dim.className = 'asset-dim'; dim.textContent = asset.hint || `${rounded(asset.footprint?.width ?? asset.width)} × ${rounded(asset.footprint?.depth ?? asset.depth)} × ${rounded(asset.height)}`;
      button.append(preview, add, name, dim);
      button.onclick = () => { setTool('place', asset.id); notice(`${asset.name} selected. Tap the battlefield to place it.`); };
      button.addEventListener('dragstart', event => { event.dataTransfer.setData('application/x-prim3-asset', asset.id); event.dataTransfer.setData('text/plain', asset.id); event.dataTransfer.effectAllowed = 'copy'; setTool('place', asset.id); });
      button.addEventListener('dragend', () => $('canvas-wrap').classList.remove('drop-active'));
      $('asset-grid').append(button);
    }
    $('asset-total').textContent = catalog.length;
  }
  function renderInspector() {
    const item = getSelected(), kind = state.selected?.kind;
    $('inspector-empty').hidden = !!item; $('inspector-content').hidden = !item;
    $('deselect').disabled = !item;
    if (!item) return;
    const asset = kind === 'object' ? assetMap.get(item.assetId) : null;
    $('selection-name').textContent = selectedName();
    $('selection-category').textContent = String(asset?.category || (kind === 'connection' ? 'Traversal' : 'Mission')).toUpperCase();
    $('selection-icon').replaceChildren(icon(kind === 'connection' ? 'link' : kind === 'spawn' ? 'cursor' : 'box'));
    $('position-fields').hidden = kind === 'connection';
    $('object-fields').hidden = kind !== 'object'; $('spawn-fields').hidden = kind !== 'spawn';
    $('extraction-fields').hidden = kind !== 'extraction'; $('connection-fields').hidden = kind !== 'connection';
    const b = bounds();
    for (const axis of ['x', 'y']) { const input = $(`inspector-${axis}`); input.value = item[axis] ?? 0; input.min = axis === 'x' ? b.minX : b.minY; input.max = axis === 'x' ? b.maxX : b.maxY; }
    $('inspector-elevation').value = item.elevation || 0; $('inspector-scale').value = item.scale || 1;
    $('inspector-rotation').value = item.rotation || 0; $('inspector-layer').value = item.layer || 0;
    $('inspector-radius').value = item.radius || 8;
    $('inspector-cost').value = item.cost || 12;
    if (kind === 'connection') $('connection-endpoints').textContent = `FROM (${item.from.x}, ${item.from.y}) · ${item.from.layer ? 'Rooftop' : 'Ground'}\nTO   (${item.to.x}, ${item.to.y}) · ${item.to.layer ? 'Rooftop' : 'Ground'}`;
    $('rotate-selection').disabled = kind !== 'object'; $('duplicate-selection').disabled = !['object', 'spawn'].includes(kind) || (kind === 'spawn' && item.team === 'player');
    $('delete-selection').disabled = kind === 'extraction';
    $('selection-description').textContent = asset ? `${asset.description || 'Reusable environment asset.'} Position locates the lower-left footprint corner.` : kind === 'spawn' ? 'Place the operative on a clear ground cell or a supported rooftop. Player roles E, R, and T are required to test the mission.' : kind === 'connection' ? 'Connects two playable surfaces. Check both endpoints and movement cost before testing.' : 'Every surviving operative must reach this zone after Technical connects the relay.';
    const validModel = asset?.model && !/^(?:[a-z]+:|\/\/|\/|.*\.\.)/i.test(asset.model);
    $('model-download').hidden = !validModel;
    if (validModel) { $('model-download').href = `${KIT}${asset.model}`; $('model-download').download = asset.model.split('/').pop(); }
  }
  function renderObjects() {
    const filter = $('scene-filter').value;
    const rows = [];
    if (filter === 'all' || filter === 'objects') state.doc.objects.forEach((o, index) => rows.push({ kind: 'object', id: o.id, name: assetMap.get(o.assetId)?.name || o.assetId, note: `X ${fmt(o.x)} · Y ${fmt(o.y)} · Z ${o.elevation || 0}`, order: String(index + 1).padStart(2, '0'), ico: 'box' }));
    if (filter === 'all' || filter === 'spawns') state.doc.spawns.forEach(o => rows.push({ kind: 'spawn', id: o.id, name: `${o.id} / ${o.team === 'enemy' ? 'Hostile' : 'Player deployment'}`, note: `X ${fmt(o.x)} · Y ${fmt(o.y)} · ${o.layer ? 'ROOF' : 'GROUND'}`, order: o.role || '', ico: 'cursor' }));
    if (filter === 'all' || filter === 'connections') state.doc.connections.forEach(o => rows.push({ kind: 'connection', id: o.id, name: `${o.type === 'ladder' ? 'Ladder' : 'Stair'} link`, note: `(${o.from.x}, ${o.from.y}) → (${o.to.x}, ${o.to.y})`, order: `${o.cost}`, ico: 'link' }));
    if (filter === 'all' && state.doc.extraction) rows.push({ kind: 'extraction', id: 'extraction', name: 'Extraction zone', note: `X ${fmt(state.doc.extraction.x)} · Y ${fmt(state.doc.extraction.y)}`, order: 'EXIT', ico: 'expand' });
    $('list-count').textContent = rows.length;
    $('object-list').replaceChildren(...rows.map(row => {
      const b = document.createElement('button'); b.className = 'object-row'; b.classList.toggle('active', state.selected?.kind === row.kind && state.selected?.id === row.id);
      const content = document.createElement('div'), title = document.createElement('strong'), note = document.createElement('small'), order = document.createElement('span');
      title.textContent = row.name; note.textContent = row.note; order.textContent = row.order; order.className = 'object-order'; content.append(title, note);
      b.append(icon(row.ico), content, order); b.onclick = () => select(row.kind, row.id, true, true); return b;
    }));
    if (!rows.length) { const p = document.createElement('p'); p.className = 'empty-list'; p.textContent = 'No objects in this view yet.'; $('object-list').append(p); }
  }
  function renderValidation() {
    const check = validate(true), errors = issues(check.errors), warnings = issues(check.warnings);
    $('validation-dot').className = `tiny-dot ${errors.length ? 'invalid' : warnings.length ? 'warning' : ''}`;
    $('validation-title').textContent = errors.length ? `${errors.length} item${errors.length === 1 ? '' : 's'} to resolve` : 'Ready to test';
    $('validation-summary').textContent = errors[0] || warnings[0] || 'The mission setup and deployment positions pass the level checks.';
  }
  function drawSector() {
    if (!state.doc) return;
    const c = $('sector-map'), ctx = c.getContext('2d');
    if (!ctx) return;
    const W = c.width, H = c.height, left = 54, top = 42, right = 16, bottom = 18;
    const b = bounds(), ww = b.maxX - b.minX + 1, hh = b.maxY - b.minY + 1, sx = (W - left - right) / ww, sy = (H - top - bottom) / hh;
    const px = x => left + (x - b.minX) * sx, py = y => H - bottom - (y - b.minY) * sy;
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#f7faf2'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#edf1e7'; ctx.fillRect(left, top, W - left - right, H - top - bottom);
    ctx.save(); ctx.beginPath(); ctx.rect(left, top, W - left - right, H - top - bottom); ctx.clip();
    for (const obj of state.doc.objects) {
      const a = assetMap.get(obj.assetId), f = footprint(obj);
      const id = obj.assetId.toLowerCase();
      ctx.fillStyle = id.includes('water') ? '#55a6a0' : id.includes('grass') ? '#a6bb82' : id.includes('tree') ? '#6c9763' : id.includes('soil') ? '#bfaa82' : id.includes('rock') ? '#aaa89c' : '#fffef6';
      ctx.strokeStyle = obj.elevation ? '#89988c' : '#afbdb0'; ctx.lineWidth = 1.2;
      ctx.fillRect(px(f.x), py(f.y + f.d), f.w * sx, f.d * sy); ctx.strokeRect(px(f.x), py(f.y + f.d), f.w * sx, f.d * sy);
      if ((a?.height || 0) >= 8 && f.w >= 8 && f.d >= 8) { ctx.fillStyle = '#75887c'; ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillText(`Z +${Math.round((obj.elevation || 0) + (a?.surfaceHeight ?? a?.height ?? 0) * (obj.scale || 1))}`, px(f.x + f.w / 2), py(f.y + f.d / 2) + 3); }
    }
    ctx.restore();
    const step = ww > 128 ? 32 : 16;
    ctx.font = '12px monospace'; ctx.textAlign = 'center';
    for (let x = b.minX; x <= b.maxX + 1; x += step) { ctx.strokeStyle = x === 0 ? '#59766b' : '#b9c8bc90'; ctx.lineWidth = x === 0 ? 1.6 : 0.8; ctx.beginPath(); ctx.moveTo(px(x), top); ctx.lineTo(px(x), H - bottom); ctx.stroke(); ctx.fillStyle = '#526d60'; ctx.fillText(fmt(x), px(x), 28); }
    ctx.textAlign = 'right';
    for (let y = b.minY; y <= b.maxY + 1; y += step) { ctx.strokeStyle = y === 0 ? '#59766b' : '#b9c8bc90'; ctx.lineWidth = y === 0 ? 1.6 : 0.8; ctx.beginPath(); ctx.moveTo(left, py(y)); ctx.lineTo(W - right, py(y)); ctx.stroke(); ctx.fillStyle = '#526d60'; ctx.fillText(fmt(y), 44, py(y) + 4); }
    ctx.textAlign = 'left'; ctx.font = '11px monospace'; ctx.fillText('Y', 13, 30); ctx.fillText('X', W - 20, 14);
    ctx.strokeStyle = '#008d88'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    for (const link of state.doc.connections) { ctx.beginPath(); ctx.moveTo(px(link.from.x + .5), py(link.from.y + .5)); ctx.lineTo(px(link.to.x + .5), py(link.to.y + .5)); ctx.stroke(); }
    ctx.setLineDash([]);
    const ex = state.doc.extraction;
    if (ex) { ctx.strokeStyle = '#49a795'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.ellipse(px(ex.x + .5), py(ex.y + .5), (ex.radius || 8) * sx, (ex.radius || 8) * sy, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    for (const s of state.doc.spawns) {
      const x = px(s.x + .5), y = py(s.y + .5), enemy = s.team === 'enemy';
      ctx.fillStyle = enemy ? '#fff4ec' : '#edfffa'; ctx.strokeStyle = enemy ? '#b57760' : '#188f85'; ctx.lineWidth = 1.8;
      ctx.fillRect(x - 8, y - 8, 16, 16); ctx.strokeRect(x - 8, y - 8, 16, 16); ctx.fillStyle = enemy ? '#a36b56' : '#18776d'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.fillText(s.id, x, y + 3);
    }
    const r = state.doc.objective || { x: 0, y: 0 }, rx = px(r.x + .5), ry = py(r.y + .5);
    ctx.beginPath(); ctx.moveTo(rx, ry - 9); ctx.lineTo(rx + 9, ry); ctx.lineTo(rx, ry + 9); ctx.lineTo(rx - 9, ry); ctx.closePath(); ctx.fillStyle = '#fff3cb'; ctx.fill(); ctx.strokeStyle = '#c19334'; ctx.lineWidth = 2; ctx.stroke();
    const selection = selectionBox();
    if (selection) { ctx.strokeStyle = '#008b86'; ctx.lineWidth = 3; ctx.strokeRect(px(selection.x), py(selection.y + selection.d), selection.w * sx, selection.d * sy); }
    ctx.strokeStyle = '#94aa99'; ctx.lineWidth = 1; ctx.strokeRect(left, top, W - left - right, H - top - bottom);
    $('sector-coordinate').textContent = `X ${fmt(b.minX)}…${fmt(b.maxX + 1)} · Y ${fmt(b.minY)}…${fmt(b.maxY + 1)}`;
  }
  function nodeFromPointer(event) {
    if (!renderer) return null;
    let point = renderer.pickAt?.(event.clientX, event.clientY);
    if (point?.kind === 'unit') point = state.doc.spawns.find(s => s.id === point.id);
    if (!point && renderer._unproject) { const rect = canvas.getBoundingClientRect(), n = renderer._unproject(event.clientX - rect.left, event.clientY - rect.top, 0); point = { x: Math.floor(n.x), y: Math.floor(n.z), layer: 0 }; }
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return { x: Math.floor(point.x), y: Math.floor(point.y), layer: point.layer || 0 };
  }
  function objectAt(node) {
    const ordered = state.doc.objects.map((o, index) => ({ o, index })).sort((a, b) => (b.o.elevation || 0) - (a.o.elevation || 0) || b.index - a.index);
    return ordered.find(({ o }) => { const f = footprint(o); return node.x >= f.x && node.x < f.x + f.w && node.y >= f.y && node.y < f.y + f.d; })?.o;
  }
  function findSelection(node) {
    const spawn = state.doc.spawns.find(s => s.x === node.x && s.y === node.y && (s.layer || 0) === (node.layer || 0));
    if (spawn) return { kind: 'spawn', id: spawn.id };
    const object = objectAt(node); if (object) return { kind: 'object', id: object.id };
    const ex = state.doc.extraction; if (ex && Math.hypot(node.x - ex.x, node.y - ex.y) <= 2) return { kind: 'extraction', id: 'extraction' };
    return null;
  }
  function place(assetId, n) {
    const b = bounds(); if (n.x < b.minX || n.x > b.maxX || n.y < b.minY || n.y > b.maxY) return notice('Choose a position inside the sector.', true);
    const asset = assetMap.get(assetId) || missionTools.find(a => a.id === assetId);
    if (!asset) return;
    let selected;
    const ok = change(doc => {
      if (assetId.startsWith('mission:')) {
        const kind = assetId.split(':')[1];
        if (kind === 'extraction') { doc.extraction = { x: n.x, y: n.y, radius: doc.extraction?.radius || 8 }; selected = { kind: 'extraction', id: 'extraction' }; }
        else {
          const enemy = kind === 'hostile', id = enemy ? `H${Math.max(0, ...doc.spawns.filter(s => /^H\d+$/.test(s.id)).map(s => Number(s.id.slice(1)))) + 1}` : kind;
          const item = { id, role: enemy ? 'guard' : kind, team: enemy ? 'enemy' : 'player', x: n.x, y: n.y, layer: n.layer || 0 };
          const existing = doc.spawns.findIndex(s => s.id === id); if (existing >= 0) doc.spawns[existing] = item; else doc.spawns.push(item);
          selected = { kind: 'spawn', id };
        }
      } else {
        const obj = model.newObject(assetId, n.x, n.y); doc.objects.push(obj); selected = { kind: 'object', id: obj.id };
      }
    }, `${asset.name} placed at (${n.x}, ${n.y}).`);
    if (ok && selected) { state.selected = selected; renderInspector(); renderObjects(); updateOverlay(); drawSector(); }
  }
  function moveSelected(node) {
    const selected = state.selected, item = getSelected(); if (!item) return;
    change(doc => {
      if (selected.kind === 'connection') { const dx = node.x - item.from.x, dy = node.y - item.from.y; item.from.x += dx; item.from.y += dy; item.to.x += dx; item.to.y += dy; }
      else { item.x = node.x; item.y = node.y; if (selected.kind === 'spawn') item.layer = node.layer || 0; }
    }, `${selectedName()} moved.`);
    setTool('select');
  }
  function handlePick(event) {
    let node = event;
    if (event.kind === 'unit') {
      const spawn = state.doc.spawns.find(s => s.id === event.id); if (!spawn) return;
      if (state.tool === 'select') { select('spawn', spawn.id, false, true); return; }
      node = spawn;
    }
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
    if (state.tool === 'place') return place(state.assetId, node);
    if (state.tool === 'move') return moveSelected(node);
    if (state.tool === 'link') {
      const endpoint = { x: node.x, y: node.y, layer: Number($('link-layer').value) };
      if (!state.linkStart) { state.linkStart = endpoint; $('placement-hint').textContent = 'Choose endpoint layer, then tap the destination'; $('link-layer').value = endpoint.layer ? '0' : '1'; updateOverlay(); notice('First endpoint set. Choose the destination surface and tap its cell.'); }
      else {
        const from = clone(state.linkStart), to = endpoint;
        if (from.x === to.x && from.y === to.y && from.layer === to.layer) return notice('The endpoints must be different cells or layers.', true);
        let h1 = 0, h2 = 0; try { h1 = compiled.heightAt(from); h2 = compiled.heightAt(to); } catch (_) {}
        const cost = Math.min(128, Math.max(1, Math.ceil(Math.abs(from.x - to.x) + Math.abs(from.y - to.y) + Math.abs(h1 - h2))));
        const link = { id: uid('link'), type: $('link-type').value, from, to, cost };
        if (change(doc => doc.connections.push(link), 'Traversal link added. Inspect its endpoints and movement cost.')) { state.selected = { kind: 'connection', id: link.id }; setTool('select'); renderInspector(); updateOverlay(); setPanel('inspect'); }
      }
      return;
    }
    const found = findSelection(node); select(found?.kind || null, found?.id, false, !!found);
  }
  function bindCanvas() {
    if (boundCanvas === canvas) return;
    boundCanvas = canvas;
    canvas.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('application/x-prim3-asset') || state.assetId) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; $('canvas-wrap').classList.add('drop-active'); } });
    canvas.addEventListener('dragleave', () => $('canvas-wrap').classList.remove('drop-active'));
    canvas.addEventListener('drop', event => {
      event.preventDefault(); $('canvas-wrap').classList.remove('drop-active');
      const id = event.dataTransfer.getData('application/x-prim3-asset') || event.dataTransfer.getData('text/plain');
      const node = nodeFromPointer(event); if (node && (assetMap.has(id) || missionTools.some(a => a.id === id))) place(id, node);
    });
    canvas.addEventListener('pointermove', event => {
      const point = nodeFromPointer(event); if (point) $('cursor-position').textContent = `X ${fmt(point.x)} / Y ${fmt(point.y)} / Z ${point.layer ? Math.round(compiled.heightAt(point) || 0) : 0}`;
    });
    canvas.addEventListener('pointerdown', event => {
      if (state.tool !== 'select' || event.button !== 0 || event.shiftKey || event.altKey || state.drag) return;
      const node = nodeFromPointer(event), found = node && findSelection(node);
      if (!found || found.kind === 'connection') return;
      event.stopImmediatePropagation(); event.preventDefault();
      select(found.kind, found.id, false, false);
      const item = getSelected();
      state.drag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, node, original: clone(item), moved: false, last: node };
      canvas.setPointerCapture(event.pointerId);
    }, true);
    canvas.addEventListener('pointermove', event => {
      const drag = state.drag; if (!drag || event.pointerId !== drag.pointerId) return;
      event.stopImmediatePropagation(); event.preventDefault();
      if (Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) > 5) drag.moved = true;
      if (!drag.moved) return;
      const node = nodeFromPointer(event); if (!node) return;
      drag.last = node;
      const ghost = clone(drag.original); ghost.x += node.x - drag.node.x; ghost.y += node.y - drag.node.y;
      const box = state.selected.kind === 'object' ? { ...footprint(ghost), elevation: ghost.elevation || 0 } : { x: ghost.x, y: ghost.y, w: 1, d: 1, elevation: compiled.heightAt(ghost) || 0 };
      updateOverlay(box); canvas.classList.add('dragging-object');
      $('cursor-position').textContent = `X ${fmt(ghost.x)} / Y ${fmt(ghost.y)} / Z ${ghost.elevation || 0}`;
    }, true);
    const release = (event, cancel) => {
      const drag = state.drag; if (!drag || event.pointerId !== drag.pointerId) return;
      event.stopImmediatePropagation(); event.preventDefault(); state.drag = null; canvas.classList.remove('dragging-object');
      try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
      if (!cancel && drag.moved) {
        const x = drag.original.x + drag.last.x - drag.node.x, y = drag.original.y + drag.last.y - drag.node.y;
        const item = getSelected(); if (item && (item.x !== x || item.y !== y)) change(() => { item.x = x; item.y = y; }, `${selectedName()} moved to (${x}, ${y}).`);
      } else if (!cancel) setPanel('inspect');
      updateOverlay(); drawSector();
    };
    canvas.addEventListener('pointerup', e => release(e, false), true); canvas.addEventListener('pointercancel', e => release(e, true), true);
  }
  function rotateSelection() {
    const item = getSelected(); if (!item || state.selected.kind !== 'object') return;
    change(() => { item.rotation = ((item.rotation || 0) + 90) % 360; }, 'Object rotated 90°.');
  }
  function duplicateSelection() {
    const item = getSelected(), kind = state.selected?.kind; if (!item || !['object', 'spawn'].includes(kind)) return;
    if (kind === 'spawn' && item.team === 'player') return notice('Each player role has one deployment. Move its existing marker.');
    const copy = clone(item); copy.x += 2; copy.y += 2;
    copy.id = kind === 'spawn' ? `H${Math.max(0, ...state.doc.spawns.filter(s => /^H\d+$/.test(s.id)).map(s => Number(s.id.slice(1)))) + 1}` : uid(item.assetId);
    if (change(doc => { (kind === 'object' ? doc.objects : doc.spawns).push(copy); }, 'Copy created. Drag it or enter a new position.')) select(kind, copy.id, false, true);
  }
  function deleteSelection() {
    const selected = state.selected, item = getSelected(); if (!item || selected.kind === 'extraction') return;
    const title = selectedName();
    if (change(doc => { const key = selected.kind === 'object' ? 'objects' : selected.kind === 'spawn' ? 'spawns' : 'connections'; doc[key] = doc[key].filter(o => o.id !== selected.id); }, `${title} removed. Undo is available.`)) { state.selected = null; renderInspector(); updateOverlay(); }
  }
  function dialog(title, build, actions = [{ label: 'Done', action: closeDialog }]) {
    dialogGeneration++;
    $('dialog-title').textContent = title; $('dialog-body').replaceChildren(); $('dialog-footer').replaceChildren(); build($('dialog-body'));
    actions.forEach(({ label, action, primary }) => { const button = document.createElement('button'); button.className = `button${primary ? ' primary' : ''}`; button.textContent = label; button.onclick = action; $('dialog-footer').append(button); });
    if (!$('forge-dialog').open) $('forge-dialog').showModal();
  }
  function closeDialog() { $('forge-dialog').close(); }
  function paragraph(parent, text) { const p = document.createElement('p'); p.textContent = text; parent.append(p); return p; }
  function checkDialog() {
    const check = validate(true), errors = issues(check.errors), warnings = issues(check.warnings);
    dialog(errors.length ? 'A few things need attention' : 'Ready for a test run', body => {
      paragraph(body, errors.length ? 'Your draft is safe to keep editing. Resolve these items before launching the mission.' : 'The level meets the mission setup checks. Test the approach, cover, and rooftop routes before sharing it.');
      for (const [list, heading, cls] of [[errors, 'Required', 'validation-error'], [warnings, 'Review', 'validation-warning']]) {
        if (!list.length) continue; const h = document.createElement('h3'); h.textContent = heading; body.append(h); const ul = document.createElement('ul');
        list.forEach(text => { const li = document.createElement('li'); li.className = cls; li.textContent = text; ul.append(li); }); body.append(ul);
      }
      if (!errors.length && !warnings.length) paragraph(body, `${state.doc.objects.length} placed assets · ${state.doc.spawns.length} deployments · ${state.doc.connections.length} traversal links.`);
    }, errors.length ? [{ label: 'Back to editing', action: closeDialog }] : [{ label: 'Keep editing', action: closeDialog }, { label: 'Play test', primary: true, action: testLevel }]);
  }
  async function testLevel() {
    await rulesReady;
    const check = validate(true); if (!check.ok) return checkDialog();
    if (!saveDraft(false)) return;
    try { localStorage.setItem(PLAYTEST_KEY, JSON.stringify(state.doc)); }
    catch (_) { notice('This browser cannot hand the level to the game. Export JSON to keep your work.', true); return; }
    location.assign(PLAY_URL); // the game's settings sheet links back here; this draft reopens from this device
  }
  function confirmNew(starter) {
    dialog(starter ? 'Load the transit starter?' : 'Create a blank level?', body => paragraph(body, 'Save the current draft on this device before opening a new level. You can reopen saved drafts from the level menu.'), [
      { label: 'Cancel', action: closeDialog },
      { label: 'Save & continue', primary: true, action: () => { if (!saveDraft(true)) return; closeDialog(); try { loadDocument(starter ? model.createStarter() : model.createBlank(), starter ? 'Transit starter loaded.' : 'New blank level ready.'); setPanel('assets'); } catch (error) { notice(error.message, true); } } }
    ]);
  }
  function exportLevel() {
    const json = JSON.stringify(state.doc, null, 2) + '\n'; const blob = new Blob([json], { type: 'application/json' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${(state.doc.title || 'PRIM3-Level').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 70) || 'PRIM3-Level'}.json`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); notice('Level JSON exported, including placements, deployments, and traversal links.');
  }
  function openDrafts() {
    const drafts = readDrafts();
    dialog('Drafts on this device', body => {
      paragraph(body, 'These drafts are stored in this browser. Export level JSON for a portable copy.');
      if (!drafts.length) { paragraph(body, 'No named drafts yet. Use Save draft to add this level.'); return; }
      drafts.forEach(d => {
        if (!d.document?.id) return; const button = document.createElement('button'); button.className = 'draft-row'; const content = document.createElement('div'), title = document.createElement('strong'), note = document.createElement('small');
        title.textContent = d.document.title || 'Untitled level'; note.textContent = `${d.recovery ? 'Recovery copy · ' : ''}${d.document.objects?.length || 0} assets · ${new Date(d.savedAt).toLocaleString()}`; content.append(title, note); button.append(icon('grid'), content);
        button.onclick = () => { try { loadDocument(d.document, 'Saved draft opened.', true); closeDialog(); } catch (error) { notice(error.message, true); } }; body.append(button);
      });
    });
  }
  function renderCloudControls() {
    const available = cloud?.isConfigured?.() === true;
    for (const id of ['cloud-divider', 'cloud-save', 'cloud-open', 'cloud-freeze', 'cloud-versions']) $(id).hidden = !available;
    for (const id of ['cloud-save', 'cloud-open', 'cloud-freeze', 'cloud-versions']) $(id).disabled = cloudBusy;
  }
  function adoptCloudLevel(level, expectedDocument, epoch) {
    if (!level || level.id !== expectedDocument.id || !Number.isSafeInteger(level.revision) || level.revision < 1 || !level.document) {
      throw new Error('The cloud response could not be verified. Open the cloud draft before saving again.');
    }
    if (epoch === documentEpoch && state.doc.id === level.id) {
      cloudBinding = { id: level.id, revision: level.revision, publishedVersion: level.publishedVersion, status: level.status, savedDocument: stableJSON(level.document) };
    }
  }
  function cloudError(error) {
    const errors = issues(error?.detail?.errors);
    if (errors.length) dialog('Cloud level check', body => {
      paragraph(body, error.message || 'The server could not accept this level.');
      const ul = document.createElement('ul'); errors.forEach(message => { const li = document.createElement('li'); li.className = 'validation-error'; li.textContent = message; ul.append(li); }); body.append(ul);
    });
    else notice(error?.message || 'Cloud storage is unavailable. Your device draft is still available.', true);
  }
  async function saveCloudDraft() {
    if (cloudBusy || !cloud?.isConfigured?.()) return;
    const check = validate(false); if (!check.ok) return notice(issues(check.errors)[0] || 'Resolve the level errors before saving.', true);
    const submitted = clone(state.doc), epoch = documentEpoch;
    const knownRevision = cloudBinding?.id === submitted.id ? cloudBinding.revision : null;
    cloudBusy = true; renderCloudControls(); $('status-message').textContent = 'Saving cloud draft…';
    try {
      // First saves always create. Never fetch a revision to overwrite an unloaded draft.
      const result = knownRevision === null ? await cloud.create(submitted) : await cloud.save(submitted.id, submitted, knownRevision);
      adoptCloudLevel(result.level, submitted, epoch);
      const stillOpen = epoch === documentEpoch && state.doc.id === submitted.id;
      if (!stillOpen) notice(`“${submitted.title}” was saved to cloud revision ${result.level.revision}. Your open level was not changed.`);
      else if (stableJSON(state.doc) !== stableJSON(submitted)) notice(`Cloud revision ${result.level.revision} saved. Newer local edits remain unsaved to the cloud.`);
      else notice(`Cloud draft saved at revision ${result.level.revision}.`);
    } catch (error) { cloudError(error); }
    finally { cloudBusy = false; renderCloudControls(); }
  }
  async function freezeCloudVersion() {
    if (cloudBusy || !cloud?.isConfigured?.()) return;
    if (!cloudBinding || cloudBinding.id !== state.doc.id) return notice('Save this level as a cloud draft before freezing a playable version.');
    if (stableJSON(state.doc) !== cloudBinding.savedDocument) return notice('Save your current changes to the cloud draft first, then freeze the version.');
    const check = validate(true); if (!check.ok) return checkDialog();
    const submitted = clone(state.doc), epoch = documentEpoch, knownRevision = cloudBinding.revision;
    cloudBusy = true; renderCloudControls(); $('status-message').textContent = 'Freezing a private playable version…';
    try {
      const result = await cloud.freeze(submitted.id, knownRevision);
      adoptCloudLevel(result.level, submitted, epoch);
      const version = result.level.publishedVersion;
      if (!Number.isSafeInteger(version) || version < 1) throw new Error('The version response could not be verified. Open the cloud draft to check its saved versions.');
      const stillOpen = epoch === documentEpoch && state.doc.id === submitted.id;
      if (!stillOpen) notice(`“${submitted.title}” was frozen privately as version ${version}. Your open level was not changed.`);
      else if (stableJSON(state.doc) !== stableJSON(submitted)) notice(`Private version ${version} frozen. Newer local edits are not included in that version.`);
      else notice(`Playable version ${version} frozen privately. This does not publish the game to the public.`);
    } catch (error) { cloudError(error); }
    finally { cloudBusy = false; renderCloudControls(); }
  }
  async function openCloudDrafts() {
    if (cloudBusy || !cloud?.isConfigured?.()) return;
    dialog('Cloud drafts', body => paragraph(body, 'Loading your saved levels…'));
    const generation = dialogGeneration, entries = new Set();
    let nextOffset = 0, listContainer, moreButton;
    const activeDialog = () => $('forge-dialog').open && dialogGeneration === generation;
    const loadPage = async first => {
      if (cloudBusy) return;
      cloudBusy = true; renderCloudControls(); if (moreButton) moreButton.disabled = true;
      try {
        const result = await cloud.list({ offset: nextOffset, limit: 50 });
        if (!Array.isArray(result.levels)) throw new Error('The cloud draft list could not be read. Try again.');
        if (!activeDialog()) return;
        if (first) {
          $('dialog-body').replaceChildren(); paragraph($('dialog-body'), 'Choose a cloud draft to continue editing. Your current editor state remains available with Undo.');
          listContainer = document.createElement('div'); $('dialog-body').append(listContainer);
        }
        for (const level of result.levels) {
          if (!level?.id || entries.has(level.id) || level.status === 'archived') continue;
          entries.add(level.id);
          const button = document.createElement('button'); button.className = 'draft-row';
          const content = document.createElement('div'), title = document.createElement('strong'), meta = document.createElement('small');
          title.textContent = level.title || level.id;
          meta.textContent = `Revision ${level.revision}${level.publishedVersion ? ` · Frozen v${level.publishedVersion}` : ''}${level.updatedAt ? ` · ${new Date(level.updatedAt).toLocaleDateString()}` : ''}`;
          content.append(title, meta); button.append(icon('grid'), content);
          button.onclick = async () => {
            if (cloudBusy) return;
            cloudBusy = true; renderCloudControls(); button.disabled = true; meta.textContent = 'Opening cloud draft…';
            try {
              const response = await cloud.get(level.id);
              if (!activeDialog()) return;
              const full = response.level;
              if (!full?.document || full.id !== level.id || !Number.isSafeInteger(full.revision) || full.revision < 1) throw new Error('The cloud draft response could not be verified.');
              loadDocument(full.document, null, true);
              adoptCloudLevel(full, full.document, documentEpoch);
              closeDialog(); notice(`Cloud draft opened at revision ${full.revision}.`);
            } catch (error) { cloudError(error); }
            finally { cloudBusy = false; button.disabled = false; renderCloudControls(); }
          };
          listContainer.append(button);
        }
        nextOffset = Number.isSafeInteger(result.nextOffset) && result.nextOffset >= 0 ? result.nextOffset : null;
        moreButton?.remove(); moreButton = null;
        if (!entries.size && nextOffset === null) paragraph(listContainer, 'No active cloud drafts yet. Save this level using Save cloud draft.');
        if (nextOffset !== null) { moreButton = document.createElement('button'); moreButton.className = 'button'; moreButton.textContent = 'Load more drafts'; moreButton.onclick = () => loadPage(false); $('dialog-body').append(moreButton); }
      } catch (error) {
        if (activeDialog()) { $('dialog-body').replaceChildren(); paragraph($('dialog-body'), error.message || 'The cloud drafts could not be loaded.'); }
      } finally { cloudBusy = false; renderCloudControls(); if (moreButton) moreButton.disabled = false; }
    };
    await loadPage(true);
  }
  async function openCloudVersions() {
    if (cloudBusy || !cloud?.isConfigured?.()) return;
    if (!cloudBinding || cloudBinding.id !== state.doc.id) return notice('Open or save a cloud draft before viewing its frozen versions.');
    const id = cloudBinding.id;
    dialog('Frozen versions', body => paragraph(body, 'Loading private playable versions…'));
    const generation = dialogGeneration;
    cloudBusy = true; renderCloudControls();
    try {
      const result = await cloud.versions(id);
      if (!$('forge-dialog').open || generation !== dialogGeneration) return;
      if (!Array.isArray(result.versions)) throw new Error('The saved version list could not be read.');
      $('dialog-body').replaceChildren(); paragraph($('dialog-body'), 'Frozen versions remain unchanged. Open a version as a new draft to build on it.');
      if (!result.versions.length) paragraph($('dialog-body'), 'This level has no frozen versions yet. Save the cloud draft, then choose Freeze playable version.');
      for (const version of result.versions) {
        if (!Number.isSafeInteger(version.version) || version.version < 1) continue;
        const button = document.createElement('button'); button.className = 'draft-row';
        const content = document.createElement('div'), title = document.createElement('strong'), meta = document.createElement('small');
        title.textContent = `Version ${version.version} · Open as new draft`;
        meta.textContent = `Source revision ${version.source_revision}${version.created_at ? ` · ${new Date(version.created_at).toLocaleString()}` : ''}`;
        content.append(title, meta); button.append(icon('copy'), content);
        button.onclick = async () => {
          if (cloudBusy) return;
          cloudBusy = true; renderCloudControls(); button.disabled = true;
          try {
            const response = await cloud.version(id, version.version);
            if (!$('forge-dialog').open || generation !== dialogGeneration) return;
            if (!response.version?.document) throw new Error('The saved version could not be read.');
            const copy = clone(response.version.document); copy.id = uid('level'); copy.title = `${copy.title} / v${version.version} copy`.slice(0, 80);
            loadDocument(copy, null, true); closeDialog(); notice(`Version ${version.version} opened as a new draft. The frozen original is unchanged.`);
          } catch (error) { cloudError(error); }
          finally { cloudBusy = false; button.disabled = false; renderCloudControls(); }
        };
        $('dialog-body').append(button);
      }
    } catch (error) {
      if ($('forge-dialog').open && generation === dialogGeneration) { $('dialog-body').replaceChildren(); paragraph($('dialog-body'), error.message || 'The versions could not be loaded.'); }
    } finally { cloudBusy = false; renderCloudControls(); }
  }
  function helpDialog() {
    dialog('Build, inspect, test', body => {
      paragraph(body, 'Drag an asset from the library into the battlefield. On a phone, select the asset and tap a location. The selected asset stays active so you can place several copies.');
      paragraph(body, 'Drag an object to move it, or select Move and tap its destination. Use the Inspector for exact X/Y coordinates, elevation, scale, and quarter-turn rotation.');
      paragraph(body, 'Drag empty ground to orbit. Use two fingers to pan or pinch to zoom. Top switches to an overhead planning view. Tap the sector map to focus a coordinate.');
      paragraph(body, 'Mission tools place the E, R, T and hostile deployment markers. The relay stays at (0, 0). Use Link to connect a ground cell with a supported roof, then inspect the movement cost.');
      paragraph(body, 'V Select · G Move · R Rotate · Delete Remove · Ctrl/⌘ D Copy · Ctrl/⌘ Z Undo · Ctrl/⌘ Shift Z Redo · Escape Finish placement.');
      paragraph(body, 'Save draft keeps your work on this device. Export produces a reusable level file. Play test opens your level in the PRIM3 game itself (the canonical rules, on 3.54 m tiles); its settings link back here.');
    });
  }
  function bindUI() {
    document.querySelectorAll('.mobile-tabs button').forEach(b => b.onclick = () => setPanel(b.dataset.panel));
    document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
    $('desktop-objects').onclick = () => setPanel($('forge').dataset.panel === 'objects' ? 'assets' : 'objects');
    $('cancel-placement').onclick = () => setTool('select');
    $('deselect').onclick = () => { select(null); setTool('select'); };
    $('asset-search').addEventListener('input', () => { state.search = $('asset-search').value.trim().toLowerCase(); renderAssets(); });
    $('scene-filter').onchange = renderObjects;
    $('undo').onclick = () => history('undo'); $('redo').onclick = () => history('redo');
    $('view-3d').onclick = () => setView('3d'); $('view-top').onclick = () => setView('top');
    $('fit-scene').onclick = () => { renderer.overview(); setView('3d'); };
    $('zoom-in').onclick = () => renderer.zoom(1.2); $('zoom-out').onclick = () => renderer.zoom(1 / 1.2);
    $('sector-toggle').onclick = () => { const expanded = $('sector').classList.toggle('expanded'); $('sector-toggle').setAttribute('aria-expanded', String(expanded)); $('sector-toggle').setAttribute('aria-label', expanded ? 'Reduce sector map' : 'Enlarge sector map'); };
    $('sector-map').addEventListener('click', event => {
      const rect = event.currentTarget.getBoundingClientRect(), c = $('sector-map'), b = bounds(), x = (event.clientX - rect.left) / rect.width * c.width, y = (event.clientY - rect.top) / rect.height * c.height;
      if (x < 54 || x > c.width - 16 || y < 42 || y > c.height - 18) return;
      const node = { kind: 'tile', x: Math.min(b.maxX, Math.floor(b.minX + (x - 54) / (c.width - 70) * (b.maxX - b.minX + 1))), y: Math.min(b.maxY, Math.floor(b.minY + (c.height - 18 - y) / (c.height - 60) * (b.maxY - b.minY + 1))), layer: 0 };
      if (state.tool === 'select') renderer.focus(node); else handlePick(node);
    });
    $('rotate-selection').onclick = rotateSelection; $('duplicate-selection').onclick = duplicateSelection; $('delete-selection').onclick = deleteSelection;
    $('inspector-form').onsubmit = event => {
      event.preventDefault(); const item = getSelected(), kind = state.selected?.kind; if (!item) return;
      change(() => {
        if (kind !== 'connection') { item.x = Number($('inspector-x').value); item.y = Number($('inspector-y').value); }
        if (kind === 'object') { item.elevation = Number($('inspector-elevation').value); item.scale = Number($('inspector-scale').value); item.rotation = Number($('inspector-rotation').value); }
        if (kind === 'spawn') item.layer = Number($('inspector-layer').value);
        if (kind === 'extraction') item.radius = Number($('inspector-radius').value);
        if (kind === 'connection') item.cost = Number($('inspector-cost').value);
      }, 'Changes applied.');
    };
    $('level-title').addEventListener('change', () => { const title = $('level-title').value.trim(); if (!title) { $('level-title').value = state.doc.title; return; } if (title !== state.doc.title) change(doc => { doc.title = title; }, null); });
    $('save-draft').onclick = () => saveDraft(true); $('test-level').onclick = testLevel;
    $('more-menu').onclick = () => { const hidden = !$('level-menu').hidden; $('level-menu').hidden = hidden; $('more-menu').setAttribute('aria-expanded', String(!hidden)); };
    document.addEventListener('click', event => { if (!event.target.closest('.top-actions')) closeMenu(); });
    for (const [id, fn] of [['new-level', () => confirmNew(false)], ['starter-level', () => confirmNew(true)], ['open-drafts', openDrafts], ['export-level', exportLevel], ['import-level', () => $('import-file').click()], ['check-level', checkDialog], ['help-button', helpDialog]]) $(id).onclick = () => { closeMenu(); fn(); };
    for (const [id, fn] of [['cloud-save', saveCloudDraft], ['cloud-open', openCloudDrafts], ['cloud-freeze', freezeCloudVersion], ['cloud-versions', openCloudVersions]]) $(id).onclick = () => { closeMenu(); fn(); };
    $('validation-open').onclick = checkDialog; $('dialog-close').onclick = closeDialog;
    $('import-file').onchange = async () => {
      const file = $('import-file').files[0]; $('import-file').value = ''; if (!file) return;
      if (file.size > 2 * 1024 * 1024) return notice('This level file is too large. The limit is 2 MB.', true);
      try { const documentValue = JSON.parse(await file.text()); loadDocument(documentValue, 'Level imported. Your previous level is available with Undo.', true); }
      catch (error) { notice(`Could not import: ${error.message || 'Invalid level JSON.'}`, true); }
    };
    document.addEventListener('keydown', event => {
      const editing = /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable;
      if (event.key === 'Escape') { closeMenu(); if (!$('forge-dialog').open) { setTool('select'); $('sector').classList.remove('expanded'); $('sector-toggle').setAttribute('aria-expanded', 'false'); } return; }
      if (editing || $('forge-dialog').open) return;
      const key = event.key.toLowerCase(), mod = event.ctrlKey || event.metaKey;
      if (mod && key === 'z') { event.preventDefault(); history(event.shiftKey ? 'redo' : 'undo'); }
      else if (mod && key === 'y') { event.preventDefault(); history('redo'); }
      else if (mod && key === 'd') { event.preventDefault(); duplicateSelection(); }
      else if (mod && key === 's') { event.preventDefault(); saveDraft(true); }
      else if (!mod && key === 'v') setTool('select');
      else if (!mod && key === 'g') setTool('move');
      else if (!mod && key === 'r') rotateSelection();
      else if (!mod && (key === 'delete' || key === 'backspace')) { event.preventDefault(); deleteSelection(); }
    });
    window.addEventListener('pagehide', () => { if (state.doc) saveDraft(false); });
  }
  function setView(view) { renderer.setView(view); $('view-3d').classList.toggle('active', view === '3d'); $('view-top').classList.toggle('active', view === 'top'); $('view-3d').setAttribute('aria-pressed', String(view === '3d')); $('view-top').setAttribute('aria-pressed', String(view === 'top')); }
  function closeMenu() { $('level-menu').hidden = true; $('more-menu').setAttribute('aria-expanded', 'false'); }
  async function start() {
    try {
      if (!model || !window.P3Renderer) throw new Error('The editor files did not finish loading. Reload this page to try again.');
      if (model.ready) await model.ready;
      catalog = model.catalog?.assets || []; assetMap = new Map(catalog.map(a => [a.id, a]));
      if (!catalog.length) throw new Error('The asset catalog is unavailable. Reload this page to try again.');
      state.doc = model.createStarter();
      try { const saved = JSON.parse(localStorage.getItem(LOCAL_ACTIVE) || 'null'); if (saved?.document && model.validate(saved.document, { playable: false }).ok) { state.doc = saved.document; state.savedAt = saved.savedAt; $('save-status').textContent = 'Restored on this device'; } } catch (_) {}
      state.doc.objects ||= []; state.doc.spawns ||= []; state.doc.connections ||= [];
      bindUI(); renderAssets(); synchronizeWorld(false); renderAll();
      window.PRIM3Forge = {
        getDocument: () => clone(state.doc),
        loadDocument: value => loadDocument(value, 'Level loaded.'),
        validate: () => validate(true),
        saveDraft: () => saveDraft(true),
        getRenderer: () => renderer,
        selectAsset: id => { if (assetMap.has(id) || missionTools.some(a => a.id === id)) setTool('place', id); },
        check: checkDialog
      };
    } catch (error) {
      $('initializing').replaceChildren(); const heading = document.createElement('p'); heading.textContent = error.message || 'The editor could not be initialized.'; heading.style.maxWidth = '290px'; heading.style.lineHeight = '1.6'; heading.style.textAlign = 'center'; $('initializing').append(heading); notice(error.message, true); console.error('PRIM3 Level Forge initialization:', error);
    }
  }
  start();
})();
