# Device nodes: the owner's devices as compute nodes of the network

Status: queued behind the work in progress. Nothing new is built yet. Resume point for any session.

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

## Queue

| Step | What | State |
| --- | --- | --- |
| 1 | Read the laptop: GPU, driver, drive layout and the 50 GB partition (needs Remote Control to the laptop, or the owner runs a short read-only script and pastes the result) | queued, owner's device |
| 2 | Windows GPU discovery in the node agent, tested against recorded `nvidia-smi` and PowerShell output | queued |
| 3 | Control: Devices pane, enrolment token, per-platform installer, pause/resume/revoke | queued |
| 4 | Model placement on the laptop, routing to the laptop with fallback to OVH, health and cost | queued |
