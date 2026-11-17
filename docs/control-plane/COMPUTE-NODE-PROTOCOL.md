# McCluster Compute Node Protocol

Status: v1 implementation branch, 2026-09-12. Device-node slice N1, 2026-11-17: Windows inventory and per-GPU
form/memory fields, `hardware_mode` derived by code, engine evidence, the measured-inference sidecar, heartbeat
`live_gpu_nodes`, claim `yield_seconds`, capability ranking with fallback (source and tests; the OVH promotion and
the pending claim SQL are separate, owner-gated steps). The owner's Windows runbook is `WINDOWS-NODE.md`.

## Goal

Turn owned or self-hosted GPU/accelerator machines into a private McCluster compute fabric without giving those machines control-plane credentials and without making each worker a publicly reachable server.

A node advertises **capabilities**, not products. Examples:

- `model3d.generate` implemented by `hunyuan3d.2-1.local`;
- `video.generate` implemented by `ltx.local`;
- `image.generate` implemented by an owned image workflow;
- later audio, vision, simulation, game-build, rendering, and other accelerator-backed capabilities.

The protocol is McCluster-owned. It is not a claim of compatibility with Kubernetes, Nomad, Ray, or an IETF HTTP-signature profile. Those systems inform the design patterns—resource advertisement, heartbeats, durable leases, bounded concurrency—but `mccluster-compute/1` is our own application protocol.

## Topology

```text
McCluster products / agents
        |
Capability Registry
        |
Core Tool Bus
        |
ops_compute_tasks (Supabase)
        |
Core compute gateway 127.0.0.1:4788
        |
TLS reverse tunnel / authenticated ingress
        |
        +------------------------------+
        |                              |
GPU node A                         GPU node B
outbound HTTPS only                outbound HTTPS only
Ed25519 identity                   Ed25519 identity
local executor                     local executor
(ComfyUI later)                    (other runtime)
```

The Core gateway MUST bind to loopback. Port 4788 is not an Internet-facing service. Remote nodes reach it through an HTTPS reverse tunnel/proxy. A node never needs inbound firewall exposure.

## Trust model

### Core owns

- canonical organizations and policy;
- capability definitions and approval state;
- durable task/lease state;
- scheduler decisions;
- audit/provenance;
- service-role access to Supabase;
- enrollment/admin secrets.

### Compute node owns

- its Ed25519 private key;
- accelerator drivers;
- model weights;
- local executors/workflows;
- node-local configuration;
- generated temporary working data.

### A compute node MUST NOT receive

- the Supabase service-role key;
- GitHub write credentials owned by Core;
- Twilio credentials;
- Cloudflare administrative credentials;
- another node's private key;
- arbitrary shell commands from the scheduler.

The task payload is a typed capability input. The node agent dispatches it only to a node-owner-configured loopback executor.

## Protocol identifier

`mccluster-compute/1`

Current default timings:

- heartbeat: 30 seconds;
- lease: 120 seconds;
- signed-request clock window: 5 minutes;
- offline scheduling threshold: 3 minutes without a node heartbeat.

These values are configurable within server-side safety bounds.

## Enrollment

Enrollment is the only bootstrap operation that uses a shared bearer secret.

1. The node generates an Ed25519 key pair locally.
2. The private key is written `0600` and never leaves the machine.
3. The node POSTs its public key, inventory, capability manifest, organization, labels, and agent version to `/v1/compute/enroll` with the one-time/rotatable enrollment token.
4. Core derives the node ID from the SHA-256 fingerprint of the public key.
5. Core stores the public key and manifest in `ops_compute_nodes`.
6. The enrollment token can be removed from that node and rotated after enrollment.
7. Every subsequent request uses the node key, not the bootstrap secret.

A previously enrolled public key cannot move to another organization through re-enrollment. Revoked identities cannot enroll themselves again.

## Node identity

Node IDs are deterministic:

```text
node_<first 32 hex characters of SHA256(SPKI public key)>
```

The full key fingerprint is also persisted and unique.

## Signed request profile

Every post-enrollment node request contains:

```text
x-mccluster-compute-protocol: mccluster-compute/1
x-mccluster-node-id: node_...
x-mccluster-timestamp: <ISO-8601>
x-mccluster-nonce: <unique nonce>
x-mccluster-content-sha256: <base64url SHA-256 of exact body bytes>
x-mccluster-signature: <base64url Ed25519 signature>
```

