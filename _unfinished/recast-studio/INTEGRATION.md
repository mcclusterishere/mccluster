# Integration into the existing creator service

## Branch handoff for Claude or another implementer

Review branch: `codex/recast-studio-20261109` in `mcclusterishere/mccluster`. It starts from main `578e683088fdd49fb77848733e70dd4f3af039c3` and only adds `_unfinished/recast-studio/`. It does not include, replace or supersede PR #793. No existing application, Worker, database, workflow, capability catalog or shipping navigation file is changed.

```sh
git fetch origin codex/recast-studio-20261109
git diff --stat 578e683088fdd49fb77848733e70dd4f3af039c3..origin/codex/recast-studio-20261109
git show origin/codex/recast-studio-20261109:_unfinished/recast-studio/README.md
# Optional isolated local review, without switching an active worktree:
git worktree add --detach ../mccluster-recast-review origin/codex/recast-studio-20261109
cd ../mccluster-recast-review/_unfinished/recast-studio
npm test
npm run check
npm start
```

Recheck current main and PR #793 before integration. At the publication check on November 9, PR #793 was still open/draft at `d3db21c9a14523fb6d55e5865c9ddaf1e9e64558`, a handoff-only commit over the inspected `de22ed3` code. Do not replay its SQL, duplicate its operation claims or overwrite its media files from this prototype. Review the applicable current repository instructions before porting. This is a code-review handoff, not permission to merge, deploy, install an engine, transfer media or spend money.

Reusable pieces:

- `lib/recast-contract.mjs` plus `test/recast-contract.test.mjs`: move or adapt the pure validation, normalization, hashing and transition concepts into the existing media contract. Replace illustrative limits/prices with server-authoritative catalog and pricing. Client attestations are not production authorization.
- `public/` plus `test/ui-controller.test.mjs`: authoring-flow reference, to be adapted inside the existing creator shell and house styling/navigation. Keep existing authentication and role-scoped controls. Do not ship this standalone page as a second creator application.
- `server.mjs` and `test/server.test.mjs`: local review only; never deploy this server as a new backend.
- `qa/browser-check.mjs`: unfinished real-browser acceptance harness. Run and extend it in a permitted browser environment, then cover the canonical integration and real iPad behavior. DOM-double tests do not substitute for that.
- `RESEARCH.md`: dated engine/license/cost evidence and reasons the renderer remains disabled. Revalidate terms and prices before selecting any live binding.

A cherry-pick or merge of this review commit only brings in the isolated reference folder. It does not integrate the feature. Use the sequence below for the actual implementation; preserve the acceptance gates rather than announcing live recasting from the prototype.

## Verified code base

GitHub [draft PR #793](https://github.com/mcclusterishere/mccluster/pull/793) was freshly checked on November 9, 2026. Its head was `de22ed3a90392f0897b8959fbdbe564ebdc2fcc9`, branch `claude/new-session-83ken5`. Files inspected at that exact head:

- `workers/mccluster/src/media/mcp.js`: `video.generate` chooses text-to-video or image-to-video. Normalization consumes only the first reference URL. A source motion video plus a separate character set needs an explicit new contract.
- `workers/mccluster/src/media/router.js`: generation is fal-only. It owns canonical jobs, tenant permission checks, cost reservations and operation claims. New media operation claims are still described as a pending migration; this investigation did not verify production RPC deployment.
- `workers/mccluster/src/media/input-contract.js`: validates provider input shape and URLs, not a complete ownership/rights/transfer-authority policy.

Additional inspected snapshot seams: `media/fal.js`, `media/pricing.js`, `media/recommend.js`, `core/src/tools/registry.mjs`, and existing `media_models`, `media_jobs`, `media_assets`. Catalog `commercial_use` flags do not establish territory eligibility or publication rights. Provider result URLs alone are not verified durable private ingestion.

## Narrow implementation sequence

1. Add planned capability `video.recast` to the canonical capability registry. Keep it disabled until a renderer binding and gates pass. Do not rename ordinary `video.generate` or cram two distinct media roles into its first-reference behavior.
2. Add the provider-neutral request contract beside existing input validation. Required source-video asset ID, distinct character-reference asset IDs, selected time range, role mapping, output settings and consent/provenance revision. One-character UI is the first scope; multi-character fields should have verified provider limits before exposure.
3. Resolve asset IDs server-side under tenant ownership and transformation permission. Verify actual file signatures, bounded duration/dimensions, hashes, safe decoding and source/likeness/audio rights. Source availability is not permission to transfer it to a renderer. Member proof-review access is especially not provider-sharing consent.
4. Snapshot model/dependency license revisions, territories, commercial eligibility and safety requirements. Reject unknown rights. Keep the provider's safety checking enabled.
5. Preserve PR #793's atomic operation claim and budget handling. Bind a stable operation ID to the normalized request hash. A changed request under the same operation must conflict. Do not resubmit after a network timeout with unknown acceptance; reconcile the original provider request.
6. Add a replaceable renderer binding. A fal hosted recast candidate reuses the current adapter. A future self-hosted renderer is an isolated GPU executor behind the same service, not a second control plane. OVH remains CPU orchestration/preprocessing. iPad remains the authoring and preview surface.
7. Ingest verified results into approved private storage, recording hashes, source/character/job lineage, license and consent revision, actual cost, selected audio treatment and review status. Validate output URLs against SSRF, redirects, expired links, size limits and content types.
8. Review/export is distinct from publication. Require an explicit publish action and appropriate rights/disclosure review. No automatic posting is included.

## Better than a thin clone

- Character library with permission history and approved reference sets.
- Per-shot mapping and mask preview before spending, rather than treating elapsed time segments as discovered shots.
- Small low-cost test take before a full batch. Show a real estimate and reserve a hard total ceiling.
- Multiple takes with reproducible settings and cost/quality comparison.
- Durable queue with cancel/reconcile, no duplicate charges after a reconnect.
- Side-by-side source/result review, source-audio policy, artifact provenance and reversible edits.
- Replaceable licensed engines, so provider retirements do not strand projects.

These are implementation goals, not claims that the prototype already renders or surpasses Openjutsu.

## Acceptance gates

- Current Claude head rechecked and integration conflict review completed.
- Required migrations verified in the actual target, not inferred from local files.
- Authenticated multi-tenant access tests, source/output isolation and secure provider transfer.
- Paid-job idempotency, timeout reconciliation, concurrent budget claims and cost settlement tests.
- Permission revision change/revocation, retention/deletion and output review behavior.
- Mobile/iPad browser QA and interruption/reload tests against durable jobs.
- Consented fixture benchmark: front/profile views, occlusion, small faces, multi-person ambiguity, reflections, lighting changes and cuts. Record identity fidelity, motion errors, masks, flicker, audio sync, render time, peak VRAM/RAM, retries and actual cost.
- Provider terms/licensing review and explicit authorization for installation, paid renders or deployment as applicable.
