// The consent guard on public.network_connections against its actual SQL in isolated PGlite (one session):
// the forward SQL and retained rollback located by the shared helper, on the production layer
// scripts/test/support/network-connections-database.mjs builds from the repository's SQL and checks against what
// production held on 2026-11-19 (policies, grants, constraints, indexes, and the bodies of the eight functions that
// name the table). Proves, as a member with their own JWT claims, the way PostgREST runs a request:
//   before the fix  inserting an accepted row naming someone succeeds; accepting one's own pending request succeeds;
//                   moving a row's addressee, or as the one asked its requester, succeeds; the forced pair turns a
//                   message request into a conversation (mnet_open_direct) and lets publish_antisocial_collaboration
//                   publish a public post crediting a member who never answered;
//   the fix         refuses (55000), changing nothing, on a table it would not close; otherwise changes the two policies
//                   and the table's grants and nothing else in the database; twice, or as one string, changes nothing;
//   after the fix   each of those writes answers 42501 permission denied; no message request turns into a
//                   conversation and no post credits anyone without their acceptance; every legitimate flow (ask,
//                   accept, decline, ask again, ask back, withdraw, end, read, the Worker's read, messages, publishing
//                   together) answers exactly as before; with the grants re-added by mistake, no policy admits a write;
//   the rollback    restores the state before the fix exactly (policies and grants equal production's), and every path
//                   of the hole works again.
// Real sessions, psql's way of applying and the 5 s lock bound are the native proof's job:
// scripts/test/network-connections-consent.native.integration.mjs. Never run against production.
//   PGLITE_MODULE=<PGlite 0.3.14 dist/index.js> node scripts/test/network-connections-consent.integration.mjs
import { pgliteAdapter, buildProductionLayer, runConsentProof } from './support/network-connections-database.mjs';

const db = await pgliteAdapter();
try {
  await buildProductionLayer(db);
  const n = await runConsentProof(db);
  console.log(`network-connections-consent: ${n} checks passed on ${db.label}`);
} finally {
  await db.close();
}
