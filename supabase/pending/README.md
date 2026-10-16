# Pending migrations

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

Pending: `action_globe_demo_pins_v1.sql` puts the first pins on the World
(owner, 2026-10-15: "we need to have it populated with missions"). It inserts
three regions (Connecticut, Georgia, Haut-Katanga) with centroids and places
every open mission in one by its campaign, published. Idempotent; apply as the
service role, then promote with the steps above. Regional impact totals still
need five consenting members per region and are not seeded.

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

Superseded, do not apply: `20261011190000_decision_intelligence_evidence_v1.sql`
(a private schema with no grants that nothing can reach, and a second source
registry beside `ops_ingest_*`). The intel canon replaces it.

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

Pending: `music_creator_one_click_v1.sql` makes creator onboarding one click
(owner, 2026-10-15). `music_creator_state()` is the server-truth show-condition
for Creator Studio (a member with a `music_creator_profiles` row never sees the
onboarding again); `music_become_creator(p_handle, p_artist_name,
p_accept_terms)` builds the profile from data the member already gave (public
name, M handle, bio, https site), asks only for a missing name or handle, and
inserts the profile and links `identity_presentations.music_enabled` in one
transaction. Idempotent; overwrites nothing. Signed-in members only (not anon).
Until it is applied, Creator Studio builds the same answer in the browser
(`js/creator-onboarding.js`). Behaviour tests:
`supabase/tests/music_creator_one_click.behaviour.sql`, run by
`scripts/test-music-creator-db.sh` on a scratch Postgres. Rollback is in the
file header. Promote with the steps above.

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
