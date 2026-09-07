# McCluster Generative Media Harness

## Goal

Build a model-agnostic creative operating layer that can route image, video, audio, 3D, editing, upscaling, lip-sync, character-consistency, and multimodal workflows across multiple providers without locking McCluster to any single vendor.

This is not a clone of any one product. The durable product is the orchestration layer: model registry, capability graph, routing, workflow composition, cost/latency/quality telemetry, private asset memory, reusable characters/styles, and agent/tool access.

## Control-plane rule

The canonical system remains:

- GitHub: `mcclusterishere/mccluster`
- Cloudflare Worker: `mccluster` on `api.mccluster.org`
- Supabase: `zmnhbrjyhxzhkxmhkexs`
- Private shared AI memory: `ai_context`

Do not create a second backend or shadow asset database.

## Architecture

### 1. Provider adapters

Every provider implements the same normalized contract:

- `listCapabilities()`
- `estimate(job)`
- `submit(job)`
- `status(providerJobId)`
- `cancel(providerJobId)` when supported
- `normalizeResult(raw)`

Potential providers include direct vendor APIs plus aggregators such as fal.ai or Replicate. The router must never assume a specific provider owns a specific capability forever.

### 2. Capability registry

A model is described by capabilities rather than marketing name alone.

Examples:

- text-to-image
- image-to-image
- inpaint
- outpaint
- text-to-video
- image-to-video
- video-to-video
- first-frame / last-frame control
- reference images
- reference video
- camera controls
- motion transfer
- native audio
- lip sync
- face/character consistency
- text rendering
- upscale
- background removal
- segmentation
- 3D generation
- speech / voice / music / SFX
- multimodal analysis

Each registry entry should carry:

- provider
- provider model id
- model family
- version
- supported inputs
- supported outputs
- parameter schema
- max duration / resolution / references
- cost estimator
- expected latency
- quality profile
- policy/commercial-use metadata
- health state
- deprecation state

### 3. Router

The user can either pick a model explicitly or ask McCluster to choose.

Routing score should consider:

`quality + task fit + control fit + consistency + speed + price + provider health + previous user preference + historical success`

The router should be able to:

- choose one model
- fan out the same prompt to several models
- run an A/B bake-off
- retry with a fallback provider
- escalate from cheap draft model to expensive final model
- select separate models for separate stages of one workflow

### 4. Workflow graph

Treat creation as a DAG, not a single API request.

Example advertising workflow:

1. ingest product reference
2. analyze product and brand
3. generate campaign concepts
4. create storyboard
5. generate keyframes
6. lock character/product/style references
7. generate shots using the best model per shot
8. lip-sync dialogue when needed
9. create voice/music/SFX
10. upscale
11. assemble/edit
12. quality-control with vision model
13. score variants
14. regenerate weak shots
15. export platform-specific versions

Every node stores its inputs, outputs, provider, model, cost, duration, seed when available, and parent/child lineage.

### 5. Creative memory

Store reusable creative state privately:

- characters
- faces / identity references
- products
- brand palettes
- logos supplied by owner
- style bibles
- locations
- wardrobe
- camera recipes
- lenses
- lighting recipes
- prompts
- negative prompts
- seeds
- preferred models
- winning ads
- generated assets
- provenance and rights metadata

Do not commit private/raw assets or secrets to public Git.

### 6. Control surface

The website should expose both simple and expert modes.

Simple mode:

- Describe what you want
- Attach references
- Choose speed / quality / budget
- Generate

Expert mode:

- provider/model selection
- reference slots
- first/last frame
- aspect ratio / resolution / duration / fps
- seed
- guidance / strength where supported
- camera movement
- lens / focal length abstraction
- motion intensity
- shot list
- timeline
- masks
- audio controls
- multi-model comparison
- node graph
- per-stage budget caps

### 7. Agent interface

Expose the media harness as tools through the McCluster agent layer / MCP-compatible surface.

Suggested tools:

- `media.models.search`
- `media.generate.image`
- `media.generate.video`
- `media.edit.image`
- `media.edit.video`
- `media.upscale`
- `media.audio.generate`
- `media.character.create`
- `media.workflow.create`
- `media.workflow.run`
- `media.job.get`
- `media.asset.search`
- `media.asset.get`
- `media.compare`

An attached model should never need to know provider-specific API syntax unless it explicitly asks for it.

### 8. Telemetry and self-optimization

For every job, track:

- requested objective
- selected provider/model
- predicted cost
- actual cost
- queue time
- generation time
- failure reason
- user acceptance/rejection
- downstream use
- quality score
- regeneration count

Use this data to improve routing. Do not silently fine-tune or train on third-party/customer content unless rights and policy explicitly permit it.

## Phase order

### Phase 1 — Unified provider layer

Start with one broad aggregator adapter and one or two direct APIs. Implement registry, normalized job schema, async jobs, callbacks, and private assets.

### Phase 2 — Workflow composer

Add DAG execution, retries, conditional branches, batch generations, A/B tests, and budget controls.

### Phase 3 — Character / brand / scene memory

Add reusable reference entities and project-level creative memory.

### Phase 4 — Director UI

Build shot/timeline/node-graph controls and side-by-side model comparison.

### Phase 5 — Autonomous creative agent

The McCluster agent may propose and run bounded creative campaigns, evaluate results, and iterate within explicit budgets and approval rules.

## Safety / authority

Autonomous media jobs may generate drafts, perform comparisons, run quality checks, and retry failed generations within configured limits. Publishing externally, spending beyond approved budgets, training identity models on people, or using third-party likeness/assets without appropriate rights requires the relevant approval and policy checks.
