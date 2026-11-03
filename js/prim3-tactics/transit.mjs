/* PRIM3 · Transit / Relay — the page (review branch; not public canon).

   Rules: js/prim3-tactics/tactical-resolver.mjs, tactical-hints.mjs and tactical-threat-ai.mjs are exact
   copies of mcclusterishere/Prim3 (SOURCE.json). This page never decides a rule. An action is offered
   only if the engine accepts it: legality is found by dry-running the engine's own pure functions on
   the current state (nothing is committed until Confirm). Hostiles act through the canonical threat AI.

   What the player sees is the engine's player projection (fog of war): unseen hostiles are never
   drawn, listed, animated or used for previews. */
import { createState, beginPlayerPhase, beginThreatPhase, resolveClockStatePhase, moveUnit, fireWeapon,
  enterOverwatch, hunkerDown, reload, shotPreview, stabilize, technicalAction, extractUnit, missionComplete, drawRolls, hasLineOfSight, gridDistance } from './tactical-resolver.mjs';
import { playerProjection, knownPaths } from './tactical-hints.mjs';
import { runThreatPhase } from './tactical-threat-ai.mjs';
import * as LEVEL from './levels/transit-relay.mjs';
import { operatorHeight } from './scale.mjs';
import { DATA_URL as WORLD_MISSIONS, DRAFT_KEY as WORLD_DRAFTS, findMission } from '../prim3-world/missions.mjs';

const { SCENE, W, H, toDisplay } = LEVEL;
const SAVE_KEY = 'prim3.transit.v1';
const LOOK_KEY = 'prim3.tactics.look';
const GFX_KEY = 'prim3.tactics.preview.gfx';
const PARAMS = new URLSearchParams(location.search);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ROLE = {
  E: { name: 'Entry', line: 'Protect the approach. Breach the service gate.', img: 'assets/img/prim3-operators/E-portrait.jpg' },
  R: { name: 'Recon', line: 'Overwatch. Longest sight and the scoped rifle.', img: 'assets/img/prim3-operators/R-portrait.jpg' },
  T: { name: 'Tech', line: 'Reach the relay and link it twice. Keep T alive.', img: 'assets/img/prim3-operators/T-portrait.jpg' }
};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const D = (x, y) => { const d = toDisplay(x, y); return `(${d.X}, ${d.Y})`; };
// Every roll comes from the engine's seeded generator, which is saved with the state: reloading the page
// cannot re-roll a shot, a reaction or a hostile turn.

/* ---------- state, save ---------- */
function fresh() { return beginPlayerPhase(createState(LEVEL.engineConfig({ seed: Number(PARAMS.get('seed')) || (Date.now() % 1e9) }))); }
function load() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); return s && s.v === 1 && s.state && Array.isArray(s.state.units) ? s.state : null; } catch (e) { return null; }
}
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, at: Date.now(), state, log: log.slice(-60) })); } catch (e) {} }
let state = (PARAMS.get('new') === '1' ? null : load()) || fresh();
let log = (() => { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); return (s && s.log) || []; } catch (e) { return []; } })();
let ui = { sel: 'T1', mode: null, preview: null, busy: false, mapOpen: false, setOpen: false, ended: null };
/* A World mission (prim3-world.html → ?mission=<id>&new=1) only dresses this level: its title, character and briefing go in
   the objective card and the first log line. Rules, map and saves are the level's own. An unknown id is ignored. */
const MISSION_ID = PARAMS.get('mission');
let MISSION = null;
if (MISSION_ID && PARAMS.get('new') === '1') log = []; // a fresh deploy starts a fresh log, as it starts a fresh state
const missionLine = (m) => `T01 · Mission: ${m.title} · ${m.character.name}. ${m.briefing}`;
// Day is the default (owner, 2026-11-02); Night ('field') and Studio stay selectable
const LOOKS = ['day', 'field', 'studio'];
let look = (() => { try { const v = localStorage.getItem(LOOK_KEY); return LOOKS.includes(v) ? v : 'day'; } catch (e) { return 'day'; } })();
if (LOOKS.includes(PARAMS.get('look'))) look = PARAMS.get('look');
const GRID_KEY = 'prim3.tactics.grid';
let gridOn = (() => { try { return localStorage.getItem(GRID_KEY) !== 'off'; } catch (e) { return true; } })();
let gfx = (() => { try { return localStorage.getItem(GFX_KEY) || 'auto'; } catch (e) { return 'auto'; } })();
document.documentElement.dataset.look = look;
if (REDUCED) document.documentElement.classList.add('reduce-motion');

const unitOf = (id) => state.units.find((u) => u.id === id);
const view = () => playerProjection(state);
const extracted = (u) => (u.statuses || []).includes('EXTRACTED');
const nodeState = (id) => (state.nodes.find((n) => n.id === id) || {}).state;
const relayLinks = () => ({ OBSERVED: 0, WORK_IN_PROGRESS: 1, VERIFIED: 2 }[nodeState('RELAY')] ?? 0);
const gateOpen = () => nodeState('GATE') === 'VERIFIED';
function say(msg) { log.push(`T${String(state.round).padStart(2, '0')} · ${msg}`); if (log.length > 120) log = log.slice(-120); }

