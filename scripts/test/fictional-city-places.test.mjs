/* McCluster City expansion: the places contract (geography authority), its lore binding, chunks, save
   migration, and the shared tactical frame. Pure Node: real collision world, real PRIM3 resolver. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as R from '../../js/prim3-tactics/tactical-resolver.mjs';
import { TILE_M } from '../../js/prim3-tactics/scale.mjs';
import * as HQ from '../../js/prim3-tactics/levels/equity-uprise-hq.mjs';
import * as EU from '../../js/prim3-tactics/adapters/equity-uprise/adapter.mjs';
import { createSpatialWorld, isWalkable, findWalkingPath, moveWithCollisions } from '../../js/fictional-city/spatial.mjs';
import { createPlacesIndex, bindCity, resolveRoute, resolveResidentRoutes, walkableArea, footprintBounds, chunkIdAt, ORIGINAL_BUSINESS_IDS, NEIGHBORHOOD_IDS } from '../../js/fictional-city/places.mjs';
import { buildChunks, chunkWanted } from '../../js/fictional-city/chunks.mjs';
import { initialState, sanitizeState, loadState, saveState, payInteraction, recordDiscovery, purchase, interactionsOf, STATE_KEY, STATE_VERSION } from '../../js/fictional-city/state.mjs';
import { CITY_TILE_M, HQ_CELL_M, hqFtToCity, cityToHqFt, tacticalRegion } from '../../js/fictional-city/tactical.mjs';
import { buildCityLevel } from '../../tools/prim3-city/city-grid.mjs';
import { osmLevelToPlaces } from '../../tools/prim3-city/places-adapter.mjs';

const read = async p => JSON.parse(await readFile(new URL('../../' + p, import.meta.url), 'utf8'));
const city = await read('core/data/fictional-city/district.v1.json');
const places = await read('core/data/fictional-city/places.v1.json');
const hub = [...city.businesses, city.garage];
const before = createSpatialWorld(hub, city.district.island.hq);
const world = createSpatialWorld(hub, city.district.island.hq, places);
const index = createPlacesIndex(places, city);
const spawn = { x: city.district.spawn[0], z: city.district.spawn[1] };
const overlap = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const HQ_RECT = { minX: -10.97, maxX: 10.97, minZ: 77.03, maxZ: 98.97 };

const REQUIRED_PARCELS = [
  'civic-center/police-station', 'civic-center/hospital', 'civic-center/church', 'civic-center/school-of-hard-knocks', 'civic-center/wiggers-anonymous',
  'hq-waterfront/thugged-out-apparel', 'northside-residential/public-school',
  ...Array.from({ length: 10 }, (_, i) => `northside-residential/house-${String(i + 1).padStart(2, '0')}`),
  ...[1, 2, 3, 4].map(i => `hq-waterfront/shop-0${i}`), ...[1, 2, 3, 4].map(i => `civic-center/shop-0${i}`),
  ...[1, 2, 3, 4, 5, 6].map(i => `workshop-waterfront/shop-0${i}`)
];

test('the fixed ID contract: five neighbourhoods, every lore parcel, the original places and HQ anchors resolve', () => {
  for (const id of NEIGHBORHOOD_IDS) assert.ok(places.neighborhoods.some(n => n.id === id), id);
  for (const id of REQUIRED_PARCELS) {
    const p = index.parcels.get(id); assert.ok(p, id);
    assert.ok(p.entrances.length >= 1 && p.neighborhood === id.split('/')[0], id);
    assert.equal(p.chunk, chunkIdAt(places, ...p.footprint.center), id + ' chunk');
    const r = index.resolve(id); assert.ok(Number.isFinite(r.x) && Number.isFinite(r.z));
  }
  for (const id of [...ORIGINAL_BUSINESS_IDS, 'whip-equipped-garage', 'hq-bridge', 'hq-doorway']) assert.ok(index.resolve(id), id);
  assert.deepEqual([index.resolve('hq-doorway').x, index.resolve('hq-doorway').z], city.district.island.hq.entry, 'the doorway anchor is the existing island entry');
  assert.equal(index.resolve('nope'), null);
});

test('legacy parcels mirror the authored coordinates exactly: the original block is unmoved', () => {
  assert.equal(places.legacyParcels.length, 9);
  for (const b of hub) {
    const p = places.legacyParcels.find(x => x.id === b.id);
    assert.deepEqual(p.footprint.center, b.position, b.id); assert.deepEqual(p.footprint.size, b.size.slice(0, 2), b.id);
    assert.deepEqual(p.entrance, b.entrance, b.id); assert.equal(p.height, b.size[2]);
  }
  const original = places.surfaces.find(s => s.id === 'original-mainland');
  assert.deepEqual([original.minX, original.maxX, original.minZ, original.maxZ], [-72, 72, -58, 45]);
});

test('every parcel stands on land, overlaps nothing, has a walkable door reachable on foot from the original spawn', () => {
  const all = [...places.parcels.map(p => ({ id: p.id, ...footprintBounds(p) })), ...places.legacyParcels.map(p => ({ id: p.id, ...footprintBounds(p) })), { id: 'hq', ...HQ_RECT }];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(!overlap(all[i], all[j]), `${all[i].id} × ${all[j].id}`);
  for (const p of places.parcels) {
    const [x, z] = p.footprint.center;
    assert.equal(isWalkable(x, z, world), false, p.id + ' is solid');
    const door = index.resolve(p.id);
    assert.ok(isWalkable(door.x, door.z, world), p.id + ' door');
    const path = findWalkingPath(spawn, door, world, 250000);
    assert.ok(path.length > 1 && path.every(n => isWalkable(n.x, n.z, world)), p.id + ' reachable');
  }
  for (const a of [...places.anchors, ...places.landmarks]) assert.ok(isWalkable(...a.position, world), a.id);
});

test('the expansion is measured: ≥5× walkable area, four new neighbourhoods, ≥30 new doors, more route choices', () => {
  const B = { minX: -320, maxX: 200, minZ: -200, maxZ: 160 };
  const a0 = walkableArea(before, B, 2), a1 = walkableArea(world, B, 2);
  assert.ok(a1 >= 5 * a0, `walkable ${a0} → ${a1} m²`);
  assert.equal(places.neighborhoods.filter(n => n.status === 'new').length, 4);
  assert.ok(places.parcels.filter(p => p.role !== 'scenery').length >= 31);
  // route choices from the original block: the bridge plus Harbor Boulevard west and east and both wharf walks
  const exits = [[-80, -1], [80, -1], [-50, 60], [50, 60], [-236, -80]];
  for (const e of exits) assert.ok(findWalkingPath(spawn, { x: e[0], z: e[1] }, world, 250000).length, `exit ${e}`);
  for (const e of exits) assert.equal(findWalkingPath(spawn, { x: e[0], z: e[1] }, before).length, 0, `exit ${e} did not exist before`);
});

test('water and edges still stop a body; the island stays an island reached only by its footbridge', () => {
  assert.equal(isWalkable(15, 55, world), false); assert.equal(isWalkable(30, 70, world), false, 'the bay between the quays');
  assert.equal(isWalkable(-24, 88, world), false, 'west channel'); assert.equal(isWalkable(24, 88, world), false, 'east channel');
  const edge = moveWithCollisions({ x: 30, z: 44 }, 0, 30, world); assert.ok(edge.z < 45);
  const sea = moveWithCollisions({ x: 100, z: 135 }, 0, 20, world); assert.ok(sea.z < 140);
  const path = findWalkingPath({ x: 48, z: 100 }, { x: 0, z: 74 }, world, 250000);
  assert.ok(path.length && path.some(p => Math.abs(p.x) < 5 && p.z > 47 && p.z < 67), 'east quay → island crosses the footbridge');
  for (const s of places.surfaces.filter(s => s.kind === 'pier')) {
    const cz = (s.minZ + s.maxZ) / 2; assert.ok(isWalkable((s.minX + s.maxX) / 2, cz, world), s.id);
    assert.ok(!overlap(s, { minX: -20, maxX: 20, minZ: 68, maxZ: 108 }), s.id + ' does not touch the island');
  }
});

test('route anchors resolve to a walkable path through neighbourhoods and over the footbridge', () => {
  const r = resolveRoute(index, ['northside-residential/house-03', 'civic-center/police-station', 'hq-bridge', 'hq-doorway', 'hq-waterfront/thugged-out-apparel'], world);
  assert.ok(r.ok && r.path.length > 4);
  for (let i = 1; i < r.path.length; i++) {
    const a = r.path[i - 1], b = r.path[i];
    for (let t = 0; t <= 1; t += .05) assert.ok(isWalkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, world, .3), 'segment stays walkable');
  }
  const missing = resolveRoute(index, ['hq-bridge', 'no-such-place'], world);
  assert.equal(missing.ok, false); assert.deepEqual(missing.missing, ['no-such-place']);
});

/* Lore that has not landed yet, in the shape the lore PR binds with. The places resolver lights it up. */
// the original lore only (revision-2 arrays removed), so the fixture's parcel is free to claim
const base = { ...city, expansionBusinesses: [], expansionNpcs: [], expansionItems: [], families: [] };
const lore = {
  ...base,
  businesses: [...base.businesses, { id: 'fixture-precinct', name: 'Fixture Precinct', parcelId: 'civic-center/police-station', staffIds: ['fixture-officer'], itemIds: [], description: 'Fixture.', interactions: [{ type: 'bribe', id: 'fixture-officer:look-away', price: 40, label: 'Offer 40 credits', npcIds: ['fixture-officer'] }] }],
  npcs: [...base.npcs,
    { id: 'fixture-officer', name: 'Fixture Officer', role: 'Desk', parcelId: 'civic-center/police-station', homeParcelId: 'northside-residential/house-02', routeAnchors: ['civic-center/police-station', 'junction/civic-plaza', 'hq-bridge'], dialogue: { greeting: 'Hi', topics: [] }, interactions: [{ type: 'bribe', price: 15 }] },
    { id: 'fixture-minor', name: 'Fixture Student', role: 'Student', minor: true, homeParcelId: 'northside-residential/house-05', dialogue: { greeting: 'Hi', topics: [] }, interactions: [{ type: 'bribe', id: 'fixture-minor:never', price: 1 }] },
    { id: 'fixture-neighbor', name: 'Fixture Neighbor', role: 'Resident', homeParcelId: 'northside-residential/house-07', dialogue: { greeting: 'Hi', topics: [] } }]
};

