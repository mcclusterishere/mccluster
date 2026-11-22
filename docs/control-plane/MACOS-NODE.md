# Add an owner-installed Mac worker

Source implementation: `core/macos/mccluster-node.mjs`. This extends the existing McCluster compute
node agent, Ollama adapter and canonical queue. It adds no public inference server or authentication system.
OVH remains the coordinator. A browser never installs a worker without the owner running the installer.

## Release and evidence boundary

On November 22, 2026, the read-only audit observed website/API source `b51ede03a4faefe000749ec71630b1a584146fed`
while `https://core.mccluster.org/health` and `deploy/ovh-production` still identified
`eb94224883685c0e3d2cf8a54eb14bbc1349d0bf`. `https://compute.mccluster.org/health` answered with protocol
`mccluster-compute/1`. A healthy endpoint does not imply the new enrollment, streaming or device controls
are deployed. This installer belongs to the owner-workspace candidate; production deployment and pending
schema changes require the owner's separate release approval.

The Mac installer and its HTTP benchmark fixture are exercised on Linux. No physical M1 Mac, Metal model
run, macOS Login Items consent, actual launchd job or sleep/wake cycle was available in this build session.
The two-Mac distributed runtime and any 27B shared-model result are independent acceptance gates. An
individual Mac's passing 8B benchmark never makes a pair ready.

## Starting model and prerequisites

- Apple Silicon macOS, logged in as the account that will own the worker; no `sudo`.
- Node.js 20 or newer installed by the owner. LaunchAgents use its absolute executable path. If Node moves
  during an upgrade, rerun Install from the reviewed source.
- Ollama installed and running locally, bound to `127.0.0.1:11434` (the default). The installer does not
  open a router port, change firewall rules or expose Ollama to the LAN.
- Run `ollama pull qwen3:8b` explicitly to download the starting model. A missing model produces this
  recovery instruction before installation writes anything. The installer downloads nothing itself.
- A reviewed checkout or packaged runtime from this candidate. The setup command must target that source,
  not an older production checkout that does not contain the installer.
- An authenticated house-owner session in Control → AI → Devices. Wi-Fi is sufficient for an individual
  worker's outbound HTTPS connection to Core.

Every Mac uses the existing implementation ID `qwen3.8b.local`, the OVH input/output schemas, one active
lease, and a 4,096-token benchmark context. The manifest has one text-model capability; it does not claim
image, browser, distributed-runtime or 27B support. Model identity is recorded as its actual local digest
and quantization, not inferred from its display name.

## Add this device

1. Sign in as the owner, open **AI → Devices → Add this device**, choose macOS, and name the Mac.
2. Save the nonsecret setup JSON. It contains the organization, coordinator origin, enrollment ID, device
   name and fixed model configuration. It must contain no enrollment credential. The installer rejects
   unknown JSON fields, including a credential or token field.
3. Download **Mac worker** from Devices when the build's package manifest is available. Save
   `mccluster-macos-worker.zip`, `mccluster-macos-worker.sha256` and the setup JSON together. In Terminal,
   enter that directory, verify the ZIP, extract it, and run the standalone installer:

   ```bash
   shasum -a 256 -c mccluster-macos-worker.sha256
   unzip mccluster-macos-worker.zip
   node mccluster-macos-worker/core/macos/mccluster-node.mjs install --setup-file ./mccluster-device-setup.json
   ```

   This package needs no private repository clone. The manifest identifies the exact ZIP SHA-256,
   source bundle digest and every included file. The terminal still requires the separate hidden
   credential prompt. If the build has no package manifest, Devices must say the download is unavailable.

   A developer can instead run from the reviewed checkout:

   ```bash
   node core/macos/mccluster-node.mjs install --setup-file ./mccluster-device-setup.json --dry-run
   node core/macos/mccluster-node.mjs install --setup-file ./mccluster-device-setup.json
   ```

   The dry run reads the runtime source and prints the installation plan and SHA-256 bundle digest. It
   creates no state, keys, logs or launch jobs and performs no network requests. It can run on the laptop
   before the owner reaches the Mac. The second command requires the actual Apple Silicon Mac.

   An equivalent command without a setup file is:

   ```bash
   node core/macos/mccluster-node.mjs install --name 'Studio iMac' --org-id '<owner-workspace-uuid>' --compute-url 'https://compute.mccluster.org'
   ```

   Copy the exact organization and configured coordinator from the authenticated Devices flow. A staging
   setup uses its own HTTPS coordinator. Do not substitute production to make a staging failure disappear.

