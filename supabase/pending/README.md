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
file header. Apply it together with (or after) `anon_policy_scope_v1.sql`:
that one is what lets a signed-out visitor, and the artist pages and the
listen.html directory, read creator profiles at all. Promote with the steps
above.

Pending: `action_bounty_claim_existing_row_guard_v1.sql` preserves the result of
claim-row lookup before aggregate SELECT statements overwrite PL/pgSQL FOUND.
It salvages the focused fix from PR #428 without its older migration history.
Run `bash scripts/test-action-bounty-claim-db.sh` against scratch PostgreSQL;
first claims insert, repeats are idempotent, cancelled/expired claims reuse the
row, and rejected/unfunded claims remain blocked. Promote only after applying
through the production ledger workflow above.


Promoted: `action_partner_opportunity_drafts_v1.sql` was applied to production as
`20261016020407_action_partner_opportunity_drafts_v1.sql` and moved to
`supabase/migrations/`. Four source-backed opportunities and ten partner-only
mission proposals are now stored privately. RLS was tested in a rollback
transaction before application and independently verified after application:
anonymous SELECT absent, non-admin authenticated sees no proposals, all
ten proposals remain `draft`/`admin_only`/non-claimable/uncompensated.
The Control Funding Intelligence UI and Worker endpoint are **feature-branch
changes** awaiting merge and deployment; production tables alone do not
make the private workspace live. Any later activation requires written
partner permission, verified restricted funds, proof/privacy review and
separate bounty approval.
