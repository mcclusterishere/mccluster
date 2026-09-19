# McCluster Sovereign Media Fabric

## Goal

McCluster must own the creative-compute control plane, the inference contract, the asset lifecycle, and the durable artifacts. Third-party model APIs are not allowed to be a required dependency for canonical generation capabilities.

The target experience is simple from Claude, ChatGPT, or any other client:

- `image.generate`
- `video.generate`
- `audio.generate`
- `model3d.generate`
- `world.generate`
- `media.job.get`

Those capability names never expose or depend on a vendor-specific API. A client asks McCluster for a capability; McCluster chooses a healthy self-hosted implementation and returns a tracked job/result.

## Sovereignty invariants

1. **Open/local inference is the canonical implementation.** A canonical capability is considered sovereign only when the selected binding is `hosting=self-hosted|owned` and `billing=compute|free`.
2. **No vendor inference SDK is required for the sovereign path.** Renting a bare GPU machine is acceptable; paying a model-provider API per image/second/token is not.
3. **GPU hosts are cattle, not pets.** Any compliant GPU machine can enroll with McCluster Compute, advertise its healthy local engines, drain, disappear, and be replaced without changing client tools.
4. **Models are pinned.** Record repository/revision, weight checksum, runtime version, quantization, and license for every local implementation.
5. **Assets come home.** Completed PNG/JPG/WebP/MP4/WebM/WAV/MP3/GLB/GLTF outputs must be copied into McCluster-owned asset storage before a job is considered durably complete. Remote/provider URLs are provenance only, never canonical storage.
6. **OVH remains the durable control plane.** Core, job state, asset metadata, routing policy, model manifests, and evidence survive GPU worker termination.
7. **All GPU executors are loopback services.** The existing node agent only calls `127.0.0.1`/localhost engines. GPU engines are never directly internet-facing.
8. **Fail closed on sovereignty.** In sovereign mode, if no healthy self-hosted binding exists, generation waits/fails instead of silently spending against an external inference API.
9. **Every output is provable.** Store model identity/checksum, node id, Core commit, task/job ids, input digest, output SHA-256, timings, and source lineage.
10. **Clients stay provider-neutral.** Claude should never need to know whether the implementation runs on an OVH GPU, a rented raw GPU VM, or future on-prem Blackwell hardware.

## Existing pieces already in the repository

The system already has most of the hard control-plane primitives:

- signed McCluster Compute enrollment and request protocol;
- GPU/VRAM inventory discovery;
- health probes for local loopback executors;
- task leasing, heartbeats, retries, draining, and completion;
- dynamic live capability bindings from enrolled compute nodes;
- routing that prefers owned/self-hosted compute over external/metered bindings;
- provider-neutral MCP capabilities;
- budget/lineage tables for media jobs;
- a self-hosted preview runtime and gateway.

Do not create a parallel scheduler or a second MCP surface. Extend these primitives.

## Target topology

```text
Claude / ChatGPT / McCluster UI
            |
            v
api.mccluster.org / McCluster MCP
            |
            v
      McCluster Core (OVH)
      - capability registry
      - compute gateway
      - job state
      - sovereignty policy
      - asset metadata
            |
            | signed task leases
            v
    Disposable GPU worker
    - mccluster-compute-node
    - local image engine
    - local MiniMax H3 video engine
    - local audio engine
    - local Hunyuan3D engine
    - no public inference ports
            |
            | finished artifact upload
            v
      McCluster Asset Vault (OVH)
      /var/lib/mccluster-assets
            |
            v
      assets.mccluster.org
```

## First sovereign model targets

These are implementation targets, not public capability names:

- `local.flux` -> `image.generate`
- `local.minimax-h3` -> `video.generate`
- `local.stable-audio-open` -> `audio.generate`
- `local.hunyuan3d` -> `model3d.generate`

Use current official/open repositories and supported inference runtimes. Do not freeze an obsolete installer into Core; the GPU image/bootstrap layer owns model-specific dependencies.

## Compute-node contract

A GPU worker runs the existing `core/src/compute/node-agent.mjs` with a root-controlled manifest at `/etc/mccluster-node/capabilities.json`.

