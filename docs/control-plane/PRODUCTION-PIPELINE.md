# Production pipeline (`mccluster-production/1`)

Script, performance capture, reaction editing, assets, Blender and Unreal run
as one job service inside McCluster Core. Creator Suite and the MCP call the
same named tools; owned machines run the engines. There is no second backend,
no new Worker and no new queue: production jobs are records on top of the
existing signed compute protocol (`COMPUTE-NODE-PROTOCOL.md`).

```
Creator Suite ─┐                          ┌─ Prime   production.render.unreal   (UE 5.8 MRQ)
               ├─ core.production.* ──► service ──► ops_compute_tasks ──► node agent ─┤          production.render.blender  (fallback)
MCP (edge) ────┘   (actor stamped)     (authz, idempotency,  (lease, heartbeat,   └─ Shiloh  production.facetrack.mediapipe
                                         consent, retakes)    cancel, retries)               production.transcript.whisper
```

## Pieces

| Piece | File |
| --- | --- |
| Contract: schemas, normalization, hashing, job keys, retake planning, status mapping, output validation | `core/src/production/contract.mjs` |
| Service: project authorization, consent, submit/status/cancel/artifacts | `core/src/production/service.mjs` |
| Store: Supabase tables (and an in-memory twin for tests and offline runs) | `core/src/production/store.mjs` |
| Named tools (9) | `core/src/tools/production.mjs`, catalog `core/capabilities/catalog.json`, edge allowlist `workers/mccluster-mcp/src/mcp.js` |
| Node executor (loopback HTTP, `127.0.0.1:4792`) | `core/src/production/executor.mjs` |
| Offline runner (same service + executor, local ledger) | `core/src/production/local-run.mjs` |
| Engine adapters | `tools/production/blender/export_shot.py`, `tools/production/blender/render_shot.py`, `tools/production/unreal/mcc_build_shot.py`, `tools/production/shiloh/transcript.py` |
| Node manifests | `core/node-manifests/prime-production.json`, `core/node-manifests/shiloh-production.json` |
| Executor config examples | `core/production-executor.prime.example.json`, `core/production-executor.shiloh.example.json` |
| Tables + cancel RPC (pending, not applied) | `supabase/pending/production_pipeline_v1.sql` (+ rollback) |

## Tools

All are `local-control` bindings in the catalog, reachable over the edge MCP
for the house org only. The actor comes from the broker (the edge stamps it);
an `actor` in the arguments is refused. None takes a command, script, path to
run or code: the agent gets named actions only.

| Tool | Risk | What |
| --- | --- | --- |
| `core.production.project.get` | read | project, members, assets, consents, shots |
| `core.production.asset.lookup` | read | registered assets by kind/query |
| `core.production.shot.validate` | read | normalize + validate a shot manifest; returns errors, warnings, manifest hash, job key; queues nothing |
| `core.production.render.submit` | write | queue one shot (or `retake_of` + `changes` for a retake of that one shot) |
| `core.production.job.get` | read | status, attempts, worker, engine version, progress, checks, playback, outputs |
| `core.production.job.cancel` | write | queued: canceled atomically; running: cancel requested, the node stops on its next heartbeat |
| `core.production.artifact.get` | read | artifacts a job produced (paths, sha256, sizes) |
| `core.production.facetrack.submit` | write | MediaPipe face curves for a consented range of a registered take |
| `core.production.transcript.submit` | write | Faster Whisper transcript of a registered recording (needs microphone or transcript consent) |

Roles: the org owner, then `production_members` (`editor` submits and
cancels; `viewer` reads). Anyone else gets 403.

## Contract

`mccluster-shot-render/1` (input) and `mccluster-render-output/1` (result);
`mccluster-facetrack/1`, `mccluster-transcript/1`, `mccluster-shot-export/1`.

- **Versioned inputs.** The manifest names the master by project-relative path
  and sha256; the executor refuses to run when the file on the node is not
  that version, and refuses again if the master changed during the job
  (adapters never save it: the Blender master stays editable).
- **Paths.** Project-relative only (`..`, absolute, drive and backslash paths
  are refused); the executor re-checks containment after resolving symlinks.
- **Idempotency.** Job key = `render:<project>:<shot>:t<take>:<hash24>` of the
  normalized manifest; the compute idempotency key is derived from it. The
  same manifest returns the same job (`replayed: true`); a different manifest
  under the same key is a 409.
- **Bounded retries.** 1–3 attempts. Retryable executor failures (an incomplete
  frame count, a missing tool) are 503 to the node agent; contract, version
  and path errors are final.
- **Cancellation.** Queued: one transition to `canceled`. Running:
  `production_request_compute_cancel` marks the task; the compute gateway
  answers the holder's heartbeat with `cancel_requested: true`; the lease
  runtime aborts the executor (process tree killed) and reports a final,
  non-retried failure `CANCELED: ...`.
- **Progress.** The node agent reads the executor's `/progress?job_id=` and
  sends it, bounded, with each heartbeat (`ops_compute_leases.progress`).
- **Retakes.** `retake_of` must name a render job of the same project and
  shot; the take number is one above the highest take of that shot; only
  source, audio, actors, checks, note, engine, resolution and frames may
  change. Nothing else is queued.
- **Consent.** A performance on an actor needs `performance` or `render` in
  that actor's unrevoked consent; face tracking needs `face_tracking`;
  transcripts need `microphone` or `transcript`. A stand-in pose with no
  consent is a warning, not a performance.
- **Storage.** Files stay on the owned node under the project root
  (`renders/<engine>/<shot>/tNNN/`, `exports/<export id>/`,
  `jobs/<job id>/worker.log`, `unreal/McCPreviz/`). Supabase holds only rows:
  paths, sha256, sizes, the node. Nothing is uploaded.