test('lore binds by parcelId/homeParcelId/routeAnchors; unclaimed parcels render generic; source lore is untouched', () => {
  const b = bindCity(lore, places);
  const precinct = b.manifest.businesses.find(x => x.id === 'fixture-precinct');
  assert.deepEqual(precinct.position, index.parcels.get('civic-center/police-station').footprint.center);
  assert.deepEqual(precinct.entrance, index.resolve('civic-center/police-station').x !== undefined ? [index.resolve('civic-center/police-station').x, index.resolve('civic-center/police-station').z] : null);
  assert.ok(!b.vacant.some(v => v.id === 'civic-center/police-station'), 'claimed parcel is not generic');
  assert.equal(b.vacant.length, places.parcels.length - 1);
  assert.equal(b.manifest.npcs.find(n => n.id === 'fixture-officer').businessId, 'fixture-precinct');
  const neighbor = b.manifest.npcs.find(n => n.id === 'fixture-neighbor');
  const home = index.resolve('northside-residential/house-07');
  assert.equal(neighbor.placement, 'door'); assert.ok(Math.hypot(neighbor.route[0][0] - home.x, neighbor.route[0][1] - home.z) <= 1.61, 'stands by the front door');
  const routes = resolveResidentRoutes(b, world);
  assert.ok(routes.get('fixture-officer').length >= 3);
  assert.equal(lore.businesses.at(-1).position, undefined, 'binding never writes into the lore object');
  for (const o of ORIGINAL_BUSINESS_IDS) assert.deepEqual(b.manifest.businesses.find(x => x.id === o).position, city.businesses.find(x => x.id === o).position);
  const unknown = bindCity({ ...base, businesses: [...base.businesses, { id: 'x', name: 'X', parcelId: 'civic-center/nowhere', staffIds: [], itemIds: [] }] }, places);
  assert.ok(!unknown.manifest.businesses.some(x => x.id === 'x'), 'an unknown parcel is never placed at the origin');
});

