# Proof Mode: what the desktop proves, and what it refuses to claim

Equity Fighter on Prime is the control desk; the OVH Core coordinates; devices execute. Proof Mode is the
part of the desktop that shows, for every job, exactly which device ran it, which model build, which
attempt, how long, with which inputs it was allowed to read, and how a holder can check that later. It
reuses the shapes of draft PRs #821 (node-pinned routes, device receipts in message metadata) and #823
(`mccluster-job/1`, `mccluster-job-receipt/1`, canonical JSON, `inference.mode`) where the desktop has the
facts.

## Devices on this computer: Auto or Pick

| Choice | What runs | Honest status shown |
| --- | --- | --- |
| Auto | the node adapter on this device if it reports the selected model installed, else Ollama directly, else unavailable | `routing.requested = auto`, `routing.chosen`, `routing.reason`, `routing.failover = true` when it fell through |
| Pick: this device via node adapter | only the loopback adapter's `/execute` (default `127.0.0.1:4790`, port from `MCCLUSTER_OLLAMA_ADAPTER_PORT`) | fails with the reason if the adapter is down or lacks the model; no silent fallback |
| Pick: this device via Ollama | only loopback Ollama's `/api/chat` (default `127.0.0.1:11434`; `OLLAMA_HOST` is honoured only when it names a loopback host) | same |

Not on this device: "one remote worker" and "verified group" are targets of the OVH Core. The desktop
shows them with their availability and, when the Core is reachable, opens the owner's signed-in site
surface with the draft on the clipboard; it submits nothing natively and holds no Core token. The group
target is never selectable from the desktop: it needs two verified members and a pair benchmark on the
owner surface. Auto's fall-through from the adapter to Ollama (`routing.failover = true`) and the adapter
refusal for a model it does not serve are covered by code, not by a recorded run on Prime: every recorded
Auto run found the adapter ready.

Capability-aware routing on the device: a chat job goes only to an executor whose implementation map
names the selected model and reports it installed (the adapter's `/health` implementations), the same
`capability` and `implementation` match the Core claim makes. Feature-subset requirements (for example
vision) are not checked by the desktop.

## Bounded delegation and retry

A local job has `max_attempts` (default 2, at most 5). An attempt retries only on a transport fault or a
status that means "try again" (executor unreachable, timeout, 5xx, 408, 429). An executor's other
status codes, a model answering with no text, an unsafe path, a refused implementation or a refused
context route are final. Cancelling by the owner records the attempt as `canceled`; a timeout anywhere
(executor, Ollama, context route) is recorded as the retryable failure it is, never as a cancellation.
Every attempt is recorded: number, executor path, start, end, outcome, error. The receipt's `attempts`
list and `attempt` number are the exact history, not a summary.

## Receipt: `mccluster-desktop-receipt/2`

Fields the desktop can state as fact: `job_id` and `kind`, device inventory in the compute protocol's
shape, `hardware_mode` with its evidence rule (a model loaded in GPU memory), the executor path, adapter
implementation and model digest, Ollama version, `attempt` and `attempts[]`, `started_at`, `finished_at`,
`duration_ms`, `output_sha256` of the result when the job is done (otherwise `failure`), `input_sha256`,
`context[]` (what this attempt was allowed to read, scoped, hashed, timestamped), `sources[]` (public data
with observation times: the live revision from `api.mccluster.org/v1/health`, the Ollama version, the
model digest; written for every job kind), `inference.mode`, `hosted_inference_used: false`.

The receipt is signed with this device's key: ECDSA P-256 over SHA-256 of the canonical JSON (keys sorted,
no whitespace, ECMAScript number and string forms, the profile #823 documents and the tests pin with its
vector) with `signature` set to null and the `signed` flag removed. The key is created once, kept
DPAPI-protected for the Windows user with the product's entropy, never copied. A job whose receipt cannot be
signed is recorded as `failed` with the reason, its result kept beside it for inspection: an unsigned receipt
is not a proof. A key file that cannot be read is refused with instructions, never silently replaced, so a
device's key id stays stable.

What `McCluster.exe --verify-receipt <job.json>` proves, and reports as separate booleans:

- `signature_consistent`: the receipt is unmodified since the holder of `signature.key_id` signed it.
  This alone does not prove origin: a forgery re-signed with a fresh key is consistent too.
- `key_trusted`: `signature.key_id` equals a key id the verifier obtained outside the receipt. By default
  that is this device's own key; another machine pins the id from `McCluster.exe --device-key`
  and passes `--trusted-key-id`. `--any-key` skips this check and says so.
- `output_matches`, `input_matches`, `job_id_matches`: the job file's result and input hash to what the
  receipt commits to, and the receipt names this job.

