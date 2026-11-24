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
surface with the draft on the clipboard; it submits nothing natively to production and holds no production
Core token (the one native submission path is "Core (staging)", below, and it refuses production). The group
target is never selectable from the desktop: it needs two verified members and a pair benchmark on the
owner surface. Auto's fall-through from the adapter to Ollama (`routing.failover = true`) and the adapter
refusal for a model it does not serve are covered by code, not by a recorded run on Prime: every recorded
Auto run found the adapter ready.

Capability-aware routing on the device: a chat job goes only to an executor whose implementation map
names the selected model and reports it installed (the adapter's `/health` implementations), the same
`capability` and `implementation` match the Core claim makes. Feature-subset requirements (for example
vision) are not checked by the desktop.

## Core (staging): the desktop submits one job through a staging Core

Owner only, staging only. It is the device-job contract of #823 (`mccluster-job/1`,
`mccluster-job-result/1`, `mccluster-job-receipt/1`; `docs/control-plane/DEVICE-JOBS-CONTRACT.md` on that
branch, not in this tree) driven by the desktop itself: submit, bounded status poll, result, receipt,
receipt key. Code: `src/CoreJobs.cs`. No production submit exists; "One remote worker (through the OVH
Core)" is unchanged.

**The profile.** `%LOCALAPPDATA%\McClusterDesktop\staging\profile.json`, written by the owner or by the
staging serve script, never committed:

| Field | Meaning |
| --- | --- |
| `core_url` | the staging Core's origin (scheme, host, port; no path, query or credentials) |
| `staging` | must be the boolean `true` for any host that is not loopback |
| `ca_cert_path` | the one CA (PEM or DER) trusted for that host; required whenever `core_url` is https |
| `admin_token_file` | a file holding the compute admin token; the token itself is never in the profile |
| `org_id` | the organization id (uuid) the staging Core is configured for |

Relative paths resolve beside the profile. Rules, each a recorded refusal:

- `mccluster.org`, `humanuprise.com` and every host under either are refused outright
  (`PRODUCTION_HOST_REFUSED`), by suffix and not by a list of names: `compute.mccluster.org`,
  `core.mccluster.org`, `api.mccluster.org`, `matthew.mccluster.org` and any subdomain nobody listed, such
  as `staging.mccluster.org`. So is any `supabase.co` host. No flag, scheme, port or CA changes that. The
  match is on whole labels: `notmccluster.org` is not production, and the next rule decides it.
- Any other host that is not loopback (`127.0.0.1`, `localhost`, `::1`) without `staging: true` is refused
  (`NOT_STAGING_REFUSED`); with it, plain http is refused (`PLAINTEXT_REFUSED`).
- https without `ca_cert_path` is refused (`CA_REQUIRED`), on loopback too. Plain http is accepted on
  loopback only.

**TLS.** Each request carries its own certificate validation callback. It accepts a certificate only when
the request is for the profile's host, the certificate names that host, its chain has no fault other than
an untrusted root, and that root is byte-for-byte the profile's CA (a self-signed ingress certificate that
is itself the pinned certificate qualifies). The system trust store does not decide in either direction:
a certificate from a public CA is refused unless it chains to the profile's CA. The chain is built from the
leaf, the certificates the server presented in the handshake and the pinned CA, and from nothing fetched:
.NET Framework 4.8 cannot switch off AIA retrieval on `X509Chain`, so the decision calls crypt32's
`CertGetCertificateChain` itself with `CERT_CHAIN_DISABLE_AIA` and `CERT_CHAIN_CACHE_ONLY_URL_RETRIEVAL`
and with no revocation flag (the equivalent of `X509RevocationMode.NoCheck`; a private staging CA
publishes no revocation data). A leaf whose intermediate was not presented is refused even when its AIA
extension says where to download it; the tests hold a loopback listener at that URL and it is never asked.
One limit: before it calls the callback, the framework's TLS layer builds a chain of its own with its
defaults, and that build is outside this code; its result is not used for the verdict. No global callback
is set and no certificate is installed. No redirect is followed and no proxy is used.

**The token.** Read from `admin_token_file` for each request, sent as the `Authorization: Bearer` header
of that request, and held nowhere else: not in the output document, not in `logs\desktop.log`, not on a
command line. Anything the Core sends back has the token's text replaced with `[redacted]` before it is
kept. This is the one place the desktop touches a control-plane secret, and only a staging one.

