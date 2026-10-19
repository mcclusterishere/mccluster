# PRIM3 Character Re-characterization — McCluster Studio V1

Status: DESIGN / CONTRACT PROPOSAL — NOT DEPLOYED
Owner direction: 2026-10-19
Narrative authority: mcclusterishere/Prim3
Backend authority: mcclusterishere/mccluster
Proposed capability ID: video.recharacterize
First digital performer: prim3:royce

## One-sentence product

Upload an original or licensed performance video, select a human subject, select a licensed virtual character (Royce first), and create a version in which the virtual character performs the source action while preserving camera, scene, edits and audio as approved. Review before any publication. The McCluster system owns all identities, jobs, provenance, cost and social syndication.

This is VIDEO-TO-VIDEO CHARACTER REPLACEMENT. The current MCP video.generate reference behavior selects image-to-video, so it is not an implementation of this contract. Do not advertise the replacement tool as live.

## Existing architecture — reuse, never fork

1. PRIM3 owns all story, cast IDs, spoiler timing, character and plot canon in its own source repository.
2. McCluster owns Worker mccluster, api.mccluster.org, shared Supabase, Media Harness, Core compute scheduler, M Account, rights and asset records, internal Studio, and existing social_publish_jobs.
3. Human Uprise (movement/social software) and Equity Uprise (a program and fictional workplace in-story) are distinct contexts. Equity Uprise HQ in the fiction remains separate from Site 0/Root HQ.
4. The virtual performer has one durable character ID with an optional fictional persona/profile; the public profile clearly states fictional/AI-produced by McCluster. It must not masquerade as an independent real person or invent organic popularity.
5. Character face images, owner videos, private source frames, voice references, credentials and unpublished spoilers never go in public Git. Private asset IDs and rights grants are used instead.
6. External publication uses existing official API/OAuth publishers and owner approval, not headless personal account automation.

## Evidence-based technical candidates

A. WAN2.2-ANIMATE-14B (open weights): official Wan video README details a driving video plus reference character image, pose/face preprocessing, masks/background, and replacement mode. Source: https://github.com/Wan-Video/Wan2.2 . Verify exact model/weight licenses, commercial rights, required GPU RAM, frame-size and duration limits and output quality in an evaluated executor before production binding.

B. RUNWAY ALEPH 2.0 / EDIT STUDIO (commercial benchmark): company announcement May 21, 2026 and help documentation describe video edit and character replacement up to approximately 30 seconds at 1080p in Edit Studio. Sources: https://runway.com/news/introducing-aleph-2-and-edit-studio and https://help.runwayml.com/hc/en-us/articles/51683104370451-Creating-with-Edit-Studio . Do not assume Edit Studio web capabilities are callable through an API or rights-cleared at our desired scale.

C. Other options should be evaluated via the existing media model registry: segmentation+tracking, Wan VACE masked edits, audio/lip-sync specialist, and continuity/refinement models. Do not hardcode providers into the capability contract.

## User-facing workflow (mobile first)

1. Upload video or pick from creator-owned media library. Handle iPhone codecs, MOV, HEVC, variable FPS, interruption and resumable multipart upload. Store immutable original.
2. Select a visible person in a source frame and confirm the tracked subject through each shot. Reject ambiguous bystander replacement.
3. Choose fictional digital character Royce, select owner-approved reference-sheet version, approved wardrobe and render mode.
4. Preview one keyframe and 2–5 second motion proof with split source/target comparison, quality hints and known pricing.
5. Show estimated maximum cost, frame dimensions, planned segment count and expected unsupported shots; require a real approved spend budget.
6. Queue shot/segment renders; progress tracks work artifacts and charged units. Allow cancel and resume safely.
7. Review identity drift, face expression, hands, hair, occlusion, scene lighting, mask borders, talking audio and scene seams. Regenerate only failing spans.
8. Assemble timecode-aligned master; keep original audio unless creator requested mute. Produce approved platform variants (9:16, 16:9 and captions).
9. Editor approves finished content; independent publisher approval is required before posting to Human Uprise or externally.
10. Preserve signed job lineage and render/cost receipt for each output.

## Arbitrarily long originals versus model duration limits

No generative-video model gets an unlimited duration requirement. The product may ingest long videos, but the render engine MUST segment them into bounded work units according to provider limits, first by shot boundary, then by smaller overlapping frames/time ranges. Every span needs:
- target track identity and resolved performer identity;
- first and last reference frames and mask/pose conditions;
- stable versioned character references and approved wardrobe;
- source timecode, audio offset, shot ID and overlap plan;
- per-stage cost cap, retries and provider/model version;
- checkpoint and artifact hash.

Longer render support is a measured scaling phase, not a blanket promise. Recommended private MVP: one performer, one target, one 5–15 second continuous shot, 720p, 24/30 fps, original audio. Only expand to 30 sec and multi-shot once adapter and QA gates pass, then multi-minute via checked stitching.

## Character sheet and public profile

Public-facing character ID prim3:royce maps to the already canonical Hitman H-Authority-01 successor. Royce is seven years younger than McCluster, physically adult, white-presenting in the proposed engineered-derivative backstory; his threat comes from personality, conditioning and agency, not racial essentialism.

Appearance must be human approved before rendered media:
- front, three-quarter left/right, side, full-body and expressive portraits with consistent anatomy and identity;
- plain neutral outfit and at least one approved Hitman-era wardrobe variant; no invented official marks or copied celebrity trademarks;
- adult character facial proportions, build, skin tone, hairstyle, eye style, gestures, voice direction, expression range;
- head/body proportion and retargeting-safe reference sets, negative constraints, measured consistency checks;
- rights record for original references; private source media never committed.
- spoiler-safe biography and a separate reveal-gated character provenance record.

