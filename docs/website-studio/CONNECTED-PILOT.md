# Website Studio connected pilot — October 17, 2026

Status: implemented development integration, NOT deployed or production-ready.
Extends PR #493, not a separate account/backend/ledger. Both feature switches
remain absent/off: WEBSITE_STUDIO_ENABLED and WEBSITE_STUDIO_PROCESSOR_ENABLED.
No production schema, billing, provider subscription, storage bucket or quota
was changed. This file supersedes the earlier foundation-only progress report,
not its identity/privacy boundaries.

## New code

- website-studio.html + editor.mjs: free-account gate through existing MCC Auth;
  three editable tiles; standard/cinematic mode; media selection; upload/trim;
  explicit public approval; account save/load with expected revisions; saved
  preview; explicit publish and confirmed published link. The demo is public and
  labeled as McCluster's, while new account drafts contain no personal footage.
- service.mjs: mounted by the existing creator-site publisher handler. Verifies
  the bearer at Supabase Auth, then resolves the active primary M identity.
  Private drafts, registered sources, preview, publication and withdrawals are
  owner-bound. Client actor IDs/prices/publication claims are not authoritative.
- Existing creator_published_sites is extended with an immutable Studio revision
  pointer, rather than creating a competing publication authority. Drafts and
  versioned guidance are additive. Public reads resolve approved references anew.
- Native audio and video use controls and one-audible-player coordination;
  transitions use seek-optimized muted video and their own scroll progress.
  Preview and public view use the exact same renderer.mjs. Reduced motion keeps
  the content and removes transitions. This is a rendering candidate, not a
  benchmark claim that video seeking wins on every phone.
- The panorama component is original WebGL code for real 2:1 still panoramas,
  with explicit entry/exit, drag/keyboard controls and a visible unsupported
  fallback. It is not a 360-video renderer, headset/WebXR experience or a flat
  video-to-360 generator.
- Native CPU preparation: FFprobe validates source streams; FFmpeg makes the
  muted all-intra transition variants, poster, audio/video or panorama output.
  Source size, duration, dimensions, types, trims, output sizes and command
  runtime are bounded. Only local input files/allowlisted container demuxers;
  no shell execution or user-supplied FFmpeg filters/remote input protocols.
- Existing private mnet-media bucket, media_assets, media_jobs and ops_compute_tasks
  are reused. No new bucket or GPU purchase. A loopback executor matches the
  existing compute node agent's HTTP executor contract. A per-job capability
  gives access to only that source and output prefix, never service-role keys.
  Production inspection found ops_compute_tasks has RLS and no anon/auth grants.
- Existing native posts may be selected only if their media entry already has
  an authorized media_asset_id/asset_id connection. Removed/private posts do
  not become public by pinning. Legacy posts without that connection need a
  separate reconciled adapter; no guessed URL inheritance.

## Important limitations / release blockers

1. SQL is pending, not run against production. The added CI workflow runs it on
   a disposable PostgreSQL service with representative existing schema and
   separate real-role/revision assertions. A stub is NOT a full production
   migration replay; promotion still needs the canonical replay/advisors.
2. The pilot access projection requires reviewed org/account entitlement grants.
   Existing cohort claim -> grant reconciliation is NOT complete. No user can
   grant themselves access. No existing paid or cohort rights were deleted.
3. Processor deployment, approved capability registration and signed-storage
   integration have not been exercised against the real account. Deploy the
   loopback executor under a nonroot service with cgroup memory/CPU limits,
   read-only filesystem except a bounded temporary directory, no arbitrary
   outbound traffic and an up-to-date FFmpeg build. Native command allocation
   limits alone are not a full OS sandbox.
4. Private job tickets expire after one hour. Stale queued/failed jobs need
   reissue/reconciliation, unused budget release and cleanup before public
   rollout. Measured job costs belong in the existing cost reconciler; a
   reservation ceiling is not an actual cost. This code does not charge wallets.
5. Native uploaded audio/video and still panoramas are implemented. Existing
   recording-catalog/commerce offers deliberately fail closed until authorized
   ownership, preview-vs-master and checkout/entitlement adapters are connected.
   No song-sale or 360-video capability is claimed by this slice.
6. Last-good published revisions are retained; a customer-facing rollback flow
   is not implemented. Existing legacy public URLs need presentation handoff
   testing. Media URLs expire after five minutes; long-lived player URL renewal
   and appropriate byte-range/caching behavior need integration tests.
7. Withdrawal prevents new signed reads. Already issued five-minute URLs and
   bytes a visitor already received cannot be retroactively recalled. Do not
   advertise instantaneous revocation of already buffered files.
8. This editor is a functional pilot, not the finished visual benchmark. Sources
   currently show short IDs; human titles/thumbnails, native-post search,
   persistent upload recovery, preparation reuse after recropping, captions,
   full draft/publish E2E and physical iOS/Android testing remain.
9. The existing marketing funnel has NOT been redirected into an unactivated
   editor. Once the end-to-end path is verified, change Use this template to
   this editor while retaining free sign-in and the selected-template intent.
10. Whole-repository CI results are not implied by the isolated results below.

## Validation actually run in this turn

- 38 Node tests pass: 18 existing foundation checks plus 20 connected checks.
- Native FFmpeg conversion actually ran on generated test footage. Assertions
  verified output files, muted transition audio, dimensions, bad trims and
  rejection of ordinary footage as a panorama.
- 16 offline Chromium checks at 390px pass: account gate, three tiles, save,
  real audio/video elements, forward/backward seeking of converted footage,
  public/preview parity, reduced motion, no overflow and no uncaught JS errors.
- Browser networking is restricted here. The DOM checks inject modules in
  isolated scopes and bridge API calls to the actual handler with a memory DB.
  They do NOT authenticate real users, invoke real cloud storage or publish
  publicly. Node imports test the normal module resolution.
- WebGL was unavailable in this browser; the 360 unavailable-device fallback
  and exit were exercised. Actual GPU panorama rendering is NOT claimed tested.
- PostgreSQL is not installed locally. No local SQL execution claim is made.

Commands:
```
node --test scripts/test/website-studio-v1.test.mjs scripts/test/website-studio-connected.test.mjs
# The isolated browser runner needs generated verification/media fixtures and
# scripts/e2e/website-studio-server.mjs running on localhost:8789.
python scripts/e2e/website-studio-browser.py
```

## Processor integration

Run `node core/src/website-studio/executor.mjs` only after reviewed deployment.
Set STUDIO_EXECUTOR_TOKEN to a long local secret and configure existing node
capability `media.prepare`, implementation `studio-native-1`, executor type
`http`, URL `http://127.0.0.1:9463/execute`, health URL `/health`, the matching
Authorization header and max_leases=1. Never commit the token. This is an
executor adapter for the existing agent; it does not replace Core scheduling.

## Data transitions

Template selection -> verified M Account -> saved draft/revision -> upload
registration -> private upload -> provider-size check -> budgeted media job
and canonical compute task -> native preparation -> bounded output receipt ->
ready media -> explicit publication approval -> saved draft preview -> published
revision pointer -> public resolution. Every step has a distinct status.
No local preview, upload receipt or browser timer is counted as a successful
public release or a completed mission.
