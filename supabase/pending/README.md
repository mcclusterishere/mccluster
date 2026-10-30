# Pending migrations

Read `PROMOTION-ORDER.md` (in this folder) for the order in which the files here
are meant to be applied, what each needs first, and how each is tested.

`live-callers.json` lists every RPC, table and bucket that shipped code (`js/`,
root pages, `workers/mccluster/src`, `workers/mccluster-mcp/src`,
`supabase/functions/`) calls but that is not deployed. Since 2026-10-29 a name
counts as deployed only when `supabase/schema-manifest.json` (what the CI reset
builds) AND the latest production evidence
(`docs/control-plane/evidence/production-schema-snapshot-<date>.json`) both have
it; a name only replay SQL defines is not deployed. `pending_only` names
(pending, not applied) are defined by the named file here and fail in
production until it is promoted; `missing_everywhere` names have no pending SQL.
`scripts/test/rpc-names-exist.test.mjs` fails on any such name missing from the
list and on any entry that is stale, so the list only shrinks: promoting a file
and committing the new production snapshot means removing its names. Regenerate
the view with `RPC_NAMES_REPORT=1 node scripts/test/rpc-names-exist.test.mjs`.

Promoted 2026-10-29 (owner-approved), group 0 of `PROMOTION-ORDER.md` plus
`public_music_reads_lean_v1.sql`, from
`docs/control-plane/PRODUCTION-SCHEMA-RECONCILIATION-2026-10-28.md`. Each was applied with
`apply_migration`, and the statement production stored is the committed file byte for byte
(md5 checked):

| Pending file | Applied as |
|---|---|
| `20261029100000_privilege_hygiene_v1.sql` | `supabase/migrations/20261029010919_privilege_hygiene_v1.sql` |
| `20261029100100_definer_views_invoker_v1.sql` | `supabase/migrations/20261029011001_definer_views_invoker_v1.sql` |
| `public_music_reads_lean_v1.sql` | `supabase/migrations/20261029011108_public_music_reads_lean_v1.sql` |
| `20261029100200_rls_initplan_select_wrap_v1.sql` | `supabase/migrations/20261029011314_rls_initplan_select_wrap_v1.sql` |
| `20261029100300_eu_runtime_and_media_rollup_v1.sql` | `supabase/migrations/20261029011534_eu_runtime_and_media_rollup_v1.sql` |

Their four `.rollback.sql` files stay here under the pending names, as
`20261015210000_intel_mission_canon_v1.rollback.sql` does for its promoted file
(`supabase/migrations/` holds only what production ran). Applied files' headers keep their
original pending wording, so the bytes still match production. Test:
`bash scripts/test-schema-hygiene-db.sh` on a scratch Postgres. Production evidence after
the apply: `docs/control-plane/evidence/production-schema-snapshot-2026-10-29.json`. Step 0
before them is replay-only and changed nothing in production:
`supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql`
(test: `bash scripts/test-schema-reconcile-db.sh`).

Hygiene, 2026-10-27: `supabase/migrations/pending/` (a second staging folder
that the drift check could not see) was retired; its twelve unapplied files
moved here unchanged, and its five byte-identical copies of applied creator
migrations were deleted. `scripts/control-plane-drift-contract-check.mjs` now
fails if `supabase/migrations/` holds a subdirectory or a non-`.sql` file.
Removed as already applied: `20261019222500_world_place_scope_v1.sql`
(promoted as `20261021173729_world_place_scope_v1`) and
`world_news_discussions_v1.sql` with its rollback (`media_news_comments`, its
rate guard and RLS were created in production by
`20261021011443_royce_platform_actor`; the tests that read the pending file
now read that migration).


Promoted 2026-10-21: `listener_state_v1.sql` is applied in production as `20261021125121_listener_state_v1.sql`. The Pocket cross-device state table now exists, with authenticated ownership RLS, forced RLS, a 4 KiB JSON cap, and no anon read. Exact stored production SQL matches the reviewed pending source. Test: `bash scripts/test-listener-state-db.sh`. Do not replay the pending file.


