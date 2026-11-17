# The owner's Windows GPU laptop as a compute node

Status: built in the device-node slice N1 (2026-11-17), source and tests only; nothing in production
changed. The same day's review fixes are in the source too: the report prints values only for non-secret
names, the model tier follows the owner's decision below (one resident vision model, headroom first), `-Install`
refuses arguments cmd.exe would misread, a stale registry subkey never shadows the live one, the adapter retries
its warm-up until the Ollama app is up, and the agent caches the hardware discovery. The script was written and
statically checked here, but **no PowerShell could be executed in the build or the fix session**, so it is
unverified on Windows and unverified here until `core/windows/tests/mccluster-node.tests.ps1`
has run on the laptop (the last step below says how to paste the result). Read
`docs/control-plane/DEVICE-NODES-AND-OWNER-GPU.md` for why this exists and
`docs/control-plane/COMPUTE-NODE-PROTOCOL.md` for the protocol the node speaks.

The owner's words (2026-11-17): "Get my laptop to work overtime, one task done is a shame for such a machine …
it should honestly be outperforming the OVH because it has a graphics card." The two gaps this closes: the GPU
was invisible (the agent probed only `nvidia-smi` on PATH), and the laptop got no work (it advertised a
pilot-only capability nothing submits, while every `ai.chat` task went to the OVH node).

## What runs on the laptop

| Piece | What | Where |
| --- | --- | --- |
| The doctor | `core/windows/mccluster-node.ps1`: report, install, enrol, models, benchmark, power, model store, Vulkan device | the repository checkout |
| The node agent | `core/src/compute/node-agent.mjs` 0.4.0, scheduled task "McCluster Node Agent" | state under `%ProgramData%\mccluster-node` |
| The Ollama adapter | `core/src/compute/ollama-adapter.mjs` on `127.0.0.1:4790`, scheduled task "McCluster Node Adapter" | loopback only |
| Ollama | the Windows tray app on `127.0.0.1:11434`, Vulkan backend on by default for a Radeon APU or RX 7000S | owner-installed |
| The manifest | `core/node-manifests/owner-windows-gpu.json`, written to `%ProgramData%\mccluster-node\capabilities.json` pruned to the model tier | the template is Git-managed |

The node holds no control-plane secret. It enrols once with a token the owner's Core shows once, then signs every
request with its own Ed25519 key (`identity.json`, owner-only ACL). Port 4788 is never published; the node only
reaches the Core's public ingress (`-ComputeUrl`, default `https://compute.mccluster.org`) outbound over TLS.

## Prerequisites

- Windows 10 or 11, 64-bit. Windows PowerShell 5.1 (built in) or PowerShell 7 both run the script.
- Node.js 20 or newer on PATH (`node --version`). The pilot ran Node 24.
- A checkout of `mcclusterishere/mccluster` (the `-RepoPath`). The scheduled tasks run `node` from its `core/`
  folder, so keep the checkout where it is, or re-run `-Install` after moving it.
- Ollama for Windows (the tray app), 0.12.7 or newer: the vision models (`qwen3-vl`) answer HTTP 412 on older
  builds, and `-Models` warns when the daemon is older. Vulkan is the default backend for AMD APUs and the RX
  7000S/M cards; ROCm covers only the desktop RX 7600 to 7900 and PRO W7500 to W7900. Environment variables for
  Ollama are user variables, and the tray app must be restarted to read them.
- From the owner's Core: the organization id (`-OrgId`, a uuid) and, at enrolment time, the one-time enrolment
  token. The token is shown once and rotated after the node has enrolled.
- Running scripts: `powershell -ExecutionPolicy Bypass -File core\windows\mccluster-node.ps1 …` avoids changing
  the machine's execution policy. Every example below is written that way; `pwsh` works the same.

## 1. Report (read-only, no administrator rights)

```powershell
powershell -ExecutionPolicy Bypass -File core\windows\mccluster-node.ps1 -Report
```

`-Report` is the default when no switch is given. It prints, and ends with a pasteable block between
`=== MCCLUSTER NODE REPORT ===` and `=== END REPORT ===`:

