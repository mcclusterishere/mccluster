/* PRIM3 · tactics levels — the page (review branch; not public canon). Transit / Relay by default;
   ?level=<id> loads another level module from levels/index.mjs (e.g. equity-uprise-hq).

   Rules: js/prim3-tactics/tactical-resolver.mjs, tactical-hints.mjs and tactical-threat-ai.mjs are exact
   copies of mcclusterishere/Prim3 (SOURCE.json). This page never decides a rule. An action is offered
   only if the engine accepts it: legality is found by dry-running the engine's own pure functions on
   the current state (nothing is committed until Confirm). Hostiles act through the canonical threat AI.

   What the player sees is the engine's player projection (fog of war): unseen hostiles are never
   drawn, listed, animated or used for previews. */
import { createState, beginPlayerPhase, beginThreatPhase, resolveClockStatePhase, moveUnit, fireWeapon,
  enterOverwatch, hunkerDown, reload, shotPreview, stabilize, technicalAction, extractUnit, missionComplete, drawRolls, hasLineOfSight, gridDistance,
  techActionPreview, jamMachine, syncPulse, markMachine } from './tactical-resolver.mjs';
import { playerProjection, knownPaths } from './tactical-hints.mjs';
import { runThreatPhase } from './tactical-threat-ai.mjs';
import { loadLevel } from './levels/index.mjs';
import { operatorHeight } from './scale.mjs';
import { DATA_URL as WORLD_MISSIONS, DRAFT_KEY as WORLD_DRAFTS, findMission } from '../prim3-world/missions.mjs';

const LEVEL = await loadLevel(new URLSearchParams(location.search).get('level'));
const { SCENE, W, H, toDisplay } = LEVEL;
// each level keeps its own save; Transit keeps the key it always had
const SAVE_KEY = 'prim3.transit.v1';
const SAVE = LEVEL.LEVEL_ID === 'transit-relay' ? SAVE_KEY : `prim3.level.${LEVEL.SAVE_ID || LEVEL.LEVEL_ID}.v1`;
// a level with a mission layer (Equity Uprise B1) hands the page its hooks; the rules stay the resolver's
const HOOKS = LEVEL.HOOKS || null;
// level copy: Transit's words are the defaults, so that level reads exactly as before
const LM = LEVEL.MISSION || {};
const OBJ_NODE = LM.node || 'RELAY', SIDE_NODE = LM.sideNode || 'GATE';
const OBJ = SCENE.relay || SCENE.objective;
const TXT = {
  title: LM.title || 'Transit / Relay', objective: LM.objective || 'Secure the relay', noun: LM.nodeLabel || 'Relay',
  link: LM.linkWord || 'Link', extract: LM.extractWord || 'Extract', pad: LM.extractPlace || 'the yellow pad',
  objLine: LM.objectiveLine || 'T must connect twice.', doneLine: LM.doneLine || 'Relay linked.',
  logLink: LM.logLink || ((n) => `T links the relay (${n}/2).`), logDone: LM.logDone || 'Relay linked. Extract at the south-west pad.',
  logBreach: LM.logBreach || 'E breaches the service gate.', held: LM.held || 'The gate held', refused: LM.refused || 'The relay refused the link',
  doneTitle: LM.doneTitle || 'Relay secured', failT: LM.failT || 'Technical was lost. The relay cannot be linked.'
};
const floorName = (z) => (LEVEL.floorName ? LEVEL.floorName(z) : z ? 'roof' : '');
if (LEVEL.LEVEL_ID !== 'transit-relay') { // the page's own headings follow the level
  document.title = `PRIM3 ${TXT.title}`;
  const h = document.querySelector('.tx-title b'); if (h) h.textContent = TXT.title;
  const h1 = document.querySelector('main.tx h1'); if (h1) h1.textContent = `PRIM3 · ${TXT.title}`;
  const lg = document.querySelector('.lg--re'); if (lg) lg.lastChild.textContent = TXT.noun;
  const mh = document.querySelector('.tx-maphead small'); if (mh) mh.textContent = `${W} × ${H} · tap to look`;
  const help = document.querySelectorAll('.tx-about p'); // the level's own objective and coordinate lines
  if (LM.help && help.length >= 4) { help[2].innerHTML = LM.help[0]; help[3].innerHTML = LM.help[1]; }
}
const LOOK_KEY = 'prim3.tactics.look';
const GFX_KEY = 'prim3.tactics.preview.gfx';
const PARAMS = new URLSearchParams(location.search);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ROLE = {
  E: { name: 'Entry', line: 'Protect the approach. Breach the service gate.', img: 'assets/img/prim3-operators/E-portrait.jpg' },
  R: { name: 'Recon', line: 'Overwatch. Longest sight and the scoped rifle.', img: 'assets/img/prim3-operators/R-portrait.jpg' },
  T: { name: 'Tech', line: 'Reach the relay and link it twice. Keep T alive.', img: 'assets/img/prim3-operators/T-portrait.jpg' }
};
for (const [k, line] of Object.entries(LM.roles || {})) if (ROLE[k]) ROLE[k].line = line;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const D = (x, y) => { const d = toDisplay(x, y); return `(${d.X}, ${d.Y})`; };
// Every roll comes from the engine's seeded generator, which is saved with the state: reloading the page
// cannot re-roll a shot, a reaction or a hostile turn.

