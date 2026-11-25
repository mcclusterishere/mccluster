// The pending mission catalog sources pair against its actual SQL in isolated PGlite (one session):
// supabase/pending/20261119140000_mission_catalog_sources_v1.sql and its rollback, on the production-shaped stub
// supabase/tests/mission_catalog_sources.stub.sql (production's default privileges, role check, organization checks and
// policies). The proof (scripts/test/support/mission-catalog-sources-database.mjs, runProof) shows, the way PostgREST runs
// requests (a role per key, the member's claims):
//   - the forward file refuses (55000) before the mission publish and changes nothing; after it, one organization row
//     (nonprofit, unverified, no creator, the reviewed words) and one draft link; twice changes nothing;
//   - a draft is unreadable to anon, a member and an admin session; only a shown link is readable; no API role can write
//     the table and service_role holds no table privilege; the two functions run for service_role only;
//   - the house owner's show, hide and edit: staff, a viewer, a member, an unknown account and no actor are refused
//     (42501) and write nothing; Show needs the dated permission confirmation; a moved revision (MCS02), a reused key
//     (MCS03), an unknown catalog (MCS01); a replayed key returns the same receipt; every deny-list entry and every bad
//     fact or role line is refused by its named check; each accepted change writes one control_audit row;
//   - the owner's read (drafts, organization, open missions, history with key and audit id), refused to everyone else;
//   - the rollback refuses (55000), changing nothing, while a member's authenticity check names the organization (Hide
//     still works) or the row changed; otherwise it leaves the catalog and every row as before the forward file, keeps
//     the audit rows, and runs twice.
// Then each mutant of MUTANTS (no table revoke, an authenticated write grant, no words check, no house check in either
// function, no publish guard, no rollback refusal, on delete cascade, the source pattern back to [^ ]) must fail it.
// Two sessions at once and the 5 s lock bound are the native proof's: scripts/test/mission-catalog-sources.native.integration.mjs.
//
//   PGLITE_MODULE=<PGlite 0.3.14 dist/index.js> node scripts/test/mission-catalog-sources.integration.mjs
//
// Never run against production.
import { pgliteAdapter, runProof, forwardSql, rollbackSql, MUTANTS } from './support/mission-catalog-sources-database.mjs';

const verbose = process.env.MISSION_SOURCES_VERBOSE === '1';
const forward = await forwardSql();
const rollback = await rollbackSql();

let db = await pgliteAdapter();
let label = db.label;
let run;
try {
  run = await runProof(db, { forward, rollback, log: verbose ? console.log : () => {} });
} finally {
  await db.close();
}
for (const r of run.results) console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name}${r.pass ? '' : `  ${r.detail}`}`);
console.log(`mission-catalog-sources: ${run.passed} of ${run.results.length} checks passed on ${label}`);
if (run.failed.length) process.exit(1);

if (process.env.MISSION_SOURCES_SKIP_MUTANTS !== '1') {
  let wrong = 0;
  for (const [name, mutate, expected] of MUTANTS) {
    const texts = mutate({ forward, rollback });
    db = await pgliteAdapter();
    let m;
    try {
      m = await runProof(db, texts);
    } finally {
      await db.close();
    }
    const failedNames = m.failed.map((f) => f.name);
    const caught = expected.some((prefix) => failedNames.some((n) => n.startsWith(prefix)));
    if (!caught) wrong += 1;
    console.log(`${caught ? 'ok  ' : 'FAIL'} mutant "${name}" fails the proof (${m.failed.length} checks fail${caught ? `, among them ${expected.find((p) => failedNames.some((n) => n.startsWith(p)))}` : `: ${failedNames.join(' | ') || 'none'}`})`);
  }
  console.log(wrong ? `mission-catalog-sources mutants: ${wrong} not caught` : `mission-catalog-sources mutants: each of ${MUTANTS.length} fails the proof`);
  if (wrong) process.exit(1);
}