- **GPU**: every PCI display adapter from `Win32_VideoController`, joined with the display class registry key
  (`HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\00NN`) by the longest
  `MatchingDeviceId` prefix of the adapter's PNP id, else by `DriverDesc` = name. The VRAM is the registry's
  `HardwareInformation.qwMemorySize` (a REG_QWORD); CIM's `AdapterRAM` is a 32-bit value that wraps above 4 GiB
  and the report says `AdapterRAM wrapped: yes` when it did. Vendor from the PNP `VEN_` id (1002 AMD, 10DE
  NVIDIA, 8086 Intel), then integrated (shared memory, "shared memory (APU)") or discrete (dedicated) from the
  name: a Radeon 780M is integrated, an RX 7600S is discrete. Basic Display, Remote Display and virtual adapters
  are listed as ignored, never as GPUs.
- **CPU** (name, cores, logical processors), **RAM** (total, free).
- **Volumes and partitions**: any volume or partition between 45,000,000,000 and 59,055,800,320 bytes is flagged
  `candidate 50 GB partition`. That is how the 50 GB partition the owner remembers is found; nothing is assumed.
- **Ollama**: `ollama --version`, the daemon's version, installed models with sizes, what is loaded with
  `size`, `size_vram`, the PROCESSOR share (`round(size_vram / size * 100)` % GPU) and `last load used the GPU:
  yes/no/unknown`, and the `inference compute` line from the tail of `%LOCALAPPDATA%\Ollama\server.log`
  (library, name, memory): that line says whether Ollama picked the Vulkan device.
- **Scheduled tasks** named `McCluster Node*`, the **node files** present under the state root, and the
  **environment**: every `MCCLUSTER_*`, `OLLAMA_*` and `GGML_VK_VISIBLE_DEVICES` name. A value is printed only for
  the non-secret `MCCLUSTER_*` names `-Install` writes (the compute URL, node name, paths, cadences, the Ollama
  model, map, keep-alives, context, port), for `OLLAMA_*` and for `GGML_VK_VISIBLE_DEVICES`; `MCCLUSTER_ORG_ID`
  is shown as `set (uuid)`; every other `MCCLUSTER_*` name, and any name that says token, key, secret, password
  or credential (the ecosystem has several such `MCCLUSTER_*` variables), is shown only as `set` or `unset`.

Masking: the user profile path becomes `%USERPROFILE%`, the computer name `<host>`, the user name `<user>`.
No token, key or unknown variable value is ever printed. Paste the block into the chat; the repository never
records the laptop's hostname, user name, local paths or addresses (`AGENTS.md`).

## 2. Model store on the 50 GB partition (optional)

```powershell
powershell -ExecutionPolicy Bypass -File core\windows\mccluster-node.ps1 -ModelsPath D:\ollama-models
```

Creates the folder if it is missing, sets the user variable `OLLAMA_MODELS`, prints the volume's free space, and
reminds you to restart the Ollama tray app (or sign out and in). `qwen3-vl:8b` (about 6.2 GB), `qwen3:8b` (about
5.2 GB) and `qwen3-vl:4b` (about 3.3 GB) fit on a 50 GB partition with room, and so does `qwen3:14b` (about 9.3 GB)
on a tier A machine. Models already pulled into the old store are not moved; pull again after the restart, or
move the `models` folder by hand first.

## 3. Pull the models

```powershell
powershell -ExecutionPolicy Bypass -File core\windows\mccluster-node.ps1 -Models
```

Pulls the tier's models: `qwen3-vl:8b` and `qwen3:8b` on tiers A, B and C, plus `qwen3:14b` on tier A only;
`qwen3-vl:4b` on tier D. `-Model <name>` adds one more pull, except `qwen3:14b` on tiers B, C and D, which is
refused (owner decision 2026-11-17: no 12B/14B model on a shared-memory machine). It warns when the daemon is
older than Ollama 0.12.7 (the vision models need it), and afterwards lists installed models with sizes from
`/api/tags`. `-Models` reads the tier from `node.config.json`; run `-Install` first, otherwise it pulls tier D's
`qwen3-vl:4b`.

## 4. Install

```powershell
powershell -ExecutionPolicy Bypass -File core\windows\mccluster-node.ps1 -Install -RepoPath <checkout> -OrgId <uuid> -WhatIf
powershell -ExecutionPolicy Bypass -File core\windows\mccluster-node.ps1 -Install -RepoPath <checkout> -OrgId <uuid>
```