test('save migration: a real v1 save keeps money, inventory, receipts, discoveries and chapter progress', () => {
  const item = city.items[3];
  const v1 = { version: 1, revision: '2026-11-03', credits: 187, position: { x: -48, z: -12.5, interior: 'gauranfucking-tea' },
    inventory: { [item.id]: 2 }, met: ['mike-hawk', 'majid'], visited: ['gauranfucking-tea', 'whip-equipped-garage'],
    receipts: [{ itemId: item.id, price: item.price, at: 1762000000000 }, { itemId: item.id, price: item.price, at: 1762000001000 }], story: { chapter: 'tears-wont-fall' } };
  const store = new Map([[STATE_KEY, JSON.stringify(v1)]]);
  const s = loadState({ getItem: k => store.get(k) ?? null }, city, places);
  assert.equal(STATE_VERSION, 2); assert.equal(s.version, 2);
  for (const k of ['credits', 'position', 'inventory', 'met', 'visited', 'receipts', 'story']) assert.deepEqual(s[k], v1[k], k);
  assert.deepEqual(s.discoveries, []); assert.deepEqual(s.payments, []);
  // a v1 position outside the old bounds is rejected (safe fallback); a v2 position in the new city is kept
  assert.deepEqual(sanitizeState({ ...v1, position: { x: -150, z: 80, interior: null } }, city, places).position, initialState(city).position);
  assert.deepEqual(sanitizeState({ ...v1, version: 2, position: { x: -150, z: 73, interior: null } }, city, places).position, { x: -150, z: 73, interior: null });
  assert.equal(sanitizeState({ ...v1, version: 2, position: { x: 0, z: 0, interior: 'civic-center/shop-01' } }, city, places).position.interior, 'civic-center/shop-01');
  const saved = new Map(); saveState({ setItem: (k, v) => saved.set(k, v) }, s);
  assert.deepEqual(loadState({ getItem: k => saved.get(k) ?? null }, city, places), s, 'v2 round-trips');
});