4. Only when the terminal asks, paste the fresh one-time enrollment credential from Devices and press
   Return. Input is hidden. The command has no credential argument, and a pipe into the installer is not a
   substitute for the interactive prompt.
5. The installer enrolls using the existing device agent, then runs its 4K model benchmark. It publishes
   no model capability until that benchmark passes. On success it starts the user-owned adapter and agent
   and reports that the test passed. Return to Devices to observe the signed heartbeat and model readiness.
6. Send a short chat pinned to this Mac. Confirm the completed run's actual device ID, model digest and
   status. This network job is separate evidence from a local benchmark.

If the connection fails after enrollment, use Devices to inspect the pending/connected entry before
requesting a fresh credential. An expired or consumed credential cannot be reused. The installer preserves
the locally generated private key between retries; it never copies that key to a browser or laptop.

### Starting on the laptop, finishing on the Mac

Create the pending entry from the laptop and download its nonsecret setup file. On the Mac, sign in to
the same owner workspace and use **Finish setup** on that pending entry to obtain a fresh credential.
Run the installer on the Mac, using that setup file or the equivalent command. Credentials never go into
a transfer link, QR-code URL, script, email, setup JSON or shell history. The target Mac owns its key.

### Building the downloadable package

```sh
node scripts/package-macos-worker.mjs
node --test scripts/test/macos-package.test.mjs
```

The build writes `downloads/mccluster-macos-worker.zip`, `downloads/mccluster-macos-worker.sha256`
and `downloads/mccluster-macos-worker.manifest.json`. These are generated publication artifacts;
publish them together from the reviewed staging build and regenerate after any runtime source edit.
The ZIP uses sorted entries, fixed timestamps and private file modes, with no external packaging dependency.
It contains the runtime's actual relative-import closure, installer, benchmark, canonical Mac manifest and
plain setup instructions. It excludes credentials, device identities, local config, logs, gateway/server
files and the optional pair diagnostic runtime. An independent ZIP reader tests extraction, hashes and
execution of the extracted dry run without the repository.

## What is installed

Private state is under the current user's `Library/Application Support/McCluster Node`. The state
directory is mode `0700`; configurations, runtime files, measurement receipts, logs and the generated
device identity are mode `0600`. Existing symlinks in node paths are refused. The existing node agent
creates `identity.json` locally and signs check-ins with that key.

The installer copies only the agent and adapter's relative module dependencies, its own management
commands, and `owner-macos-metal.json` into `runtime/<sha256>/`. It excludes repository environment files,
Supabase configuration, gateway code and any service-role credential. The private configuration records
the copied runtime's digest. Deleting the source checkout therefore does not remove the running worker.

Two current-user LaunchAgents are registered in `Library/LaunchAgents`:

| Job | Function |
| --- | --- |
| `org.mccluster.node.adapter` | Existing Ollama adapter at `127.0.0.1:4790` |
| `org.mccluster.node.agent` | Existing outbound agent, signed 30-second heartbeats and one lease |

LaunchAgents run while that macOS account is logged in. They do not run before login as a root daemon.
macOS may require the owner to allow the background item in System Settings → Login Items. No system
security setting is disabled by the installer. Wi-Fi changes or sleep can make the node offline; the
existing lease/reconnect protocol governs recovery.

### Credential path

The owner-facing enrollment credential is the short-lived, single-use `mcen1` value issued by Core.
The installer reads `/dev/tty` in raw mode with no echo and passes the bytes only to one child process's
stdin. That child receives `MCCLUSTER_NODE_ENROLL_TOKEN_STDIN=1` and `MCCLUSTER_NODE_ENROLL_ONLY=1`; neither
variable contains a credential. Child stdout/stderr are suppressed during enrollment, so a remote error
cannot echo a submitted secret. The credential buffer is cleared after writing. No credential is stored
in a file, environment variable, launchd plist, command argument or URL. Subsequent work uses the local
Ed25519 key and the existing signed-request protocol.