If the intended look is a literal alternate-race version of the owner's face, authorized clear front/side photographs are needed; prompts alone cannot guarantee accurate owner likeness. Initial generated sheet is a concept, not locked canon.

The public social account discloses FICTIONAL / AI-PRODUCED PRIM3 CHARACTER. In-character fictional social posts are permitted, but not fake real-world travel, real-world endorsements, independent audience testimonials, fabricated news, or artificial account-to-account engagement. Never expose the hidden clone origin before the authorized reveal.

## Work graph and durable evidence

Stage 0: verify rights, upload ownership, likeness grants, studio authorization, media probe, source hash.
Stage 1: analyze shots; track target; decode constant-frame-rate proxy; detect audio and source timing.
Stage 2: segment foreground, mask and background; estimate pose/face; validate ambiguous occlusions.
Stage 3: lock character ref and costume; snapshot exact PRIM3 canon/source revision, rights and model permissions.
Stage 4: deterministic shot plan and per-segment capability route; estimate cost and enforce budget.
Stage 5: render short model-bounded units on a certified GPU or hosted provider. Save receipts and intermediate outputs.
Stage 6: QC per shot: face identity/geometry, temporal stability, pose correctness, background preservation, mask borders, legal/policy review; human recheck.
Stage 7: reconstruct time and audio; stitch overlap with explicit seam review; export mezzanine and channel editions.
Stage 8: editor approves each final; publish job created ONLY after rights/fiction labeling/platform approval.
Stage 9: collect exact platform receipts and verified analytics. Never invent impressions, posts or followers.

Each stage is idempotent and emits immutable artifacts with parent lineage. Deduplicate by tenant ID + source hash + character reference version + edit plan + renderer version. Atomic queue leases and retries on Core must protect against double spend.

## Proposed stable contract

Schema lives at docs/control-plane/contracts/recharacterize-job.v1.schema.json in this branch.

Proposed capability video.recharacterize:
- lifecycle: proposed until an evaluated executor and provider are bound
- execution: async
- risk: spend; budget gated
- required source_asset_id, target_track_id, character_id, character_reference_version_id, rights_record_id
- render_profile max_duration_seconds, max_cost_cents, fps, resolution, aspect ratio
- audio_policy preserve or mute (no voice cloning in V1)
- review_state separate from publish_state, publish initially disabled
- only backend-issued track IDs and rights verification count; client boolean consent claims DO NOT suffice.

Future authenticated canonical-Worker endpoints, NOT YET ROUTED:
- POST /v1/media/recharacterize — create one idempotent authorized job
- GET /v1/media/recharacterize/{job_id} — owner/tenant-scoped status, evidence
- POST /v1/media/recharacterize/{job_id}/review — signed editor decision
- POST /v1/media/recharacterize/{job_id}/cancel — cease future work
All must delegate to the existing media_jobs and controlled asset store, not new independent tables if reuse is viable.

## Rights/privacy/public distribution gates

The service handles face imagery, video of actual people and possibly voice. Require verifiable source ownership/license and recognizable-performer likeness permission. Treat a user's own footage, someone else's likeness, and third-party copyrighted clips as distinct rights; a checkbox cannot authorize a stranger's face. Do not publish edited purported eyewitness footage, credentials, emergency information, public statements or synthetic endorsements as authentic.

Retain only for documented purpose and approved retention period, with revocation and deletion path, encryption at rest, access logs and reasonable breach controls. Before any public rollout, update privacy policy, rights/release flow and disclosure text to reflect actual processing and storage.

Account/profile affiliation must show real operator or studio where appropriate. Generated images/videos distributed externally should include clear synthetic/fictional context and platform-required labels. Human approval is required for paid spending, model training on likenesses and external publishing.

## Acceptance gates for private Stage 1

- A selected subject becomes Royce on ONE authorized 5–15 second video, with face/wardrobe identity sufficiently consistent for owner review.
- No accidental other-person swap; masks and multi-person tracking are correct or flagged.
- Original runtime, audio and time offsets preserved within one rendered frame where supported.
- Per-shot initial and final frame/pose check, no unacceptable visible temporal seam.
- Exact provider, source hash, renderer version, cost, copyright/rights and review evidence stored.
- Interrupted file upload, GPU failure and cancellation have bounded retry without duplicate paid effects.
- iPhone/Safari preview readable at 390px, never broken by scroll width or 16px inputs.
- No public UI flags, public uploads, external publication or unapproved biometric model training.

## Sequenced execution

0. This document + schema: design contract only; no claim of runtime implementation.
1. Owner-approved character sheet + one user-owned source performance + GPU or provider pilot and tracked output receipt.
2. Add evaluated Core executor/provider binding, capability registry entry and authenticated Worker endpoints; CI includes authorization, budget, idempotency and media QA.
3. Segment/stitch longer video with continuity controls, private Studio director UI and robust reviewer flow.
4. Create canonical Human Uprise fictional performer identity and managed distribution via existing social_publish_jobs; only after rights, privacy and approvals pass.

## Infrastructure finding

docs/control-plane/MCCLUSTER-OS-PRODUCTION-PLAN-20261019.md reports OVH Core compute currently CPU-only (8 vCPU, 24GB) with no proven GPU video-replacement binding. The existing media Worker routes generic image/video work but is NOT a functioning longform actor-swap runtime. A usable replacement model/provider, GPU compute and real private E2E render are the first missing operational dependencies.