test('bribe interactions spend city credits through the purchase rules; insufficient funds are refused', () => {
  const b = bindCity(lore, places).manifest;
  let s = initialState(b);
  const paid = payInteraction(s, 'fixture-officer:look-away', b, 99);
  assert.ok(paid.ok); assert.equal(paid.state.credits, 210); assert.deepEqual(paid.state.payments, [{ interactionId: 'fixture-officer:look-away', price: 40, at: 99 }]);
  assert.equal(payInteraction(s, 'fixture-minor:never', b).ok, false, 'a minor never offers a paid interaction');
  const generated = payInteraction(s, 'fixture-officer:bribe:0', b);
  assert.ok(generated.ok && generated.state.credits === 235, 'an id-less interaction gets a stable generated id');
  assert.equal(s.credits, 250, 'paying never mutates the previous state');
  const broke = { ...s, credits: 10 };
  assert.deepEqual(payInteraction(broke, 'fixture-officer:look-away', b), { ok: false, reason: 'insufficient-credits', state: broke });
  assert.equal(payInteraction(s, 'nope', b).ok, false);
  // forged or re-priced payments are dropped on load
  const clean = sanitizeState({ ...paid.state, payments: [...paid.state.payments, { interactionId: 'fixture-officer:look-away', price: 1, at: 5 }] }, b, places);
  assert.equal(clean.payments.length, 1);
  s = recordDiscovery(s, 'hq-overlook', places); s = recordDiscovery(s, 'hq-overlook', places); s = recordDiscovery(s, 'forged', places);
  assert.deepEqual(s.discoveries, ['hq-overlook']);
  assert.equal(purchase({ ...s, credits: 0 }, city.items[0].id, city).reason, 'insufficient-credits');
});

