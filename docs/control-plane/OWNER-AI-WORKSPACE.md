# Equity Upreneurs owner AI workspace

Status: implemented on the review branch, with disposable staging verification.
Production Core promotion, database migrations, edge deployment, and enabling
the feature flag remain pending owner approval. No physical Mac or shared-model
performance is claimed by the fixture tests.

## Extend the existing room

The entry point remains `control.html#home:ask`, the Home → Ask McCluster surface
of `js/control-room-v2.js`. The shared navigation and Equity Upreneurs design
tokens remain authoritative. `js/control-room/owner-ai.js` supplies bounded safe
Markdown and presentation helpers, rather than introducing another application.
Chat, Devices, and Runs are local views inside that room. Conversation history,
search, the model picker, and the worker picker stay near the conversation.
Enrollment, device recovery and pair controls stay in Devices.

Public interaction references informed the placement of controls, not visual
identity or copied text:

- Claude: [model, effort and thinking controls](https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings).
- ChatGPT: [projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt) and [finding chats and files](https://help.openai.com/en/articles/10056348-finding-your-chats-projects-and-files-in-chatgpt).
- Kimi: [model and work modes](https://www.kimi.ai/ai-models/kimi-k2-5).

Projects link to the existing project surface. Attachments reuse the existing
image/vision path; generic document ingestion is unavailable. Existing approved
tools retain their server policies. There is no new document index, transcript
database, auth product, paid inference route, or automatic external action.

## Canonical request and storage paths

1. Existing `backend.js` authenticates the browser through Supabase.
2. The existing `/v1/core/mcp` transport independently checks current house
   owner membership. It overwrites organization scope and signs the owner actor
   envelope sent to the existing Core broker.
3. `core.ai.turn.submit` saves the user message and durable resident job in the
   existing `ops_ai_threads`, `ops_ai_messages`, and `ops_agent_jobs` tables.
4. The Core resident executor enqueues `ai.chat` in the existing compute fabric.
   The current resident job lease and attempt fence every new model round.
5. The selected worker claims an existing signed lease and calls its loopback
   Ollama adapter. Ollama stays local; model weights are not served by Core.
6. Incremental Ollama text travels as bounded NDJSON to the worker. The worker
   writes visible progress through signed, fenced lease renewals. The browser
   polls durable progress snapshots; it never displays a typing animation as
   fabricated model output. Reasoning text is not published.
7. The assistant message is committed under the current resident job lease. The
   actual completed compute lease supplies the device receipt, even after the
   task's temporary ownership columns have cleared.

`core.ai.turn.get` recovers a running or completed turn after a browser closes.
`core.ai.turn.stop` atomically cancels outstanding compute tasks and leases and
fences late progress, further rounds and assistant writes. A completed compute
task can be reattached after a Core restart even if its worker is now offline.

Owner chat runs use bounded concurrent executor lanes. The ordinary Core lane
retains its serial behavior; pair benchmarking has its own lane. The compute
lease scheduler still enforces one active job on each enrolled Mac.

## Devices and enrollment

The feature flag is `CORE_OWNER_AI_WORKSPACE_ENABLED=1`, enabled only on the
isolated fixture until approval. Tools are:

| Tool | Purpose |
| --- | --- |
| `core.compute.devices.list` | Current device states, model readiness, pending setup and test receipts |
| `core.compute.enrollment.create` | Ten-minute, single-use, scoped setup credential; pending setup can be reissued |
| `core.compute.device.update` | Rename, pause, resume or revoke |
| `core.compute.device.test` | A pinned qwen3:8b test through the actual queue |
| `core.compute.pairs.list` | Current computed readiness and benchmark evidence |
| `core.compute.pair.create` | Proposed pair of two different enrolled Macs |
| `core.compute.pair.benchmark` | Explicit test of an installed, eligible shared runtime |

The enrollment credential contains 256 random bits. Core stores only its SHA-256
digest. Consumption and device insertion are one transaction, binding house
organization, platform, name, allowed implementations and maximum concurrency.
Reissue rotates the digest; an old credential cannot be used afterward. The
credential never appears in the setup JSON, setup command, URL, local storage,
installer arguments or service logs.

The owner downloads the reviewed worker ZIP and a nonsecret setup JSON, then
explicitly runs the installer on the target Mac. The installer reads the secret
through a hidden terminal prompt and passes it to the enrollment child through
stdin. The worker generates its own Ed25519 private key locally and protects
the state directory with mode 0700 and the key/config files with 0600. Nothing
listens publicly on the Mac. Subsequent requests use signatures and fresh
nonces over outbound HTTPS. Ordinary Wi-Fi is sufficient.

A laptop can start setup. The owner signs in on the target Mac, opens the same
pending enrollment, and chooses Finish setup. A fresh credential replaces the
old one. Lost enrollment responses can be recovered by a signed heartbeat from
the already-created key; a local key file by itself is not proof of enrollment.

The installer details, prerequisites and recovery commands are in
[MACOS-NODE.md](MACOS-NODE.md). Existing Windows agents continue using their
signed identities. Windows installation remains optional; this change does not
silently install or upgrade a Windows worker.

### State and lease policy

| State | Meaning and next step |
| --- | --- |
| Pending | Credential not consumed; finish setup, or reissue after expiry |
| Connected | Signed worker present, but no local model advertised yet |
| Model ready | Local adapter reports the model available; run a device test |
| Test passed | A completed lease on this exact node produced a nonempty answer |
| Offline | Wake/reconnect the machine and start the worker; existing leases expire under their normal attempt rules |
| Paused | New claims are blocked; existing ordinary leases may finish |
| Revoked | New claims, renewals, starts and results are denied; a fresh key and enrollment are required |

Revocation does not pretend that a remote process stopped instantly. The worker
aborts when it loses authority; late results are rejected server-side. Expired
work is retried or fails at its existing attempt limit. A pinned job stays
pinned. Auto can recover on another eligible worker and records why it switched.

## Routing and ordinary models

`route` is `{mode:'auto',implementation:'qwen3.8b.local'}` or
`{mode:'node',node_id,implementation}`. Existing implementation mappings remain
the contract; the baseline is `qwen3.8b.local` → `qwen3:8b`. A missing selected
worker or model produces an explicit unavailable state. Owner routes disable
the adapter's silent missing-model fallback. Auto is the healthy eligible
worker pool; successful and recovered runs show their actual lease holder.

In the owner chat, **Run on** can pin **OVH CPU**, **Prime GPU**, or
**Connected inference** to an exact enrolled worker and model. The last option
names the individual worker that OVH dispatches to. A two-Mac shared-model
benchmark remains a separate Deep Reasoning option.

Named requests carry `{mode: 'node', target: 'ovh' | 'prime' | 'connected',
node_id, implementation}` through the existing owner-authenticated submit
route. A named turn runs inference only. If the selected target, model or
required execution evidence is unavailable, the turn stops. Switching workers
requires a new selection. Reply details show the selected route, the serving
worker and model, and the saved run and compute task when available.

Each 16 GB M1 iMac starts with qwen3:8b, one active lease, a 4K local benchmark
context, and a measured headroom gate. Context settings from the Mac installer
remain distinct from OVH's existing resident context tuning. Larger and vision
models appear only when supported mappings are observed on actual devices.

Independent conversations can run concurrently. Review on another device
references a completed assistant message and its verified source-device
receipt; Core requires a different selected worker and supplies that saved
answer as quoted evidence for the review.

## Two-Mac pair and Deep Reasoning

Creating a pair records intent. It does not combine two independent Ollama
servers or imply that their memory is pooled. Readiness is a computed `ready`
boolean, not a trusted saved state label.

The candidate is `mlx-community/Qwen3.5-27B-4bit`. The exact audited EXO release
and primary-source findings are in [MACOS-NODE.md](MACOS-NODE.md#optional-exo-pair-diagnostics-inference-remains-unavailable)
and [the deployment audit](OWNER-AI-DEPLOYMENT-AUDIT-2026-11-22.md). The inspected
release does not expose all required immutable-model, runtime-build,
per-device peak-memory and LAN-traffic evidence. Its optional controller is
diagnostic-only. Deep Reasoning therefore remains unavailable on this hardware
until a supported runtime supplies and passes those checks.

The reservation implementation is prepared and tested at the SQL/control
level. It requires exactly two current enrolled members, matching runtime IDs,
immutable model revision, runtime commit, a shared-model test, 4096 context
including prompt and output, TTFT, output speed, per-device peak memory,
at least 4 GiB observed free memory, LAN model traffic, and confirmed cleanup.
Benchmark freshness is bounded; reconnecting a changed runtime requires a new
test. Synthetic receipts in tests never establish physical readiness.

Reservations acquire both workers atomically, stop new ordinary claims on
those workers, and let existing jobs finish before asking them to unload their
ordinary models. OVH and the laptop remain outside the pair. Success, failure,
Stop and timeout all enter cleanup. Expired reservation reconciliation cancels
remaining pair tasks and pauses both workers before releasing uncertain
capacity. An unconfirmed unload leaves a persistent cleanup hold that ordinary
heartbeats and Resume cannot clear. A fresh signed local idle receipt clears
the hold; the owner must still resume the device explicitly.

## Disposable staging and reproducible evidence

`scripts/owner-workspace-staging.mjs` composes the real broker, gateway, runner,
node agent, Ollama adapter and repository SQL around disposable PGlite with
pgcrypto. It is a test fixture, not an alternative production backend. An
enforced loopback-only preload blocks every production API/database request in
all Node subprocesses. The browser transport adapter also contains all fetches
to its own staging origin, and CSP prohibits external connections.

The temporary public page requires a random access code in a POST body, then a
short-lived HttpOnly/Secure/SameSite cookie. Original owner/member fixture
subjects pass through the actual Core owner membership and database RLS gates.
The page clearly labels synthetic identities and model text. A separate,
strictly enumerated worker transport retains the original single-use enrollment
and Ed25519 authentication; it does not accept the browser fixture identity as
a device credential. The GitHub-hosted walkthrough has a 35-minute maximum
lifetime, with a 30-minute review window after startup. Its temporary access
code is handed off only in an encrypted workflow artifact. The repository is
public, so CI encrypts the bounded access JSON with the reviewer's RSA4096
public key using OAEP-SHA256 and uploads only the ciphertext. The matching
private key stays in protected local storage outside Git and GitHub Actions;
the plaintext state and logs stay private to the disposable runner and are
removed during cleanup. Only the nonsecret URL appears in the job summary.
No production resource is deployed or modified.

The staging-only simulated-Mac helper is installed only by an explicit test
control. It exercises the real one-time credential, generated key, signed
heartbeats and job leases while marking its inventory as simulated. It does
not prove launchd, Metal, memory capacity, or a shared model.

Reproduce the database and end-to-end tests with a pinned isolated dependency:

```sh
npm install --prefix /tmp/mccluster-owner-sql --no-audit --no-fund @electric-sql/pglite@0.5.17
export PGLITE_MODULE_PATH=/tmp/mccluster-owner-sql/node_modules/@electric-sql/pglite/dist/index.js
export MCCLUSTER_DEVICE_SQL_TESTS_REQUIRED=1
node scripts/owner-device-sql-check.mjs
node scripts/owner-workspace-sql-check.mjs
node --import ./core/test/helpers/loopback-only.mjs --test core/test/owner-workspace-e2e.test.mjs
node --test core/test/owner-device-gateway.test.mjs
node scripts/package-macos-worker.mjs
```

PGlite verifies actual SQL, grants, RLS and lease transitions. Native PostgreSQL
multi-session lock timing still needs the staging database deployment gate.
Actual M1 enrollment, LaunchAgents, Metal benchmarks, sleep/wake, Wi-Fi recovery
and the precise two-Mac distributed model remain physical-device tests.

## Approval boundary and rollout order

1. Review this branch, the audit and test evidence. The new CI workflow performs
   isolated tests, packages the installer, and starts the protected disposable
   walkthrough for this review branch. It performs no production deployment.
2. Approve promotion of the two files in `supabase/pending/` into the canonical
   migration ledger and their application through the normal controlled path.
3. Approve the OVH Core/broker/gateway/runner promotion, the stateless MCP edge
   change, static UI and installer publication, and the feature flag. The
   workspace refuses admission when the required schema is absent.
4. Enroll and benchmark one physical Mac, then the second. Record actual
   qwen3:8b receipts before calling either a verified M1 worker.
5. Keep Deep Reasoning unavailable until the exact distributed runtime and
   model pass the independent acceptance criteria. Ordinary workers remain
   useful during that investigation.

The older pending GPU-yield proposal must be reconciled before promotion; the
owner workspace v4 claim path deliberately does not fall back to a scheduler
that ignores device pins or pair reservations.