`verified` is true when the signature is consistent, the key is trusted, and no hash check that could be
performed failed. A check that could not be performed is reported as `null`, not as a pass in disguise: a
bare receipt without its job file has no result or input to hash, and a failed job's receipt carries no
`output_sha256`. The algorithm differs from the Core's Ed25519 on purpose:
.NET Framework 4.8 has no Ed25519, and a Core receipt is verified by the Core's own reference verifier,
not re-implemented here.

## Metering: `receipt.metering`

Every chat receipt carries one `metering` block in the shape the compute contribution contract gives the
Core receipt, so a local receipt and a Core receipt meter the same way. That contract is
`docs/control-plane/COMPUTE-CONTRIBUTION-LEDGER.md` on branch `prime/contribution-ledger`. **It is not in
this tree**: until that branch is merged, the path does not exist in a checkout of this branch, and the key
list below (which the desktop tests pin) can only be compared with the contract by reading that branch.

```
prompt_eval_count, prompt_eval_cached_count, eval_count, total_duration_ns, load_duration_ns,
prompt_eval_duration_ns, eval_duration_ns, model, model_digest, runtime_version, node_id,
node_key_fingerprint, hardware_mode, attempt, duration_ms
```

- The seven counters are Ollama's raw counters, recorded separately and never summed into one number; a
  counter the runtime did not report is `null` (Ollama's `/api/chat` does not return
  `prompt_eval_cached_count` today, so the ollama-direct path records it as `null`, not 0); durations are
  nanoseconds. Derived rates (`tokens_per_second`) never enter the block.
- `model` is the name as served (the response's `model`).
- `model_digest` is never part of the completion itself: Ollama's `/api/chat` answer carries no digest, so on
  both paths it is a second call to the same daemon made after the generation, **not atomic with the
  completion**. An `ollama pull` of the same tag that lands between the generation and that read would put
  the new digest in the receipt; nothing detects that. Exactly which call supplied it:
  - adapter path: the adapter's `/execute` response, `usage.model_digest`. The adapter reads `GET /api/tags`
    on its own daemon right after the generation, while the execution still holds the adapter's single slot,
    and matches the model that served the run by name. The desktop prefers this value. An older adapter
    that returns no `usage.model_digest` leaves the digest the desktop read from the adapter's `GET /health`
    (`implementations[].digest`) **before** the run; that one is not bound to the execution at all.
    `adapter_model_digest` is always that earlier `/health` value, kept beside it for comparison.
  - ollama-direct path: the desktop's own `GET /api/tags` on the Ollama daemon, called after `/api/chat`
    returned and matched by model name (`null` when the model is no longer listed).
- `runtime_version`: on the adapter path `usage.ollama_version` from the same `/execute` response (the
  adapter's `GET /api/version` after the generation) when present; otherwise, and always on the
  ollama-direct path, the desktop's `GET /api/version` probe from before the run.
- `receipt.metering_evidence` (beside the block, not inside it, so the block keeps the contract's fifteen
  keys) records `model_digest_source` and `runtime_version_source`: one sentence each naming the call that
  supplied the value, or `null` when there is no value.
- `node_id` is the node id the agent last reported in `<state root>\last-heartbeat.json` (`null` on a device
  that is not a node; `identity.json` is never read). `node_key_fingerprint` is the key id of this device's
  receipt-signing key, the same id as `signature.key_id`; it is the desktop's P-256 key, not the node's
  Ed25519 key. `hardware_mode` is the value after the run. `attempt` is the attempt number the block was
  written on; `duration_ms` is that attempt's wall clock, set when the attempt ends, whether it succeeded or
  failed (a chat whose model returned no answer text is a failed attempt with a metering block and a
  `duration_ms`); `null` only while the attempt runs.

Both execution paths write the identical shape. The desktop tests pin the key list to a copy of the
contract's field list written into the test (the contract file itself is on `prime/contribution-ledger`,
not here, so the test cannot read it).
The desktop computes no work units: `units_micro` and the credit arithmetic are the Core's, server-side.

## Contribute: this device as a compute node

The Compute panel has a **Contribute** section after the enrolled-worker status. It shows, in the
contract's words, what runs on the device, which workload class it accepts (`public` for a community
device), the limits, that no account credential and no tool permission beyond the executor contract is ever
sent, and that Pause and Revoke are one click away. The device state it shows is read from the node's state
root and nothing else: installed (`node.config.json`), enrolled (`identity.json` present, never read),
paused (the `paused` marker), `limits.json` (or that it is absent or unreadable), the last heartbeat file
(`last-heartbeat.json`: time, node id, `claim_gate`, `thermal_supported`), `revoked.json`, and accepted
work as the count of this device's local `done` receipts plus the node's `accepted-work.json` when one
exists (nothing writes it today; the Core settles acceptance, so the panel says so instead of inventing a
number).