/* ---------- reach: the hint module's player-knowledge pathing (link- and floor-aware) ---------- */
function parseKey(k) { const p = String(k).split(':').map(Number); return { x: p[0], y: p[1], z: p[2] || 0 }; }
function reach(u, dash) {
  const p = view(), pu = p.units.find((x) => x.id === u.id);
  pu.moveRange = u.moveRange * (dash ? 2 : 1);
  const r = knownPaths(p, u.id);
  const tiles = [];
  for (const [k, steps] of r.dist) { const t = parseKey(k); if (steps > 0) tiles.push({ ...t, steps }); }
  // always pass the floor: the engine's key/pathTo take z as an optional argument (so .length is 2);
  // dropping it asked about the ground under a roof, which made every roof tap 'unreachable'
  const pathTo = (x, y, z = 0) => r.pathTo(x, y, z);
  const stepsTo = (x, y, z = 0) => r.dist.get(r.key(x, y, z));
  return { tiles, pathTo, stepsTo };
}

/* ---------- fog of war: what the squad can see now, by the engine's own sight rule ----------
   A tile is lit if a living, deployed operative is within its detection radius and has line of sight
   to it (the same test the engine uses to spot units). Tiles seen before stay half-lit (explored).
   Only the shade is drawn from this; hostiles are still shown only through the player projection. */
let explored = new Uint8Array(W * H);
function visibleTiles() {
  const vis = new Uint8Array(W * H);
  for (const u of state.units) {
    if (u.faction !== 'PLAYER' || u.dead || u.downed || extracted(u)) continue;
    const r = u.detectionRadius;
    for (let y = Math.max(0, u.y - r); y <= Math.min(H - 1, u.y + r); y += 1) for (let x = Math.max(0, u.x - r); x <= Math.min(W - 1, u.x + r); x += 1) {
      const i = y * W + x; if (vis[i]) continue;
      const t = { x, y, z: 0 };
      if (gridDistance(u, t, state) <= r && (x === u.x && y === u.y || safeLos(u, t))) vis[i] = 1;
    }
  }
  for (let i = 0; i < vis.length; i += 1) if (vis[i]) explored[i] = 1;
  return vis;
}
function safeLos(a, b) { try { return hasLineOfSight(state, a, b); } catch (e) { return false; } }
function fogCells(vis) { const f = new Float32Array(W * H); for (let i = 0; i < f.length; i += 1) f[i] = vis[i] ? 0 : explored[i] ? 0.55 : 1; return f; }
let fogKey = '', lastVis = null;

/* ---------- legality: dry-run the engine ---------- */
const tryRun = (fn) => { try { const out = fn(); const st = out && out.state ? out.state : out; return out && out.accepted === false ? null : st; } catch (e) { return null; } };
function knownHostiles() { return view().units.filter((x) => x.faction !== 'PLAYER' && !x.dead); }
function targetsFor(u) {
  return knownHostiles().map((e) => ({ e, pv: shotPreview(state, u.id, e.id) })).filter((t) => t.pv.legal);
}
function actionsFor(u) {
  const ok = u && u.faction === 'PLAYER' && state.phase === 'PLAYER' && !u.dead && !u.downed && !extracted(u) && !ui.busy && !ui.ended;
  const A = [];
  const add = (id, label, sub, enabled, ctx = false, why = '') => A.push({ id, label, sub, enabled: !!(ok && enabled), ctx, why });
  add('move', 'Move', '1 AP', u && u.ap >= 1);
  add('dash', 'Dash', '2 AP', u && u.ap >= 2);
  add('fire', 'Fire', '1 AP', u && u.ap >= 1 && targetsFor(u).length > 0, false, 'No known hostile in sight');
  add('watch', 'Watch', '1 AP', u && u.ap >= 1 && !u.overwatch && u.ammo > 0);
  add('hunker', 'Hunker', '1 AP', u && u.ap >= 1 && !u.hunkered);
  add('reload', 'Reload', '1 AP', u && u.ap >= 1 && u.ammo < u.magazineSize && u.reserveAmmo > 0);
  if (u && u.role === 'T' && nodeState('RELAY') !== 'VERIFIED') {
    const act = nodeState('RELAY') === 'OBSERVED' ? 'LINK_1' : 'LINK_2';
    const can = ok && !!tryRun(() => technicalAction(state, u.id, 'RELAY', act));
    if (can) add('link', `Link ${relayLinks() + 1}/2`, '1 AP', true, true);
  }
  if (u && u.role === 'E' && !gateOpen() && ok && tryRun(() => technicalAction(state, u.id, 'GATE', 'BREACH'))) add('breach', 'Breach', '1 AP', true, true);
  if (u && ok) for (const d of state.units.filter((x) => x.faction === 'PLAYER' && x.downed && !x.dead && x.id !== u.id)) {
    if (tryRun(() => stabilize(state, u.id, d.id))) add('stab:' + d.id, 'Stabilize ' + d.role, '1 AP', true, true);
  }
  if (u && ok && nodeState('RELAY') === 'VERIFIED' && tryRun(() => extractUnit(state, u.id))) add('extract', 'Extract', 'free', true, true);
  return A;
}

/* ---------- 3D ---------- */
let r3 = null, r3loading = null;
function webgl() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
function ensure3d() {
  if (r3 || r3loading || !webgl()) return;
  r3loading = import('./level3d.mjs').then((mod) => {
    r3 = mod.createLevel3D($('tx3d'), { level: LEVEL, look, fx: PARAMS.get('fx') || (gfx === 'auto' ? null : gfx), reducedMotion: REDUCED, onTap, onView: null });
    r3loading = null; fogKey = ''; // a new board needs its fog
    r3.setGrid(gridOn);
    const s = unitOf(ui.sel); if (s) r3.focus((s.x + SCENE.relay.x) / 2, (s.y + SCENE.relay.y) / 2 + 4, 0, 30);
    render();
  }).catch((e) => { r3loading = null; toast('The 3D view could not load here. ' + esc(e.message || '')); });
}