Pending (2026-10-21): `member_fronts_v1.sql` gives every account its own front page (owner: "all the accounts need to be able to recreate with their own media this exact same experience"). It adds `public.member_fronts`, which only the Worker's service role reaches (forced RLS, revoked from anon and authenticated), and the public `front-media` bucket, where each account lists, writes, replaces and removes only its own folder (its auth uid), up to 2,500 files and 1 GiB (`public.front_media_has_room()`). Until it is applied, `/v1/fronts` answers 503. Test: `scripts/test-member-fronts-db.sh`. Docs: `docs/control-plane/MEMBER-FRONT-PAGES.md`. Rollback: in the file's header. Promote it using the steps below.

Promoted 2026-10-30: `music_release_payment_integrity_v1.sql` is applied in production and is
`supabase/migrations/20261030001000_music_release_payment_integrity_v1.sql` (bytes unchanged,
md5 `5212054a89f62d77b2a11e8826bc73cf`; its header keeps the original pending wording). The
owner ran the file in the Supabase SQL Editor (the MCP `apply_migration` approval could not
reach him), then recorded the ledger row by hand: `supabase_migrations.schema_migrations`
version `20261030001000`, name `music_release_payment_integrity_v1`, `statements` null (so
there is no stored statement to md5 against the file), created_by `owner via SQL Editor
(#666 rollout)`; the ledger went from 353 rows (latest `20261029011534`
`eu_runtime_and_media_rollup_v1`) to 354. Its `.rollback.sql` stays here under the pending
name. Rollout as run on 2026-10-30, against the steps below:
step 1 as recorded below (unchanged); step 2 applied; step 3 every health query returned 0,
the `music_storage_object_guard_%` trigger count is 2, and there are 0 `creator_tracks`, 0
`music_orders`, 0 `music_entitlements`, 2 creator storage objects and 2 registry rows in
`public.music_creator_assets` (the backfill); step 4 PR #666 merged as `249163db`, the
"Supabase Edge Functions deploy" run 40978491536 succeeded and redeployed `music-access`,
`music-checkout` and `stripe-webhook` at 2026-10-30T00:16Z, and unauthenticated probes answer
401 / 401 / 400 (bad signature); step 4a not needed (no approved release). **Step 5 was NOT
run**: no test release, Verify + listen or test purchase is created in production; it waits
for the first real release, and is the first thing to do when that release reaches review.
Production evidence after the apply:
`docs/control-plane/evidence/production-schema-snapshot-2026-10-30.json`.

Was pending (2026-10-28): `music_release_payment_integrity_v1.sql` closes four owner security findings on creator music: (a) a release's master, preview, audio URL and artwork must be objects its creator uploaded, by the server's record (`public.music_creator_assets`, written by `music-access` when it issues an upload grant, or the owner Storage stamps), never by path; the storage update/delete/own-read policies follow the same record; (b) any change to an approved or published release sends it back to `pending_review` and takes its offers off sale, and what is published equals the frozen `reviewed_snapshot`; (c) the licence commission is `public.music_platform_fee_bps()` (1500, the same constant `music-checkout` uses), not the creator-writable offer column; (d) a music order becomes paid only from pending/failed under its stored checkout session, its terms are immutable, and entitlements need a paid order; (e) approval pins the master's exact Storage identity (object id, version, eTag, size) in `public.music_asset_versions` and its sha256 review digest, a trigger on `storage.objects` refuses overwriting, moving or deleting a pinned object or one an approved/published release references (every role), each order and entitlement records the pinned version bought, and `music-access` signs exactly that version for purchasers (revoked refuses; a takedown or replacement does not take the bought version away); (f) approval is bound to the audio BYTES the reviewer heard (owner, 2026-10-29: "still needs approval tied to the exact reviewed audio before it goes live"): `music-access` `operator-review-prepare` pins the release's master (`public.music_prepare_review`, which locks the object from then on), streams that pinned object once through an incremental SHA-256 (native `node:crypto` `createHash`, chunk by chunk, never buffered; capped at 524288000 bytes, the `creator-masters` bucket limit, and failing closed above it, on a missing object or a short/failed read) and records it write-once on the version (`public.music_record_asset_sha256`; a recompute that disagrees invalidates the version, sends its releases back to review and off sale). The music desk (`js/music-admin.js`) plays THAT pinned object and shows the short hash; Publish stays disabled until then and carries the full hash (`expected_master_sha256`) to `public.music_operator_review`, and the track guard refuses entering approved/published unless the pinned master has a recorded hash equal to it (`release_master_unhashed`, `release_master_hash_required`, `release_master_hash_mismatch`, `release_master_invalid`). The hash is in the reviewed snapshot and digest (`approved_master_sha256`); orders and entitlements record it (`asset_sha256`, set by the guards, immutable). A replacement master is a new path: back to review, a new version with no hash, verified and approved again. What is hashed: the master only. It is what is sold and delivered; the preview and artwork are public, are not sold, and are locked by path against overwrite once the release is approved; between the reviewer's listen and the approval, a same-path overwrite of the PREVIEW or ARTWORK is still possible (the master is locked from preparation on): residual, follow-up if the owner wants previews hash-bound too. Bytes are hashed once, not per download or per checkout (a full read of a master each time, against the Edge CPU budget): the pinned object cannot change (storage trigger, every role), `music_asset_version_intact()` re-checks object id, version, eTag and size on every signed URL and every new order, and the recorded hash is what was approved; `recheck: true` on `operator-review-prepare` re-hashes on demand. `music-access` now FAILS CLOSED (503) without this file. Test: `scripts/test-music-release-integrity-db.sh`. Rollback: `music_release_payment_integrity_v1.rollback.sql` (reopens the findings and loses the pinned-version record). Promote it using the steps below.

