import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { previewSharedRoute, quoteSharedMovement } from '../../js/prim3-tactics/shared-spatial-preview.mjs';
const region = JSON.parse(fs.readFileSync(new URL('../../data/spatial/bridgeport-downtown.v2.json', import.meta.url)));
const c = region.contract;
function state(topology) {
  return { schema: c.state.schema, regionId: c.id, revision: c.revision, frameId: c.frame.id,
    floorId: c.floor.id, topology, position: { ...region.graphs[topology].entrances.find(e => e.id === 'bridgeport-main-golden-hill').position } };
}
for (const topology of ['hex', 'square']) test(`${topology}: exact v2 entrance connector and closures`, () => {
  const saved = state(topology), before = structuredClone(saved), target = 'bridgeport-main-elm';
  const preview = previewSharedRoute(region, saved, target, { maxDistanceM: 1000, navigationRevision: 4 });
  assert.equal(preview.entranceId, target);
  assert.deepEqual(preview.points.at(-1), region.graphs[topology].entrances.find(e => e.id === target).position);
  assert.equal(preview.navigationRevision, 4);
  assert.equal(previewSharedRoute(region, saved, target, { maxDistanceM: 1000, closedRoadIds: ['186839735'], navigationRevision: 5 }), null);
  assert.equal(previewSharedRoute(region, { ...saved, closedRoadIds: ['186839735'] }, target, { maxDistanceM: 1000 }), null);
  assert.deepEqual(saved, before);
  assert.throws(() => previewSharedRoute(region, saved, target, { maxDistanceM: 1000, closedRoadIds: ['invented'] }), /Unknown closure/);
  assert.throws(() => previewSharedRoute(region, { ...saved, revision: 1 }, target, { maxDistanceM: 1000 }), /Incompatible/);
});
const preview = { floorId: 'street', costM: 10, points: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }] };
const policy = { mode: 'MOVE', moveRangeM: 10, ap: 2, moverId: 'R1', radiusM: .43 };
test('AP quote has explicit one/two AP boundaries without rounding metres or spending state', () => {
  const before = structuredClone(policy);
  assert.equal(quoteSharedMovement(preview, policy).withinRange, true);
  assert.equal(quoteSharedMovement({ ...preview, costM: 10.001 }, policy).withinRange, false);
  const dash = quoteSharedMovement({ ...preview, costM: 20 }, { ...policy, mode: 'DASH', ap: 1 });
  assert.equal(dash.apCost, 2); assert.equal(dash.withinRange, true); assert.equal(dash.enoughAp, false);
  assert.equal(quoteSharedMovement({ ...preview, costM: 20.001 }, { ...policy, mode: 'DASH' }).withinRange, false);
  assert.equal(quoteSharedMovement({ ...preview, costM: 0 }, policy).withinRange, false);
  assert.equal(dash.tacticalExecutionSupported, false);
  assert.deepEqual(policy, before);
  assert.throws(() => quoteSharedMovement(preview, { ...policy, moveRangeM: undefined }), /Explicit/);
});
test('swept actor occupancy blocks living/downed actors between endpoints; excludes mover/dead/extracted/other floor', () => {
  const actor = { id: 'T1', floorId: 'street', position: { x: 5, y: 0, z: .5 }, radiusM: .43, downed: true };
  const knownOccupants = [actor, { ...actor, id: 'R1' }, { ...actor, id: 'dead', dead: true },
    { ...actor, id: 'extracted', extracted: true }, { ...actor, id: 'upstairs', floorId: 'other' }];
  const before = structuredClone(knownOccupants);
  assert.deepEqual(quoteSharedMovement(preview, { ...policy, knownOccupants }).blockedKnownActorIds, ['T1']);
  assert.deepEqual(knownOccupants, before);
  assert.deepEqual(quoteSharedMovement(preview, policy).blockedKnownActorIds, []);
  assert.throws(() => quoteSharedMovement(preview, { ...policy, knownOccupants: [{ ...actor, radiusM: -1 }] }), /Invalid/);
});