test('chunks: deterministic, clipped exactly at chunk edges, every parcel in one chunk, collision independent', () => {
  const a = buildChunks(places), b2 = buildChunks(places);
  assert.equal(JSON.stringify([...a.chunks.values()]), JSON.stringify([...b2.chunks.values()]));
  const seen = new Map();
  for (const c of a.chunks.values()) {
    for (const r of [...c.roads, ...c.land]) assert.ok(r.minX >= c.bounds.minX && r.maxX <= c.bounds.maxX && r.minZ >= c.bounds.minZ && r.maxZ <= c.bounds.maxZ, c.id);
    for (const p of c.props) assert.equal(chunkIdAt(places, p.x, p.z), c.id);
    for (const id of c.parcels) { assert.ok(!seen.has(id), id + ' twice'); seen.set(id, c.id); }
  }
  assert.equal(seen.size, places.parcels.length);
  // the clipped pieces of every street tile the street exactly (no gap, no double-draw), minus the resident hub
  for (const s of places.streets) {
    const pieces = [...a.chunks.values()].flatMap(c => c.roads.filter(r => r.street === s.id));
    const area = pieces.reduce((n, r) => n + (r.maxX - r.minX) * (r.maxZ - r.minZ), 0);
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) assert.ok(!overlap(pieces[i], pieces[j]), s.id + ' pieces overlap');
    assert.ok(area <= (s.maxX - s.minX) * (s.maxZ - s.minZ) + 1e-6 && area > 0, s.id);
  }
  const bounds = a.chunks.values().next().value.bounds;
  assert.ok(chunkWanted(bounds, bounds.minX - 50, bounds.minZ, 72) && !chunkWanted(bounds, bounds.minX - 120, bounds.minZ, 112), 'hysteresis radii');
  for (const c of a.chunks.values()) assert.ok(JSON.stringify(c).length < 20000, c.id + ' stays small');
});

test('tactical frame: explicit per-level scales; the HQ placement transform agrees with the building and the island doorway', () => {
  assert.equal(CITY_TILE_M, TILE_M); assert.equal(CITY_TILE_M, 3.54);
  assert.ok(Math.abs(HQ_CELL_M - 3.6576) < 1e-12); assert.equal(EU.FT_PER_CELL * EU.FT, HQ_CELL_M, 'the HQ adapter keeps 12 ft cells');
  assert.notEqual(HQ_CELL_M, CITY_TILE_M);
  const door = hqFtToCity((HQ.PLAN.doors.publicOuter.x1 + HQ.PLAN.doors.publicOuter.x2) / 2, 0);
  assert.ok(Math.abs(door.x) < 1e-9 && Math.abs(door.z - (88 - 36 * .3048)) < 1e-9, 'Floor 1 public door faces the bridge on the island axis');
  const sw = hqFtToCity(0, 0), ne = hqFtToCity(72, 72);
  assert.ok(Math.abs(Math.abs(ne.x - sw.x) - city.district.island.hq.footprintMeters[0]) < 1e-3, 'the city footprint is the 72 ft plate');
  assert.ok(Math.abs(hqFtToCity(0, 0, -13.5).y - (.16 - 4.1148)) < 1e-9, 'B1 at −13.5 ft');
  assert.ok(Math.abs(hqFtToCity(0, 0, 81).y - (.16 + city.district.island.hq.roofHeightMeters)) < 1e-9, 'roof datum +81 ft');
  const back = cityToHqFt(...city.district.island.hq.entry); const ap = HQ.PLAN.site.publicApproach;
  assert.ok(back.xf >= ap.x1 && back.xf <= ap.x2 && back.yf >= ap.y1 && back.yf <= ap.y2, 'the island doorway anchor is on the building\'s public approach');
  for (const [x, y] of [[3, 17], [60, 70], [-10, 40]]) { const c = hqFtToCity(x, y), f = cityToHqFt(c.x, c.z); assert.ok(Math.abs(f.xf - x) < 1e-9 && Math.abs(f.yf - y) < 1e-9); }
});

