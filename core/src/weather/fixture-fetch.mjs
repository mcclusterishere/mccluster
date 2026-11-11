/* A fetch that answers from recorded files, for tests and the one-shot dry run.

   It serves exactly the URLs the ingest path asks for: the NWS and CO-OPS JSON
   responses, a synthesized S3 listing of the recorded objects, and the objects
   themselves. Anything else is a 404, so a new upstream call cannot slip into a
   test unnoticed. `fail` maps a feed name to an HTTP status to rehearse outages. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/weather/connecticut-pilot');
export function fixtureManifest(dir = FIXTURE_DIR) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
}
/* the clock a replay runs at: the recording minute, rounded up */
export function fixtureNow(dir = FIXTURE_DIR) { return fixtureManifest(dir).replay_now; }

function response(status, body, type = 'application/json') {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return new Response(bytes, { status, headers: { 'content-type': type, 'content-length': String(bytes.length) } });
}

export function fixtureFetch({ dir = FIXTURE_DIR, fail = {}, calls = [] } = {}) {
  const manifest = fixtureManifest(dir);
  const objects = manifest.objects; // { bucket: { key: file } }
  return async (input) => {
    const url = new URL(String(input));
    calls.push(url.href);
    const host = url.hostname;
    const route = (feed, file) => (fail[feed] ? response(fail[feed], '{"error":"rehearsed outage"}') : response(200, fs.readFileSync(path.join(dir, file))));
    if (host === 'api.weather.gov') {
      if (url.pathname === '/stations/KBDR/observations/latest') return route('observation', manifest.json.observation);
      if (url.pathname === '/gridpoints/OKX/58,67/forecast/hourly') return route('forecast_hourly', manifest.json.forecast_hourly);
      if (url.pathname === '/alerts/active' && url.searchParams.get('zone') === 'CTZ009') return route('alerts', manifest.json.alerts);
    }
    if (host === 'api.tidesandcurrents.noaa.gov' && url.searchParams.get('station') === '8467150') {
      if (url.searchParams.get('product') === 'water_level') return route('water_level', manifest.json.water_level);
      if (url.searchParams.get('product') === 'predictions') return route('tide_predictions', manifest.json.tide_predictions);
    }
    const bucket = host.endsWith('.s3.amazonaws.com') ? host.slice(0, -'.s3.amazonaws.com'.length) : null;
    if (bucket && objects[bucket]) {
      const feedOf = (key) => (bucket === 'noaa-mrms-pds' ? 'rain_now' : key.includes('_N0G_') ? 'radar_velocity' : 'radar_reflectivity');
      if (url.pathname === '/' && url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') || '';
        const after = url.searchParams.get('start-after') || '';
        const keys = Object.keys(objects[bucket]).filter((k) => k.startsWith(prefix) && k > after).sort();
        if (keys.some((k) => fail[feedOf(k)])) return response(fail[feedOf(keys[0])], '<Error/>', 'application/xml');
        const contents = keys.map((k) => `<Contents><Key>${k}</Key><LastModified>${manifest.last_modified?.[k] || FIXTURE_NOW}</LastModified><Size>${fs.statSync(path.join(dir, objects[bucket][k])).size}</Size></Contents>`).join('');
        return response(200, `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><KeyCount>${keys.length}</KeyCount>${contents}</ListBucketResult>`, 'application/xml');
      }
      const key = decodeURIComponent(url.pathname.slice(1));
      if (objects[bucket][key]) return fail[feedOf(key)] ? response(fail[feedOf(key)], '') : response(200, fs.readFileSync(path.join(dir, objects[bucket][key])), 'application/octet-stream');
    }
    return response(404, '{"error":"not a recorded fixture"}');
  };
}
