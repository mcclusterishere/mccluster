# Social provider acceptance authority — pending checkpoint

This draft adds private send-attempt authority to the existing social outbox. It does not add a queue, provider, credential, scope or live publication. The first checkpoint contains SQL and its disposable database fixture; Worker admission/retry wiring is still required before this is an activation candidate.

The attempt snapshots the job payload digest, organization, account, provider account ID, credential binding and lease before a provider POST. Uncertain acceptance is held for reconciliation, including legacy no-ID jobs that lack durable evidence of never having been sent. Existing known Instagram containers can be read for recovery. A container reported PUBLISHED is not a published-media receipt and must never be republished to discover its media ID.

A receipt is committed separately from local bookkeeping. Known published-media receipts stay processing in the existing queue until idempotent local finalization records social_posts and content state. Finalization does not require a connected account, token or another provider request. A bookkeeping failure preserves the committed receipt. An account disconnected after the actual publish still permits recording that historical fact.

## Rollout boundary

No production migration or deployment is authorized here. Existing social_growth_engine, social_hardening, credential/lease reconciliation, social_outbox and creator_action_distribution precede pending `social_provider_attempts_v1.sql`. The fixture executes their relevant real SQL (content table/column declarations only for the distribution migration, with unrelated Action Network prerequisites stubbed).

SQL alone cannot stop an older Worker from sending without admission. Any future approved activation must pause publishing and drain in-flight sends, deploy a Worker that fails closed when the attempt RPC is absent, apply the pending migration, verify grants and recovery with publication still paused, then explicitly resume. A missing RPC must be a configuration hold, not five consumed delivery attempts. Historical no-ID jobs require reviewed reconciliation; do not reset their attempt authority to retry.

Read-only production inspection on 2026-10-26 found authenticated has SELECT but no INSERT/UPDATE/DELETE on social_publish_jobs. This work protects privileged retry and send admission; it does not claim browser write access is currently open. The queue aggregate was empty at 20:08:54 UTC, which is not a future migration assumption.

## Evidence and remaining work

`node scripts/test/social-provider-attempts-db.mjs` runs PostgreSQL WASM locally with no provider calls: legacy quarantine, live/expired/null lease checks, immutable job/account binding, unknown acceptance surviving privileged reset/delete, durable receipt replay, bookkeeping rollback, disconnected local finalization, actual provider status preservation, unsupported provider exclusion, and role denial.

Still required: Worker before-send admission and bounded transport, no-secret error handling, owner retry integration, known receipt recovery and missing-schema hold tests, combined regression checks and final-head CI. Automatic domain refresh is the next separate engineering unit; Facebook customer connections/fanout, Stories and music studio/streaming remain later scoped work.
