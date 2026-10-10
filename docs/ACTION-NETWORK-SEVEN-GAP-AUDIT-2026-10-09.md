# Action Network seven-gap audit — 2026-10-09

Scope: PR #400 branch feature/action-network-influencer-founders, head 353d6c0469c13f0c0e93a0803c18245f74b8f089, base main de333c60763f92442de3a456b51925b71ec2660d. Read-only source and CI review; **not** a database or deployment verification.

## Branch / CI snapshot
- 76 changed files, 161 commits ahead, 0 behind, mergeable without conflicts.
- Equity Uprise Core V2 CI failed: job 'Validate authority, program, plans, and building', step 'Require committed generated artifacts to be current'.
- Reconciliation CI and API Economic Core CI in progress at audit time. Eight other observed workflows successful.
- No PR review comments returned. Mergeability is not release readiness.

## Gap checklist
| Gap | Observed foundation | Blocking acceptance criteria | Status |
| --- | --- | --- | --- |
| 1. Money transmission | Separate A and USD_CENTS ledger account kinds; finance endpoints disabled | Payments counsel and provider determination, contractual terms, no unapproved transfer/redemption | OPEN / legal |
| 2. Chargebacks | Pending immutable event/entry schema, risk holds, double-entry posting | Resolve posting idempotency payload mismatch, deterministic locks, reversal policy, provider reconciliation, concurrency and RLS tests | OPEN / critical |
| 3. Unit economics | Offline 8-pack, 3-channel scenario calculator | Verify actual provider/store fees, taxes, refund economics, accounting treatment and margin floor | OPEN |
| 4. Gift conversion | Five proposed gifts; FIFO purchase-lot pure calculator | Persist purchase lots, atomic consume/earn, policy version, refund/chargeback provenance, approve creator terms | OPEN / critical |
| 5. Creator acquisition | Offline pilot analysis, staged lifecycle trigger and clipping reporting view | Migrate/test, server-authorized analytics API, verified recruitment costs, cohort instrumentation, 28-day observed retention | OPEN |
| 6. Concentration/responsible spending | No verified monitoring pipeline in audited PR files | Spender distribution, limits, cooldowns, fraud escalation, alerting, safety review | NOT STARTED |
| 7. Trust/safety | At Night authenticated fail-closed guard and staged verification table | Trusted adult ID provider callback, host vetting, moderation/reporting, appeals, privacy/retention and platform-policy review | OPEN / critical |

## Concrete audit findings
1. **Critical: action_economy_post** returns a prior event by key without comparing type, reference or payload; retries can silently accept mismatched requests. Locks accounts in caller-specified order, permitting deadlocks. No unique partial index for platform accounts with NULL owner. Currency balancing alone does not enforce allowed accounting transitions.
2. **Critical: staged migrations not deployed**: creator billing, creator site publishing, adult verification, economy ledger and creator lifecycle/reporting remain in supabase/migrations/pending. Do not claim these work in production.
3. **High: creator_lifecycle_from_site** derives owner from active subscriptions; must test zero/multiple active subscriptions and correct ownership under all billing states. Function uses SECURITY DEFINER and is in public; trigger invocation must be audited with RLS and explicit privileges.
4. **High: creator_clip_lifecycle_summary** aggregates clipping marketplace rows, but is a service-only SQL view, not an owner-authorized API. 'Verified' status criteria require review against actual marketplace transitions; payable/paid sums require reversal/refund tests.
5. **High: gift economics** proposed payout ratio and promotional-unit handling are not approved policy. Pure FIFO function has no durable ledger connection, locking, lot provenance, or immutable policy snapshot.
6. **High: launch scope** mixes separate five-influencer founder partnership, Founder 40 production cohort, creator subscription site, and A-unit gifting. Keep commercial terms and identity boundaries separate.
7. **CI** failed generated-artifact check is a branch-wide release blocker even if creator-specific tests pass.

## Release gates
- [ ] Fix CI generated-artifact drift and complete all required checks.
- [ ] Verify and reconcile pending migrations against production migration ledger; run staging apply and RLS tests before any production apply.
- [ ] Repair ledger idempotency and locking; demonstrate concurrent gift/refund/chargeback invariants.
- [ ] Define and approve immutable gift compensation policy and creator agreement.
- [ ] Implement trusted purchase-lot and payout lifecycle, provider webhook reconciliation and payout holds.
- [ ] Build authenticated, owner-scoped creator cohort analytics endpoint and test cross-tenant denial.
- [ ] Connect consented acquisition sources and actual expenses; validate retention after full observation window.
- [ ] Add spending concentration, spending limits, anti-fraud and responsible-spending controls.
- [ ] Complete adult verification, host moderation, privacy and payments/platform-policy review.
- [ ] Obtain legal/provider sign-off before enabling virtual-gift purchase, transfer, redemption or creator payout.

No live financial endpoints should be enabled as part of this audit.