function boardModel() {
  const p = view(), sel = unitOf(ui.sel);
  const units = p.units.filter((u) => !extracted(u));
  const m = { units, selected: ui.sel, labels: [], gateOpen: gateOpen(), coverAt: (u) => { const c = state.cover.find((k) => k.x === u.x && k.y === u.y && (k.z || 0) === (u.z || 0)); return c ? c.type : null; } };
  if (ui.mode === 'move' || ui.mode === 'dash') { m.reach = ui.reach.tiles; }
  if (ui.preview && ui.preview.kind === 'move') { m.path = ui.preview.path.slice(0, -1); m.dest = ui.preview.dest; m.pathLine = [{ x: sel.x, y: sel.y, z: sel.z }, ...ui.preview.path]; }
  if (ui.preview && ui.preview.kind === 'fire') m.target = ui.preview.target;
  for (const u of units) if (!u.dead) m.labels.push({ id: u.id, x: u.x, y: u.y, z: u.z, h: operatorHeight(LEVEL.TILE_M) + 0.3, kind: u.faction === 'PLAYER' ? 'ally' : 'hostile', text: u.faction === 'PLAYER' ? u.role : esc(u.id) });
  m.labels.push({ x: SCENE.relay.x, y: SCENE.relay.y, h: 2.6, kind: 'obj', text: `Relay ${relayLinks()}/2` });
  if (nodeState('RELAY') === 'VERIFIED') m.labels.push({ x: SCENE.extraction.x, y: SCENE.extraction.y, h: 0.4, kind: 'obj', text: 'Extract' });
  if (ui.preview && ui.preview.kind === 'move') { const d = ui.preview.dest; m.labels.push({ x: d.x, y: d.y, z: d.z, h: 0.1, kind: 'info', text: `${D(d.x, d.y)} · ${ui.preview.steps} steps` }); }
  return m;
}

