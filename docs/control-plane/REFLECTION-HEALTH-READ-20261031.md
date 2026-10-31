# Reflection health-read timeout repair

After Core runtime `3340bbcdfb3776499017d0489f96939233b14888` was verified and migration parity restored, diagnostic job `7c46fda2-71f9-4b64-bce9-67ea2c1a0497` failed with `canceling statement due to statement timeout`. It allowed zero child jobs and had one attempt.

Production EXPLAIN ANALYZE reproduced the expensive read: extracting six JSON fields while ordering all completed host-health records took 51,661 ms. The scan processed 10,539 health rows and touched 248,361 shared blocks. The table has roughly 11,245 estimated rows and 97 MB total storage. The existing indexes do not match the tenant/latest-health lookup.

The source repair first selects only the latest ID, then reads compact JSON by that primary key while preserving tenant, job type and completion filters. Missing/deleted rows remain unavailable; malformed identities fail closed. No raw telemetry is passed to the model. The narrow identity query measured 6,616 ms in this environment, so indexing remains useful and live diagnostic verification is required before claiming the timeout resolved.

`supabase/pending/core_reflection_read_indexes_v1.sql` adds two targeted indexes for latest health and recent non-health metadata. It remains unapplied. The short lock timeout fails closed rather than waiting indefinitely on production writes. Record the actual migration version/statements and update the canonical ledger after successful promotion.

Validation: Core syntax checks and the full Core test suite, including regressions for the two-phase read, tenant filtering, invalid IDs and deletion between reads. The production diagnostic must be repeated after deployment with `max_next_jobs=0`; do not infer success from the repaired runtime's health check alone.
