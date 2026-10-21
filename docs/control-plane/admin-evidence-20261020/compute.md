# W06 compute lease authority — review increment, 20 October 2026

## Current source and measured state

This increment starts at `e9d8604988496783fa25f4c450bd49fec69ba476`. Draft PR #557 (`f0c20e2043e60604aa434f479f04af053bad8e40`) was inspected, not merged or modified. Its local expiry was extended from the requested duration after a reply, and its signed request path remained unbounded. Those concepts are replaced by server-confirmed receipt validation and a separately testable lifecycle using the existing node protocol.

The integration lead's read-only production inventory at 19:33:58 UTC reports one online Linux x64 node, 8 CPU, 24,598,257,664 bytes installed memory, 174,586,089,472 bytes free disk, no GPU reported, Node v22.22.1, agent 0.2.0, and healthy `ai.chat` via Ollama `qwen3:8b`, with node and implementation concurrency one. No Mac is enrolled. This is a heartbeat snapshot, not a benchmark, memory guarantee, model-weight provenance check or deployed-source attestation. The promoted OVH ref observed by the integration lead was `e553e2dc0ae312866ab00372e46cb1575b93e9c8`; promotion and the running revision must be checked separately.

## Implemented behavior

- Existing `ops_compute_tasks`/`ops_compute_leases` remain durable truth. There is no new queue, auth service, model scheduler, public port or paid provider.
- New node agent 0.3.0 requires matching lease, task, organization, node, attempt, status, server time and expiry in claim/start/renewal receipts.
- Local expiry is based on the monotonic time before dispatch plus the **server-confirmed** remaining duration, minus a one-second conservative margin. All network round-trip time is subtracted. A late, replayed or mismatched receipt cannot revive expired local authority. Clock jumps/suspend discrepancies also invalidate it.
- Every gateway request, including signed requests and response-body reads, has a default ten-second timeout (bounded to 1–30 seconds). Redirects are rejected; gateway responses are capped at 2 MiB and executor responses at 1,500,000 bytes, leaving space for the completion envelope. Executor requests remain loopback-only and abort when authority is lost or the node shuts down.
- Only one renewal is in flight. Completion waits for it and rechecks authority. Ambiguous completion never reports a competing failure. The database accepts an exact completion replay without a second write and rejects a changed replay.
- Pending SQL adds `ops_compute_leases.attempt`. Existing active leases may be reconciled to the current task attempt; historical unknown attempts stay null. No raw data or old migration is rewritten.
- Transactional lease transitions lock/check the node, lease and current task before writing. They reject revoked/quarantined/offline nodes, foreign organizations, wrong tokens/nodes, canceled tasks, expired attempts and stale attempts. Draining nodes may finish existing work. Expiry is checked after lock acquisition using `clock_timestamp()`.
- Existing start/heartbeat JSON RPCs gain authority fields; complete/fail keep their Boolean signatures. An internal invoker helper is denied to PUBLIC, anon, authenticated and service_role. The existing restricted wrapper functions remain the only gateway entry points.
- Apple display discovery reports Metal when supplied by `system_profiler`; unified system memory is never represented as dedicated VRAM. Failed/unsupported discovery stays unknown. No GPU energy or utilization measurement is invented.

The one-second margin, 250 ms watchdog cadence, ten-second gateway timeout and bounded executor timeout are implementation safeguards, not funding requirements or measured performance objectives.

## Files and delta

| Area | Delta |
| --- | --- |
| `core/src/compute/node-agent.mjs` | Integrates authority lifecycle, cancellation and request timeout; version 0.3.0 |
| `core/src/compute/lease-runtime.mjs` | Receipt/identity/clock validation and bounded lifecycle |
| `core/src/compute/request-json.mjs` | Timeout through response body and redirect rejection |
| `core/src/compute/hardware.mjs` | Apple inventory parser, no pooled/unified-memory mislabeling |
| `core/compute-node.env.example` | Optional request-timeout setting |
| `supabase/pending/20261020193442_compute_lease_authority_v2.sql` | Attempt field; enriched claim/start/renew receipts; transactional revocation/cancellation/current-attempt fence; idempotent completion |
| Tests | `core/test/compute-lease-runtime.test.mjs`, Apple fixture in `node-agent-runtime.test.mjs`, `supabase/tests/compute_lease_authority.behaviour.sql`, `scripts/compute-lease-sql-check.mjs` |

There are no new public routes or browser privileges. Ed25519 exact-body signing, durable nonce replay checks and existing capability policy remain in place.

## Verification

Run from the repository root:

```sh
node --test core/test/compute-lease-runtime.test.mjs core/test/compute-node-protocol.test.mjs core/test/node-agent-runtime.test.mjs core/test/compute-gateway-security.test.mjs core/test/compute-tool-contract.test.mjs
```

Observed: **42 tests passed**. Twenty new lifecycle/transport tests cover delayed responses, hung renewal, receipt replay, node/org/task/attempt/lease mismatches, suspend/wall-clock discontinuity, successful commit, 401/403/409 revocation, shutdown, ambiguous commit a real loopback HTTP response whose body stalls, and declared/chunked response byte limits. Apple parsing uses a synthetic system-profiler fixture; it was not executed on an actual Mac.

SQL reproduction (disposable WASM PostgreSQL; pinned PGlite 0.5.10 installed outside this repo):

