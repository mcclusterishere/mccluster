# Analytics business event counters — stage 1

Diagnosis: owner Analytics issued eighteen separate full-history and selected-window exact-count requests to `events_lean` for event families. Under database contention the all-time first-party counts timed out (~8 seconds), setting business `snapshot.partial=true`. A read-only direct combined aggregate was independently measured in production at ~2.9 seconds on 2026-10-21; the result was an observed query-plan sample, not a service-level latency guarantee.

This change replaces the eighteen count queries with one `SECURITY INVOKER` RPC for **service_role only**, on the same first-party non-bot event population and half-open window. One PostgreSQL statement gives a consistent snapshot of the counters. Invalid rows or a failed RPC leave those specific metrics null and report `read_errors.eventCounts`; they never become zeros. All other business measurements remain untouched. The RPC name and JSON field names are stable, so a future set of counters can be added via a new audited contract.

## Required rollout order

1. PR exact-head CI: isolated PostgreSQL tests validate every count and event filter, exclusive upper bound, null bot treatment, no tenant-site leakage, and deny browser roles; JavaScript tests validate shape, counts, nulls and error behavior.
2. Apply the **exact reviewed SQL** in `supabase/pending/analytics_business_event_counts_v1.sql` to the approved production project with a canonical migration. Capture assigned production version, statement checksum, and grants. This step changes **only** an additive SQL function and its grants, never existing events.
3. Reconcile the existing production migration ledger and drift contract with the exact newly applied migration (no duplicate reapplication) and run Drift Guard. Production must attest matching parity.
4. Deploy the approved Worker source using the normal deployment pathway **after** the function and migration contract are verified. Do not infer runtime from main/CI. Record exact serving Worker revision and business endpoint response.
5. Verify the nine all-time/selected-window counters against an independent service-role read, test 24h/7d/30d, and check `snapshot.partial` and `read_errors.eventCounts` while monitoring HTTP 500 and SQLSTATE 57014. Do not suppress other read errors or claim every source complete.

## Scope and safeguards

No changes to ingestion, consent, raw events, RLS on existing tables, billing, registrations, music records, mission semantics, user identities, or unrelated PRs. This stage does not change timeout settings or claim to repair future collector/browser delivery failures. A separate second stage will improve per-source operational error reporting.
