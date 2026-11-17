# Device nodes: the owner's devices as compute nodes of the network

Status: slice N1 built on 2026-11-17 (source and tests on this branch; nothing in production changed). The GPU
is visible on Windows, the laptop has a manifest and an installer, and the laptop is preferred for `ai.chat` by
poll cadence. The Control pane (step 3), the OVH promotion, the pending claim SQL and the Tier 2 switches are the
open items. Resume point for any session; the owner's runbook is `WINDOWS-NODE.md`.

## The owner's request (2026-11-17)

"We need my computer to be able to supply gpu and processing power to the overall network. … a feature that
starts in admin that essentially allows me to sign up whatever device I'm on to be able to give inference to the
overall network. Each device should be its own node in the network and OVH box should be the connecting node but
i wanna be able to make my own laptop a node as well. I think we partitioned 50gb on that drive for some stuff but
I don't remember exactly the build so get on that."

## What already exists (read on 2026-11-17 against `main` at `fc1986ec`, production read only)

The fabric exists; the admin enrolment flow and the laptop's GPU are what is missing.

- **Protocol** `mccluster-compute/1` (`docs/control-plane/COMPUTE-NODE-PROTOCOL.md`): a node generates an Ed25519
  key, enrols once with a rotatable token at `POST /v1/compute/enroll`, then signs every request with its own key;
  heartbeats every 30 s, 120 s leases, replay protection in `ops_compute_nonces`. Nodes connect outbound only,
  through TLS ingress to the Core gateway on loopback `127.0.0.1:4788`; a node never holds control-plane secrets.
  The OVH Core is the connecting node by design: it owns the registry, scheduler, leases and audit.
- **Code**: `core/src/compute/` (gateway, node-agent, hardware discovery for NVIDIA `nvidia-smi`, AMD sysfs and
  Apple Metal, engine probes, lease runtime, protocol, signature, store), `core/src/compute/ollama-adapter.mjs`
  (`ai.chat` against a local Ollama on `127.0.0.1:11434`, default model `qwen3:8b`), systemd units
  `core/systemd/mccluster-compute-gateway.service` and `mccluster-compute-node.service`,
  `core/compute-node.env.example`, `core/compute-capabilities.example.json`, and tests in `core/test/`.
- **Tables** in production: `ops_compute_nodes` (18 columns), `ops_compute_tasks`, `ops_compute_leases`,
  `ops_compute_nonces`.
- **Nodes in production** (read 2026-11-17 15:40 UTC, no private details copied here):
  - `ovh-primary`: online, enrolled 2026-09-19, Linux x64, capability `ai.chat`, labels role `control-cpu`, trust
    `owned`; 37 tasks done.
  - `owner-windows-pilot`: online, enrolled 2026-11-14, Windows x64 (kernel 10.0.26300, Node 24), 16 CPUs, 16 GB
    memory, 232 GB free disk, local Ollama healthy, capability `ai.text.draft`, labels pilot, trust `owned`,
    `hardware_mode: cpu-baseline-gpu-unverified`; 1 task done; last seen 2026-11-17 02:54 UTC. **No GPU was
    reported**: the agent's only NVIDIA probe is `nvidia-smi`, so on Windows a missing or non-PATH `nvidia-smi`, a
    non-NVIDIA GPU, or no driver all read as "no GPU".
- **Control**: the Control Room shows self-hosted AI readiness and compute tasks; there is no node pane, no
  enrolment flow and no per-device view. The Worker's only node read is the live-rooms health check of
  `ovh-primary`.
- **The 50 GB partition**: no record of it exists in this repository, in the production inventory (which reports
  free disk only), or in the session notes. It has to be read on the laptop.

## The target

1. **Devices in Control** (owner-only): a Devices pane listing every node with state, last seen, platform,
   CPUs, memory, GPU (model and VRAM or "none found"), capabilities, current load and task history; actions to
   name, pause, resume and revoke a node; the enrolment token issued and rotated from here, shown once.
2. **"Add this device"**: from Control on any device, one flow that produces a per-platform installer and a
   one-time enrolment token: Windows (a service or scheduled task running the node agent under Node), macOS
   (launchd), Linux (systemd, as the OVH node runs). The agent enrols, then the token is rotated and the device
   appears in the pane. Every device is its own node with its own key; the OVH box stays the connecting node.