The signed canonical string is:

```text
MCCLUSTER-COMPUTE-V1
<METHOD>
<PATH>
<NODE_ID>
<TIMESTAMP>
<NONCE>
<BODY_DIGEST>
```

Core verifies the stored public key, node ID, timestamp window, exact body digest, and Ed25519 signature. Accepted nonces are persisted in `ops_compute_nonces`, so replay protection survives Core restarts and works across multiple future gateway replicas.

TLS is still mandatory. Application signatures complement transport encryption; they do not replace it.

## Capability advertisement

A node manifest contains one or more entries such as:

```json
{
  "capability": "model3d.generate",
  "implementation": "hunyuan3d.2-1.local",
  "backend": "comfyui",
  "model": "Hunyuan3D 2.1",
  "version": "2.1",
  "features": {
    "text_to_3d": true,
    "image_to_3d": true,
    "pbr": true
  },
  "input_schema": { "type": "object" },
  "output_schema": { "type": "object" },
  "max_concurrency": 1,
  "min_vram_bytes": 20000000000
}
```

Core normalizes every node-advertised implementation to:

```text
hosting = self-hosted
billing = compute
```

The local manifest may additionally contain an `executor` object, but that executor address/configuration is stripped from the public registration. Core learns what the node can do, not how to reach the node's private local services.

Unknown capability IDs may appear in raw node inventory but do not automatically extend the Capability Registry policy catalog. A capability still has to exist in the McCluster-owned catalog, and its lifecycle must be `active`, before normal products/agents can resolve it.

## Hardware inventory

The node agent (0.4.0) reports:

- hostname, OS/platform and architecture;
- CPU count;
- total memory;
- free disk of the state directory's drive (`C:\` on a Windows node, `/` on POSIX);
- GPUs, each with `vendor`, `model`, `uuid`, `vram_bytes`, `driver`, `compute`, and since slice N1 three optional
  fields that `validateInventory` keeps (every other unknown GPU field is still stripped): `form`
  (`integrated` | `discrete` | `unknown`), `memory` (`dedicated` | `shared` | `unknown`) and `vram_source`
  (`nvidia-smi` | `registry` | `cim` | `sysfs` | `none`). Shared memory is stated as a field, never hidden:
  an APU's `vram_bytes` is what the platform reports (on Windows the registry's UMA carve-out), not the memory
  inference uses;
- runtime: Node version, kernel, `agent_version`, `agent_platform`, `memory_architecture`, `engine_health`, and
  since slice N1 `hardware_mode`, `gpu_probe`, `gpu_evidence`, `gpu_verified_at`, `measured_inference` and
  `measured_inference_by_model` (below);
- current load/lease count.

The probes, by platform:

- **NVIDIA**: `nvidia-smi` on PATH, then on Windows `%ProgramFiles%\NVIDIA Corporation\NVSMI\nvidia-smi.exe` and
  `%SystemRoot%\System32\nvidia-smi.exe`; first success wins. Entries carry `form discrete`, `memory dedicated`,
  `vram_source nvidia-smi`.
