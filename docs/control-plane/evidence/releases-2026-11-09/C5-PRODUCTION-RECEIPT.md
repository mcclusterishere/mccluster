# C5 database prerequisite applied, 2026-11-09

The production database prerequisite is complete. This receipt supersedes the earlier C5-RELEASE.md statements that the nonce table is absent or the migration is awaiting permission. Worker activation and broader operation safety remain separate unfinished work.

## Actual application

- Canonical project: `zmnhbrjyhxzhkxmhkexs`.
- Tool: Supabase `apply_migration`, name `core_signed_nonces_v1`.
- Returned success: true.
- Actual recorded version: `20261109180829`.
- Source: exact `supabase/pending/core_signed_nonces_v1.sql` from Claude head `15523e187d1800dcbe7cd2c19f4ddfe6f203f556`.
- SHA-256: `f07410354ae4cd5d48aea9b95e71b81c6fdc3a4d258c44e4f6dca7520b368503`.
- The single stored `supabase_migrations.schema_migrations.statements` entry was compared byte for byte with the reviewed file and matches.
- Correct production filename prepared locally: `release-copy/supabase/migrations/20261109180829_core_signed_nonces_v1.sql`.

## Verification performed in production

- Table owner postgres; columns nonce text, expires_at timestamptz, claimed_at timestamptz default now(), all non-null.
- Primary key on nonce and expiry index exist.
- RLS enabled. anon/authenticated SELECT, INSERT, UPDATE and DELETE privileges are all false. Existing service_role privileges are present.
- In one explicitly rolled-back transaction: service_role inserted a synthetic nonce; a second insert was rejected by the primary key; anon and authenticated each failed both a SELECT and an INSERT with insufficient_privilege. All expected outcomes were asserted by SQL exceptions.
- After rollback the table contains zero rows. No fixture or business data remains changed.
- Health advisors remain clear. Security advisors changed only by adding the expected informational RLS-enabled/no-policy entry for this intentionally service-only table. No public/client policy was added to silence it. Existing unrelated warnings were not changed.

## Compatibility and recovery

The migration adds an empty table and index and restricts client access. It changes no existing table, function, business record, secret, authentication setting or Worker configuration. The currently deployed Worker does not use the new table. Native PostgreSQL 17.7 rehearsal had already proved idempotent apply, access boundaries and one winner among eight simultaneous nonce claims. Production is PostgreSQL 17.6.

Because no pre-existing object/data was modified, there was no affected data to export or back up. No full database backup was created or asserted. Recovery from a later Worker failure should leave this harmless additive table in place; no destructive down migration was run or authorized here.

## Still required before releasing the new Worker

1. Reconcile Git using this actual migration version and exact bytes: move the pending file, update production ledger and drift contract from the final current migration list, and update the pending live-caller entry. Coordinate with the commerce/environment migration owners so their receipts are retained. Nothing has been pushed by this worker.
2. Add the reviewed `CORE_REPLAY_STORE = "supabase"` configuration with appropriate authorization before the new verifier is deployed. No dashboard or repository configuration was activated here.
3. Resolve or explicitly scope out the separately reproduced paid-operation race and uncertain provider-outcome failures documented in C5-RELEASE.md. The database prerequisite does not fix those application paths.
4. Verify final integrated CI and deployment permissions before a release. A merge to main can trigger a Worker deployment.

Artifacts in `receipts/` preserve the tool response, schema receipt, exact SQL, rolled-back smoke result, and before/after health/security advisory summaries. No credentials were read or saved.
