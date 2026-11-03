/* PRIM3 tactical board — phone-first preview (review branch; not public canon).

   Same engine, same rules: js/prim3-tactics/tactical-resolver.mjs + tactical-hints.mjs are exact copies
   of mcclusterishere/Prim3 (SOURCE.json). Nothing here changes a rule.

   Play: tap a squad member ON THE BOARD → a small menu offers only what is legal right now. Move/Dash
   show the reachable tiles (path-checked over known walls); tap a tile to PREVIEW (path, steps, AP, who
   could shoot you there), then Confirm or Back. Fire shows the engine's hit chance first; Confirm rolls.
   Nothing is spent until Confirm. "Get hint" is optional and never acts; a challenge about the previewed
   tile draws its own math on the board (origin, target, the x run and the y run).
   Coordinates are the engine's: x grows left→right (columns), y grows top→bottom (rows; the engine's
   south is +y). Progress is saved in this browser for this preview player; hint sessions are never
   saved (a restored board makes any old hint stale by design). */
import { createState, beginPlayerPhase, beginThreatPhase, resolveClockStatePhase, moveUnit, fireWeapon,
  enterOverwatch, hunkerDown, reload, shotPreview } from './tactical-resolver.mjs';
import { openHint, answerHint, revealAnswer, playerProjection, knownPaths } from './tactical-hints.mjs';

const BIND = { tenantId: 'preview', playerId: 'you', missionId: 'TR02-PREVIEW' };
const SAVE_KEY = 'prim3.tactics.preview.v1:' + BIND.tenantId + ':' + BIND.playerId + ':' + BIND.missionId;
const W = 10, H = 10;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ROLE_NAME = { E: 'Entry', R: 'Recon', T: 'Technical' };
const MISSION = 'Secure the relay';
// 3D by default where WebGL exists; ?view=2d (or the toggle) shows the flat grid, which is also the
// accessible view: every tile is a labelled button.
let mode3d = new URLSearchParams(location.search).get('view') !== '2d';
let board3d = null, loading3d = null;
// Graphics: ?fx=high|mid|low, or the menu's Graphics choice (kept in this browser); otherwise chosen
// from the GPU. It never changes the game.
const PARAMS = new URLSearchParams(location.search);
const GFX_KEY = 'prim3.tactics.preview.gfx';
const GFX = ['auto', 'high', 'mid', 'low'], GFX_NAME = { auto: 'Automatic', high: 'High', mid: 'Balanced', low: 'Battery saver' };
let gfx = (() => { try { const v = localStorage.getItem(GFX_KEY); return GFX.includes(v) ? v : 'auto'; } catch (e) { return 'auto'; } })();
const fxChoice = () => PARAMS.get('fx') || (gfx === 'auto' ? null : gfx);
// The main menu opens first (?menu=0 skips it); the battlefield's 3D loads only once it closes.
let menuOpen = PARAMS.get('menu') !== '0';
let menu3d = null, menuLoading = null, menuSel = null, menuBusy = false;
function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}
// three.js is loaded only when the 3D view is used; if it cannot load (offline, blocked CDN) the
// game falls back to the 2D grid, which plays exactly the same.
function ensure3d() {
  if (board3d || loading3d) return;
  loading3d = import('./board3d.mjs').then((mod) => {
    board3d = mod.createBoard3D($('tac3d'), { width: W, height: H, reducedMotion: REDUCED, fx: fxChoice(), onTap: (x, y) => onBoardTap(x, y), onView: () => placeMenu() });
    loading3d = null; render(); syncZoom3d();
  }).catch(() => { loading3d = null; mode3d = false; ui.toast = 'The 3D view could not load here, so the board is shown as a 2D grid.'; render(); });
}

function fresh() {
  return beginPlayerPhase(createState({
    width: W, height: H, floors: 1,
    units: [
      { id: 'E1', faction: 'PLAYER', role: 'E', x: 1, y: 2, moveRange: 4, detectionRadius: 6, aim: 75, ammo: 4, magazineSize: 4 },
      { id: 'R1', faction: 'PLAYER', role: 'R', x: 0, y: 4, moveRange: 5, detectionRadius: 7, aim: 70, ammo: 3, magazineSize: 4 },
      { id: 'T1', faction: 'PLAYER', role: 'T', x: 1, y: 5, moveRange: 4, detectionRadius: 5, aim: 65, ammo: 4, magazineSize: 4 },
      { id: 'H1', faction: 'THREAT', x: 7, y: 2, aim: 70, detectionRadius: 3 },
      { id: 'H2', faction: 'THREAT', x: 9, y: 9, aim: 70, detectionRadius: 3 } // unseen: never drawn, never used by hints
    ],
    cover: [
      { x: 4, y: 2, type: 'HIGH', sides: ['E'] }, { x: 4, y: 3, type: 'LOW', sides: ['E'] },
      { x: 3, y: 6, type: 'LOW', sides: ['E', 'N'] }, { x: 6, y: 5, type: 'HIGH', sides: ['N'] }
    ],
    blockers: [{ x: 5, y: 4 }, { x: 5, y: 5 }, { x: 8, y: 8 }, { x: 8, y: 9 }, { x: 9, y: 8 }],
    objectives: [{ id: 'NODE', required: true }],
    battlefield: { objectiveTiles: [{ id: 'NODE', x: 7, y: 6 }] }
  }));
}

