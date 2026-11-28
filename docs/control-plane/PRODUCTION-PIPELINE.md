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
| Engine adapters | `tools/production/blender/export_shot.py`, `tools/production/blender/render_shot.py`, `tools/production/unreal/mcc_build_shot.py`, `tools/production/unreal/mcc_render_sequence.py` (in-editor Movie Render Queue), `tools/production/shiloh/transcript.py` |
| Unreal sequence mode: owner registry, GPU from the engine log, project copy, fresh output folder | `core/src/production/unreal-sequence.mjs` |
| Find the proven render on Prime (read-only) | `tools/production/unreal/find-proven-render.ps1` |
| Production staging: isolated Core, signed worker, production API, proof | `scripts/staging/production/` (`serve.mjs`, `worker.mjs`, `production-api.mjs`, `client.mjs`, `prove.mjs`) |
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
4. **Render** in the editor's own queue (`UnrealEditor.exe <uproject>
   -ExecutePythonScript=mcc_render_sequence.py -d3d12 ...`): the script builds
   the queue in memory and runs it with the PIE executor, as "Render (Local)"
   does. The old `-game -MoviePipelineConfig=<queue>` launch failed on Prime
   parsing its queue manifest and is no longer used. PNG frames; the frame
   count must match and the engine log must show the GPU (below).
5. **Encode and verify**: ffmpeg H.264 + the line's audio at its offset,
   then ffprobe and a full decode. Timing passes when the preview is the
   manifest's duration within 1.5 frames and decodes cleanly.

### Sequence mode: the proven s31 path

A job may instead name an **approved Unreal project and Level Sequence by
id** and the shot range, with no master and no export:

```json
{ "project_id": "get-it-back", "shot_id": "s31", "take": 1, "engine": "unreal",
  "frames": { "start": 0, "end": 119, "fps": 24 }, "resolution": { "width": 720, "height": 1280 },
  "unreal": { "project_id": "gib-s31-proof", "sequence_id": "s31-standin" }, "checks": { "expect_duration_s": 5 } }
