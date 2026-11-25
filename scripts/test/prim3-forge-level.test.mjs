// PRIM3 Level Forge → the canonical game. One level format (js/prim3-tactics/levels/*.mjs), one engine
// (the vendored resolver), one White Industrial kit, 3.54 m tiles. The round trip below authors a level as the
// Forge stores it, checks it with the resolver, plays it to a finished mission with the resolver's own
// moves, and hands it back the way the page does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as R from '../../js/prim3-tactics/tactical-resolver.mjs';
import { TILE_M } from '../../js/prim3-tactics/scale.mjs';
import * as Transit from '../../js/prim3-tactics/levels/transit-relay.mjs';
import { LEVELS, loadLevel, FORGE_LEVEL } from '../../js/prim3-tactics/levels/index.mjs';
import { exportForgeLevel, validateForgeLevel, deriveCover, FORGE_KIT_RULES, PLAYTEST_KEY, loadPlaytest } from '../../js/prim3-tactics/levels/forge.mjs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const require = createRequire(import.meta.url);
const KIT_DIR = 'assets/3d/prim3-kit/white-industrial/';
const kit = JSON.parse(read(KIT_DIR + 'catalog.json'));
globalThis.PRIM3_ASSET_CATALOG = kit;
const Model = require('../../prim3-level-builder/model.js');

// a Forge document, authored as the editor stores it (1 m cells, +Y north, relay at the origin)
function authored() {
  const d = { ...Model.createBlank(), id: 'forge-roundtrip', title: 'Round trip' };
  const put = (assetId, x, y, extra = {}) => d.objects.push({ ...Model.newObject(assetId, x, y), id: `${assetId}-${x}-${y}`, ...extra });
  put('warehouse-16', -40, 10);                 // a roof at 8 m
  put('stairs-8', -34, 2);                      // its stair: foot south of the flight, landing on the roof's south edge
  put('crate-2', 6, -4); put('crate-2', 10, -4); // high cover
  put('low-barrier-4', -8, -8);                 // low cover
  put('concrete-tile-8', 16, -16);              // scenery
  d.spawns = [
    { id: 'E', role: 'E', team: 'player', x: -4, y: -30, layer: 0 },
    { id: 'R', role: 'R', team: 'player', x: 0, y: -32, layer: 0 },
    { id: 'T', role: 'T', team: 'player', x: 4, y: -30, layer: 0 },
    { id: 'H1', role: 'guard', team: 'enemy', x: 40, y: 40, layer: 0 }
  ];
  d.extraction = { x: 0, y: -40, radius: 6 };
  return d;
}

// move a unit toward a tile with the resolver's own path and range, one MOVE per call
function advance(state, id, target) {
  const full = R.findPath(state, id, target);
  assert.ok(full, `${id} has a route to ${JSON.stringify(target)}`);
  const u = state.units.find((q) => q.id === id), reach = R.computeReach(state, id, u.moveRange);
  for (let i = full.length - 1; i >= 0; i -= 1) {
    const c = full[i]; const cost = reach.costAt(c.x, c.y, c.z);
    if (cost !== undefined && cost <= u.moveRange && !state.units.some((o) => o !== u && !o.dead && o.x === c.x && o.y === c.y && o.z === c.z)) return R.moveUnit(state, id, c, 'MOVE');
  }
  throw new Error(`${id} cannot advance`);
}
const nextTurn = (state) => R.beginPlayerPhase(R.beginThreatPhase(state)); // the hostile stays put: this run tests the map, not the AI
const at = (state, id) => state.units.find((u) => u.id === id);

test('the Forge kit rules are the kit catalog: footprints and heights in metres, one entry per asset', () => {
  assert.deepEqual(Object.keys(FORGE_KIT_RULES).sort(), kit.assets.map((a) => a.id).sort());
  for (const a of kit.assets) {
    const r = FORGE_KIT_RULES[a.id];
    assert.equal(r.w, a.footprint.width, a.id); assert.equal(r.d, a.footprint.depth, a.id);
    assert.equal(r.h, a.height, a.id);
    if (r.surface != null) assert.equal(r.surface, a.surfaceHeight, a.id);
  }
});