`-WhatIf` prints every step and writes nothing; the second line does the work. `-NodeName` defaults to
`owner-windows-gpu` (the display name the Devices pane shows; `owner-windows-pilot` is the earlier identity) and
must be 1 to 64 letters, digits, dots, hyphens or underscores. `-Tier A|B|C|D` overrides the rule below and is
printed as `owner override`. `-StateRoot` moves the state folder (default `%ProgramData%\mccluster-node`).
`-OrgId` is needed the first time and kept in `node.config.json`. Because `-NodeName`, `-StateRoot`, `-RepoPath`
and `-ComputeUrl` are written into the cmd launchers the scheduled tasks run at every boot, `-Install` refuses a
value containing `& | < > ^ " % !`, a control character, or a leading or trailing space, before it writes anything.

It first prints `Tier <X> because <gpu name>, <form>, VRAM <n>, free RAM <n>` and every value it will set, then,
idempotently (re-running changes nothing that already matches):

1. creates `<StateRoot>` and `<StateRoot>\logs` with an owner-only ACL (`icacls /inheritance:r /grant:r
   "<DOMAIN\user>:(OI)(CI)F"`; best effort);
2. writes `<StateRoot>\capabilities.json` from `core/node-manifests/owner-windows-gpu.json` pruned to the tier
   (the template's four entries, the tier's own listed below; nothing else is edited);
3. writes `<StateRoot>\node.config.json` (node name, org id, compute URL, tier and reason, resident model, chosen
   GPU, repo path, state root, time; never a secret);
4. sets the user-scope variables: `MCCLUSTER_COMPUTE_URL`, `MCCLUSTER_ORG_ID`, `MCCLUSTER_NODE_NAME`,
   `MCCLUSTER_NODE_STATE_DIR`, `MCCLUSTER_NODE_MANIFEST`, `MCCLUSTER_NODE_POLL_MS=1000`,
   `MCCLUSTER_NODE_HEARTBEAT_MS=30000`, `MCCLUSTER_NODE_ENGINE_PROBE_MS=15000`, `MCCLUSTER_OLLAMA_URL`,
   `MCCLUSTER_OLLAMA_MODEL` (the tier's resident model, the adapter's default), `MCCLUSTER_OLLAMA_IMPLEMENTATIONS`
   (the tier's `id=model` map), `MCCLUSTER_OLLAMA_RESIDENT_MODELS` (always empty: exactly one resident model),
   `MCCLUSTER_OLLAMA_ON_DEMAND_KEEP_ALIVE=5m`, `MCCLUSTER_OLLAMA_CONTEXT`, `MCCLUSTER_OLLAMA_KEEP_ALIVE=24h`,
   `MCCLUSTER_OLLAMA_WARM_ON_START=true`, `MCCLUSTER_OLLAMA_ADAPTER_PORT=4790`, `OLLAMA_KEEP_ALIVE=24h`. Never
   `MCCLUSTER_OLLAMA_NUM_THREAD`: the CPU thread cap is the OVH node's tuning;
5. writes the launchers `<StateRoot>\adapter.cmd` and `<StateRoot>\agent.cmd` (`set NAME=value` for the same
   non-secret values, `cd /d <RepoPath>\core`, `node src\compute\…`, output appended to `<StateRoot>\logs`). A
   startup task without an interactive logon does not load HKCU, so the launchers carry the configuration
   themselves; the user-scope variables serve your own shell and the Ollama tray app;
6. registers the scheduled tasks "McCluster Node Adapter" and "McCluster Node Agent" (the agent 20 s after the
   adapter): triggers at startup and at your logon, principal the current user with logon type S4U and run level
   Limited, restart on failure 3 times a minute apart, no execution time limit, start when available, allowed on
   battery and not stopped on battery, a second start is ignored while one runs.

Then it says: run `-Enroll` next.

### Model tier rule

Decided from the chosen GPU (the discrete adapter when one is present, else the integrated one) and the free
physical memory at install time; `-Tier` overrides. The rule follows the owner's decision of 2026-11-17 (~20:25
UTC), headroom first: "i think I'll go with something that leaves us a bit more headroom so we dont fuck up the
machine and it can be a real persistent actor." One resident model on every tier, the vision model (vision, tools
and thinking; the agent model of slice N2), kept loaded as the adapter's default model; everything else on demand
with a 5 m keep-alive; no 12B or 14B model on a shared-memory machine; `qwen3:14b` on tier A only.

