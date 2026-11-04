// Read-only navigation consumer. This does not authorize a tactical action or write a save.
import { clearEdge, distance, restorePosition, route, routeToEntrance } from '../spatial/region-graph.mjs';

export function previewSharedRoute(region, savedPosition, targetId, { maxDistanceM, closedRoadIds = savedPosition?.closedRoadIds ?? [], navigationRevision = 0 } = {}) {
  const c = region?.contract;
  if (!((c?.id === 'bridgeport-golden-hill.v1' && c.revision === 1) ||
        (c?.id === 'bridgeport-downtown.v2' && c.revision === 2)) ||
      c.schema !== 'mccluster.spatial-region/v1' ||
      c.frame.id !== 'bridgeport-golden-hill.enu.v1') {
    throw new Error('Unsupported shared spatial revision');
  }
  if (c.floor.id !== 'street' || c.floor.heightM !== 0 || c.floor.verticalLinks.length) {
    throw new Error('This consumer supports the street-only checkpoint');
  }
  if (!Number.isFinite(maxDistanceM) || maxDistanceM < 0) {
    throw new Error('An explicit nonnegative metre budget is required; AP is not metres');
  }
  if (!restorePosition(region, savedPosition)) throw new Error('Incompatible spatial position; original save retained');
  if (!Number.isInteger(navigationRevision) || navigationRevision < 0) throw new Error('Invalid navigation revision');
  if (!Array.isArray(closedRoadIds) || closedRoadIds.some(id => !region.roads.some(r => r.id === id))) throw new Error('Unknown closure road');
  const options = { closedRoadIds };
  const graph = region.graphs[savedPosition.topology];
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const entrance = graph.entrances?.find(e => e.id === targetId);
  if (!nodes.has(targetId) && !entrance) return null;
  // City owns transforms, connector selection and graph search. No cloned pathfinder.
  const candidate = (entrance ? routeToEntrance : route)(region, savedPosition.topology, savedPosition.position, targetId, options);
  if (!candidate) return null;
  let costM = 0;
  for (let i = 0; i < candidate.points.length; i++) {
    const point = candidate.points[i];
    if (![point.x, point.y, point.z].every(Number.isFinite) || point.y !== c.floor.heightM) {
      throw new Error('Route leaves its declared support surface');
    }
    if (!i) continue;
    const previous = candidate.points[i - 1];
    if (!clearEdge(region, previous, point, options)) throw new Error('Route fails shared body clearance');
    const length = distance(previous, point);
    if (i > 1 && i <= candidate.ids.length) {
      const edge = nodes.get(candidate.ids[i - 2]).edges.find(e => e.to === candidate.ids[i - 1]);
      if (!edge || !Number.isFinite(edge.costM) || edge.costM <= 0 || Math.abs(edge.costM - length) > 1e-7) {
        throw new Error('Route edge cost does not match checkpoint metre semantics');
      }
    }
    costM += length;
  }
  if (Math.abs(costM - candidate.costM) > 1e-7) throw new Error('Route total differs from metric path');
  return {
    regionId: c.id, revision: c.revision, frameId: c.frame.id,
    floorId: c.floor.id, topology: savedPosition.topology,
    navigationRevision, closedRoadIds: [...closedRoadIds],
    entranceId: candidate.entranceId ?? null,
    ids: [...candidate.ids], points: candidate.points.map(p => ({ ...p })),
    costM, withinBudget: costM <= maxDistanceM,
    // A metre budget is a navigation preview constraint, never tactical action approval.
    tacticalExecutionSupported: false,
  };
}

// Pure advisory quote for a NEW metric scenario. Caller supplies its explicit movement policy
// and player-known occupants only. No inferred legacy scale, hidden units, AP spend or reroute.
export function quoteSharedMovement(preview, { mode, moveRangeM, ap, moverId, radiusM, knownOccupants = [] } = {}) {
  if (!['MOVE', 'DASH'].includes(mode) || !Number.isFinite(moveRangeM) || moveRangeM <= 0 ||
      !Number.isInteger(ap) || ap < 0 || typeof moverId !== 'string' || !moverId ||
      !Number.isFinite(radiusM) || radiusM <= 0 || !Array.isArray(knownOccupants)) throw new Error('Explicit metric actor policy required');
  const blockedBy = new Set();
  for (const actor of knownOccupants) {
    if (typeof actor.id !== 'string' || !actor.id || typeof actor.floorId !== 'string' ||
        ![actor.position?.x, actor.position?.y, actor.position?.z, actor.radiusM].every(Number.isFinite) || actor.radiusM <= 0) throw new Error('Invalid known occupant');
    if (actor.id === moverId || actor.dead || actor.extracted || actor.floorId !== preview.floorId) continue;
    for (let i = 1; i < preview.points.length; i++) {
      const a = preview.points[i - 1], b = preview.points[i], dx = b.x - a.x, dz = b.z - a.z;
      const length2 = dx * dx + dz * dz;
      const t = length2 ? Math.max(0, Math.min(1, ((actor.position.x - a.x) * dx + (actor.position.z - a.z) * dz) / length2)) : 0;
      if (Math.hypot(actor.position.x - a.x - t * dx, actor.position.z - a.z - t * dz) < radiusM + actor.radiusM) blockedBy.add(actor.id);
    }
  }
  const apCost = mode === 'DASH' ? 2 : 1;
  return { apCost, withinRange: preview.costM > 0 && preview.costM <= moveRangeM * apCost,
    enoughAp: ap >= apCost, blockedKnownActorIds: [...blockedBy].sort(),
    tacticalExecutionSupported: false };
}