test('one copy of the White Industrial kit: the Forge reads the game\'s, by path, and carries no duplicate', () => {
  assert.equal(existsSync(new URL('prim3-level-builder/assets', root)), false, 'the duplicate asset folder is gone');
  const js = read('prim3-level-builder/catalog.js');
  assert.deepEqual(JSON.parse(js.slice(js.indexOf('=') + 1).trim().replace(/;$/, '')), kit, 'the editor\'s embedded catalog is the kit catalog');
  const ui = read('prim3-level-builder/editor-ui.js');
  assert.match(ui, /const KIT = '\.\.\/assets\/3d\/prim3-kit\/white-industrial\/'/);
  assert.doesNotMatch(ui, /`assets\/(previews|\$\{asset\.model\})/);
  for (const a of kit.assets) {
    assert.ok(existsSync(new URL(KIT_DIR + a.model, root)), a.model);
    assert.ok(existsSync(new URL(`${KIT_DIR}previews/${a.id}.png`, root)), a.id + ' preview');
  }
});

test('no second engine and no Black Signal balance: the Black Signal runtime is gone, the editor only authors', () => {
  assert.equal(existsSync(new URL('prim3-level-builder/play', root)), false);
  for (const f of ['model.js', 'editor-ui.js', 'render.js', 'index.html', 'cloud-client.js']) {
    const src = read('prim3-level-builder/' + f);
    assert.doesNotMatch(src, /dashBudgets|play\/index\.html|customLevel/, f);
  }
  const worker = read('workers/mccluster/src/prim3/level-model.js');
  assert.doesNotMatch(worker, /dashBudgets/);
  // the Worker's structural model is the editor's, word for word (only the module wrapper differs)
  const body = (s) => s.slice(s.indexOf('  const catalog = { assets: [] }'), s.lastIndexOf('return {catalog'));
  assert.equal(body(worker), body(read('prim3-level-builder/model.js')));
});

test('the export is a level module in the shape every level in levels/ has, on 3.54 m tiles', () => {
  const { level, errors } = exportForgeLevel(authored());
  assert.deepEqual(errors, []);
  for (const k of ['LEVEL_ID', 'W', 'H', 'FLOORS', 'FRAME', 'toDisplay', 'SCENE', 'MISSION', 'surfaces', 'engineConfig']) assert.ok(k in level, k);
  for (const k of ['W', 'H', 'FLOORS', 'FRAME', 'toDisplay', 'SCENE', 'MISSION', 'surfaces', 'engineConfig']) assert.ok(k in Transit, 'transit has ' + k);
  assert.equal(level.TILE_M, TILE_M); assert.equal(TILE_M, 3.54);
  assert.equal(level.W, Math.round(128 / TILE_M)); assert.equal(level.H, 36);
  // the relay at Forge (0, 0) reads (0, 0); north stays +Y
  assert.deepEqual(level.toDisplay(level.SCENE.relay.x, level.SCENE.relay.y), { X: 0, Y: 0 });
  const t = level.engineConfig().units.find((u) => u.id === 'T1');
  assert.ok(level.toDisplay(t.x, t.y).Y < 0, 'the squad deploys south of the relay, as authored');
  const cfg = level.engineConfig();
  assert.deepEqual(cfg.surfaces.map((s) => s.height), [8]);
  assert.equal(cfg.links.length, 1); assert.equal(cfg.links[0].from.z, 0); assert.equal(cfg.links[0].to.z, 1);
  assert.ok(cfg.links[0].cost >= Math.abs(cfg.links[0].from.x - cfg.links[0].to.x) + Math.abs(cfg.links[0].from.y - cfg.links[0].to.y) + 1);
  // squad and hostiles carry Transit / Relay's numbers, nothing invented
  const transitUnits = Transit.engineConfig().units;
  for (const role of ['E', 'R', 'T']) {
    const mine = cfg.units.find((u) => u.role === role), theirs = transitUnits.find((u) => u.role === role);
    for (const k of ['hp', 'moveRange', 'aim', 'weaponDamage', 'ammo', 'detectionRadius']) assert.equal(mine[k], theirs[k], role + k);
  }
  assert.equal(cfg.units.find((u) => u.id === 'H1').aim, transitUnits.find((u) => u.id === 'H1').aim);
  // cover is Transit's rule: HIGH beside the crates, LOW beside the barrier
  assert.ok(cfg.cover.some((c) => c.type === 'HIGH')); assert.ok(cfg.cover.some((c) => c.type === 'LOW'));
  // props carry the kit pieces with no stand-in at their authored place
  assert.deepEqual(level.SCENE.props.map((p) => p.id), ['concrete-tile-8']);
});

test('cover is derived by the same rule as Transit / Relay\'s buildCover', () => {
  const blockers = Transit.buildBlockers();
  assert.deepEqual(deriveCover(blockers, Transit.surfaces(), Transit.W, Transit.H, Transit.FLOORS), Transit.buildCover(blockers));
});

test('ROUND TRIP: author → resolver check → play to a finished mission → back to the Forge', async () => {
  // 1. authored and structurally valid, as the editor stores it
  const doc = authored();
  assert.equal(Model.validate(doc, { playable: true }).ok, true);
  // 2. the resolver's check, the one Play test and the Worker's publish both run
  const v = validateForgeLevel(doc);
  assert.equal(v.ok, true, v.errors.join(' '));
  // 3. the hand-over and the page's hook: prim3-transit.html?level=forge loads exactly this level
  const store = new Map([[PLAYTEST_KEY, JSON.stringify(doc)]]);
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, val) => store.set(k, String(val)) };
  const hooked = loadPlaytest(storage);
  assert.equal(hooked.LEVEL_ID, 'forge-forge-roundtrip');
  assert.deepEqual(hooked.engineConfig(), v.level.engineConfig());
  assert.equal(FORGE_LEVEL, 'forge'); assert.ok(!(FORGE_LEVEL in LEVELS), 'a hook, not a listed level');
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try { assert.equal((await loadLevel('forge')).LEVEL_ID, 'forge-forge-roundtrip'); }
  finally { if (prev) Object.defineProperty(globalThis, 'localStorage', prev); else delete globalThis.localStorage; }
  // 4. play it with the resolver: R takes the stair to the roof and back, T links the relay twice, all extract
  const L = hooked; let s = R.beginPlayerPhase(R.createState(L.engineConfig({ seed: 7 })));
  const link = s.links[0], relay = L.SCENE.relay, zone = s.battlefield.extractionZone;
  const besideRelay = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => ({ x: relay.x + dx, y: relay.y + dy, z: 0 }))
    .find((p) => !s.blockers.some((b) => b.x === p.x && b.y === p.y && b.z === 0));
  let climbed = false;
  const tThere = () => at(s, 'T1').x === besideRelay.x && at(s, 'T1').y === besideRelay.y;
  for (let turn = 0; turn < 16 && !(tThere() && climbed); turn += 1) {
    for (let k = 0; k < 2 && !tThere(); k += 1) s = advance(s, 'T1', besideRelay);
    for (let k = 0; k < 2 && !climbed; k += 1) { s = advance(s, 'R1', link.to); climbed = at(s, 'R1').z === 1; }
    s = nextTurn(s);
  }
  assert.ok(climbed, 'R climbed the stair link onto the roof');
  for (const act of ['LINK_1', 'LINK_2']) { const out = R.technicalAction(s, 'T1', 'RELAY', act); assert.equal(out.accepted, true, act); s = out.state; if (act === 'LINK_1') s = nextTurn(s); }
  assert.equal(s.nodes.find((n) => n.id === 'RELAY').state, 'VERIFIED');
  for (let turn = 0; turn < 14; turn += 1) {
    for (const id of ['E1', 'R1', 'T1']) {
      const u = at(s, id); if (s.mission.extractedUnitIds.includes(id)) continue;
      const inZone = (q) => q.z === 0 && Math.abs(q.x - zone.x) + Math.abs(q.y - zone.y) <= zone.r;
      if (!inZone(u)) {
        const spot = [...Array(2 * zone.r + 1).keys()].flatMap((i) => [...Array(2 * zone.r + 1).keys()].map((j) => ({ x: zone.x - zone.r + i, y: zone.y - zone.r + j, z: 0 })))
          .filter((p) => inZone(p) && R.findPath(s, id, p)).sort((a, b) => R.findPath(s, id, a).length - R.findPath(s, id, b).length)[0];
        while (at(s, id).ap > 0 && !inZone(at(s, id))) s = advance(s, id, spot);
      }
      if (inZone(at(s, id))) { const out = R.extractUnit(s, id); s = out.state || out; }
    }
    if (R.missionComplete(s)) break;
    s = nextTurn(s);
  }
  assert.equal(R.missionComplete(s), true, 'the mission finishes under the canonical rules');
  // 5. back to the editor: the page links to the Forge, and the Forge reopens the draft it saved before leaving
  assert.deepEqual(L.RETURN, { href: 'prim3-level-builder/index.html', label: 'Level Forge' });
  assert.match(read('js/prim3-tactics/transit.mjs'), /if \(LEVEL\.RETURN\) \{[\s\S]*back\.href = LEVEL\.RETURN\.href/);
  assert.match(read('prim3-level-builder/editor-ui.js'), /const PLAY_URL = '\.\.\/prim3-transit\.html\?level=forge&new=1'/);
  assert.match(read('prim3-level-builder/editor-ui.js'), /localStorage\.getItem\(LOCAL_ACTIVE\)/);
});

test('the resolver refuses what cannot be finished: a walled-off relay, a stair to nowhere, a teleport link', () => {
  const walled = authored();
  for (let x = -64; x < 64; x += 8) walled.objects.push({ id: `wall-${x + 64}`, assetId: 'wall-8', x, y: -20, rotation: 0, elevation: 0, scale: 1 });
  assert.match(validateForgeLevel(walled).errors.join(' '), /Technical has no walkable route to the relay/);
  const nowhere = authored(); nowhere.objects = nowhere.objects.filter((o) => o.assetId !== 'warehouse-16');
  assert.match(validateForgeLevel(nowhere).warnings.join(' '), /does not meet a roof/);
  const teleport = authored(); teleport.connections = [{ id: 'jump', from: { x: 4, y: -30, layer: 0 }, to: { x: 30, y: 30, layer: 0 }, cost: 1 }];
  assert.match(validateForgeLevel(teleport).errors.join(' '), /costs less than its travel distance/);
  const missing = authored(); missing.spawns = missing.spawns.filter((p) => p.id !== 'T');
  assert.match(validateForgeLevel(missing).errors.join(' '), /Place the T operative/);
});

test('the Forge page is owner-only and unindexed, like every PRIM3 game page', () => {
  const html = read('prim3-level-builder/index.html');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<section class="owner-gate"[^>]*data-owner-gate[^>]*data-owner-template="forgeTpl"/);
  assert.match(html, /<script type="module" src="\.\.\/js\/owner-only\.mjs"><\/script>/);
  // nothing runs before the server's yes: every editor script loads through the gate, the app markup is inert
  const outside = html.replace(/<template id="forgeTpl">[\s\S]*<\/template>/, '');
  assert.deepEqual([...outside.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]), ['<script type="module" src="../js/owner-only.mjs">']);
  assert.match(html, /data-owner-load="vendor\/playcanvas-2\.23\.1\.min\.js catalog\.js model\.js render\.js \.\.\/js\/backend\.js cloud-client\.js editor-ui\.js"/);
  assert.match(html, /control\.html#create:level-forge/);
});
