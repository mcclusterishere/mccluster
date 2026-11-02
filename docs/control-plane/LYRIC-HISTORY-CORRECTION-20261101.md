# Lyric history correction — 2026-11-01

Independent review of branch checkpoint `7aa47b3f` found that the first lyric
history implementation trusted review flags and `_history` inside
`creator_tracks.lyrics`. Creators can edit that JSON. Published rows are public,
so embedding earlier drafts also leaked them through ordinary row reads.
This defeated the owner-approved export/history guarantee. It did **not**
bypass the existing audio-release approval guard: changed release content
still returns to review. These findings were reproduced offline, not against
live user data.

## Corrected boundary

- Reuse `music-access`, the existing `ops.use` authorization contract,
  `music_review_digest`, release timestamps and the existing release guard.
- Store revisions in `private.music_lyric_revisions`, with forced RLS, no API
  table grants, and an update/delete rejection trigger. Service callers also
  lack direct table writes. Revision and approval metadata are separate from
  lyric JSON; the service RPC checks the verified actor's current capability.
- Save locks the track and checks its timestamp plus the expected revision
  and hash before appending. The same transaction writes only the current
  public playback projection. It never writes a master/audio column.
- Public projection allowlists fields at every nesting level. History,
  reviewed flags and editor annotations cannot enter `lyrics` or
  `reviewed_snapshot.lyrics`, including through direct creator writes.
- Existing embedded metadata is preserved once as **untrusted private
  evidence**, not imported as approval. Affected published releases return to
  review when cleaned. No automatic legacy approval or history deletion occurs.
- Approved export calls the server, which rechecks current operator authority,
  immutable stored approval and expected hash. No browser-provided history,
  reviewed flag, option or export payload can authorize the response. The hash
  uses the existing PostgreSQL JSONB digest contract (`sha256-pg-jsonb-v1`),
  not a checksum of the downloaded file's formatting or a digital signature.
- Album reads now request only playback columns. Privacy is enforced by the
  database projection and private store even for direct anonymous `SELECT *`.

No new editor, auth service or database is introduced. This is a narrow private
version table in the existing Supabase data plane, following the established
immutable master-version pattern.

## Local verification

`scripts/test-music-lyric-revisions-db.mjs` uses disposable PostgreSQL through
the repo's existing PGlite test convention, with the actual music platform,
commerce and release-integrity migrations plus the new pending SQL. The
Control-capability service is a fixture; API roles, grants, RLS, triggers,
version RPCs and release downgrade behavior execute in PostgreSQL.

It checks creator history injection/erasure, untrusted legacy quarantine,
history immutability, direct table/RPC denials, revoked authority, unapproved
and wrong-hash exports, selected historical export, stale writes, public
`SELECT *` privacy (including the reviewed snapshot), master preservation and
idempotent SQL reapplication.

`scripts/e2e/control-lyrics-revisions.e2e.mjs` now connects the actual Control
editor and TypeScript helper to those disposable database functions. Auth and
audio are mocked. At 390/768/1280px it checks save/reload, approved historical
export, a forged browser export option being refused without a download,
stale saves, denied saves, unchanged public review metadata, and layout.
`scripts/test/lyrics-revisions.test.mjs` also reproduces the exact module's
injected `_history` case and verifies missing-RPC failure without unsafe fallback.

```sh
npm install --prefix /tmp/lyric-tools --ignore-scripts --no-audit --no-fund --package-lock=false @electric-sql/pglite@0.5.10
export PGLITE_MODULE_PATH=/tmp/lyric-tools/node_modules/@electric-sql/pglite/dist/index.js
node scripts/test-music-lyric-revisions-db.mjs
node scripts/e2e/control-lyrics-revisions.e2e.mjs
node --test scripts/test/lyrics-revisions.test.mjs
```

## Release state

`supabase/pending/music_lyric_revisions_v1.sql` is **unapplied**. This task does
not authorize production SQL, merge or deployment. Before any release, review
the pending SQL and its cleanup effects, apply it through the normal approved
promotion process, verify live grants/RLS/RPCs and the public projection, then
deploy the corresponding function/editor together. Missing functions fail
closed with an unavailable response; there is no embedded-history fallback.
`live-callers.json` records these pending dependencies.

The containment rollback only revokes the new RPC grants. It retains private
history and projection protection; it never restores the unsafe design.

No production database, real audio, paid provider or payment was used in these
tests. The domain repair, studio, story snapshots and episode mappings are
outside this correction. No new screenplay or actor-engine work is included.
