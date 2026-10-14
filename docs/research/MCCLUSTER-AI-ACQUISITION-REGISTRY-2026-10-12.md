# McCluster AI Research Acquisition Registry — 2026-10-12

## Mandate
Preserve and evaluate **every named item** from the user's AI-news roundup. Target private, owner-controlled deployments on McCluster infrastructure where technically and legally possible. Do not equate public GitHub source with commercially usable rights, available weights, or practical CPU inference. Do not install unverified code on production OVH. This is a research inventory, not a claim of installed software.

## Source inventory (20 named items, including sponsor)
| # | Technology | User-supplied reference | Intended investigation |
|---|---|---|---|
| 1 | WorldPlay 2 | https://worldplay2.github.io/ | World generation, interactive environments, weights, license, compute |
| 2 | MSFlow / Motion Space Flow | https://yu1ut.com/MSFlow-HP/ | Motion synthesis, code/weights, rigs, VRAM, inference pipeline |
| 3 | Kandinsky 6.0 | GitHub kandinskylab (user link truncated) | Image/video generation availability, commercial license |
| 4 | GPT intelligent UI | OpenAI GPT-6 interface article (user link truncated) | UI patterns; distinguish product feature from downloadable model |
| 5 | ALoDLM | Hugging Face amazon/AL... (user link truncated) | Model identification, weights, licensing, compute |
| 6 | AlphaProtein Novo | GitHub google-deepmi... (user link truncated) | Protein research artifacts, rights, workloads |
| 7 | Botanic-1 | https://deepmind.google/models/g... (truncated) | Biological model availability and usage rights |
| 8 | OpenAI math breakthroughs | https://github.com/openai/math | Research/proof artifacts, not presumed deployable model |
| 9 | Embedding Gemma 2 | https://blog.google/innovation-a... (truncated) | Embedding model weights, CPU/GPU benchmark |
| 10 | Mistral Large 4 | Name only in supplied text | Verify announcement, weights and hosting rights |
| 11 | GenIA | https://facebookresearch.github.... (truncated) | Identify research and implementation |
| 12 | Room-temperature magnetic semiconductors | https://www.vals.ai/blogs/room-t... (truncated) | Materials science research, not presumed software |
| 13 | FlashDexRetarget | https://holiday-robot.github.io/... (truncated) | Robotics retargeting, code and model availability |
| 14 | Iris 3B | https://speridlabs.com/research/... (truncated) | Model modality, weights, requirements |
| 15 | Terra | https://cnai.epfl.ch/terra/ | Verify project purpose and availability |
| 16 | CoDimRecon | https://shuzhaoxie.github.io/CoD... (truncated) | Reconstruction pipeline, assets, compute |
| 17 | DistScene | https://coolbeam.github.io/DistS... (truncated) | 3D/scene methods and runnable releases |
| 18 | Nano Banana 2.1 | https://deepmind.google/models/m... (truncated) | Verify model identity, API-only vs self-hosted |
| 19 | Haiku 5.5 | https://www.anthropic.com/claude... (truncated) | Verify model identity, API availability, no assumption of weights |
| 20 | Higgsfield (sponsor/tool) | https://higgsfield.ai/s/theaisea... (truncated) | Commercial generation service, integration/terms, not presumed self-hostable |

## Deployment classification for each item
Record: verified official source URL; actual project identity; source license; weights availability/license; commercial redistribution restrictions; install commands; CPU feasibility; measured RAM/VRAM; storage; isolation/security; input/output formats; whether an API exists; OVH VPS suitability; GPU burst suitability; integration owner; test evidence; cost estimate; current status.

Statuses: UNVERIFIED -> VERIFIED -> LICENSE-CLEARED -> SANDBOX-TESTED -> INTEGRATED. Alternatively BLOCKED (with reason). No item silently removed.

## Proposed architecture
- Existing OVH VPS: authenticated private gateway, admin-only catalog, job queue, audit/telemetry, asset metadata and API adapters.
- Sandboxed CPU workers for lightweight models; isolated, ephemeral GPU workers for heavy inference, only when needed.
- Object storage for model/asset artifacts, with licensing and access controls.
- Model adapters and normalized contracts; do not tie core product to a single provider.
- Production deployment requires CI, license review, security review, capacity benchmark and rollback plan.

## Priority
1. MSFlow, WorldPlay 2, Iris 3B, CoDimRecon, DistScene, FlashDexRetarget for spatial/motion experiments.
2. Kandinsky, Nano Banana, Higgsfield for creative production.
3. Embedding Gemma, ALoDLM, Mistral, Haiku, UI concepts for intelligence.
4. Remaining scientific/research workstreams for research lab.

## Next steps
1. Resolve truncated URLs and verify each project's actual release, rights and available weights.
2. Inspect current OVH VPS CPU/RAM/disk, Docker, available GPU and production deployment boundaries.
3. Produce a feasibility matrix and a first isolated MSFlow proof of concept, without touching live production.
4. Treat the user's original roundup as the scope of work, **not** as proof that every item is open source or self-hostable.
