# Device jobs: the contract between the admin app and our own devices

Status: built and proven in cloud staging on 2026-11-23 (branch `claude/adoring-goldberg-atdih1`, base `main` at
`b51ede03`). Source and tests only. Nothing is deployed; production Supabase, the OVH Core and the Worker are
unchanged. Two SQL files wait in `supabase/pending/` for owner approval. This document is the resume point for the
mission the owner named Equity Fighter: the admin app sends AI jobs to our own devices and shows verifiable results.

## What exists and what this adds

The compute fabric already exists on `main` (`COMPUTE-NODE-PROTOCOL.md`): a device enrols once with the owner's
token, signs every later request with its own Ed25519 key, heartbeats, and pulls work through
`compute_claim_task` (FOR UPDATE SKIP LOCKED) into a 120 s lease it starts, renews, completes or fails. The SQL fence
(`compute_transition_lease_v2`) already rejects a completion from a node that does not hold the lease, from a stale
attempt, with a wrong token, or with a different payload than one already committed; a replayed completion with the
same payload is accepted idempotently. Durable truth is `ops_compute_tasks` and `ops_compute_leases` in Supabase.

What was missing is a client contract above those rows: a way for an admin client to submit, read status, read the
result and hold a receipt it can verify without trusting the transport. This slice adds exactly that, as a derived
view over the existing rows. It adds no queue, no table of its own except the pending attestation table, and no
second backend.

| Layer | File | What it does |
| --- | --- | --- |
| Contract (pure) | `core/src/compute/jobs.mjs` | validation, job view, result view, canonical hashing, receipt, Core signature, node attestation |
| Reads | `core/src/compute/jobs-store.mjs` | leases, task lists, nodes by id, attestation write and read (degrades when the table is not promoted) |
| Orchestration | `core/src/compute/jobs-service.mjs` | submit, get, result, receipt, list, receipt key, completion attestation |
| Gateway routes | `core/src/compute/jobs-routes.mjs`, hook in `gateway.mjs` | `/v1/compute/jobs*`, `/v1/compute/receipt-key` behind `CORE_COMPUTE_ADMIN_TOKEN` |
| Owner tools | `core/src/tools/jobs.mjs`, registered in `control.mjs` | `core.compute.job.submit/get/result/receipt/list`, `core.compute.receipt.key` |
| Edge | `workers/mccluster-mcp/src/mcp.js` | allowlists the tools; pins `org_id` to the house org; owner session required |
| Pending SQL | `supabase/pending/compute_job_attestations_v1.sql` (+ rollback) | `ops_compute_attestations`: the node's completion signature per lease, with the node-reported device facts bound at that completion (`device_facts`) |
| Staging | `scripts/staging/device-jobs/` | real gateway + real agent + repository SQL on PGlite + fixture executor; writes a proof |
| Real-device staging | `scripts/staging/device-jobs/serve.mjs`, `enroll-device.mjs`, `submit-job.mjs`, `real-device-lib.mjs` | the same composition kept running; a real device enrols with the real Ollama adapter; one job verified offline per device |
| Licenses | `core/compute-runtime-licenses.json`, `core/test/runtime-licenses.test.mjs` | exo, Ollama, llama.cpp pinned by commit with hashed LICENSE bytes |

## The contract: `mccluster-job/1`

Two doors, one service layer. The owner's door is the Worker (`POST /v1/core/mcp`, Supabase session plus house-owner
membership, signed to the Core broker) calling the `core.compute.job.*` tools; the admin/ops door is the gateway's
loopback HTTP behind the compute admin token (staging, operators, Prime's client through the TLS ingress once the
owner issues it a token). Both return the same shapes.

### Submit

`POST /v1/compute/jobs` (admin token) or tool `core.compute.job.submit`.

```json
{
  "capability": "ai.chat",
  "implementation": "qwen3.8b.local",
  "input": { "prompt": "say hello", "num_predict": 64 },
  "requirements": { "vision": false },
  "priority": 0,
  "max_attempts": 3,
  "client": { "name": "prime-windows-client", "version": "0.1.0" },
  "allow_offline": false
}
```