**The job.** `POST /v1/compute/jobs` with `capability: ai.chat`, the chosen `implementation`, `input`
`{ prompt, think: false, temperature: 0.2, num_predict: 1536 }`, `max_attempts: 3` and one generated
`Idempotency-Key`. Only a transport fault is retried (at most 3 requests, the same key, so a retry cannot
create a second job). An HTTP answer that is not 2xx is recorded, not retried, and classified: it is a
**refusal** only when it is a JSON object carrying one of the Core's named codes for "no eligible device"
or "capability refused" (`COMPUTE_NO_LIVE_NODE`, `NO_CAPABILITY_BINDING`, `CAPABILITY_NOT_ACTIVE`); `401`
and `403` are `auth_failed` whatever code they carry; any other `5xx` (500, 502, 504, a 503 without one of
those codes, a gateway's HTML page) is `core_fault`; anything else (400, 409, 413, ...) is
`submit_rejected`.
Status is polled once a second up to `--timeout-seconds` (default 300, 5 to 3600); at the bound the run is
recorded as `timeout` with no result, receipt or device claimed. There is no cancel route in the contract:
a job the desktop stops waiting for stays on the Core, and the document says so.

**Headless.**

```powershell
McCluster.exe --core-submit --prompt "<text>" --implementation <id> [--profile <path>] [--timeout-seconds n] [--expect-refusal] --out <file>
```

The document (`mccluster-desktop-core-submit/1`) has `state`, `core_url_host` (host and port only),
`submitted` (capability, implementation, input, its hash, the idempotency key), `job`, `result`,
`receipt`, `receipt_key` (as the Core returned them), `refusal`, `submit_failure` (`kind`, `http_status`,
`code`, `error`, for a submission answered with something that is neither acceptance nor a refusal),
`error`, and:

- `device`: `node_id`, `node_display_name`, `platform`, `hardware_mode`, `node_key_fingerprint` from
  `receipt.execution` (the Core's statement about the node that held the completing lease);
  `implementation` from `receipt.job`; `model`, `model_digest`, `runtime_version` from the result's
  `output` as the node committed it (`output.model`, `output.usage.model_digest`,
  `output.usage.ollama_version`; `null` when the node's executor did not report one); `sources` says this
  per field. `output_marked_fixture` is true when the output carries `fixture: true` (the staging fixture
  executor): that is never hardware proof and the panel says so.
- `attempts`: `submit_requests`, `status_polls`, `poll_errors`, and the Core's `job_attempts`,
  `max_attempts` and `lease_attempt`.
- `timings`: the desktop's clock (`submitted_at`, `submit_ms`, `wait_ms`, `terminal_at`, `total_ms`, each
  status change with its offset) and the Core's lease clock (`core_started_at`, `core_completed_at`,
  `core_duration_ms`).
- `verification`: see below.

`state` and exit code: `done` (0) only when the job is done and every check the desktop can make was made
and passed; `refused_as_expected` (0) when `--expect-refusal` was passed and a refusal was recorded;
everything else exits 1: `refused`, `auth_failed`, `core_fault`, `submit_rejected`,
`accepted_but_refusal_expected` (the job exists on the Core and was not polled), `done_unverified`,
`job_failed` / `job_canceled`, `timeout`, `canceled_by_owner`, `error`. A refusal records `stage` and
`refused_by`: `core` at `submit` (with the HTTP status and one of the named codes above), or
`desktop-profile-check` at `profile` (the rules above, before any request). `--expect-refusal` exits 0 for
either; read `refused_by` to tell them apart. It exits 1 for `auth_failed`, `core_fault` and
`submit_rejected`: a wrong token, a 5xx or a gateway error is not the refusal that was expected, and the
document says so. A missing profile, an unreadable or empty token file and an unreachable Core are errors,
never refusals. The document carries no absolute local path: a missing profile is named by its file name
and a placeholder for its folder, and any error text is scrubbed of this device's folders.

**What is verified, and what is not.** .NET Framework 4.8 has no Ed25519, so the desktop does not verify
the Core's receipt signature and does not claim to: `verification.receipt_signature_checked` is always
`false`, with `receipt_signature_reason` and `receipt_signature_verify_command`, the exact command that
runs the repository's verifier (`verifyReceipt` in `core/src/compute/jobs.mjs`) on the output file from
the root of a checkout that carries #823. The command names the output file by its file name inside a
placeholder (`"<path to core-submit.json>"`), never by where it was written; put the path in:

```
node --input-type=module -e "import fs from 'node:fs'; import { verifyReceipt } from './core/src/compute/jobs.mjs'; const o = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); const v = verifyReceipt(o.receipt, o.receipt_key ? o.receipt_key.public_key_pem : null); console.log(JSON.stringify(v)); process.exit(v.ok ? 0 : 1);" "<the file --core-submit wrote>"
```

That command takes the public key from `receipt_key`, which the desktop read from the same Core over the
same channel; a verifier that needs an independent trust anchor pins the key id separately. What the
desktop does check, each a separate field: `receipt_schema_ok` (`mccluster-job-receipt/1`),
`job_id_matches`, `output_hash_matches` (the SHA-256 of the canonical JSON of the result's `output`, by
the existing `Canonical` class, against `receipt.output_sha256`; `null` when the receipt carries no output
hash), `result_hash_field_matches` (the same against the result's own `output_sha256`),
`input_hash_matches` (what was submitted against `receipt.input_sha256`), `receipt_names_device`
(`execution.node_id` is present), `receipt_signature_present` (the signature block has a value) and
`receipt_key_present` (the Core published a receipt key with a key id and a public key).
`desktop_checks_passed` is true only when every one of these holds for a `done` receipt: the schema, the
job id and the device; `signed` is `true` with a signature value and a key id; the receipt key is present
and its key id is the signature's; the input hash and the output hash are both present in the receipt and
both match. A check that could not be made (no input hash, no output hash, no signature, no key) is a
failed check, not a pass by absence. `desktop_checks_failed` lists the reasons; when it is not empty a job
the Core reports done is recorded as `done_unverified` with those reasons in `error`, exit 1.
`receipt_claims_signed`, `receipt_signature_alg`, `receipt_signature_key_id`,
`receipt_key_id_equals_published_key_id` (a string comparison) and `node_attestation_as_reported_by_core`
(`core_reports_verified`, `matches_output`, `node_id`, and `checked_by_desktop: false`) are the Core's own
statements copied and labelled, not checks. The desktop's own `verification` block has no field named
`verified`; the embedded Core receipt keeps the Core's own `node_attestation.verified`, which is the Core's
statement and not a desktop check. Until
the command above is run, the receipt's origin rests on the channel (loopback, or TLS pinned to the
profile's CA), not on a signature this app verified.

**A real run (2026-11-24).** On this device the desktop app submitted one `ai.chat` job through a loopback
staging Core (#823's gateway over https on `127.0.0.1`, its self-signed certificate pinned by the profile), the job ran on this
device's Radeon (`hardware_mode: gpu-verified`, `qwen3-vl:4b`, node `prime-windows`), the document came
back `done`, and the repository verifier returned `{"ok":true}` on it. It was repeated the same day with
the build that carries the rules above (state `done`, the verifier `{"ok":true}` again; an unadvertised
implementation recorded `refused_as_expected` with `COMPUTE_NO_LIVE_NODE`; a wrong token under
`--expect-refusal` recorded `auth_failed`, exit 1). That is one device acting as both submitter and
worker: no second device and no Mac has run a job this way yet, and nothing was sent to production.

**Panel.** A "Core (staging)" option appears under "Run on" only while the profile file exists. It has an
implementation box (free text; the last value used is kept in `staging\last-implementation.txt` and
offered again) and uses the draft as the prompt. It runs the same client with a 300 s bound, shows the
whole document in the receipt box, saves it under `core-staging\`, and writes above it: which physical
device ran it (display name, node id shortened, platform), model, digest and implementation, compute mode
(`hardware_mode`), attempts, timing, and the verification sentence, which always says the Core signature
was not checked here. The line is never green. The wait on a staging submission and the local job runner
each have their own cancellation ("Stop waiting" never cancels a local job, and "Cancel" never stops a
staging wait), and while either is in flight the "Run on" options are disabled, so the button always acts
on the target that is busy.

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
