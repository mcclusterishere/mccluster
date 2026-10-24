import { distanceBetween } from './route-core.mjs';

const valid = heading => Number.isFinite(heading) && heading >= 0 && heading < 360;

// Course is device supplied when moving, otherwise derived from two accurate
// fixes. Keep the last course while stopped instead of spinning on GPS jitter.
export function movementHeading(fix, previous) {
  const last = valid(previous?.heading) ? previous.heading : null;
  if (fix.accuracy > 100) return last;
  if (valid(fix.heading) && (fix.speed === null || fix.speed >= .8)) return fix.heading;
  if (!previous || previous.accuracy > 100 || fix.speed === 0 ||
      fix.timestamp <= previous.timestamp || fix.timestamp - previous.timestamp > 20000 ||
      distanceBetween(previous.coordinates, fix.coordinates) < Math.max(6, fix.accuracy, previous.accuracy)) return last;
  const rad = Math.PI / 180;
  const [aLon, aLat] = previous.coordinates.map(v => v * rad);
  const [bLon, bLat] = fix.coordinates.map(v => v * rad);
  const delta = bLon - aLon;
  const heading = Math.atan2(Math.sin(delta) * Math.cos(bLat),
    Math.cos(aLat) * Math.sin(bLat) - Math.sin(aLat) * Math.cos(bLat) * Math.cos(delta));
  return (heading / rad + 360) % 360;
}
