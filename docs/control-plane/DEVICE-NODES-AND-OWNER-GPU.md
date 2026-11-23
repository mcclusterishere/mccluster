# Device nodes: the owner's devices as compute nodes of the network

Status: slice N1 built on 2026-11-17 (source and tests on this branch; nothing in production changed). The GPU
is visible on Windows, the laptop has a manifest and an installer, and the laptop is preferred for `ai.chat` by
poll cadence. Slice N2, the same day, makes the laptop the agent node: images in `ai.chat` with vision routing,
the node's own browser as a second loopback executor driven only from the Core's agent loop, and the Control
Room surface (`AGENT-NODE-BROWSER.md`). The Control pane (step 3), the OVH promotion, the pending claim SQL and
the Tier 2 switches are the open items. Resume point for any session; the owner's runbook is `WINDOWS-NODE.md`.

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
  `ai.chat/qwen3-vl.8b.local` (the resident vision model, the owner's decision below) and
  `ai.chat/qwen3.8b.local` with the OVH node's exact schema (one binding, one task, either node), plus
  `ai.chat/qwen3.14b.local` for a discrete card with 12 GiB or more and `ai.chat/qwen3-vl.4b.local` for a box
  with little free memory; the doctor prunes the template to the tier; the Ollama adapter maps implementation ids to models
  (`MCCLUSTER_OLLAMA_IMPLEMENTATIONS`) and answers readiness per implementation; the capability registry ranks
  compute bindings by `hardware_mode` and measured generation rate and falls back to the next candidate when no
  node is live; the laptop polls at 1000 ms against the OVH node's 5000 ms (Tier 1, no server change). Tier 2,
  code behind configuration and off in production: fabric-first `localAiChat` for Core's own executors
  (`MCCLUSTER_LOCAL_AI_FABRIC=prefer`, a wait bounded by the caller's `timeoutMs`, atomic cancel of a
  still-queued task; the local adapter runs only after that cancel won or the task failed, and while a node
  may own the task the client waits and then fails with a retryable `LOCAL_AI_FABRIC_TIMEOUT`, so a duplicate
  run is never silent) and a yield rule (`MCCLUSTER_NODE_YIELD_TO_GPU_MS`, heartbeat `live_gpu_nodes`, claim
  `yield_seconds`) whose claim SQL is pending and owner-approved only.
- **The device side**: `core/windows/mccluster-node.ps1` (report, install as two scheduled tasks, one-shot
  enrolment that removes the token, model pulls, a benchmark that writes `measured-inference.json`, keep-awake,
  the 50 GB partition as the model store, the Vulkan device on a mixed system) with Pester-free tests in
  `core/windows/tests/`; runbook `WINDOWS-NODE.md`. The script could not be executed in the build session (no
  PowerShell there), so it is **unverified on Windows** until its tests run on the laptop.

### Owner decision, 2026-11-17 (~20:25 UTC): the model tier, headroom first

The owner, on the 16 GB shared-memory box: "i think I'll go with something that leaves us a bit more headroom so we
dont fuck up the machine and it can be a real persistent actor." The slice implements it in the doctor
(`core/windows/mccluster-node.ps1`, runbook `WINDOWS-NODE.md`, "Model tier rule"): one resident model on every
tier, the vision model `qwen3-vl:8b` (vision, tools and thinking; the agent model for slice N2), kept loaded as the
adapter's default model with a 24 h keep-alive; the OVH twin `qwen3:8b` only on demand under `qwen3.8b.local`
with a 5 m keep-alive, never resident beside it; no 12B or 14B model on a shared-memory machine (`qwen3:14b`
exists on tier A only, a discrete card with 12 GiB or more); `qwen3-vl:4b` is the resident model when free memory
at install time is under 8 GB; `num_ctx` 8192 on shared memory; `max_leases` 1. `-Benchmark` measures free
memory before and after the model loads, prints both, refuses a tier whose resident model leaves the machine under
4 GB free (it names the lower tier to install) and does not advertise the on-demand `qwen3:8b` when loading it
would. Images in `ai.chat` are slice N2's work: today the resident vision model answers text through the same
`ai.chat` contract. The design's open question "which model tier to run" is answered by this decision.

### Compute task states

`queued -> leased -> running -> done`; `failed -> queued` while attempts remain (bounded backoff), else `failed`;
an expired lease requeues the task (or fails it when attempts are exhausted); and since slice N1 `canceled`: the
fabric-first client cancels a task that is still `queued` when its wait is exceeded, or when three task reads in
a row failed and it can no longer tell who owns the task (`UPDATE … WHERE status = 'queued'`, atomic against the
claim's `FOR UPDATE SKIP LOCKED`), and runs locally only when that cancel returned the row; a task a node already
holds, or whose cancel did not win, is never duplicated: the client keeps polling and then fails with a retryable
`LOCAL_AI_FABRIC_TIMEOUT`, all of it inside the caller's `timeoutMs`.

### Node `hardware_mode` states

| Mode | Meaning | How a node leaves it |
| --- | --- | --- |
| `gpu-verified` | the engine was seen running a model with `size_vram > 0` within the last 24 h | no evidence for 24 h |
| `gpu-present-unverified` | a GPU was found by the probe, nothing proves inference ran on it yet | evidence arrives (the adapter warms the resident model once the daemon answers after start, retrying every 30 s for 15 min because the tray app starts after the adapter's task) |
| `cpu-only` | the probe ran and found no accelerator | a GPU appears |
| `unknown` | the probe itself failed (for example CIM access denied) | the probe succeeds |

Derived by code at every enrolment and heartbeat, published as `inventory.runtime.hardware_mode`, mirrored into
`labels.hardware_mode`; a manifest label asserts nothing. The Devices pane (step 3) shows the mode and the
evidence.

## Built in slice N2 (2026-11-17): the agent node

The owner's words: "As it's own node but more powerful … the most power multimodal agent that can do anything and
give it it's own browser and more abilities very strong agent and a model i can use to direct the best please."
Two lanes on this branch, source and tests only; the design, the contracts and what is verified where are in
`AGENT-NODE-BROWSER.md`.

- **Images in `ai.chat`** (lane C1): `messages[].images` as Ollama takes them, bounds sniffed from bytes (4 per
  request, 200,000 bytes each, 600,000 per request, 1600 px, JPEG/PNG/WebP), one validator in the broker, the
  adapter and the local client; an image turn is routed to `qwen3-vl.8b.local` then `qwen3-vl.4b.local`
  (`features.vision true` on the template's two vision entries, lane C2) and otherwise fails with
  `LOCAL_AI_NO_VISION_NODE` / `AI_CHAT_NO_VISION_NODE`, never a text model. No body limit was raised.
- **The node's own browser** (lane C1 the executor and the loop, lane C2 the device and the words): the
  browser executor on `127.0.0.1:4791` (Playwright Chromium in the node's own persistent profile, headless by
  default, a policy file of allowed hosts beside the manifest, private addresses refused after DNS on every
  request and every connection made at the validated address through the executor's own egress proxy, no
  downloads, choosers, dialogs or popups, fixed extractors, step/time/byte caps, every action logged),
  advertised as `browser.act/chromium.local` and claimable only by nodes whose enrolment recorded trust
  `owned` (review fixes of 2026-11-18 in `AGENT-NODE-BROWSER.md`), reached only through the
  Core's resident agent loop as `browser_act`, which exists for a turn only when the owner's session submitted
  it with `allow_browser: true`. The loop keeps the last two screenshots as images, wraps page text as evidence,
  checkpoints steps into the user message and writes screenshots, the action log and a node badge into the
  assistant message's metadata, all bounded, without SQL (the user message is pre-inserted with its metadata
  before the existing RPC).
- **The device side** (lane C2): `core/windows/mccluster-node.ps1 -Browser` (the one switch that downloads:
  the pinned Playwright package through npm, Chromium through Playwright's own installer after a dry run the
  owner answers; policy written once; profile folder; launcher; the task "McCluster Node Browser"; the
  `chromium.local` entry; `browser: true` kept by `-Install`), `-BrowserHeaded` for signing the profile in by
  hand, a BROWSER block in `-Report`; pwsh tests written, **unexecuted here** (no PowerShell in the build
  container); the laptop template and the drift check carry the vision flags and the browser entry.
- **The surface** (lane C2): the Control Room's Ask McCluster composer gets image attach (downscaled on the
  client to 1280 px JPEG, at most 200,000 bytes, two per turn), the owner-only "Use the browser" switch with an
  honest readiness line, user images, screenshots and the action log inline in a collapsed block, live steps
  while the turn runs, the node badge (which node answered, its hardware mode and measured rate) and the
  refusal codes in words; proven in Chromium at 390 and 1280 against fixtures.

## Owned hardware first, and Core is the node network (owner, 2026-11-23)

> "The lyric machine shouldn't wait on OVH box. We have a whole bunch of other nodes ... I want my laptop to ... be
> the same as the OVH box. They are equals ... Prioritize owned hardware ... Our baseline objectives should be able to
> be hit by everything." "Core, now that we have multiple nodes, should be the node network itself."

The decision is recorded in `AGENTS.md` and `MCCLUSTER-CORE.md`. In the code (source and tests; nothing deployed):

- **The lyric machine runs on any node.** `lyrics.align` is a node capability: `core/src/compute/lyrics-executor.mjs`
  (loopback `127.0.0.1:4792`) runs the same pipeline the Core runs (`core/src/lyrics/pipeline.mjs`: Demucs,
  faster-whisper, the sheet, wav2vec2). The Core's `lyrics_align` job (`core/src/executors/lyrics-align.mjs`) first
  offers the work to a live owned node through the compute queue (`core/src/compute/lyrics-node.mjs`), with a one-hour
  signed URL for the master in the task: **the node never receives a database or storage key**, and takes a master
  only from an allowed storage host. The node's document is validated before it is written, the write keeps every
  existing guard (input revision, never over reviewed lyrics), and the result records where it ran
  (`machine.ran_on`). With no live owned node, or when the node fails, or when the task is taken back while still
  queued, the Core runs it itself; a node still holding the task past the wait makes the job retry later, never a second
  run. `MCCLUSTER_LYRICS_FABRIC=off` turns the offer off; the OVH node's name is excluded by default
  (`MCCLUSTER_LYRICS_FABRIC_EXCLUDE_NODES`, default `ovh-primary`), since it runs its own copy locally. Stems from a
  node run are not stored yet (they need the storage key); a Core run still stores them.
- **Owned first for AI chat by default.** `MCCLUSTER_LOCAL_AI_FABRIC` now defaults to `prefer`: the Core's own
  inference goes to a live GPU-verified owned node first, and with none live it runs on the box at once (no wait).
- **The laptop template advertises it.** `core/node-manifests/owner-windows-gpu.json` carries
  `lyrics.align/lyrics.machine.local`. A node advertises it only while the executor answers `/ready`, which checks that
  Python imports `demucs`, `faster_whisper` and `torchaudio`.
- **To bring a node up for lyrics** (Prime's Windows install and packaging stay with Prime's own session): install the
  same Python packages the OVH runbook names (`core/README.md`, "Lyric machine runtime": `torch` and `torchaudio`
  2.7.1, `faster-whisper` 1.2.1, `demucs` 4.1.0, `soundfile`; the CUDA or ROCm wheel where the GPU has one), set
  `LYRICS_PYTHON` to that interpreter, and run `npm run compute:lyrics` from `core/` beside the node agent. The Windows
  doctor (`core/windows/mccluster-node.ps1`, Prime's session) prunes the template to the tier's implementations plus
  its listed extras, so until it lists `lyrics.machine.local` among those extras the entry has to be kept in the
  written `capabilities.json` by hand. The Macs take the same entry once their node manifest from draft PR #821 lands.
- **Core runs on more than one node.** Several Core runners may work the same queue (each claim is one conditional write
  with its own lease), and the compute gateway has a fenced primary and standby (`DEVICE-JOBS-SCHEDULER-STANDBY.md`).
  Running the Core runner and a standby gateway on Prime is the next step for "the laptop is the OVH box's equal"; it
  needs Prime's install, the pending scheduler SQL, and the owner's decision that Prime holds the Core's server key.

## Queue

| Step | What | State |
| --- | --- | --- |
| 1 | Read the laptop: GPU, driver, drive layout and the 50 GB partition | the owner runs `core\windows\mccluster-node.ps1 -Report` and pastes the masked block (`WINDOWS-NODE.md`); still the owner's device |
| 2 | Windows GPU discovery in the node agent, tested against recorded CIM, registry, `nvidia-smi` and PowerShell output | built in slice N1 (`hardware.mjs`, agent 0.4.0, fixtures, `core/test/hardware-windows.test.mjs`); unverified on a real Windows machine until the laptop runs it |
| 3 | Control: Devices pane, enrolment token issued and rotated from Control, per-platform installer, pause/resume/revoke | queued; the Windows installer exists as the doctor script (owner-run, token from the Core by hand) |
| 4 | Model placement on the laptop, routing to the laptop with fallback to OVH, health and cost | Tier 1 built in slice N1 (template, adapter map, registry ranking and fallback, 1000 ms poll); Tier 2 built behind configuration (fabric-first client, yield rule) and off; the claim SQL is pending, owner-approved only; the OVH promotion and its env values (`MCCLUSTER_NODE_YIELD_TO_GPU_MS`, `MCCLUSTER_LOCAL_AI_FABRIC=prefer`) are deploy-gated plan items |
| 5 | The laptop's build and the 50 GB partition as the model store | `-Report` finds the partition; `-ModelsPath` moves the store; the owner decides |
| 6 | Health and cost per node in the pane | queued with step 3 |
| 7 | Images in `ai.chat` and vision routing (slice N2) | built (lane C1 the Core, lane C2 the template's vision flags); unverified against a real vision model until the laptop runs it |
| 8 | The node's own browser: executor, `browser.act`, the Core loop's `browser_act` (slice N2) | built; the executor is proven against real Chromium in lane C1's own run; the Windows install and a live browser turn are unverified; OVH promotion deploy-gated |
| 9 | The Control Room surface for images and browser turns (slice N2) | built and proven in Chromium against fixtures (`scripts/e2e/control-ai-browser.e2e.mjs`) |

Open questions for the owner (from the slice design): which GPU the laptop really has (`-Report` decides;
`-Tier` forces), whether to keep it awake on AC and run on battery (the model tier is decided: the owner's
decision above), whether
`OLLAMA_MODELS` moves to the 50 GB partition, whether to re-enrol the pilot key or enrol a fresh node and revoke
the pilot, approval of the pending claim SQL and the OVH yield value once the laptop is `gpu-verified` in
production, when to set `MCCLUSTER_LOCAL_AI_FABRIC=prefer` on the Core, whether a 120 s fabric wait is acceptable,
and whether the laptop should also take work while the owner is using it. From slice N2: which hosts go into
`browser-policy.json` first and whether subdomains are allowed, whether stopping the browser task for a headed
sign-in is acceptable, whether the chat's image cap stays at 2, inline bounded screenshots versus a storage
bucket and a 7-argument RPC later (SQL), whether the Command Center's Ask home AI may use the browser, whether
the CI browser job runs on dispatch only, whether the Playwright pin follows the owner's install, whether public
non-allowlisted subresources stay allowed, and whether a browser turn is refused on battery or off `gpu-verified`.
