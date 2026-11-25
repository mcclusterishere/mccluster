import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { previewSharedRoute } from '../../js/prim3-tactics/shared-spatial-preview.mjs';
const region = JSON.parse(fs.readFileSync(new URL('../../data/spatial/bridgeport-golden-hill.v1.json', import.meta.url)));
function state(topology) {
  const c = region.contract, graph = region.graphs[topology];
  return { schema: c.state.schema, regionId: c.id, revision: c.revision,
    frameId: c.frame.id, floorId: c.floor.id, topology,
    position: { ...graph.nodes.find(n => n.id === graph.entryId).position } };
}
for (const topology of ['hex', 'square']) test(`${topology}: exact City route, metre budget and immutable continuous pose`, () => {
  const value = state(topology), before = structuredClone(value);
  const target = region.graphs[topology].destinationId;
  const result = previewSharedRoute(region, value, target, { maxDistanceM: 100 });
  assert.ok(result.ids.length > 10);
  assert.ok(result.costM > 70 && result.costM < 100);
  assert.equal(result.withinBudget, true);
  assert.equal(result.tacticalExecutionSupported, false);
  assert.equal(previewSharedRoute(region, value, target, { maxDistanceM: result.costM - .01 }).withinBudget, false);
  result.points[0].x += 10;
  assert.deepEqual(value, before);
});
test('topology changes preserve continuous position without legacy coordinate reinterpretation', () => {
  const hex = state('hex'), square = { ...hex, topology: 'square' };
  for (const value of [hex, square]) {
    const result = previewSharedRoute(region, value, region.graphs[value.topology].destinationId, { maxDistanceM: 100 });
    assert.deepEqual(result.points[0], hex.position);
  }
  assert.throws(() => previewSharedRoute(region, { x: 3, y: 8, z: 1 }, 'x', { maxDistanceM: 100 }), /Incompatible/);
});
test('rejects foreign revisions/floors and missing metric budget without changing save', () => {
  const original = state('hex'), before = JSON.stringify(original);
  for (const change of [{ revision: 2 }, { floorId: 'B1' }, { frameId: 'legacy' }, { position: { ...original.position, y: 4.1148 } }]) {
    assert.throws(() => previewSharedRoute(region, { ...original, ...change }, 'x', { maxDistanceM: 100 }), /Incompatible/);
  }
  for (const maxDistanceM of [undefined, NaN, Infinity, -1]) assert.throws(() => previewSharedRoute(region, original, 'x', { maxDistanceM }), /metre budget/);
  assert.equal(JSON.stringify(original), before);
});
test('unknown target is not silently snapped to a reachable node', () => {
  assert.equal(previewSharedRoute(region, state('hex'), 'street:hex:9999:9999', { maxDistanceM: 100 }), null);
});
test('unsupported vertical extensions fail closed', () => {
  const changed = structuredClone(region);
  changed.contract.floor.verticalLinks.push({ id: 'stairs' });
  assert.throws(() => previewSharedRoute(changed, state('hex'), 'x', { maxDistanceM: 100 }), /street-only/);
});
