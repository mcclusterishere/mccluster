# Production studio source checkpoint — 2026-11-01

Open `control.html#create:projects` in this checkout. Production studio is mounted in the existing Create → Projects media panel. Work projects remain in the existing Work view; a plan can link to one. The older quick generator remains available below the studio.

## Implemented slice

- Owner-only private plans reuse `media_workflows.config`; references reuse `media_entities`. No new table, queue, provider or migration. The reconstructed schema already declares both tables; deployed presence is unverified.
- Title, source reference, canon decisions, episode script and ordered scenes save together. Client-selected plan IDs make an interrupted creation retry idempotent. Revision/hash and updated-at compare-and-swap prevent stale overwrites. Previous snapshots remain recoverable until a bounded history fills, at which point writes refuse without deleting history.
- A reference library stores owner-provided HTTPS image links and continuity notes. This is not an image uploader or identity-verification system. Saved references feed the selected model's declared input.
- Scene controls use catalog schemas. For empty schemas only, two existing fal entries receive minimal authoring controls from official API documentation: [Kling 3 I2V](https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video/api) and [FLUX 2 Max Edit](https://fal.ai/models/fal-ai/flux-2-max/edit/api), read 2026-11-01. Existing schemas win. No models, prices or permissions are installed or enabled.
- `/v1/media/estimate` uses the existing input validator, pricing and capability checks without reservations or provider calls. An input/price fingerprint is checked before the existing generation reservation. Timestamps are excluded from that identity.
- Generate remains an explicit button after the cost check. The plan records an uncertain-submission marker before calling the existing generation route, preventing an automatic repeat after a dropped response/reload. The user must check existing Library before allowing another submission. This is not a new exactly-once provider protocol.
- Existing `media_jobs` / `media_assets` supply durable job status and takes. Selection is verified as a completed output in the same workspace. Selected take provenance carries plan revision/hash and model/job/asset IDs.
- Export uses the saved revision's selected takes, duration and soundtrack notes. It is explicitly an editing manifest, **not rendered video**. Unsaved drafts have a separate download. Reference URLs must still be accessible to the provider when a user eventually generates.
- The existing front-page preview is linked, without copying private scripts to `site_content` or publishing changes. Soundtrack notes remain unassigned unless the owner supplies a verified association; general show-release identity is separate from the PRIM3 course mapping.

## Evidence

`node --test workers/mccluster/test/media-plans.test.mjs workers/mccluster/test/media-estimate.test.mjs workers/mccluster/test/media-input-contract.test.mjs workers/mccluster/test/media-capability.test.mjs workers/mccluster/test/media-budget.test.mjs`: **36 passed**.

`node scripts/e2e/production-studio.e2e.mjs`: **390 / 768 / 1280px passed** using real Control modules and the real plan handler with synthetic PostgREST and provider responses. Covers revision save/reload/history recovery, persistent reference selection, estimate without generation, changed-input invalidation, explicit mocked job submission, selected take export identity, uncertain response recovery, no horizontal overflow and 16px editing inputs. Evidence is generated in `/tmp/production-studio-proof/`.

No live database writes, provider jobs, credentials, production SQL, deployments or publication were performed. No runtime/provider success is claimed. The local branch contains private manuscript snapshots and must not be pushed to the public repository. Application commits may be reviewed separately on a clean permitted branch.
