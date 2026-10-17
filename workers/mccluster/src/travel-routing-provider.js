import { normalizeRouteRequest, normalizeRoute, coordinate, distanceBetween, boundedJson, MAX_ROUTE_POINTS, MAX_ROUTE_STEPS } from '../../../js/travel/route-core.mjs';

const issue = (message, status = 503, retryAfter = 0) => Object.assign(new Error(message), { status, retryAfter });
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 180) : '';

export function routingProvider(env) {
  if (env.TRAVEL_ROUTING_PROVIDER === 'tomtom' && env.TRAVEL_TOMTOM_API_KEY) return 'tomtom';
  // This explicit pilot has no paid routing, booking or commission. It must be
  // replaced before those become part of Travel; nonprofit status alone does
  // not establish permission to use the public service commercially.
  if (env.TRAVEL_ROUTING_PROVIDER === 'fossgis-pilot' && env.TRAVEL_ROUTING_PILOT === 'noncommercial') return 'fossgis-pilot';
  return null;
}

function turnInstruction(step) {
  const m = step.maneuver || {}, road = clean(step.name) || clean(step.ref), onto = road ? ` onto ${road}` : '';
  const direction = ({ 'uturn': 'Make a U-turn', 'sharp right': 'Turn sharply right', right: 'Turn right', 'slight right': 'Bear right', straight: 'Continue straight',
    'slight left': 'Bear left', left: 'Turn left', 'sharp left': 'Turn sharply left' })[m.modifier] || 'Continue';
  const destination = clean(step.destinations), toward = destination ? ` toward ${destination}` : '';
  switch (m.type) {
    case 'depart': return `Start${road ? ` on ${road}` : ' along the route'}`;
    case 'arrive': return `Arrive at your destination${m.modifier === 'left' || m.modifier === 'right' ? ` on the ${m.modifier}` : ''}`;
    case 'roundabout': case 'rotary': return `Enter the roundabout${Number.isInteger(m.exit) && m.exit > 0 ? ` and take exit ${m.exit}` : ''}${onto}`;
    case 'roundabout turn': return `${direction} at the roundabout${onto}`;
    case 'exit roundabout': case 'exit rotary': return `Exit the roundabout${onto}`;
    case 'merge': return `Merge${m.modifier && m.modifier !== 'straight' ? ` ${clean(m.modifier)}` : ''}${onto}${toward}`;
    case 'on ramp': return `Take the ramp${m.modifier && m.modifier !== 'straight' ? ` ${clean(m.modifier)}` : ''}${onto}${toward}`;
    case 'off ramp': return `Take the exit${clean(step.exits) ? ` ${clean(step.exits)}` : ''}${onto}${toward}`;
    case 'fork': return `Keep ${m.modifier === 'straight' ? 'straight' : clean(m.modifier) || 'along the route'} at the fork${onto}${toward}`;
    case 'end of road': return `${direction} at the end of the road${onto}`;
    case 'new name': case 'notification': return `Continue${road ? ` on ${road}` : ' along the route'}`;
    default: return `${direction}${onto}${toward}`;
  }
}

function geometryIndex(geometry, location, start, final = false) {
  if (final) return geometry.length - 1;
  let best = start, distance = Infinity;
  for (let i = start; i < geometry.length; i++) {
    const d = distanceBetween(location, geometry[i]);
    if (d < distance) { best = i; distance = d; }
    if (d < .5) break;
  }
  return best;
}

export function osrmRoute(data, input) {
  if (data?.code === 'NoRoute' || data?.code === 'NoSegment') throw issue('No connected road or path was found. Choose an entrance or a nearby street, or plan a longer trip.', 422);
  const route = data?.routes?.[0];
  if (data?.code !== 'Ok' || route?.geometry?.type !== 'LineString') throw issue('Street directions are unavailable for these places. Please try again.', 502);
  if (!Array.isArray(route.geometry.coordinates) || route.geometry.coordinates.length > MAX_ROUTE_POINTS) throw issue('This route is too large. Choose an intermediate stop.', 422);
  const geometry = route.geometry.coordinates.map(coordinate), rawSteps = route.legs?.flatMap(l => l.steps || []) || [];
  if (!rawSteps.length || rawSteps.length > MAX_ROUTE_STEPS) throw issue('The route has incomplete turn instructions. Please try again.', 502);
  let previous = 0;
  const steps = rawSteps.map(step => {
    const location = coordinate(step.maneuver?.location);
    const index = geometryIndex(geometry, location, previous, step.maneuver?.type === 'arrive'); previous = index;
    return { instruction: turnInstruction(step), location, geometryIndex: index, distanceMeters: step.distance,
      durationSeconds: step.duration, maneuver: { type: clean(step.maneuver?.type), modifier: clean(step.maneuver?.modifier) } };
  });
  return normalizeRoute({ ...input, provider: 'FOSSGIS / OSRM', attribution: '© OpenStreetMap contributors · Routing by FOSSGIS / OSRM',
    distanceMeters: route.distance, durationSeconds: route.duration, geometry, steps, traffic: false,
    warnings: ['Travel time is an estimate without live traffic.'] });
}