/* ---------- saved progress (this browser, this preview player) ---------- */
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || saved.v !== 1 || !saved.state || !Array.isArray(saved.state.units)) return null;
    return saved.state;
  } catch (e) { return null; }
}
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, at: Date.now(), state })); } catch (e) {} }
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

let state = load() || fresh();
let ui = { selected: 'E1', menu: false, mode: null, preview: null, hint: null, session: null, suggestion: null, toast: '' };
let zoom = { s: 1, tx: 0, ty: 0 };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const view = () => playerProjection(state);
const unitOf = (id) => state.units.find((u) => u.id === id);

/* ---------- legality (only what the engine would accept right now) ---------- */
function legalActions(u) {
  if (!u || u.faction !== 'PLAYER' || state.phase !== 'PLAYER' || u.dead || u.downed) return [];
  const out = [];
  if (u.ap >= 1) out.push({ id: 'move', label: 'Move', sub: '1 AP' });
  if (u.ap >= 2) out.push({ id: 'dash', label: 'Dash', sub: '2 AP · double range' });
  if (u.ap >= 1) for (const e of view().units.filter((x) => x.faction !== 'PLAYER' && !x.dead)) {
    const pv = shotPreview(state, u.id, e.id);
    if (pv.legal) out.push({ id: 'fire:' + e.id, label: 'Fire ' + e.id, sub: pv.hitChance + '% · 1 AP' });
  }
  if (u.ap >= 1 && u.ammo < u.magazineSize && u.reserveAmmo > 0) out.push({ id: 'reload', label: 'Reload', sub: '1 AP' });
  if (u.ap >= 1 && !u.overwatch) out.push({ id: 'overwatch', label: 'Overwatch', sub: '1 AP' });
  if (u.ap >= 1 && !u.hunkered) out.push({ id: 'hunker', label: 'Hunker', sub: '1 AP' });
  out.push({ id: 'inspect', label: 'Inspect', sub: '' });
  out.push({ id: 'hint', label: 'Get hint', sub: 'optional' });
  return out;
}

function reach(u, dash) {
  const p = view();
  const pu = p.units.find((x) => x.id === u.id);
  pu.moveRange = u.moveRange * (dash ? 2 : 1);
  return knownPaths(p, u.id);
}