Each implementation must expose two loopback behaviors:

- health endpoint, normally `GET /health`;
- generation endpoint, normally `POST /generate`.

The generation endpoint receives:

```json
{
  "capability": "video.generate",
  "implementation": "local.minimax-h3",
  "input": {},
  "metadata": {}
}
```

and returns JSON containing durable asset descriptors after uploading the actual files to McCluster Asset Vault.

Minimum result contract:

```json
{
  "ok": true,
  "assets": [
    {
      "asset_id": "...",
      "url": "https://assets.mccluster.org/a/...",
      "sha256": "...",
      "mime_type": "video/mp4",
      "bytes": 123
    }
  ],
  "model": {
    "implementation": "local.minimax-h3",
    "revision": "...",
    "weights_sha256": "..."
  }
}
```

A task is not durably complete merely because a local temporary file exists on an ephemeral GPU worker.

## Asset Vault

Canonical asset storage should live under `/var/lib/mccluster-assets` on OVH initially. The public read gateway may be exposed through the existing edge transport as `assets.mccluster.org`; write/ingest must remain authenticated.

Recommended content-addressed shape:

```text
/var/lib/mccluster-assets/
  sha256/
    ab/
      abcdef.../
        asset.glb
        metadata.json
```

The SHA-256 digest is the durable identity. Friendly names and project paths are metadata, not storage identity.

The asset record should include:

- `asset_id`
- `sha256`
- byte length
- MIME type
- original filename
- canonical URL
- originating capability/task/job
- node id
- implementation/model revision and weight digest
- creation timestamp
- optional dimensions/duration/mesh metadata

## Sovereign routing mode

Add/retain a root-controlled switch such as:

```text
MCCLUSTER_SOVEREIGN_MEDIA=required
```

Semantics:

- `required`: media generation may resolve only to owned/self-hosted non-metered inference bindings; otherwise fail/wait.
- `prefer`: self-hosted first, external fallback allowed only when explicitly authorized by the caller/owner.
- `off`: ordinary capability scoring.

Do not let a missing GPU silently fall back to FAL or another metered inference service when `required` is active.

## GPU-worker lifecycle

The control plane must not care which commodity hardware provider supplies the GPU. Provider-specific lifecycle automation belongs behind an optional infrastructure adapter, never inside `image.generate`/`video.generate`/etc.

A scheduled worker can therefore:

1. boot;
2. mount/cache pinned model weights;
3. start local inference engines;
4. run `mccluster-compute-node`;
5. advertise only engines that pass health + VRAM checks;
6. lease work from OVH;
7. upload finished assets home;
8. drain active leases;
9. terminate.

OVH continues planning, queueing, coding, and asset serving while no GPU is online.

## Acceptance criteria for v1

The first milestone is complete only when all of the following are demonstrated:

1. Claude sees `media.job.get` plus generation tools through McCluster MCP.
2. A GPU compute node enrolls and appears healthy without exposing inference ports publicly.
3. `CapabilityRegistry.resolve('model3d.generate')` selects a `mccluster-compute` self-hosted binding, not FAL.
4. A Claude request to `model3d.generate` produces a GLB on local/open weights.
5. The GLB is copied into OVH Asset Vault and served from `assets.mccluster.org`.
6. Claude can poll the tracked job and return the McCluster-owned URL.
7. Repeat the same proof for `video.generate` with MiniMax H3/open weights.
8. Stop/terminate the GPU node and confirm OVH still serves the produced assets and preserves all job/model/evidence metadata.
9. Run the sovereignty audit and receive zero external/metered bindings for the required generation set.
10. No FAL/Tripo/Higgsfield/MiniMax hosted inference API credential is required for those successful runs.

## Non-goals for v1

- matching a hyperscaler SLA;
- unlimited concurrent generation;
- storing all model weights on OVH CPU storage if a dedicated GPU cache is cheaper;
- manufacturing-grade CAD from generative GLB output;
- replacing GitHub, Cloudflare, or Supabase in the same milestone.

Those dependencies can be reduced later. The immediate proof is sovereign creative inference + durable McCluster-owned outputs behind the existing control plane.
