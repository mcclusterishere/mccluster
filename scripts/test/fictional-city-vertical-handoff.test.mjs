// Read-only regression of the city's existing HQ handoff; no new floor/grid authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../../js/prim3-tactics/tactical-resolver.mjs';
import * as HQ from '../../js/prim3-tactics/levels/equity-uprise-hq.mjs';

for (const stair of ['stair-a-1-2', 'stair-b-1-2']) {
  test(`HQ handoff: actual resolver traverses ${stair} from Floor 1 to Floor 2 and back`, () => {
    const cfg = HQ.engineConfig({ seed: 3 }), link = cfg.links.find(l => l.id === stair);
    assert.ok(link, 'the level declares a real vertical link');
    let state = R.beginPlayerPhase(R.createState(cfg));
    const unit = state.units.find(u => u.role === 'T');
    state = { ...state, units: state.units.filter(u => u.id === unit.id) };
    const walk = target => {
      const path = R.findPath(state, unit.id, target);
      assert.ok(path?.length, 'reachable from current position');
      for (const next of path) {
        const current = state.units[0];
        if (current.x === next.x && current.y === next.y && current.z === next.z) continue;
        if (current.ap < 1) state = R.beginPlayerPhase({ ...state, phase: 'THREAT' });
        state = R.moveUnit(state, unit.id, next, 'MOVE');
      }
      const arrived = state.units[0];
      assert.deepEqual({ x: arrived.x, y: arrived.y, z: arrived.z }, target);
    };
    walk(link.from); assert.equal(state.units[0].z, 1);
    walk(link.to); assert.equal(state.units[0].z, 2);
    walk(link.from); assert.equal(state.units[0].z, 1);
  });
}
