# EquityNet 0.4.0 (Windows): the McCluster compute network client — local compute panel, Proof Mode, Contribute, the live site in a desktop window

EquityNet is the compute/network layer of McCluster: devices as workers, local Qwen via Ollama on Prime,
signed receipts per job, pause/revoke device controls. Published by McCluster Corp; formerly "McCluster for
Windows". See [Name and compatibility](#name-and-compatibility-equitynet-rename).

Status: built and run on one owner Windows device (the in-box compiler, `build-inbox.ps1`). The SDK
project (`src/McClusterDesktop.csproj`) is kept in step but is **not built on this branch** (no .NET SDK on
the build device). A signed release is not claimed. What is and is not verified is listed at the end.

## Name and compatibility (EquityNet rename)

This app is **EquityNet**, published by McCluster Corp: the compute and network layer where your own devices
are workers, Qwen runs locally through Ollama on Prime, every job gets a signed receipt, and devices can be
paused or revoked. It was called "McCluster for Windows" (and, informally, "Equity Fighter") up to 0.4.0.
"Equity Fighter" now refers to the separate chat layer that dispatches to EquityNet workers; it is not this app.

Renamed: window and dialog titles, the assembly title/product (company McCluster Corp), the installer's
prompts and Installed apps entry (DisplayName `EquityNet`, Publisher `McCluster Corp`), the Start Menu
shortcut (`EquityNet.lnk`), the manifest product (`EquityNet`) and the setup file
(`EquityNet-Windows-x64-Setup-<version>.exe`).

Kept on purpose, so existing installs, keys, receipts and contracts keep working (do not rename without a
migration):

| Kept identifier | Why |
| --- | --- |
| `%LOCALAPPDATA%\McClusterDesktop\` (`App`, `Profile`, `staging\profile.json`, `jobs`, `keys`, receipts) | install folder, WebView2 profile, job store and the DPAPI-protected device key live here; renaming would orphan keys and receipts |
| `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\McClusterDesktop` | the same key lets an EquityNet setup upgrade a 0.4.0 install in place and keeps Installed apps to one entry |
| `McCluster.exe` | payload manifests, release gate and installed shortcuts point at it |
| receipt schema `mccluster-desktop-receipt/2`, `mccluster-job/1`, `mccluster-job-receipt/1`, `mccluster-install-manifest/1`, `mccluster-install-receipt/1` | signed and verified data; the canonical JSON vector is pinned in the tests |
| Core API endpoints (`api.mccluster.org`, `compute.mccluster.org`), the node agent (`mccluster-node`, `%ProgramData%\mccluster-node`, `MCCLUSTER_NODE_*`) | server and job contracts |
| C# namespace `McClusterDesktop`, `src/McClusterDesktop.csproj`, assembly identity `McCluster.Desktop`, directory `desktop/windows/` | code and CI paths only; no user-visible effect |

Upgrade from 0.4.0 or earlier: the setup writes into the same folder and key, adds `EquityNet.lnk` and
deletes the old `McCluster Desktop.lnk`; uninstall removes either shortcut.

## What it is

The 0.1.0 preview (WinForms + Microsoft WebView2 Evergreen) opens the live site. 0.2.0 added one native
**Compute** panel beside the web view; 0.3.0 added Proof Mode, a route-by-route parity audit and a
reproducible per-user installer; 0.4.0 adds the **Contribute** section (the device side of the compute
contribution contract: consent text, limits, Enable / Pause / Resume / Revoke through the doctor, never
through the Core) and the `receipt.metering` block in the contract's shape on both execution paths
(`PROOF-MODE.md`). The contract is `docs/control-plane/COMPUTE-CONTRIBUTION-LEDGER.md` on branch
`prime/contribution-ledger`; that file is not in this tree until that branch is merged. UI parity is kept by reusing the site's own routes: sign-in, the owner's
Ask McCluster surface (`control.html#home:ask`) and every role check are the site's; the shell never bridges
the WebView2 session into native code (`AreHostObjectsAllowed` and `IsWebMessageEnabled` stay off), never
stores credentials and never calls a hosted inference API.

Three things stay distinct, and the panel labels each one:

| Layer | What the panel reads | Where it runs |
| --- | --- | --- |
| OVH Core | `https://api.mccluster.org/v1/health` (Worker `mccluster`, shows `deployment_sha`) and `https://compute.mccluster.org/health` (the Core compute gateway through its tunnel) | OVH |
| Local model runtime | Ollama on loopback: `/api/version`, `/api/tags`, `/api/ps`; a loaded model with `size_vram > 0` is the GPU evidence, the same rule as the node agent | this device |
| Node agent (worker) | `%ProgramData%\mccluster-node` (or `MCCLUSTER_NODE_STATE_DIR`) and the loopback adapter's `/health`; the identity file is never read | this device, installed only by the owner with `core\windows\mccluster-node.ps1` |

The desktop client is a **client**. Making the device a **worker** is the doctor's job: the Contribute
section drives the doctor (`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File
<doctor> -Install|-Limits|-Enroll|-Pause|-Resume|-Revoke -StateRoot <root>`, output shown read-only) and
reads the state root; it never writes the state root itself and never calls the Core. The one-time
enrolment credential typed into the modal reaches the doctor only through the child process environment
(`MCCLUSTER_NODE_ENROLL_TOKEN`), never a file, a log, a receipt or the clipboard; the desktop tests grep a
throwaway root for a sentinel after a fake run to hold that. `--status-json` carries a `contribution` object
with the same state the panel shows.

## Proof Mode

See `PROOF-MODE.md`: Auto or Pick device on this computer with the routing recorded, bounded retry with
every attempt listed, receipts `mccluster-desktop-receipt/2` with device, model digest, attempt, timing,
permission-scoped context references, sourced public data with observation times, `inference.mode`, and
an ECDSA P-256 signature from this device's DPAPI-protected key over the canonical JSON profile #823
documents (vector and hash pinned in the tests). `--verify-receipt` reports signature consistency, key
trust and hash binding as separate booleans.

## Core (staging)

Owner only, added after 0.4.0 on this branch (the version number is unchanged). `src/CoreJobs.cs` lets the
desktop itself submit one `ai.chat` job through a **staging** Core named by
`%LOCALAPPDATA%\McClusterDesktop\staging\profile.json` (`core_url`, `staging`, `ca_cert_path`,
`admin_token_file`, `org_id`; written by the owner or the staging serve script, never committed), poll it
with a bound, and read the result and the receipt of #823's device-job contract. Production hosts
(`mccluster.org`, `humanuprise.com` and every subdomain of either, by suffix, and any `supabase.co` host)
are refused outright; any other host that is not loopback needs `staging: true`, https and the profile's
CA; TLS trusts only that CA for that host through a per-request callback (no global override, no installed
certificate) and builds the chain from what the server presented, with no AIA download and no revocation
lookup; the admin token is read from its file per request and never logged, stored or printed. The desktop
does not verify the Core's Ed25519 receipt signature (.NET Framework 4.8 has none): it records
`receipt_signature_checked: false`, the reason and the node command that does verify it, and checks what
it can (receipt schema, job id, that a device is named, that the receipt says signed with a signature and
a key id, that the Core published that key, and that the input and output hashes are present and match).
A job is `done` only when all of that holds, otherwise `done_unverified` with the reasons. Only the Core's
named "no eligible device" codes are a refusal; a 401 or 403 is `auth_failed` and a 5xx or gateway error
is `core_fault`, each with exit 1 even under `--expect-refusal`. The panel shows a
"Core (staging)" option only while the profile exists; "One remote worker (through the OVH Core)" is
unchanged and no production submit was added. Details and the document's fields: `PROOF-MODE.md`.

## Local jobs, drafts and reconnect safety

`%LOCALAPPDATA%\McClusterDesktop\jobs\job_<32 hex>.json`, written atomically. States `queued → running →
done | failed`; a job found `running` whose owner process is gone becomes `interrupted` at the next start,
keeping input, progress and partial receipt. Drafts persist in `drafts\current.json`; events go to
`logs\desktop.log`. This ledger is for work that ran on this device; work submitted to the Core is the
Core's ledger, shown by the site. The two are never merged.

## Headless modes (for verification, not for use)

