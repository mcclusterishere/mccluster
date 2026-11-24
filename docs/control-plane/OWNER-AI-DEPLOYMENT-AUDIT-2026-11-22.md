# Owner AI workspace: deployment and runtime audit

Audit date: **2026-11-22 UTC**. Read-only remote checks; local code/tests are separate.
No production deployment, migration, account change, message, runtime installation or model download was performed by this audit.

## Current source and deployed revisions

| Surface | Evidence observed | Consequence |
| --- | --- | --- |
| Repository `main` | `b51ede03a4faefe000749ec71630b1a584146fed` | Starting revision for the owner workspace branch |
| Canonical Worker | `https://api.mccluster.org/v1/health` returned HTTP 200 and the same main SHA | Worker health does not establish OVH parity |
| OVH Core | `https://core.mccluster.org/health` returned HTTP 200 and `eb94224883685c0e3d2cf8a54eb14bbc1349d0bf` | Core is behind the audited main branch |
| OVH deployment ref | `refs/heads/deploy/ovh-production` = `eb94224883685c0e3d2cf8a54eb14bbc1349d0bf` | Matches the running Core revision |
| Compute gateway | `https://compute.mccluster.org/health` returned HTTP 200, `mccluster-compute/1` | Existing outbound device protocol remains the integration target |
| Web publication ref | `refs/heads/gh-pages` = `436a672adbc783d9c045979769da3e4b1cf29bf4` | Do not assume an unmerged local UI is already published |
| Cloudflare `mccluster` Worker | Version `8067cbc0-ccf7-484a-9b0c-2ca54ea9ab5f`; deployment `ee80e285-957c-460b-b6d3-5a645f098844`, created `2026-11-20T22:22:32Z` | Existing production deployment; no staging version was created |

The device agent, token-based enrollment, Ed25519 request signatures, check-ins and leases already exist.
Main includes the N1/N2 work through merged PR #818 (`95db84602d8edef4e4a0143833f37ab3e67d91f7`);
its evidence explicitly leaves OVH promotion held. The audit found no shipped Mac installer or Devices pane
in the starting main checkout. Those are new work in this branch, not a claim about production.

## Active related PRs

