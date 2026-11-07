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
import { FEED_KEYS } from './weather/region.mjs';

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }

async function main() {
  const args = process.argv.slice(2), switches = new Set(['--live', '--fixture', '--check', '--help']);
  for (let i = 0; i < args.length; i++) {
    if (switches.has(args[i])) continue;
    if (['--fail', '--now', '--out'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) { i++; continue; }
    throw new Error('Invalid argument. Use --help for weather snapshot options.');
  }
  if (args.includes('--help')) {
    console.log('Usage: node src/weather-snapshot-cli.mjs [--fixture | --live] [--check] [--out FILE] [--fail FEEDS] [--now ISO_TIME]');
    console.log('Default: recorded fixtures. --check exits nonzero if any feed is missing, stale or carried forward. --fail and --now are fixture-only. No database writes or scheduled jobs.');
    return;
  }
  if (args.includes('--live') && (args.includes('--fixture') || args.includes('--fail') || args.includes('--now'))) {
    throw new Error('Live reads cannot be combined with fixture mode, simulated failures or a fixture clock.');
  }
  const live = process.argv.includes('--live');
  const failing = String(arg('--fail') || '').split(',').filter(Boolean);
  if (failing.some(feed => !FEED_KEYS.includes(feed))) throw new Error('Unknown simulated feed.');
  const now = live ? new Date() : new Date(arg('--now') || fixtureNow());
  if (!Number.isFinite(now.valueOf())) throw new Error('Invalid fixture timestamp.');
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
  if (args.includes('--check')) {
    const unavailable = Object.values(snapshot.feeds).filter(r => r.status !== 'ok' || r.stale === true).map(r => r.feed);
    console.log(JSON.stringify({ readiness: unavailable.length ? 'not_ready' : 'ready', mode: snapshot.mode, unavailable }));
    if (unavailable.length) process.exitCode = 1;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
