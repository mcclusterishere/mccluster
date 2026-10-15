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