| PR | Head observed | Relevant scope/status |
| --- | --- | --- |
| [#557](https://github.com/mcclusterishere/mccluster/pull/557) | `f0c20e2043e60604aa434f479f04af053bad8e40` | Draft lease-safety work; `mergeable:false`; six historical CI workflows successful; not merged evidence |
| [#805](https://github.com/mcclusterishere/mccluster/pull/805) | `b84c9de9884d3ce5552573e09437620da586eb93` | Draft Control PWA identity, not a Mac compute installer; `mergeable:true`; ten historical CI workflows successful |
| [#815](https://github.com/mcclusterishere/mccluster/pull/815) | `ed48dca883e20defd28e47249fca482a31a71942` | Draft MCP redirect boundary; `mergeable:true`; eight historical CI workflows successful |

PR state and prior CI are a snapshot, not validation of the new working-tree changes.
Related merged context: [#818](https://github.com/mcclusterishere/mccluster/pull/818),
[#819](https://github.com/mcclusterishere/mccluster/pull/819) and [#820](https://github.com/mcclusterishere/mccluster/pull/820).

## Isolated staging inventory

Read-only Cloudflare inventory found:

- One live tunnel, `mccluster-core`, healthy and locally managed. Its configuration is not remotely managed.
- Worker names `mccluster`, `hitmans-halo`, `mccluster-helix-private` and `mccluster-research-private`.
- The canonical Worker's workers.dev subdomain is disabled, previews are disabled, and its latest version has no preview URL.
- One Pages project, `mccluster-web`, with `mccluster-web.pages.dev`, production branch `main`, and no latest deployment.
- No DNS record containing `stag` in `mccluster.org`. The existing `helix-preview.mccluster.org` and
  `research-preview.mccluster.org` belong to different applications; neither is evidence of a compute staging backend.

Read-only Supabase inventory found canonical project `Here` / `zmnhbrjyhxzhkxmhkexs` healthy,
with only its default `main` branch. The other listed project, `fxbkvcrfbbcmrrupdcjt`, is inactive.
No isolated owner-workspace database or auth target was identified. No keys or database contents were read.

Initial local command inventory found no `cloudflared`, `wrangler`, Docker, Podman, PostgreSQL server/client,
or `socat`. No callable tunnel/port-forward/Core deployment connector was found in the enabled tool metadata.

The repository's `core.deploy.preview` mechanism publishes static assets only. It requires
`MCCLUSTER_PREVIEW_ENABLED=1` and an HTTPS `MCCLUSTER_PREVIEW_PUBLIC_BASE`; the example
`https://preview.mccluster.org/p` is configuration documentation, not a verified live staging URL.

`.github/workflows/deploy-ovh-core.yml` transfers a checkout into a directory named “staging” and
then restarts the **production** Core. That workflow is not a staging deployment path.
`profile-project-preview.yml` produces test/screenshot artifacts; it does not supply an isolated compute backend.

A Pages preview can host the actual static UI without promoting `main`, but cannot by itself prove
owner login, single-use credential redemption, signed node check-ins, queue leases or live streaming.
For an online end-to-end walkthrough, the remaining prerequisite is an explicitly isolated target for
the actual Core/Worker build, owner authentication and test storage, with a reachable HTTPS origin.
Do not point a fixture UI at production, expose fixture authentication without an independent
access gate, repurpose unrelated private applications, or describe a static preview as a completed
Core staging test.

This inventory is the pre-implementation snapshot. The later owner-workspace CI harness supplies
an isolated disposable Core/SQL target behind an independent random-code gate, with separate signed
worker routes. Its public URL becomes reviewable only after the hosted job passes its gate checks.
Those synthetic owner/member identities prove the implemented authorization boundaries; they do
not establish production owner-login or deployment proof.

### Prepared temporary transport and static-preview fallback

After the inventory, the official Linux amd64 `cloudflared` **2026.11.1** binary was downloaded into
scratch and its SHA-256 checked against the official release:
`97bb3b02d23a5980fc9c15a1a270e692da1923f103f920d5b16d4931d5ab55e7`.
`--version` and `tunnel --help` succeeded. No tunnel was started as part of this audit.
The unprivileged CLI can attempt an accountless temporary Quick Tunnel once the actual disposable
Core service has owner authorization in place. This preparation does not modify the production tunnel.

The [official Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
states that the random URL is public unless access is restricted, expires when the process stops,
has no uptime guarantee, and does not support SSE. An optional email gate requires interactive OTP
and therefore cannot gate noninteractive compute agents indiscriminately. Existing Core owner/session
and signed worker authorization must remain the application boundary. A fixture owner identity must
never be described as production owner-login proof. The download checksum comes from the
[official release](https://github.com/cloudflare/cloudflared/releases/tag/2026.11.1).

For a static-only fallback, the Cloudflare connector's execution environment exposes `FormData`,
`Blob`, `fetch` and Web Crypto. The documented Pages API supports direct asset upload plus a
deployment form with explicit non-production `branch`, `commit_hash`, `commit_dirty` and asset
manifest. A deployment's returned `environment` must be `preview`; never omit the branch field.
Pages asset operations require the short-lived upload JWT, which can remain inside the same tool
execution rather than being printed or copied into a local environment. Wrangler 4.166.0 package
source was inspected: its asset hash is BLAKE3 of the file's base64 text followed by the extension,
truncated to 32 hex characters. No preview publication was performed by this audit.

## Mac and pair implementation evidence

The new `core/macos/mccluster-node.mjs` setup command is secret-free:

```sh
node core/macos/mccluster-node.mjs install --setup-file ./mccluster-device-setup.json
```

The credential is read from a hidden terminal prompt and passed only through one child stdin pipe.
The installer packages the actual agent/Ollama-adapter import closure, uses private user LaunchAgents,
and advertises no model capability until its `qwen3:8b` / 4096-context benchmark passes.
The exact digest, observed TTFT, output speed, sampled process-RSS peak and minimum 4 GiB memory
headroom are recorded. A sampled RSS peak is explicitly a lower bound, not a kernel high-water measurement.

`node --test core/test/pair-adapter.test.mjs scripts/test/macos-node.test.mjs scripts/test/macos-package.test.mjs`
passed **24/24** locally
after these modules were implemented. This covers synthetic HTTP workers and Linux filesystem/launchd
rendering, not an actual M1/Metal/launchd installation. Real-device installation, background-item approval,
sleep/wake, physical memory behavior and Wi-Fi reconnect remain real-Mac acceptance checks.

`scripts/package-macos-worker.mjs` builds a reproducible standalone ZIP, checksum and file manifest
under `downloads/`. An independent ZIP reader validates and extracts the package; the extracted
installer's dry run succeeds without a private repository checkout. Generated archives must be rebuilt
after runtime source changes and stay publication artifacts rather than source-control authority.

The optional pair adapter is diagnostic only. The exact audited EXO release is v1.0.71,
`fd707de30b42db4211d15da96b9052e1dc280ed1` (Python package version 0.3.70). Current main at audit
was `a60b95698ca81737d367443674dd5563cbc9559b`; its docs have an instance-await API absent from
the release. The release does not prove runtime commit, loaded model revision, per-node peak memory
or the complete LAN traffic boundary. It cannot pass the required shared-model benchmark.

The diagnostic adapter is loopback-only, uses only bounded `GET /node_id` and `GET /state`, and
never infers a ready pair from two visible nodes. Exact source links, optional configuration and
remaining readiness gates are in [MACOS-NODE.md](MACOS-NODE.md).