/* ---------- rendering ---------- */
function render() {
  const p = view(), sel = unitOf(ui.selected);
  const board = $('tacBoard');
  const reachInfo = ui.mode === 'move' || ui.mode === 'dash' ? reach(sel, ui.mode === 'dash') : null;
  const geo = ui.hint && ui.hint.geometry;
  const runs = geo ? traceRuns(geo, ui.hint.stage) : new Map();
  const path = ui.preview && ui.preview.kind === 'move' ? new Set(ui.preview.path.map((c) => c.x + ':' + c.y)) : new Set();
  let html = '<div class="tb-corner" aria-hidden="true">y\\x</div>';
  for (let x = 0; x < W; x += 1) html += `<div class="tb-axis tb-axis--x${geo && (x === geo.origin.x || x === geo.target.x) ? ' is-key' : ''}" aria-hidden="true">${x}</div>`;
  for (let y = 0; y < H; y += 1) {
    html += `<div class="tb-axis tb-axis--y${geo && (y === geo.origin.y || y === geo.target.y) ? ' is-key' : ''}" aria-hidden="true">${y}</div>`;
    for (let x = 0; x < W; x += 1) {
      const k = x + ':' + y;
      const wall = p.blockers.some((b) => b.x === x && b.y === y);
      const cover = p.cover.find((c) => c.x === x && c.y === y);
      const obj = p.objectiveTiles.find((t) => t.x === x && t.y === y);
      const unit = p.units.find((u) => u.x === x && u.y === y && !u.dead);
      const cls = ['tb-cell'];
      const words = [`x ${x}, y ${y}`];
      if (wall) { cls.push('is-wall'); words.push('wall'); }
      if (cover) { cls.push('has-cover'); words.push(`${cover.type.toLowerCase()} cover on the ${cover.sides.map(sideWord).join(' and ')} side`); }
      if (obj) { cls.push('is-obj'); words.push('objective'); }
      const steps = reachInfo && reachInfo.dist.get(reachInfo.key(x, y));
      if (steps !== undefined && steps > 0 && !unit && !wall) { cls.push('is-reach'); words.push(`reachable in ${steps} step${steps === 1 ? '' : 's'}`); }
      if (path.has(k)) cls.push('is-path');
      if (ui.preview && ui.preview.kind === 'move' && ui.preview.x === x && ui.preview.y === y) { cls.push('is-dest'); words.push('previewed destination'); }
      if (ui.suggestion && ui.suggestion.x === x && ui.suggestion.y === y) { cls.push('is-hint'); words.push('hint suggestion'); }
      if (geo && geo.origin.x === x && geo.origin.y === y) { cls.push('is-origin'); words.push('challenge origin'); }
      if (geo && geo.target.x === x && geo.target.y === y) { cls.push('is-target'); words.push('challenge target'); }
      const run = runs.get(k); if (run) { cls.push('run-' + run); }
      let inner = '';
      if (cover) inner += cover.sides.map((s) => `<i class="tb-cover tb-cover--${s} tb-cover--${cover.type.toLowerCase()}"></i>`).join('');
      if (obj) inner += '<i class="tb-obj"></i>';
      if (unit) {
        const ally = unit.faction === 'PLAYER';
        words.push(ally ? `squad ${unit.id}, field ${unit.role}, ${unit.ap} AP, ${unit.hp} HP` : `known hostile ${unit.id}`);
        inner += `<span class="tb-unit ${ally ? 'tb-unit--ally tb-role-' + unit.role : 'tb-unit--hostile'}${unit.id === ui.selected ? ' is-sel' : ''}">` +
          `<b>${ally ? unit.role : '!'}</b>${ally ? `<small class="tb-ap">${'●'.repeat(unit.ap)}${'○'.repeat(Math.max(0, unit.maxAp - unit.ap))}</small>` : ''}</span>`;
      }
      if (run && ui.hint && ui.hint.stage >= 1) inner += `<em class="tb-step">${runs.get(k + ':n') || ''}</em>`;
      html += `<button type="button" class="${cls.join(' ')}" data-x="${x}" data-y="${y}" aria-label="${esc(words.join(', '))}"${wall ? ' aria-disabled="true"' : ''}>${inner}</button>`;
    }
  }
  board.innerHTML = html;
  applyZoom();
  // 3D view: same model, drawn in the courtyard
  $('tacViewport').classList.toggle('is-3d', mode3d && !!board3d);
  if (mode3d && !webglAvailable()) mode3d = false;
  if (mode3d && !board3d && !menuOpen) ensure3d();
  if (mode3d && board3d) {
    const m = { units: p.units, blockers: p.blockers, cover: p.cover, objectiveTiles: p.objectiveTiles, selected: ui.selected, labels: [] };
    if (reachInfo) { m.reach = []; for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) { const st = reachInfo.dist.get(reachInfo.key(x, y)); if (st !== undefined && st > 0) m.reach.push({ x, y }); } }
    if (ui.preview && ui.preview.kind === 'move') { m.path = ui.preview.path.slice(0, -1); m.dest = { x: ui.preview.x, y: ui.preview.y }; m.pathLine = [{ x: sel.x, y: sel.y }, ...ui.preview.path]; }
    if (ui.suggestion) m.hint = { x: ui.suggestion.x, y: ui.suggestion.y };
    if (geo) {
      m.origin = geo.origin; m.target = geo.target;
      m.runs = [...runs.entries()].filter(([k]) => k.split(':').length === 2).map(([k, a]) => { const [x, y] = k.split(':').map(Number); return { x, y, axis: a }; });
      m.labels.push({ x: geo.origin.x, y: geo.origin.y, h: 0, kind: 'origin', text: `Origin (${geo.origin.x}, ${geo.origin.y})` });
      m.labels.push({ x: geo.target.x, y: geo.target.y, h: 0, kind: 'target', text: `Target (${geo.target.x}, ${geo.target.y})` });
      for (const [k, v] of runs) { const parts = k.split(':'); if (parts.length === 3) m.labels.push({ x: +parts[0], y: +parts[1], h: 0.1, kind: 'step', text: v }); }
    }
    for (const u of p.units) if (!u.dead) m.labels.push({ x: u.x, y: u.y, h: 2.2, kind: u.faction === 'PLAYER' ? 'ally' : 'hostile', text: u.faction === 'PLAYER' ? u.role : esc(u.id) });
    for (const t of p.objectiveTiles) m.labels.push({ x: t.x, y: t.y, h: 1.75, kind: 'obj', text: `Relay (${t.x}, ${t.y})` });
    if (ui.preview && ui.preview.kind === 'move') {
      const cv = p.cover.find((c) => c.x === ui.preview.x && c.y === ui.preview.y);
      if (cv) m.labels.push({ x: ui.preview.x + 0.9, y: ui.preview.y, h: 0.3, kind: 'cover', text: `${cv.type === 'HIGH' ? 'High' : 'Low'} cover` });
    }
    for (let x = 0; x < W; x += 1) m.labels.push({ x, y: -0.95, h: 0, kind: 'axis', text: String(x) });
    for (let y = 0; y < H; y += 1) m.labels.push({ x: -0.95, y, h: 0, kind: 'axis', text: String(y) });
    m.labels.push({ x: -0.95, y: -0.95, h: 0, kind: 'axis', text: 'y\\x' });
    if (ui.lastMove) { m.moves = { [ui.lastMove.id]: ui.lastMove.path }; ui.lastMove = null; }
    board3d.update(m);
  }
  // HUD: turn + objective on top, the selected unit in the dock
  const obj = p.objectiveTiles[0];
  $('hudRound').textContent = `Turn ${String(state.round).padStart(2, '0')}`;
  $('hudPhase').textContent = state.phase === 'PLAYER' ? 'Your move' : state.phase;
  $('hudObj').textContent = obj ? `${MISSION} · (${obj.x}, ${obj.y})` : MISSION;
  $('hudUnit').innerHTML = sel ? `<span class="dock-token tb-role-${sel.role}">${sel.role}</span><span class="dock-name">${sel.role} · ${ROLE_NAME[sel.role] || ''}</span>` : 'Tap a squad member';
  $('hudAp').textContent = sel ? `${sel.ap} AP` : '';
  $('tacView').textContent = mode3d ? '2D grid' : '3D view';
  $('tacRotate').hidden = !(mode3d && board3d);
  $('tacView').setAttribute('aria-pressed', String(!mode3d));
  renderMenu(); renderSheet();
}