| Tier | Hardware | Resident (adapter default, 24h) | On demand (5m) | Manifest entries | Context |
| --- | --- | --- | --- | --- | --- |
| A | discrete, VRAM >= 12 GiB | `qwen3-vl:8b` | `qwen3:8b`, `qwen3:14b` | `qwen3-vl.8b.local`, `qwen3.8b.local`, `qwen3.14b.local` | 16384 |
| B | discrete, 6 GiB <= VRAM < 12 GiB | `qwen3-vl:8b` | `qwen3:8b` | `qwen3-vl.8b.local`, `qwen3.8b.local` | 16384 |
| C | integrated (shared memory), free RAM >= 8 GB at install | `qwen3-vl:8b` | `qwen3:8b` (not advertised when `-Benchmark -Model qwen3:8b` leaves under 4 GB free) | `qwen3-vl.8b.local`, `qwen3.8b.local` | 8192 |
| D | integrated with less free RAM, discrete < 6 GiB, or no GPU | `qwen3-vl:4b` | | `qwen3-vl.4b.local` | 8192 |

A Radeon 780M alone is tier C or D (the registry reports its UMA carve-out, typically 512 MiB to 2 GiB, while
inference uses shared system memory, so `min_vram_bytes` is 0 in the template and the headroom is proven by the
benchmark); a 780M with an RX 7600S is tier B (8 GiB discrete). The production heartbeat of 2026-11-17 02:54 UTC
showed 3.5 GB free of 16 GB with the owner's apps open: measured at that moment the rule says tier D, so close the
heavy apps before `-Install`, or force `-Tier C` and let `-Benchmark` decide. `qwen3.8b.local` is the OVH node's
implementation: one binding, one task, claimable on either node; `qwen3-vl.8b.local` and `qwen3-vl.4b.local` are
laptop only. Images in `ai.chat` are slice N2's work; today the resident vision model answers text.

## 5. Enrol

```powershell
powershell -ExecutionPolicy Bypass -File core\windows\mccluster-node.ps1 -Enroll
```

Asks for the enrolment token as a secure string (nothing is echoed), writes it to `<StateRoot>\enroll.env` with an
owner-only ACL, starts the adapter task if it is not running, and runs the agent once in the foreground with
`MCCLUSTER_NODE_ENROLL_ONLY=1` (120 s limit). The agent enrols (or finds an existing identity), prints
`compute_node_enroll_only_done` with the node id, and exits 0; the script then deletes `enroll.env`, starts the
agent task and prints `token removed from this machine; rotate CORE_COMPUTE_ENROLL_TOKEN on the Core (deploy-gated)`.
On any other exit it shows the agent's last lines (masked) and asks whether to keep the token file for a retry;
answer anything but `y` and it is removed. Exit code 2 means no token was entered.

The node then appears in the Devices pane with the display name from `-NodeName`. Identity: re-enrolling with a
fresh `identity.json` creates a new node; keeping the pilot's `identity.json` in the state root keeps the
`owner-windows-pilot` key under the new name and manifest. Whichever the owner chooses, the pilot's hand-written
label `hardware_mode: cpu-baseline-gpu-unverified` is superseded: the agent now derives `hardware_mode` itself
and overwrites that label every heartbeat.

## 6. Benchmark and evidence

```powershell
powershell -ExecutionPolicy Bypass -File core\windows\mccluster-node.ps1 -Benchmark
powershell -ExecutionPolicy Bypass -File core\windows\mccluster-node.ps1 -Benchmark -Model qwen3:8b
```

