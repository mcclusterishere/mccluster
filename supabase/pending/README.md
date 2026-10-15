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

Pending: `policy_fellowship_ladder_v1.sql` is the Policy Fellowship ladder
(owner, 2026-10-15): every unlock as a data row (`action_unlock_rules`: the
public layer, member layers, the policy ladder, and the Equity Uprise and
Whip Equipped rules, which ship disabled pending counsel), status-only strict
referral verification, starter missions (help a person, write a song, attend a
rally), state Policy Fellowship cohorts and policy teams on
`action_cohorts`, the memo review loop (immutable versions with diffs, an
immutable review log, notifications) and a per-memo research collection of
unverified leads. It replaces `admit_fellow_to_cohort()` (production hash
matches `20261005054040`) with the same function plus the ladder check for
policy cohorts. Behaviour tests: `supabase/tests/policy_fellowship_ladder.behaviour.sql`,
run by `scripts/test-policy-fellowship-db.sh` on a scratch Postgres. Design,
decisions and the apply checklist: `docs/control-plane/POLICY-FELLOWSHIP-LADDER.md`.
Promote using the steps above after the owner approves it.

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
