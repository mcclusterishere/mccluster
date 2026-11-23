# Device jobs: cloud staging proof

Run: 2026-11-23T03:09:57.441Z to 2026-11-23T03:13:07.469Z. Result: **PASS** (11/11 steps). Commit 2b0b0baf112965b04cb6b91a16431c99d7dababc, Node v22.23.5.

All identities, tokens, keys and model output are synthetic fixtures. No real device, no canonical Supabase, no OVH Core, no model inference.

## Processes

- core/src/compute/gateway.mjs
- core/src/compute/node-agent.mjs
- scripts/staging/device-jobs/fixture-executor.mjs
- scripts/staging/device-jobs/pglite-postgrest.mjs
- TLS loopback ingress

## Schema loaded from the repository

- supabase/replay_migrations/20260912071000_compute_node_protocol.sql
- supabase/migrations/20260919020830_compute_gateway_hardening_live_reconcile.sql
- supabase/migrations/20260919021007_compute_capability_concurrency_live_reconcile.sql
- supabase/migrations/20261020210718_compute_lease_authority_v2.sql
- supabase/pending/compute_job_attestations_v1.sql

## Steps

| Step | Result | ms | Detail |
| --- | --- | --- | --- |
| preflight: gateway health and receipt key | pass | 6 | `{"protocol":"mccluster-compute/1","receipt_key_id":"f341d7c17bf79514aa36ec11961618c8","schema_files":["supabase/replay_migrations/20260912071000_compute_node_protocol.sql","supabase/migrations/20260919020830_compute_gateway_hardening_live_reconcile.sql","supabase/migrations/20260919021007_compute_capability_concurrency_live_reconcile.sql","supabase/migrations/20261020210718_compute_lease_authority` |
| authorization: admin routes refuse a missing or wrong token; enrolment refuses a wrong token; an unknown key is refused | pass | 51 | `{"admin_without_token":401,"admin_wrong_token":401,"enroll_wrong_token":401,"unknown_node":"UNKNOWN_NODE"}` |
| enrolment and capability reporting: the real node agent enrols over TLS and advertises ai.chat/fixture.echo.local | pass | 532 | `{"node_id":"node_82f59e87072ff86aa4c93d0e96527b5c","hardware_mode":"cpu-only","platform":"linux","agent_version":"0.4.0","capabilities":["ai.chat/fixture.echo.local"]}` |
| cross-organization submission is refused | pass | 3 | `{"status":403,"code":"CROSS_ORG_DENIED"}` |
| submit: idempotent per key, conflict on a different body under the same key, refusal when no live node serves the capability | pass | 49 | `{"job_id":"0d0d8c81-e083-4d59-b12e-7a1491b47191","live_nodes":1,"replayed_status":200,"conflict_code":"IDEMPOTENCY_CONFLICT","offline_code":"COMPUTE_NO_LIVE_NODE"}` |
| status, result and signed receipt: the fixture node leases, runs and completes the job; the receipt verifies offline | pass | 837 | `{"attempts":1,"duration_ms":19,"output_sha256":"1c6496f70964633b7a168ca044457d2ead58345f626f27f89d83dda8a3a0fcc4","receipt_key_id":"f341d7c17bf79514aa36ec11961618c8","attestation_verified":true}` |
| duplicate results are rejected: same payload replays idempotently, a different payload is refused, a replayed nonce is refused, a late failure cannot undo a commit | pass | 211 | `{"job_id":"cff29216-9908-4659-9bfb-a70cffdc021b","nonce_replay":"REPLAY_DETECTED","same_payload":200,"different_payload":"LEASE_REJECTED","late_fail":409,"wrong_token":409,"first_nonce_kept":true}` |
| disconnect and retry: an injected executor failure fails the lease, the task requeues with backoff and the second attempt completes | pass | 31876 | `{"job_id":"a24f065d-2cfe-4d89-acab-673e0c8c1bdb","requeued_after_first_failure":"queued","first_error":"fixture executor failure (injected, attempt 1)","backoff_run_after":"2026-11-23T03:10:32.743Z","final_attempts":2}` |
| hard disconnect (--full): the agent is killed mid-task, the lease expires server-side, a restarted agent reclaims and completes | pass | 152078 | `{"job_id":"f3d69da5-c712-45b1-a413-cdc587ba5c9c","killed_while":"running","lease_expired_at":"2026-11-23T03:12:34.211Z","final_attempts":2,"duration_ms":16}` |
| revocation: a revoked node is refused on its next signed request and the fabric no longer offers its capability | pass | 1525 | `{"agent_exited":true,"refusal_seen_by_agent":true,"submit_after_revoke":"COMPUTE_NO_LIVE_NODE"}` |
| pending SQL hygiene: the attestation rollback drops exactly its table and the file re-applies cleanly | pass | 13 | `{"rollback_reapplied":true,"lease_rows_untouched":6}` |