test('the same places drive a PRIM3 board: the footbridge is a walkable surface over the water mask', () => {
  const region = tacticalRegion(places, world, { minX: -40, maxX: 40, minZ: 30, maxZ: 110 }, { manifest: city });
  assert.equal(region.tileM, TILE_M);
  const from = region.toLocalTile(0, 40), to = region.anchors['hq-doorway'];
  const s = R.createState({ ...region.engineConfig, units: [{ id: 'T', faction: 'PLAYER', role: 'T', ...from }] });
  const reach = R.computeReach(s, 'T', Infinity);
  assert.ok(Number.isFinite(reach.costAt(to.x, to.y, 0)), 'mainland → island');
  const water = region.toLocalTile(15, 60);
  assert.ok(!Number.isFinite(reach.costAt(water.x, water.y, 0)), 'water is not walkable');
  assert.equal(region.kindRows[water.y][water.x], '~');
  const bridge = region.toLocalTile(0, 57); assert.equal(region.kindRows[bridge.y][bridge.x], '.');
  const hq = region.toLocalTile(0, 88); assert.equal(region.kindRows[hq.y][hq.x], '#');
  const path = R.findPath(s, 'T', { ...to, z: 0 });
  assert.ok(path.some(c => { const m = region.toCity(c.x, c.y); return Math.abs(m.x) < 5 && m.z > 46 && m.z < 68; }), 'the route uses the bridge');
});

test('#711 converter output speaks the same contract: Jersey City sample → places, geometry only, ODbL provenance', async () => {
  const extract = await read('tools/prim3-city/data/jersey-city-paulus-hook.osm-extract.json');
  const level = buildCityLevel(extract);
  const p = osmLevelToPlaces(level);
  const ix = createPlacesIndex(p);
  assert.equal(p.parcels.length, level.SCENE.buildings.filter(b => b.tiles > 0).length);
  assert.match(p.geography.attribution, /OpenStreetMap/); assert.equal(p.geography.licence, 'ODbL-1.0');
  assert.match(p.neighborhoods[0].name + p.id, /jersey/i, 'the sample stays labelled Jersey City');
  for (const parcel of p.parcels) {
    assert.ok(['height', 'levels', 'default', 'part'].includes(parcel.provenance.heightSource));
    assert.equal(parcel.name, undefined); assert.equal(parcel.label, undefined, 'no real names enter the contract');
  }
  const withDoor = p.parcels.find(x => x.entrances.length);
  assert.ok(ix.resolve(withDoor.id));
  const w = createSpatialWorld([], null, p);
  const r = tacticalRegion(p, w, { minX: p.frame.bounds.minX, maxX: p.frame.bounds.minX + 120, minZ: p.frame.bounds.minZ, maxZ: p.frame.bounds.minZ + 120 });
  assert.ok(r.engineConfig.blockers.length > 0 && r.W === Math.floor(120 / TILE_M) + 1);
});

