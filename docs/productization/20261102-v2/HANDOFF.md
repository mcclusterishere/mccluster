# Backend editor contracts — v2 implementation

2026-11-02. Supersedes the local editor-contract gaps in ../20261102/HANDOFF.md. This is a bounded local backend slice for independent review, not a production-ready full product. Production SQL, flags, credentials, content publication and financial flows are unchanged.

Implemented in `supabase/pending/editor_versioned_contracts_v1.sql`, `workers/mccluster/src/editor-versioned.js`, and the existing Worker entry. The SQL adds private revision heads and immutable complete row snapshots over existing `site_content`, `managed_projects`, and `member_fronts`. It retains the real renderers and existing site_content_history audit. No parallel builder is introduced.

Before-statement transaction locks cover all legacy INSERT/UPDATE/DELETE writer paths. First v2 mutation opts that record into revision protection; unenrolled legacy records keep their contract. Protected records reject blind legacy writes with PT409. The existing personal-front safety takedown remains possible only while preserving identity/draft and clearing publication, and advances the revision. Stale publish cannot cross it. History edits and source truncation are denied.

Restore checks the same object and permissions, then creates a new audited revision. Website restore changes draft only, never ownership/removal/publication. Control restores the exact slot's editable fields; reset deletes its override while retaining a revision tombstone. This prevents deletion/recreation ABA conflicts. Control's scope is one page/slot (the @front slot contains the complete scene JSON), not an arbitrary multi-slot page transaction.

## Tests completed

- 77 PGlite SQL/HTTP assertions: actual role grants, own/cross-account and wrong-auth-owner checks, first/stale/legacy writes, restore/history/audit, reset/recreate, removed/private publish refusal, expired auth, invalid/foreign media, full transaction rollback and injected downstream failure after history capture.
- Native PostgreSQL 16: simultaneous project, personal-front and Control writers each yield exactly one commit and one PT409; publish versus safety takedown serializes and leaves removal intact.
- 28 foundation assertions: all seven prepared SQL hashes, actual RPC role permissions, cross-account modules, owner Storage visibility/deletion and restrictive INSERT/UPDATE policies under competing permissive policies.
- Main Worker 1,250 passed; root 1,322 passed; pending RPC inventory 3 passed. Local Node v24; added CI specifies Node 22 but has not run remotely.

Evidence is in evidence/. These are real SQL semantics over synthetic Auth/Storage fixtures, not live session, managed Storage, DNS, payment or browser evidence.

## Portable reproduction

The source bundle includes all exact scoped source dependencies, pinned SQL fixtures and test-tool lockfile. No #681 checkout or Docker is needed for these commands:

```sh
npm ci --prefix scripts/test/editor-tools --ignore-scripts --no-audit --no-fund
PGLITE_DIR="$PWD/scripts/test/editor-tools/node_modules" node scripts/test/editor-versioned-db.mjs
PGLITE_DIR="$PWD/scripts/test/editor-tools/node_modules" node scripts/test/prepared-foundation-db.mjs
```

For actual simultaneous connections, use disposable local PostgreSQL/psql with `PGHOST=127.0.0.1 PGUSER=postgres python3 scripts/test/editor-versioned-native.py`, or use its `--docker` mode. The runner creates/drops a uniquely named scratch database; local mode also creates fixture API roles if absent. Never use an operational database server. Docker mode uses its own network-isolated container pinned by image digest. PGlite does not replace the separate native concurrency proof.

## Release and compatibility gates

The Worker endpoint is default-off behind EDITOR_V2_ENABLED. SQL requires the existing Control schema plus member_fronts_v1, managed_projects_v1 and managed_project_identity_v1 and canonical account/org tables. Production currently lacks those website foundations. Installation snapshots current source privately without rewriting public rows. Exact hash and prerequisites are in migration-manifest.json. No production version was invented: CLI bootstrap was attempted but the executable was unavailable; repository pending-promotion rules remain in force.

First v2 mutation makes the old editor for that record receive conflicts. Coordinate UI adoption before deliberate enrollment. Rollback means compatible readers/editors and feature containment, not dropping history, clearing protection or restoring blind writes. Privately back up source rows and both history stores, test restore on an authorized disposable target, review exact SQL and combined app SHA before production approval.

One short global editor transaction lock prioritizes correctness across old/new writers and creation/deletion. No network calls occur under it. Measure contention/throughput before broad tenant activation. This is not yet a high-throughput production certification.

Reconcile #681 with main and this module. The standalone adapter uses current-main cinematic validation; #681 offers and tile paths need combined-source tests. Tile documents are refused with use_tile_revision_api, preserving their existing revision API. Real login/roles, mobile renderer save/reload and managed Storage still need verification. Domain refresh/apex/TLS, immutable commerce/download settlement, lyric approval/impact, independent installation and private LMS source remain separate gates.