## Sample receipt (job 1)

```json
{
  "schema": "mccluster-job-receipt/1",
  "issued_at": "2026-11-23T03:10:01.761Z",
  "issuer": {
    "kind": "mccluster-core",
    "instance": "staging-gateway",
    "deployment_sha": null
  },
  "job": {
    "id": "0d0d8c81-e083-4d59-b12e-7a1491b47191",
    "org_id": "00000000-0000-4000-8000-00000000c0de",
    "capability": "ai.chat",
    "implementation": "fixture.echo.local",
    "status": "done",
    "attempts": 1,
    "max_attempts": 3,
    "created_at": "2026-11-23T03:10:00.888Z",
    "completed_at": "2026-11-23T03:10:01.570Z",
    "client": {
      "name": "device-jobs-staging",
      "version": "1",
      "contract": "mccluster-job/1"
    },
    "source": "device-jobs/1"
  },
  "input_sha256": "dd971b014e1382f2791eac53453680da76957b4f0ce8b3e8f440184543e0fcba",
  "output_sha256": "1c6496f70964633b7a168ca044457d2ead58345f626f27f89d83dda8a3a0fcc4",
  "failure": null,
  "execution": {
    "lease_id": "b9ac1a58-285c-4f39-94a4-52f77eddf9d5",
    "attempt": 1,
    "status": "done",
    "node_id": "node_82f59e87072ff86aa4c93d0e96527b5c",
    "node_key_fingerprint": "82f59e87072ff86aa4c93d0e96527b5c519aa738aea9e9655b15fc2f185aa09d",
    "node_display_name": "staging-fixture-node",
    "hardware_mode": "cpu-only",
    "platform": "linux",
    "started_at": "2026-11-23T03:10:01.551Z",
    "completed_at": "2026-11-23T03:10:01.570Z",
    "duration_ms": 19,
    "result_consistent": true
  },
  "node_public_key_pem": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAz0+s5UEy4f84gWcF1alc2PGrq9IQhKSBZFyfHXI8Peg=\n-----END PUBLIC KEY-----\n",
  "inference": {
    "mode": "single-device",
    "devices": [
      "node_82f59e87072ff86aa4c93d0e96527b5c"
    ],
    "group": null
  },
  "node_attestation": {
    "schema": "mccluster-completion-attestation/1",
    "lease_id": "b9ac1a58-285c-4f39-94a4-52f77eddf9d5",
    "node_id": "node_82f59e87072ff86aa4c93d0e96527b5c",
    "attempt": 1,
    "protocol": "mccluster-compute/1",
    "method": "POST",
    "path": "/v1/compute/leases/b9ac1a58-285c-4f39-94a4-52f77eddf9d5/complete",
    "signed_at": "2026-11-23T03:10:01.557Z",
    "nonce": "1433e73b-d86d-40a3-9466-b9d9958e9283",
    "body_digest": "j0I2u_YPfuFB3wjj1bBGYhCzkviSxLS5cFtAgfzyxkI",
    "signature": "qwJhzdvgsT4n6vZ1b_9n7z4XUVnBI2uQHy0_MCwtUr9a9lBCO37TnASfz5fs-SjN6PT_akgvTZhzrNVHkCNODA",
    "result_sha256": "1c6496f70964633b7a168ca044457d2ead58345f626f27f89d83dda8a3a0fcc4",
    "matches_output": true,
    "verified": true,
    "verification_note": null
  },
  "signature": {
    "alg": "ed25519",
    "key_id": "f341d7c17bf79514aa36ec11961618c8",
    "value": "TYwsNWWPYErE0kHaMyLVAFcIVwr7gIEwvgEKgDIeYx4VkVymgseGlRtA9JIuqeUHUhnRaGXEChlCEqycE9w9Cw",
    "covers": "canonical JSON of this receipt with signature set to null and without the signed flag"
  },
  "signed": true
}
```