export function tomtomRoute(data, input) {
  const route = data?.routes?.[0];
  if (!route) throw issue('No connected route was found for these places.', 422);
  const rawPoints = route.legs?.flatMap(l => l.points || []) || [];
  if (rawPoints.length > MAX_ROUTE_POINTS) throw issue('This route is too large. Choose an intermediate stop.', 422);
  const geometry = rawPoints.map(p => coordinate([p.longitude, p.latitude]));
  const instructions = route.guidance?.instructions || [];
  if (!instructions.length || instructions.length > MAX_ROUTE_STEPS) throw issue('The route has incomplete turn instructions. Please try again.', 502);
  let previous = 0;
  const steps = instructions.map((step, i) => {
    const location = coordinate([step.point?.longitude, step.point?.latitude]);
    const final = i === instructions.length - 1;
    const index = geometryIndex(geometry, location, previous, final); previous = index;
    const next = instructions[i + 1];
    return { instruction: clean(step.message) || clean(step.combinedMessage) || (final ? 'Arrive at your destination' : 'Continue along the route'),
      location, geometryIndex: index,
      distanceMeters: next ? Math.max(0, next.routeOffsetInMeters - step.routeOffsetInMeters) : 0,
      durationSeconds: next ? Math.max(0, next.travelTimeInSeconds - step.travelTimeInSeconds) : 0,
      maneuver: { type: i === 0 ? 'depart' : final ? 'arrive' : clean(step.maneuver).toLowerCase(), modifier: '' } };
  });
  return normalizeRoute({ ...input, provider: 'TomTom', attribution: '© TomTom', distanceMeters: route.summary?.lengthInMeters,
    durationSeconds: route.summary?.travelTimeInSeconds, geometry, steps, traffic: input.mode === 'drive', warnings: [] });
}

export async function performStreetRoute(input, env, { request = fetch } = {}) {
  input = normalizeRouteRequest(input);
  const provider = routingProvider(env);
  if (!provider) throw issue('Street routing is not connected yet. Please try again after the service is connected.');
  let url;
  if (provider === 'tomtom') {
    const endpoints = [input.origin, input.destination].map(p => `${p[1]},${p[0]}`).join(':');
    url = new URL(`https://api.tomtom.com/routing/1/calculateRoute/${endpoints}/json`);
    url.searchParams.set('key', env.TRAVEL_TOMTOM_API_KEY);
    url.searchParams.set('travelMode', { drive: 'car', walk: 'pedestrian', cycle: 'bicycle' }[input.mode]);
    url.searchParams.set('instructionsType', 'text'); url.searchParams.set('language', 'en-US');
    url.searchParams.set('traffic', String(input.mode === 'drive')); url.searchParams.set('routeType', 'fastest');
  } else {
    const base = new URL(env.TRAVEL_OSRM_BASE || 'https://routing.openstreetmap.de/');
    // Provider configuration is operator-owned, never a URL supplied by a
    // traveler. The pilot is pinned to its reviewed host and paths.
    if (base.protocol !== 'https:' || base.host !== 'routing.openstreetmap.de' || base.username || base.password || base.search || base.hash) throw issue('The routing service configuration needs attention.');
    const profile = { drive: 'car', walk: 'foot', cycle: 'bike' }[input.mode];
    url = new URL(`/routed-${profile}/route/v1/driving/${input.origin.join(',')};${input.destination.join(',')}`, base);
    url.searchParams.set('steps', 'true'); url.searchParams.set('geometries', 'geojson'); url.searchParams.set('overview', 'full');
    url.searchParams.set('alternatives', 'false'); url.searchParams.set('generate_hints', 'false'); url.searchParams.set('radiuses', '250;250');
  }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  try {
    // workerd supports manual redirects; never follow one with precise endpoints
    // or a provider secret. A redirect is rejected by the non-OK branch below.
    const response = await request(url.href, { signal: controller.signal, redirect: 'manual', headers: {
      accept: 'application/json', 'user-agent': 'McCluster-Travel/1.0 (+https://mccluster.org; matthew@mccluster.org)', referer: 'https://mccluster.org/'
    } });
    if (response.status === 429) { await response.body?.cancel(); throw issue('The routing service is busy. Please try again in a minute.', 429, 60); }
    if (!response.ok) { await response.body?.cancel(); throw issue(response.status === 400 ? 'No route reaches one of these places. Try its entrance or a nearby street.' : 'The routing service is temporarily unavailable. Please try again.', response.status === 400 ? 422 : 503); }
    const data = await boundedJson(response);
    return provider === 'tomtom' ? tomtomRoute(data, input) : osrmRoute(data, input);
  } catch (error) {
    // Never propagate an upstream URL: it contains coordinates and may have a key.
    if (error.status) throw error;
    throw issue(controller.signal.aborted ? 'Street directions took too long. Please try again.' : 'The routing service returned incomplete directions. Please try again.', 503);
  } finally { clearTimeout(timer); }
}