- **Windows** (`win32` only): `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command
  "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterCompatibility,DriverVersion,PNPDeviceID,
  AdapterRAM,VideoProcessor,Status | ConvertTo-Json -Compress"` for the adapters, and `reg.exe query
  HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318} /s` for the display class
  registry, both with a 5 s timeout. Controllers whose PNP id is not `PCI\…` or whose name says Basic Display,
  Basic Render, Remote Display, Virtual, VMware, Hyper-V, Parsec, DisplayLink or RDP are dropped into
  `gpu_probe.ignored_controllers`. Each remaining controller is matched to the registry subkey with the longest
  `MatchingDeviceId` that is a case-insensitive prefix of its `PNPDeviceID`, else to the one whose `DriverDesc`
  equals its name; among equal matches (Windows keeps the `00NN` subkeys of earlier driver installs with the
  same `MatchingDeviceId`) the subkey that carries a `qwMemorySize` wins, then the highest subkey number (the
  latest install), so a stale subkey never shadows the live one. `vram_bytes` is the subkey's
  `HardwareInformation.qwMemorySize` (a REG_QWORD, `vram_source registry`) because CIM's `AdapterRAM` is a
  uint32 that wraps above 4 GiB, with `AdapterRAM` as the fallback (`vram_source cim`, or `none` at 0). Vendor
  comes from the PNP `VEN_` id (1002 amd, 10DE nvidia, 8086 intel), then from `AdapterCompatibility`. Form from
  the name: NVIDIA discrete; AMD integrated for `Vega N Graphics`, `NNNM`, `Radeon(TM) Graphics` and names
  ending `Radeon Graphics`, discrete for `RX`, `PRO` and `WNNNN`, else unknown; Intel discrete for `Arc A/Bnnn`,
  else integrated. `compute` is `cuda` for NVIDIA and `vulkan` for AMD and Intel; `uuid` is `pnp:<PNPDeviceID>`.
  When `nvidia-smi` answered it is the authority for NVIDIA cards: every NVIDIA CIM controller is dropped (CIM
  and `nvidia-smi` spell a card's name differently often enough that a name match would list it twice); when an
  NVIDIA controller remains and `nvidia-smi` failed, `gpu_probe.errors` says so. The recorded fixtures are
  `core/test/fixtures/windows-hardware/` and, byte for byte the same, `core/windows/tests/fixtures/`.
- **AMD on Linux**: `/sys/class/drm/card*/device` (vendor `0x1002`, `mem_info_vram_total`), `form unknown`,
  `memory unknown`, `vram_source sysfs`, `compute rocm`.
- **Apple silicon**: `system_profiler SPDisplaysDataType -json`, `form integrated`, `memory shared`,
  `vram_source none`, `vram_bytes 0`.

`runtime.gpu_probe` records what was attempted: `{ ok, platform, methods[], errors[], ignored_controllers[] }`.
Errors are prefixed (`win32-cim: `, `win32-reg: `, `nvidia-smi: `), cut at 200 characters and never contain a path
with a user name. A CIM failure makes `ok false` (GPUs then come from `nvidia-smi` only); a registry failure keeps
`ok true` and falls back to `cim` as the VRAM source.

The protocol itself is vendor-neutral. Additional inventory probes can be added without changing the capability
contract.

## Hardware mode (derived by code, never asserted)

`runtime.hardware_mode` is one of `gpu-verified`, `gpu-present-unverified`, `cpu-only`, `unknown`. It is derived
by `deriveHardwareMode()` in `core/src/compute/hardware.mjs` and written by the node agent at every enrolment and
heartbeat; `labels.hardware_mode` is overwritten with the same value (a differing manifest label logs
`compute_node_label_overridden` once), so a hand-written label cannot assert anything. The rule, pure:

1. `gpu-verified` when there is positive engine evidence within the TTL: an observation of a model loaded with
   `size_vram_bytes > 0`, `MCCLUSTER_NODE_GPU_EVIDENCE_TTL_MS` (default 86400000, minimum 60000) old at most;
2. else `gpu-present-unverified` when the inventory has at least one GPU;
3. else `cpu-only` when the probe ran (`gpu_probe.ok`);
4. else `unknown`.

A model loaded on CPU (`size_vram 0`) never verifies. `runtime.gpu_verified_at` is the time of the last positive
observation within the TTL, else null, and the agent persists that observation to `<STATE_DIR>/gpu-evidence.json`
(atomic write) so the mode survives a restart and degrades honestly after 24 hours without evidence.

### Engine evidence

The witness is the engine that loaded the model. The Ollama adapter reads `GET /api/ps` (3 s timeout, cached for
`MCCLUSTER_OLLAMA_EVIDENCE_TTL_MS`, default 60 s) and publishes `gpu_evidence` in its `/health`, `/ready` and
`/ready?implementation=<id>` bodies: `{ source: 'ollama:/api/ps', model, size_vram_bytes, size_bytes,
processor_gpu_percent, running_models, checked_at }`, or the zero shape when nothing is loaded, or null when the
daemon did not answer. The agent's existing health probe (`probeHttpExecutor`, every `MCCLUSTER_NODE_ENGINE_PROBE_MS`,
15 s) reads the body (at most 64 KiB of JSON) and carries `evidence` per implementation through
`engineHealthSummary`; the agent takes the observation with the largest `size_vram_bytes` as `runtime.gpu_evidence`.
No request generates a token for this. The probe cycle is a loopback HTTP read only: full hardware discovery
(the process spawns, on Windows `powershell.exe`, `reg.exe` and the `nvidia-smi` attempts with a 5 s timeout each)
runs once at start and then every `MCCLUSTER_NODE_HARDWARE_REFRESH_MS` (default 600000, floor 60000); the cycles
in between reuse the cached snapshot. `MCCLUSTER_OLLAMA_WARM_ON_START=true` (the laptop) loads each installed
resident model once with a one-token chat after the adapter's ready line, so evidence exists within a minute of a
reboot; because the adapter's startup task runs before the Ollama tray app exists, a daemon that does not answer
is tried again every `MCCLUSTER_OLLAMA_WARM_RETRY_MS` (default 30000, floor 1000) for
`MCCLUSTER_OLLAMA_WARM_WINDOW_MS` (default 900000), each attempt logged as `ollama_adapter_warm` and the window's
end as `ollama_adapter_warm_window_ended`; it is off on the OVH node.

