# Music and compute migration preparation — 2026-11-24

This records preparation for draft [#823](https://github.com/mcclusterishere/mccluster/pull/823),
on its existing branch. It is shared music/compute support used by
Equity Uprise; it adds no building capability, backend or module activation.
Production is the existing Supabase project `zmnhbrjyhxzhkxmhkexs`.

**None of these six files was applied and no Edge Function was deployed by this
preparation work.** Each exact file still requires owner approval. The draft
integrates `main` at `7f2644b417994d1b994d763485b6448906bdfdb0` before testing;
the original branch head was `3dc80c45e9f960f069ce771e2da6fb9d25dcf7cc`.
The final reviewed PR head and the file hashes below identify the candidate.

## Release conditions and proposed order

| Item | Exact pending file | Status and condition |
|---|---|---|
| A | `20261123180000_tinderfessions_catalog_objects.sql` | Prepared; hold for the matching album release on `main` and named-file approval. Creates 12 active catalog entries. |
| B | `20261123190000_in_hot_pursuit_catalog_objects.sql` | Prepared; hold for the matching album release on `main` and named-file approval. Creates eight active catalog entries. |
| C | `20261123200000_music_creator_distribution_v1.sql` | Corrected and proven locally; require the exact-head full-reset CI gate and named-file approval. Apply before F, with the coordinated `music-access` redeploy. |
| D | `compute_job_attestations_v1.sql` | Corrected and proven locally; hold until the gateway that writes attestations is deployed, CI passes and the exact file is approved. |
| E | `compute_scheduler_lease_v1.sql` | Forward behavior preserved and recovery guarded; hold for the owner's standby-scheduler decision, CI and named-file approval. |
| F | `20261031180000_lyrics_machine_v1.sql` | Corrected and proven locally; apply only after C, exact-head CI, verified executor readiness and named-file approval. |

The SQL dependency is **C then F**, even though the older promotion document
listed lyrics first. A and B belong with their respective album release. D
depends on its gateway writer; E depends on the standby decision. No file is
approved by inclusion in this table. The two ISRC issuance files remain staged
and outside this proposal.

## Production observations: read-only

Catalog and definition reads at 17:07 UTC on Nov 24 found:

- No `creator_tracks.distribution`, `lyrics_sheet` or `lyrics_input_rev` columns.
- Neither `ops_compute_attestations` nor `ops_compute_scheduler_leases` exists.
- Zero catalog rows matching `tinderfessions:%`; zero matching `in-hot-pursuit:%`.
- `music_track_content(public.creator_tracks)` matches the canonical
  `20261030001000_music_release_payment_integrity_v1.sql` exclusion list. Its
  normalized body MD5 is `b2f96e6d2fa145d00adcc6267bbe0944`; raw production
  body MD5 is `2613c9ca52e61d0eb2287d772b6adc0b` because of line endings.
- A later aggregate-only read found zero creator tracks, zero published tracks
  and zero approved tracks. No personal row or `created_by` field was selected.

Neither album is present in `main`'s `data/albums.json`; this branch contains
the 12-song and eight-song shelves. Applied seed rows are visible through the
public catalog, so album absence is a release-coordination condition rather
than a claim that the rows are invisible.

The observed health record reports Core revision
`eb94224883685c0e3d2cf8a54eb14bbc1349d0bf`, verified reconciliation and an active
runner. That revision registers `lyrics_align`, but its completion-evidence
handler has no policy for `lyrics_align` or `stems_separate`: a pure-function
reproduction rejected both successful and no-op executor results. Registration
therefore does not establish a completable job. This draft now includes
explicit executor receipts and narrow completion policies; that
Core correction must be deployed before F. Audio tooling readiness remains a
separate unverified condition. The observed production revision does not contain the new
attestation-writing gateway. No standby-scheduler decision was observed.

The live `music-access` function is ACTIVE, version **639**, with
**`verify_jwt: true`**. Its deployed source lacks
`operator-distribution-stage` and the creator-distribution shared module. C's
feature requires a reviewed redeploy from this branch, retaining the JWT
setting. The local deploy contracts pass; no redeploy occurred.

The production ledger is **389**. Draft
[#836](https://github.com/mcclusterishere/mccluster/pull/836) records the five
already-applied Nov 24 migrations. This branch still inherits main's historical
384 canonical files. Integrate that records-only repair before release;
never replay the already-applied workstream or other pending copies.

## Defects reproduced and changes made

### Distribution and lyrics

The original lyrics backfill failed with `creator_identity_missing` against
the actual canonical creator guard. Supplying a service claim allowed the
write, but incorrectly changed a synthetic published release to
`pending_review`: the new processing columns entered the reviewed content.
The corrected file makes the sheet and derived revision non-content inputs,
while retaining the existing `lyrics` value in reviewed content. It saves and
restores both supported JWT role settings within the applying transaction,
backfills only changed revisions, and queues no old tracks during backfill.
Every subsequent write recomputes the revision, including attempts to change
only that derived column.

C and F share an advisory transaction lock and a five-second table lock bound.
They require READ COMMITTED so a stale transaction snapshot cannot hide a
concurrent write during a recovery emptiness check. The native proof refuses
REPEATABLE READ for both forwards and both recoveries. They pin the supported
function body and metadata, refusing an intervening or
unknown content-helper definition with SQLSTATE `55000`. C cannot overwrite
F's later helper. The exact current production baseline fits C.

The previous C rollback retained the distribution column while removing its
content exclusion. A later update could then invalidate a published review.
Recovery now refuses any stored distribution data and removes an empty column
and its exclusion together. F's operational recovery refuses queued/running
lyrics jobs, then removes automatic enqueueing while retaining creator words,
derived revisions, revision integrity, content exclusions and completed job
history. It is intentionally not a destructive schema teardown. Reapply
restores enqueueing. Removing retained inputs would need a separate reviewed
data migration.

### Signed compute receipts and scheduler recovery

Under actual Supabase default privileges, the old D file inherited service-role
UPDATE, DELETE and TRUNCATE rights. Granting SELECT/INSERT did not revoke those
rights. D now explicitly revokes inherited privileges before granting only
SELECT/INSERT. The signed timestamp remains text, preserving the signed bytes.
This protects direct receipt writes; it does not alter existing parent foreign
key cascades or privileged database administration.

The old D/E rollback files dropped populated receipt and fencing-history
tables. Recovery now requires an unused empty installation, `READ COMMITTED`,
and an exclusive lock acquired before the emptiness check. A populated table,
including a writer committing while recovery waits, refuses with SQLSTATE
`55000`. A released or expired scheduler row is still history and still
blocks teardown. Use a reviewed forward repair for populated installations;
there is no destructive override. E's forward SQL behavior is unchanged.

## Verification and limits

| Proof | Observed result | Scope |
|---|---:|---|
| Music native proof | 101 passed | PostgreSQL 17.6; actual canonical music guards/review functions and explicit peripheral Auth/Storage fixtures. |
| Compute database before correction | 9 passed, 10 failed | Reproduces inherited privilege and destructive recovery defects. |
| Compute database after correction | 19 passed | PostgreSQL 17.6; actual API roles, Supabase default privileges, concurrent writers and safe recovery. |
| Real gateway/node-agent staging | 10 passed | Native PostgreSQL with disposable synthetic compute/org fixtures; signed receipts, replay, retry, revocation and guarded rollback. |
| Existing scheduler behavior | Passed | Native role boundary, independent-connection status/renew, rollback and reapply. |
| Completion-policy regression | 55 passed, 0 failed | Actual executor-to-evidence integration with injected local/fabric audio and storage results; 10 failures reproduced before the fix. |
| Full Core suite | 919 passed, 0 failed, 20 skipped | 939 tests on the integrated branch after the completion-policy fix; skips remain explicit. |
| Requested music/function contracts | 56 passed, 0 failed | The five requested Node test files, after integrating current main. |
| Complete reset integration | Required CI gate | New jobs use the canonical reset and exact canonical-plus-replay migration plan, without substituting base objects. No local full-reset pass is claimed. |

The music proof creates a genuinely reviewed synthetic release through the
canonical review functions, with a hashed asset and an active offer. It checks
actual owner and other-owner access, JSON shape/size limits, unchanged published
status/digest/offers, exact album keys, actual public-role catalog visibility,
stable IDs and foreign-key references through archive/reapply, C-before-F,
claim restoration before commit, input revision integrity, stale-result fencing,
queued-versus-running work, protected reviewed lyrics, and recovery/reapply.

The completion correction binds each receipt to the actual job track. A lyrics
result records either a fenced write with its revision and execution route or
one explicit protected/stale no-op reason. A stems result carries the run ID
returned by the persisted private manifest. Missing runs, mismatched tracks,
invalid counts, invented no-ops and later receipt tampering fail. A failed
manifest write never reaches completion evidence. These injected tests do not
claim that live audio dependencies are installed.

The compute receipt contains individual before/after cases and hashes:
`docs/control-plane/evidence/pr823-compute-device-native-2026-11-24.json`.
Staging recovery deletes only its own disposable synthetic test receipts after
proving that the shipped rollback refuses a populated table; it does not
provide a production cleanup command.

Commands executed or wired to CI:

```sh
node scripts/music-release-native-check.mjs
node scripts/music-release-native-check.mjs --full-reset
node scripts/compute-device-native-check.mjs
node scripts/compute-device-native-check.mjs --from-reset
node scripts/compute-scheduler-sql-check.mjs
node scripts/staging/device-jobs/run.mjs
node --test scripts/test/music-direct-sales.test.mjs scripts/test/action-network-live-governance.test.mjs scripts/test/music-distribution.test.mjs scripts/test/creator-distribution-stage.test.mjs scripts/test/supabase-functions-deploy.test.mjs
```

The `--full-reset`/`--from-reset` commands are CI gates, not claims of local
execution. The database runners accept only their explicit disposable local
database configuration. No production write, advisor change, module enable,
Core promotion or Edge deployment is implied by a test result.

## CI follow-up at the prepared branch

The first complete-reset attempt at head `16d1d206f673206d32e68aa6e4680bdaf61a0a5c`
accepted the exact 468-entry plan, then rejected the synthetic music fixture
with SQLSTATE `23502`: `creator_tracks.audio_url` is required. The proof now
supplies that field explicitly and uses the exact canonical creator table even
in its bounded local baseline. No reset constraint is relaxed. The corrected
native run passes 101 assertions; its complete-reset run remains a CI gate.

The dedicated compute workflow succeeded on that head:
[run 45455902593, job 138665120954](https://github.com/mcclusterishere/mccluster/actions/runs/45455902593/job/138665120954).
It passed all 19 D/E checks against the complete reset, the existing scheduler
behavior/independent-connection checks, and all 10 gateway/node-agent staging
steps. D/E SQL bytes are unchanged since that run.

The broader branch checks also exposed stale catalog-derived listen waits and
an AAC/MP4 upload named `.mp3` with its index after the audio. The candidate now
publishes `assets/audio/rolling-with-me.m4a`; A and the album data use that same
path. `qt-faststart` moved only the container index and adjusted chunk offsets.
The entire audio payload and every non-index atom are byte-identical, and the
encoder metadata is retained. Old file SHA-256:
`71637053dfdf4954eb372780d2909f71445621a4c013a7752ceb53a5a19c91b6`;
corrected file SHA-256:
`bdfded5247eca36babde928bc531e0cfe8eb2123c216aef2cca3bfe4dc37d1ec`.
The catalog generator now writes the added songs' per-song waits; all 34
container/listen-ledger/length checks pass. The shortest counting margin is
2.2 seconds, so its bounded wait is 1.1 seconds. Existing older-song regression
vectors remain checked.

The secret scanner matched a clearly synthetic key in a new test. The fixture
now uses a plainly synthetic value without a production credential prefix;
all 20 completion-evidence tests still pass. An inherited prose-only change
to persistent execution authority was restored to the canonical main wording:
owned devices remain specialized compute under Core, with no unpaired change
to the architecture contract. No architecture rule or scanner was weakened.

## Named-file review receipt

An approval must identify the exact reviewed file and its current commit. Fresh
read-only schema, definition and release-condition checks remain necessary
immediately before an authorized application. Apply one approved file at a
time through the repository flow, then record the exact stored statement and
run verification and advisors. That application phase is not part of this
preparation receipt.

| Candidate | Bytes | SHA-256 |
|---|---:|---|
| `supabase/pending/20261123180000_tinderfessions_catalog_objects.sql` | 4,767 | `f6ddf2fa622617a68de3dab82a7beda1a64dbedb076556e809d5d04fbe88249b` |
| `supabase/pending/20261123180000_tinderfessions_catalog_objects.rollback.sql` | 727 | `3562c02abe1f4fb0dc838473d4f0017c35f803663118e27f54633f0efa3edfef` |
| `supabase/pending/20261123190000_in_hot_pursuit_catalog_objects.sql` | 3,138 | `f7df2ac5d92e95408933bbd02a0c1fec91329a95882d4ea55b45a293177319d7` |
| `supabase/pending/20261123190000_in_hot_pursuit_catalog_objects.rollback.sql` | 601 | `924f0f6bf970d4f82d28541c3f9f886058963468d21b45fce69954276e7db9f8` |
| `supabase/pending/20261123200000_music_creator_distribution_v1.sql` | 3,583 | `9381387e0edb9e1f1d7c774b1e86afd405274fb71d8f038c5cfb60b68787c40a` |
| `supabase/pending/20261123200000_music_creator_distribution_v1.rollback.sql` | 2,868 | `243e987c6f30630380524b556c2febe85c69e4a0b6781bb47d6939d7df9882d2` |
| `supabase/pending/compute_job_attestations_v1.sql` | 3,372 | `05b6d03a2e2243eb3a20bf9859cc01f4fee529d65d6ba7c9894de05d71e1ad4a` |
| `supabase/pending/compute_job_attestations_v1.rollback.sql` | 1,390 | `34f77defa18de93e917e3dd07a1b3e1e93b9e3b7976b6bb083b6acb0391c5d78` |
| `supabase/pending/compute_scheduler_lease_v1.sql` | 19,444 | `85433c47f58164573552c0022b494726666bfaec0d1abec96b5bf6e5b396745a` |
| `supabase/pending/compute_scheduler_lease_v1.rollback.sql` | 2,141 | `29247c1c83fb40d20b8f9628a0d3d9a4b25614739817ed1f3674030a29c78959` |
| `supabase/pending/20261031180000_lyrics_machine_v1.sql` | 8,880 | `7533f4bfd78fa7c65e8202c34843011b2cccc9c4a0cc4a06e22dafdf7b97ff8a` |
| `supabase/pending/20261031180000_lyrics_machine_v1.rollback.sql` | 2,881 | `672a025efb88c9ec2215145195c65df49291575d91cd7f0c615883197ddba5c4` |
| `scripts/music-release-native-check.mjs` | 27,628 | `13c3a2cc5cf191cdf963105a216ddefe006adb1dd8e6b50300b26b6f6c9c333d` |
| `scripts/compute-device-native-check.mjs` | 21,436 | `1a4d61d8808ca7108a5b9c603a174f6c04e69d9467b8da421cab00f4370a6b93` |
| `scripts/native-admin-test-db.mjs` | 3,842 | `43ab5d522112d8a4569a69556669d389f2a644cf1fcc747155fde2e5664908cb` |
| `.github/workflows/reconciliation-ci.yml` | 18,954 | `c54ca60638717056469888eb532d8a3adea26aae01dd47efb97afbbd51c44303` |
| `.github/workflows/compute-device-db.yml` | 3,622 | `fc0b0e932d302856504d5a59b7ac7f04f9b728586b5e38c4cf783a31994712af` |
| `core/src/completion-evidence.mjs` | 32,236 | `23ed37b6c9904d547c0be74a96e4dbaf53790d5db026d2ad851b8d25bd2e2daf` |
| `core/src/executors/lyrics-align.mjs` | 9,593 | `991698c7df10d8006f004fc0e098e8d28252962ddae8eb170d5c866f2e338749` |
| `core/src/executors/stems-separate.mjs` | 4,475 | `4781e32ca4b2543eb9de1ffe0bad264676494e404082f1de84f0f2caf9499ef6` |
| `core/test/completion-evidence.test.mjs` | 18,283 | `7e730365fdad1519e0411a31bb1873006771531919c27f465a657f5b42387153` |