Measures the tier's resident model (or `-Model`). It reads the free physical memory, posts a fixed public prompt
(about 100 words, an operations brief into bullet points) to `/api/chat` twice with `temperature 0`, the tier's
`num_ctx`, `num_predict 256`, `keep_alive 24h` and `think: false` (for `qwen3` and `qwen3-vl` non-instruct
models), reads the free memory again once the first call has loaded the model, and measures the second call:
prompt tokens per second (`prompt_eval_count * 1e9 / prompt_eval_duration`), generation tokens per second
(`eval_count * 1e9 / eval_duration`), then the PROCESSOR share from `/api/ps` and the backend line from
`server.log`. It prints the free memory before and after, the rates and the share. The result, free memory
included, is merged atomically into `<StateRoot>\measured-inference.json` (schema
`mccluster-measured-inference/1`, one key per model, other models' entries kept). The node agent re-reads that
sidecar every 15 s and publishes it as `runtime.measured_inference_by_model` and `runtime.measured_inference`; the
capability registry ranks compute nodes by `hardware_mode`, then by measured generation tokens per second.

Then the owner's headroom rule (2026-11-17) is applied to the free memory the loaded model left, against a 4 GB
floor: the resident model under the floor **refuses the tier** (exit code 1, `capabilities.json` untouched, the
message names `-Install -Tier D`, or says that no lower tier is left); `-Model qwen3:8b` on tiers A, B and C decides
the on-demand twin: under the floor the `qwen3.8b.local` entry is removed from `capabilities.json`, with headroom
it is added back from the template (the agent re-reads the file within 15 s). `-Model qwen3:14b` is refused
before anything runs on tiers B, C and D. An unknown free-memory reading changes nothing and says so.

Expected on a 780M under Vulkan for an 8B model (community numbers, not a promise): about 15 to 28 tok/s
generation and about 300 tok/s prompt. The OVH node measures 8 to 13 tok/s generation and 20 to 30 tok/s prompt
on CPU.

## 7. Verify

- `-Report` again: both scheduled tasks `Running`, `capabilities.json`, `node.config.json`, `identity.json`
  present, `enroll.env` absent, the loaded model showing `100% GPU` (or the real split).
- `Invoke-RestMethod http://127.0.0.1:4790/health` answers with `gpu_evidence` (from the adapter's cached
  `GET /api/ps`); `http://127.0.0.1:4790/ready?implementation=qwen3.8b.local` answers 200 when the model is
  installed, 503 with `model is not installed` otherwise, 404 for an unknown implementation id. The template's
  health URLs are per implementation, so a missing `qwen3:14b` never takes the 8b entry down.
- Logs: `<StateRoot>\logs\agent.log` and `adapter.log`. The agent's first lines are `compute_node_paths`
  (where it reads and writes), then `compute_node_enrolled` or `compute_node_existing_identity`; a
  `compute_node_gpu_evidence` line appears when `hardware_mode` changes.
- In Control, the node's `hardware_mode` is `gpu-present-unverified` until a model has been seen loaded with
  `size_vram > 0` (the adapter warms the resident model on start; because its scheduled task starts before the
  Ollama tray app after a reboot, it retries every 30 s for 15 minutes until the daemon answers, each attempt in
  `adapter.log` as `ollama_adapter_warm`), then `gpu-verified`; it degrades back after 24 hours without evidence
  (`MCCLUSTER_NODE_GPU_EVIDENCE_TTL_MS`). The agent's full hardware discovery (PowerShell, `reg.exe`,
  `nvidia-smi`) runs at start and then every 10 minutes (`MCCLUSTER_NODE_HARDWARE_REFRESH_MS`); the 15 s probe is
  the loopback health read only.
- A task: submit `ai.chat` from Control; the laptop polls every 1000 ms and the OVH node every 5000 ms, so the
  laptop normally claims first when both are online. The task row's `locked_by_node_id` and the lease say who ran
  it.

## 8. Keep the laptop awake (administrator, explicit opt-in)

```powershell
Start-Process powershell -Verb RunAs -ArgumentList '-ExecutionPolicy Bypass -File core\windows\mccluster-node.ps1 -KeepAwake'
```

Without administrator rights `-KeepAwake` prints exactly that elevated command and exits 1. With them it prints the
current AC standby and hibernate timeouts, sets both to 0 (`powercfg /change standby-timeout-ac 0` and
`hibernate-timeout-ac 0`), and prints them again. It changes nothing about the lid-close action or battery
behaviour; the scheduled tasks are allowed to start and continue on battery. If the node should sleep when the
owner closes the lid, or should not run on battery, say so and the install changes.

## 9. Mixed integrated and discrete GPUs

```powershell
powershell -ExecutionPolicy Bypass -File core\windows\mccluster-node.ps1 -Vulkan 1
```

Prints the adapters with their indexes in CIM order and sets the user variable `GGML_VK_VISIBLE_DEVICES` to the
chosen index, so Ollama's Vulkan backend uses the discrete card and not the APU. Restart the Ollama tray app
afterwards. `-Report` shows the variable and the `inference compute` line that proves which device was picked.

## How work reaches the laptop