Rollout for `music_release_payment_integrity_v1.sql` (dependency-safe order; the database first, because the new functions refuse without it and the old functions work on top of it):

1. Pre-check (read-only): `select status, count(*) from public.creator_tracks group by 1; select count(*) from public.music_orders; select count(*) from public.music_entitlements; select count(*) from storage.objects where bucket_id in ('creator-masters','creator-previews','creator-artwork');` Record the numbers.
   Production read-only on 2026-10-29: 0 `creator_tracks` (0 approved/published), 0 `music_orders`, 0 `music_entitlements`, 0 objects in `creator-masters` (2 creator objects in total, in the other two buckets), `public.music_asset_versions` absent, `creator-masters` `file_size_limit` 524288000. There is no existing approved master to hash today.
2. Apply the file (it backfills: the asset registry from `storage.objects`; every approved/published release's master pinned as it stands now, or sent back to review if not its creator's or missing; each existing order's and entitlement's purchased version). The database cannot read bytes, so a backfilled pin has NO `content_sha256`: until it has one, `music_asset_version_intact()` is false, so that release is not streamed, not sold (no new order) and its purchases are not delivered (409). Production has none (step 1), so nothing goes dark.
3. Health after apply, every query must return 0 rows/0:
   - `select id from public.creator_tracks where status in ('approved','published') and coalesce(master_path,'') <> '' and approved_master_version_id is null;`
   - `select t.id from public.creator_tracks t join public.music_asset_versions v on v.id = t.approved_master_version_id where public.music_object_identity(v.bucket_id, v.object_name) is distinct from v.identity;`
   - `select id from public.creator_tracks where status in ('approved','published') and reviewed_digest is distinct from public.music_review_digest(public.music_track_reviewed_snapshot(creator_tracks));`
   - `select o.id from public.music_orders o where o.status = 'paid' and o.asset_version_id is null;` and the same for `music_entitlements e where e.revoked_at is null and e.asset_version_id is null` (any row: decide its version with the owner before step 4; music-access refuses it with 409 meanwhile)
   - `select count(*) from pg_trigger where tgrelid = 'storage.objects'::regclass and tgname like 'music_storage_object_guard_%';` returns 2.
   - No approved release without content_sha256 (expected to list every backfilled release until step 4a; 0 rows in production today): `select t.id from public.creator_tracks t left join public.music_asset_versions v on v.id = t.approved_master_version_id where t.status in ('approved','published') and (v.content_sha256 is null or v.invalidated_at is not null);`
   - Storage API smoke (test creator account): upload to a fresh grant path succeeds; re-upload with `x-upsert: true` over an object an approved/published test release references is refused and `select version from storage.objects` for it is unchanged.
