# Device jobs: cloud staging proof

Run: 2026-11-23T02:25:05.829Z to 2026-11-23T02:28:15.474Z. Result: **PASS** (10/10 steps). Commit 404673b8395be3b4b4ee05ed6edaa0a3e8ebdd9c, Node v22.23.5.

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
| preflight: gateway health and receipt key | pass | 7 | `{"protocol":"mccluster-compute/1","receipt_key_id":"733ef456ba29aaae5ec6065b61d4c7a6","schema_files":["supabase/replay_migrations/20260912071000_compute_node_protocol.sql","supabase/migrations/20260919020830_compute_gateway_hardening_live_reconcile.sql","supabase/migrations/20260919021007_compute_capability_concurrency_live_reconcile.sql","supabase/migrations/20261020210718_compute_lease_authority` |
| authorization: admin routes refuse a missing or wrong token; enrolment refuses a wrong token; an unknown key is refused | pass | 36 | `{"admin_without_token":401,"admin_wrong_token":401,"enroll_wrong_token":401,"unknown_node":"UNKNOWN_NODE"}` |
| enrolment and capability reporting: the real node agent enrols over TLS and advertises ai.chat/fixture.echo.local | pass | 526 | `{"node_id":"node_d56e19d58861ea7c71fdf323cc708545","hardware_mode":"cpu-only","platform":"linux","agent_version":"0.4.0","capabilities":["ai.chat/fixture.echo.local"]}` |
| cross-organization submission is refused | pass | 3 | `{"status":403,"code":"CROSS_ORG_DENIED"}` |
| submit: idempotent per key, conflict on a different body under the same key, refusal when no live node serves the capability | pass | 55 | `{"job_id":"48211509-e98a-47a8-9d69-44dbba3c29ae","live_nodes":1,"replayed_status":200,"conflict_code":"IDEMPOTENCY_CONFLICT","offline_code":"COMPUTE_NO_LIVE_NODE"}` |
| status, result and signed receipt: the fixture node leases, runs and completes the job; the receipt verifies offline | pass | 819 | `{"attempts":1,"duration_ms":20,"output_sha256":"5cddd1b175e11fc45e645f76247332b27792c7eb547a4cc75e1c5d5b6858ce1e","receipt_key_id":"733ef456ba29aaae5ec6065b61d4c7a6","attestation_verified":true}` |
| duplicate results are rejected: same payload replays idempotently, a different payload is refused, a replayed nonce is refused, a late failure cannot undo a commit | pass | 251 | `{"job_id":"919aa948-2178-425a-b37c-83ca24ae7bc7","nonce_replay":"REPLAY_DETECTED","same_payload":200,"different_payload":"LEASE_REJECTED","late_fail":409,"wrong_token":409}` |
| disconnect and retry: an injected executor failure fails the lease, the task requeues with backoff and the second attempt completes | pass | 31881 | `{"job_id":"0b2151fa-92bb-4759-a95c-a85372d5f00a","requeued_after_first_failure":"queued","first_error":"fixture executor failure (injected, attempt 1)","backoff_run_after":"2026-11-23T02:25:41.181Z","final_attempts":2}` |
| hard disconnect (--full): the agent is killed mid-task, the lease expires server-side, a restarted agent reclaims and completes | pass | 152714 | `{"job_id":"31eba160-288f-4f8b-9699-18d6b5dba404","killed_while":"running","lease_expired_at":"2026-11-23T02:27:42.890Z","final_attempts":2,"duration_ms":16}` |
| revocation: a revoked node is refused on its next signed request and the fabric no longer offers its capability | pass | 513 | `{"agent_exited":true,"refusal_seen_by_agent":true,"submit_after_revoke":"COMPUTE_NO_LIVE_NODE"}` |

## Sample receipt (job 1)

```json
{
  "schema": "mccluster-job-receipt/1",
  "issued_at": "2026-11-23T02:25:10.110Z",
  "issuer": {
    "kind": "mccluster-core",
    "instance": "staging-gateway",
    "deployment_sha": null
  },
  "job": {
    "id": "48211509-e98a-47a8-9d69-44dbba3c29ae",
    "org_id": "00000000-0000-4000-8000-00000000c0de",
    "capability": "ai.chat",
    "implementation": "fixture.echo.local",
    "status": "done",
    "attempts": 1,
    "max_attempts": 3,
    "created_at": "2026-11-23T02:25:09.251Z",
    "completed_at": "2026-11-23T02:25:10.041Z",
    "client": {
      "name": "device-jobs-staging",
      "version": "1",
      "contract": "mccluster-job/1"
    },
    "source": "device-jobs/1"
  },
  "input_sha256": "dd971b014e1382f2791eac53453680da76957b4f0ce8b3e8f440184543e0fcba",
  "output_sha256": "5cddd1b175e11fc45e645f76247332b27792c7eb547a4cc75e1c5d5b6858ce1e",
  "failure": null,
  "execution": {
    "lease_id": "1d69b38b-86fa-4c34-b9b3-1c84f178b0ac",
    "attempt": 1,
    "status": "done",
    "node_id": "node_d56e19d58861ea7c71fdf323cc708545",
    "node_key_fingerprint": "d56e19d58861ea7c71fdf323cc708545dea19de320570022d48374fb40d3b070",
    "node_display_name": "staging-fixture-node",
    "hardware_mode": "cpu-only",
    "platform": "linux",
    "started_at": "2026-11-23T02:25:10.021Z",
    "completed_at": "2026-11-23T02:25:10.041Z",
    "duration_ms": 20,
    "result_consistent": true
  },
  "node_public_key_pem": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAQkupeqRX4BjtEnNZ/GgA2ttZ6c2+asxwyDZWSmYv4eI=\n-----END PUBLIC KEY-----\n",
  "inference": {
    "mode": "single-device",
    "devices": [
      "node_d56e19d58861ea7c71fdf323cc708545"
    ],
    "group": null
  },
  "node_attestation": {
    "schema": "mccluster-completion-attestation/1",
    "lease_id": "1d69b38b-86fa-4c34-b9b3-1c84f178b0ac",
    "node_id": "node_d56e19d58861ea7c71fdf323cc708545",
    "attempt": 1,
    "protocol": "mccluster-compute/1",
    "method": "POST",
    "path": "/v1/compute/leases/1d69b38b-86fa-4c34-b9b3-1c84f178b0ac/complete",
    "signed_at": "2026-11-23T02:25:10.029Z",
    "nonce": "353c7422-c6b8-4769-bebc-3561e336465d",
    "body_digest": "jZCl4f_ZTfZn06lBOuhxvoNTVZpcyXKTMgHnriQknrg",
    "signature": "Ib8i-Ilhh4kmHWMK8SGSjSHJDL-hwXflOH7HoZbVBsSuPmOlmuvsVYPpWzhp27yc_EdfOfKtrxFuKI56gE01BQ",
    "result_sha256": "5cddd1b175e11fc45e645f76247332b27792c7eb547a4cc75e1c5d5b6858ce1e",
    "matches_output": true,
    "verified": true,
    "verification_note": null
  },
  "signature": {
    "alg": "ed25519",
    "key_id": "733ef456ba29aaae5ec6065b61d4c7a6",
    "value": "ydRuKDX5zFI7_m2fr4_r7SB4BQcyUCegisakweYRY5kJ6AZvMhH-f8w8vBFbmzXBaVMMN5fFjUnRz7FHHCRtCA",
    "covers": "canonical JSON of this receipt with signature set to null and without the signed flag"
  },
  "signed": true
}
```
