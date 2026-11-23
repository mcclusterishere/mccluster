# Proof Mode: what the desktop proves, and what it refuses to claim

Equity Fighter on Prime is the control desk; the OVH Core coordinates; devices execute. Proof Mode is the
part of the desktop that shows, for every job, exactly which device ran it, which model build, which
attempt, how long, with which inputs it was allowed to read, and whether anyone can check that later
without trusting the transport. It reuses the shapes of draft PRs #821 (node-pinned routes, device
receipts in message metadata) and #823 (`mccluster-job/1`, `mccluster-job-receipt/1`, canonical JSON,
`inference.mode`) where the desktop has the facts.

## Devices: Auto or Pick

| Choice | What runs | Honest status shown |
| --- | --- | --- |
| Auto | the node adapter on this device if it is ready for the model, else Ollama directly, else unavailable | `routing.requested = auto`, `routing.chosen`, `routing.reason` (why it fell through) |
| Pick: this device via node adapter | only `127.0.0.1:4790` `/execute` | fails with the reason if the adapter is down or lacks the implementation; no silent fallback |
| Pick: this device via Ollama | only `127.0.0.1:11434/api/chat` | same |
| Pick: remote worker, verified group | the owner's signed-in site surface (Core stores and streams), or the Core job contract when the owner issues the desktop a token | shown as unavailable with the reason while the Core is unreachable; never queued for silent later submission |

Capability-aware routing on the device: a chat job goes only to an executor whose implementation map
names the selected model and reports it installed (the adapter's `/health` implementations), mirroring
the Core claim (`capability`, `implementation`, feature subset).

## Bounded delegation and retry

A local job has `max_attempts` (default 2). An attempt retries only on a retryable fault (executor
timeout, 5xx, connection failure); a model answering with no text, an unsafe path, or a refused
implementation is final. Every attempt is recorded: number, executor path, start, end, error. The
receipt's `attempts` list and `attempt` number are the exact history, not a summary.

## Receipt: `mccluster-desktop-receipt/2`

Fields the desktop can state as fact: device inventory in the compute protocol's shape, `hardware_mode`
with its evidence rule (a model loaded in GPU memory), the executor path, adapter implementation and model
digest, Ollama version, `attempt` and `attempts[]`, `started_at`, `finished_at`, `duration_ms`, the
result's SHA-256, `context[]` (what the job was allowed to read, scoped, hashed, timestamped),
`sources[]` (public data with observation times: the live revision from `api.mccluster.org/v1/health`,
the Ollama version, the model digest), `inference.mode`, `hosted_inference_used: false`.

The receipt is signed by this device's key: ECDSA P-256 over SHA-256 of the canonical JSON (keys sorted,
no whitespace, numbers in shortest form, the same profile #823 documents) with `signature` set to null and
the `signed` flag removed. The key is created once, DPAPI-protected for the Windows user, never copied.
`McCluster.exe --verify-receipt <file>` verifies a receipt offline from the receipt alone. The algorithm
differs from the Core's Ed25519 on purpose: .NET Framework 4.8 has no Ed25519, and a Core receipt is
verified by the Core's own reference verifier, not re-implemented here.

## Permission-scoped context references

- `folder`: a sample folder the owner named; read-only; only the manifest hash and counts enter the
  receipt; no file content leaves the device.
- `site-route`: an approved first-party HTTPS route (`mccluster.org`, `matthew.mccluster.org`,
  `humanuprise.com` only); bounded visible text is quoted to the model as evidence, never as
  instructions; hash and `observed_at` recorded.
- `public-data`: the `sources[]` above.

Nothing else is readable by a job. A context route outside the first-party set is refused.

## `inference.mode`

- `single-device`: every job this desktop can run today. One lease, one device.
- `two-rank-exo (untested)`: the EXO rank-receipt probe (`--exo-rank-probe`) saw exactly two members in
  a loopback EXO runtime's `/state`. This is topology, not inference.
- `shared-inference`: reserved. The desktop never emits it. It would require two distinct rank receipts
  with fresh heartbeats and a generation receipt naming both ranks, produced on the Macs by Dot's
  physical preflight, and verified by the Core's attestation path.

## Mixed Radeon (Vulkan) and Apple Metal: scope only

Prime's Radeon runs `qwen3-vl:4b` fully in GPU memory through Ollama's Vulkan backend (verified). The two
Macs would run `qwen3:8b` on Metal (Dot's proof, pending). Splitting one model across Vulkan and Metal
ranks is not supported by any runtime pinned in this repository; EXO's audited release targets Apple
MLX. The desktop therefore shows a mixed group as "experimental, not tested" and never routes to it. No
experimental RPC or runtime is installed by anything in this branch. What would change that: a runtime
whose release notes name heterogeneous backends, a two-device generation with per-rank receipts on real
hardware, and the Core's attestation path accepting them.