```powershell
McCluster.exe --status-json --out status.json
McCluster.exe --run-local-inventory <folder> --out job.json
McCluster.exe --run-local-chat "<prompt>" --model <installed model> [--device auto|adapter|ollama] [--max-attempts n] [--context-route <first-party url>]... --out job.json
McCluster.exe --jobs-json --out jobs.json                       # also runs the interrupted-job recovery
McCluster.exe --verify-receipt --file job.json [--trusted-key-id <id> | --any-key] --out verdict.json
McCluster.exe --device-key --out key.json                        # key_id and public key to pin elsewhere
McCluster.exe --parity-audit [--route <url>]... [--width 1280 --height 800] [--dir <folder>] --out audit.json
McCluster.exe --image-diff --a <png> --b <png> [--diff <png>] [--tolerance n] --out diff.json
McCluster.exe --exo-rank-probe --runtime-url http://127.0.0.1:52415 [--node-id node_...] --out rank.json
McCluster.exe --core-submit --prompt "<text>" --implementation <id> [--profile <path>] [--timeout-seconds n] [--expect-refusal] --out core-submit.json   # staging Core only
```

## Build, tests, installer

- Ordinary: `dotnet build src/McClusterDesktop.csproj -c Release` (.NET SDK 8, NuGet from nuget.org only,
  WebView2 1.0.4022.49), then `makensis /WX package/mccluster.nsi` for the NSIS setup.
- Without an SDK: `powershell -ExecutionPolicy Bypass -File build-inbox.ps1 -Tests -Installer` compiles the
  same sources with `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` (C# 5) against the framework's
  assemblies and Microsoft-signed WebView2 files (Authenticode checked). It downloads nothing. Order, tests
  first: `tests/DesktopTests.cs` must pass; then the payload (`dist\payload.zip`, deterministic: an explicit
  shipped list, ordinal order, fixed timestamps, a manifest of SHA-256 hashes and sizes, the source commit and
  whether the tree was clean) and a setup candidate with the payload embedded are built; then
  `installer/tests/InstallerTests.cs` drives that candidate through install, idempotent reinstall, uninstall
  (removes exactly the receipt's files, keeps a foreign file, removes itself and an empty folder), refusal
  outside the user profile and refusal of a registry key outside the uninstall hive; only then is it moved
  to `dist\McCluster-Windows-x64-Setup-<version>.exe` with `SHA256SUMS.txt`.
- For a signed in-box release, use `build-inbox.ps1 -Installer -Release -Thumbprint <certificate thumbprint>` on the authorized Windows signing machine. The build signs the app before creating the payload manifest and signs the setup before running the install test. Use the approved thumbprint of a publicly issued code-signing certificate. Windows also trusts roots added by local administrators. The standalone `release-gate.ps1 -Thumbprint <certificate thumbprint>` verifies the outer signature, embedded archive, staged and extracted bytes, both artifact checksums and timestamped signatures. The app and setup must share the signer, and the embedded WebView2 binaries must carry Microsoft signatures.
- The installer (`installer/Setup.cs`) mirrors `package/mccluster.nsi`: per-user, `%LOCALAPPDATA%\McClusterDesktop\App`,
  Start Menu shortcut, HKCU uninstall entry, no admin, no services. The same executable is the uninstaller.

## Verified on the device (2026-11-23) and not verified

A real run (2026-11-24): the desktop app submitted one job through a loopback staging Core (#823's gateway
over https on `127.0.0.1`, its certificate pinned by the profile) and the job ran on this device's Radeon
(`hardware_mode: gpu-verified`, `qwen3-vl:4b`); the document was `done` and the repository verifier
returned `{"ok":true}` on its receipt. Repeated the same day with the build described here, with the same
result, plus an unadvertised implementation recorded as `refused_as_expected` (`COMPUTE_NO_LIVE_NODE`) and
a wrong token under `--expect-refusal` recorded as `auth_failed` with exit 1. Single device: it was both
submitter and worker; no second device and no Mac has run a job this way yet. Nothing went to production.

Verified for Core (staging) (2026-11-24): the in-box build with `-Tests -AllowDirty`, 407 desktop checks
passed. Added after the first pass: a submit answer is a refusal only for the Core's named codes, and 401,
403, 500, 502, 503 without such a code, 504 and gateway HTML pages each land in `auth_failed`, `core_fault`
or `submit_rejected` with exit 1 with and without `--expect-refusal`; `done` requires `signed: true`, a
signature value and key id, the published receipt key, and both hashes present and matching, with each
missing piece tried alone and recorded as `done_unverified`; production refusal by suffix; the chain built
from presented certificates only, with a loopback listener at a certificate's AIA URL that is never asked;
no absolute local path in any output document; the panel's two cancellations kept apart and the target
options disabled while either runs. The first checks: the profile rules (production hosts refused with and without `staging: true`,
non-loopback without the flag refused, plain http off loopback refused, https without a CA refused); the
TLS decision at the callback level with certificates generated in memory for the run (the profile's CA
accepted, any other CA, a name mismatch, another host and an expired certificate refused; the source holds
no global callback and no certificate store); and the client against **a fixture**: an in-process
`HttpListener` over plain loopback HTTP that answers the contract's routes (document shape, output hash
passing and failing, a failed job, the Core's refusal recorded with and without `--expect-refusal`, an
expected refusal that did not happen, a wrong token, a bounded poll ending in `timeout`, an unreachable
Core, and a sentinel token that appears in no output document and no log, including when the server echoes
it back). Also run once: the built `McCluster.exe --core-submit` against a second loopback **fixture**, a
Node script serving the routes with #823's own `jobs.mjs` functions and a receipt key generated for that
run; the desktop's output hash equalled the repository's, and the recorded node command returned
`{"ok":true}` on the output file and `Core signature does not verify` on an altered copy. Both fixtures
have no device and no model behind them: neither is hardware proof; the real run above is the hardware
evidence, on one device. Not verified: a staging Core on another machine or a second device (Mac
included), TLS against an ingress that presents a leaf under an intermediate (the real run's ingress
presented a self-signed certificate that is itself the pinned one; the leaf and intermediate cases are
tested at the callback level), and the panel's "Core (staging)" option (compiled, not driven or
screenshotted).