function sideWord(s) { return { N: 'north', E: 'east', S: 'south', W: 'west' }[s]; }

// The two runs of a Manhattan distance: x first along the origin's row, then y along the target's column.
function traceRuns(geo, stage) {
  const m = new Map(); let n = 0;
  if (stage >= 1) {
    const dir = Math.sign(geo.target.x - geo.origin.x);
    for (let x = geo.origin.x + dir, i = 1; dir && x !== geo.target.x + dir; x += dir, i += 1) { m.set(x + ':' + geo.origin.y, 'x'); m.set(x + ':' + geo.origin.y + ':n', 'x' + i); n = i; }
  }
  if (stage >= 2) {
    const dir = Math.sign(geo.target.y - geo.origin.y);
    for (let y = geo.origin.y + dir, i = 1; dir && y !== geo.target.y + dir; y += dir, i += 1) { m.set(geo.target.x + ':' + y, 'y'); m.set(geo.target.x + ':' + y + ':n', 'y' + i); }
  }
  return m;
}

function renderMenu() {
  const menu = $('tacMenu'), sel = unitOf(ui.selected);
  if (!ui.menu || !sel) { menu.hidden = true; return; }
  const acts = legalActions(sel);
  // floating 3D menu: Move / Fire / Inspect / Get hint first, the rest under More; the docked 2D menu shows all
  const floating = mode3d && !!board3d;
  const primary = floating ? acts.filter((a) => a.id === 'move' || a.id.startsWith('fire:') || a.id === 'inspect' || a.id === 'hint') : acts;
  const more = acts.filter((a) => !primary.includes(a));
  const btn = (a) => `<button type="button" class="tm-btn" data-act="${a.id}"><span>${esc(a.label)}</span>${a.sub ? `<small>${esc(a.sub)}</small>` : ''}</button>`;
  menu.innerHTML = `<p class="tm-head">${sel.id} · ${ROLE_NAME[sel.role] || ''} · ${sel.ap} AP</p>` + primary.map(btn).join('') +
    (more.length ? (ui.more ? more.map(btn).join('') : `<button type="button" class="tm-btn tm-btn--ghost" data-act="more"><span>More</span><small>${more.map((a) => a.label).join(' · ')}</small></button>`) : '') +
    `<button type="button" class="tm-btn tm-btn--ghost" data-act="close"><span>Close</span></button>`;
  menu.hidden = false;
  placeMenu();
}

// 3D: float the menu beside the operative, kept inside the board; re-run whenever the camera moves
function placeMenu() {
  const menu = $('tacMenu'), sel = unitOf(ui.selected);
  if (menu.hidden || !sel) return;
  if (!mode3d || !board3d) { menu.classList.remove('is-float'); menu.style.left = menu.style.top = ''; return; }
  menu.classList.add('is-float');
  const vp = $('tacViewport').getBoundingClientRect(), pt = board3d.screenOf(sel.x, sel.y, 1.0);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = pt.x - vp.left + 28; if (left + mw > vp.width - 6) left = pt.x - vp.left - mw - 28;
  left = Math.max(6, Math.min(vp.width - mw - 6, left));
  const top = Math.max(6, Math.min(vp.height - mh - 6, pt.y - vp.top - mh / 2));
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
}