/* ---------- rendering ---------- */
function render() {
  const sel = unitOf(ui.sel);
  if (!r3 && !r3loading) ensure3d();
  if (r3 && !ui.holdBoard) r3.update(boardModel()); // frozen while engine events play out
  if (r3 && !ui.holdBoard) { const k = state.units.filter((u) => u.faction === 'PLAYER').map((u) => `${u.x},${u.y},${u.z},${u.dead},${u.downed}`).join('|') + state.round; if (k !== fogKey) { fogKey = k; lastVis = visibleTiles(); r3.setFog(fogCells(lastVis)); } }
  // top bar
  $('txTurn').textContent = String(state.round).padStart(2, '0');
  const ph = $('txPhase'); ph.textContent = ui.ended ? (ui.ended === 'win' ? 'Complete' : 'Failed') : state.phase === 'PLAYER' && !ui.busy ? 'Your move' : 'Threat move';
  ph.classList.toggle('is-threat', !!ui.busy || state.phase !== 'PLAYER');
  $('txBusy').hidden = !ui.busy;
  $('txCoord').textContent = sel ? (() => { const d = toDisplay(sel.x, sel.y); return `${sel.role} (${d.X}, ${d.Y}${sel.z ? ', roof' : ''})`; })() : '';
  $('txGrid').setAttribute('aria-pressed', String(gridOn)); $('txGrid').lastChild.textContent = gridOn ? 'Grid on' : 'Grid off';
  // objective
  const links = relayLinks();
  const clock = state.mission ? `${state.mission.escalation} · clock ${state.mission.clock}` : '';
  $('txObj').innerHTML = (MISSION ? `<small>${MISSION.deployment === 'wildcard-call' ? 'Wildcard call' : 'Mission'} · ${esc(MISSION.character.name)}</small><b>${esc(MISSION.title)}</b><span class="tx-brief" id="txBrief">${esc(MISSION.briefing)}</span>` : '') + (nodeState('RELAY') === 'VERIFIED'
    ? `<small>Objective</small><b>Extract</b><span>Relay linked. Everyone standing to the yellow pad ${D(SCENE.extraction.x, SCENE.extraction.y)}. ${esc(clock)}</span>`
    : `<small>Objective</small><b>Secure the relay</b><span>T must connect twice. Link ${links}/2. ${esc(clock)}</span>`);
  $('txObj').classList.toggle('has-mission', !!MISSION);
  // selected operative
  if (sel) {
    const R = ROLE[sel.role];
    const st = [sel.downed ? 'downed' : '', sel.overwatch ? 'overwatch' : '', sel.hunkered ? 'hunkered' : '', extracted(sel) ? 'extracted' : '', sel.z ? 'on the roof' : ''].filter(Boolean).join(' · ');
    $('txSel').innerHTML = `<img src="${R.img}" alt="${sel.role}: ${R.name} operator, faceless mannequin in field loadout" width="72" height="72">
      <div><h2>${sel.role} / ${R.name}</h2><p>${esc(R.line)}</p><p>${D(sel.x, sel.y)} · ammo ${sel.ammo}/${sel.magazineSize} (+${sel.reserveAmmo})${st ? ' · ' + st : ''}</p></div>
      <div class="tx-stats"><span class="chip">${sel.ap} AP</span><span class="chip chip--hp">${sel.hp} / ${sel.maxHp} HP</span></div>`;
  }
  // squad
  $('txSquad').innerHTML = state.units.filter((u) => u.faction === 'PLAYER').map((u) => {
    const R = ROLE[u.role];
    const cls = ['sq', u.downed ? 'is-down' : '', (u.dead || extracted(u)) ? 'is-out' : ''].join(' ');
    return `<button type="button" class="${cls}" data-unit="${u.id}" aria-pressed="${u.id === ui.sel}"><img src="${R.img}" alt="" width="44" height="44"><b>${u.role} / ${R.name}</b><small>${u.dead ? 'lost' : extracted(u) ? 'extracted' : u.downed ? 'downed' : `${u.hp} / ${u.maxHp} HP`}</small><span class="ap" aria-label="${u.ap} action points">${'●'.repeat(Math.max(0, u.ap))}${'○'.repeat(Math.max(0, u.maxAp - u.ap))}</span></button>`;
  }).join('');
  // actions
  const icon = { move: '<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>', dash: '<path d="M4 6l6 6-6 6M12 6l6 6-6 6"/>', fire: '<circle cx="12" cy="12" r="7"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6"/>', watch: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>', hunker: '<path d="M4 20h16M6 20v-6h12v6M9 14V9h6v5"/>', reload: '<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5"/>' };
  $('txActs').innerHTML = actionsFor(sel).map((a) => `<button type="button" class="act${a.ctx ? ' act--ctx' : ''}" data-act="${a.id}" aria-pressed="${ui.mode === a.id}"${a.enabled ? '' : ' disabled'}${a.why && !a.enabled ? ` title="${esc(a.why)}"` : ''}>${icon[a.id] ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">${icon[a.id]}</svg>` : ''}${esc(a.label)}<small>${esc(a.sub)}</small></button>`).join('');
  $('txEndTurn').disabled = ui.busy || !!ui.ended || state.phase !== 'PLAYER';
  renderSheet(); drawMap();
  $('txLog').innerHTML = log.slice(-30).reverse().map((l) => `<li>${esc(l)}</li>`).join('');
  for (const b of document.querySelectorAll('#setLook button')) b.setAttribute('aria-pressed', String(b.dataset.look === look));
  for (const b of document.querySelectorAll('#setGfx button')) b.setAttribute('aria-pressed', String(b.dataset.gfx === gfx));
  if (r3) { const z = r3.canZoom(); $('camIn').disabled = !z.in; $('camOut').disabled = !z.out; }
}

let toastMsg = '';
function toast(msg) { toastMsg = msg; renderSheet(); }
function renderSheet() {
  const s = $('txSheet'), sel = unitOf(ui.sel);
  let html = '';
  const pv = ui.preview;
  if (pv && pv.kind === 'move') {
    const cv = state.cover.find((c) => c.x === pv.dest.x && c.y === pv.dest.y && (c.z || 0) === (pv.dest.z || 0));
    html = `<p class="sh-eye">${pv.dash ? 'Dash' : 'Move'} preview · ${sel.role}</p>
      <p class="sh-main">${D(sel.x, sel.y)} → <b>${D(pv.dest.x, pv.dest.y)}</b>${pv.dest.z ? ' roof' : ''} · ${pv.steps} steps · ${pv.dash ? 2 : 1} AP${cv ? ' · ' + (cv.type === 'HIGH' ? 'high' : 'low') + ' cover' : ' · no cover'}</p>
      <p class="sh-sub">${pv.exposure.length ? 'Known hostiles with a shot there: ' + pv.exposure.map((e) => `${e.id} ${e.hit}%`).join(', ') : 'No known hostile has a shot there.'}${pv.watchers ? ' Watch out: a hostile on overwatch may react.' : ''}</p>
      <div class="sh-row"><button type="button" class="sh-btn sh-btn--go" data-sheet="confirm-move">Confirm ${pv.dash ? 'dash' : 'move'}</button><button type="button" class="sh-btn" data-sheet="back">Back</button></div>`;
  } else if (ui.mode === 'fire' && sel) {
    const ts = targetsFor(sel);
    html = `<p class="sh-eye">Fire · ${sel.role} · choose a known target</p><div class="sh-targets">${ts.map((t) => `<button type="button" class="tgt" data-sheet="aim:${t.e.id}"><b>${esc(t.e.id)}</b><span>${t.pv.hitChance}%</span></button>`).join('')}</div>
      ${pv && pv.kind === 'fire' ? `<p class="sh-main">${sel.role} → <b>${esc(pv.target)}</b> · ${pv.hit}% to hit · ${pv.damage} dmg${pv.flanked ? ' · flanking' : ''}${pv.cover !== 'NONE' ? ' · target in ' + pv.cover.toLowerCase() + ' cover' : ''} · ${pv.distance} tiles</p>
      <p class="sh-sub">Chance from the engine: aim, cover, range, elevation. The roll is random.</p>
      <div class="sh-row"><button type="button" class="sh-btn sh-btn--go" data-sheet="confirm-fire">Confirm fire</button><button type="button" class="sh-btn" data-sheet="back">Back</button></div>` : '<div class="sh-row"><button type="button" class="sh-btn" data-sheet="back">Back</button></div>'}`;
  } else if (ui.mode === 'move' || ui.mode === 'dash') {
    html = `<p class="sh-eye">${ui.mode === 'dash' ? 'Dash' : 'Move'} · ${sel.role}</p><p class="sh-sub">Tap a lit tile to preview the route. Stairs are lit on the roof too. Tap ${sel.role} again or Back to cancel.</p><div class="sh-row"><button type="button" class="sh-btn" data-sheet="back">Back</button></div>`;
  } else if (toastMsg) html = `<p class="sh-sub">${toastMsg}</p>`;
  s.innerHTML = html; s.hidden = !html;
}

/* ---------- sector map ---------- */
const mini = $('txMini'), mctx = mini.getContext('2d');
function drawMap() {
  if ($('txMap').hidden && matchMedia('(max-width: 1099px)').matches) return;
  const S = mini.width / W, g = mctx, studio = look === 'studio', day = look === 'day';
  const col = day ? { bg: '#f4f6f6', ground: '#e7ebec', water: '#4fb3b8', bld: '#c2c8cb', roof: '#d3d8da', prop: '#cfd4d6', grid: 'rgba(20,40,50,.10)', ink: '#16202a', sq: '#0fa9ba', th: '#d81f2a', amber: '#d98a0a' }
    : studio ? { bg: '#eef0f1', ground: '#e2e5e7', water: '#c9d3d8', bld: '#a9b0b5', roof: '#8e979d', prop: '#bcc2c6', grid: 'rgba(0,0,0,.08)', ink: '#14191c', sq: '#ff2a3a', th: '#3d8bff', amber: '#2a3136' }
    : { bg: '#0b1116', ground: '#121a20', water: '#0e3a44', bld: '#3a444c', roof: '#4b565f', prop: '#2a333a', grid: 'rgba(120,220,235,.08)', ink: '#cfe3ea', sq: '#2fe0f0', th: '#ff3b3b', amber: '#ffb547' };
  g.fillStyle = col.bg; g.fillRect(0, 0, mini.width, mini.height);
  g.fillStyle = col.ground; g.fillRect(0, 0, W * S, H * S);
  g.strokeStyle = col.grid; g.lineWidth = 1;
  for (let i = 0; i <= W; i += 4) { g.beginPath(); g.moveTo(i * S, 0); g.lineTo(i * S, H * S); g.stroke(); g.beginPath(); g.moveTo(0, i * S); g.lineTo(W * S, i * S); g.stroke(); }
  g.fillStyle = col.water; g.fillRect(SCENE.canal.x * S, SCENE.canal.y * S, SCENE.canal.w * S, SCENE.canal.d * S);
  g.fillStyle = col.prop; for (const b of SCENE.bridges) g.fillRect(b.x * S, b.y * S, b.w * S, b.d * S);
  for (const b of SCENE.buildings) { g.fillStyle = b.roof ? col.roof : col.bld; g.fillRect(b.x * S, b.y * S, b.w * S, b.d * S); g.fillStyle = col.ink; g.font = `700 ${S * 1.8}px system-ui`; g.fillText(b.label, (b.x + 0.6) * S, (b.y + 2) * S); }
  const sb = SCENE.skybridge; g.fillStyle = col.roof; g.fillRect(sb.x * S, sb.y * S, sb.w * S, sb.d * S);
  g.fillStyle = col.prop; for (const c of [...SCENE.containers, ...SCENE.barricades, ...SCENE.crates, SCENE.tent]) g.fillRect(c.x * S, c.y * S, c.w * S, c.d * S);
  g.strokeStyle = gateOpen() ? col.prop : col.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(SCENE.fence.x0 * S, (SCENE.fence.y + 0.5) * S); g.lineTo((SCENE.fence.x1 + 1) * S, (SCENE.fence.y + 0.5) * S); g.stroke();
  // extraction, relay
  g.strokeStyle = '#ffd23a'; g.lineWidth = 2; g.beginPath(); g.arc((SCENE.extraction.x + 0.5) * S, (SCENE.extraction.y + 0.5) * S, (SCENE.extraction.r + 0.5) * S, 0, Math.PI * 2); g.stroke();
  const rx = (SCENE.relay.x + 0.5) * S, ry = (SCENE.relay.y + 0.5) * S;
  g.strokeStyle = col.amber; g.lineWidth = 3; g.beginPath(); g.moveTo(rx, ry - S * 1.4); g.lineTo(rx + S * 1.4, ry); g.lineTo(rx, ry + S * 1.4); g.lineTo(rx - S * 1.4, ry); g.closePath(); g.stroke();
  // reach and path
  if (ui.reach && (ui.mode === 'move' || ui.mode === 'dash')) { g.fillStyle = studio ? 'rgba(20,25,28,.12)' : 'rgba(47,224,240,.16)'; for (const t of ui.reach.tiles) g.fillRect(t.x * S, t.y * S, S, S); }
  if (ui.preview && ui.preview.kind === 'move') { const sel = unitOf(ui.sel); g.strokeStyle = col.amber; g.setLineDash([S, S * 0.6]); g.lineWidth = 2; g.beginPath(); g.moveTo((sel.x + 0.5) * S, (sel.y + 0.5) * S); for (const p of ui.preview.path) g.lineTo((p.x + 0.5) * S, (p.y + 0.5) * S); g.stroke(); g.setLineDash([]); }
  if (lastVis) { for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) { const i = y * W + x; if (lastVis[i]) continue; g.fillStyle = explored[i] ? (studio || day ? 'rgba(30,40,48,.18)' : 'rgba(0,0,0,.35)') : (studio || day ? 'rgba(30,40,48,.34)' : 'rgba(0,0,0,.6)'); g.fillRect(x * S, y * S, S, S); } }
  // units: squad and only the hostiles the player knows about
  for (const u of view().units) {
    if (u.dead || extracted(u)) continue;
    const ally = u.faction === 'PLAYER', x = u.x * S, y = u.y * S;
    g.strokeStyle = ally ? col.sq : col.th; g.lineWidth = 2; g.fillStyle = studio || day ? 'rgba(255,255,255,.92)' : 'rgba(5,8,11,.85)';
    g.fillRect(x - S * 0.9, y - S * 0.9, S * 2.8, S * 2.8); g.strokeRect(x - S * 0.9, y - S * 0.9, S * 2.8, S * 2.8);
    g.fillStyle = ally ? col.sq : col.th; g.font = `800 ${S * 1.7}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ally ? u.role : u.id, x + S * 0.5, y + S * 0.5); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    if (u.id === ui.sel) { g.strokeStyle = col.ink; g.strokeRect(x - S * 1.3, y - S * 1.3, S * 3.6, S * 3.6); }
  }
}
mini.addEventListener('click', (e) => {
  const r = mini.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * W), y = Math.floor((e.clientY - r.top) / r.height * H);
  if (r3) r3.focus(x, y, 0, 22);
  $('txCursor').textContent = `Look ${D(x, y)}`;
});