Header `Idempotency-Key` (tool argument `idempotency_key`): 1 to 128 printable ASCII characters. A retry with the
same key and the same body returns the same job with `replayed: true` (HTTP 200 instead of 202); the same key with a
different body is `409 IDEMPOTENCY_CONFLICT`. Metadata written to the row is deterministic for this reason: no
timestamps, no fleet snapshot. `org_id` is optional and must equal the gateway's configured `MCCLUSTER_ORG_ID`
(`403 CROSS_ORG_DENIED` otherwise); a gateway without that variable refuses every job route with
`503 ORG_NOT_CONFIGURED` rather than scoping to whatever org the caller names; the Worker overwrites `org_id` with
the house org, and the Core fences the tools against its own `MCCLUSTER_ORG_ID` again. `implementation` pins one advertised implementation; omit it
to let any live implementation of the capability take the task. `requirements` become feature requirements the claim
enforces as a subset of the node's advertised features; routing keys (`provider`, `hosting`, `billing`,
`transport`) are dropped. Input is a JSON object of at most 1 MiB (`413 JOB_INPUT_TOO_LARGE`). The preflight applies
the claim's own tests (capability, pinned implementation, requested features as a subset of the advertised ones,
owned-only admission): when no live node passes them the submit is refused with `503 COMPUTE_NO_LIVE_NODE` unless
`allow_offline: true` queues it anyway (there is no cancel route yet, so an offline-queued job waits for a node). Response: `{ schema, job, replayed, live_nodes }`.

### Status

`GET /v1/compute/jobs/:id?org_id=` or tool `core.compute.job.get`.

```json
{
  "schema": "mccluster-job/1",
  "job_id": "…", "org_id": "…", "capability": "ai.chat", "implementation": "qwen3.8b.local",
  "status": "queued | leased | running | done | failed | canceled", "terminal": false,
  "attempts": 1, "max_attempts": 3, "priority": 0, "run_after": "…", "created_at": "…", "updated_at": "…",
  "input_sha256": "…", "last_error": null, "locked_by_node_id": "node_…",
  "execution": { "lease_id": "…", "node_id": "node_…", "implementation": "…", "attempt": 1, "status": "running", "started_at": "…", "completed_at": null, "expires_at": "…", "progress": {}, "last_error": null },
  "node": { "node_id": "…", "display_name": "…", "key_fingerprint": "…", "platform": "win32", "hardware_mode": "gpu-verified", "gpus": [], "measured_inference": {}, "enrolled_trust": "owned", "last_seen_at": "…" },
  "result_available": false, "receipt_available": false, "metadata": {}
}
```

The states are the task's own; the mapping to the node side is the lease lifecycle in `COMPUTE-NODE-PROTOCOL.md`.
A failed attempt shows as `queued` again with `attempts` incremented and `last_error` set until `max_attempts` is
spent, then `failed`. `canceled` is the fabric-first client's queued-task cancel and the job route below.
`GET /v1/compute/jobs?org_id=&status=queued,running&capability=&limit=` lists jobs newest first. Adding
`idempotency_key=<key>` narrows it to the one job a submission with that key created (the key is unique per
organization), so "did this submit create a job?" is an exact lookup and never a count of a capped page.

`POST /v1/compute/jobs/:id/cancel` (admin token, body `{ org_id, reason? }`) cancels a job that is still `queued` and
returns its view. The update is conditional on `status = 'queued'`, so it cannot race a claim: a job a node already
holds, or one that is terminal, answers `409 JOB_NOT_CANCELABLE` with `job_status`.

### Result

`GET /v1/compute/jobs/:id/result?org_id=` or tool `core.compute.job.result`. `409 JOB_NOT_DONE` (with `job_status`)
until the task is `done`; then `{ schema: "mccluster-job-result/1", job_id, output, output_sha256, completed_at,
lease_id, attempt, node }`. `output` is the capability output exactly as the node committed it (for `ai.chat`: the
adapter's `{ model, content, usage, settings, … }`); `output_sha256` is the SHA-256 of its canonical JSON (keys sorted
recursively), the same value a client computes from the parsed object whatever key order PostgREST returned.