Verified for 0.4.0 (the same day, later): the in-box build with `-Tests -AllowDirty`; the desktop checks
below plus the new ones (the metering block's keys pinned to the contract on both paths, counters kept
apart and `null` when unreported, the consent text's required statements, the doctor switches per action,
the device state read from a throwaway state root, a fake doctor run through `powershell.exe -NoProfile
-ExecutionPolicy Bypass -File` with a sentinel credential that reached the child environment and appeared in
no file under the throwaway job-store root). Not verified for 0.4.0: the installer (`-Installer` was not
run; `dist\McCluster-Windows-x64-Setup-0.3.0.exe` is the previous build), any real enrolment from the panel
(this device was not enrolled: a real run needs the owner's credential), the Contribute buttons against a
real state root, and the panel's layout by screenshot.

Verified for 0.3.0: in-box build; desktop checks (navigation policy, job store recovery, canonical JSON vector
and number forms, device-signed receipt round trip, tamper and re-sign forgery rejection, legacy key-file
migration, EXO probe against a loopback fixture, context-route refusals); the installer round trip through
`installer/tests/InstallerTests.cs` against the real setup candidate (install, hashes, receipt, shortcut,
registry entry, idempotent reinstall, uninstall that removes exactly the receipt's files and itself, foreign
file kept, refusals outside the user profile and outside the uninstall hive) and the setup written only after
it; real Proof Mode chat jobs on the Radeon: Auto through the node adapter with a first-party context route
on the shipped binary, and Pick through Ollama on an earlier compile of the same 0.3.0 sources (same device
key), both receipts verified offline by the shipped binary against this device's key id and hash-bound to
their job files, a tampered copy rejected (the re-signed-forgery refusal is a test-suite case, not a recorded
run); the parity audit over eleven routes at 1280 and 390 wide (no horizontal overflow at either viewport, the
owner gate, the 404 and the unreachable legacy host recorded as failure states, an external navigation
blocked); the EXO probe reporting an absent runtime honestly.

Reproducible here means: the same script, an explicit shipped file list in a fixed order, fixed timestamps in
the zip, and a manifest naming every hash, size, the source commit and whether the tree was clean. It does not
mean bit-identical binaries: the in-box compiler predates `/deterministic`, so `McCluster.exe`, and with it
`payload.zip` and the setup, carry a new PE timestamp and module id on every compile. The WebView2 files, the
licence text and the README hash identically across builds; the manifest is where a verifier compares.

Known on this device: Smart App Control is enforcing and decides per binary hash. Some fresh compiles of the
test executables or the setup candidate are blocked from running or loading (Code Integrity events 3033,
3077, 3118) and the next compile of identical sources is allowed; `build-inbox.ps1` fails loudly in that case
and writes no setup. No security setting was changed and none should be; a publisher-signed build is the
real answer.

Not verified: the SDK build and the NSIS installer; sign-in in the window (the owner's credentials are not
entered by the agent); any remote or pooled job; a retry on a real executor fault (the path is covered by
code, not by a recorded run); Auto's fall-through to Ollama and Pick-adapter refusal when the adapter lacks
the model (every recorded Auto run found the adapter ready); a timeout on a context route.
