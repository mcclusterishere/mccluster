/* WEATHER REGION SNAPSHOT: Connecticut weather, ingested once per region.

   One job (job_type weather_region_snapshot, target connecticut-pilot) fetches
   every feed in ../weather/region.mjs exactly once (NWS observation, hourly
   forecast and alerts; NOAA CO-OPS Bridgeport water level and high/low
   predictions; MRMS PrecipRate; KOKX N0B reflectivity and N0G radial velocity),
   normalizes them (../weather/fields.mjs) and returns ONE small snapshot as the
   job's output. Readers read that output, never the providers:

     - Worker `mccluster`, GET /v1/world/weather/connecticut-pilot (owner only),
       reads the latest finished job's output from ops_agent_jobs, the same way
       the morning briefs are read (workers/mccluster/src/world-weather.js);
     - this box keeps the same JSON at
       $MCCLUSTER_WEATHER_DIR/connecticut-pilot/latest.json
       (default /var/lib/mccluster-core/artifacts/weather), written atomically.

   No new table: the snapshot is a job output, like the morning brief. Players
   never cause an upstream call; a reader is one Supabase read, cached at the edge.

   Degrades, never fails, on upstream trouble: a feed that does not answer is
   `missing`, or the previous snapshot's record `carried_forward` with its own
   original times so it keeps ageing (../weather/ingest.mjs). The job throws only
   when it is outside Core's authority, so an outage never pages the owner.

   Scheduling is OFF by default: the timer (mccluster-core-weather.timer) is not
   in the deploy script's enable list, and the seed refuses to queue unless
   WEATHER_INGEST_ENABLED=true. One-shot runs need neither:
   `node src/weather-snapshot-cli.mjs --fixture` or `--live`. */
import fs from 'node:fs';
import path from 'node:path';
import { rest, resolveHouseOrgId } from '../supabase.mjs';
import { REGION_ID } from '../weather/region.mjs';
import { buildSnapshot, ingestRegion } from '../weather/ingest.mjs';

export const JOB_TYPE = 'weather_region_snapshot';
export const EXECUTOR = 'weather_region_snapshot:v1';
export const DEFAULT_DIR = '/var/lib/mccluster-core/artifacts/weather';

export function weatherDir(env = process.env) {
  return path.resolve(env.MCCLUSTER_WEATHER_DIR || DEFAULT_DIR);
}

/* The previous snapshot: the last finished job's output, else the local file. */
export async function previousSnapshot({ query = rest, orgId, dir }) {
  try {
    const { body = [] } = await query(`ops_agent_jobs?org_id=eq.${orgId}&job_type=eq.${JOB_TYPE}&target_id=eq.${REGION_ID}&status=eq.done&select=output&order=updated_at.desc&limit=1`);
    const snap = body?.[0]?.output?.snapshot;
    if (snap?.feeds) return { snapshot: snap, from: 'job' };
  } catch { /* fall through to the file */ }
  try {
    const snap = JSON.parse(fs.readFileSync(path.join(dir, REGION_ID, 'latest.json'), 'utf8'));
    if (snap?.feeds) return { snapshot: snap, from: 'file' };
  } catch { /* none yet */ }
  return { snapshot: null, from: null };
}

/* Write latest.json atomically (temp file + rename). Best effort: a read-only
   or missing directory is reported in the output, never a failed job. */
export function writeLocal(snapshot, dir) {
  try {
    const target = path.join(dir, REGION_ID);
    fs.mkdirSync(target, { recursive: true, mode: 0o750 });
    const file = path.join(target, 'latest.json');
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(snapshot), { mode: 0o640 });
    fs.renameSync(tmp, file);
    return { written: true, path: file };
  } catch (error) {
    return { written: false, reason: String(error?.code || 'write_failed').slice(0, 40) };
  }
}

export async function weatherRegionSnapshot(job, {
  query = rest, resolveOrg = resolveHouseOrgId, fetchImpl = globalThis.fetch, inflate,
  env = process.env, now = new Date(),
} = {}) {
  const orgId = await resolveOrg();
  if (job?.org_id !== orgId) throw new Error('Weather snapshot job outside Core authority');
  const region = job?.target_id || REGION_ID;
  if (region !== REGION_ID) throw new Error(`Weather snapshot: unknown region ${String(region).slice(0, 60)}`);
  const started = Date.now();
  const dir = weatherDir(env);
  const prev = await previousSnapshot({ query, orgId, dir });
  const { records, receipts } = await ingestRegion({ now, fetchImpl, inflate });
  const snapshot = buildSnapshot({ now, records, receipts, previous: prev.snapshot, mode: 'live' });
  const local = writeLocal(snapshot, dir);
  const bytes = Buffer.byteLength(JSON.stringify(snapshot));
  return {
    executor: EXECUTOR,
    summary: `weather ${REGION_ID}: ${snapshot.counts.ok} fresh, ${snapshot.counts.carried_forward} carried forward, ${snapshot.counts.missing} missing`,
    region: REGION_ID,
    counts: snapshot.counts,
    receipts,
    previous_from: prev.from,
    local,
    bytes,
    wall_ms: Date.now() - started,
    snapshot,
  };
}