- The laptop advertises `ai.chat/qwen3-vl.8b.local` (the resident vision model, laptop only) and
  `ai.chat/qwen3.8b.local` with the OVH node's exact input and output schema (the drift check holds every template
  entry to it byte for byte) plus the features `gpu: true` and `model_tier`, so one binding and one task are
  claimable on either node; the scheduler is first-poller-wins, and the laptop's 1000 ms poll against the OVH
  node's 5000 ms is the Tier-1 preference. `ai.chat/qwen3.14b.local` exists on tier A only and
  `ai.chat/qwen3-vl.4b.local` on tier D. For Core's fabric-first executors (Tier 2, below) set
  `MCCLUSTER_LOCAL_AI_FABRIC_IMPLEMENTATION=qwen3-vl.8b.local` on the Core when the resident model should answer
  them; the default `qwen3.8b.local` would load the on-demand twin instead.
- `max_leases` is 1 and each entry's `max_concurrency` is 1: one Ollama with one slot serialises anyway, and two
  leases could load both models together and thrash shared memory. With a 1 s poll the laptop re-claims the
  moment it finishes.
- The capability registry ranks compute bindings by economics first, then `hardware_mode` (gpu-verified above
  gpu-present-unverified above cpu-only), then measured generation tokens per second, and falls back to the next
  candidate on `COMPUTE_NO_LIVE_NODE` or `COMPUTE_ENQUEUE_FAILED`. When the laptop is offline (3 minutes without
  a heartbeat), the OVH node is the only live node and runs the work.
- Tier 2, code behind configuration and not on in production: Core's own executors can go fabric-first
  (`MCCLUSTER_LOCAL_AI_FABRIC=prefer`) to a live `gpu-verified` node with a bounded wait and a local fallback; and
  a CPU node can leave fresh tasks to a live GPU node for `MCCLUSTER_NODE_YIELD_TO_GPU_MS` once the pending,
  owner-approved claim SQL (`compute_claim_task` with `p_yield_seconds`) is promoted. Neither changes the laptop.

## Troubleshooting

- **`hardware_mode` stays `gpu-present-unverified`**: no model has been seen loaded with `size_vram > 0`. Check
  `-Report`'s loaded line and the `inference compute` line; if Ollama runs the model on CPU, update the GPU
  driver, set `-Vulkan` on a mixed system, and make sure `OLLAMA_VULKAN` is not `0`.
- **`AdapterRAM wrapped: yes`** is expected on any card with more than 4 GiB; the report and the agent use the
  registry's REG_QWORD, so nothing is wrong.
- **Scheduled task registration fails with a logon-type or privilege error**: S4U needs the "Log on as a batch
  job" right (local accounts have it by default; some managed or Microsoft-account setups do not). Open Task
  Scheduler, change both tasks to "Run only when user is logged on", or grant the right and re-run `-Install`.
- **The task shows an execution time limit** although the install set none: Task Scheduler on some builds shows
  the default 3 days for a zero limit. Open the task, Settings, and clear "Stop the task if it runs longer
  than".
- **`/ready?implementation=<id>` is 503** with `model is not installed`: that model is not pulled yet (`-Models`);
  the other entries stay up, since readiness is per implementation.
- **`-Models -Model qwen3:14b` or `-Benchmark -Model qwen3:14b` is refused**: the node is tier B, C or D; the
  owner's decision of 2026-11-17 keeps 12B and 14B models off a shared-memory machine. Only a discrete card with
  12 GiB or more (tier A) runs it, on demand.
- **`-Benchmark` ends with `tier C is refused` and exit code 1**: the resident model left the machine under 4 GB
  free. Close the heavy apps and benchmark again, or `-Install -Tier D` for the smaller vision model. When
  `-Benchmark -Model qwen3:8b` says the twin is not advertised, `qwen3.8b.local` was removed from
  `capabilities.json`; the OVH node keeps serving that implementation and the laptop keeps `qwen3-vl.8b.local`.
- **`-Install` refuses the node name or a path**: `-NodeName`, `-StateRoot`, `-RepoPath` and `-ComputeUrl` go into
  the cmd launchers, so `& | < > ^ " % !`, control characters and edge spaces are refused before anything is written.
- **The agent exits with 2 during `-Enroll`**: no token reached it (empty input). Exit 1: read the masked lines,
  most often a wrong `-OrgId`, an expired token, or the Core ingress unreachable.
