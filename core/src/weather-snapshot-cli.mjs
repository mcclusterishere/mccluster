/* ONE-SHOT WEATHER SNAPSHOT, no queue and no database.

     node src/weather-snapshot-cli.mjs --fixture            recorded fixtures, fixed clock (default)
     node src/weather-snapshot-cli.mjs --live               fetch every feed once, now
     node src/weather-snapshot-cli.mjs --live --out FILE    also write the snapshot JSON
     node src/weather-snapshot-cli.mjs --fixture --fail rain_now,alerts   rehearse outages

   Prints a per-feed summary (status, observed/issued time, age, flags) and the
   snapshot size. It never writes to Supabase and never enqueues a job; the
   scheduled path is the weather_region_snapshot job (executors/weather-region-snapshot.mjs). */
import fs from 'node:fs';
import { ingestRegion, buildSnapshot, withAges } from './weather/ingest.mjs';
import { fixtureFetch, fixtureNow } from './weather/fixture-fetch.mjs';

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

async function main() {
  const live = process.argv.includes('--live');
  const failing = String(arg('--fail') || '').split(',').filter(Boolean);
  const now = live ? new Date() : new Date(arg('--now') || fixtureNow());
  const fetchImpl = live ? globalThis.fetch : fixtureFetch({ fail: Object.fromEntries(failing.map((f) => [f, 503])) });
  const { records, receipts } = await ingestRegion({ now, fetchImpl });
  const snapshot = withAges(buildSnapshot({ now, records, receipts, mode: live ? 'live' : 'fixture' }), now);
  const json = JSON.stringify(snapshot);
  if (arg('--out')) fs.writeFileSync(arg('--out'), JSON.stringify(snapshot, null, 1));
  const rows = Object.values(snapshot.feeds).map((r) => ({
    feed: r.feed, status: r.status, kind: r.data_kind, time: r.observed_at || r.issued_at, age_s: r.age_s, stale: r.stale,
    flags: (r.quality_flags || []).join(' '), reason: r.missing_reason || '',
  }));
  console.log(JSON.stringify({ mode: snapshot.mode, generated_at: snapshot.generated_at, counts: snapshot.counts, bytes: json.length, receipts }, null, 1));
  console.table(rows);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
