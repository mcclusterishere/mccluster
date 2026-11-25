/* Record the Connecticut weather fixtures from the live feeds, once.

     node core/scripts/weather-record-fixtures.mjs [--dir core/fixtures/weather/connecticut-pilot]

   Writes the NWS and CO-OPS responses as received (the hourly forecast trimmed
   to its first 24 periods), the latest KOKX N0B and N0G Level III products
   byte for byte, and the latest MRMS PrecipRate message CROPPED to the region
   grid at its native 0.01 deg and re-encoded as a small GRIB2 (real values,
   same packing family), plus manifest.json with the recording time. Tests and
   `weather-snapshot-cli.mjs --fixture` replay these through the normal ingest
   path (src/weather/fixture-fetch.mjs). */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { GRID, REGION } from '../src/weather/region.mjs';
import { bucketUrl, fetchBytes, fetchJson, latestKey, level3Locator, mrmsLocator } from '../src/weather/ingest.mjs';
import { decodeWindow, encodeGrib2Png } from '../src/weather/grib2.mjs';
import { FIXTURE_DIR } from '../src/weather/fixture-fetch.mjs';

const dirArg = process.argv.indexOf('--dir');
const dir = dirArg >= 0 ? path.resolve(process.argv[dirArg + 1]) : FIXTURE_DIR;
fs.mkdirSync(dir, { recursive: true });
const now = new Date();
const f = REGION.feeds;
const write = (name, data) => { fs.writeFileSync(path.join(dir, name), data); return name; };

const json = {};
json.observation = write('nws-observation-kbdr.json', JSON.stringify(await fetchJson(f.observation.url), null, 1));
const forecast = await fetchJson(f.forecast_hourly.url);
delete forecast['@context'];
forecast.properties.periods = forecast.properties.periods.slice(0, 24);
json.forecast_hourly = write('nws-forecast-hourly-okx-58-67.json', JSON.stringify(forecast, null, 1));
json.alerts = write('nws-alerts-ctz009.json', JSON.stringify(await fetchJson(f.alerts.url), null, 1));
json.water_level = write('coops-water-level-8467150.json', JSON.stringify(await fetchJson(f.water_level.url), null, 1));
const start = new Date(now - 86_400_000);
const ymd = `${start.getUTCFullYear()}${String(start.getUTCMonth() + 1).padStart(2, '0')}${String(start.getUTCDate()).padStart(2, '0')}`;
json.tide_predictions = write('coops-predictions-hilo-8467150.json', JSON.stringify(await fetchJson(`${f.tide_predictions.url}&begin_date=${ymd}&range=72`), null, 1));

const objects = { [f.rain_now.bucket]: {}, [f.radar_reflectivity.bucket]: {} };
const lastModified = {};

const mrms = await latestKey({ ...mrmsLocator(f.rain_now), now, lookbackMin: 30 });
const grib = zlib.gunzipSync(await fetchBytes(`${bucketUrl(f.rain_now.bucket)}/${mrms.key}`));
const crop = decodeWindow(grib, GRID);
const small = encodeGrib2Png({
  referenceTime: crop.meta.reference_time, category: 6, number: 1,
  west: crop.window.west, north: crop.window.north, di: crop.window.di, dj: crop.window.dj,
  ni: crop.window.ni, nj: crop.window.nj, values: crop.values, decimalScale: 1, reference: -999,
});
objects[f.rain_now.bucket][mrms.key] = write('mrms-preciprate-ct-crop.grib2.gz', zlib.gzipSync(small));
lastModified[mrms.key] = mrms.last_modified;

for (const key of ['radar_reflectivity', 'radar_velocity']) {
  const item = await latestKey({ ...level3Locator(f[key]), now, lookbackMin: 40 });
  objects[f[key].bucket][item.key] = write(`${item.key}.nids`, await fetchBytes(`${bucketUrl(f[key].bucket)}/${item.key}`));
  lastModified[item.key] = item.last_modified;
}

const manifest = {
  recorded_at: now.toISOString(),
  replay_now: new Date(Math.ceil(now / 60_000) * 60_000).toISOString(),
  note: 'Recorded from the live public feeds by core/scripts/weather-record-fixtures.mjs. MRMS is a crop of the CONUS message to the region grid, re-encoded; every other file is the response as received (the forecast trimmed to 24 periods).',
  json, objects, last_modified: lastModified,
};
write('manifest.json', JSON.stringify(manifest, null, 1) + '\n');
console.log(JSON.stringify({ dir, recorded_at: manifest.recorded_at, files: fs.readdirSync(dir).map((n) => [n, fs.statSync(path.join(dir, n)).size]) }, null, 1));