## Benchmark receipt and honesty

The benchmark sends one fixed public prompt directly to local Ollama `/api/chat` with streaming enabled,
`qwen3:8b`, context 4096, output limit 256, deterministic temperature/seed and thinking off. It records:

| Field | Meaning |
| --- | --- |
| `model_digest`, `quantization`, `ollama_version` | Exact local installation; digest checked before/after and against the loaded model |
| `time_to_first_token_ms` | Wall time from HTTP request start to the first nonempty content chunk, including any model load |
| `generation_tokens_per_second` | Ollama's reported generated-token count divided by generation duration |
| `peak_memory_bytes` | Highest observed sum of Ollama process RSS samples |
| `peak_memory_source` | `sampled_ollama_process_rss`; not a kernel high-water counter |
| `peak_model_allocated_bytes`, `peak_gpu_allocated_bytes` | Maximum allocation reported by local `/api/ps` during sampling |
| `free_memory_min_bytes` | Lowest available-memory sample during the run |
| `headroom_passed` | At least 4 GiB of observed free memory throughout, without sampling errors |
| `benchmark_passed` | Complete content and usage, stable observed digest, measured RSS, Metal memory use and headroom all passed |

Memory is sampled every 250 ms. The observed peak is a **sampled lower bound**; allocations between samples
may be missed, and concurrent apps affect the headroom reading. RSS and Metal allocation are reported
separately because unified-memory measurements can overlap. They must not be added together or marketed
as a hardware capacity guarantee. A missing measurement remains unknown and cannot produce a passing test.

The existing `measured-inference.json` sidecar retains the benchmark under `qwen3:8b`, and the agent publishes
it through the signed inventory. `macos-benchmark.json` holds the complete local receipt. A failed benchmark
leaves `capabilities.json` empty so the worker cannot take model jobs. The receipt contains no prompt transcript,
private file content, credential or key.

## Recovery and management

Use Core Devices for Rename, Pause, Resume and Revoke. Those are authoritative server actions, not changes
to a browser's local state. Revocation must be tested at the lease gateway; locally stopping a process does
not revoke its identity.

Local commands from the reviewed source, or the installed runtime's `macos/mccluster-node.mjs`:

```bash
node core/macos/mccluster-node.mjs status
node core/macos/mccluster-node.mjs enroll
node core/macos/mccluster-node.mjs benchmark
node core/macos/mccluster-node.mjs stop
node core/macos/mccluster-node.mjs start
```

Pause the node in Devices and wait for its active lease to finish before reinstalling or benchmarking.
Local Stop sends launchd's termination signal; the agent's normal drain timeout and Core lease expiration
remain in force. The installer does not silently mark a running job successful. Start requires a recorded
enrollment. A sleeping or logged-out Mac will remain offline until its account and network return.

| Observation | Next step |
| --- | --- |
| Pending enrollment | Run the installer on the target Mac with a fresh credential |
| Credential refused | Request a new credential; an expired or used one cannot be retried |
| Connected, model unavailable | Open Ollama, install the exact starting model, then benchmark |
| Benchmark headroom failure | Close memory-heavy apps and repeat; no larger model is installed automatically |
| Metal or RSS unknown | Run on the actual target Mac and inspect Ollama support; do not call a fixture result GPU proof |
| LaunchAgent blocked | Log in to the Mac desktop and allow the background item in Login Items |
| Offline after sleep or Wi-Fi change | Restore connectivity and wait for the signed heartbeat; inspect Core's job recovery state |
| Revoked | Keep the old identity revoked; create a new owner-approved enrollment and separate local state directory |

## Verification commands and remaining physical checks

`node --test scripts/test/macos-node.test.mjs` verifies the manifest against the real protocol/OVH schemas,
secret-free argument/setup handling, HTTPS/loopback restrictions, no-write Linux dry run, literal launchd
arguments, complete dependency packaging, private modes/symlink refusal, stdin-only credential handoff,
streamed benchmark math and fail-closed outcomes. Its HTTP fixtures are explicitly synthetic.

Before calling a Mac live, record the real installer exit, macOS Login Items approval, loaded-model digest,
Metal/RSS/headroom receipt, owner-pinned chat run on that node, sleep/wake reconnect, interrupted-job recovery
and server revocation/no-new-lease evidence. Before calling a pair ready, separately verify the supported
distributed runtime, both devices' LAN discovery, the exact shared model and reservation/release behavior.

