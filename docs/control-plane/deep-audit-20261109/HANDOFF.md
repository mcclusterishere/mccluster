# Deep-audit response handoff, 9 November 2026

> **Session 4 (2026-11-10 UTC) is recorded first, then session 3, session 2 and the original session, each unchanged below the newer one.**

## Session 4: the League member mission loop, buyer retry edge cases, native proofs, Core lease checkpoint, patch series
`TRACEABILITY.md` traces the owner's strategy of 9 November 2026 (the two near-term proofs, P0 to P9 and the acceptance scenarios) to its state at `b4855d94`, with each row's evidence and what remains.

Nothing here is merged, applied or deployed. Every SQL file named below is pending.

### The member mission "Write a song for a healthier world" (queue item 1)

The Environmental Justice League loop now runs end to end over HTTP, through the real Worker router over the real pending SQL: a member applies, the owner decides, the member accepts the offer (with the current requirements and a participation notice), writes lyrics with autosave, records or uploads a take (the microphone is asked for only on Record), submits, the owner reviews (needs changes, a second version, accepted, credit), the member consents to publication, the owner publishes to the campaign audience, the member can revoke and appeal. The owner's controls cover policy, campaign and mission setup, invitations and testers, applications with rubric and accommodation reads (audited), proof review with signed 300 s media links, publication and withdrawal, holds, appeals, retention and purge of due media, and an outbox of ids-and-revisions events.