/* ---------- input ---------- */
function onTap(t) {
  if (ui.busy || ui.ended) return;
  const sel = unitOf(ui.sel);
  if ((ui.mode === 'move' || ui.mode === 'dash') && sel) {
    if (t.unitId === sel.id) { cancel(); return; }
    const z = t.z || 0;
    let steps = ui.reach.stepsTo(t.x, t.y, z);
    if ((steps === undefined || steps <= 0) && z === 1) { steps = ui.reach.stepsTo(t.x, t.y, 0); if (steps > 0) t = { ...t, z: 0 }; }
    if (steps === undefined || steps <= 0) { toast('That tile cannot be reached with this action.'); ui.preview = null; render(); return; }
    const path = ui.reach.pathTo(t.x, t.y, t.z || 0);
    const after = { ...state, units: state.units.map((u) => (u.id === sel.id ? { ...u, x: t.x, y: t.y, z: t.z || 0 } : u)) };
    const exposure = knownHostiles().map((e) => { const p = tryPreview(after, e.id, sel.id); return p ? { id: e.id, hit: p.hitChance } : null; }).filter(Boolean);
    ui.preview = { kind: 'move', dash: ui.mode === 'dash', dest: { x: t.x, y: t.y, z: t.z || 0 }, steps, path, exposure, watchers: knownHostiles().some((e) => e.overwatch) };
    toastMsg = ''; render(); return;
  }
  if (ui.mode === 'fire' && t.unitId) { const e = knownHostiles().find((h) => h.id === t.unitId); if (e) { aim(e.id); return; } }
  const ally = t.unitId && state.units.find((u) => u.id === t.unitId && u.faction === 'PLAYER');
  if (ally) { select(ally.id); return; }
  const hostile = t.unitId && knownHostiles().find((h) => h.id === t.unitId);
  if (hostile && sel) { const tg = targetsFor(sel).find((x) => x.e.id === hostile.id); if (tg && sel.ap >= 1) { ui.mode = 'fire'; aim(hostile.id); return; } toast(`${hostile.id}: no shot from ${sel.role}'s position.`); }
}
function tryPreview(st, a, b) { try { const p = shotPreview(st, a, b); return p.legal ? p : null; } catch (e) { return null; } }
function select(id) { ui.sel = id; ui.mode = null; ui.preview = null; toastMsg = ''; const u = unitOf(id); if (r3 && u) r3.focus(u.x, u.y, u.z, 22); render(); }
function cancel() { ui.mode = null; ui.preview = null; ui.reach = null; toastMsg = ''; render(); }
function aim(id) {
  const sel = unitOf(ui.sel), pv = shotPreview(state, sel.id, id);
  if (!pv.legal) { toast('No shot.'); return; }
  ui.preview = { kind: 'fire', target: id, hit: pv.hitChance, damage: pv.damage, flanked: pv.flanked, cover: pv.cover, distance: pv.distance };
  render();
}