- **Ending the task from Task Scheduler is a hard kill**: the agent gets no signal, its running lease is not
  renewed and expires within 120 s, and the task requeues for the next claim (the OVH node, or the laptop when it
  is back). From a console, Ctrl+C (SIGINT) or Ctrl+Break (SIGBREAK) drains for up to 30 s first.
- **Ollama ignores a new variable**: Ollama reads user variables at start; quit the tray app and start it again.
- **The script will not run**: use the `-ExecutionPolicy Bypass -File …` form above; the script needs no module
  and installs nothing.

## Privacy, and what the node sends to the Core

The agent sends, signed, on enrolment and every heartbeat: the machine's hostname (`os.hostname()`), platform
and architecture, CPU count, total memory, free disk of the state root's drive, the GPUs (model, `pnp:` id or
`nvidia-smi` UUID, VRAM, driver, compute, form, memory, VRAM source), the runtime (Node version, kernel, agent
version, `hardware_mode`, the probe summary without paths, the engine evidence, `gpu_verified_at`, the measured
inference), the advertised capabilities (never the executor URLs), the labels and the load. It never sends the
token after bootstrap, a file's contents, or a user name. That inventory lives in `ops_compute_nodes` and is read
by the Devices pane; this public repository records none of it (`DEVICE-NODES-AND-OWNER-GPU.md`). The pasteable
report is the only thing meant to leave the laptop by hand, and it is masked.

## Files on the laptop

Under `%ProgramData%\mccluster-node` (or `-StateRoot`): `capabilities.json` (the pruned template),
`node.config.json` (no secrets), `identity.json` (the node's key, owner-only), `gpu-evidence.json` (the last
positive engine observation, 24 h TTL), `measured-inference.json` (from `-Benchmark`), `adapter.cmd`,
`agent.cmd`, `logs\adapter.log`, `logs\agent.log`, and `enroll.env` only during `-Enroll`.

## Tests, and what is verified where

- `node --test scripts/test/windows-node-script.test.mjs` (runs on every PR): static checks on the script (every
  switch, `SupportsShouldProcess`, the library guard, no downloads or evaluation, Windows-only cmdlets only
  inside functions, no private strings, balanced brackets), the fixtures, and this runbook; then, **only where a
  `pwsh` is executable** (on PATH, or named by `MCCLUSTER_PWSH`), the PowerShell parse and
  `core/windows/tests/mccluster-node.tests.ps1`. Where none is, it prints
  `windows-node-script: pwsh not available, PowerShell tests skipped (unverified here)` and skips: a skip is not
  a pass.
- `node --test scripts/test/node-manifests.test.mjs`: the template through the protocol, schema parity with the
  OVH node, loopback executors, `min_vram_bytes 0`, `max_leases 1`, labels, no private strings, and the drift
  check (`node scripts/control-plane-drift-contract-check.mjs`, which now reads the template too).
- `core/windows/tests/mccluster-node.tests.ps1` (Pester-free): the tier matrix (the 8 GB free-memory line, the
  one resident model per tier, `qwen3:14b` on tier A only), REG_QWORD conversion from Int64 and `0x…` strings, GPU
  selection over the recorded fixtures (780M only, 780M with RX 7600S, an RTX 4070, Basic Display only, a stale
  driver subkey beside the live one), report masking (the user path, host and user name; values printed only for
  the allowlisted names; every token, key, password and unknown `MCCLUSTER_*` name as set/unset; the organization
  id as a uuid), launcher values inert for cmd.exe and `-Install` refusing a hostile node name before it writes,
  manifest rendering per tier from the real template and its idempotence, the benchmark math (`eval_count 256`
  over `1.28e10` ns is 20 tok/s) with the free memory before and after, the headroom verdicts (tier stands, tier
  refused with the next tier named, twin pruned or advertised, unknown reading changes nothing), the sidecar merge,
  `-Install -WhatIf` writing nothing, a real install into a temporary state root run twice, and `-Benchmark`
  against a mocked daemon and memory readings (exit 0, twin pruned, twin back, tier refused with exit 1,
  `qwen3:14b` refused). On the laptop:

  ```powershell
  powershell -ExecutionPolicy Bypass -File core\windows\tests\mccluster-node.tests.ps1
  ```

  Paste the last lines (`mccluster-node.tests.ps1: N passed, M failed`) into the chat. Until that has run on a
  Windows machine, every claim about the doctor's behaviour on Windows is unverified.
