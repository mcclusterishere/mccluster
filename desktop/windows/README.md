# McCluster for Windows 0.2.0: the live site in a desktop window, plus a local compute panel

Status: built and run on one owner Windows device on 2026-11-22 with the in-box compiler
(`build-inbox.ps1`). The SDK project (`src/McClusterDesktop.csproj`) is unchanged in shape from the
0.1.0 preview and is **not yet built on this branch** (no .NET SDK was available on the build device).
A signed release, an installer for 0.2.0 and the remote/pooled flows below are **not** claimed.

## What it is

The 0.1.0 preview (McCluster for Windows, WinForms + Microsoft WebView2 Evergreen) opens the live
site. 0.2.0 keeps that shell byte-for-byte in behaviour, adds nothing to the web side, and adds one
native **Compute** panel beside the web view. UI parity is kept by reusing the site's own routes:
sign-in, the owner's Ask McCluster surface (`control.html#home:ask`) and every role check are the
site's; the shell never bridges the WebView2 session into native code (`AreHostObjectsAllowed` and
`IsWebMessageEnabled` stay off, as in 0.1.0), never stores credentials and never calls a hosted
inference API.

Three things stay distinct, and the panel labels each one:

| Layer | What the panel reads | Where it runs |
| --- | --- | --- |
| OVH Core | `https://api.mccluster.org/v1/health` (Worker `mccluster`, shows `deployment_sha`) and `https://compute.mccluster.org/health` (the Core compute gateway through its tunnel) | OVH |
| Local model runtime | Ollama on loopback: `/api/version`, `/api/tags`, `/api/ps`; a loaded model with `size_vram > 0` is the GPU evidence, the same rule as the node agent | this device |
| Node agent (worker) | `%ProgramData%\mccluster-node` (or `MCCLUSTER_NODE_STATE_DIR`): manifest, config, identity presence, the loopback adapter's `/health`. The identity file is never read or shown | this device, installed only by the owner with `core\windows\mccluster-node.ps1` |

The desktop client itself is a **client**. Making the device a **worker** is the doctor's job
(`docs/control-plane/WINDOWS-NODE.md`); the panel reports that state and never installs or enrols.

## Run on: three choices, honestly labelled

- **This device**: `local.inventory` (hash every file under a sample folder; needs no model) and
  `ai.chat` (one completion on an installed local Ollama model). `ai.chat` is disabled, with the
  reason, when Ollama is down or no model is installed: local inference is never claimed without one.
- **One remote worker (through the OVH Core)**: enabled only while both Core probes answer. Submission
  happens in the site's signed-in Ask McCluster surface (`core.ai.turn.submit`), which the Core stores
  (`ops_agent_jobs`, `ops_compute_tasks`) and streams back with the worker receipt. The panel copies the
  draft to the clipboard and opens that route; it does not and cannot submit natively.
- **Verified shared-model group**: shown, and unavailable until the owner surface lists two verified
  members with a pair benchmark (the owner workspace branch, PR #821, not promoted).

Fallback policy, printed in the panel: while the Core is unreachable only local jobs run; drafts and
receipts stay under `%LOCALAPPDATA%\McClusterDesktop`; nothing is queued for later automatic remote
submission; no hosted inference API stands in for an owned device.

## Local jobs, receipts and reconnect safety

`%LOCALAPPDATA%\McClusterDesktop\jobs\job_<32 hex>.json`, schema `mccluster-desktop-job/1`, written
atomically. States: `queued → running → done | failed`; a job found `running` whose owner process is
gone becomes `interrupted` at the next start, keeping its input, progress and partial receipt. The
receipt (`mccluster-desktop-receipt/1`) records the device inventory in the compute protocol's shape
(`validateInventory`), `hardware_mode`, the Ollama version and installed models, timings, the SHA-256 of
the result, `evidence_scope: local_device_only` and `hosted_inference_used: false`. Drafts persist in
`drafts\current.json`; events go to `logs\desktop.log` as one JSON object per line.

This ledger is for work that ran on this device. Work submitted to the Core is the Core's ledger; the
site shows it. The two are never merged.

## Headless modes (for verification, not for use)

```powershell
McCluster.exe --status-json --out status.json
McCluster.exe --run-local-inventory <folder> --out job.json
McCluster.exe --run-local-chat "<prompt>" --model <installed model> --out job.json
McCluster.exe --jobs-json --out jobs.json      # also runs the interrupted-job recovery
```

## Build

- Ordinary: `dotnet build src/McClusterDesktop.csproj -c Release` (.NET SDK 8, NuGet from nuget.org
  only, WebView2 1.0.4022.49), then `makensis /WX package/mccluster.nsi` as in 0.1.0.
- Without an SDK: `powershell -ExecutionPolicy Bypass -File build-inbox.ps1 -Tests` compiles the same
  sources with `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` (C# 5) against the framework's
  assemblies and Microsoft-signed WebView2 files from an installed preview or a NuGet folder (their
  Authenticode signature is checked). It downloads nothing. For that reason the sources stay inside the
  C# 5 subset (`<LangVersion>5</LangVersion>` in the project).
- Tests: `tests/DesktopTests.cs` (navigation/security policy, job store recovery, JSON helpers), run by
  `-Tests`.

## Verified on the device (2026-11-22) and not verified

Verified: preview 0.1.0 user-scope install and launch; 0.2.0 in-box build; 50 desktop checks; status
probe; one real `local.inventory` job with receipt; `ai.chat` refused with the reason while no model was
installed; a job killed mid-run recovered as `interrupted` on the next start; the window loads the
live site with the Compute panel beside it; after the owner approved pulling `qwen3-vl:4b` and setting
`OLLAMA_IGPU_ENABLE=1`, one real `ai.chat` job answered on the integrated Radeon through Vulkan with the
model fully in GPU memory (`hardware_mode gpu-verified`, about 7 generation tokens per second), and the
node doctor's `-Report` showed the same load at 100% GPU.

Two things the local runs taught:

- `qwen3-vl:4b` on Ollama 0.40 keeps reasoning in `message.thinking` even with `think: false`, and
  neither `/no_think` nor a system prompt stops it. The job's default `num_predict` is therefore 1536,
  the receipt records `thinking_chars` and `done_reason`, and a run that spends its whole budget
  reasoning with no answer text is a failed job, not a result.
- The doctor's headroom rule refuses this 16 GB shared-memory box as a resident-model worker while the
  owner's desktop apps are open: with the model loaded it left under 1 GiB free against the 4 GB floor.
  Independent local jobs still run; being a persistent worker needs the memory freed first.

Not verified: the SDK build and installer for 0.2.0; sign-in in the window (the owner's credentials
were not entered by the agent); any remote or pooled job (the OVH Core was in rescue mode, the compute
gateway answered HTTP 530).
