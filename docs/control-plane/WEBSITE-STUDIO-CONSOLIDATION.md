# Website Studio consolidation (pending release)

This selectively recovers PR #493 at `9ad0503ead6c4a581e61cc529639bebd4fa64131`, on the repaired #595 / #623 managed-project foundation. It does not merge #493 or replace the cinematic editor. No production schema, account, service configuration, content or deployment was changed.

## Reused and consolidated

Reused: the strict three-tile `website-studio/v1` document contract, template definitions, accessible editor/renderer, registered private-media resolution, native preparation executor and versioned draft/revision contracts. Removed the standalone draft/publish API from the recovered service. Existing `managed_projects` owns the slug, authenticated owner and publication pointer; no second tenant registry or public media bucket was added.

`customer-projects.html` links each project to `website-studio.html?project=<slug>`. Save uses optimistic revisions; preview uses saved private content; publishing explicitly approves the current revision and a paid workspace. `presentation=front|tiles` selects the active publication without erasing either cinematic draft/publication or tile draft/revision. Unpublishing tiles does not resurrect the cinematic publication. Repository-bound Vaunt cannot switch to tiles.

Tile publication checks the existing paid subscription projection, current owner/admin workspace membership, allowed configured price, profile visibility, media ownership/readiness/explicit public approval, and current Stripe subscription (read only). The transactional SQL repeats ownership, visibility and paid-state checks and locks the exact draft revision. Media approval is checked by the API before publication and again on every public read; a concurrent withdrawal fails closed on subsequent reads. Public reads recheck subscription expiry and media withdrawal; issued signed URLs last at most 300 seconds.

## Integration contract

`handleManagedProjects` delegates tile and registered-media routes to `handleProjectTiles`, so the existing canonical entry dispatch mounts them. The tile endpoint is `/v1/projects/:slug/tiles`, with `/templates`, `/preview`, `/publish`, `/public`. Existing `GET /v1/projects/:slug` reports `presentation:'tiles'` and the canonical `website-studio-view.html?project=<slug>` URL after checking public availability. The parent integrates this discriminator into the existing public renderer; this commit does not edit shared front-member/main/tabbar files.

Both public handlers accept `expectedAuthUserId` and `expectedProjectId` and put those predicates in the same project fetch. The domain-target migration owns the immutable project UUID and identity guards; this migration does not duplicate them. `public.mjs` accepts the domain adapter's `MCC_STUDIO_HOST={project,api}` only for a valid slug and same-origin API. Domain integration must pass both immutable owner and project identity.

## Pending deployment gates

Review and apply `supabase/pending/website_studio_v2.sql`, then `project_tiles_v1.sql` only after existing canonical media/billing/managed-project schema. These are pending SQL, not applied migrations. The domain-binding migration is independently required for immutable custom-domain project bindings.

`WEBSITE_STUDIO_ENABLED=true`, valid existing creator price configuration and Stripe verification credentials are required; absent configuration fails closed. Upload processing additionally needs `WEBSITE_STUDIO_PROCESSOR_ENABLED=true`, the existing trusted canonical media executor and a real processing allowance in `creator_site_access`. This change does **not** invent an included processing allowance or grant one to a customer. Upload-to-cloud-to-executor is therefore not proven end to end; the fixture starts with registered prepared assets. Draft quota remains three per member. Music-recording and commerce offer adapters remain explicitly unavailable, not fake storefronts. No new persistent credentials or paid services were provisioned.

## Verification

- `node --test workers/mccluster/test/managed-projects.test.mjs`: existing managed-project behavior.
- `PGLITE_DIR=/tmp/selfservice-tools/node_modules node --test workers/mccluster/test/project-tiles.test.mjs`: executes pending SQL in isolated Postgres, service-role RPC, two nonadmin owners, private preview/publication, revision conflicts, direct authenticated writes/RPC denied, immutable binding mismatch, cancellation/private profile refusal, media withdrawal and both presentation switches. This optional suite skips without PGLite; it is not a live Supabase test.
- `PGLITE_DIR=/tmp/selfservice-tools/node_modules PLAYWRIGHT_DIR=/tmp/selfservice-tools/node_modules node scripts/e2e/project-tiles.e2e.mjs`: real Chromium editor/renderer and handler against that SQL fixture; template, explicit per-asset approval, save/preview/publish, actual FFmpeg-prepared audio/video playback, unpublished revision isolation, withdrawal, and 390/1440 width checks. External network is intercepted. Synthetic auth/subscription/prepared-media records are fixtures, not real accounts or charges.

The original minimal paid profile publisher, basic profile editor, free cinematic editor and current membership approval policy remain in place. These fixture results establish a reviewable implementation, not production readiness or release authorization.
