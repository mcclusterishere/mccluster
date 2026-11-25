// Scratch driver (not part of any patch). Runs a PRIM3 topology-learning browser journey module
// (the PR's scripts/e2e/prim3-topology-learning.e2e.mjs, or a recorded scratch variant of it)
// in Chromium with the real Worker handler workers/mccluster/src/prim3/learning.js from
// <worker-root>, over the in-memory PostgREST double in memory-rest.mjs. It replaces only what
// scripts/test-prim3-adaptive-postgres.mjs provides to the journey (handleLearning, env, options);
// the PostgreSQL/PostgREST part of that harness is NOT run here.
//   [W5_JOURNEY=release] node topology-e2e-driver.mjs <worker-root> <e2e-module>
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { memoryRest } from './memory-rest.mjs';
const [workerRoot, e2eModule] = process.argv.slice(2).map(p => resolve(p));
const { handleLearning } = await import(pathToFileURL(`${workerRoot}/workers/mccluster/src/prim3/learning.js`).href);
// W5_JOURNEY=release runs the module's runReviewedReleaseBrowser (scripts/e2e/prim3-reviewed-release.e2e.mjs) instead.
const journey = await import(pathToFileURL(e2eModule).href), run = process.env.W5_JOURNEY === 'release' ? journey.runReviewedReleaseBrowser : journey.runTopologyLearningBrowser;
const db = memoryRest(), SUPABASE_URL = 'https://db.fixture.invalid', original = globalThis.fetch;
globalThis.fetch = async (url, init) => String(url).startsWith(SUPABASE_URL + '/') ? db.fetchImpl(url, init) : original(url, init);
const owner = randomUUID();
const env = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role', PRIM3_ADAPTIVE_ENABLED: 'true',
  PRIM3_ADAPTIVE_SIGNING_KEY: randomBytes(32).toString('hex'), PRIM3_RELEASES_ENABLED: 'true' };
const options = { requireHouseOwner: async () => ({ id: owner }) };
console.log(`DRIVER: worker ${workerRoot}; journey module ${e2eModule}; served root ${process.env.MCC_SERVE_ROOT || '(the module\'s own checkout)'}; variant filter ${process.env.PRIM3_TOPOLOGY_VARIANT || '(all)'}`);
const started = Date.now();
try {
  await run({ handleLearning, env, options });
  console.log(`DRIVER: PASS in ${((Date.now() - started) / 1000).toFixed(1)} s; fixture requests ${db.calls.length}; releases ${db.tables.prim3_reviewed_releases.length}; sessions ${db.tables.learning_lab_sessions.length}; evidence rows ${db.tables.learning_evidence_events.length}`);
} catch (error) {
  console.log(`DRIVER: FAIL after ${((Date.now() - started) / 1000).toFixed(1)} s; fixture requests ${db.calls.length}`);
  throw error;
}
