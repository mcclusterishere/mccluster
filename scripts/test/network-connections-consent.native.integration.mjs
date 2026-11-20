// The pending consent guard on public.network_connections on a real PostgreSQL server: the same proof the PGlite test
// runs (scripts/test/support/network-connections-database.mjs: production's layer, the hole before, the refusals,
// the fix, the legitimate flows, the second lock, the rollback), here with what one PGlite session cannot show:
//   - the file applied statement by statement on one session, as psql -v ON_ERROR_STOP=1 -f does, while every member
//     request runs on another session, so only what the fix COMMITTED is what members meet;
//   - the 5 s bound: behind a member's request that is still reading the table, the fix gives up after lock_timeout
//     (55P03) and changes nothing, instead of queueing every later request behind its lock;
//   - PostgreSQL 16, which has no MAINTAIN privilege, and 17.
//
//   ALLOW_LOCAL_EUP_DB_TESTS=1 PG_BIN=/usr/lib/postgresql/16/bin PG_MODULE=<node-postgres> \
//     node scripts/test/network-connections-consent.native.integration.mjs
//
// Disposable server only (scripts/test/support/native-postgres.mjs: 127.0.0.1, removed afterwards); never the
// canonical project. NETWORK_CONNECTIONS_CONSENT_DIR replaces supabase/pending/ for the fix and its rollback (mutants).
import { refuseUnlessAllowed, startNativePostgres } from './support/native-postgres.mjs';
import { M, nativeAdapter, buildProductionLayer, runConsentProof, fingerprintDiff } from './support/network-connections-database.mjs';

refuseUnlessAllowed('network-connections-consent.native');
const server = await startNativePostgres();
const DB = 'network_connections_consent';
let db;

/** Behind a member request that still holds the table, the fix waits 5 s at most, then gives up and changes nothing. */
async function boundedWait({ ok, eq, fix, hole, fp, applyFile, settle }) {
  const holder = await db.openRequest('authenticated', M.ivy.user);
  try {
    await holder.query('select count(*) from public.network_connections'); // the request's ACCESS SHARE lock stays until it ends
    await db.adminClient.query("set statement_timeout = '20s'"); // so a file without its lock_timeout fails here instead of hanging
    const started = Date.now();
    const x = await settle(applyFile(db, fix));
    const waited = Date.now() - started;
    await db.adminClient.query('reset statement_timeout');
    eq(x.ok ? 'applied' : x.code, '55P03', 'behind a member request still reading the table, the fix gives up: 55P03 (lock_timeout)');
    ok(waited >= 4500 && waited < 15000, `after its 5 s lock timeout (waited ${waited} ms)`);
  } finally {
    await holder.query('rollback').catch(() => {});
    await holder.end().catch(() => {});
  }
  eq(fingerprintDiff(hole, await fp()), [], 'and it changed nothing');
}

try {
  const admin0 = await server.client('postgres');
  await admin0.query(`create database ${DB}`);
  await admin0.end();
  db = await nativeAdapter(server, DB);
  await buildProductionLayer(db);
  const n = await runConsentProof(db, { atHole: boundedWait });
  console.log(`network-connections-consent.native: ${n} checks passed on ${db.label}`);
} finally {
  if (db) await db.close();
  server.stop();
}
