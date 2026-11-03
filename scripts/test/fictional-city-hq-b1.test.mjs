/* The city's HQ doorway opens the existing HQ level (prim3-transit.html?level=equity-uprise-hq). B1 is an
   ordinary floor there (owner, 2026-11-03): an ordinary player operative walks in by the public door, goes down
   Stair B to B1, moves through the basement, and climbs back up Stair A, on the real resolver, with no role,
   flag or unlock anywhere in the level's configuration. Also guards #715's B1 mission routes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as R from '../../js/prim3-tactics/tactical-resolver.mjs';
import * as HQ from '../../js/prim3-tactics/levels/equity-uprise-hq.mjs';
import { LEVELS } from '../../js/prim3-tactics/levels/index.mjs';

const city = JSON.parse(await readFile(new URL('../../core/data/fictional-city/district.v1.json', import.meta.url), 'utf8'));

// walk one tile at a time; a new player phase restores action points (squad only: no opposition on the board)
function walk(s, id, dest, log) {
  const path = R.findPath(s, id, dest);
  assert.ok(path && path.length, `a path to ${JSON.stringify(dest)}`);
  for (const c of path) {
    const u = s.units.find(x => x.id === id);
    if (u.x === c.x && u.y === c.y && u.z === c.z) continue;
    if (u.ap < 1) s = R.beginPlayerPhase({ ...s, phase: 'THREAT' });
    s = R.moveUnit(s, id, c, 'MOVE');
    log.push(`${c.x},${c.y},${HQ.floorName(c.z) || 'street'}`);
  }
  return s;
}

test('an ordinary operative walks street → Floor 1 → Stair B → B1 → across the basement → Stair A → Floor 1', () => {
  const cfg = HQ.engineConfig({ seed: 3 });
  const text = JSON.stringify(cfg);
  assert.doesNotMatch(text, /owner|admin|unlock|secret|restricted|clearance|keycard/i, 'no role or unlock in the level');
  let s = R.beginPlayerPhase(R.createState(cfg));
  s = { ...s, units: s.units.filter(u => u.faction === 'PLAYER') };
  const T = s.units.find(u => u.role === 'T');
  assert.equal(T.z, 0, 'starts on the street');
  const log = [];
  s = walk(s, T.id, { x: 4, y: 3, z: 8 }, log);           // Stair B foot on B1
  assert.ok(log.some(l => l.endsWith('Floor 1')) && log.at(-1).endsWith('B1'));
  s = walk(s, T.id, { x: 5, y: 4, z: 8 }, log);           // the tunnel-operations concourse
  s = walk(s, T.id, { x: 5, y: 5, z: 8 }, log);           // the systems lab
  s = walk(s, T.id, { x: 8, y: 3, z: 8 }, log);           // Stair A foot on B1
  const onB1 = log.filter(l => l.endsWith('B1'));
  assert.ok(new Set(onB1).size >= 4, 'moved around the basement: ' + onB1.join(' '));
  s = walk(s, T.id, { x: 8, y: 4, z: 1 }, log);           // back up Stair A to Floor 1
  const u = s.units.find(x => x.id === T.id);
  assert.deepEqual([u.x, u.y, u.z], [8, 4, 1]);
  const used = cfg.links.filter(l => l.from.z === 8 || l.to.z === 8).map(l => l.id).sort();
  assert.deepEqual(used, ['stair-a-east-0-1', 'stair-b-west-0-1'], 'both protected stairs serve B1, as ordinary links');
});

test('the city keeps the existing HQ doorway and #715 B1 mission routes; both sides of the exercise are registered', () => {
  const hq = city.portals.find(p => p.id === 'equity-uprise-hq');
  assert.equal(hq.route, 'prim3-transit.html?level=equity-uprise-hq');
  assert.ok(LEVELS['equity-uprise-hq'] && LEVELS['equity-uprise-b1'], 'both levels are in the registry');
});
