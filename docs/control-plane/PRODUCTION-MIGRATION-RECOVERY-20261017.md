# October 17 production history recovery

This commit **does not run any SQL against production**. It brings existing live
migration history into canonical Git source, following the production-ledger contract.

Read-only verification of `supabase_migrations.schema_migrations` showed 323
applied versions, latest `20261017214808_mcp_approval_scope_v1`. Its first
319 ordered `version:name` entries have SHA-256
`528af5914adc43c31dd4bb56a3ea46c48731492f3d6e9a637894c6950b7e58f9`,
exactly matching the previous committed ledger. All 323 entries have SHA-256
`07b9c016ee02f3a6e848992711df7715e3a5e4daa5d2c6834aab1df4fd6f5061`.

## Where the four records came from

- `20261017054833_analytics_ingestion_pipeline_v1`: already on main; omitted
  from the ledger after merge #488.
- `20261017164335_action_archive_cohort_v1`: exact SQL from open #491.
- `20261017164416_action_mission_reset_v1`: exact SQL from open #491.
- `20261017214808_mcp_approval_scope_v1`: exact SQL from merged #500's
  pending path, applied independently to production.

For the last three records, the complete GitHub source strings were compared
character-for-character with production's `statements[1]` via read-only
queries on October 17, 2026, and all three matched exactly.

## Release and privacy constraints

**Do not reapply these migrations on production**: all four were already
recorded applied. Reconcile the pending path and its isolated CI consumer.

The archive/mission SQL inherited from #491 contains public-repository
historical project material and partner drafting context. Review its public
exposure with the data owner before promoting this branch. Removing text from
the migration after application would break the source-to-production exact
record; a separate forward-only data correction and public-history response
may be necessary.

Once merged, PR #491 should rebase against this recovery and keep its
unmerged UI/Worker changes only. Avoid reintroducing duplicate SQL files,
a stale 322-entry ledger or an earlier drift contract.

A green migration-history check **does not** prove Edge Function deployment;
the canonical deploy still requires its own verified source/runtime receipt.