async function onAct(id) {
  const sel = unitOf(ui.sel); if (!sel || ui.busy) return;
  toastMsg = '';
  if (id === 'move' || id === 'dash') { if (ui.mode === id) { cancel(); return; } ui.mode = id; ui.preview = null; ui.reach = reach(sel, id === 'dash'); render(); return; }
  if (id === 'fire') { if (ui.mode === 'fire') { cancel(); return; } ui.mode = 'fire'; ui.preview = null; const ts = targetsFor(sel); if (ts.length === 1) aim(ts[0].e.id); else render(); return; }
  const before = state;
  try {
    if (id === 'watch') { state = enterOverwatch(state, sel.id); say(`${sel.role} on overwatch.`); }
    else if (id === 'hunker') { state = hunkerDown(state, sel.id); say(`${sel.role} hunkers down.`); }
    else if (id === 'reload') { state = reload(state, sel.id); say(`${sel.role} reloads.`); }
    else if (id === 'link') { const act = nodeState('RELAY') === 'OBSERVED' ? 'LINK_1' : 'LINK_2'; const out = technicalAction(state, sel.id, 'RELAY', act); if (!out.accepted) throw new Error('The relay refused the link'); state = out.state; say(`T links the relay (${relayLinks()}/2).`); if (relayLinks() === 2) say('Relay linked. Extract at the south-west pad.'); }
    else if (id === 'breach') { const out = technicalAction(state, sel.id, 'GATE', 'BREACH'); if (!out.accepted) throw new Error('The gate held'); state = out.state; say('E breaches the service gate.'); }
    else if (id.startsWith('stab:')) { const t = id.slice(5); state = stabilize(state, sel.id, t); say(`${sel.role} stabilizes ${unitOf(t).role}.`); }
    else if (id === 'extract') { state = extractUnit(state, sel.id); say(`${sel.role} extracts.`); const next = state.units.find((u) => u.faction === 'PLAYER' && !u.dead && !u.downed && !extracted(u)); if (next) ui.sel = next.id; }
  } catch (e) { state = before; toast('Refused: ' + esc(e.message)); return; }
  ui.mode = null; ui.preview = null; afterChange();
}

