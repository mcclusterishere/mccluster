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