function renderSheet() {
  const s = $('tacSheet');
  const sel = unitOf(ui.selected);
  let html = '';
  if (ui.preview && ui.preview.kind === 'move') {
    const pv = ui.preview;
    const cv = view().cover.find((c) => c.x === pv.x && c.y === pv.y);
    html = `<p class="ts-eye">${pv.dash ? 'Dash' : 'Move'} preview</p>
      <p class="ts-main">(${sel.x}, ${sel.y}) → <b>(${pv.x}, ${pv.y})</b> · ${pv.steps} step${pv.steps === 1 ? '' : 's'} · ${pv.dash ? 2 : 1} AP${cv ? ' · ' + (cv.type === 'HIGH' ? 'High' : 'Low') + ' cover' : ''} · ${Math.max(0, sel.ap - (pv.dash ? 2 : 1))} AP left</p>
      <p class="ts-sub">${pv.exposure.length ? 'Known hostiles with a shot there: ' + pv.exposure.map((e) => `${e.id} ${e.hit}%${e.cover !== 'NONE' ? ' (your ' + e.cover.toLowerCase() + ' cover)' : ''}`).join(', ') : 'No known hostile has a shot there.'}</p>
      <div class="ts-row"><button type="button" class="ts-btn ts-btn--go" data-sheet="confirm-move">Confirm ${pv.dash ? 'dash' : 'move'}</button><button type="button" class="ts-btn" data-sheet="back">Back</button></div>
      <button type="button" class="ts-link" data-sheet="practice">Optional: how far is that? (practice)</button>`;
  } else if (ui.preview && ui.preview.kind === 'fire') {
    const f = ui.preview;
    html = `<p class="ts-eye">Fire preview</p><p class="ts-main">${sel.id} → <b>${f.target}</b> · ${f.hit}% to hit · ${f.damage} damage${f.flanked ? ' · flanking' : ''}</p>
      <p class="ts-sub">Chance comes from the engine (aim, cover, range). The roll is random; nothing is guaranteed.</p>
      <div class="ts-row"><button type="button" class="ts-btn ts-btn--go" data-sheet="confirm-fire">Confirm fire</button><button type="button" class="ts-btn" data-sheet="back">Back</button></div>`;
  } else if (ui.hint) {
    const h = ui.hint;
    html = `<p class="ts-eye">Optional hint for ${esc(h.unitId)} · ${esc(h.field.toLowerCase())}</p>
      <p class="ts-q" id="tacQ">${esc(h.prompt)}</p>
      ${h.geometry ? `<p class="ts-sub">On the board: <span class="k-origin">origin</span> → <span class="k-target">target</span>. Tap <b>Trace</b> to walk the ${h.geometry.dx} x-steps, then the ${h.geometry.dy} y-steps.</p>` : ''}
      <form class="ts-form" id="tacForm"><label for="tacAns">Your answer</label><input id="tacAns" inputmode="decimal" autocomplete="off" maxlength="32" value="${esc(h.draft || '')}">
      <button type="submit" class="ts-btn ts-btn--go">Check</button></form>
      <p class="ts-sub" id="tacStep" role="status">${h.msg || ''}</p>
      <div class="ts-row">${h.geometry ? `<button type="button" class="ts-btn" data-sheet="trace">Trace</button>` : ''}${h.canReveal ? '<button type="button" class="ts-btn" data-sheet="reveal">Show worked answer</button>' : ''}</div>
      <button type="button" class="ts-link" data-sheet="close-hint">Continue playing</button>`;
  } else if (ui.result) {
    html = ui.result;
  } else if (ui.toast) {
    html = `<p class="ts-sub">${ui.toast}</p>`;
  }
  s.innerHTML = html; s.hidden = !html;
  const f = $('tacForm'); if (f) f.addEventListener('submit', onAnswer);
}

/* ---------- interaction ---------- */
function onBoardTap(x, y) {
  const ally = state.units.find((u) => u.faction === 'PLAYER' && !u.dead && u.x === x && u.y === y);
  if (ui.mode === 'move' || ui.mode === 'dash') {
    if (ally && ally.id === ui.selected) { ui.mode = null; ui.preview = null; ui.menu = true; render(); return; }
    const sel = unitOf(ui.selected), r = reach(sel, ui.mode === 'dash'), steps = r.dist.get(r.key(x, y));
    if (steps === undefined || steps === 0) { ui.toast = 'That tile is not reachable this action.'; ui.preview = null; render(); return; }
    const after = { ...state, units: state.units.map((u) => (u.id === sel.id ? { ...u, x, y } : u)) };
    const exposure = view().units.filter((u) => u.faction !== 'PLAYER' && !u.dead).map((e) => {
      const pv = shotPreview(after, e.id, sel.id); return pv.legal ? { id: e.id, hit: pv.hitChance, cover: pv.cover } : null; }).filter(Boolean);
    ui.preview = { kind: 'move', dash: ui.mode === 'dash', x, y, steps, path: r.pathTo(x, y), exposure };
    ui.toast = ''; render(); return;
  }
  if (ally) { ui.selected = ally.id; ui.menu = true; ui.preview = null; ui.mode = null; ui.result = ''; render(); return; }
  ui.menu = false; render();
}