async function onSheet(a) {
  const sel = unitOf(ui.sel);
  if (a === 'back') { if (ui.preview) { ui.preview = null; render(); } else cancel(); return; }
  if (a.startsWith('aim:')) { aim(a.slice(4)); return; }
  if (a === 'confirm-move') {
    const pv = ui.preview, before = state;
    try { state = moveUnit(state, sel.id, pv.dest, pv.dash ? 'DASH' : 'MOVE', { path: pv.path }); }
    catch (e) { state = before; toast('The move was refused: ' + esc(e.message)); ui.preview = null; render(); return; }
    ui.mode = null; ui.preview = null; ui.reach = null;
    save(); // the outcome is final before it is shown
    await play(state.events.slice(before.events.length), before);
    afterChange(); return;
  }
  if (a === 'confirm-fire') {
    const before = state, tgt = ui.preview.target;
    try { const d = drawRolls(state, 2); const out = fireWeapon(d.state, sel.id, tgt, d.rolls[0], d.rolls[1]); state = out.state; }
    catch (e) { state = before; toast(esc(e.message)); return; }
    ui.mode = null; ui.preview = null;
    save();
    await play(state.events.slice(before.events.length), before);
    afterChange();
  }
}

/* ---------- playing engine events (animation only; the state is already final) ---------- */
let seenInPlay = new Set();
function visibleIds(st) { return new Set(playerProjection(st).units.map((u) => u.id)); }
async function play(events, before) {
  if (!events.length) return;
  ui.busy = true; ui.holdBoard = true; render();
  const seenBefore = visibleIds(before), seenAfter = visibleIds(state);
  seenInPlay = new Set([...seenBefore, ...seenAfter]);
  const shown = (id) => seenBefore.has(id) || seenAfter.has(id);
  const wait = (fn) => new Promise((res) => fn(res));
  const pendingShots = [];
  for (const ev of events) {
    if (ev.type === 'OVERWATCH_SHOT') { pendingShots.push(ev); continue; }
    if (ev.type === 'MOVE' || ev.type === 'DASH' || ev.type === 'MOVE_INTERRUPTED') {
      const path = ev.path || [];
      if (r3 && shown(ev.unitId) && path.length) {
        // walk to each reaction shot's tile, play the shot, walk on
        let from = 0;
        for (const s of pendingShots.filter((p) => p.targetId === ev.unitId)) {
          const idx = path.findIndex((p) => p.x === s.at.x && p.y === s.at.y && (p.z || 0) === (s.at.z || 0));
          if (idx >= from) { await wait((done) => r3.walk(ev.unitId, path.slice(from, idx + 1), done)); from = idx + 1; }
          await shot(s.watcherId, s.targetId, s, false);
        }
        if (from < path.length) await wait((done) => r3.walk(ev.unitId, path.slice(from), done));
      } else for (const s of pendingShots.filter((p) => p.targetId === ev.unitId)) await shot(s.watcherId, s.targetId, s, false);
      for (const s of pendingShots) logShot(s, true);
      pendingShots.length = 0;
      if (ev.type === 'MOVE_INTERRUPTED') say(`${roleOrId(ev.unitId)} stopped at ${D(ev.at.x, ev.at.y)}: contact.`);
      continue;
    }
    if (ev.type === 'FIRE') { await shot(ev.attackerId, ev.targetId, ev, true); logShot(ev, false); continue; }
    if (ev.type === 'CONCEALMENT_BROKEN') say(`${roleOrId(ev.unitId)} was spotted.`);
    if (ev.type === 'OVERWATCH_SET' && seenAfter.has(ev.unitId) && unitOf(ev.unitId).faction !== 'PLAYER') say(`${ev.unitId} goes on overwatch.`);
  }
  for (const s of pendingShots) { await shot(s.watcherId, s.targetId, s, false); logShot(s, true); }
  ui.busy = false; ui.holdBoard = false;
}
function roleOrId(id) { const u = unitOf(id); return u && u.faction === 'PLAYER' ? u.role : id; }
function logShot(ev, reaction) {
  const aid = ev.attackerId || ev.watcherId, au = unitOf(aid);
  const known = (au && au.faction === 'PLAYER') || seenInPlay.has(aid);
  const a = known ? roleOrId(aid) : 'An unseen shooter', t = roleOrId(ev.targetId), tu = unitOf(ev.targetId);
  say(`${reaction ? 'Reaction: ' : ''}${a} fires at ${t} (${ev.hitChance}%): ${ev.hit ? `hit for ${ev.damage}${ev.critical ? ', critical' : ''}` : 'miss'}${tu && tu.dead ? `. ${t} is down for good.` : tu && tu.downed ? `. ${t} is downed.` : ''}`);
}
function shot(a, t, ev, cinematic) {
  return new Promise((res) => {
    const seen = visibleIds(state);
    if (!r3 || (!seen.has(a) && unitOf(a).faction !== 'PLAYER')) { res(); return; }
    const tu = unitOf(t);
    r3.fire(a, t, { hit: !!ev.hit, killed: !!(tu && (tu.dead || tu.downed)), downedOnly: !!(tu && tu.downed && !tu.dead) }, res, { cinematic: cinematic && unitOf(a).faction === 'PLAYER' });
  });
}

/* ---------- turns ---------- */
async function endTurn() {
  if (ui.busy || ui.ended || state.phase !== 'PLAYER') return;
  ui.mode = null; ui.preview = null; ui.reach = null; toastMsg = '';
  const before = state;
  let next = beginThreatPhase(state);
  try { next = runThreatPhase(next).state; } catch (e) { say('Threat phase error: ' + e.message); }
  const events = next.events.slice(before.events.length);
  // the whole hostile turn is resolved and saved before any of it is shown: a reload mid-turn lands
  // on the outcome, never back before End turn
  state = beginPlayerPhase(resolveClockStatePhase(next));
  save();
  await play(events, before);
  say(`New round. Escalation ${state.mission.escalation}.`);
  const s = unitOf(ui.sel); if (!s || s.dead || s.downed || extracted(s)) { const n = state.units.find((u) => u.faction === 'PLAYER' && !u.dead && !u.downed && !extracted(u)); if (n) ui.sel = n.id; }
  afterChange();
}