3. **Find the GPU**: on Windows, probe `nvidia-smi` on its usual path, the registry or `wmic`/PowerShell for the
   adapter, VRAM and driver; AMD and Intel likewise; report `hardware_mode` truthfully. Capabilities that need
   VRAM (`min_vram_bytes`) are admitted only when the GPU is found; otherwise the node serves CPU capabilities
   and says so.
4. **Inference on the device**: Ollama (or another node-owner-configured local executor) behind the node agent,
   with the model set per device from Control (resident models, keep-alive), so `ai.chat` and `ai.text.draft`
   route to the owner's laptop when it is online and fall back to the OVH node when it is not. The scheduler's
   offline rule (3 minutes without a heartbeat) already covers a laptop that sleeps or leaves the network.
5. **The laptop's build**: read the real hardware and the drive layout on the laptop (the 50 GB partition, what is
   on it, whether it should hold model weights and the node's state directory), then set the node up to use it.
   Model weights for a local LLM at this size need tens of GB, so the partition's purpose decides the model.
6. **Health and cost**: per-node health, task counts and failures in the pane; everything under the existing job,
   lease and cost ledger on the OVH Core; no new backend.

## Rules that apply

`AGENTS.md`: the OVH Core from `core/` is the persistent execution plane; no second backend, no Worker named
`mccluster-core`; nodes never receive the service-role key or other control-plane secrets (protocol trust
model); never publish port 4788; the enrolment token is shown once and rotated. The public repository must not
record the laptop's hostname, user name, local paths or network details; keep them in the private inventory.

## Built in slice N1 (2026-11-17)

The owner's words that day: "Get my laptop to work overtime, one task done is a shame for such a machine. Also I
need you to please install something more powerful on that laptop; it should honestly be outperforming the OVH
because it has a graphics card." Two gaps, both closed in source: the GPU was invisible (only `nvidia-smi` on
PATH was probed) and the laptop got no work (a pilot-only capability nothing submits, a first-poller-wins
scheduler, Core executors that bypass the fabric, a registry that calls only one candidate).