function onMenu(act) {
  const sel = unitOf(ui.selected);
  ui.menu = false; ui.more = false; ui.result = ''; ui.toast = '';
  if (act === 'close') { ui.more = false; render(); return; }
  if (act === 'more') { ui.more = true; ui.menu = true; render(); return; }
  if (act === 'move' || act === 'dash') { ui.mode = act; ui.preview = null; ui.toast = `Tap a lit tile to preview the ${act}. Tap ${sel.id} again to cancel.`; render(); return; }
  if (act.startsWith('fire:')) {
    const id = act.slice(5), pv = shotPreview(state, sel.id, id);
    if (pv.legal) ui.preview = { kind: 'fire', target: id, hit: pv.hitChance, damage: pv.damage, flanked: pv.flanked };
    render(); return;
  }
  if (act === 'inspect') {
    ui.result = `<p class="ts-eye">Inspect ${sel.id}</p><p class="ts-sub">Field ${sel.role} · (${sel.x}, ${sel.y}) · HP ${sel.hp}/${sel.maxHp} · AP ${sel.ap}/${sel.maxAp} · move ${sel.moveRange} · aim ${sel.aim} · ammo ${sel.ammo}/${sel.magazineSize} (+${sel.reserveAmmo})${sel.overwatch ? ' · overwatch' : ''}${sel.hunkered ? ' · hunkered' : ''}</p>`;
    render(); return;
  }
  if (act === 'hint') { startHint(null); return; }
  try {
    if (act === 'reload') state = reload(state, sel.id);
    if (act === 'overwatch') state = enterOverwatch(state, sel.id);
    if (act === 'hunker') state = hunkerDown(state, sel.id);
    ui.toast = `${sel.id}: ${act} done.`; afterChange();
  } catch (e) { ui.toast = esc(e.message); render(); }
}

function onSheet(act) {
  const sel = unitOf(ui.selected);
  if (act === 'back') { ui.preview = null; render(); return; }
  if (act === 'confirm-move') {
    const pv = ui.preview;
    try { state = moveUnit(state, sel.id, { x: pv.x, y: pv.y, z: 0 }, pv.dash ? 'DASH' : 'MOVE'); ui.toast = `${sel.id} moved to (${pv.x}, ${pv.y}).`; ui.lastMove = { id: sel.id, path: pv.path }; }
    catch (e) { ui.toast = 'The move was refused: ' + esc(e.message) + '.'; }
    ui.mode = null; ui.preview = null; afterChange(); return;
  }
  if (act === 'confirm-fire') {
    const roll = new Uint8Array(2); crypto.getRandomValues(roll);
    try {
      const out = fireWeapon(state, sel.id, ui.preview.target, roll[0] % 100, roll[1] % 100);
      state = out.state;
      const tgt = state.units.find((u) => u.id === ui.preview.target);
      if (mode3d && board3d) board3d.fire(sel.id, ui.preview.target, { ...out.result, killed: !!(tgt && (tgt.dead || tgt.hp <= 0)) });
      ui.toast = out.result.hit ? `Hit ${ui.preview.target} for ${out.result.damage}${out.result.critical ? ' (critical)' : ''}.` : `Missed ${ui.preview.target}.`;
    } catch (e) { ui.toast = esc(e.message); }
    ui.preview = null; afterChange(); return;
  }
  if (act === 'practice') { const t = { x: ui.preview.x, y: ui.preview.y }; startHint(t); return; }
  if (act === 'trace') { ui.hint.stage = Math.min(2, (ui.hint.stage || 0) + 1); render(); return; }
  if (act === 'reveal') { const r = revealAnswer(ui.session); ui.session = r.session; ui.hint.msg = r.response.ok ? `${esc(r.response.explain)}. ${esc(r.response.note)} Enter it to unlock the hint.` : 'Keep trying first.'; render(); return; }
  if (act === 'close-hint') { ui.hint = null; ui.session = null; render(); return; }
}

function startHint(target) {
  try {
    const r = openHint(BIND, state, ui.selected, target ? { target } : {});
    ui.session = r.session; ui.suggestion = null;
    ui.more = false; ui.hint = { unitId: ui.selected, field: r.response.field, prompt: r.response.prompt, geometry: r.response.geometry, stage: 0, msg: '', canReveal: false, keepPreview: !!target };
    // the sheet shows the challenge; leave move mode so the board shows only the math (origin, target, runs)
    ui.preview = null; ui.mode = null; ui.menu = false;
    render();
    const a = $('tacAns'); if (a) a.focus({ preventScroll: true });
  } catch (e) { ui.toast = esc(e.message); render(); }
}

function onAnswer(e) {
  e.preventDefault();
  const value = $('tacAns').value;
  ui.hint.draft = value;
  const r = answerHint(ui.session, BIND, state, value);
  ui.session = r.session; const res = r.response;
  if (!res.ok) {
    if (res.code === 'STALE_BOARD') { ui.hint.msg = esc(res.message); render(); return; }
    // scaffolding: the step text AND the board trace advance together
    ui.hint.stage = Math.min(2, res.attempts);
    ui.hint.msg = (res.code === 'UNREADABLE' ? 'Type a number, a fraction like 3/4, or a decimal. ' : 'Not yet. ') + esc(res.nextStep || '');
    ui.hint.canReveal = !!res.canReveal;
    render(); return;
  }
  ui.suggestion = res.suggestion; ui.hint = null; ui.session = null;
  ui.result = `<p class="ts-eye">Hint for ${esc(ui.selected)}${res.masteryEvidence ? ' · counted toward mastery' : ''}</p>
    ${res.explain ? `<p class="ts-sub">Worked: ${esc(res.explain)}</p>` : ''}
    <ul class="ts-why">${res.why.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    <p class="ts-sub">The hint did not move ${esc(ui.selected)} or spend anything. The gold tile is a suggestion; play any move you like.</p>`;
  render();
}