function checkEnd() {
  const t = unitOf('T1');
  const squad = state.units.filter((u) => u.faction === 'PLAYER');
  if (missionComplete(state)) return 'win';
  if (t && t.dead) return 'lose-t';
  if (squad.every((u) => u.dead || (u.downed && !extracted(u)))) return 'lose-all';
  return null;
}
function afterChange() {
  const end = checkEnd();
  if (end && !ui.ended) {
    ui.ended = end === 'win' ? 'win' : 'lose';
    const squad = state.units.filter((u) => u.faction === 'PLAYER');
    const out = squad.filter(extracted).length;
    $('txEnd').innerHTML = end === 'win'
      ? `<div><h2>Relay secured</h2><p>Turn ${state.round}. ${out} of ${squad.length} extracted.</p><button type="button" class="sh-btn sh-btn--go" data-sheet="restart">Play again</button></div>`
      : `<div><h2>Mission failed</h2><p>${end === 'lose-t' ? 'Technical was lost. The relay cannot be linked.' : 'No one is left standing.'}</p><button type="button" class="sh-btn sh-btn--go" data-sheet="restart">Try again</button></div>`;
    $('txEnd').hidden = false;
    say(end === 'win' ? 'Mission complete.' : 'Mission failed.');
  }
  save(); render();
}
function restart() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  explored = new Uint8Array(W * H); fogKey = '';
  state = fresh(); log = []; ui = { ...ui, sel: 'T1', mode: null, preview: null, reach: null, busy: false, ended: null };
  $('txEnd').hidden = true; say('Deployed. Secure the relay.');
  if (MISSION) log.unshift(missionLine(MISSION));
  if (r3) { r3.destroy(); r3 = null; }
  save(); render();
}

/* ---------- wiring ---------- */
$('txSquad').addEventListener('click', (e) => { const b = e.target.closest('[data-unit]'); if (b && !ui.busy) select(b.dataset.unit); });
$('txActs').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) onAct(b.dataset.act); });
$('txSheet').addEventListener('click', (e) => { const b = e.target.closest('[data-sheet]'); if (b) onSheet(b.dataset.sheet); });
$('txEnd').addEventListener('click', (e) => { if (e.target.closest('[data-sheet="restart"]')) restart(); });
$('txEndTurn').addEventListener('click', endTurn);
$('camIn').addEventListener('click', () => { if (r3) { r3.zoom(1); render(); } });
$('camOut').addEventListener('click', () => { if (r3) { r3.zoom(-1); render(); } });
$('camRot').addEventListener('click', () => { if (r3) r3.rotate(1); });
$('txGrid').addEventListener('click', () => { gridOn = !gridOn; try { localStorage.setItem(GRID_KEY, gridOn ? 'on' : 'off'); } catch (e) {} if (r3) r3.setGrid(gridOn); render(); });
$('camAll').addEventListener('click', () => { if (r3) r3.overview(); });
$('txMapTog').addEventListener('click', () => { const m = $('txMap'); m.hidden = !m.hidden; $('txMapTog').setAttribute('aria-expanded', String(!m.hidden)); drawMap(); if (!m.hidden) m.scrollIntoView({ block: 'nearest' }); });
$('txSettings').addEventListener('click', () => { const s = $('txSet'); s.hidden = !s.hidden; $('txSettings').setAttribute('aria-expanded', String(!s.hidden)); render(); });
$('setLook').addEventListener('click', (e) => { const b = e.target.closest('[data-look]'); if (!b) return; look = b.dataset.look; document.documentElement.dataset.look = look; try { localStorage.setItem(LOOK_KEY, look); } catch (er) {} if (r3) r3.setLook(look); render(); });
$('setGfx').addEventListener('click', (e) => { const b = e.target.closest('[data-gfx]'); if (!b) return; gfx = b.dataset.gfx; try { localStorage.setItem(GFX_KEY, gfx); } catch (er) {} if (r3) { r3.destroy(); r3 = null; } render(); });
$('setRestart').addEventListener('click', restart);
document.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input,textarea')) return;
  if (e.key === 'Escape') cancel();
  else if (e.key === '1' || e.key === '2' || e.key === '3') { const u = state.units.filter((x) => x.faction === 'PLAYER')[Number(e.key) - 1]; if (u) select(u.id); }
  else if (e.key === 'Enter' && ui.preview) onSheet(ui.preview.kind === 'move' ? 'confirm-move' : 'confirm-fire');
});
if (!log.length) say('Deployed. Secure the relay.');
render();
if (MISSION_ID) {
  const fromDraft = () => { try { return findMission(JSON.parse(localStorage.getItem(WORLD_DRAFTS) || 'null'), MISSION_ID); } catch (e) { return null; } };
  fetch(WORLD_MISSIONS).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((d) => findMission(d, MISSION_ID) || fromDraft())
    .then((m) => {
      if (!m || typeof m.title !== 'string' || !m.character || typeof m.briefing !== 'string') return;
      MISSION = m;
      document.title = `${m.title} · PRIM3 Transit / Relay`;
      if (!log.some((l) => l.startsWith(`T01 · Mission: ${m.title} ·`))) { log.unshift(missionLine(m)); save(); }
      render();
    });
}
$('txObj').addEventListener('click', () => { if (MISSION) $('txObj').classList.toggle('is-open'); });
window.__tx = { get state() { return state; }, get ui() { return ui; }, get r3() { return r3; }, get busy() { return ui.busy || !!(r3 && r3.isAnimating()); }, select, onAct, onSheet, onTap, endTurn, restart, reach: () => ui.reach, SAVE_KEY };