### Receipt: `mccluster-job-receipt/1`

`GET /v1/compute/jobs/:id/receipt?org_id=` or tool `core.compute.job.receipt`, once the job is terminal (`done`,
`failed` or `canceled`; `409 JOB_NOT_TERMINAL` before). A failed or canceled receipt carries `failure` and no output
hash. The receipt is the admin app's evidence and is designed to be verified offline:

```json
{
  "schema": "mccluster-job-receipt/1",
  "issued_at": "…", "issuer": { "kind": "mccluster-core", "instance": "…", "deployment_sha": "…" },
  "job": { "id": "…", "org_id": "…", "capability": "ai.chat", "implementation": "…", "status": "done", "attempts": 1, "max_attempts": 3, "created_at": "…", "completed_at": "…", "client": { "name": "…", "version": "…", "contract": "mccluster-job/1" }, "source": "device-jobs/1" },
  "input_sha256": "…", "output_sha256": "…", "failure": null,
  "execution": { "lease_id": "…", "attempt": 1, "status": "done", "node_id": "node_…", "node_key_fingerprint": "…", "node_display_name": "…",
    "device_facts": { "bound": true, "source": "node-reported-at-completion", "captured_at": "…" },
    "hardware_mode": "gpu-verified", "platform": "win32", "arch": "x64",
    "advertised": { "backend": "ollama", "model": "qwen3-vl:4b", "model_digest": "…", "runtime_version": "…" },
    "hardware_evidence": { "gpu_verified_at": "…", "engine": { "source": "ollama:/api/ps", "model": "…", "digest": "…", "size_vram_bytes": 1, "size_bytes": 1, "processor_gpu_percent": 100, "checked_at": "…" }, "gpus": [{ "vendor": "…", "model": "…", "form": "…", "memory": "…", "compute": "…" }] },
    "model": { "name": "qwen3-vl:4b", "digest": "…", "runtime_version": "…", "reported_by": "node-result" },
    "started_at": "…", "completed_at": "…", "duration_ms": 1234, "result_consistent": true },
  "node_public_key_pem": "-----BEGIN PUBLIC KEY-----…",
  "inference": { "mode": "single-device", "devices": ["node_…"], "group": null },
  "node_attestation": { "schema": "mccluster-completion-attestation/1", "lease_id": "…", "node_id": "node_…", "attempt": 1, "protocol": "mccluster-compute/1", "method": "POST", "path": "/v1/compute/leases/…/complete", "signed_at": "…", "nonce": "…", "body_digest": "…", "signature": "…", "result_sha256": "…", "matches_output": true, "verified": true, "verification_note": null },
  "signed": true,
  "signature": { "alg": "ed25519", "key_id": "…", "value": "…", "covers": "canonical JSON of this receipt with signature set to null and without the signed flag" }
}
```

Verification, in the client:

1. `GET /v1/compute/receipt-key` (or tool `core.compute.receipt.key`) once; cache `public_key_pem` and `key_id`.
2. Require `signed: true`, `signature.alg: "ed25519"` and a `signature.key_id` equal to the cached key id. Remove
   `signature` and `signed`, set `signature: null`, canonicalise (profile below), verify Ed25519 with the Core key.
   `verifyReceipt()` in `core/src/compute/jobs.mjs` is the reference. A receipt from another key says so.
3. Compare `output_sha256` with the hash of the `output` the client read; compare `input_sha256` with the hash of
   what it submitted.
4. The node attestation is the node's own Ed25519 signature over the canonical string of its completion request
   (method, path, node id, timestamp, nonce, body digest), recorded by the gateway after the SQL fence accepted the
   result. `verifyAttestation()` checks it against `node_public_key_pem`. What it proves: this node, holding this
   lease, signed a completion whose body had this digest at this time. What it does not prove on its own: that the
   digested body carried this `result_sha256`; the body is never stored because it carries the lease token, so the
   link between `body_digest` and `result_sha256` is the Core's statement, under the Core signature. The receipt says
   `node_attestation: null` when the table is not promoted or the completion predates it.
