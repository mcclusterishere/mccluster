/* Review-only city adapter. Not wired into saves, rendering, or the tactical resolver.
   The PRIM3 session owns the shared contract. All sizes/origins are supplied explicitly;
   metric geography is sampled, never snapped or scaled. */
import { isWalkable, moveWithCollisions } from './spatial.mjs';

export function fineOccupancy(world, { coarseCellMeters, subdivisions = 2, originX = 0, originZ = 0, radius = .3 }) {
  if (!Number.isFinite(coarseCellMeters) || coarseCellMeters <= 0 || subdivisions !== 2
    || !Number.isFinite(originX) || !Number.isFinite(originZ) || !Number.isFinite(radius) || radius <= 0) {
    throw new TypeError('Supply a positive metric cell size, finite origin and body radius; this review supports 2 × 2 only.');
  }
  const cellMeters = coarseCellMeters / subdivisions;
  const toCell = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new TypeError('Metric position must be finite');
    return { x: Math.floor((x - originX) / cellMeters), y: Math.floor((z - originZ) / cellMeters) };
  };
  const centre = (x, y) => {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new TypeError('Cell indices must be integers');
    return { x: originX + (x + .5) * cellMeters, z: originZ + (y + .5) * cellMeters };
  };
  const open = (x, y) => { const p = centre(x, y); return isWalkable(p.x, p.z, world, radius); };
  const canStep = (a, b) => {
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1 || !open(a.x, a.y) || !open(b.x, b.y)) return false;
    const from = centre(a.x, a.y), to = centre(b.x, b.y);
    // Reuse continuous free-walk's swept collision, including thin furniture and water.
    const end = moveWithCollisions(from, to.x - from.x, to.z - from.z, world, undefined, radius);
    return Math.hypot(end.x - to.x, end.z - to.z) < 1e-8;
  };
  return { cellMeters, toCell, centre, open, canStep };
}