```

- **Approval, twice.** Core accepts it only when the project has an approved
  `unreal_sequence` asset with that id, whose metadata names the Unreal
  project, the shots and the frame range. The worker maps the ids through
  its owner's `unreal_projects` registry (executor config) to a `.uproject`,
  a `/Game/` map and sequence, and a few bounded settings (anti-aliasing
  samples, warm-up counts). The job carries no path, no map, no argument
  and no command. A retake keeps the same ids (`RETAKE_SCOPE` otherwise).
- **The working project is preserved.** With `isolate: "copy"` (default)
  each job renders a copy under `jobs/<job id>/unreal-project/` (without
  `Saved`, `Intermediate`, `DerivedDataCache`); the approved project is
  never opened, and its fingerprint before and after is a check
  (`project_preserved`).
- **A new output folder every run**:
  `renders/unreal/<shot>/tNNN-<job8>-<UTC stamp>/` (frames, preview MP4,
  checks). A retry or a retake never writes over an earlier render.
- **The GPU, from the engine's own log.** The editor is started with
  `-d3d12`; `unreal_render.log` must show the D3D12 RHI and the chosen
  adapter, which must contain `require_adapter` (Prime: `Radeon`). A
  Microsoft Basic Render Driver / WARP adapter, a Null RHI or no adapter
  line fails the job with `GPU_NOT_VERIFIED`, final and never retried:
  there is no silent CPU fallback, and an Unreal job never falls back to
  Blender.
- **Exit is not success.** The job succeeds only when the script's result
  file names this job and says the queue finished successfully, the folder
  holds exactly the expected contiguous frames, the device check passed,
  the project is unchanged, and the encoded preview decodes to the frame
  count, duration and resolution of the manifest. Otherwise:
  `UNREAL_NO_RESULT`, `UNREAL_RENDER_FAILED` or `RENDER_INCOMPLETE`
  (retryable within the job's 1–3 attempts), or a failed job whose checks
  say why.
- **What the job reports**: Unreal version and changelist, the device (RHI,
  adapter, vendor id, driver, the log lines), the approved ids and object
  paths, `output_dir`, and `preview` (path, sha256, frames, duration, size).
  `progress` (frames on disk / total) rides the lease heartbeat while the
  job runs.

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

## Creator Suite contract

Creator Suite needs three calls. Against the production staging they are
plain HTTP on loopback (`scripts/staging/production/production-api.mjs`;
the same actions as `core.production.*` over the Core MCP). Every call
sends `Authorization: Bearer <owner.token from the staging run dir>` and
`X-McCluster-Client: creator-suite`; the API stamps the owner and the
staging org, never the caller.

| Step | Request | Read |
| --- | --- | --- |
| Submit | `POST /v1/production/tools/core.production.render.submit` `{"manifest": {…s31…}}` | `job.id`, `job.status` (`queued`); the same manifest again returns the same job (`replayed: true`) |
| Progress | `GET /v1/production/jobs/<id>` every 2 s | `job.status`, `job.worker.node_id`, `job.progress.frames_done / frames_total`, `job.progress.step`, `job.attempts`; on `succeeded`: `engine_version`, `device`, `output_dir`, `preview` |
| Open | `POST /v1/production/jobs/<id>/preview-ticket` | `url` (playable for 10 minutes, Range requests, `video/mp4`) and `path` (the file on this machine) |
| Retake | `POST /v1/production/tools/core.production.render.submit` `{"retake_of": "<id>", "changes": {"note": "…"}}` | a new job, take + 1, same shot |

The preview is served only for a succeeded job, only from a production
project root the staging was started with (`--media-root`), and only when
the file's sha256 is the one the worker reported. `scripts/staging/
production/client.mjs` is this contract in JavaScript.

## Production staging: the s31 proof on Prime

An isolated Core on Prime, loopback only: PGlite in memory with the compute
SQL and the **pending** `production_pipeline_v1.sql` (applied there only),
the real compute gateway behind a self-signed TLS ingress, and the
production API. The worker is the real node agent (signed protocol, its own
state folder) and the production executor. Nothing touches Supabase, the
OVH Core, Cloudflare or production; production's schema drift and the
migrations recorded in draft PR #877 are not involved.

Prerequisites on Prime: Node 22, Git for Windows (for `openssl`), ffmpeg and
ffprobe, UE 5.8.4. Work in a separate worktree so uncommitted work on Prime
is not touched:

```powershell
cd C:\Users\<you>\.copilot\repos\mccluster
git status --short                       # note any local work; it stays where it is
git fetch origin claude/relaxed-bardeen-p395y8
git worktree add ..\mccluster-s31-proof origin/claude/relaxed-bardeen-p395y8
cd ..\mccluster-s31-proof
npm install --prefix $env:TEMP\mcc-pglite --no-audit --no-fund @electric-sql/pglite@0.5.17
```

1. Find the proven render (read-only) and fill the executor config:

   ```powershell
   powershell -ExecutionPolicy Bypass -File tools\production\unreal\find-proven-render.ps1
   copy core\production-executor.prime.example.json $env:LOCALAPPDATA\McCluster\production-executor.json
   ```

   Put the report's `suggested_executor_entry.unreal_projects` into the config
   (the isolated project copy that rendered the proof, its map and Level
   Sequence, frames 0–119), and the ffmpeg/ffprobe paths. Check map,
   sequence and samples against the queue that rendered the proof.

2. Start the staging (window 1):

   ```powershell
   $env:PGLITE_MODULE_PATH = "$env:TEMP\mcc-pglite\node_modules\@electric-sql\pglite\dist\index.js"
   $env:OPENSSL_BIN = "C:\Program Files\Git\usr\bin\openssl.exe"
   node scripts\staging\production\serve.mjs --run-dir $env:TEMP\mcc-s31-staging --seed scripts\staging\production\get-it-back-s31.seed.json --media-root $env:LOCALAPPDATA\McCluster\Productions\get-it-back
   ```

3. Start the worker (window 2). Close the Unreal editor first, and make sure
   nothing else listens on 127.0.0.1:4792:

   ```powershell
   node scripts\staging\production\worker.mjs --run-dir $env:TEMP\mcc-s31-staging --state-dir $env:TEMP\mcc-s31-node --executor-config $env:LOCALAPPDATA\McCluster\production-executor.json --name prime
   ```

   Its first line shows the executor's Unreal version and the approved ids;
   `%TEMP%\mcc-s31-node\node-agent.log` shows `compute_node_enrolled`.

4. Submit from Creator Suite: point its Core (staging) profile at the
   `production_api` URL in `%TEMP%\mcc-s31-staging\staging.json` with the owner
   token from `owner.token`, submit `scripts/staging/production/
   s31-proof.manifest.json`, watch progress, open the preview; then submit
   one retake with one change. Note both job ids.

5. Verify (window 3):

   ```powershell
   node scripts\staging\production\prove.mjs --run-dir $env:TEMP\mcc-s31-staging --out $env:TEMP\mcc-s31-proof --job <take 1 id> --retake-job <retake id>
   ```

   Without `--job`/`--retake-job` the script submits both itself and the proof
   says `proof-cli (NOT Creator Suite)`. `PROOF.md` lists, per job: the node
   that claimed it, Unreal version, GPU and the log lines, the new output
   folder, the preview path, ffprobe's count of decoded frames, the hash, the
   app's ticketed URL fetch, and for the retake that only s31 rendered again
   and take 1 is untouched.

6. Stop: create `stop` in `%TEMP%\mcc-s31-node` and in `%TEMP%\mcc-s31-staging`.
   The staging database ends with it; renders stay in the project folder.

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
| Unreal export → build → in-editor MRQ → preview | **simulated** in tests (runner writes the files); the real run is **blocked** until Prime |
| Sequence mode: approval (Core and node), GPU from the log, no software fallback, exit ≠ success, fresh folders, project preserved | tests (`test/production-unreal-sequence.test.mjs`, simulated editor) |
| Staging chain on real code: production API → service → PGlite/PostgREST → real gateway (TLS) → real node agent (signed) → executor → ffmpeg → job.get → ticketed preview; take 1 and one retake | **cloud run, SIMULATED editor** (2026-11-28): a stand-in `UnrealEditor` drew test frames with ffmpeg and wrote a log naming "AMD Radeon (SIMULATED)"; both takes 120 frames counted by ffprobe, 720×1280, 5.000 s, no audio; progress 61/120 seen over the heartbeat; retake rendered s31 t002 only into a new folder. Not Unreal, not Prime, not Creator Suite |
| s31 in Unreal on Prime through Core, submitted from Creator Suite | **not run**: needs Prime (steps above) |
| Shiloh face-track and transcript dispatch | contract and executor only; **blocked** until Shiloh |
| OVH rendering | **unverified**; OVH coordinates (Core, gateway), it does not render |