- SQL: `supabase/pending/eup_league_v1.sql` (+ rollback), all 36 owner and 15 member contract actions (`media.purging` was added by the review below); the wire contract is frozen in `workers/mccluster/src/eup/league-contract.js`.
- Worker: owner routes `/v1/eup/league/*` (house owner only) and member routes (session-verified actor; answers cut to the contract's member shapes at every depth); `league-media.js` for signed uploads, the seal and retention.
- Pages: `action/league.html` with `js/eup-league-member.js` (member); Control › System › E=Up › League (`js/control-room/eup-league.js`).
- Proof on the integrated tree after the review fixes and the close-out (`integ-closeout`, Node v22.23.4): Worker 1904/1904; Core 653/653 and `npm run check`; root 2340 pass, 0 fail, 5 skipped (two Arcade start-intent tests skip without `PGLITE_MODULE`; with it the Arcade files pass 73/73, and CI sets it); Python 7/7; League PGlite 1462 assertions; journey 1590; module policy 257; intake 236; native League 1591 on PostgreSQL 16.15 and 17.7; native policy and intake on both; browser: member page 274/274, Control E=Up 235/235, Control account lifecycle 34/34, Control nav 214/214, Control workspace 64/64, Arcade recovery at 390 and 1280; database scripts: media recovery ok, music direct sales ok, Arcade start-key race 9 on 16 and 17; source validator 2658/2658.
- Defects found by the lanes and fixed before landing: an upload grant could outlive a purged row and store an object outside retention (a discarded or rejected row is now due no earlier than its staged deadline); `/v1/eup/sources` always reported the civic registry unavailable because the injected fetch was called as a method (now bare, with a Worker-fetch regression test).
- Recorded, not changed: a replayed `uploads.begin` key returns the stored receipt and signs a grant from it even if the row was discarded since (nothing it stores can outlive a purge now, and storage refuses an overwrite of a sealed row; closing it fully changes the frozen contract's begin order: owner decision). The member page has no app bar, because the bar's World soundtrack could play into a recording (owner decision). PostgreSQL returns timestamps as `+00:00`; the pages parse them and never echo a stored timestamp as an input.
- Gates: apply `eup_module_policy_v1.sql`, then `eup_league_v1.sql`, then `eup_intake_v1.sql` (`PROMOTION-ORDER.md` section 8). After apply nothing is enabled: the owner installs and enables the League module from Control, and sets the League policy (no value ships). Merging to `main` deploys the Worker routes, which answer not available until then.

### Adversarial review of the League slice (2026-11-10)

Four lenses (security and privacy, SQL under concurrency, the pages and the repository rules, contract conformance) reported 27 findings against `4dfe2feb`; an independent skeptic reproduced every one. 22 are fixed with tests that fail on `4dfe2feb`, among them the blocker (the member page's "Send the same request again" sent the first text and then showed the newer draft as saved) and the majors: owners could still sign a withdrawn participant's take; one member's consent churn could hide other participants' consents; a purge re-checked retention after deleting objects; the microphone kept recording after its controls disappeared; a cancelled take could still be sent; a same-owner token refresh in another tab hid the E=Up workspace. Two deadlocks under a campaign withdrawal are gone. Owner or contract decisions, not changed: a replayed `uploads.begin` signs from the stored receipt (recorded above); the order that lets an account with no League presence learn whether the module is installed or draining; `complete` re-reading and hashing the stored object on every call while the seal is refused; what to do with a recording when the page is hidden (pagehide now releases the devices).

### Also pushed this session

Buyer download retry edge cases (`5d16a2a9`); native concurrency proofs for module policy and intake as repository tests (`2bcb5dd5`); Core lease checkpoint before outward actions and one daily report per window with a pending unique index (`c58b9fb6`; production read 02:29 UTC: 48 report rows, none with a window id, no duplicates); patch series for #760, #758 and #789 (`48411532`); C5 mutation survivors killed and the late-success audit written before assets (`169909e9`). The Equity Uprise product candidate was repaired as 0.1.0-review.5; its installation core is built in that repository, first delivered as bundles and, since the owner granted push access on 2026-11-10, pushed there as `claude/*` branches: stage 1 at `635395d` (0.1.0-review.6) and stage 2 at `e0be88a` (0.1.0-review.9, the reference host, effects ledger, backup and restore, two unrelated installations and the operator runbook, after two rounds of independent review whose findings were each reproduced by a failing test first); stage 3, the first task module (site draft, preview, review, publish, rollback, unpublish, export), at `b1f2723` (0.1.0-review.11), after two adversarial reviews, a repair round, an independent verification and two follow-ups (records on `claude/installation-core-handoff`). After the owner marked PR #793 ready for review (13:09 UTC): patch series for W5 (#787) and C8 (#734) (`b7611c82`); the two Codex review findings on the Arcade outbox fixed (`e18a5ee5`: one storage scope per account; a refused outbox write keeps its receipt); and the rerun OVH receipts and workflow reviews with 15 fixes, among them two blockers (a failed drift comparison recorded as verified; a promotion check passing a release that failed its deploy gate), each re-checked by an independent skeptic (`920417bf`..`a1a832f6`).

### Close-out verification (2026-11-10)

A verifier and an independent skeptic checked every row of `DEFECT-LEDGER.md` against the code. Sixteen rows stood, W1 needed a wording fix, and fifteen are rewritten there, each saying what this branch has at `4dfe2feb` and what the close-out branches add. The code and test work was done on five branches cut from `4dfe2feb`, each re-checked by a second agent, and is now integrated on this branch: `closeout-core` (C4: the `git diff --check` publication gate the C4 repair had swallowed is restored, without which no changed code_patch can complete; tests for C6, C7 and C7b), `closeout-worker-media` (C5 route tests; C5-c lock races and the hint test), `closeout-control` (A1: per-view state no longer crosses accounts), `closeout-arcade` (W2, W3) and `closeout-tests` (COM-1 backfill, EQ1 races). This note, the ledger, the music release note and the patch records came from `closeout-docs`. Newly open, with next steps in the ledger's close-out table: the lost-ERROR-webhook class (C5-c), no expiry for `core_signed_nonces`, the C4 hook and `.gitattributes` residuals, a same-account A1 residual after a refused refresh, the Arcade outbox scope and the A7 keep-versus-refuse enumeration. The sections below are history: where they call SQL pending that has since been applied (the Arcade, nonce and commerce migrations) or give older counts, the ledger is current, and session 3's "no longer depends on unapplied SQL" (its gates, item 1) is superseded by the `media_operation_claims_v2.sql` merge gate.

## Session 3: the fourth applied release, production evidence, C5 identifiers, media signing

Branch `claude/new-session-83ken5`; main still `578e6830`. This section covers commits `f3add4db` to `c550f129`. Nothing was merged, deployed or applied to a database by this session. Production was read with single SELECT statements only.

### What changed on the branch

| Area | What changed | Commit |
| --- | --- | --- |
| Fourth applied release | The owner's release workers applied `media_operation_claims_v1` to production as `20261109194957`. The exact SQL moved from `supabase/pending/` to `supabase/migrations/20261109194957_media_operation_claims_v1.sql` (SHA-256 `c1733f48…08c1`, 5895 bytes, equal to the statements production stores for that version). `supabase/production-ledger.json` and `core/drift-contract.json` are at 363 (ledger digest `90b735eb844eaf336df508cd5ecc15b980518c12108ff3f48b9edbf373f552ef`, the value `system_migration_attestation()` returns live). | `145744f1` |
| Production schema evidence | `docs/control-plane/evidence/production-schema-snapshot-2026-11-09.json`, captured 2026-11-09T22:17:37Z through a SELECT-only connection; every section rebuilt from the 2026-11-03 snapshot plus the rows the four releases touched and accepted only when it hashed to the database's own md5 of the full section. Outside the four releases nothing changed since 3 November (ledger +4; relations +8 and 3 changed; functions +12 and 3 replaced; triggers +4; policies, buckets, extensions, schemas and cron jobs identical). `live-callers.json` `applied_awaiting_evidence` and `ledger-receipts.json` `applied_after_snapshot` are now empty. Method and digests: `docs/control-plane/evidence/releases-2026-11-09/CLAIMS-APPLIED-VERIFICATION.md`. | `145744f1` |
| Snapshot tooling | `scripts/db/snapshot-delta.mjs`: asks the database for only the rows a release touched, proves the untouched rows by md5 and refuses to write unless the rebuilt section hashes to the database's md5. One SELECT per section; connects to nothing itself. | `5e6d07ab` |
| C5, job-scoped operation id | `core/src/tools/registry.mjs` now forwards `operationId`, `operationIds`, `retries` and `timeoutMs` to the transport (it forwarded none, so a later logical call minted a new id). `scopedOperationId(job, step)` gives `core:<job>:<step>`; the game-studio cycle sends it. | `f3add4db` |
| C5, comparison child ids | `childOperationId(parent, model)` in `workers/mccluster/src/media/orchestrator.js`: the plain join when it fits in 128 characters, otherwise a shortened parent plus an FNV-1a digest of the full parent plus the model, so a maximum-length parent can no longer erase the model suffix and collide. | `f3add4db` |
| Media signing (new finding, not in the 27) | Every Worker route that signs a `network_media_assets` row now proves the row is its owner's own upload first and signs only bucket `mnet-media`. See "Media signing" below. | `3374dfcb`, `a248ced8`, `c550f129` |

### Media signing

`public.network_media_assets` rows are written by their owner and nothing in the database pins `bucket_id` or `object_path`. Four Worker routes signed whatever a row named with the service role: the two reviewer routes for mission proofs and Anti-Social clips, the FBI photo signer (public board, one case, "my cases", the desk) and the clipping source-file route. A member who edited their own row could therefore obtain a signed link to an object that was not theirs. `workers/mccluster/src/lib/media-storage.js` now applies the media function's own rule before anything is signed: bucket `mnet-media`, path `<auth user uuid>/<uuid>-<name>`, and that auth user linked to the row's owner in `m_auth_user_links`; unproven rows are left out and a failed link read is an error, never "linked". The proof and the storage path come from one call (`ownMediaSignPath`).

- Tests: `mission-proof-media` 9, `fbi` 18, `clipping` 11, `media-storage` 7 (45). Ten of the original regression tests fail on the pre-fix source. A 19-edit mutation sweep of the fix fails a test 18 times; the survivor is unobservable (it signs the row's own bucket after the proof has shown it equals the upload bucket).
- Independent review, three lenses (bypass, completeness, regression): no bypass in 1,000,000 mutated paths and 52,000 fuzzed route requests against an independent oracle; the Worker rule and the media function's rule agree on every input tried and are now also compared as source lines.
- Production, read-only, 2026-11-09 23:51 UTC (`scripts/db/media-asset-legacy-count.sql`): 4 asset rows, none outside the rule, 1 named by a reviewed surface, none of which would stop being served. The deployed `mnet-media` function (version 619) applies the same rule in discard, finalize and view-url.
- Still open, by design of this change: a member can replace a reviewed file with another of their own uploads (edit the row, delete and re-insert it, or overwrite the object in their own folder). Closing that needs a migration and storage-policy change; an unapplied candidate is proposed to the owner as a separate task. One unrelated finding from the review was reported to the owner privately and is not described in this public file.

### Production reads this session (SELECT only)

Ledger 363 with digest `90b735eb…` at 22:17 and again at 23:51 UTC. API role settings: `authenticator` statement and lock timeout 8 s, `authenticated` statement timeout 8 s, `anon` 3 s, `service_role` unset. Bucket `equity-uprise-private` exists, private, 104857600-byte object limit, no MIME list, 0 objects. `media_jobs` 18 rows, all `completed`; `media_operation_claims` 0 rows; `core_signed_nonces` 0 rows. Core `host_health` at 23:36, 23:41 and 23:47 UTC: `overall` fail with one issue, `supabase_migration_ledger_drift` (the deployed Core at `9c5b7503` expects 359, production has 363); local and public health 200; reconcile timer active; last deploy 2026-11-07T13:59:29Z.

### Exact tests on this tree (Node v22.23.4)

| Command | Result |
| --- | --- |
| `cd workers/mccluster && npm test` | 1625 pass, 0 fail |
| `cd core && node --test test/*.test.mjs` | 595 pass, 0 fail (at `f3add4db`; Core unchanged since) |
| `node --test --test-timeout=60000 scripts/test/*.test.mjs` | 2145 tests: 2142 pass, 0 fail, 3 pre-existing skips |
| `node scripts/control-plane-drift-contract-check.mjs` | pass, 363 active migration files |
| `node --test scripts/test/rpc-names-exist.test.mjs scripts/test/production-schema-verifier.test.mjs scripts/test/schema-snapshot-delta.test.mjs` | pass |
| `python3 docs/design/equity-uprise-building/production/verify_equity_uprise_repo_sources.py` on a pristine copy | 2566 of 2566 checks |

CI on `145744f1`: every check that runs passed. `Control workspace visual proof` failed once on a fixed 550 ms wait in `scripts/e2e/analytics-unified.e2e.mjs` (unchanged from main) and passed on its single re-run; the cause and a proposed patch are in one PR comment.

### Gates, updated

1. **Merge is still deploy.** The claims SQL prerequisite is now applied (`20261109194957`), so a paid generation carrying an `operation_id` no longer depends on unapplied SQL. `CORE_REPLAY_STORE="supabase"` ships with the Worker on merge. Keep `ARCADE_CLOUD_ENABLED` absent.
2. **Evidence is regenerated.** Manifest from the CI reset, snapshot from production; the awaiting-evidence lists are empty.
3. **Core on OVH reports fail until its contract moves.** The deployed Core compares production with the 359-entry contract at `9c5b7503`. The fix is a narrow change of `core/drift-contract.json` (and the files that justify it) promoted through `deploy/ovh-production`; it is the owner's to approve. Do not delete applied migrations, replay SQL or force the deploy ref.
4. **Media signing reaches production only when the Worker deploys.** The production count shows no existing row is affected.
5. Unchanged from session 2: E=Up pending SQL unapplied; consumer `world_environment` SQL held; A7, A2 and C6 decisions; #792/#787; COM-3, A3/A4, A6, W4, W5, C8 on their PRs.

### Landed after `1d391a85` (2026-11-10, same session)

Seventeen commits, implemented in isolated worktrees and combined here. Each series has its own tests; the independent reviews of the first two were still running when this was pushed, and only the authorization review of the recovery series had reported (no blocker, no major finding; its fixes are the last code commit).

| Series | What it adds | Tests |
| --- | --- | --- |
| Third C5 gap: crash and operator recovery (5 commits + review fixes) | Pending `supabase/pending/media_operation_claims_v2.sql` (+ rollback, 24-scenario behaviour suite, `scripts/test-media-recovery-db.sh`): repair, takeover of an expired claim, guarded release, operator decision, recovery candidates. Worker: the paid submit is compare-and-set with one submitter per job; the fal submit is one plain POST with no hidden retry; an authenticated per-job webhook hint; operator list and decision on REST and MCP for the house owner or Core's signature; a cron sweep behind `MEDIA_RECOVERY_SWEEP_ENABLED`. Nothing is resubmitted automatically when a submit may have happened. | `media-operation-recovery` 79, `fal-submit` 11, `media-operation-claims` 18; SQL proof on PostgreSQL 16.15 including a three-session takeover race; mutation check 24 of 25 |
| OVH evidence hardening (7 commits) | One receipt per reconcile cycle (`scripts/mccluster-vps-reconcile.sh`), a health projection of those receipts with warnings for a failed or stale cycle, a `status` mode and identity plus read-only proofs in `scripts/ovh-private-repo-ssh.sh`, rollback accepting liveness from an adapter that predates `/ready`, the promotion workflow naming the head it replaces and verifying the runtime, and the owner runbook `docs/control-plane/OVH-510-CONTRACT-AND-AUTH-RUNBOOK.md`. Nothing was run against the host; every step in the runbook is the owner's. | Core 627 pass; `ovh-private-repo-ssh`, `ovh-self-management`, `reconcile-cycle-*` suites. An independent review of the SSH script found no never-list violation; its one major finding (a failed or interrupted `activate` stayed switched) and four minor ones are fixed with tests |
| Buyer download retry (3 commits) | `js/music-purchase.js` sends one retry key per deliberate download and keeps it while the outcome is unknown, so a lost answer does not use a second download. Static page only: the deployed function v42 already accepts the key, and no file whose deployed copy is v42 changed. | `music-purchase-retry` 18; buyer recovery on a real database (PGlite) 12 scenarios; Chromium e2e 40 checks |

**Reservation review of the recovery series (2026-11-10).** Run on real PostgreSQL 16 with production's allowance guard. The reservation core held under every attack (one reservation per operation, one provider request per job, no release while the outcome is unknown). It found two defects in the first push, both now fixed with regression tests that fail on the old code:
- A request the provider failed reads as COMPLETED in the provider's status vocabulary, with the error as its result. A poll before the ERROR webhook wrote the job completed, and the webhook then ignored it, so its reservation was held for good and could block the organization's monthly allowance. The refresh now reads the result before writing completed and leaves the job open when it cannot (`R3`).
- A late provider success for a job an operator had released was dropped in three orders, so its cost was recorded nowhere. Completion is now decided from the stored row, not from what one delivery remembered (`R1`, `R2`).
Also fixed from the same review: a hinted webhook that raced the submitter's record write was acknowledged as unmatched; an operator bind could deadlock with a same-id retry (`for no key update`, proved on PostgreSQL 16); and every 5xx on a paid submit is now uncertain rather than a refusal, so a reservation is never released on an answer that may follow an accepted request (500, 503 and the edge's 520 to 526 included).

Read-only on production, 2026-11-10 01:21 UTC: the three pre-apply checks for `media_operation_claims_v2.sql` pass (no duplicate organization and operation id, no duplicate provider request id, `media_jobs.error` is NOT NULL; 18 jobs).

Suites on this tree: Worker 1719 pass; Core 627 pass; root 2177 tests, 2174 pass, 0 fail, 3 pre-existing skips; source validator 2570 of 2570.

**New merge gate.** With this series a paid generation that carries an operation id calls `media_claim_operation_v2` first and answers 503 until `media_operation_claims_v2.sql` is applied. Apply it before the Worker ships and roll the Worker back before the SQL (`supabase/pending/PROMOTION-ORDER.md` section 7).

**Module policy composed into E=Up writes** (15 commits after `5db39246`). Persisted enable, drain and disable per module (`environment`, `league`, `intake`) on the canonical plane, ported in semantics from the product's control follow-on with one deliberate difference: a fair queue, because the upstream row lock alone lets late writers in ahead of a waiting drain (observed on PostgreSQL 16.15 and 17.7). Pending `supabase/pending/eup_module_policy_v1.sql` (no seed; owner-issued install); the guard is composed into `eup_intake_v1.sql` with import-run claim, lease and release; owner routes `GET /v1/eup/modules`, `POST /v1/eup/modules/:module/install`, `POST /v1/eup/modules/:module/state`; the consumer environment route reads the persisted policy instead of a constant and fails closed; Control Overview has Install, Enable, Drain, Disable and Re-enable with a required reason, an unknown-outcome state and same-key resend. Tests: policy 257 assertions and intake 236 (PGlite); native PostgreSQL 16 concurrency proofs of the policy (104 assertions) and the intake claim (33) were run from scratch scripts and are not yet repository tests; Worker `eup-modules` 26, `eup-import-runner` 30; Control unit 30 and browser proof at 390 and 1440. A source-host check that matched by text suffix was fixed in passing. Not yet composed: the League SQL (its rewrite is in progress) and the held consumer SQL (design only). Owner decisions: who runs import jobs and what scope each source covers; whether a disabled `environment` module should still show a participant their own saved records (today the vendored product answers 404 for everything when disabled).

Suites with this slice: Worker 1786 pass; root 2197 tests, 2194 pass, 0 fail, 3 pre-existing skips; source validator 2618 of 2618.

Buyer retry edge cases from the two reviews, fixed 2026-11-10: a 4xx without one of the function's own `reason`s (a gateway's 429, 404, 401) now keeps the key as an unknown outcome; the key is kept in `localStorage` as well, so a second tab on the same kept link finds it; a `download_limit` just after a signing failure is reported as a slot that frees itself, with the button kept. The key's lifetime stays 20 s + 120 s + 300 s from its last send, on purpose: that is the longest the server could answer it, keeping it longer costs nothing (`attempt_spent` takes no slot) and dropping it earlier could cost the buyer a download. The page must not be published against a function older than v42 (the release note says so in its coupling line).

### Not on the branch at this commit

Work in progress in this session and absent from this tree: module policy composed into E=Up writes (built and tested in a side worktree), the member mission loop, the purchased-version title fix for the Edge function (kept as a separate patch because merging it deploys the function), and the installable edition. Each is recorded here when it lands.

---

## Session 2: reconciliation of the owner-run releases, C5 completion, admin-only E=Up
Branch `claude/new-session-83ken5`; starting head `15523e187d1800dcbe7cd2c19f4ddfe6f203f556` (verified equal to the packet's snapshot; main still `578e6830`). Commits for this session are listed at the end of this section. Nothing was merged, deployed, applied to a database, or sent anywhere by this session.

### Completed source

| Area | What changed |
| --- | --- |
| Production reconciliation | Exact applied SQL imported under returned versions `20261109175747_music_direct_asset_versions_v1`, `20261109180829_core_signed_nonces_v1`, `20261109181623_city_arcade_v1` (SHA-256 match the receipts); branch draft `20261109120000_…` deleted (superseded, never replay); 362-entry `supabase/production-ledger.json` + `core/drift-contract.json`; four deployed Edge files (`music-direct-access` v42) and the release's three test scripts; DB script proves the zero-order rollout guard then applies the real file; Arcade workflow/support/docs point at the applied file; receipts copied to `docs/control-plane/evidence/releases-2026-11-09/`. |
| RPC-name index and schema verifier | New `applied_awaiting_evidence` state (`scripts/test/rpc-names-exist.test.mjs`, `live-callers.json`): names applied by receipt whose manifest/snapshot evidence was not regenerated (no CI reset or production read possible here). Retire the entries by running the supported clean reset and capturing a snapshot. `docs/control-plane/evidence/ledger-receipts.json` likewise lets `production-ledger.json` run ahead of the latest snapshot only for receipted versions (`production-schema-verifier.test.mjs`); a new snapshot retires those too. |
| C5 completion | `supabase/pending/media_operation_claims_v1.sql` (+rollback): service-only `media_operation_claims`, RPCs `media_claim_operation_v1` / `media_bind_operation_v1` / `media_fail_operation_v1`; router: atomic claim → winner reserves + binds + submits, losers get the same job / recorded failure / `operation_pending`; payload-fingerprint mismatch refused; uncertain provider acceptance → job `reconciling` with reservation kept, never auto-resubmitted; Core `mcp-http.mjs` carries one stable `operation_id` per logical call with one same-id transport retry; `media.compare` child ids per model; `CORE_REPLAY_STORE = "supabase"` added to `wrangler.toml` (the DB prerequisite is applied). |
| E=Up admin workspace | Worker `/v1/eup` router (owner-only at every route, private/no-store, fail closed) with sections overview, league, civic, companies, sources; Control › System › E=Up shell (`js/control-room/eup.js`, five local tabs, one shared Analytics globe, bounded requests, authority-generation conceal, honest 503 states); Products door `E=Up` in the shared bar (`js/site-navigation.js`) pointing at `control.html#system:eup`. |
| Environmental Justice League (admin-only) | `supabase/pending/eup_league_v1.sql` (+rollback): 11 private tables + `eup_league_command` (house ownership rechecked, CAS, idempotency key + payload digest, atomic capacity, self-review denial, version-bound acceptance; publication private; points/payouts/broadcast 501). Five unpublished, unpriced campaign templates as a fixture; first complete mission is "Write a song for a healthier world". |
| Civic League, Companies & Finance, Sources & Review (admin-only) | `supabase/pending/eup_intake_v1.sql` (+rollback): 25 private intake tables (registry state, import runs, append-only snapshots, civic entities incl. boundary versions/terms/vacancies/bills/versions/actions/amendments/roll calls/elections/certification, company identifiers/typed locations/facts/awards, review items, corrections); six pure adapters with synthetic fixtures (SEC, GLEIF, Congress.gov, Census TIGER, CT General Assembly, Bridgeport council); all 12 registry connectors disabled and answering 503 until configured AND access-approved; nothing writes to `civic_*` or `action_policy_bills`; OpenFEC, disclosures and market quotes held. |

### Exact tests run on the final tree (this container, Node v22.23.4)

| Command | Result |
| --- | --- |
| `node --test --test-timeout=60000 scripts/test/*.test.mjs` | first run 2137 tests: 2133 pass, 1 fail, 3 skipped (pre-existing publish-time skips); the one failure was `production-schema-verifier` requiring the committed ledger to equal the stale 2026-11-03 snapshot; fixed by the `ledger-receipts.json` mechanism below, verifier 10/10; full rerun 2137 tests: 2134 pass, 0 fail, 3 skipped |
| `python3 -m unittest discover -s scripts/test -p 'test_*.py'` | 7 pass |
| `cd core && node --test test/*.test.mjs` / `npm run check` | 585 pass, 0 fail; check pass |
| `cd workers/mccluster && node --import ./test/support/offline-network.mjs --test test/*.test.mjs` | 1590 pass, 0 fail |
| `node scripts/control-plane-drift-contract-check.mjs` | pass, 362 active migration files |
| `node --test scripts/test/rpc-names-exist.test.mjs` | 3/3 |
| `PGHOST=127.0.0.1 PGPORT=5499 PGUSER=postgres bash scripts/test-music-direct-sales-db.sh` (disposable PostgreSQL 16.15) | `music direct sales: ok` with the applied migration; guard refuses first application while an order exists |
| `EMBEDDED_PG_MODULE=… node scripts/test/music-direct-release.integration.mjs` (native PostgreSQL 17.7, run as `postgres`, locale generated) | PASS: both rollbacks, reapply and both behaviour suites, native lock-race regressions |
| `node scripts/test/music-direct-release-handler.integration.mjs` | PASS: 9 extracted exact Edge-handler scenarios |
| `scripts/test/eup-league.integration.mjs`, `eup-intake.integration.mjs` (PGlite) | 58 and 118 assertions |
| `scripts/test/city-arcade-start-recovery.integration.mjs`, `city-arcade-database.integration.mjs` (PGlite, applied SQL path) | 17 and 31 assertions |
| `CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium node scripts/e2e/control-eup.e2e.mjs` | 53/53 at 390 and 1440 plus reduced motion (Cesium CDN blocked: mount-once proven, rendering not) |
| `node scripts/e2e/world-environment.mjs` | PASS at 390 and 1440, fixtures only |
| `media_operation_claims_v1.sql` on disposable PostgreSQL 16 (C5 worker) | applied twice; claim/mismatch/bind/fail and anon denial |

NOT RUN: production schema snapshot (the manifest was regenerated from the CI reset artifact, see below) (Supabase connector not authorised in this session); Deno typecheck of the Edge files (no Deno; `stripTypeScriptTypes` only); native multi-session concurrency for League/intake/Arcade (PGlite is serial); live sources, keys, entitlements, geocoder, scheduled jobs; real purchase/download; live Worker isolates/provider.

### Merge, deployment and verified use

Nothing merged or deployed. Live identities unchanged from the receipts: Worker `bbeb8acd…` (deployment `23b34bef…`, 2026-11-07), Pages `22259d57` (still carries W1), Core `9c5b7503`, Edge `music-direct-access` v42, database ledger 362. No production journey verified. Verified journeys are local and synthetic only: E=Up shell at 390/1440 with fixture routes; League command lifecycle and intake pilot in PGlite; environment mode fixtures; Arcade recovery.

### Gates and owner decisions (release order)

1. **Merge = deploy.** `wrangler.toml` now carries `CORE_REPLAY_STORE="supabase"`, and the Worker requires `media_operation_claims_v1.sql` for paid generations that carry an `operation_id` (503 `operation_claims_unavailable` without it), plus the Arcade `startKey` handler is needed before any `ARCADE_CLOUD_ENABLED`. Apply `media_operation_claims_v1.sql` (reviewed, service-only) before this branch reaches main; do not set the Arcade flag.
2. **Regenerate evidence.** Run the supported clean reset to refresh `schema-manifest.json` and capture a production snapshot so the five `applied_awaiting_evidence` names retire.
3. **E=Up pending SQL.** `eup_league_v1.sql` and `eup_intake_v1.sql` are unapplied review candidates; until applied the admin workspace answers 503 `schema_not_applied` honestly. Decide pilot jurisdiction (Connecticut/Bridgeport proposed), which sources to review/configure first (Census TIGER, SEC, GLEIF, then Congress.gov with a securely configured key), points policy, audience beyond `admin_preview`, retention, who reviews (a second house owner today).
4. **Navigation placement.** The NAV leaf lives under Control › System › E=Up with a Products door in the shared bar; confirm or move it.
5. **E=Up mark.** No supplied E=Up artwork exists under `assets/img/`; the header uses text. Supply the mark if wanted; nothing was drawn.
6. **Consumer environment.** The two `world_environment` SQL files stay held; the consumer globe mode on this branch keeps working against fixtures and is not activated.
7. Unchanged from session 1: A7 disabled-house policy, A2 expired-session replacement, C6 gateway requirement, EQ1/EQ2 upstreaming to `Equity-Uprise`, #792/#787 rebases, COM-3/A3/A4/A6/W4/W5/C8 on their PRs.

### Deferred

Member-facing apply/accept/proof routes (consumer release); live broadcasting, payouts, white-label agency economics (rates/payer/levels unchosen; FTC and 501(c)(3) gates); platform votes/candidate support; market quotes; any collector; composition of the control follow-on; independent installation proofs; `attempt_key` from the buyer UI; `reconciling` job operator reconciliation path; `registry.mjs` forwarding a job-scoped `operationId`.

### Recovery

All SQL added this session is pending with rollback files; applied releases keep their rollback artifacts (`music_direct_asset_versions_v1.rollback.sql`; nonce and Arcade schemas are additive and should stay in place). Edge v41 source is retained in the owner's packet for Edge rollback. No destructive SQL rollback after purchases without inspection.

### CI on PR #793 (first run on `4bc2256`) and the fixes

Eleven red jobs, four causes, all fixed on the branch (no test weakened):
- `Supabase migration reset`, `Credits, billing, idempotency, rate-limit, and COGS regression`, `Communications database regression`: the applied commerce migration opens with `LOCK TABLE`, which the CLI reset runs outside a transaction (`25P01`). `scripts/supabase-local-reset-with-replay.sh` now stages `20261109175747` inside `begin;`/`commit;` in the disposable copy, as it already did for `20261031180839`; the canonical bytes stay exact. `supabase-replay-transaction.test.mjs` passes.
- `Validate authority, program, plans, and building`: 31 new files (docs, environment consumer, vendored product, tests, League fixture) classified support-only in `equity-uprise-repo-source-map-v2.json`; validator 2562/2562, report regenerated.
- `browser (travel-*)`: the consumer stylesheet had widened the World mode bar to 320px; it is back to 240×44 with an icon-width E=UP button (measured at four widths, no clipped labels). `travel-desktop` 35/35 locally.
- `Supabase migration reset` (second run, `161faa6`): the reset itself passed once the transaction staging landed, and the job then reported 26 manifest differences: exactly the seven relations, nine functions and four triggers the three applied migrations add. `supabase/schema-manifest.json` is now the `reset-schema` artifact of that run (run 42688764750, artifact 13706082254, SHA-256 `90cca54f…`), which is the workflow's own documented refresh path and the "supported clean reset" the receipts asked for. The production snapshot is still not regenerated, so the five `applied_awaiting_evidence` names stay listed until a snapshot is captured.
- `tactics` (PRIM3 tactical regressions, `prim3-transit-completion.e2e.mjs` at 1280 only; 390 green): the World editor rebuilt its whole side panel when the globe finished loading while the owner was typing, so the briefing typed into the replaced textarea never reached the draft and four checks failed; on a slow renderer the globe-ready lands during the fill. Pre-existing on main (`js/prim3-world/app.mjs` unchanged by the branch; the workflow was green on the last ten runs), it did not reproduce locally. Fixed by refreshing only the country options in place on globe-ready (`refreshCountryOptions`), with a regression in `prim3-world.test.mjs`; local reruns 33/33 twice.
- `browser (editorial-*)`: three checks still described the one-mode public World; updated to the owner's 7 November contract (public modes are News feed and E=UP only; a swipe moves between those two and never to Travel or Missions; the owner's bar has four modes). `editorial-iphone-landscape` 113/113 locally.
- `tactics` (third run, on `f444f2e`, `prim3-city-simulation.e2e.mjs` at 390/square after 390/hex passed; the commit itself only replaced the schema manifest): the owner setup never rendered because the gate fell closed. The fixture session was `{access_token}` alone. `js/tabbar.js` loads `js/mcc-auth.js` asynchronously, and when that helper lands before `js/owner-only.mjs` (both are route-served; the order is not fixed), `checkOwner` asks it to `refreshIfNeeded`, which treats a session with no `expires_at` and no `refresh_token` as unrenewable and returns null, so the gate reports signed out, correctly for the product, which never writes such a session. Reproduced locally by delaying the gate module 400 ms (gate `closed`, "Sign in"); with a future `expires_at` and a `refresh_token` the gate opens in either order. The same shape sat in `city-arcade-action.e2e.mjs` (city-arcade.html) and `game-hub-capsule.e2e.mjs` (game-hub.html), both owner-gated pages with the tab bar, and both failed the same forced-order probe; all three fixtures now carry a signed-in session's shape. No product code changed. Local: city simulation e2e 4/4 cases and the denied-role check, three times before the change (the race did not surface unforced) and after it with the forced order; City Arcade action 52 assertions and Game Hub capsule pass with the new shape (the capsule's axe pass was skipped locally, no axe-core here; CI runs it).
- `PRIM3 adaptive real PostgreSQL` (fourth run, on `de22ed3`, which changed only the three fixtures above and this file): the 1280px browser release journey in `prim3-reviewed-release.e2e.mjs` timed out after 30 s waiting for the renderer to settle after T1's second move (`uiBusy:false`, `rendererBusy:true`, no page errors); 390px passed in the same run, and the job had passed on the four previous heads. Its harness stubs `js/tabbar.js` and carries its own session fixture, so the owner-gate change cannot reach it. Re-run once: green (run 42697962285, attempt 2). Read as slowness, not a stuck state: it is the only CI harness that plays animated walks (the transit harness runs with `reducedMotion: 'reduce'`), the renderer picks the low tier under swiftshader but clamps each frame's `dt` to 0.25 s in `level3d.mjs`, so a walk's wall-clock time grows with frame time once frames exceed 250 ms. Measured here with the same flags and the operator GLBs loaded: a 7-point walk takes 4.7 s at 390px (frames about 160 ms) and 5.5 to 5.9 s at 1280px (frames 210 to 230 ms, at the clamp); the failing runner's 390px journey was about 40% slower than the passing run's and its 1280px step 0 took about 20 s against about 4 s per step when green. No fix exists to port; the proposal, recorded in one PR comment, is a progress-aware `idle()` in that harness (longer ceiling, fail within 30 s of no movement in `r3.unitPosition()` or `__tx.state.events.length`), as a separate PR. Nothing pushed for it here. The branch head `de22ed3` is green on all 66 checks that run (two skipped by design) and mergeable.

### Session 2 commits

- `4989365` reconciliation of the three applied releases, RPC-index state, E=Up router scaffold
- `836e4f3` League backend
- `e6687cf`, `83f593c` work-in-progress checkpoints (superseded by the final commit)
- `74ab73e` final integration: C5 completion, E=Up shell and Products door, civic/companies/sources intake, allowlist, docs

---

Branch `claude/new-session-83ken5` in `mcclusterishere/mccluster`, built on main `578e683088fdd49fb77848733e70dd4f3af039c3` (the exact SHA the packet audited; `git merge-base --is-ancestor` confirmed). The commit SHAs for this work are listed at the end of this file. Nothing was merged, deployed, applied to a database, or sent anywhere. Read `DEFECT-LEDGER.md` for the per-finding detail, `OPEN-PR-DISPOSITION.md` for all 93 PRs, `CAPABILITY-MATRIX.md` for the evidence columns, `EQUITY-PRODUCT-COMPOSITION.md` for the product plan, `CLASSROOM-EVIDENCE-CHECKLIST.md` for Tuesday.

## Completed source (on this branch)

| Area | What changed | Finding |
| --- | --- | --- |
| Published artifact | Recipe compiler relocated to `js/prim3-tactics/levels/recipe.mjs` (private path is a shim); importers, Worker and tests repointed; `scripts/test/published-import-closure.test.mjs` gates every literal published dependency against the workflow's own strip; e2e harness can serve an emitted export (`MCC_SERVE_ROOT`) | W1 |
| Identity lifecycle | Control authority generation with abortable loads and synchronous conceal; handoff commit fence with paired writes and bounded fetch; auth loader retry with terminal state | A1, A2, A5 |
| Commerce | `supabase/pending/20261109120000_music_direct_asset_versions_v1.sql` (+ rollback): immutable asset versions pinned to orders/entitlements, download attempt reserve/settle; Edge handler and shared refusals updated; backfill policy and review view | COM-1, COM-2 |
| Core | Lease-fenced claims with lost-lease abort, idempotent reflection children, persisted-report-or-fail digest with stable window id, house-org lookup fix, unknown-evidence health, complete-inventory code-patch policy, local-model readiness and deploy gate | C3, C2, C7, C7b, C1, C4, C6 |
| Worker | Shared replay store for Core-signed mutations (pending `core_signed_nonces_v1.sql`), fail-closed default, `operation_id` dedupe before reservation | C5 |
| Arcade | Account-scoped result outbox, reconnect/discard controls, `start_key` idempotent start and `current` read in pending SQL and Worker | W2, W3 |
| Building adapter | Elevator links board/alight on landings; shafts stay blocked | EQ3 |
| Environment consumer | Local consumer patch applied (E=Up mode on the existing globe, vendored product, Worker routes, pending SQL, PGlite scripts, e2e); EQ1/EQ2 fixed in the vendored copy with a lifecycle suite; e2e fixtures match the transport contract | EQ1, EQ2, EQ4 |
| Docs | This directory; Arcade activation handoff notes the stale reviewed hash; music release note; `live-callers.json` lists the four new pending-only names | |

## Exact tests run on the final integrated tree (this container, Node v22.23.4)

| Command | Result |
| --- | --- |
| `node --test --test-timeout=60000 scripts/test/*.test.mjs` | 2126 tests: 2123 pass, 0 fail, 3 skipped (pre-existing publish-time skips) |
| `python3 -m unittest discover -s scripts/test -p 'test_*.py'` | 7 pass |
| `cd core && node --test test/*.test.mjs` | 581 pass, 0 fail (baseline 555) |
| `cd core && npm run check` | pass |
| `cd workers/mccluster && node --import ./test/support/offline-network.mjs --test test/*.test.mjs` | 1537 pass, 0 fail (baseline 1458 pass + 1 failure from the uninstalled fal client, installed `--no-save` here) |
| `PGHOST=127.0.0.1 PGPORT=5499 PGUSER=postgres bash scripts/test-music-direct-sales-db.sh` on disposable PostgreSQL 16.15 | `music direct sales: ok` (v1 twice, new behaviour file fails on v1 alone, backfill, v2 twice, both rollbacks, re-apply, both behaviours) |
| `PGLITE_MODULE=<scratch>/pglite node scripts/test/city-arcade-start-recovery.integration.mjs` / `city-arcade-database.integration.mjs` | 17 / 31 assertions pass (serial PGlite) |
| `scripts/test-environment-pglite.mjs`, `-proofs-pglite`, `-planning-pglite` | PASS (environment worker run) |
| `MCC_SERVE_ROOT=<stripped export> THREE_DIR=<three@0.180.0> GENERATED_COMPLETION_ONLY=1 node scripts/e2e/prim3-generated-missions.e2e.mjs` | 6 completion cases (390 and 1280), denied owner, recipe save failure: all PASS, exit 0. Negative control from an export of unmodified HEAD: generator never renders (timeout), exit 1 |
| `node scripts/e2e/world-environment.mjs` (pre-installed Chromium) | PASS at 390 and 1440, `scrollWidth === clientWidth`, no page errors |
| `node scripts/e2e/city-arcade-recovery.e2e.mjs`, `city-arcade-cloud-gate.e2e.mjs`, `city-arcade-action.e2e.mjs` | PASS (Arcade worker run, `CHROMIUM_PATH=/opt/pw-browsers/chromium`) |
| `bash -n scripts/ovh-core-health.sh scripts/deploy-ovh-core.sh` | ok |
| `node scripts/control-plane-drift-contract-check.mjs` | pass; active migrations 359 (unchanged ledger) |
| `python3 docs/design/equity-uprise-building/production/audit_building_context.py` and `verify_equity_uprise_program_coverage.py` | pass |

Skips and NOT RUN: `scripts/test-environment-postgres.mjs` (native multi-session, no PostgreSQL 17 here); Deno runtime of the Edge function; browser checkout e2e for music; native concurrency for Arcade and Core queue; physical devices; iPad BFCache.

## Integration and merge state

Nothing merged. The branch is one review unit; the owner may prefer splitting it by area for review (the per-area file lists are in the ledger). Three PR heads (#737, #745, #749) were reconfirmed as main ancestors on this checkout.

## Deployments

None performed. Dated receipts in the packet remain the latest: Worker/Pages main `578e6830` (Pages `22259d57`, which still carries W1), Core `9c5b7503`.

## Verified journeys (local, synthetic)

Generated PRIM3 side operations from the stripped export; environment mode on the globe with membership, assignment, proof and review fixtures; Arcade lost-response, restart-preserves-receipt, reload, revoked denial, idempotent retry. All with fixture identities and software GL. No production journey was verified.

## Unresolved blockers and owner decisions (in release order)

1. **C5 deploy gate.** Apply `supabase/pending/core_signed_nonces_v1.sql` and set `CORE_REPLAY_STORE="supabase"` in `workers/mccluster/wrangler.toml` `[vars]` before this branch reaches main, or Core-signed media mutations answer 503 (the Worker auto-deploys from main). `"isolate"` restores today's window explicitly if you prefer to stage it.
2. **COM-1/COM-2 rollout.** Promote the pending migration with its ledger entry, redeploy the Edge function in the same window, then resolve legacy unpinned orders through `music_direct_asset_review` (they refuse download with `asset_unresolved` until resolved). Decide the backfill policy (default: pin only when the offer was unchanged since the order).
3. **A7 decision.** Break-glass owner access to a disabled house: keep and scope, or align the Worker helper with the SQL boundary.
4. **A2 decision.** Whether an expired stored session with no refresh token may be replaced by an arriving handoff (this branch allows it).
5. **C6.** Whether the compute gateway is required-active; whether to enable the inference probe on the unit.
6. **W3.** Re-review `supabase/pending/city_arcade_v1.sql` (new hash `b03081d4…`) before activation.
7. **Environment.** Approve the pending environment/proof SQL rollout; confirm the 2026-11-07 World gate wording now in `AGENTS.md`; upstream the EQ1/EQ2 patches to `Equity-Uprise` (this session cannot write there) before re-pinning.
8. **#792 / #787.** Rebase #792 onto this branch's `digest.mjs`/`objective-reflection.mjs`; #787 must promote `topology-learning.mjs` like the recipe or the closure test fails.

## Deferred scope

Executors honouring the lost-lease `signal` mid-execution; a dedicated `lease_token` column; a unique index for digest windows; publishing the page that now sends `attempt_key` (`js/music-purchase.js`, source only) and releasing the purchased-title Edge candidate (not in this branch); composition of the control follow-on with the mission follow-on; independent installation proofs; Admin stack composition (#789); COM-3; A3/A4/A6; W4/W5; C8; the historical backlog dispositions marked salvage/park in the PR table.

## Rollback and data recovery

Every change is on a branch; main is untouched. SQL is pending only; each new pending file has a rollback file (`music_direct_asset_versions_v1.rollback.sql`, environment proofs rollback) or is additive (`core_signed_nonces_v1.sql`). The Core lease format is backward compatible with existing `locked_by` rows. The Arcade outbox migrates legacy session receipts forward and never deletes one without an explicit confirmed discard.

## Reproduction commands for the W1 artifact proof

```
# build the stripped export from any tree (reads the rm lines from deploy-pages.yml)
scripts/build-public-export.sh <out>
MCC_SERVE_ROOT=<out> THREE_DIR=<three@0.180.0> GENERATED_COMPLETION_ONLY=1 \
  node scripts/e2e/prim3-generated-missions.e2e.mjs <proof-dir>
```

## Commits

- `b3a822730226618cbf4c2ead68d25c2d10dbdbd6` on `claude/new-session-83ken5`: every source, test, SQL and document change described above, on main `578e683088fdd49fb77848733e70dd4f3af039c3`.
- The commit after it adds only this SHA line.
