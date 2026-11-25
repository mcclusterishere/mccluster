/* Player-known movement guidance over the canonical resolver. This never commits state or predicts
   hidden contacts: real execution may stop at an unknown door/unit or react to overwatch. */
import { createState, moveUnit } from './tactical-resolver.mjs';
import { playerProjection, knownPaths } from './tactical-hints.mjs';
const key = (x, y, z = 0) => `${x}:${y}:${z}`;
export function movementGuidance(state, unitId) {
  const tiles = [], entries = new Map();
  const result = { tiles, at: (x,y,z=0) => entries.get(key(x,y,z)),
    pathTo: (x,y,z=0) => entries.get(key(x,y,z))?.path || null,
    stepsTo: (x,y,z=0) => entries.get(key(x,y,z))?.steps };
  const unit = state.units.find(u => u.id === unitId);
  if (!unit || unit.faction !== 'PLAYER' || state.phase !== 'PLAYER' || unit.dead || unit.downed || unit.statuses.includes('EXTRACTED') || unit.ap < 1) return result;
  const projection = playerProjection(state);
  // Rebuild only known geometry, as tactical-hints does. Restore exact live unit flags/AP after
  // normalization. Machines' known closed-door cells are already in projection.blockers; do not
  // normalize machines into fresh ACTIVE states or reintroduce unseen doors/turrets.
  const known = createState({ width: projection.width, height: projection.height, floors: projection.floors,
    units: projection.units, blockers: projection.blockers, cover: projection.cover,
    surfaces: projection.surfaces, links: projection.links, objectives: projection.objectives });
  result.knownState = known;
  known.units = projection.units;
  known.phase = projection.phase; known.round = projection.round;
  projection.units = projection.units.map(u => u.id === unitId ? { ...u, moveRange: unit.moveRange * (unit.ap >= 2 ? 2 : 1) } : u);
  const paths = knownPaths(projection, unitId);
  for (const [k, steps] of paths.dist) {
    if (steps <= 0) continue;
    const [x,y,z] = k.split(':').map(Number), path = paths.pathTo(x,y,z);
    const apCost = steps <= unit.moveRange ? 1 : 2, mode = apCost === 1 ? 'MOVE' : 'DASH';
    if (apCost > unit.ap || !path?.length) continue;
    try { moveUnit(known, unitId, {x,y,z}, mode, {path}); }
    catch { continue; }
    const tile = {x,y,z,steps,apCost,mode,path};
    tiles.push(tile); entries.set(k,tile);
  }
  return result;
}

// Length of the known waypoint polyline, not a promise about stair-flight mesh length or AP cost.
export function waypointDistance(state, start, path, metresPerCell) {
  const height = p => {
    const s = state.surfaces?.find(s => s.z === (p.z || 0) && p.x >= s.x && p.x < s.x+s.w && p.y >= s.y && p.y < s.y+s.d);
    return s ? s.height : (p.z || 0) === 0 ? 0 : null;
  };
  let distance = 0, previous = start;
  for (const point of path) {
    const a = height(previous), b = height(point);
    if (a === null || b === null) return null;
    distance += Math.hypot((point.x-previous.x)*metresPerCell,(point.y-previous.y)*metresPerCell,b-a);
    previous = point;
  }
  return distance;
}
