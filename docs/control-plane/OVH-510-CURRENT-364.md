# OVH #510 — current 364-migration recovery (2026-11-13)

This note supersedes the older 363-migration instructions in the historical runbook. **Do not run those older instructions verbatim.**

- Production project `zmnhbrjyhxzhkxmhkexs` has **364 applied migrations**, latest `20261110220135_media_operation_claims_v2`, SHA-256 ledger `6fcada89fc8d3d3621b4c49242ca84a1aff050758cb1ecd60753cfbbbba35054`. The recorded SQL source and dated receipts are already in `main`; no production migration replay or deletion is authorized.
- OVH at the start of this repair serves `9c5b75032d1794c47d8b6db05acf16e3965faa74`, with 359 expected migrations. Healthy host-executed local and public /health probes both returned HTTP 200. Its drift report is critical because the **contract**, not the DB, is behind.
- Isolated #510 recovery branch `repair/ovh-510-ledger364-auth-receipts-20261113` starts at that serving SHA. Its first commit imports the five actually applied migration SQL files and exact 364 contract plus five dated receipt references. Its second commit restores the already-reviewed, fail-closed read-only SSH setup, per-reconcile cycle receipts, health projection and regressions. No unrelated application changes.
- Before merging: recheck the live migration count/latest/hash; require all exact-head production gates to be green, including Core checks and the canonical Supabase reset. Merge with **merge commit** so the isolated head remains an ancestor of `main`; do not squash/rebase it. Do not advance production refs before this acceptance.
- Promote the isolated HEAD via the approved exact-head `promote-ovh-production.yml` path, using the then-current production ref as an explicit lease. Never force or use `allow_rollback=true`. This restarts Core and requires an operator-selected deployment window. The GitHub ref movement is not runtime evidence.
- Verify new serving SHA independently from the OVH host's **local and public** /health HTTP response body, plus `deployment.runtime_verification=verified`, matching manifest and reconcile state, active services, and **364/364** migration attestation. Direct DNS failures from an unrelated client are `unverified`, not proof of an outage.
- To establish private mode, authorize ONLY the generated public deploy key in GitHub Deploy Keys (write OFF). On the **OVH host**, after hardening is promoted, run `scripts/ovh-private-repo-ssh.sh prepare`, register the public key, run `activate`, then `status`. The script proves pinned host key, correct deploy-key identity, refusal of write, successful SSH ref reads and two distinct successful authenticated timer-started reconciliation cycles. Never share or print any private key. Keep #510 open until all evidence is positive. #509 is independent.

---

