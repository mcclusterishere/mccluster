// Read-only navigation consumer. This does not authorize a tactical action or write a save.
import { clearEdge, distance, restorePosition, route } from '../spatial/region-graph.mjs';

export function previewSharedRoute(region, savedPosition, targetId, { maxDistanceM } = {}) {
  const c = region?.contract;
  if (c?.id !== 'bridgeport-golden-hill.v1' || c.revision !== 1 ||
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
  const graph = region.graphs[savedPosition.topology];
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  if (!nodes.has(targetId)) return null;
  // City owns transforms, connector selection and graph search. No cloned pathfinder.
  const candidate = route(region, savedPosition.topology, savedPosition.position, targetId);
  if (!candidate) return null;
  let costM = 0;
  for (let i = 0; i < candidate.points.length; i++) {
    const point = candidate.points[i];
    if (![point.x, point.y, point.z].every(Number.isFinite) || point.y !== c.floor.heightM) {
      throw new Error('Route leaves its declared support surface');
    }
    if (!i) continue;
    const previous = candidate.points[i - 1];
    if (!clearEdge(region, previous, point)) throw new Error('Route fails shared body clearance');
    const length = distance(previous, point);
    if (i > 1) {
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
    ids: [...candidate.ids], points: candidate.points.map(p => ({ ...p })),
    costM, withinBudget: costM <= maxDistanceM,
    // A metre budget is a navigation preview constraint, never tactical action approval.
    tacticalExecutionSupported: false,
  };
}