5. `inference.mode` is `single-device` for every receipt this slice can issue. One lease is one device. The value
   `shared-inference` is reserved for a future group receipt that carries completion attestations from at least two
   distinct enrolled nodes; the code never reports it from a single lease, whatever a manifest advertises.

6. Device, compute mode and model (additive fields, 2026-11-24; a receipt issued before them simply lacks the keys).
   **They are node-reported evidence, bound at completion.** When the gateway accepts a completion it holds the node
   row it has just authenticated that request against. In that step it captures `mccluster-device-facts/1` from it:
   display name, `platform`, `arch`, `hardware_mode`, `hardware_evidence` (when an engine last proved a model loaded
   with VRAM, `gpu_verified_at`; the node's latest engine observation with its own `checked_at`, model and digest;
   the adapters the node found, bounded to the named fields), `advertised` (the node's manifest entry for the
   implementation that ran: backend, model and, when the enrolment published them, `features.model_digest` and
   `features.runtime_version`) and the model fields of the committed result. The snapshot is stored once, in the
   same insert as the completion attestation (`ops_compute_attestations.device_facts`; first write wins, the table
   grants no update, a replayed completion does not rebind it), and every receipt is built from that stored
   snapshot, never from the node row as it reads later. A node that afterwards reports another mode, is renamed, or
   loses its GPU evidence does not change the receipt of a job that already ran. `issued_at` of a bound receipt is
   the snapshot's `captured_at`, so two reads return byte-identical signed content. `execution.device_facts` says
   whether the facts are bound (`bound`, `source: "node-reported-at-completion"`, `captured_at`).
   When there is no snapshot (a failed or canceled job, a completion recorded before the column existed, or the
   attestation table not promoted) `hardware_mode`, `platform`, `arch`, `hardware_evidence` and `advertised` are
   `null` and `device_facts.bound` is `false`: the Core does not sign the node's read-time inventory in their place,
   and such a receipt is dated by the read. The live job view (`GET /v1/compute/jobs/:id`) still follows the node row;
   it is a status view, not evidence.
   `execution.model` is the model bound in the snapshot; without a snapshot it is read from the committed output,
   which is itself immutable (never from the node row). Either way it is what the node's result said: the model name, and
   `usage.model_digest` and `usage.ollama_version`, which the Ollama adapter reads from the same daemon after the
   generation (`null` when the daemon cannot say, or for an executor that reports neither); `null` for a failed or
   canceled job. All of these are inside the Core signature, and the model fields are inside `output_sha256` and the
   node attestation's `result_sha256`. What they prove: the enrolled node reported this mode, this evidence, this
   manifest entry and this model for this job, at completion, and the Core has not let them change since. What they
   do not prove: they are the node's own readings under the node's own signatures (its heartbeat and its completion),
   not a third party's inspection of the hardware. An operator who controls a device controls what it reports.