Implementation references: [Apple launchd agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html),
[Apple background item management](https://developer.apple.com/documentation/servicemanagement/updating-helper-executables-from-earlier-versions-of-macos),
[Ollama chat](https://docs.ollama.com/api/chat), [loaded models](https://docs.ollama.com/api/ps),
and [installed model identity](https://docs.ollama.com/api/tags).

## Optional EXO pair diagnostics: inference remains unavailable

The ordinary Mac installer registers only `ai.chat / qwen3.8b.local`. It does not install EXO,
download a 27B model, expose Ollama, start a pair service, or add a pair capability.
The separate `core/src/compute/pair-adapter.mjs` is an explicitly started diagnostic service,
bound to `127.0.0.1:4791`. Its health reports `inference_enabled:false`; `/ready` returns 503.
It accepts the Core `compute.pair.control / exo.mlx.local` envelope but sends only `GET /node_id`
and `GET /state` to the owner's local EXO runtime. It never forwards chat text.

### Why a visible pair is not a passed benchmark

The audited EXO release is **v1.0.71**, commit **fd707de30b42db4211d15da96b9052e1dc280ed1**;
that release's Python package reports **0.3.70**. The current-main docs were also checked against
main **a60b95698ca81737d367443674dd5563cbc9559b**. Those are different interfaces:

| Evidence | What the audited source actually provides | Effect here |
| --- | --- | --- |
| Runtime identity | `/node_id` returns the local runtime ID as a bare JSON string; no authoritative build/commit endpoint | Configured version is labelled a claim, never a measured runtime version |
| Two devices | `/state` includes topology, `lastSeen`, node memory, tagged instances and runner assignments | Check exactly two mapped members, fresh heartbeats and expected private peer addresses |
| Model revision | `ModelCard` and the observed state lack the exact loaded Hugging Face revision | A configured revision cannot pass the shared-model test |
| Memory | `GenerationStats.peak_memory_usage` is one scalar, without per-node attribution | Do not divide it, treat aggregate RAM as model capacity, or mark each Mac's peak verified |
| Instance lifecycle | Release v1.0.71 has preview/create/delete; the documented `/instance/await` exists in later main | Do not combine main's protocol with the release pin |
| Network | v1.0.71's EXO API binds `0.0.0.0`; private topology addresses alone do not prove the full traffic boundary | Keep this adapter loopback-only and require a separately verified EXO host/firewall configuration before inference |

The candidate is `mlx-community/Qwen3.5-27B-4bit`. No real two-M1 run, exact revision,
per-device peak-memory result, shared-model completion or teardown has been verified.
`prepare`, `benchmark` and `chat` therefore return a plain-language unavailable result and
make no changes. They do not unload a working ordinary Ollama model. `release` can confirm
an already idle runtime only when current state shows no instances and no live runners;
it never deletes an independently created instance. No model is created by this adapter,
so there is no adapter-owned model or watchdog timer to strand after a crash.

Even EXO's placement-preview GET can load an uncached model card from Hugging Face; this
diagnostic integration intentionally does not call it. A future inference integration
must use an explicitly installed, offline runtime with pre-staged model files, verified
per-node revision and peak-memory evidence, LAN-only model transport, and tested deadlines
for cancel/delete/unload. A failed cleanup leaves a durable server hold on each affected
device; ordinary leases and Resume stay blocked until that device proves local cleanup.

### Explicit diagnostic opt-in

After independently installing the reviewed EXO runtime on both Macs, record the actual
runtime IDs from their local `/node_id` endpoints. The diagnostic config contains no secret.
Create a private regular JSON file on each Mac with this structure, replacing every placeholder
and using that Mac's enrolled node ID for `local_node_id`:

```json
{
  "schema": "mccluster-exo-probe/1",
  "enabled": true,
  "runtime_url": "http://127.0.0.1:52415",
  "runtime": {
    "name": "exo",
    "version": "v1.0.71",
    "package_version": "0.3.70",
    "commit": "fd707de30b42db4211d15da96b9052e1dc280ed1"
  },
  "model_id": "mlx-community/Qwen3.5-27B-4bit",
  "model_revision": "<complete 40–64 character model commit>",
  "local_node_id": "<this enrolled node ID>",
  "members": [
    {"node_id": "<first enrolled node ID>", "runtime_node_id": "<first EXO ID>", "lan_addresses": ["192.168.1.11"]},
    {"node_id": "<second enrolled node ID>", "runtime_node_id": "<second EXO ID>", "lan_addresses": ["192.168.1.12"]}
  ]
}
```

Validate the config and print a reviewable optional capability entry without starting a service:

```sh
node core/src/compute/pair-adapter.mjs --config ./mccluster-pair-probe.json --print-capability
```

The generated entry says `diagnostics_only:true`, `inference:false` and uses `/health` solely
to make diagnostic jobs schedulable. It is never merged into `capabilities.json` automatically.
If the owner opts to register diagnostics, pause the device and let its current ordinary job
finish before manually adding that reviewed entry beside the existing chat capability.
Keep `max_leases:1`. Start diagnostics separately:

```sh
node core/src/compute/pair-adapter.mjs --config ./mccluster-pair-probe.json
```

Both the config and actual runtime mapping must match a Core pair request. A changed runtime
ID, stale heartbeat, third runtime member, public peer address, or wrong model pin fails closed.
Configuration validation is not a hardware benchmark and never changes pair readiness.
Quit the diagnostic process with Ctrl-C; no shared model has been loaded or created by it.

### Clear a failed pair cleanup hold locally

Devices shows the affected device's `cleanup.reservation_id` and disables Resume while the
hold exists. On that Mac, use the EXO runtime's own controls to unload the pair, then run:

```sh
node core/src/compute/pair-adapter.mjs cleanup \
  --config ./mccluster-pair-probe.json \
  --reservation-id '<cleanup.reservation_id>'
```

If the ordinary worker uses a custom state directory, append `--state-root` and that directory.
The reservation ID is not a credential. This command accepts no token or private-key argument.
Run it from the reviewed checkout containing the optional pair diagnostics; the ordinary Mac
ZIP intentionally contains only the chat worker.

The command first reads the actual local EXO `/state` and `/node_id`. Both configured runtime
members must have fresh heartbeats, all model instances must be gone, and no runner may be
active. Missing, stale or busy observations stop the command before any receipt is sent.
It then reads the worker's protected local identity and saved HTTPS coordinator origin,
checks the key pair and node mapping, and signs a fresh outbound request to
`POST /v1/compute/pair-cleanup`. It never sends the private key or follows redirects.

Core requires that the receipt match the recorded reservation, postdate the hold and be fresh;
active work or reservations, revoked devices, duplicate receipts and the wrong reservation
are rejected. A successful response only makes **Resume** available. Return to Devices and
click Resume after reviewing the result. If confirmation is lost, refresh Devices before
retrying; a cleared hold will reject a duplicate request. An unsupported runtime cannot
produce this proof and remains unavailable until an operator restores a verifiable idle state.

`node --test core/test/pair-adapter.test.mjs` checks the real tagged state shape, exact member
mapping, private-address checks, stale peers, honest missing evidence, read-only actions,
cleanup observations, bounded/redirect-free upstream reads, local Host/Origin restrictions,
config file integrity, and a signed cleanup receipt from an actual protected test key using
explicitly synthetic runtime fixtures.

Pinned primary source references:

- [EXO release API implementation](https://github.com/exo-explore/exo/blob/fd707de30b42db4211d15da96b9052e1dc280ed1/src/exo/api/main.py)
- [State wire types](https://github.com/exo-explore/exo/blob/fd707de30b42db4211d15da96b9052e1dc280ed1/src/exo/shared/types/state.py)
- [Generation metrics](https://github.com/exo-explore/exo/blob/fd707de30b42db4211d15da96b9052e1dc280ed1/src/exo/api/types/api.py)
- [Model card fields](https://github.com/exo-explore/exo/blob/fd707de30b42db4211d15da96b9052e1dc280ed1/src/exo/shared/models/model_cards.py)
- [Current-main API documentation at the audited commit](https://github.com/exo-explore/exo/blob/a60b95698ca81737d367443674dd5563cbc9559b/docs/api.md)