/* ---------- state, save ---------- */
function fresh() { const seed = Number(PARAMS.get('seed')) || (Date.now() % 1e9); return HOOKS ? HOOKS.createState(seed) : beginPlayerPhase(createState(LEVEL.engineConfig({ seed }))); }
function load() {
  try { const s = JSON.parse(localStorage.getItem(SAVE) || 'null'); return s && s.v === 1 && s.state && Array.isArray(s.state.units) ? s.state : null; } catch (e) { return null; }
}
function save() { try { localStorage.setItem(SAVE, JSON.stringify({ v: 1, at: Date.now(), state, log: log.slice(-60) })); } catch (e) {} }
let state = (PARAMS.get('new') === '1' ? null : load()) || fresh();
let log = (() => { try { const s = JSON.parse(localStorage.getItem(SAVE) || 'null'); return (s && s.log) || []; } catch (e) { return []; } })();
let ui = { sel: 'T1', mode: null, preview: null, busy: false, mapOpen: false, setOpen: false, ended: null, objOpen: false, briefed: false };
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
const relayLinks = () => ({ OBSERVED: 0, WORK_IN_PROGRESS: 1, VERIFIED: 2 }[nodeState(OBJ_NODE)] ?? 0);
const gateOpen = () => nodeState(SIDE_NODE) === 'VERIFIED';
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
  const vis = new Uint8Array(W * H), sel = unitOf(ui.sel), selZ = sel ? sel.z : 0;
  // the squad's own working cameras see for it (the engine's rule); a blinded camera sees nothing
  const eyes = [...state.units.filter((u) => u.faction === 'PLAYER' && !u.dead && !u.downed && !extracted(u)),
    ...(state.machines || []).filter((m) => m.kind === 'CAMERA' && m.faction === 'PLAYER' && (m.state === 'ACTIVE' || m.state === 'CONTROLLED'))];
  for (const u of eyes) {
    const r = u.detectionRadius;
    for (let y = Math.max(0, u.y - r); y <= Math.min(H - 1, u.y + r); y += 1) for (let x = Math.max(0, u.x - r); x <= Math.min(W - 1, u.x + r); x += 1) {
      const i = y * W + x; if (vis[i]) continue;
      const t = { x, y, z: LEVEL.fogFloor ? LEVEL.fogFloor(x, y, selZ) : 0 };
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
  if (HOOKS && u && ok) for (const a of HOOKS.actions(state, u.id)) add(a.id, a.label, a.sub, true, true);
  // T technology control and R marks, offered only when the resolver's own preview says they are legal
  if (u && ok && Array.isArray(state.machines)) for (const a of machineActions(u)) add(a.id, a.label, a.sub, true, true);
  if (!HOOKS && u && u.role === 'T' && nodeState(OBJ_NODE) !== 'VERIFIED') {
    const act = nodeState(OBJ_NODE) === 'OBSERVED' ? 'LINK_1' : 'LINK_2';
    const can = ok && !!tryRun(() => technicalAction(state, u.id, OBJ_NODE, act));
    if (can) add('link', `${TXT.link} ${relayLinks() + 1}/2`, '1 AP', true, true);
  }
  if (!HOOKS && u && u.role === 'E' && !gateOpen() && ok && tryRun(() => technicalAction(state, u.id, SIDE_NODE, 'BREACH'))) add('breach', LM.breachWord || 'Breach', '1 AP', true, true);
  if (u && ok) for (const d of state.units.filter((x) => x.faction === 'PLAYER' && x.downed && !x.dead && x.id !== u.id)) {
    if (tryRun(() => stabilize(state, u.id, d.id))) add('stab:' + d.id, 'Stabilize ' + d.role, '1 AP', true, true);
  }
  if (u && ok && nodeState(OBJ_NODE) === 'VERIFIED' && tryRun(() => extractUnit(state, u.id))) add('extract', TXT.extract, 'free', true, true);
  return A;
}

// machines: the first legal Jam, one Sync Pulse at a camera's cell, one Mark (labels stay short on a phone)
function machineActions(u) {
  const out = [], cams = (state.machines || []).filter((m) => m.kind === 'CAMERA' && m.faction !== 'PLAYER');
  if (u.role === 'T') {
    const jam = cams.find((m) => techActionPreview(state, 'JAM', u.id, m.id).legal);
    if (jam) out.push({ id: 'jam:' + jam.id, label: 'Jam ' + shortId(jam.id), sub: '1 AP' });
    const pulse = cams.find((m) => m.state === 'ACTIVE' && techActionPreview(state, 'SYNC_PULSE', u.id, { x: m.x, y: m.y, z: m.z }).legal);
    if (pulse) out.push({ id: 'pulse:' + pulse.id, label: 'Sync Pulse', sub: '1 AP · once' });
  }
  if (u.role === 'R') { const mk = cams.find((m) => techActionPreview(state, 'MARK', u.id, m.id).legal); if (mk) out.push({ id: 'mark:' + mk.id, label: 'Mark ' + shortId(mk.id), sub: '1 AP' }); }
  return out;
}
const shortId = (id) => String(id).replace(/^[A-Z0-9]+-SEC-/, '');

/* ---------- 3D ---------- */
let r3 = null, r3loading = null;
function webgl() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
function ensure3d() {
  if (r3 || r3loading || !webgl()) return;
  r3loading = import('./level3d.mjs').then((mod) => {
    r3 = mod.createLevel3D($('tx3d'), { level: LEVEL, look, fx: PARAMS.get('fx') || (gfx === 'auto' ? null : gfx), reducedMotion: REDUCED, onTap, onView: null });
    r3loading = null; fogKey = ''; // a new board needs its fog
    r3.setGrid(gridOn);
    const s = unitOf(ui.sel);
    if (LEVEL.OPENING && state.round <= 1 && r3.frame) r3.frame(LEVEL.OPENING); // a level's own opening shot (the tower, large)
    else if (s) r3.focus((s.x + OBJ.x) / 2, (s.y + OBJ.y) / 2 + Math.min(4, H / 16), 0, LEVEL.OPENING_DIST || Math.min(30, Math.max(W, H) * 1.2)); // a level may open wider (a tower)
    render();
  }).catch((e) => { r3loading = null; toast('The 3D view could not load here. ' + esc(e.message || '')); });
}

// a building level's cutaway: the storey of the selected operative; Floor 1 as soon as anyone is inside or a
// move can reach inside; the whole building while the squad is still on the street
function cutStorey(sel) {
  if (!LEVEL.storeyOf) return undefined;
  if (sel && !sel.dead && sel.z >= 1) return LEVEL.storeyOf(sel.z);
  if ((ui.mode === 'move' || ui.mode === 'dash') && ui.reach && ui.reach.tiles.some((t) => t.z >= 1)) return LEVEL.storeyOf(1);
  if (state.units.some((u) => u.faction === 'PLAYER' && !u.dead && !extracted(u) && u.z >= 1)) return LEVEL.storeyOf(1);
  return null;
}
function boardModel() {
  const p = view(), sel = unitOf(ui.sel);
  const units = p.units.filter((u) => !extracted(u));
  const m = { units, selected: ui.sel, labels: [], extraction: SCENE.showExtraction === false ? null : undefined, gateOpen: gateOpen(), cut: cutStorey(sel), coverAt: (u) => { const c = state.cover.find((k) => k.x === u.x && k.y === u.y && (k.z || 0) === (u.z || 0)); return c ? c.type : null; } };
  if (ui.mode === 'move' || ui.mode === 'dash') { m.reach = ui.reach.tiles; }
  if (ui.preview && ui.preview.kind === 'move') { m.path = ui.preview.path.slice(0, -1); m.dest = ui.preview.dest; m.pathLine = [{ x: sel.x, y: sel.y, z: sel.z }, ...ui.preview.path]; }
  if (ui.preview && ui.preview.kind === 'fire') m.target = ui.preview.target;
  for (const u of units) if (!u.dead) m.labels.push({ id: u.id, x: u.x, y: u.y, z: u.z, h: operatorHeight(LEVEL.WORLD_M || LEVEL.TILE_M) + 0.3, kind: u.faction === 'PLAYER' ? 'ally' : 'hostile', text: u.faction === 'PLAYER' ? u.role : esc(u.id) });
  if (HOOKS) {
    m.labels.push({ x: OBJ.x, y: OBJ.y, z: OBJ.z || 0, h: 0.5, kind: 'obj', text: 'Console' });
    if (SCENE.rack) m.labels.push({ x: SCENE.rack.x, y: SCENE.rack.y, z: SCENE.rack.z, h: 0.5, kind: 'obj', text: 'Rack' });
  } else m.labels.push({ x: OBJ.x, y: OBJ.y, z: OBJ.z || 0, h: LEVEL.OBJ_LABEL_H || 2.6, kind: 'obj', text: `${TXT.noun} ${relayLinks()}/2` });
  for (const g of cameraGroups()) m.labels.push({ x: g.x, y: g.y, z: g.z, h: 2.1, kind: `machine ${g.live ? 'is-live' : 'is-down'}`, text: `CAM ${g.live}/${g.n}` });
  if (!HOOKS && nodeState(OBJ_NODE) === 'VERIFIED') m.labels.push({ x: SCENE.extraction.x, y: SCENE.extraction.y, h: 0.4, kind: 'obj', text: TXT.extract });
  if (ui.preview && ui.preview.kind === 'move') { const d = ui.preview.dest; m.labels.push({ x: d.x, y: d.y, z: d.z, h: 0.1, kind: 'info', text: `${D(d.x, d.y)} · ${ui.preview.steps} steps` }); }
  return m;
}

// cameras the player knows of, grouped by cell (B1's four share the telecom core)
function cameraGroups() {
  const known = (view().machines || []).filter((m) => m.kind === 'CAMERA');
  const by = new Map();
  for (const m of known) { const k = `${m.x}:${m.y}:${m.z}`; const g = by.get(k) || { x: m.x, y: m.y, z: m.z, n: 0, live: 0 }; g.n += 1; if (m.state === 'ACTIVE' || m.state === 'CONTROLLED') g.live += 1; by.set(k, g); }
  return [...by.values()];
}
function objectiveModel() {
  const clock = state.mission ? `${state.mission.escalation} · clock ${state.mission.clock}` : '';
  const brief = MISSION ? esc(MISSION.briefing) : (LM.brief ? esc(LM.brief) : '');
  const small = MISSION ? `${MISSION.deployment === 'wildcard-call' ? 'Wildcard call' : 'Mission'} · ${esc(MISSION.character.name)}` : 'Objective';
  // a World mission dresses the strip: its title up front, the level's objective in the details
  if (MISSION) return { small, title: esc(MISSION.title), progress: HOOKS ? esc(HOOKS.objective(state).progress) : `${relayLinks()}/2`, line: `${TXT.objective}: ${TXT.objLine} ${esc(clock)}`, brief };
  if (HOOKS) { const o = HOOKS.objective(state); return { small, title: esc(o.title), progress: esc(o.progress), line: esc(o.line), brief }; }
  if (nodeState(OBJ_NODE) === 'VERIFIED') return { small, title: TXT.extract, progress: `${TXT.link} 2/2`, line: `${TXT.doneLine} Everyone standing to ${TXT.pad} ${D(SCENE.extraction.x, SCENE.extraction.y)}. ${esc(clock)}`, brief };
  return { small, title: TXT.objective, progress: `${relayLinks()}/2`, line: `${TXT.objLine} ${TXT.link} ${relayLinks()}/2. ${esc(clock)}`, brief };
}

/* ---------- rendering ---------- */
function render() {
  const sel = unitOf(ui.sel);
  if (!r3 && !r3loading) ensure3d();
  if (r3 && !ui.holdBoard) r3.update(boardModel()); // frozen while engine events play out
  if (r3 && !ui.holdBoard) { const k = state.units.filter((u) => u.faction === 'PLAYER').map((u) => `${u.x},${u.y},${u.z},${u.dead},${u.downed}`).join('|') + state.round + (state.machines || []).map((q) => q.state).join() + ui.sel; if (k !== fogKey) { fogKey = k; lastVis = visibleTiles(); r3.setFog(fogCells(lastVis)); } }
  // top bar
  $('txTurn').textContent = String(state.round).padStart(2, '0');
  const ph = $('txPhase'); ph.textContent = ui.ended ? (ui.ended === 'win' ? 'Complete' : 'Failed') : state.phase === 'PLAYER' && !ui.busy ? 'Your move' : 'Threat move';
  ph.classList.toggle('is-threat', !!ui.busy || state.phase !== 'PLAYER');
  $('txBusy').hidden = !ui.busy;
  $('txCoord').textContent = sel ? (() => { const d = toDisplay(sel.x, sel.y); return `${sel.role} (${d.X}, ${d.Y}${sel.z ? ', ' + floorName(sel.z) : ''})`; })() : '';
  $('txGrid').setAttribute('aria-pressed', String(gridOn)); $('txGrid').lastChild.textContent = gridOn ? 'Grid on' : 'Grid off';
  // objective
  const links = relayLinks();
  const clock = state.mission ? `${state.mission.escalation} · clock ${state.mission.clock}` : '';
  const O = objectiveModel();
  $('txObj').innerHTML = `<button type="button" class="tx-objbtn" id="txObjBtn" aria-expanded="${ui.objOpen}" aria-controls="txObjMore"><small>${O.small}</small><b>${O.title}</b><span class="tx-objprog">${O.progress}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>`
    + `<div class="tx-objmore" id="txObjMore"><span>${O.line}</span>${O.brief ? `<span class="tx-brief">${O.brief}</span>` : ''}</div>`;
  $('txObj').classList.toggle('is-open', !!ui.objOpen);
  // selected operative
  if (sel) {
    const R = ROLE[sel.role];
    const st = [sel.downed ? 'downed' : '', sel.overwatch ? 'overwatch' : '', sel.hunkered ? 'hunkered' : '', extracted(sel) ? 'extracted' : '', sel.z ? (LEVEL.floorName ? 'on ' + floorName(sel.z) : 'on the roof') : ''].filter(Boolean).join(' · ');
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
      <p class="sh-main">${D(sel.x, sel.y)} → <b>${D(pv.dest.x, pv.dest.y)}</b>${pv.dest.z ? ' ' + floorName(pv.dest.z) : ''} · ${pv.steps} steps · ${pv.dash ? 2 : 1} AP${cv ? ' · ' + (cv.type === 'HIGH' ? 'high' : 'low') + ' cover' : ' · no cover'}</p>
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
  const S = Math.min(mini.width / W, mini.height / H), MK = Math.min(S, mini.width / 40), g = mctx, studio = look === 'studio', day = look === 'day';
  const col = day ? { bg: '#f4f6f6', ground: '#e7ebec', water: '#4fb3b8', bld: '#c2c8cb', roof: '#d3d8da', prop: '#cfd4d6', grid: 'rgba(20,40,50,.10)', ink: '#16202a', sq: '#0fa9ba', th: '#d81f2a', amber: '#d98a0a' }
    : studio ? { bg: '#eef0f1', ground: '#e2e5e7', water: '#c9d3d8', bld: '#a9b0b5', roof: '#8e979d', prop: '#bcc2c6', grid: 'rgba(0,0,0,.08)', ink: '#14191c', sq: '#ff2a3a', th: '#3d8bff', amber: '#2a3136' }
    : { bg: '#0b1116', ground: '#121a20', water: '#0e3a44', bld: '#3a444c', roof: '#4b565f', prop: '#2a333a', grid: 'rgba(120,220,235,.08)', ink: '#cfe3ea', sq: '#2fe0f0', th: '#ff3b3b', amber: '#ffb547' };
  g.fillStyle = col.bg; g.fillRect(0, 0, mini.width, mini.height);
  g.fillStyle = col.ground; g.fillRect(0, 0, W * S, H * S);
  g.strokeStyle = col.grid; g.lineWidth = 1;
  for (let i = 0; i <= W; i += 4) { g.beginPath(); g.moveTo(i * S, 0); g.lineTo(i * S, H * S); g.stroke(); g.beginPath(); g.moveTo(0, i * S); g.lineTo(W * S, i * S); g.stroke(); }
  if (SCENE.kind === 'building') drawBuildingMap(g, S, col);
  else {
  g.fillStyle = col.water; g.fillRect(SCENE.canal.x * S, SCENE.canal.y * S, SCENE.canal.w * S, SCENE.canal.d * S);
  g.fillStyle = col.prop; for (const b of SCENE.bridges) g.fillRect(b.x * S, b.y * S, b.w * S, b.d * S);
  for (const b of SCENE.buildings) { g.fillStyle = b.roof ? col.roof : col.bld; g.fillRect(b.x * S, b.y * S, b.w * S, b.d * S); g.fillStyle = col.ink; g.font = `700 ${S * 1.8}px system-ui`; g.fillText(b.label, (b.x + 0.6) * S, (b.y + 2) * S); }
  const sb = SCENE.skybridge; g.fillStyle = col.roof; g.fillRect(sb.x * S, sb.y * S, sb.w * S, sb.d * S);
  g.fillStyle = col.prop; for (const c of [...SCENE.containers, ...SCENE.barricades, ...SCENE.crates, SCENE.tent]) g.fillRect(c.x * S, c.y * S, c.w * S, c.d * S);
  g.strokeStyle = gateOpen() ? col.prop : col.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(SCENE.fence.x0 * S, (SCENE.fence.y + 0.5) * S); g.lineTo((SCENE.fence.x1 + 1) * S, (SCENE.fence.y + 0.5) * S); g.stroke();
  }
  // extraction, objective, cameras
  if (SCENE.showExtraction !== false) { g.strokeStyle = '#ffd23a'; g.lineWidth = 2; g.beginPath(); g.arc((SCENE.extraction.x + 0.5) * S, (SCENE.extraction.y + 0.5) * S, (SCENE.extraction.r + 0.5) * S, 0, Math.PI * 2); g.stroke(); }
  for (const c of cameraGroups()) { g.fillStyle = c.live ? col.sq : col.th; g.beginPath(); g.arc((c.x + 0.82) * S, (c.y + 0.18) * S, MK * 0.7, 0, Math.PI * 2); g.fill(); }
  const rx = (OBJ.x + 0.5) * S, ry = (OBJ.y + 0.5) * S, rk = MK * 1.4; // marks keep their size on a small map
  g.strokeStyle = col.amber; g.lineWidth = 3; g.beginPath(); g.moveTo(rx, ry - rk); g.lineTo(rx + rk, ry); g.lineTo(rx, ry + rk); g.lineTo(rx - rk, ry); g.closePath(); g.stroke();
  // reach and path
  if (ui.reach && (ui.mode === 'move' || ui.mode === 'dash')) { g.fillStyle = studio ? 'rgba(20,25,28,.12)' : 'rgba(47,224,240,.16)'; for (const t of ui.reach.tiles) g.fillRect(t.x * S, t.y * S, S, S); }
  if (ui.preview && ui.preview.kind === 'move') { const sel = unitOf(ui.sel); g.strokeStyle = col.amber; g.setLineDash([S, S * 0.6]); g.lineWidth = 2; g.beginPath(); g.moveTo((sel.x + 0.5) * S, (sel.y + 0.5) * S); for (const p of ui.preview.path) g.lineTo((p.x + 0.5) * S, (p.y + 0.5) * S); g.stroke(); g.setLineDash([]); }
  if (lastVis) { for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) { const i = y * W + x; if (lastVis[i]) continue; g.fillStyle = explored[i] ? (studio || day ? 'rgba(30,40,48,.18)' : 'rgba(0,0,0,.35)') : (studio || day ? 'rgba(30,40,48,.34)' : 'rgba(0,0,0,.6)'); g.fillRect(x * S, y * S, S, S); } }
  // units: squad and only the hostiles the player knows about
  for (const u of view().units) {
    if (u.dead || extracted(u)) continue;
    const ally = u.faction === 'PLAYER', x = (u.x + 0.5) * S - MK * 0.5, y = (u.y + 0.5) * S - MK * 0.5;
    g.strokeStyle = ally ? col.sq : col.th; g.lineWidth = 2; g.fillStyle = studio || day ? 'rgba(255,255,255,.92)' : 'rgba(5,8,11,.85)';
    g.fillRect(x - MK * 0.9, y - MK * 0.9, MK * 2.8, MK * 2.8); g.strokeRect(x - MK * 0.9, y - MK * 0.9, MK * 2.8, MK * 2.8);
    g.fillStyle = ally ? col.sq : col.th; g.font = `800 ${MK * 1.7}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ally ? u.role : u.id, x + MK * 0.5, y + MK * 0.5); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    if (u.id === ui.sel) { g.strokeStyle = col.ink; g.strokeRect(x - MK * 1.3, y - MK * 1.3, MK * 3.6, MK * 3.6); }
  }
}
// a building level's sector map: site zones, the plate, its closed rooms and cores, the doors
function drawBuildingMap(g, S, col) {
  const cell = (c, fill) => { g.fillStyle = fill; g.fillRect(c.x * S, c.y * S, S, S); };
  const tone = { street: col.bld, walk: col.prop, service: col.prop, assembly: 'rgba(255,210,58,.28)' };
  for (const z of SCENE.zones || []) for (const c of z.cells) cell(c, tone[z.kind] || col.prop);
  const p = SCENE.plate; g.fillStyle = col.roof; g.fillRect(p.x * S, p.y * S, p.w * S, p.d * S);
  for (const c of [...(SCENE.floor1Rooms || []), ...Object.values(SCENE.core || {}).flat()]) cell(c, col.bld);
  g.fillStyle = col.ink; g.font = `700 ${Math.max(10, S * 0.32)}px system-ui`;
  for (const s of SCENE.stairCores || []) { const c = s.cells[0]; g.fillText(s.name.replace('Stair ', 'S'), (c.x + 0.18) * S, (c.y + 0.62) * S); }
  g.strokeStyle = col.ink; g.lineWidth = 2; g.strokeRect(p.x * S, p.y * S, p.w * S, p.d * S);
  for (const d of SCENE.doors || []) { const open = d.open || gateOpen(); g.strokeStyle = open ? col.amber : col.ink; g.lineWidth = 4; const mx = (d.in.x + d.out.x + 1) / 2 * S, my = (d.in.y + d.out.y + 1) / 2 * S, v = d.in.x === d.out.x;
    g.beginPath(); if (v) { g.moveTo(mx - S * 0.35, my); g.lineTo(mx + S * 0.35, my); } else { g.moveTo(mx, my - S * 0.35); g.lineTo(mx, my + S * 0.35); } g.stroke(); }
}
mini.addEventListener('click', (e) => {
  const r = mini.getBoundingClientRect(), S = Math.min(mini.width / W, mini.height / H);
  const x = Math.min(W - 1, Math.floor((e.clientX - r.left) / r.width * mini.width / S)), y = Math.min(H - 1, Math.floor((e.clientY - r.top) / r.height * mini.height / S));
  if (r3) r3.focus(x, y, 0, Math.min(22, Math.max(W, H) * 1.2));
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
function select(id) { ui.sel = id; ui.mode = null; ui.preview = null; toastMsg = ''; const u = unitOf(id); if (r3 && u) r3.focus(u.x, u.y, u.z, Math.min(22, Math.max(W, H) * 1.2)); render(); }
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
    else if (id.startsWith('eu:')) { const out = HOOKS.perform(state, id, sel.id); state = out.state; if (out.log) say(out.log); }
    else if (id.startsWith('jam:')) { state = HOOKS ? HOOKS.sync(jamMachine(state, sel.id, id.slice(4))) : jamMachine(state, sel.id, id.slice(4)); say(`T jams ${shortId(id.slice(4))} until T's next turn.`); }
    else if (id.startsWith('pulse:')) { const m = state.machines.find((x) => x.id === id.slice(6)); state = syncPulse(state, sel.id, { x: m.x, y: m.y, z: m.z }); if (HOOKS) state = HOOKS.sync(state); say('T fires the Sync Pulse: every machine within 3 is jammed for a round, nearby hostiles lose their network.'); }
    else if (id.startsWith('mark:')) { state = markMachine(state, sel.id, id.slice(5)); say(`R marks ${shortId(id.slice(5))}.`); }
    else if (id === 'link') { const act = nodeState(OBJ_NODE) === 'OBSERVED' ? 'LINK_1' : 'LINK_2'; const out = technicalAction(state, sel.id, OBJ_NODE, act); if (!out.accepted) throw new Error(TXT.refused); state = out.state; say(TXT.logLink(relayLinks())); if (relayLinks() === 2) say(TXT.logDone); }
    else if (id === 'breach') { const out = technicalAction(state, sel.id, SIDE_NODE, 'BREACH'); if (!out.accepted) throw new Error(TXT.held); state = out.state; say(TXT.logBreach); }
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
  if (HOOKS) { const a = HOOKS.afterThreat(next); next = a.state; for (const l of a.log) say(l); }
  const events = next.events.slice(before.events.length);
  // the whole hostile turn is resolved and saved before any of it is shown: a reload mid-turn lands
  // on the outcome, never back before End turn
  state = beginPlayerPhase(resolveClockStatePhase(next));
  if (HOOKS) state = HOOKS.sync(state);
  save();
  await play(events, before);
  say(`New round. Escalation ${state.mission.escalation}.`);
  const s = unitOf(ui.sel); if (!s || s.dead || s.downed || extracted(s)) { const n = state.units.find((u) => u.faction === 'PLAYER' && !u.dead && !u.downed && !extracted(u)); if (n) ui.sel = n.id; }
  afterChange();
}

const LOSE = { 'lose-t': () => TXT.failT, 'lose-all': () => 'No one is left standing.', 'lose-clock': () => 'The exercise window closed.', 'lose-verified': () => 'A defender verified a live picture: the red team is on camera.', 'lose-downed': () => 'A downed operative cannot be brought out: the exercise cannot be completed.' };
function checkEnd() {
  if (HOOKS) return HOOKS.outcome(state);
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
      ? `<div><h2>${TXT.doneTitle}</h2><p>Turn ${state.round}.${state.mission.extractionRequired ? ` ${out} of ${squad.length} extracted.` : ''}</p>${debriefHtml()}<button type="button" class="sh-btn sh-btn--go" data-sheet="restart">Play again</button></div>`
      : `<div><h2>Mission failed</h2><p>${(LOSE[end] || LOSE['lose-all'])()}</p>${debriefHtml()}<button type="button" class="sh-btn sh-btn--go" data-sheet="restart">Try again</button></div>`;
    $('txEnd').hidden = false;
    say(end === 'win' ? 'Mission complete.' : 'Mission failed.');
  }
  save(); render();
}
function debriefHtml() { return HOOKS ? `<ul class="sh-list" style="text-align:left;max-width:34rem;margin:0 auto 12px">${HOOKS.debrief(state).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''; }
// the briefing: a mission level opens on its brief, over the board (Start dismisses it)
function showBrief() {
  if (!HOOKS || ui.briefed || state.round > 1 || ui.ended) return;
  $('txEnd').innerHTML = `<div><h2>${esc(TXT.title)}</h2><p style="max-width:34rem;margin:0 auto 12px;text-align:left">${esc(LM.brief || '')}</p><button type="button" class="sh-btn sh-btn--go" data-sheet="brief-go">Start</button></div>`;
  $('txEnd').hidden = false;
}
function restart() {
  try { localStorage.removeItem(SAVE); } catch (e) {}
  explored = new Uint8Array(W * H); fogKey = '';
  state = fresh(); log = []; ui = { ...ui, sel: 'T1', mode: null, preview: null, reach: null, busy: false, ended: null };
  $('txEnd').hidden = true; say(`Deployed. ${TXT.objective}.`); ui.briefed = false;
  if (MISSION) log.unshift(missionLine(MISSION));
  if (r3) { r3.destroy(); r3 = null; }
  save(); render(); showBrief();
}

/* ---------- wiring ---------- */
$('txSquad').addEventListener('click', (e) => { const b = e.target.closest('[data-unit]'); if (b && !ui.busy) select(b.dataset.unit); });
$('txActs').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) onAct(b.dataset.act); });
$('txSheet').addEventListener('click', (e) => { const b = e.target.closest('[data-sheet]'); if (b) onSheet(b.dataset.sheet); });
$('txEnd').addEventListener('click', (e) => { if (e.target.closest('[data-sheet="restart"]')) restart(); else if (e.target.closest('[data-sheet="brief-go"]')) { ui.briefed = true; $('txEnd').hidden = true; } });
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
if (!log.length) say(`Deployed. ${TXT.objective}.`);
if (HOOKS && HOOKS.sideSwitch) { // a side switch in the settings: each side is its own exercise and save
  const row = document.createElement('div'); row.className = 'set-row';
  const p = new URLSearchParams(location.search); p.set('side', HOOKS.sideSwitch); p.set('new', '1');
  row.innerHTML = `<span class="sh-eye">Side</span><div class="seg"><a class="seg-a" href="?${esc(p.toString())}">Play the ${HOOKS.sideSwitch === 'attack' ? 'red team: Blind the Floor' : 'defenders: Restore the Picture'}</a></div>`;
  $('txSet').insertBefore(row, $('txSet').children[2]);
}
render();
showBrief();
if (HOOKS && ui.ended == null) { const end = checkEnd(); if (end) afterChange(); }
if (MISSION_ID) {
  const fromDraft = () => { try { return findMission(JSON.parse(localStorage.getItem(WORLD_DRAFTS) || 'null'), MISSION_ID); } catch (e) { return null; } };
  fetch(WORLD_MISSIONS).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((d) => findMission(d, MISSION_ID) || fromDraft())
    .then((m) => {
      if (!m || typeof m.title !== 'string' || !m.character || typeof m.briefing !== 'string') return;
      MISSION = m;
      document.title = `${m.title} · PRIM3 ${TXT.title}`;
      if (!log.some((l) => l.startsWith(`T01 · Mission: ${m.title} ·`))) { log.unshift(missionLine(m)); save(); }
      render();
    });
}
$('txObj').addEventListener('click', (e) => { if (e.target.closest('#txObjBtn')) { ui.objOpen = !ui.objOpen; render(); } });
window.__tx = { get state() { return state; }, get ui() { return ui; }, get r3() { return r3; }, get busy() { return ui.busy || !!(r3 && r3.isAnimating()); }, select, onAct, onSheet, onTap, endTurn, restart, reach: () => ui.reach, SAVE_KEY: SAVE };