### Measured inference (sidecar)

`measured-inference.json` next to the manifest (`path.dirname(MCCLUSTER_NODE_MANIFEST)`), schema
`mccluster-measured-inference/1`: `{ "measurements": { "<ollama model>": { generation_tokens_per_second,
prompt_tokens_per_second, processor_gpu_percent, measured_at, num_ctx, num_predict, prompt_tokens,
generation_tokens, ollama_version, backend_note } } }`. It is written atomically by the Windows doctor's
`-Benchmark` (`WINDOWS-NODE.md`); the agent only reads it, every engine probe, drops invalid numbers per field,
ignores a wrong schema (logging `compute_node_measurement_invalid` once), and publishes
`runtime.measured_inference_by_model` (the sanitized map) and `runtime.measured_inference` (the advertised entry
model with the highest generation rate). The manifest is the owner's policy file; the sidecar is evidence.

### Windows node defaults

On `win32` the agent's state directory defaults to `%ProgramData%\mccluster-node` and the manifest to
`capabilities.json` inside it (`resolveNodePaths`, logged once as `compute_node_paths`); it applies a best-effort
owner-only ACL with `icacls` to the state directory and `identity.json` (`compute_node_acl_unavailable` when it
cannot), drains on `SIGINT` and `SIGBREAK` as well as `SIGTERM`, and reads free disk from the state directory's
drive. Ending the scheduled task from Task Scheduler is a hard kill: the lease expires within 120 s and the task
requeues. `MCCLUSTER_NODE_ENROLL_ONLY=1` makes the agent exit 0 after `compute_node_enroll_only_done` (or 2 when
no token and no identity exist), which is how the doctor enrols once and then removes the token.

## Heartbeat and liveness

`POST /v1/compute/heartbeat`

A signed heartbeat refreshes:

- `last_seen_at`;
- hardware inventory;
- capability manifest;
- labels;
- current load;
- agent version;
- node concurrency limit.

The response is `{ ok, node_id, state, server_time, live_gpu_nodes }`, where `live_gpu_nodes` counts the other
live nodes of the organization whose `runtime.hardware_mode` is `gpu-verified` (null, and the heartbeat still
succeeds, when that read fails; `compute_gateway_live_gpu_unavailable`). The agent keeps the latest value for the
yield rule below.

A node in `revoked` or `quarantined` state cannot heartbeat or claim work. A `draining` node remains known but receives no new leases.

## Task and lease lifecycle

Tasks are durable rows in `ops_compute_tasks`.

```text
queued -> leased -> running -> done
                    |          
                    +-> failed -> queued (bounded retry)
                    
expired lease -> queued (if attempts remain)
              -> failed (if exhausted)
```

Nodes pull work. Core never connects inward to a worker.

### Claim

`POST /v1/compute/lease`

The node does not choose an arbitrary task type in its request. Core reads the node's stored manifest and atomically claims a matching queued task using `FOR UPDATE SKIP LOCKED`.

The scheduler checks:

- same organization;
- node is online and fresh;
- concurrency capacity remains;
- requested capability is advertised;
- explicit implementation, when present, is advertised;
- requested feature requirements are a subset of the advertised implementation features;
- `run_after`, priority, and retry limits;
- `yield_seconds`, when the claim body carries one (below): tasks younger than that are left for another node.

The lease response carries a random one-time lease token. Only its SHA-256 hash is stored in the database.

Which eligible node gets a queued task is first-poller-wins: the claim is `FOR UPDATE SKIP LOCKED` on
`status = 'queued'`, and there is no server-side ranking by label, trust or GPU. Two levers exist:

- **Poll cadence (Tier 1, no server change).** The Windows GPU laptop polls every `MCCLUSTER_NODE_POLL_MS=1000`
  (the agent's floor) while the OVH node keeps 5000 ms, so the laptop reaches `compute_claim_task` first when
  both are online. With `max_leases 1` and a 1 s poll it re-claims the moment it finishes.
- **Yield (Tier 2, additive, deploy-gated).** The claim body may carry `yield_seconds`. The agent sends it only
  when `MCCLUSTER_NODE_YIELD_TO_GPU_MS > 0`, the last heartbeat reported `live_gpu_nodes > 0`, and its own
  `hardware_mode` is not `gpu-verified`; the gateway clamps it to 0..300 and the store passes `p_yield_seconds`
  to `compute_claim_task` only when it is above 0. A pending, owner-approved migration (`compute_claim_task`
  v3 in `supabase/pending/`, proven on PGlite, never applied here) replaces the 4-argument function with one that
  takes `p_yield_seconds integer default 0` and skips tasks younger than that many seconds (and adds `priority`
  to the returned task). Until it is applied the 4-argument call keeps working, and a PostgREST `PGRST202` on the
  new parameter makes the store retry once without it and remember (`compute_claim_yield_unsupported`), so no
  claim ever fails because of it. The OVH node's `MCCLUSTER_NODE_YIELD_TO_GPU_MS` stays 0 until the owner turns
  it on.

### Start

`POST /v1/compute/leases/:id/start`

Requires both the signed node identity and the lease token.

### Progress heartbeat

`POST /v1/compute/leases/:id/heartbeat`

Extends a running lease and may save bounded progress metadata.

### Complete

`POST /v1/compute/leases/:id/complete`

Stores the normalized result and marks the task done. Expired leases cannot complete successfully.

### Fail

`POST /v1/compute/leases/:id/fail`

Stores the error. Retry is bounded by task policy and exponential backoff.

### Expiry

Lease expiry is durable. The next scheduler claim transaction atomically marks newly expired leases and requeues only their tasks. Historical expired leases cannot accidentally requeue a task that later received another lease.

## Database objects

`ops_compute_nodes`
: enrolled node identity, inventory, capabilities, labels, liveness and state.

`ops_compute_tasks`
: canonical durable compute queue.

`ops_compute_leases`
: ownership/expiry/progress/result record for each execution attempt.

`ops_compute_nonces`
: replay-defense ledger for signed node requests.

All four tables have RLS enabled and direct `anon` / `authenticated` access revoked. Lease and nonce RPCs are service-role-only.

## Core gateway API

Loopback service: `127.0.0.1:4788`.

Bootstrap/admin:

- `POST /v1/compute/enroll` — enrollment bearer token;
- `GET /v1/compute/nodes` — admin bearer token;
- `GET /v1/compute/capabilities` — admin bearer token;
- `POST /v1/compute/tasks` — admin bearer token.

Signed node operations:

- `POST /v1/compute/heartbeat`;
- `POST /v1/compute/lease`;
- `POST /v1/compute/leases/:id/start`;
- `POST /v1/compute/leases/:id/heartbeat`;
- `POST /v1/compute/leases/:id/complete`;
- `POST /v1/compute/leases/:id/fail`.

## Capability Registry integration

Live node implementations are discovered from `ops_compute_nodes` by the Core tool registry.

Each live `(capability, implementation)` pair becomes a temporary raw compute tool with a dynamic binding equivalent to:

```text
provider = mccluster-compute
transport = compute
hosting = self-hosted
billing = compute
```

This does **not** let a node invent product policy. The binding only participates when the capability already exists and is active in the McCluster Capability Registry.

When a stable capability resolves to a compute binding, the tool bus enqueues a task pinned to that implementation. The scheduler then selects an eligible live node. The caller sees a stable capability contract, not a GPU hostname or ComfyUI endpoint.

Two nodes may advertise the same implementation id: the Windows GPU laptop advertises `ai.chat/qwen3.8b.local`
with the OVH node's exact input and output schema (`core/node-manifests/owner-windows-gpu.json`, held to
`ovh-primary.json` by the drift check) plus the features `gpu: true` and `model_tier`, so one binding and one
task are claimable on either node; `requirements.features { gpu: true }` pins work to GPU-advertising nodes
without a new implementation id.