## Unreal path (Prime)

1. **Detect.** `Engine/Build/Build.version` under `unreal_root`; the adapter
   supports 5.4–5.8 and needs the Python and Movie Render Pipeline plugins.
   Prime has 5.8.4 (CL 58902052).
2. **Export** (Blender, headless, master read-only): set FBX (world space,
   the set root's descendants), one FBX per moving part, per-frame transforms
   in Unreal space (cm, left-handed: `(x, y, z) → (100x, −100y, 100z)`),
   camera with filmback and focal length, lights, and per-frame measurements
   (head and phone in camera NDC, phone-to-face and hand-to-phone distance).
3. **Build** (`UnrealEditor-Cmd.exe <uproject> -ExecutePythonScript=mcc_build_shot.py`):
   legacy FBX import (Interchange off) with a bounds check against the export
   (scale), a level, a Level Sequence with transform and visibility tracks, a
   CineCamera and a camera cut; framing and phone-grip checks re-measured from
   the keys read back; an MRQ queue saved to a manifest.
4. **Render** (`UnrealEditor.exe <uproject> <map> -game -MoviePipelineConfig=<queue>`):
   PNG frames; the frame count must match.
5. **Encode and verify**: ffmpeg H.264 + the line's audio at its offset,
   then ffprobe and a full decode. Timing passes when the preview is the
   manifest's duration within 1.5 frames and decodes cleanly.

The Blender fallback (`production.render.blender`) renders the same shot
from the master with the cut's visibility held on the handles, and is what
runs offline when Unreal is not available.

## Running it on Prime

Prerequisites: Node 22, Blender 5.3, Unreal 5.8, ffmpeg. Use a separate
worktree of this branch so the uncommitted Ultimate Studio work on
`feat/equitynet-studio` is not touched:

```powershell
cd C:\Users\<you>\.copilot\repos\mccluster
git fetch origin claude/project-thread-rmz3xj
git worktree add ..\mccluster-production origin/claude/project-thread-rmz3xj
cd ..\mccluster-production
copy core\production-executor.prime.example.json $env:LOCALAPPDATA\McCluster\production-executor.json
# edit: project root, ffmpeg/ffprobe paths
```

**Offline (works today, no migration needed).** `project.json` is the
project record (assets with sha256, consents, the s31 shot); `shot.json`
is the s31 manifest:

```powershell
$cfg = "$env:LOCALAPPDATA\McCluster\production-executor.json"
node core\src\production\local-run.mjs $cfg --project project.json --manifest shot.json --engine unreal
node core\src\production\local-run.mjs $cfg --project project.json --retake <job id> --note "retake"
node core\src\production\local-run.mjs $cfg --project project.json --status <job id>
```

Each prints the job: ID, status, attempts, worker, engine version, checks,
playback, output paths, and the Unreal project, map and Level Sequence. The
ledger is `<project>\jobs\local-ledger.json`.

**Online (after the migration is applied with the owner's approval).** Run
the executor and the node agent; jobs then come from Creator Suite or the MCP:

```powershell
$env:MCCLUSTER_PRODUCTION_CONFIG = "$env:LOCALAPPDATA\McCluster\production-executor.json"
node core\src\production\executor.mjs          # 127.0.0.1:4792 (/ready, /progress, /execute)
# merge core\node-manifests\prime-production.json into the node's
# %ProgramData%\mccluster-node\capabilities.json (WINDOWS-NODE.md), then restart the node agent
```

Shiloh is the same with `production-executor.shiloh.example.json` and
`shiloh-production.json`; `facetrack_script` points at Ultimate Studio's
`reaction_worker.py` where it is installed.

## PR #872 and Ultimate Studio

Draft PR #872 (Table Read and the Prime tools for the Get It Back cut) and
the uncommitted Ultimate Studio work on Prime touch different files. They
overlap in purpose: both align takes, extract face curves and rerender a
retake. This pipeline does not copy either. It is the job layer around them:

- Ultimate Studio stays the local runtime. Its `reaction_worker.py` is the
  face-track adapter by configuration (`tools.facetrack_script`), with the
  same arguments it takes today.
- PR #872's Blender conform and the finished 60-second episode stay a separate
  Blender deliverable: the 60-second episode keeps its own production folder
  on Prime and is registered as its own `master` asset. Nothing here opens or changes it; it can continue in Blender.
- PR #872 and the deployment are untouched by this branch.

## What is verified, simulated and blocked (2026-11-28)

| Check | State |
| --- | --- |
| Contract, service, tools, retries, cancel, retake scoping | tests (`npm run test:production`), core suite 949/949 |
| Edge allowlist for the nine tools | Worker tests |
| Tables and cancel RPC | applied, exercised, rolled back and re-applied on a disposable Postgres 16 with stubs; **not applied** in Supabase |
| Blender export of s31 from the v3 master | ran in the cloud on the bpy 5.3 wheel; master hash unchanged |
| Blender fallback end to end (service → queue → executor → Blender → ffmpeg → ffprobe → status), take 1 and a retake | **cloud run**: Workbench (no GPU), no audio, in-memory queue; both takes 120 frames, 5.000 s, 720×1280, decode clean; retake rendered `t002` only |
| Unreal export → build → MRQ → preview | **simulated** in tests (runner writes the files); the real run is **blocked** until Prime |
| Shiloh face-track and transcript dispatch | contract and executor only; **blocked** until Shiloh |
| OVH rendering | **unverified**; OVH coordinates (Core, gateway), it does not render |