4. Deploy `music-access`, then `music-checkout`, then `stripe-webhook`.
   4a. Hash backfill (only if step 3's content_sha256 query listed rows): for each listed release, an operator opens the music desk and presses **Verify + listen** (`operator-review-prepare`), which hashes the pinned master and records it; the reviewed snapshot gains the hash of the same pinned bytes and its purchases record it. A row whose master is over 524288000 bytes or whose read fails stays listed and dark: resolve it with the owner (re-upload). Re-run the query: no approved release without content_sha256 (0 rows) before step 5.
5. Health after deploy: on a test release, **Verify + listen** shows a short hash and plays the pinned object, `select content_sha256 from public.music_asset_versions where id = <version>` equals the full hash the desk returned and equals `sha256sum` of the file the creator uploaded, Publish without verifying is refused, and a second Verify answers the same hash without reading the object again (`hashed_now: false`); re-run the content_sha256 health query (0 rows); `music-access` `stream` of a published release returns a URL for the pinned `object_name`; `download` for a test purchase returns the pinned object; a revoked test entitlement returns 403; Edge logs show no `music-access dependency missing` lines; `music-checkout` for a release without `approved_master_version_id` answers 409.

Back out: functions first (redeploy the previous `music-access`, which tolerates the file either way), then the rollback file.

Promoted on 2026-10-17: `action_archive_cohort_v1.sql` is
`supabase/migrations/20261017164335_action_archive_cohort_v1.sql`, and
`action_mission_reset_v1.sql` is
`supabase/migrations/20261017164416_action_mission_reset_v1.sql`.
The Docket 516R public archive has ten cohort profiles, ten separate provider
webpages, nine canonical completed songs and one capstone event. Three simple
missions remain open; larger concepts are private partner-development drafts.
The exact production SQL and ledger are recorded. Regression gate:
`bash scripts/test-action-archive-db.sh`; public source and release notes:
`docs/control-plane/MISSION-RESET-DOCKET-516R.md`.

Pending: `world_member_regions_v1.sql` adds `public.world_member_regions()`, the World place card's members: accounts by the IP country, region code and rounded place of their latest signed-in visit, read from `public.events` (nothing new collected; service role only). Until it is applied, `GET /v1/world/members` answers `unavailable` and the card shows a dash. Test: `node --test workers/mccluster/test/world-members.test.mjs`. Rollback: `drop function if exists public.world_member_regions(integer);`. Promote it using the steps below.

A migration is committed under `supabase/migrations/` only with the exact
version production recorded for it (see `supabase/production-ledger.json` and
`docs/control-plane/DRIFT-CONTRACT.md`). A migration that is written, reviewed
and tested but not yet applied in production waits here, and says in its own
header what it fixes.

To promote one:
1. Apply it with the Supabase MCP `apply_migration` under the same name.
2. Read its version from `supabase_migrations.schema_migrations`.
3. `git mv` it to `supabase/migrations/<version>_<name>.sql` and confirm the
   file matches the stored statement byte for byte.
4. Add it to `supabase/production-ledger.json` and `core/drift-contract.json`
   and run `node scripts/control-plane-drift-contract-check.mjs`.
5. Drop any CI step that applies it from this folder.

Promoted: `action_clipping_marketplace_v1.sql` is
`20261006170955_action_clipping_marketplace_v1.sql`.

Pending: `equity_uprise_clipping_sources.sql` adds Action Network content sources
and distribution briefs. It is not applied in production. API Economic Core CI
applies it only to its isolated rebuilt database before the clipping regression.
Promote it using the steps above after production application is verified.

Promoted: `antisocial_get_social_completion_v1.sql` is
`supabase/migrations/20261015000455_antisocial_get_social_completion_v1.sql` (applied, mission open). It completes the three-level
Anti-Social mission on top of the applied draft
(`20261014185154_antisocial_get_social_three_levels_draft.sql`): the writers
for `network_connections` (request, answer, withdraw, the pair's state, my
connections with names) so "connect through the platform" exists, with
notifications; publish-together (`publish_antisocial_collaboration`, the
vouch table `action_collaboration_posts`, `antisocial_collaborations_for_me`,
the public `action_collaboration_cards`); a `review_antisocial_level` that
settles both members and awards `collaboration`; an `action_record` that
carries levels; and, last, the mission set to `open`. Behaviour tests:
`supabase/tests/antisocial_connections.behaviour.sql` and
`supabase/tests/antisocial_levels.behaviour.sql`, run by
`scripts/test-antisocial-db.sh` on a scratch Postgres (the chain: the role
stub, `supabase/tests/mnet_network_tables.stub.sql`, the gamification,
proof-review and feed-share migrations, the draft, then this file). Applying
it opens the mission; promote it using the steps above.

Pending: `commerce_stripe_reconciler_v3.sql` makes concurrent Stripe deliveries
for one sale wait for each other (a refund racing its checkout was lost),
promotes a payment the owner typed in instead of shadowing it, and keeps partial
refunds as `work_payments.refunded_cents`. The webhook calls the same functions
before and after it applies. API Economic Core CI applies it to its rebuilt
database, reruns the v1/v2 suite, then runs
`supabase/tests/commerce_stripe_reconciler_v3_regression.sql` and the two-session
race in `supabase/tests/commerce_stripe_concurrency.sh` (which fails on v2).
Production has v1 and v2 (20261006021431, 20261006023453); promote v3 with the
steps above.

Promoted: `world_gdelt_gkg_news_v1.sql` is
`supabase/migrations/20261016151123_world_gdelt_gkg_news_v1.sql` (applied
2026-10-16). The World has its news: GDELT GKG rows (`gdelt_gkg_v2`) beside
#432's dormant DOC path in the same `media_news_*` store, read through the
Worker only. `WORLD_NEWS_INGEST_ENABLED = "true"` in
`workers/mccluster/wrangler.toml`; `"false"` stops the ingest. Tested by
`scripts/test-world-news-db.sh`.

Applied as data, file removed 2026-10-27: `action_globe_demo_pins_v1.sql` put the
first pins on the World (owner, 2026-10-15: "we need to have it populated with
missions"). Production holds its three regions (US-CT, US-GA, CD-HK, written
2026-10-15) and the mission-region rows; it was run as the service role, not
recorded as a migration, and had nothing left to promote. The SQL lives on as
`supabase/tests/action_globe_demo_pins_v1.applied.sql`, the fixture
`scripts/test-mission-pins-db.sh` applies before the pins migration. Regional impact totals
still need five consenting members per region and are not seeded.

Pending: `20261015210000_intel_mission_canon_v1.sql` is the one evidence ->
claim -> briefing -> decision -> mission -> outcome schema for Halo and the
plane (design: `docs/control-plane/INTEL-TO-MISSION-CANON.md`). It reuses
`ops_ingest_*`, `ai_context.decisions`, `action_missions` and `action_proofs`
and adds the `intel_*` tables and service-role-only functions. Rollback:
`20261015210000_intel_mission_canon_v1.rollback.sql`. Behaviour test:
`supabase/tests/intel_mission_canon.behaviour.sql`, run with the dependent
tables, the rollback and a re-apply by `scripts/test-intel-canon-db.sh` on a
scratch Postgres 16. Apply as `intel_mission_canon_v1`, then promote using the
steps above. The Worker's intel routes answer `intel_schema_not_ready` until
then, and its USGS collector stays off until `INTEL_USGS_COLLECTOR_ENABLED`
is `"true"`.

Superseded and removed 2026-10-27: `20261011190000_decision_intelligence_evidence_v1.sql`
(a private schema with no grants that nothing can reach, and a second source
registry beside `ops_ingest_*`). The intel canon replaced it; the file is in
Git history only.

Pending: `policy_fellowship_ladder_v1.sql` is the Policy Fellowship ladder
(owner, 2026-10-15): every unlock as a data row (`action_unlock_rules`: the
public layer, member layers, the policy ladder, the Equity Uprise rule, which
ships disabled pending counsel, and the Whip Equipped hand-off, open to any
signed-in member; there is no voter-registration rule), status-only strict
referral verification, the ladder (any three distinct admin-verified, non-clip
missions; help a person, write a song and show up to a rally are suggestions), state Policy Fellowship cohorts and policy teams on
`action_cohorts`, the memo review loop (immutable versions with diffs, an
immutable review log, notifications) and a per-memo research collection of
unverified leads. It replaces `admit_fellow_to_cohort()` (production hash
matches `20261005054040`) with the same function plus the ladder check for
policy cohorts. Behaviour tests: `supabase/tests/policy_fellowship_ladder.behaviour.sql`,
run by `scripts/test-policy-fellowship-db.sh` on a scratch Postgres. Design,
decisions and the apply checklist: `docs/control-plane/POLICY-FELLOWSHIP-LADDER.md`.
Promote using the steps above after the owner approves it.

Promoted: `supabase/migrations/20261021050105_music_creator_one_click_v1.sql` makes creator onboarding one click
(owner, 2026-10-15). `music_creator_state()` is the server-truth show-condition
for Creator Studio (a member with a `music_creator_profiles` row never sees the
onboarding again); `music_become_creator(p_handle, p_artist_name,
p_accept_terms)` builds the profile from data the member already gave (public
name, M handle, bio, https site), asks only for a missing name or handle, and
inserts the profile and links `identity_presentations.music_enabled` in one
transaction. Idempotent; overwrites nothing. Signed-in members only (not anon).
For older deployments without the RPCs, Creator Studio can build the same answer in the browser
(`js/creator-onboarding.js`). Behaviour tests:
`supabase/tests/music_creator_one_click.behaviour.sql`, run by
`scripts/test-music-creator-db.sh` on a scratch Postgres. Rollback is in the
file header. Since 2026-10-20 (one sign-up:
"never re-enter what the profile has") it also copies the member's https
profile picture (`network_profiles.avatar_url`) into the new creator profile
and returns it as `prefill.avatar_url`, so every "Become a creator" door on the
site is one tap; the browser fallback does the same. Applied in production as `20261021050105_music_creator_one_click_v1` on 2026-10-21; stored SQL matches the source exactly.

Promoted: `anon_policy_scope_v1.sql` is
`supabase/migrations/20261016031123_anon_policy_scope_v1.sql` (applied
2026-10-16). Signed-out visitors, artist pages and the listen.html directory
read published creator profiles, tracks, offers and services again.

Pending: `action_bounty_claim_existing_row_guard_v1.sql` preserves the result of
claim-row lookup before aggregate SELECT statements overwrite PL/pgSQL FOUND.
It salvages the focused fix from PR #428 without its older migration history.
Run `bash scripts/test-action-bounty-claim-db.sh` against scratch PostgreSQL;
first claims insert, repeats are idempotent, cancelled/expired claims reuse the
row, and rejected/unfunded claims remain blocked. Promote only after applying
through the production ledger workflow above.

Pending: `live_missions_v1.sql` (rollback `live_missions_v1.rollback.sql`) adds
live missions (owner, 2026-10-15): a per-mission live policy (`required` on
every mission, owner decision), live runs with Stream input ids kept
column-private, connected segments from Cloudflare webhooks or heartbeats, a
replay ledger, hashed recording-chunk receipts, reports, the 12 publishing
opt-ins, live coverage bounties beside `action_bounties`, the public city-cell
"Live now" read, the desk's event log and kill switch, and two guards: a
coverage-bounty claim is approved or paid only behind continuous coverage of
the event window, and (once `action_live_controls.enforce_live_required` is
turned on; it ships off) a required mission takes proof only from a completed
live run. Nothing in it verifies a mission or pays a claim. Behaviour tests:
`scripts/test-live-missions-db.sh` (also with PR #444's
`mission_admin_approval_v1.sql` via `EXTRA_SQL`). Design and enable checklist:
`docs/control-plane/LIVE-MISSIONS.md`. Apply as `live_missions_v1`, then
promote using the steps above.

Pending: `20261015230000_identity_verification_levels_v1.sql` (with
`…_identity_verification_levels_v1.rollback.sql`) is the identity
verification levels (owner, 2026-10-15): a live camera video introduction
reviewed by the owner (V1), and full Hitman's Halo access (V2: a second live
video compared with the first plus a Persona government-ID check). It needs
`policy_fellowship_ladder_v1.sql` first and extends its
`action_member_verifications` / `action_unlock_rules` / `action_unlock_progress()`.
Private bucket `identity-verification-videos`, versioned consent (drafts until
the owner and counsel approve), an append-only review log, and the
`halo_full` rule shipped disabled. Behaviour tests:
`supabase/tests/identity_verification_levels.behaviour.sql`, run by
`scripts/test-identity-verification-db.sh`. Design and apply checklist:
`docs/control-plane/IDENTITY-VERIFICATION-LEVELS.md`.