Each live `(capability, implementation)` binding carries `evidence` aggregated over its live nodes:
`hardware_mode` (the best over the nodes), its rank (`gpu-verified` 3, `gpu-present-unverified` 2, `cpu-only` 1,
unknown 0), the highest measured `generation_tokens_per_second` for the entry's model, `live_nodes` and a
per-node list. The registry resolves candidates by economic score first (a static owned/free binding is never
outranked by a compute node's evidence), then `hardware_mode` rank, then generation tokens per second, then
binding id; static catalog bindings have `evidence null`.

`CapabilityRegistry.call()` tries the candidates in that order and moves to the next only on
`COMPUTE_NO_LIVE_NODE` (the tool bus re-reads the live nodes for the pinned implementation before enqueueing and
answers 503 when none is live) or `COMPUTE_ENQUEUE_FAILED`; every other error surfaces unchanged with the
candidates tried in `error.tried`, and a successful fallback reports `fallback_from`. So when the laptop is
offline (3 minutes without a heartbeat) its bindings are not live and the OVH node's are used.

Core's own executors reach the local adapter directly by default. Behind `MCCLUSTER_LOCAL_AI_FABRIC=prefer`
(Tier 2, off in production) `localAiChat` enqueues the same input as an `ai.chat` task for a live `gpu-verified`
node other than `MCCLUSTER_LOCAL_AI_FABRIC_EXCLUDE_NODES` (default `ovh-primary`) with `requirements.features
{ gpu: true }`, `max_attempts 1` and `metadata.source local-ai-fabric`, waits a bounded time, and at the deadline
cancels the task atomically if it is still queued (`status queued` -> `canceled`, the claim and the cancel cannot
both win) and runs locally; while a node holds the task it keeps polling and finally throws a retryable
`LOCAL_AI_FABRIC_TIMEOUT` rather than run the same prompt twice. Three task reads failing in a row (a control
plane hiccup) do not change that rule: the client first tries the same atomic cancel and runs locally only when
the row came back; a null (a node holds it) or a failed cancel means a node may own the task, so polling goes on
and the timeout is thrown. The whole call is bounded by the caller's `timeoutMs` (floor 30 s): at most half of
it waiting for a claim (`MCCLUSTER_LOCAL_AI_FABRIC_WAIT_MS` only shortens it), all of it before a held task
becomes the timeout (`MCCLUSTER_LOCAL_AI_FABRIC_RUNNING_WAIT_MS` only shortens it), and the local fallback gets
what is left, never under the 30 s floor.

## Local executor boundary

The v1 node agent accepts only configured HTTP(S) executors on loopback (`127.0.0.1`, `::1`, or `localhost`). It does not accept shell commands from Core.

That boundary is intentional. The next phase can put a McCluster adapter in front of ComfyUI so the node receives a provider-neutral input and the adapter translates it into a known versioned workflow.

## Example node files

- `core/compute-node.env.example`
- `core/compute-capabilities.example.json`
- `core/systemd/mccluster-compute-node.service`
- `core/node-manifests/ovh-primary.json` (the OVH node, deployed by `scripts/deploy-ovh-core.sh` when the host's
  `MCCLUSTER_NODE_NAME` matches the file name)
- `core/node-manifests/owner-windows-gpu.json` (the Windows GPU laptop template: two `ai.chat` entries with the
  OVH schema, loopback executors with per-implementation readiness `/ready?implementation=<id>`,
  `min_vram_bytes 0`, `max_leases 1`)
- `core/windows/mccluster-node.ps1` with `core/windows/tests/` (the Windows doctor and installer; runbook
  `WINDOWS-NODE.md`)

The example capability manifest shows the future Hunyuan3D/ComfyUI shape but does not claim that the ComfyUI adapter is implemented yet.

## Operational rules

1. Never expose the node agent itself to the Internet.
2. Never give a node the Supabase service-role key.
3. Never publish Core port 4788 directly; use TLS reverse ingress.
4. Rotate enrollment tokens after bootstrap.
5. Revoke or quarantine compromised nodes centrally.
6. Keep node private keys root/node-user readable only.
7. Treat capability advertisements as availability evidence, not authorization grants.
8. Keep consequential actions behind the existing McCluster policy/approval layer.
9. Do not auto-activate unknown capabilities because a node claims to support them.
10. Do not let compute nodes bypass the capability registry to reach paid APIs directly.
11. `hardware_mode` is derived by code from the probe and the engine's evidence; a manifest label never asserts
    it, and shared memory is stated as a field, never dressed up as dedicated VRAM.
12. Nothing a node sends identifies its owner: no user name, no path with one, and the public repository records
    no node's hostname, user name, local paths or addresses.
