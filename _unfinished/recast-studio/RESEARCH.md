# Recast engine evaluation · November 9, 2026

## Openjutsu

[Openjutsu](https://github.com/D3voz/openjutsu) exists. The reviewed main commit is `7fe118bb5a61fcfac0148e1bfea3dd29884dbf26` (October 30, 2026). Its MIT application is a Next.js UI over ComfyUI and MiniMax H3, with optional tracking, relighting and face refinement.

The maintainer reports testing on RTX 4060 Ti 16 GB VRAM with 64 GB RAM, and 6–13 minutes for six seconds at 480p. This is reported evidence, not our benchmark or a universal minimum. An iPad or CPU-only OVH host cannot act as the documented renderer. Its hosted Comfy deployment instructions are marked untested.

It has useful local safeguards: loopback startup, optional strong-password protection, same-origin checks, bounded streaming uploads and file signatures. It is explicitly single-owner: everyone with the shared password can access its jobs. Do not expose it as a multi-tenant creator service. Custom-node version pinning and clean-machine validation remain incomplete; uploaded inputs can remain in ComfyUI storage.

## Licensing blocks

- **Self-hosted MiniMax H3:** the official [community license](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE) excludes the US, EU, UK and South Korea, including use/display of outputs outside its territory. Rewriting the UI or moving the GPU does not remove model restrictions. Separate licensing is available through the [official request form](https://platform.minimax.io/h3-license). No form was submitted and no agreement accepted here. The form includes meaningful safeguards, flow-down and indemnity commitments.
- **Face refinement:** Openjutsu documents InsightFace `buffalo_l` as noncommercial-research-only and its YOLO weights as AGPL-3.0. Do not silently include these in a US commercial pipeline. Review the specific model and dependency licenses rather than the application badge.
- **FLUX 3 Klein:** the [Kommunity license](https://huggingface.co/black-forest-labs/flux-3-image-klein/blob/main/LICENSE.md) conditionally permits commercial output generation for qualifying users below $5 million gross annualized revenue including affiliates, with content review/filtering and other restrictions. This is not an unrestricted MIT model.
- **SAM 3.1:** the [SAM license](https://huggingface.co/facebook/sam3.1/blob/main/LICENSE) is separate from the UI's MIT terms.

Model licenses do not supply rights to third-party footage, soundtracks or likenesses. Use owned/licensed footage and permitted character images for initial evaluation.

## Candidate engines

**Owned/open route:** [Wan2.2-Animate-14B](https://huggingface.co/Wan-AI/Wan2.2-Animate-14B) lists Apache-2.0 and supports replacement from source video plus character image. It is a promising model candidate, not a verified complete commercial stack. Review its exact preprocessing/face/segmentation weights and software separately. No restricted InsightFace step is automatically required by this proposed module. Hardware minimums and identity quality for our chosen configuration have not been established. Do not confuse generic Wan 5B image-to-video hardware claims with Animate-14B requirements.

**Hosted bridge:** [fal H3 Max Recast](https://fal.ai/models/minimax/h3-max/recast) is advertised for commercial use as a hosted service. It is not a license to download and self-host H3. The [schema](https://fal.ai/models/minimax/h3-max/recast/api) accepts 5–30-second sources with shots no longer than 15 seconds, reference photos, direction and 768P/1080P. Pricing is $0.30/output-second at 768P or $0.45 at 1080P. Ten seconds is therefore $3.00 or $4.50 before tax, retries and other costs. No generation was purchased or tested.

fal's [API terms](https://fal.ai/legal/api-services) describe proprietary and licensed third-party models and permit end-user integrations subject to responsibilities. Its [service terms](https://fal.ai/legal/terms-of-service) require input permissions and restrict access to adults. Model-specific eligibility, account terms and consent must be cleared before a live run; this research is not a legal opinion or a claim of license clearance.

**Temporary cheap API option:** [fal Wan Animate Replace](https://fal.ai/models/fal-ai/wan/v2.2-14b/animate/replace) lists $0.04/0.06/0.08 for 480p/580p/720p per **16-frame billed second**. Cost depends on frames, not merely clip duration. A ten-second 24-fps clip is 15 billed seconds, or $0.60 at 480p and $1.20 at 720p. Its page says it will be removed January 4, 2027. It should not be a permanent hard-coded dependency.

**GPU budget context:** [Runpod's RTX 4090 page](https://www.runpod.io/gpu-models/rtx-4090) lists 24 GB VRAM and on-demand rates of $0.34/hour Community or $0.89/hour Secure Cloud, varying with availability. These are hourly compute prices, not verified per-video costs or an assurance the full Animate stack fits. Persistent storage, initialization, idle time and retries add costs. No GPU was rented.

## Recommendation

Own the UX, asset/rights record, durable jobs and renderer contract. Follow McCluster's existing self-host-first resolution policy once a candidate passes license, quality and cost checks. Use a licensed hosted renderer only as an approved evaluation/burst option, not a second backend or automatic new subscription. The current artifact delivers the planning foundation; it deliberately does not claim live recasting.
