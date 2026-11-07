import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { neighborhoodChunks, neighborhoodChunkId, neighborhoodChunkBounds, isNeighborhoodChunkId, placeBounds, splitSegment, segmentDashes } from '../../js/fictional-city/neighborhood-chunks.mjs';
import { chunkWanted } from '../../js/fictional-city/chunks.mjs';
const CHUNK_LOAD_RADIUS = 72; // scene.mjs → CHUNK_LOAD_RADIUS (that module needs three.js, so the value is mirrored here)

const city = JSON.parse(await readFile(new URL('../../core/data/fictional-city/district.v1.json', import.meta.url), 'utf8'));
const area = city.neighborhoods.find(n => n.id === 'bridgeport-robbery-1s');
const inside = (b, x, z) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;

test('every surveyed place, street piece, dash and sign lands in exactly one chunk, and nothing is lost', () => {
  const { index, chunks } = neighborhoodChunks(city.neighborhoods);
  const placed = [...chunks.values()].flatMap(c => c.places);
  assert.deepEqual([...placed].sort(), area.places.map(p => p.id).sort());
  assert.equal(new Set(placed).size, placed.length);
  for (const id of index.chunks.map(c => c.id)) { assert.ok(isNeighborhoodChunkId(id), id); assert.ok(!/^c/.test(id), 'never collides with an authored-city chunk id'); }
  // street length is conserved: the pieces of every segment add up to the segment
  let authored = 0, streamed = 0, dashesAuthored = 0, dashesStreamed = 0;
  for (const road of area.roads) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L >= .05) authored += L;
    if ((road.width || 10) >= 5) dashesAuthored += segmentDashes(a, b).length;
  }
  for (const c of chunks.values()) { for (const r of c.roads) streamed += Math.hypot(r.bx - r.ax, r.bz - r.az); dashesStreamed += c.dashes.length; }
  assert.ok(Math.abs(authored - streamed) < .05, `${authored} vs ${streamed}`);
  assert.equal(dashesStreamed, dashesAuthored);
  const names = new Set(area.roads.map(r => r.name).filter(Boolean));
  assert.equal([...chunks.values()].flatMap(c => c.signs).length, names.size, 'one road-name post per named street');
  // every piece sits in the chunk whose square holds its midpoint; every chunk's bounds cover its own buildings
  for (const c of chunks.values()) {
    const square = neighborhoodChunkBounds(c.id);
    for (const r of c.roads) if (!r.rect) assert.equal(neighborhoodChunkId((r.ax + r.bx) / 2, (r.az + r.bz) / 2), c.id);
    for (const pid of c.places) { const pb = placeBounds(area.places.find(p => p.id === pid)); for (const k of ['minX', 'maxX', 'minZ', 'maxZ']) assert.ok(k.startsWith('min') ? c.bounds[k] <= pb[k] : c.bounds[k] >= pb[k], `${c.id} covers ${pid}`); }
    assert.ok(c.bounds.minX <= square.minX && c.bounds.maxX >= square.maxX && c.bounds.minZ <= square.minZ && c.bounds.maxZ >= square.maxZ);
  }
});

test('long segments split into abutting pieces with the overhang only at the real ends; short ones stay whole', () => {
  const pieces = splitSegment([0, 0], [60, 0], 24);
  assert.equal(pieces.length, 3);
  assert.deepEqual(pieces.map(p => [p.ax, p.bx, p.startCap, p.endCap]), [[0, 20, true, false], [20, 40, false, false], [40, 60, false, true]]);
  assert.deepEqual(splitSegment([0, 0], [10, 0], 24).map(p => [p.startCap, p.endCap]), [[true, true]]);
  assert.deepEqual(splitSegment([0, 0], [0.01, 0], 24), []);
});

test('from the original block nothing of the neighbourhood is wanted; at its spawn the nearby tiles are', () => {
  const { index } = neighborhoodChunks(city.neighborhoods);
  const wantedAt = (x, z) => index.chunks.filter(c => chunkWanted(c.bounds, x, z, CHUNK_LOAD_RADIUS));
  // the shared 72 m load radius reaches only the tiles bordering the original block (one building there at most);
  // the renderer's frustum test keeps even that one out of the opening frame
  const opening = wantedAt(city.district.spawn[0], city.district.spawn[1]);
  assert.ok(opening.every(c => c.bounds.maxZ >= -140), JSON.stringify(opening));
  assert.ok(opening.reduce((n, c) => n + c.places, 0) <= 1, 'at most one surveyed building is built for the opening view');
  const spawn = wantedAt(...area.spawn);
  assert.ok(spawn.length >= 3 && spawn.length <= 16, String(spawn.length));
  // the nearest story stop's building is wanted when standing at the stop
  for (const beat of city.storyArcs.flatMap(a => a.beats)) {
    const want = wantedAt(...beat.position).flatMap(c => index.chunks.find(x => x.id === c.id) ? c.id : []);
    assert.ok(want.length > 0, beat.id);
  }
  assert.ok(index.chunks.every(c => inside({ minX: -400, maxX: 400, minZ: -400, maxZ: 300 }, (c.bounds.minX + c.bounds.maxX) / 2, (c.bounds.minZ + c.bounds.maxZ) / 2)));
});

test('the loader answers only its own ids with the tile-source shape', async () => {
  const tiles = neighborhoodChunks(city.neighborhoods);
  const id = tiles.index.chunks.find(c => c.places > 0).id;
  const data = await tiles.loadChunk(id);
  assert.equal(data.id, id); assert.deepEqual([data.roads, data.props, data.parcels], [[], [], []]);
  assert.ok(Array.isArray(data.neighborhood.places) && data.neighborhood.places.length > 0);
  assert.equal(tiles.has('c0_0'), false);
  await assert.rejects(tiles.loadChunk('n99_99'));
  assert.deepEqual(neighborhoodChunks([]).index.chunks, []);
});