The receipt key is `CORE_RECEIPT_SIGNING_KEY` on the Core (an Ed25519 PKCS#8 PEM, single-line with `\n` accepted).
Without it receipts are issued with `signed: false` and `signature: null`, and say so; a malformed key fails loudly.
Generate one with `generateReceiptKey()` from `core/src/compute/jobs.mjs` and keep it out of Git.

### Canonical JSON

Every hash and the receipt signature are over this profile, which a client in any language must reproduce exactly
(it is RFC 8785, JSON Canonicalization Scheme, for well-formed input):

- object members sorted recursively by UTF-16 code unit order of the key; arrays keep their order;
- no whitespace; separators are `,` and `:`;
- strings as ECMAScript `JSON.stringify` emits them: only `"`, `\` and U+0000 to U+001F escaped (`\b \f \n \r \t`,
  else lowercase `\u00XX`), non-ASCII emitted raw as UTF-8, lone surrogates as `\udXXX`;
- numbers in ECMAScript `Number::toString` shortest round-trip form: `1.0` is `1`, `-0` is `0`, `1e21` is `1e+21`,
  no trailing `.0`; integers above 2^53 lose precision the same way on every side because every party parses JSON;
- `null` kept; `undefined` and functions dropped; a `__proto__` key is an ordinary key;
- the signed or hashed bytes are the UTF-8 encoding of that string.

Test vector: `{ "z": 1.0, "a": [true, null, "é\n\"", { "b": 1e21, "c": -0, "d": 0.1 }], "m": { "y": "x", "x": "y" } }`
canonicalises to `{"a":[true,null,"é\n\"",{"b":1e+21,"c":0,"d":0.1}],"m":{"x":"y","y":"x"},"z":1}` and hashes to
`d9a258d84feed22118930490e012edba6c031ee62716e40701d03480177206f8` (`core/test/job-contract.test.mjs` holds the same vector).

### Error codes a client must handle

| Code | HTTP | Meaning |
| --- | --- | --- |
| `UNAUTHORIZED`, `AUTH_NOT_CONFIGURED` | 401, 503 | admin token wrong or not configured on the gateway |
| `CROSS_ORG_DENIED` | 403 | `org_id` is not the gateway's `MCCLUSTER_ORG_ID` |
| `ORG_NOT_CONFIGURED` | 503 | the gateway has no `MCCLUSTER_ORG_ID`; the job routes fail closed |
| `JOB_INVALID`, `ORG_REQUIRED`, `JOB_ID_INVALID`, `BAD_IDEMPOTENCY_KEY` | 400 | malformed submission or id |
| `JOB_INPUT_TOO_LARGE` | 413 | input over 1 MiB |
| `IDEMPOTENCY_CONFLICT` | 409 | same key, different body |
| `COMPUTE_NO_LIVE_NODE` | 503, retryable | nothing live advertises the capability; `allow_offline` queues anyway |
| `JOB_NOT_FOUND` | 404 | unknown id, or another organization's job |
| `JOB_NOT_DONE`, `JOB_NOT_TERMINAL` | 409 | result or receipt asked too early; `job_status` says where it is |
| `JOB_NOT_CANCELABLE` | 409 | cancel asked for a job that is no longer `queued`; `job_status` says where it is |
| `SCHEDULER_STANDBY` | 503, retryable | this Core instance is not the active scheduler; `active_holder` names the live one (`DEVICE-JOBS-SCHEDULER-STANDBY.md`) |

## Staging proof

`scripts/staging/device-jobs/run.mjs` composes the real gateway and the real node agent around a PGlite database
loaded with the repository's compute SQL (replay migration, the two 2026-09-19 hardening migrations, the 2026-10-20
lease authority v2, and the pending attestation table), a PostgREST subset shim, a self-signed TLS ingress and a
fixture executor. The committed proof under `docs/control-plane/evidence/device-jobs-staging-20261123/` is a `--full`
run (11 steps, including the hard-disconnect case and the attestation rollback/re-apply) and names the commit it ran
from, with a `-dirty` marker when the tree had uncommitted changes; the default run without `--full` is 10 steps in
about 40 s. Since 2026-11-24 the harness has one more step, which that committed proof predates (the device facts bound at completion: the node reports a different inventory, replays its completion, and the receipt read afterwards is byte-identical): 11 steps by default, 12 with `--full`. Commands: see `scripts/staging/device-jobs/README.md`.

What the proof covers: admin authorization, enrolment refusal with a wrong token, unknown-key refusal, enrolment and
capability reporting over TLS by the real agent (`hardware_mode` derived as `cpu-only` in the container),
cross-organization refusal, idempotent submission with conflict detection, no-live-node refusal, lease, run,
completion, result and signed receipt verified offline with a verified node attestation (whose `signed_at` is
stored verbatim and survives the PostgREST timestamp rendering the shim imitates), duplicate-result rejection in all
four shapes (replayed nonce `409 REPLAY_DETECTED`, same payload accepted idempotently with the first completion's
attestation kept, different payload `409 LEASE_REJECTED`, late `fail` refused, forged token refused), executor
failure then retry on attempt 2 with the receipt naming attempt 2, hard kill of the agent with server-side lease
expiry and reclaim (`--full`), revocation ending the agent with a `NODE_REVOKED` refusal and removing the capability
from the fabric, and the attestation rollback dropping exactly its table before re-applying.

What the proof does not cover: inference on real hardware (the executor echoes), the Worker edge end to end (unit
tests cover the allowlist and the control tools), multi-session PostgreSQL lock timing (PGlite is one connection),
and the production tunnel.

## Real-device staging mode (2026-11-24)

Beside the fixture harness, and without changing it, three scripts keep the same private composition running so real
devices take real jobs (`scripts/staging/device-jobs/README.md` has the commands):

- `serve.mjs` starts PGlite with the repository SQL, the PostgREST shim, the real gateway and the TLS ingress, all on
  `127.0.0.1`, writes the per-run admin token, enrolment token, receipt key and CA only to `--run-dir`, prints one
  JSON line of URLs and file names, writes `staging.json`, and stays up until it is stopped.
- `enroll-device.mjs` runs on the device: the real `ollama-adapter.mjs` against the local Ollama with one
  implementation mapping, then the real `node-agent.mjs` with a fresh identity in `--state-dir`, advertising `ai.chat`
  with exactly that implementation at concurrency 1. One file for Windows, macOS and Linux.
- `submit-job.mjs` submits one pinned job with an `Idempotency-Key`, waits, reads the result and the receipt, and
  verifies offline with `verifyReceipt()` and `verifyAttestation()`: the Core signature against the published
  receipt key, the node's completion signature against the key in the receipt, that key against the node id and
  against the fingerprint the fabric's own node listing holds, the hashes against what was submitted and read, and
  the idempotent replay. It writes `job.json`, `result.json`, `receipt.json` and `verify.json` (one boolean per check;
  device, compute mode with evidence, implementation, model, digest, runtime version, attempts, lease duration).
  The submitter records itself as `client.name: submit-job-cli`.
  `hardware_proof` is a separate verdict over `hardware_checks`, and it rests on positive evidence rather than on
  the absence of a fixture label: the device facts were bound at completion; the executor is the repository's
  Ollama adapter (the node advertised `backend: ollama` with the model, digest and engine version it enrolled with,
  and the result carries the same `usage.model_digest` and `usage.ollama_version`); an engine reading exists, names
  the same model and digest as `execution.model`, and was taken inside the lease window or within the stated
  `engine_reading_bound_ms` (60 000 ms) of it; and the mode is one that reading supports. Only `gpu-verified` with
  the model in VRAM is GPU proof (`compute_mode.gpu_proof`); a `cpu-only` device whose engine held the model with no
  VRAM is reported as `compute_mode.proven: "cpu"`; `gpu-present-unverified` and `unknown` are proof of neither. A
  stand-in executor fails these whether or not it labels itself. `verify.json` says in `limits` that this is
  node-reported evidence under the node's signature, not third-party attestation.
  `--expect-refusal` is the routing fence: a job pinned to an implementation no enrolled device advertises is refused
  with `503 COMPUTE_NO_LIVE_NODE` and no job row exists for that submit's `Idempotency-Key` (an exact lookup), and a
  job queued past that door for an implementation nobody advertises stays `queued` with zero attempts while the
  live devices keep polling, after which the check cancels its probe.
- Stopping a device asks the node agent through a stop file (`MCCLUSTER_NODE_STOP_FILE`) on every platform: it
  stops claiming and a lease it is running gets the grace period to finish and commit. On Windows a SIGTERM
  terminates the process without running any handler, which would leave that lease to expire.

Run on Prime (Windows, AMD Radeon integrated graphics, Ollama 0.40.17) on 2026-11-24 from this branch: one real
`qwen3-vl.4b.local` job completed on attempt 1 with every check true, `hardware_mode: gpu-verified` on the engine's
own reading (the model fully in VRAM), the model digest and runtime version in the signed receipt; the refusal check
for `qwen3.8b.local` passed with no Mac enrolled. That run predates the completion-bound snapshot and the
`hardware_checks` above: its receipt took the device fields from the node row at read time and its `hardware_proof`
was the earlier, weaker test. It has not been repeated under the current verifier, so it is a real job on a real
device but not yet a `hardware_proof: true` by today's definition. The outputs stay in the run directory on that
machine and are not committed (they name the device). That is one physical device. A Shiloh Mac has not run a job: the ingress listens on
Prime's loopback only, and how a Mac reaches it is an open dependency (see the README), not something this slice
provides.

## The EXO-style control plane: what is ours and what sits beneath

The owner wants an admin-only control plane in the spirit of exo: inventory, capability-aware scheduling across
independent devices, then compatible groups that can split one model.

- **Inventory** exists: `ops_compute_nodes` with the agent's hardware inventory, `hardware_mode` derived by code,
  engine health, measured inference; `GET /v1/compute/nodes` and `/v1/compute/capabilities` on the gateway. The
  owner-facing Devices pane is draft PR #821's work (`codex/owner-ai-workspace-20261122`); this slice does not
  duplicate it.
- **Capability-aware scheduling across independent devices** exists: the claim matches capability, implementation
  and feature subset against each node's stored manifest, honours concurrency and freshness, and the registry ranks
  bindings by `hardware_mode` and measured rate. A job submitted here is scheduled by that path unchanged.
- **Compatible groups that split one model** do not exist in a form this repository can claim. PR #821 prepares pair
  reservations and an exo diagnostic adapter and states that distributed inference and its evidence are unfinished.
  This slice adds the honest reporting rule (`inference.mode`) and the license record so that when a group runtime
  is bound, the receipt can carry evidence from every participating device and only then say `shared-inference`.
- **Runtime adapter boundary**: engines are separate processes behind a loopback executor the node agent calls
  (`executor.type: http`); the adapter contract is the capability input and output schema in the node manifest. exo
  (Apache-2.0), Ollama (MIT) and llama.cpp (MIT) are recorded at pinned commits with hashed LICENSE bytes in
  `core/compute-runtime-licenses.json`; none is copyleft; the adapter stays ours and nothing is linked into Core.
  A group runtime adapter must publish, per participating node, a completion attestation signed by that node's
  enrolled key before any receipt may report shared inference.

## Scheduler: OVH normal, Prime standby

The design, the pending SQL (`supabase/pending/compute_scheduler_lease_v1.sql`), the fenced election module
(`core/src/compute/scheduler-election.mjs`) and its tests are described in `DEVICE-JOBS-SCHEDULER-STANDBY.md`. The
gateway is wired: with `MCCLUSTER_SCHEDULER_ROLE` unset nothing changes (today's single scheduler); with a role the
instance starts the election before it listens, gates job submission and node lease claims with
`503 SCHEDULER_STANDBY` (naming `active_holder`), keeps heartbeats, enrolment and reads open, reports the election in
`/health`, and offers `GET /v1/compute/scheduler` and `POST /v1/compute/scheduler/handover` (admin token) for the
owner's controlled failback. `scripts/staging/device-jobs/scheduler-failover.mjs` runs two real gateways over one
disposable database through one active holder, a frozen primary and takeover to term 2, the fenced return, and a
handover back to term 3; proof under `docs/control-plane/evidence/device-jobs-staging-20261123/scheduler-failover/`.
Production keeps today's single scheduler until the SQL is promoted and a role is set; node traffic still follows
the owner's manual tunnel or DNS switch.

## Current state, verified read-only on 2026-11-23

- **OVH**: the VPS reports `state: rescued`, `netbootMode: rescue`; the last recorded task is `setNetboot`, done,
  2026-11-22 19:23 EST. The production Core is therefore not running its normal boot; nothing in this slice touches
  it, and no claim about production Core behaviour is made here.
- **Prime's branch** `prime/windows-desktop-compute-client` and commit `a9a73111` are not on the remote (284 heads
  listed; no `prime/*`). The reported Radeon Vulkan run (qwen3-vl:4b at about 7.3 tok/s) and the persistent-worker
  admission failure (846 MiB free against a 3.7 GiB floor) are Prime's reports, unverified from the cloud.
- **Draft PR #821** (head `e996acf2`, 80 files) owns the Control Room owner AI workspace, the Mac installer, owner
  enrolment SQL, pair reservations and the exo diagnostic adapter. This slice shares only `gateway.mjs`,
  `control.mjs` and the Worker allowlist with it, each as small additive blocks, and must be reconciled with it at
  review: PR #821's `compute_claim_task_v4` and owner enrolment are compatible with this contract because the
  contract reads task and lease rows and does not change the claim.
- **Supabase**: the MCP connector failed to connect in this session (proxy tunnel error), so the live schema and
  the two production nodes were not re-read today; the 2026-11-17 reading in `DEVICE-NODES-AND-OWNER-GPU.md` stands.

## Reconciliation with draft PR #821 (`codex/owner-ai-workspace-20261122`, head `e996acf2`)

Read against this branch on 2026-11-23. The two changes share three files and are mechanically mergeable:

- `core/src/compute/gateway.mjs`: #821 adds a scoped-enrolment branch inside `/v1/compute/enroll`, a
  `/v1/compute/pair-cleanup` route after `authenticateNode`, and heartbeat constraints; this slice adds one import
  pair and one block immediately before `authenticateNode`, plus the attestation call inside the `complete`
  branch. Adjacent, not overlapping. #821's `CORE_OWNER_AI_WORKSPACE_ENABLED=1` closes shared-token enrolment
  unless `CORE_COMPUTE_ALLOW_LEGACY_ENROLL=1`; the staging harness here enrols with the shared token, so once #821
  lands the harness must either set that variable or enrol through #821's scoped credential. Off by default today.
- `core/src/tools/control.mjs`: both add imports and a dispatch line at the top of `callControlTool`; #821 also
  gates its tools behind the workspace flag. The job tools here are not behind that flag because they add no new
  schema requirement (the attestation table only improves the receipt).
- `workers/mccluster-mcp/src/mcp.js`: both extend the allowlist; #821's `toolName.startsWith('core.compute.')`
  pin is broader than this slice's and covers `core.compute.job.*` and `core.compute.receipt.key`; keep #821's
  condition at merge.
- SQL: #821's `compute_claim_task_v4` keeps the four-argument `compute_claim_task` wrapper the gateway calls, and
  its owner enrolment writes the same `ops_compute_nodes` row shape; this contract reads task and lease rows and
  changes neither, so a job submitted here is scheduled by #821's claim unchanged. Its pair reservation and the exo
  diagnostic adapter are where a future group receipt would get its per-device attestations.

## Integration notes for Prime's Windows client

The client needs four calls and one key: submit with an `Idempotency-Key` it generates and keeps until it has a
terminal status; poll status (750 ms to 2 s is fine; the agent polls the claim at 1 s); read the result when
`result_available`; read the receipt and verify it with the cached receipt key. The device side is unchanged: the
same `core/src/compute/node-agent.mjs`, the same manifest, the same Ollama adapter; the receipt then reports the
real node's `hardware_mode` and platform, and the status and result views carry the node's measured inference
rate in their `node` summary. When Prime's branch appears on the remote, compare its
contract with this file; the owner decides which door Prime's client uses (the Worker as the owner's own session, or
the gateway with an admin token issued for the device).

## Pending approval (owner)

1. Promote `supabase/pending/compute_job_attestations_v1.sql` (receipts carry node attestations only after this).
2. Set `CORE_RECEIPT_SIGNING_KEY` on the Core (receipts are unsigned and say so until then).
3. Promote the Core (routes and tools) and the Worker (allowlist) through the normal deploy paths once OVH leaves
   rescue and is verified healthy.
4. Review `DEVICE-JOBS-SCHEDULER-STANDBY.md` and its pending SQL separately; it is not required for 1 to 3.

## The exact remaining blocker to one real Prime → OVH → Mac → app result

The OVH Core is in rescue mode, so there is no running production scheduler for a real device to enrol against or
claim from; until the owner restores it and promotes this slice (steps 1 to 3 above), the only place a real Mac or
the Windows client can exercise the contract is this staging harness. Behind that: Prime's client commit is not on
the remote, so its contract cannot be compared yet, and the Mac installer path is in draft PR #821, unmerged.
