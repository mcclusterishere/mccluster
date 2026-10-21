// The public route contract contains directions, never a fare or a booking.
export const ROUTE_MODES = Object.freeze(['drive', 'walk', 'cycle']);
export const MAX_ROUTE_POINTS = 10000;
export const MAX_ROUTE_STEPS = 1500;

export function coordinate(value) {
  if (!Array.isArray(value) || value.length !== 2 || ![value[0], value[1]].every(v => typeof v === 'number' && Number.isFinite(v)) ||
      Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) throw new TypeError('Choose a specific starting point and destination from the address results.');
  return [...value];
}

export function distanceBetween(a, b) {
  const rad = Math.PI / 180, lat = (b[1] - a[1]) * rad, lon = (b[0] - a[0]) * rad;
  const x = Math.sin(lat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(lon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(Math.min(1, x)), Math.sqrt(Math.max(0, 1 - x)));
}

export function normalizeRouteRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !ROUTE_MODES.includes(input.mode)) {
    throw new TypeError('Street directions support driving, walking and cycling.');
  }
  const origin = coordinate(input.origin), destination = coordinate(input.destination);
  if (distanceBetween(origin, destination) < 5) throw new RangeError('Your starting point and destination are the same. Choose a different destination.');
  return { origin, destination, mode: input.mode };
}

const metric = (value, max) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new TypeError('The routing service returned incomplete directions.');
  return value;
};
const clean = (value, max = 300) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';

export function normalizeRoute(input) {
  const request = normalizeRouteRequest(input);
  if (!Array.isArray(input.geometry) || input.geometry.length < 2 || input.geometry.length > MAX_ROUTE_POINTS ||
      !Array.isArray(input.steps) || !input.steps.length || input.steps.length > MAX_ROUTE_STEPS) {
    throw new TypeError('This route is too large or incomplete. Try a nearer stop.');
  }
  const geometry = Array.from(input.geometry, coordinate);
  let previous = 0;
  const steps = Array.from(input.steps, step => {
    if (!step || typeof step !== 'object') throw new TypeError('The routing service returned incomplete turn instructions.');
    const index = step.geometryIndex;
    if (!Number.isInteger(index) || index < previous || index >= geometry.length || !clean(step.instruction)) {
      throw new TypeError('The routing service returned incomplete turn instructions.');
    }
    previous = index;
    const location = coordinate(step.location);
    if (distanceBetween(location, geometry[index]) > 60) throw new TypeError('Turn instructions do not match the road route.');
    return { instruction: clean(step.instruction), distanceMeters: metric(step.distanceMeters, 50000000),
      durationSeconds: metric(step.durationSeconds, 10000000), location, geometryIndex: index,
      maneuver: { type: clean(step.maneuver?.type, 50) || 'continue', modifier: clean(step.maneuver?.modifier, 50) } };
  });
  const distanceMeters = metric(input.distanceMeters, 50000000), durationSeconds = metric(input.durationSeconds, 10000000);
  if (distanceMeters <= 0 || durationSeconds <= 0 || !geometry.some(p => distanceBetween(p, geometry[0]) > 1)) {
    throw new TypeError('No usable street route was returned.');
  }
  // A routing engine can snap a destination onto a road, but must not silently
  // move the traveler to an unrelated place across town.
  if (distanceBetween(request.origin, geometry[0]) > 1000 || distanceBetween(request.destination, geometry.at(-1)) > 1000) {
    throw new TypeError('No nearby road or path reaches one of these places. Choose its entrance or a nearby street.');
  }
  return { ...request, provider: clean(input.provider, 60), attribution: clean(input.attribution, 200),
    distanceMeters, durationSeconds, geometry, steps, traffic: input.traffic === true,
    warnings: Array.isArray(input.warnings) ? input.warnings.map(s => clean(s)).filter(Boolean).slice(0, 4) : [] };
}

// Bound streamed JSON before materializing it. Used on both sides of the API.
export async function boundedJson(response, maxBytes = 2000000) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel(); throw new RangeError('The route response is too large. Try a nearer stop.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError('The routing service returned an empty response.');
  const decoder = new TextDecoder(); let size = 0, text = '';
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new RangeError('The route response is too large. Try a nearer stop.'); }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}