- **GAP 1, the GPU**: `core/src/compute/hardware.mjs` probes Windows through CIM `Win32_VideoController` and the
  display-class registry (the REG_QWORD VRAM, since `AdapterRAM` wraps above 4 GiB), finds `nvidia-smi` on its
  Windows paths, states integrated/discrete and shared/dedicated per GPU, and derives `hardware_mode`
  (`gpu-verified` | `gpu-present-unverified` | `cpu-only` | `unknown`) from the probe and from the engine's own
  evidence (a model loaded with `size_vram > 0`, read from the Ollama adapter's cached `GET /api/ps`). Recorded
  fixtures for a Radeon 780M alone, a 780M with an RX 7600S, an RTX 4070 with and without `nvidia-smi`, a Basic
  Display Adapter only, and a PowerShell access error. The pilot's hand-written label
  `hardware_mode: cpu-baseline-gpu-unverified` is superseded: the agent overwrites `labels.hardware_mode` with the
  derived value every heartbeat (`COMPUTE-NODE-PROTOCOL.md`, "Hardware mode").
- **GAP 2, the work**: the laptop template `core/node-manifests/owner-windows-gpu.json` advertises
  `ai.chat/qwen3.8b.local` with the OVH node's exact schema (one binding, one task, either node) plus
  `ai.chat/qwen3.14b.local`; the Ollama adapter maps implementation ids to models
  (`MCCLUSTER_OLLAMA_IMPLEMENTATIONS`) and answers readiness per implementation; the capability registry ranks
  compute bindings by `hardware_mode` and measured generation rate and falls back to the next candidate when no
  node is live; the laptop polls at 1000 ms against the OVH node's 5000 ms (Tier 1, no server change). Tier 2,
  code behind configuration and off in production: fabric-first `localAiChat` for Core's own executors
  (`MCCLUSTER_LOCAL_AI_FABRIC=prefer`, bounded wait, atomic cancel of a still-queued task, never a silent
  duplicate run) and a yield rule (`MCCLUSTER_NODE_YIELD_TO_GPU_MS`, heartbeat `live_gpu_nodes`, claim
  `yield_seconds`) whose claim SQL is pending and owner-approved only.
- **The device side**: `core/windows/mccluster-node.ps1` (report, install as two scheduled tasks, one-shot
  enrolment that removes the token, model pulls, a benchmark that writes `measured-inference.json`, keep-awake,
  the 50 GB partition as the model store, the Vulkan device on a mixed system) with Pester-free tests in
  `core/windows/tests/`; runbook `WINDOWS-NODE.md`. The script could not be executed in the build session (no
  PowerShell there), so it is **unverified on Windows** until its tests run on the laptop.

### Compute task states

`queued -> leased -> running -> done`; `failed -> queued` while attempts remain (bounded backoff), else `failed`;
an expired lease requeues the task (or fails it when attempts are exhausted); and since slice N1 `canceled`: the
fabric-first client cancels a task that is still `queued` when its wait is exceeded (`UPDATE … WHERE status =
'queued'`, atomic against the claim's `FOR UPDATE SKIP LOCKED`) and runs locally instead; a task a node already
holds is never canceled or duplicated, the client waits and then fails with a retryable `LOCAL_AI_FABRIC_TIMEOUT`.

### Node `hardware_mode` states

| Mode | Meaning | How a node leaves it |
| --- | --- | --- |
| `gpu-verified` | the engine was seen running a model with `size_vram > 0` within the last 24 h | no evidence for 24 h |
| `gpu-present-unverified` | a GPU was found by the probe, nothing proves inference ran on it yet | evidence arrives (the adapter warms the resident models on start) |
| `cpu-only` | the probe ran and found no accelerator | a GPU appears |
| `unknown` | the probe itself failed (for example CIM access denied) | the probe succeeds |

Derived by code at every enrolment and heartbeat, published as `inventory.runtime.hardware_mode`, mirrored into
`labels.hardware_mode`; a manifest label asserts nothing. The Devices pane (step 3) shows the mode and the
evidence.

## Queue

| Step | What | State |
| --- | --- | --- |
| 1 | Read the laptop: GPU, driver, drive layout and the 50 GB partition | the owner runs `core\windows\mccluster-node.ps1 -Report` and pastes the masked block (`WINDOWS-NODE.md`); still the owner's device |
| 2 | Windows GPU discovery in the node agent, tested against recorded CIM, registry, `nvidia-smi` and PowerShell output | built in slice N1 (`hardware.mjs`, agent 0.4.0, fixtures, `core/test/hardware-windows.test.mjs`); unverified on a real Windows machine until the laptop runs it |
| 3 | Control: Devices pane, enrolment token issued and rotated from Control, per-platform installer, pause/resume/revoke | queued; the Windows installer exists as the doctor script (owner-run, token from the Core by hand) |
| 4 | Model placement on the laptop, routing to the laptop with fallback to OVH, health and cost | Tier 1 built in slice N1 (template, adapter map, registry ranking and fallback, 1000 ms poll); Tier 2 built behind configuration (fabric-first client, yield rule) and off; the claim SQL is pending, owner-approved only; the OVH promotion and its env values (`MCCLUSTER_NODE_YIELD_TO_GPU_MS`, `MCCLUSTER_LOCAL_AI_FABRIC=prefer`) are deploy-gated plan items |
| 5 | The laptop's build and the 50 GB partition as the model store | `-Report` finds the partition; `-ModelsPath` moves the store; the owner decides |
| 6 | Health and cost per node in the pane | queued with step 3 |

Open questions for the owner (from the slice design): which GPU the laptop really has (`-Report` decides;
`-Tier` forces), whether to keep it awake on AC and run on battery, which model tier to run, whether
`OLLAMA_MODELS` moves to the 50 GB partition, whether to re-enrol the pilot key or enrol a fresh node and revoke
the pilot, approval of the pending claim SQL and the OVH yield value once the laptop is `gpu-verified` in
production, when to set `MCCLUSTER_LOCAL_AI_FABRIC=prefer` on the Core, whether a 120 s fabric wait is acceptable,
and whether the laptop should also take work while the owner is using it.