Every action is a run of the doctor, shown verbatim (stdout and stderr) in a read-only box:
`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <doctor> <explicit switches>
-StateRoot <state root>`. The doctor is found through `MCCLUSTER_DOCTOR_PATH`, the checkout
`node.config.json` names, the checkout above the executable, or a copy beside it; without one the
buttons stay disabled and the panel says so. The desktop never calls the Core and never writes the state
root. **Enable contribution** opens a modal (masked credential box, the organization id when the device is
not installed yet, the limits that will apply, an explicit consent box); on OK it runs `-Install` (only when
not installed, from a checkout), then `-Limits` with the chosen limits, then `-Enroll`, passing the
credential only in the child process environment variable `MCCLUSTER_NODE_ENROLL_TOKEN` (the doctor then
writes no `enroll.env`); the box is cleared afterwards and the credential is never written to a file, a log,
a receipt or the clipboard (the tests grep a throwaway root for a sentinel after a fake run). **Pause** /
**Resume**, **Revoke** (a confirmation that names the node id, then the doctor prints the id to revoke on
the Core), **Apply limits** and **Open limits** (reveals `limits.json` in Explorer) are the other buttons.

Limits: idle only, AC power only, max concurrency 1 to 4 (1 in the pilot), CPU busy ceiling 10 to 100 %,
battery floor 0 to 100 %, thermal limit in degrees C. The thermal limit is best effort: when the node's
heartbeat says `thermal_supported: false` the panel says "unsupported on this device", never "off". The
panel is WinForms, so hard rule 14 applies the WinForms way: every label wraps at 380 px and no control is
wider, so nothing overflows the 420 px panel.

## Permission-scoped context references

- `folder` (inventory jobs): the folder the owner named; read-only; the receipt records the full local
  path, the file count, the byte count and the manifest hash; no file content leaves the device. Written
  once per job.
- `site-route` (chat jobs): an approved first-party HTTPS route (`mccluster.org`, `matthew.mccluster.org`,
  `humanuprise.com` only), fetched without following redirects (a 3xx is refused), text types only,
  body bounded to 4 MiB, visible text quoted to the model as evidence and never as instructions; at most
  8 routes and 24,000 evidence characters per job; hash, content type, status and `observed_at` recorded;
  a non-success response is never quoted. These entries are rebuilt on every attempt and each names its
  attempt.

Sourced public data is separate from context: `sources[]` (not `context[]`) holds the live revision,
the Ollama version and the model digest with observation times. Nothing else is readable by a job.

## Inference mode

A job receipt's `inference.mode` is always `single-device` today: one lease, one device; the desktop has
no other mode to run. The EXO probe writes a different document, `exo-rank-receipt/1`, whose
`inference_mode` is:

- `single-device`: the loopback runtime answered and lists one member.
- `two-rank-exo (untested)`: the runtime's `/state` lists exactly two members. This is topology, not
  inference.
- `unknown`: the probe could not read the runtime; it says so rather than guessing.
- `shared-inference`: reserved. Never emitted by the desktop. It would require two distinct rank receipts
  with fresh heartbeats and a generation receipt naming both ranks, produced on the Macs by Dot's
  physical preflight, and verified by the Core's attestation path.

## Mixed Radeon (Vulkan) and Apple Metal: scope only

Prime's Radeon runs `qwen3-vl:4b` fully in GPU memory through Ollama's Vulkan backend (verified). The two
Macs would run `qwen3:8b` on Metal (Dot's proof, pending). Splitting one model across Vulkan and Metal
ranks is not supported by any runtime pinned in this repository; EXO's audited release targets Apple
MLX. The desktop therefore offers no mixed group at all: its only group target is the Core's verified
group, disabled with its reason, and nothing routes to a mixed set. No experimental RPC or runtime is
installed by anything in this branch. What would change that: a runtime
whose release notes name heterogeneous backends, a two-device generation with per-rank receipts on real
hardware, and the Core's attestation path accepting them.

## Parity audit

`--parity-audit` renders each first-party route inside the shell at a fixed viewport and records the
final URL, HTTP status, title, `no_horizontal_overflow_at_viewport`, console errors, blocked navigations
and a screenshot, plus the live revision observed before and after the run. The reference capture from a
plain browser is the operator's, compared with `--image-diff`. The audit proves what the shell rendered
at that revision and viewport; it does not sign in and does not prove behaviour behind sign-in.
