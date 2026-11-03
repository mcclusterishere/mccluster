/* PRIM3 city grid: real footprints → the 3.54 m tactical grid (tools/prim3-city/city-grid.mjs).

     node --test scripts/test/prim3-city-grid.test.mjs

   Holds the conversion to its stated rules: footprint rasterisation (tile-centre sampling, holes,
   the centroid fallback), height → storeys, the coordinate frame (north is −y on the engine grid and
   +Y on the display), roof layering (no same-z step a unit could walk up), links, determinism, and the
   ODbL attribution the committed extract must carry. Dependency-free. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TILE_M, STOREY_M, ROOF_JOIN_M, parseLength, heightFromTags, storeysForHeight, makeFrame,
  rasterizeRings, footprintTiles, markSea, buildCityLevel, levelToJSON
} from '../../tools/prim3-city/city-grid.mjs';
import { parseOsmXml, reduceExtract } from '../../tools/prim3-city/fetch-osm-extract.mjs';

const EXTRACT = JSON.parse(readFileSync(new URL('../../tools/prim3-city/data/jersey-city-paulus-hook.osm-extract.json', import.meta.url), 'utf8'));
const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const collect = (rings, W = 20, H = 20) => { const out = new Set(); rasterizeRings(rings, W, H, (x, y) => out.add(`${x},${y}`)); return out; };

test('the grid is the game grid: 3.54 m tiles', () => {
  assert.equal(TILE_M, 3.54);
});

test('rasterisation: a tile is covered when its centre is inside', () => {
  // 2 × 3 tiles exactly
  assert.equal(collect([square(2, 4, 4, 7)]).size, 6);
  // edges through tile centres: [1.5, 3.5) covers centres 1.5 and 2.5 → tiles 1 and 2
  assert.deepEqual([...collect([square(1.5, 0.2, 3.5, 0.8)])].sort(), ['1,0', '2,0']);
  // a sliver that misses every centre covers nothing by sampling…
  assert.equal(collect([square(1.6, 1.6, 1.9, 1.9)]).size, 0);
  // …but footprintTiles keeps it on the tile under its centroid, so no building vanishes
  assert.deepEqual(footprintTiles([square(1.6, 1.6, 1.9, 1.9)], 20, 20), [[1, 1]]);
  // a courtyard (inner ring) stays open: 5 × 5 block with a 1 × 1 hole in the middle
  const ring = collect([square(0, 0, 5, 5), square(2, 2, 3, 3)]);
  assert.equal(ring.size, 24);
  assert.equal(ring.has('2,2'), false);
  // clipped to the grid
  assert.equal(collect([square(-3, -3, 2, 2)], 20, 20).size, 4);
});

test('lengths and heights from OSM tags', () => {
  assert.equal(parseLength('30'), 30);
  assert.equal(parseLength('30 m'), 30);
  assert.equal(parseLength('30,5'), 30.5);
  assert.ok(Math.abs(parseLength("100'") - 30.48) < 1e-9);
  assert.ok(Math.abs(parseLength('100 ft') - 30.48) < 1e-9);
  assert.ok(Math.abs(parseLength('12\'6"') - (12 * 0.3048 + 6 * 0.0254)) < 1e-9);
  assert.equal(parseLength('tall'), null);
  assert.deepEqual(heightFromTags({ building: 'yes', height: '57', 'building:levels': '23' }), { h: 57, storeys: 23, source: 'height' });
  assert.deepEqual(heightFromTags({ building: 'apartments', 'building:levels': '4' }), { h: 4 * STOREY_M, storeys: 4, source: 'levels' });
  assert.deepEqual(heightFromTags({ building: 'apartments', 'building:levels': '4', 'roof:levels': '1' }), { h: 5 * STOREY_M, storeys: 4, source: 'levels' });
  const guess = heightFromTags({ building: 'house' });
  assert.equal(guess.source, 'default');
  assert.equal(guess.storeys, 2);
  assert.equal(storeysForHeight(9.6), 3);
  assert.equal(storeysForHeight(1), 1);
  // height tag but no levels: storeys follow the height
  assert.equal(heightFromTags({ height: '32' }).storeys, 10);
});

test('coordinate frame: east is +x, north is −y on the engine grid and +Y on the display', () => {
  const bbox = [-74.0385, 40.7118, -74.0315, 40.7172];
  const f = makeFrame(bbox);
  const [cx, cy] = f.toTile((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2);
  assert.ok(Math.abs(cx - f.W / 2) < 1e-6 && Math.abs(cy - f.H / 2) < 1e-6, 'bbox centre is the grid centre');
  const [ex] = f.toTile(bbox[2], 40.714), [wx] = f.toTile(bbox[0], 40.714);
  assert.ok(ex > wx, 'east has the larger x');
  const [, ny] = f.toTile(-74.035, bbox[3]), [, sy] = f.toTile(-74.035, bbox[1]);
  assert.ok(ny < sy, 'north has the smaller y');
  // one tile is TILE_M metres both ways
  const [a] = f.tileCentreENU(10, 10), [b] = f.tileCentreENU(11, 10);
  assert.ok(Math.abs(b - a - TILE_M) < 1e-9);
  const [, n1] = f.tileCentreENU(10, 10), [, n2] = f.tileCentreENU(10, 11);
  assert.ok(Math.abs(n1 - n2 - TILE_M) < 1e-9);
  // the box is ~590 × 600 m → whole tiles, rounded down
  assert.equal(f.W, Math.floor((f.toENU(bbox[2], 0)[0] - f.toENU(bbox[0], 0)[0]) / TILE_M));
  // display frame: signed, north up, like Transit / Relay
  assert.deepEqual(f.toDisplay(f.FRAME.x0, f.FRAME.y0), { X: 0, Y: 0 });
  assert.deepEqual(f.toDisplay(f.FRAME.x0 + 1, f.FRAME.y0 - 1), { X: 1, Y: 1 });
  // lon/lat round trip at a tile centre
  const [lon, lat] = f.tileCentreLonLat(40, 50), [tx, ty] = f.toTile(lon, lat);
  assert.ok(Math.abs(tx - 40.5) < 1e-6 && Math.abs(ty - 50.5) < 1e-6);
});

test('coastline: sea is right of the way; the far side of an open end is left alone', () => {
  // a coastline running north (−y) along x = 5: land on the left (west), sea on the right (east)
  const sea = new Set();
  markSea([[[5, 9], [5, 1]]], 10, 10, (x, y) => sea.add(`${x},${y}`));
  assert.ok(sea.has('7,5') && !sea.has('2,5'));
  assert.ok(!sea.has('7,9') && !sea.has('2,0'), 'tiles nearest an open end are not guessed');
});

// a tiny synthetic extract: a low terrace touching a tall tower, a lone shed, and open ground
function synthetic() {
  const bbox = [-74.0010, 40.7000, -73.9990, 40.7015];
  const f = makeFrame(bbox);
  const ll = (x, y) => f.fromTile(x, y);
  const poly = (x0, y0, x1, y1) => [[ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)]];
  return {
    id: 'synthetic', name: 'Synthetic', bbox, source: 'test', fetchedAt: 'test',
    licence: { name: 'ODbL', attribution: '© OpenStreetMap contributors' },
    features: [
      { osm: 'way/1', kind: 'building', tags: { building: 'terrace', 'building:levels': '3' }, outer: poly(10, 10, 14, 12), inner: [] },
      { osm: 'way/2', kind: 'building', tags: { building: 'office', height: '60' }, outer: poly(14, 10, 17, 13), inner: [] },
      { osm: 'way/3', kind: 'building', tags: { building: 'terrace', 'building:levels': '3' }, outer: poly(17, 10, 20, 12), inner: [] },
      { osm: 'way/4', kind: 'building', tags: { building: 'shed' }, outer: poly(30, 20, 31, 21), inner: [] }
    ]
  };
}

test('roof layers: neighbouring roofs of different height never share a z', () => {
  const L = buildCityLevel(synthetic());
  const { grids, W } = L;
  const zAt = (x, y) => grids.patchZ[grids.patchOf[y * W + x]];
  assert.ok(Math.abs(grids.height[11 * W + 11] - 3 * STOREY_M) < 1e-6);
  assert.equal(grids.height[11 * W + 15], 60);
  assert.notEqual(zAt(13, 11), zAt(14, 11), 'terrace and tower touch, so they are different layers');
  assert.notEqual(zAt(16, 11), zAt(17, 11));
  // the two terraces do not touch each other, so the colouring may reuse their layer
  assert.equal(zAt(11, 11), zAt(18, 11));
  // generic invariant on the real block: no same-z neighbours more than ROOF_JOIN_M apart
  const real = levelToJSON(buildCityLevel(EXTRACT));
  const surf = new Map();
  for (const r of real.engineConfig.surfaces) for (let i = 0; i < r.w; i += 1) surf.set(`${r.x + i}:${r.y}:${r.z}`, r.height);
  for (const [k, h] of surf) {
    const [x, y, z] = k.split(':').map(Number);
    for (const n of [`${x + 1}:${y}:${z}`, `${x}:${y + 1}:${z}`]) if (surf.has(n)) assert.ok(Math.abs(surf.get(n) - h) <= ROOF_JOIN_M, `${k} → ${n}`);
  }
});

test('rules data: blockers, ladders and cover follow the stated rules', () => {
  const L = buildCityLevel(synthetic());
  const cfg = L.engineConfig;
  const blocker = (x, y) => cfg.blockers.find((b) => b.x === x && b.y === y && b.z === 0);
  assert.equal(blocker(15, 11).h, 60, 'a building tile blocks the street as tall as the building');
  assert.equal(blocker(5, 5), undefined, 'open ground is walkable');
  // ladders: the 9.6 m terraces and the shed get one from the street; the 60 m tower does not
  const ladders = cfg.links.filter((l) => l.id.startsWith('ladder-'));
  const ladderTo = (x0, x1) => ladders.filter((l) => l.to.x >= x0 && l.to.x < x1);
  assert.equal(ladderTo(10, 14).length, 1);
  assert.equal(ladderTo(14, 17).length, 0);
  assert.equal(ladderTo(30, 31).length, 1);
  for (const l of ladders) {
    assert.equal(l.from.z, 0);
    assert.equal(blocker(l.from.x, l.from.y), undefined, 'a ladder starts on open street');
    assert.equal(Math.abs(l.from.x - l.to.x) + Math.abs(l.from.y - l.to.y), 1, 'a ladder is against its wall');
  }
  // the street beside the tower has HIGH cover facing it
  const c = cfg.cover.find((v) => v.x === 15 && v.y === 13 && v.z === 0);
  assert.ok(c && c.type === 'HIGH' && c.sides.includes('N'));
  // display frame and level shape match the tactics level modules
  for (const k of ['W', 'H', 'FLOORS', 'FRAME', 'SCENE', 'MISSION', 'engineConfig']) assert.ok(k in L, k);
  assert.equal(cfg.width, L.W); assert.equal(cfg.height, L.H); assert.equal(cfg.floors, L.FLOORS);
  assert.equal(L.SCENE.kindRows.length, L.H);
  assert.ok(L.SCENE.kindRows.every((r) => r.length === L.W));
});

test('the committed Jersey City block builds, deterministically, with ODbL attribution', () => {
  assert.equal(EXTRACT.schema, 'mccluster.prim3.city-extract.v1');
  assert.match(EXTRACT.licence.attribution, /OpenStreetMap contributors/);
  assert.match(EXTRACT.licence.name, /ODbL|Open Database License/);
  const a = JSON.stringify(levelToJSON(buildCityLevel(EXTRACT)));
  const b = JSON.stringify(levelToJSON(buildCityLevel(EXTRACT)));
  assert.equal(a, b);
  const L = JSON.parse(a);
  assert.match(L.attribution, /OpenStreetMap contributors/);
  assert.ok(L.stats.buildings > 100, 'the block has its buildings');
  assert.ok(L.stats.waterTiles > 1000, 'the Hudson is water');
  assert.ok(L.engineConfig.units.length === 3, 'a squad start was found');
  assert.ok(L.FLOORS >= 2 && L.FLOORS <= 8, 'roof layers stay few');
  assert.equal(L.TILE_M, 3.54);
});

test('the extract reducer reads OSM XML and keeps only what the grid needs', () => {
  const xml = `<osm><node id="1" lat="40.7" lon="-74.0"/><node id="2" lat="40.7" lon="-73.999"/><node id="3" lat="40.701" lon="-73.999"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="1"/><tag k="building" v="yes"/><tag k="height" v="12"/><tag k="note" v="x"/></way>
    <way id="11"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>
    <way id="12"><nd ref="1"/><nd ref="2"/><tag k="highway" v="footway"/><tag k="tunnel" v="yes"/></way></osm>`;
  const out = reduceExtract(parseOsmXml(xml), { id: 't', name: 't', bbox: [-74, 40.7, -73.99, 40.71] }, { source: 'test', fetchedAt: 'now' });
  assert.deepEqual(out.features.map((f) => f.kind), ['building', 'road']);
  assert.deepEqual(out.features[0].tags, { building: 'yes', height: '12' });
  assert.match(out.licence.attribution, /OpenStreetMap contributors/);
});

test('the canonical resolver plays the real block: the squad moves and a ladder reaches a roof', async () => {
  const { createState, computeReach, findPath } = await import('../../js/prim3-tactics/tactical-resolver.mjs');
  const L = levelToJSON(buildCityLevel(EXTRACT));
  const state = createState(structuredClone(L.engineConfig));
  const reach = computeReach(state, 'E1', 12);
  assert.ok(reach.cells.length > 20, 'Entry can move from its start');
  const ladder = L.engineConfig.links.find((l) => l.id.startsWith('ladder-'));
  const path = findPath(state, 'E1', ladder.to, 500);
  assert.ok(path && path.length, 'a street ladder leads onto a roof');
  assert.deepEqual(path[path.length - 1], ladder.to);
});