Pending: `mission_admin_approval_v1.sql` (rollback `mission_admin_approval_v1.rollback.sql`)
makes "only an admin completes a mission" a database invariant (owner,
2026-10-15): proofs are born pending, a proof or assignment becomes `verified`
only under an admin token that is not the submitter's with a same-transaction
review in `action_proof_review_history` (Anti-Social levels now archived there
too), points are minted only by that review, bounties are approved only behind
a verified mission and paid only by an admin, clips have no automatic approval
and no money without an approved clip, and a mission opens only after an admin
approved it for publication. Apply after `policy_fellowship_ladder_v1.sql`.
Pending: `gated_track_mission_identity_v1.sql` (rollback alongside) is the
CIA Mind Control gated-track rule as an `action_unlock_rules` row (three
admin-verified missions and `member_identity_verified(uid, purpose)`, purpose from the rule's params), the Worker's
`music_gate_rule_state` / `music_gate_claim_rule`, and the taxonomy rows for
`music_preview_play` / `music_full_play`. Apply after the approval file and, preferably, after PR #443's identity file (both orders apply cleanly).
Both are tested by `scripts/test-mission-admin-approval-db.sh`; audit, design
and apply order: `docs/control-plane/MISSION-ADMIN-APPROVAL.md`.

Pending: `20261016010000_profile_edit_gate_v1.sql` (with
`…_profile_edit_gate_v1.rollback.sql`) is the profile edit gate (owner,
2026-10-15): profile details on a data-driven list (`profile_protected_fields`)
lock once set; a signed-in member's write that would change one is refused by
a trigger, directly or through any RPC. A change is asked for with a live
video (a new submission level, `profile_edit`, on the identity levels' own
tables, bucket and finish function) and the Persona ID check, and is applied
only by `profile_edit_review_decide()`, once, with an append-only audit.
Apply after the ladder and the identity levels. Behaviour tests:
`supabase/tests/profile_edit_gate.behaviour.sql`, run by
`scripts/test-profile-edit-gate-db.sh` (which also reruns the identity and
ladder behaviour tests on top). Design: `docs/control-plane/MEMBER-DESK-AND-PROFILE-EDIT-GATE.md`.

Pending: `20261015230000_action_mission_pins_arcs_black_business.sql` (owner mission curation,
2026-10-15; owner approval required). Missions get many pins (country regions from Natural Earth
v5.1.2 references; a "first world" list from the World Bank FY27 high-income classification, as
data), a display-only origin ("Started by the Connecticut cohort"), the policy arc (memo → reform
paper, unlocked by an admin-verified memo), and Black business listings reviewed by the desk. It
also makes existing pins display-only (`join_scope` 'anywhere'): today every pinned open mission is
unjoinable because no member has a region. Its regions (the former `action_globe_demo_pins_v1.sql`) are already in
production. Test: `scripts/test-mission-pins-db.sh`. Design and apply checklist:
`docs/action-network/MISSION-PINS-ARCS-BLACK-BUSINESS.md`.

Reconciled from production on 2026-10-16 (SQL was already applied; not re-executed):
`supabase/migrations/20261016020407_action_partner_opportunity_drafts_v1.sql`
records the private funding opportunities and partner mission drafts. It publishes
no missions and enables no claims or compensation. With it the ledger and drift
contract covered all 310 production migrations then (311 since
20261016151123).

Promoted 2026-10-17 to repair Analytics missing-function responses:
- `20261017030551_analytics_country_v1.sql` is applied in production; its exact SQL is in `supabase/migrations/`.
- `20261017030554_analytics_region_v1.sql` is applied in production; its exact SQL is in `supabase/migrations/`.
- `20261017030617_intel_mission_canon_v1.sql` is applied in production; its exact SQL is in `supabase/migrations/`.
The applied SQL headers retain their original pending wording to preserve byte-for-byte production history. The intel rollback remains in this folder; collectors remain separately controlled.
