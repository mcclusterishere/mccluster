# Applied database repairs — 2026-11-24

The owner requested: “Audit everything that needs a database migration and make it happen.”
Before the later read-only/draft-only handoff, four reviewed migrations were applied through Supabase `apply_migration` to
`zmnhbrjyhxzhkxmhkexs`. A separate session applied a fifth migration while this audit
was running. The database ledger is **389** at the snapshot captured by 16:50:59 UTC;
its SHA-256 is `08f933eb60484f323e910569915afa365684deba0d5063fbd2c88ece5592bf8b`.

## Actual production records

| Version | Migration | Stored bytes | Stored SHA-256 | Source |
|---|---|---:|---|---|
| 20261124164026 | member_fronts_shared_revision_directory | 26,851 | 34258d5855f2785f38f293e85a388d1a4ae92df36ff361e29713b6fa014bf943 | Concurrent session; recovered from the actual ledger, not independently claimed as reviewed here |
| 20261124164529 | ai_context_workstreams_v1 | 52,769 | 5baa5f09f1b2d7a823f63bbe78ae74065da57022ac854593e8d5790a6c9c03f0 | Exact reviewed main SQL |
| 20261124164724 | commerce_stripe_reconciler_v3 | 27,567 | 71ee1452fa032ca1cca8f3f10e8aebd95ac34e6f149fcd20681b1fdfca00c8d6 | Exact reviewed main SQL |
| 20261124164851 | equity_uprise_clipping_sources | 15,250 | 81f097b0f744c9b122cd465e61054bea7f7b84e7ba1a9a93d1f23aef292a640c | Exact reviewed main SQL |
| 20261124164904 | action_bounty_claim_existing_row_guard_v1 | 5,121 | 8b3c2248124649a7732dfad2b435bf95f198cc767f9de10363e178bf3ea83bf1 | Exact reviewed main SQL |

Every row contains one statement. The five canonical migration files equal those stored
statements byte for byte, including their final line feeds. No timestamp was invented,
no historical SQL was rewritten, and no rollback/replay fixture was applied to production.

## Proof before application

The workstream change was reviewed and merged in [#832](https://github.com/mcclusterishere/mccluster/pull/832).
Its [exact-source native/reset job](https://github.com/mcclusterishere/mccluster/actions/runs/45342314631/job/138268626386)
passed 313 native PostgreSQL assertions and two integrations against the complete reset
with the real ontology and decision triggers. Core's full suite passed 865 with no failure
and 20 deliberate skips in that release.

Commerce v3 and clipping passed [the exact-main economic database job](https://github.com/mcclusterishere/mccluster/actions/runs/45344420161/job/138275439983):
the full canonical reset, both commerce regression suites, real concurrent refund/checkout
delivery in both orders, 24 randomized replay assertions, and clipping behavior. That job
also passed the bounty scratch proof; its narrower fixture boundary remains explicit.

Immediately before these applies, live payment and clipping-campaign tables were empty,
new columns were absent, replaced commerce function bodies and the bounty function matched
their canonical predecessors, and grants matched the reviewed boundaries. No customer
payment, claim, profile, or private context content was copied into this receipt.

## Live verification

- At 16:45:56 UTC, both workstream tables had RLS enabled, zero policies and no anonymous
  or ordinary-member table access. The four public RPCs were SECURITY DEFINER with an empty
  search path, executable by service_role and not anon/authenticated.
- At 16:48:45 UTC, commerce v3 was recorded with the exact hash, all existing commerce RPCs
  remained service-only, and no invalid refund amount existed.
- At 16:48:58 UTC, all seven clipping columns and both new distribution/create RPCs existed.
- At 16:49:41 UTC, the bounty function contained the captured existing-row flag, remained
  unavailable to anon and executable by authenticated members.
- The whole-schema snapshot was captured with SELECT-only delta queries. Each full-section
  MD5 was recomputed from the reconstructed rows; all rows outside the named changes matched
  the November 23 baseline. The work_payments relation was included explicitly when its
  changed column/constraint signature was detected.
- Snapshot totals: 389 ledger rows, 5 schemas, 11 extensions, 586 relations, 620 functions,
  477 policies, 174 triggers, 15 buckets, 1 cron job. There are no exposed tables without RLS,
  no exposed definer views and no SECURITY DEFINER functions without a fixed search path.

## Concurrent member-front change

The migration at 16:40:26 UTC predates this session's workstream apply and was not submitted
by this audit. Its stronger revision/directory schema supersedes the old
`supabase/pending/member_fronts_v1.sql`; **do not replay that older file**.
The ledger is the source for the recovered canonical SQL. Its coupled API release and
review provenance still need reconciliation with the other session.
The audit found publication-status and legacy-API compatibility issues and prepared
targeted regression coverage; recording its SQL does not claim its entire feature rollout
is complete.

## Repository reconciliation and remaining release checks

The four reviewed files moved unchanged under their actual versions. The concurrent file
was recovered exactly. The production ledger, Core drift contract and new production
snapshot reflect all five. Test/CI consumers follow the canonical paths; the standalone
workstream proof retains rollback/reapply coverage, while the real reset runs its integration
fixture against the already-applied schema.

Focused tests after these path and API repairs: **81 passed, 0 failed**.
The new World-member proof also reproduced and fixed an equal-timestamp ambiguity;
it passed 12 scenario groups twice on native PostgreSQL 17.6 and 7 Worker tests. That
pending SQL is not represented as applied by this receipt.

**Later authorization boundary:** production is SELECT-only for this preparation,
new SQL requires approval by exact file name, and this records change stays a
draft PR without merging. The following release actions are outstanding, not authorized
by publishing the draft.

**Still required at this checkpoint:** obtain the reset-generated manifest from this
records PR's CI artifact, rerun its complete gates, merge the reconciled records, promote
Core through `promote-ovh-production.yml`, verify serving/deployed SHA and ledger parity,
exercise an owner-session checkpoint and its replay, and sync Prime's actual local records.
No production Core promotion or Prime sync is claimed here.

The complete 51-candidate audit and specific remaining constraints are in
[migration-audit-2026-11-24.md](migration-audit-2026-11-24.md).