test('lore revision 2 (PR #720 arrays) binds completely: every expansion business on its parcel, every resident placed, no bribe on a minor', () => {
  if (city.schemaRevision !== 2) return;
  const b = bindCity(city, places);
  assert.equal(b.manifest.businesses.length, city.businesses.length + city.expansionBusinesses.length, 'every expansion business is placed');
  assert.equal(b.manifest.npcs.length, city.npcs.length + city.expansionNpcs.length);
  assert.equal(b.manifest.items.length, city.items.length + city.expansionItems.length);
  for (const n of b.manifest.npcs) {
    assert.ok(['interior', 'patrol', 'door'].includes(n.placement), n.id + ' ' + n.placement);
    if (n.placement !== 'interior') { assert.ok(n.route?.length, n.id + ' has a place to stand'); for (const [x, z] of n.route) assert.ok(isWalkable(x, z, world, .2), n.id); }
    else assert.ok(b.manifest.businesses.some(x => x.id === n.businessId) || n.businessId === city.garage.id, n.id + ' works somewhere');
  }
  const routes = resolveResidentRoutes(b, world);
  for (const n of city.expansionNpcs.filter(n => n.placement === 'route')) assert.ok(routes.get(n.id)?.length >= 2, n.id + ' walks its route');
  const minors = new Set(b.manifest.npcs.filter(n => n.minor === true).map(n => n.id));
  for (const it of interactionsOf(b.manifest).values()) { assert.ok(!minors.has(it.ownerId)); assert.ok(!(it.npcIds || []).some(id => minors.has(id))); assert.ok(Number.isSafeInteger(it.price)); }
  for (const f of city.families) assert.ok(b.vacant.find(v => v.id === f.parcelId)?.familyId === f.id, f.id + ' lives in its house');
  assert.doesNotMatch(JSON.stringify(places), /"cost"\s*:/, 'public geography carries no "cost" fields');
});

test('the area north of the original block (X −165…165, Z −345…−58) stays completely free for the Bridgeport neighbourhood', () => {
  const box = { minX: -165, maxX: 165, minZ: -345, maxZ: -58 };
  const inside = r => r.minX < box.maxX && r.maxX > box.minX && r.minZ < box.maxZ && r.maxZ > box.minZ;
  for (const sf of places.surfaces) assert.ok(!inside(sf), 'surface ' + sf.id);
  for (const st of places.streets) assert.ok(!inside(st), 'street ' + st.id);
  for (const p of places.parcels) assert.ok(!inside(footprintBounds(p)), 'parcel ' + p.id);
  for (const p of places.parks || []) assert.ok(!inside(p), 'park ' + p.id);
  for (const a of [...places.anchors, ...places.landmarks]) assert.ok(!inside({ minX: a.position[0], maxX: a.position[0], minZ: a.position[1], maxZ: a.position[1] }) || a.position[1] === -58, a.id);
  const { chunks } = buildChunks(places);
  for (const c of chunks.values()) for (const r of [...c.land, ...c.roads]) assert.ok(!inside(r), c.id + ' draws in the reserved area');
  for (const c of chunks.values()) for (const p of c.props) assert.ok(!(p.x > box.minX && p.x < box.maxX && p.z > box.minZ && p.z < box.maxZ), c.id + ' prop');
  assert.deepEqual(places.frame.reserved[0].links, [[-32, -58], [32, -58]]);
  // the two walk-link points on the original block's north edge stay open ground (no blocker of ours there)
  for (const [x] of places.frame.reserved[0].links) assert.ok(isWalkable(x, -57.3, world, .7), 'link at x ' + x);
  for (const b of world.blockers) assert.ok(!inside(b), 'blocker ' + b.id);
});

test('Bridgeport story progress (arcs) survives the v1 → v2 migration and v2 round trips', () => {
  const arc = (city.storyArcs || [])[0];
  if (!arc) return;
  const done = arc.beats.slice(0, 2).map(b => b.id);
  const v1 = { version: 1, credits: 200, position: { x: 0, z: 2.5, interior: null }, inventory: {}, met: [], visited: [], receipts: [], story: { chapter: null }, arcs: { [arc.id]: { completed: done } } };
  const s = sanitizeState(v1, city, places);
  assert.equal(s.version, 2); assert.deepEqual(s.arcs, { [arc.id]: { completed: done } });
  assert.deepEqual(sanitizeState(s, city, places).arcs, s.arcs);
  // a position in the Bridgeport neighbourhood restores from a v1 save
  const area = (city.neighborhoods || [])[0];
  const v1b = sanitizeState({ ...v1, position: { x: area.spawn[0], z: area.spawn[1], interior: null } }, city, places);
  assert.deepEqual([v1b.position.x, v1b.position.z], area.spawn);
});
