import { coordinate, distanceBetween } from './route-core.mjs';

const prepared = new WeakMap();
function measurements(route) {
  if (prepared.has(route)) return prepared.get(route);
  const cumulative = [0];
  for (let i = 1; i < route.geometry.length; i++) cumulative.push(cumulative[i - 1] + distanceBetween(route.geometry[i - 1], route.geometry[i]));
  const length = cumulative.at(-1), scale = route.distanceMeters / length;
  const value = { cumulative, length, scale, steps: route.steps.map(s => cumulative[s.geometryIndex] * scale) };
  prepared.set(route, value); return value;
}

const wrap = lon => ((lon + 540) % 360) - 180;
function project(point, a, b, minT = 0, maxT = 1) {
  const latScale = Math.PI / 180 * 6371008.8, lonScale = latScale * Math.max(.00001, Math.cos(point[1] * Math.PI / 180));
  const ax = wrap(a[0] - point[0]) * lonScale, ay = (a[1] - point[1]) * latScale;
  const dx = wrap(b[0] - a[0]) * lonScale, dy = (b[1] - a[1]) * latScale;
  const t = Math.max(minT, Math.min(maxT, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
  return { t, distance: Math.hypot(ax + t * dx, ay + t * dy), snapped: [wrap(a[0] + t * wrap(b[0] - a[0])), a[1] + t * (b[1] - a[1])] };
}

// Foreground guidance derived from a real route. Poor fixes never advance a
// maneuver, trigger a reroute or assert arrival. Nearby crossing roads prefer
// continuity, rather than jumping to a later turn with similar coordinates.
export function navigationProgress(route, value, { accuracy = 0, previousProgressMeters = 0, maximumAdvanceMeters = 250 } = {}) {
  const point = coordinate(value), m = measurements(route);
  const previous = Math.max(0, Math.min(route.distanceMeters, Number(previousProgressMeters) || 0));
  const usable = typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100;
  const maxAdvance = Number.isFinite(maximumAdvanceMeters) ? Math.max(0, Math.min(2000, maximumAdvanceMeters)) : 250;
  const candidates = []; let nearestDistance = Infinity, best = null;
  for (let i = 1; i < route.geometry.length; i++) {
    const start = m.cumulative[i - 1] * m.scale, end = m.cumulative[i] * m.scale;
    if (end < previous - 70 || start > previous + maxAdvance) continue;
    const length = end - start || 1;
    const minT = Math.max(0, (previous - 70 - start) / length), maxT = Math.min(1, (previous + maxAdvance - start) / length);
    const p = project(point, route.geometry[i - 1], route.geometry[i], minT, maxT);
    const along = start + (end - start) * p.t;
    // Small GPS drift at a crossing is weaker evidence than a consistent
    // movement along the current section. Limit each fix's possible advance.
    nearestDistance = Math.min(nearestDistance, p.distance);
    candidates.push({ ...p, along });
  }
  const uncertainty = Math.max(5, Math.min(20, Number(accuracy) || 0));
  for (const candidate of candidates) {
    if (candidate.distance > nearestDistance + uncertainty) continue;
    if (!best || Math.abs(candidate.along - previous) < Math.abs(best.along - previous)) best = candidate;
  }
  if (!best) best = { distance: distanceBetween(point, route.geometry.at(-1)), along: previous, snapped: route.geometry.at(-1) };
  const offRoute = usable && Math.min(nearestDistance, best.distance) > Math.max(45, accuracy * 2);
  const distanceAlongMeters = usable && !offRoute ? Math.max(previous, best.along) : previous;
  const remainingDistanceMeters = Math.max(0, route.distanceMeters - distanceAlongMeters);
  const arrived = usable && !offRoute && remainingDistanceMeters <= 25 && distanceBetween(point, route.destination) <= 30 && accuracy <= 35;
  // The first instruction ahead, with a small crossing tolerance, is the next
  // action. This preserves the turn while approaching, then advances past it.
  let stepIndex = route.steps.findIndex((s, i) => i > 0 && m.steps[i] >= distanceAlongMeters - 5);
  if (stepIndex < 0) stepIndex = route.steps.length - 1;
  if (distanceAlongMeters < 3 && route.steps[0]?.maneuver.type === 'depart') stepIndex = 0;
  return { usable, distanceAlongMeters, remainingDistanceMeters,
    remainingSeconds: route.durationSeconds * remainingDistanceMeters / route.distanceMeters,
    stepIndex, nextStep: route.steps[stepIndex], distanceToNextMeters: Math.max(0, m.steps[stepIndex] - distanceAlongMeters),
    offRoute, arrived, snappedCoordinates: best.snapped };
}