function afterChange() {
  // any change to the board ends a pending hint (it would be stale anyway) and the suggestion
  ui.hint = null; ui.session = null; ui.suggestion = null; ui.result = '';
  save(); render();
}

function endTurn() {
  state = beginPlayerPhase(resolveClockStatePhase(beginThreatPhase(state)));
  ui = { ...ui, menu: false, mode: null, preview: null, toast: 'New round: every squad member has 2 AP again. (This preview has no hostile AI.)' };
  afterChange();
}

/* ---------- zoom & pan ---------- */
function applyZoom() {
  if (mode3d && board3d) return;
  const b = $('tacBoard'), vp = $('tacViewport');
  const max = (zoom.s - 1) * vp.clientWidth;
  zoom.tx = Math.min(0, Math.max(-max, zoom.tx)); zoom.ty = Math.min(0, Math.max(-max, zoom.ty));
  b.style.transform = `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.s})`;
  $('zoomOut').disabled = zoom.s <= 1; $('zoomIn').disabled = zoom.s >= 2.5;
}
function setZoom(s, cx, cy) {
  const vp = $('tacViewport').getBoundingClientRect();
  const px = cx == null ? vp.width / 2 : cx - vp.left, py = cy == null ? vp.height / 2 : cy - vp.top;
  const ns = Math.min(2.5, Math.max(1, s));
  zoom.tx = px - (px - zoom.tx) * (ns / zoom.s); zoom.ty = py - (py - zoom.ty) * (ns / zoom.s); zoom.s = ns;
  applyZoom(); renderMenu();
}
const pointers = new Map(); let pinch0 = null, pan0 = null, moved = false;
function bindGestures() {
  const vp = $('tacViewport');
  vp.addEventListener('pointerdown', (e) => {
    if (mode3d && board3d) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), s: zoom.s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; }
    else pan0 = { x: e.clientX, y: e.clientY, tx: zoom.tx, ty: zoom.ty };
  });
  vp.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinch0) { const [a, b] = [...pointers.values()]; setZoom(pinch0.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch0.d, pinch0.cx, pinch0.cy); moved = true; return; }
    if (pan0 && zoom.s > 1) { const dx = e.clientX - pan0.x, dy = e.clientY - pan0.y; if (Math.abs(dx) + Math.abs(dy) > 8) { moved = true; zoom.tx = pan0.tx + dx; zoom.ty = pan0.ty + dy; applyZoom(); renderMenu(); } }
  });
  const end = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch0 = null; if (!pointers.size) pan0 = null; };
  vp.addEventListener('pointerup', end); vp.addEventListener('pointercancel', end);
  vp.addEventListener('click', (e) => {
    if (mode3d && board3d) return; // the 3D canvas reports its own taps
    if (moved) { moved = false; return; } // a pan or pinch is never a tap
    const c = e.target.closest('.tb-cell'); if (!c || !$('tacBoard').contains(c)) return;
    onBoardTap(Number(c.dataset.x), Number(c.dataset.y));
  });
}

