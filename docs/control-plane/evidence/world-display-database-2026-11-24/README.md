# Optional World display database preparation — 2026-11-24

This is shared Equity Uprise platform support for draft PR #822. It prepares the optional public news heat-map preference.
Nothing was applied to production, no module was enabled, and no public preference was saved.

## What changed

The pending forward file now has a transaction, a five-second lock bound, prerequisite checks and exact-shape guards.
It preserves existing choices on reapplication and refuses partial objects, unexpected grants, changed function bodies and
an obsolete transaction snapshot. Its owner check and public boolean contract remain the original PR's.

The table starts empty. The existing read function already returns false for that state, so the feature remains off.
Every owner save creates the singleton row, even a save of false. That makes a saved choice distinguishable from an
untouched store without adding an audit column or changing the Worker or UI contract.

The new recovery file accepts only the reviewed empty store. It refuses any saved choice, changed schema or later
dependency; it has no force flag and no CASCADE. Recovery waits behind a concurrent save, then sees the committed choice
and refuses. READ COMMITTED is required to prevent an old snapshot from overlooking a later save.

## Production compatibility

[production-catalog.json](production-catalog.json) records the exact SELECT-only catalog query and returned values at
2026-11-24 19:05:21 UTC on the sole Supabase project. PostgreSQL was 17.6; the table and two functions were absent.
The five required org and membership columns had the expected UUID/text types and NOT NULL constraints. No organization,
membership, personal, preference or migration-author rows were read.

This is a compatibility observation, not approval or proof that a future production apply will succeed. Repeat the
catalog read immediately before applying an approved file.

## Native proof and its limits

The disposable PostgreSQL 17.6 run was observed returning **75 passed, 0 failed**.
[native-observed.json](native-observed.json) preserves that exact stdout and its limits. The detailed local JSON receipt
was written and copied before the workspace went offline, but its contents were not retrieved. It is not fabricated here.
The prepared SQL and native script were reconstructed from the exact writer inputs after the outage.

The native proof exercises real PostgreSQL role sessions and covers:

- Service RPC calls fail before the SQL and succeed after it; the store remains empty and reads false until a save.
- Anon and authenticated RPC calls fail, including a forged owner UUID; all three API roles are denied direct table
  SELECT, INSERT, UPDATE, DELETE and TRUNCATE. RLS still hides a row after a temporary accidental SELECT grant.
- Only a house owner actor can save; a house staff member, another organization's owner, an unknown actor and null actor
  fail. Null values and invalid singleton rows fail.
- True and false choices survive reapplication and refused recovery; unexpected grants, disabled RLS and changed function
  bodies stop both forward and recovery without changing rows.
- A later view dependency makes recovery fail atomically without CASCADE.
- A repeatable-read snapshot that cannot see a later committed false save is refused before recovery can remove anything.
- Recovery reaches a real lock wait behind an in-flight false save, then refuses and preserves the committed row.
- A competing table lock reaches the five-second timeout; the empty-store rollback, repeated rollback and reapply pass.

The standalone fixture extracts the canonical tenancy table DDL from `supabase/replay_migrations/0026_tenancy.sql`.
Its local roles and Supabase-like default privileges are explicit fixtures. This is not a complete Supabase reset.

## Required CI gate

Reconciliation CI now runs the same script twice: standalone and `--full-reset`. The latter uses the actual local Supabase
reset and does not replace its roles, tables, RLS or triggers. It verifies the exact migration version/name list against
canonical files plus replay foundations, rather than comparing only counts. Both modes upload JSON receipts, including
the SHA-256 of the exact SQL files, in `world-display-database-proof`.

The workspace outage prevented the targeted Worker/contract command and source-map validator from running locally.
The source map and coverage JSON were updated from the fetched base data using the validator's documented checks; CI
must regenerate/verify them. **Require the published head's Worker contracts, Supabase migration reset and source-map
checks to pass.** No CI, merge, deployment or production acceptance pass is claimed by this preparation receipt.

## Promotion and recovery decisions

The only forward approval candidate here is:

`supabase/pending/20261123013000_eup_world_display_v1.sql`

It is optional. It needs no pending SQL, new backend, Edge redeploy or activation. Its two existing exceptions in
`live-callers.json` stay pending. The ledger, drift contract, schema manifest and production snapshots stay unchanged
until an approved production apply is recorded through `supabase/pending/README.md`, "To promote one".

A service credential remains trusted to assert an actor UUID; the existing Worker verifies the owner and stamps that
UUID before calling the setter. Credential isolation remains part of the trust boundary.

The separate recovery approval would name `supabase/pending/20261123013000_eup_world_display_v1.rollback.sql`.
Roll callers back first. A stored choice requires preservation/export and a new reviewed recovery decision; this file
will not delete it.