```sh
PGLITE_MODULE_PATH=/absolute/path/to/node_modules/@electric-sql/pglite/dist/index.js node scripts/compute-lease-sql-check.mjs
```

Observed: existing protocol schema + capability-concurrency migration + new pending migration loaded unchanged using PGlite's real pgcrypto extension; behavioral assertions passed for claim/start authority, one lease per task, cross-tenant/node/token rejection, revocation, cancellation, expiry, reassignment, attempt mismatch, immutable exact replay, durable nonce replay and RPC grants. These tests validate SQL state behavior, not real multi-connection locking. Ed25519 tampering/clock tests use Node's real crypto primitives.

## Promotion and rollback

1. Review this code and pending SQL alongside current production migration provenance. Run the behavioral fixture on a disposable native PostgreSQL/Supabase environment with real pgcrypto, plus concurrent claim/revoke/complete tests before promotion. Do not run fixture SQL in production.
2. Preserve a reviewed pre-change deployment revision and record migration output. Drain active compute work through existing operations, then apply the reviewed pending migration through the normal migration gate. Verify all restricted grants and existing crypto search path. Do not edit the migration ledger by hand.
3. Verify enriched receipts in a supervised synthetic task. **Install the migration before upgrading nodes.** New nodes fail closed against old receipts; deploying them early would consume leases without doing work.
4. Promote the reviewed Core source through `deploy/ovh-production`; verify actual runner/gateway/node revisions and heartbeat rather than assuming the branch alone attests deployment. Enroll no new hardware automatically.
5. Replay the same supervised task and lost-response/expiry scenarios, inspect one canonical result and its attempt, then restore normal claim admission.

Application rollback: drain the new agent and promote the last approved node/Core source. Old clients ignore the additive receipt fields. Leave the additive field and safer SQL fences in place unless a reviewed database rollback is necessary. Dropping the field while new nodes run makes them reject authority. Exact rollback source and live migration state remain operator decisions. Nothing in this increment was merged, applied to production, promoted or enrolled.

## Optional Mac setup after the promotion gate

The Mac is a personal browser/Control terminal immediately; inference enrollment is optional. OVH remains the always-on coordinator. Closing Control or sleeping the Mac does not erase durable accepted jobs; expired work returns through the existing retry policy and can exhaust its declared attempts.

1. Install an approved, supported Node runtime and local inference runtime; record exact versions. Keep both inference and its existing adapter bound to loopback. Do not copy Supabase service-role, Core admin, Stripe or Cloudflare credentials to the Mac.
2. Record actual CPU, unified memory and disk using the Mac's System Information. From the repository, inspect `discoverHardware()` and retain the snapshot as an operator receipt. This release's Apple parser is fixture-tested only.
3. Select one small model using the actual workload and memory available; record its immutable model/weight revision or digest, weight license, quantization and runtime version before downloading/enabling it. Existing `qwen3:8b` is a floating runtime tag, **not** a verified pinned model release. This increment does not certify that model's installed bytes or promise any model fits the prospective Mac.
4. Configure the existing Ollama adapter on `127.0.0.1:4790`, pointing at local Ollama `127.0.0.1:11434`. Configure a local capability manifest for `ai.chat` and the tested implementation, `max_leases: 1`, implementation `max_concurrency: 1`, and HTTP executor `/execute` with `/health`. Use the selected model's measured requirements; do not copy the Hunyuan GPU example as an AI-chat requirement.
5. Set `MCCLUSTER_COMPUTE_URL` to the **verified HTTPS reverse-ingress address for the existing OVH gateway**, `MCCLUSTER_ORG_ID` to the authorized organization, `MCCLUSTER_NODE_STATE_DIR` to a private user-owned directory, and `MCCLUSTER_NODE_MANIFEST` to the local JSON. Do not assume the example hostname is configured. Set a short-lived node enrollment token issued by the operator only for initial enrollment; remove it and rotate it afterward. The persistent identity file is private (`0600`).
6. Start `node core/src/compute/ollama-adapter.mjs`, verify local health, then run `node core/src/compute/node-agent.mjs` in a supervised terminal with those variables. Submit only an authorized synthetic test task via the existing Core capability/compute path. Capture task/lease/attempt, model provenance, elapsed time, result and failures. No private browser/home-folder access is needed.
7. Test sleep, wake, network loss and SIGTERM against a synthetic long job. Verify the old attempt cannot commit, stale output is discarded, and only current server authority commits one result. Test node revocation. Do not enable unattended login/launchd startup until these device-specific tests pass; no launchd service has been installed by this work.
8. To remove the worker, stop it, revoke its node identity centrally, then delete its private local identity and configuration. The retained durable job/result history follows existing platform retention rules.

## Remaining W06 evidence and scope

This completes a reviewable reliability increment, not all W06 acceptance. Remaining: native database race testing; real Mac sleep/thermal/admission tests; immutable model/license/quantization registry and installed-byte verification; measured rules/single-model/orchestrated quality/latency/cost comparison; durable per-model token/cost budgets across the full agent plan; supervised deployed end-to-end task receipt; provider/ingress policy attestation. No energy, local inference speed, operating cost or independent model benchmark was measured. Local execution has no new API fee here, but existing hosting, hardware and energy costs are not zero and remain unmeasured.