/* ---------- main menu ---------- */
function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
function menuOptions() {
  const saved = hasSave() && state.round >= 1;
  return [
    saved && { key: 'continue', label: 'Continue mission', sub: `Turn ${String(state.round).padStart(2, '0')} · saved in this browser`, go: 'Continue mission' },
    { key: 'new', label: saved ? 'New mission' : 'Deploy', sub: saved ? 'Secure the relay from the start (replaces your saved progress)' : 'Secure the relay · squad of three', go: saved ? 'Start a new mission' : 'Deploy' },
    { key: 'training', label: 'Training', sub: 'Optional grid-math hint on the live board; it never moves anyone', go: 'Start training' },
    { key: 'graphics', label: `Graphics: ${GFX_NAME[gfx]}`, sub: 'Tap again to change · Automatic, High, Balanced, Battery saver', go: saved ? 'Continue mission' : 'Deploy' }
  ].filter(Boolean);
}
function renderMainMenu() {
  const opts = menuOptions();
  if (!opts.some((o) => o.key === menuSel)) menuSel = opts[0].key;
  $('pmList').innerHTML = opts.map((o) => `<button type="button" class="pm-opt" data-pm="${o.key}" aria-pressed="${o.key === menuSel}">${esc(o.label)}<small>${esc(o.sub)}</small></button>`).join('');
  $('pmGo').textContent = opts.find((o) => o.key === menuSel).go;
  if (menu3d) menu3d.show(menuSel);
}
function openMainMenu() {
  menuOpen = true; ui.menu = false; ui.preview = null; ui.mode = null;
  if (board3d) board3d.setActive(false);
  document.querySelector('main.tac').classList.add('menu-open'); $('p3Menu').hidden = false;
  renderMainMenu();
  if (!menu3d && !menuLoading && webglAvailable()) {
    menuLoading = import('./menu3d.mjs').then((mod) => {
      menuLoading = null; if (!menuOpen) return;
      menu3d = mod.createMenu3D($('menu3d'), { reducedMotion: REDUCED }); menu3d.show(menuSel);
    }).catch(() => { menuLoading = null; $('menu3d').classList.add('no-3d'); });
  } else if (!webglAvailable()) $('menu3d').classList.add('no-3d');
  window.scrollTo(0, 0);
}
function closeMainMenu(action) {
  menuOpen = false; menuBusy = false;
  if (menu3d) { menu3d.destroy(); menu3d = null; }
  document.querySelector('main.tac').classList.remove('menu-open'); $('p3Menu').hidden = true;
  if (action === 'new') { clearSave(); state = fresh(); ui = { selected: 'E1', menu: false, mode: null, preview: null, hint: null, session: null, suggestion: null, toast: 'New mission. Secure the relay.' }; zoom = { s: 1, tx: 0, ty: 0 }; if (board3d) board3d.resetView(); save(); }
  if (board3d) board3d.setActive(true);
  render();
  if (action === 'training') { ui.selected = ui.selected || 'E1'; startHint(null); }
}
$('pmList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pm]'); if (!b || menuBusy) return;
  if (b.dataset.pm === 'graphics' && menuSel === 'graphics') {
    gfx = GFX[(GFX.indexOf(gfx) + 1) % GFX.length];
    try { localStorage.setItem(GFX_KEY, gfx); } catch (err) {}
    if (board3d) { board3d.destroy(); board3d = null; } // rebuilt at the new tier when the menu closes
  }
  menuSel = b.dataset.pm; renderMainMenu();
});
$('pmGo').addEventListener('click', () => {
  if (menuBusy) return;
  const action = menuSel === 'graphics' ? (hasSave() ? 'continue' : 'new') : menuSel;
  menuBusy = true;
  if (menu3d) menu3d.play(menuSel, () => closeMainMenu(action)); else closeMainMenu(action);
});
$('tacMenuOpen').addEventListener('click', openMainMenu);

/* ---------- wire up ---------- */
$('tacMenu').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) onMenu(b.dataset.act); });
$('tacSheet').addEventListener('click', (e) => { const b = e.target.closest('[data-sheet]'); if (b) onSheet(b.dataset.sheet); });
$('tacEnd').addEventListener('click', endTurn);
$('tacReset').addEventListener('click', () => { clearSave(); state = fresh(); ui = { selected: 'E1', menu: false, mode: null, preview: null, hint: null, session: null, suggestion: null, toast: 'New mission.' }; zoom = { s: 1, tx: 0, ty: 0 }; if (board3d) board3d.resetView(); render(); });
$('zoomIn').addEventListener('click', () => { if (mode3d && board3d) { board3d.zoom(1); syncZoom3d(); } else setZoom(zoom.s + 0.5); });
$('zoomOut').addEventListener('click', () => { if (mode3d && board3d) { board3d.zoom(-1); syncZoom3d(); } else setZoom(zoom.s - 0.5); });
function syncZoom3d() { if (!board3d) return; const z = board3d.canZoom(); $('zoomIn').disabled = !z.in; $('zoomOut').disabled = !z.out; renderMenu(); }
$('tacRotate').addEventListener('click', () => { if (board3d) board3d.rotate(1); });
$('tacView').addEventListener('click', () => { mode3d = !mode3d; ui.menu = false; render(); if (mode3d) syncZoom3d(); else applyZoom(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (ui.preview) ui.preview = null; else if (ui.mode) ui.mode = null; else ui.menu = false; render(); } });
if (REDUCED) document.documentElement.classList.add('reduce-motion');
bindGestures();
if (menuOpen) openMainMenu();
render();
window.__tac = { get state() { return state; }, get session() { return ui.session; }, get ui() { return ui; }, SAVE_KEY, get mode3d() { return mode3d && !!board3d; }, get loading3d() { return !!loading3d; }, screenOf: (x, y, h) => board3d && board3d.screenOf(x, y, h), zoomLevel: () => board3d && board3d.zoomLevel(), busy3d: () => !!(board3d && board3d.isAnimating()), get tier() { return board3d && board3d.tier; }, get menuOpen() { return menuOpen; }, get menuKey() { return menu3d && menu3d.key; }, get menuLaunching() { return !!(menu3d && menu3d.launching); }, get gfx() { return gfx; }, unitPosition: (id) => board3d && board3d.unitPosition(id) };
