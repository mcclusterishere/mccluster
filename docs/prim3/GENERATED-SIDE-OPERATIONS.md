# Generated side operations: review preview

November 7, 2026. Additive work against main `610b846716ed925e54a5f534dd4b02383522b0b7`. No deployment, production writes, model calls, schema changes or paid jobs.

## Existing work and the actual gap

World's 25 authored side-operation records still launch Transit with different briefing text. This change preserves those records and their routes. The tactical lifecycle and adaptive-practice work from #739 and #742 are merged; neither is duplicated. The older news-draft/attribution branch at `7cbde0008ed3377cd3b602613bae8f1382a0f985` is two commits ahead of its historical base and 190 behind current main. It produces reviewed prose candidates, not playable geometry. It remains separate and is not blindly merged.

This slice turns explicitly reviewed regional inputs into different playable training layouts in the existing game. It does **not** complete automatic worldwide news discovery, exact building reconstruction or the OVH production pipeline.

## Owner journey and data boundary

Open the existing owner-only PRIM3 World country card, then **Build a playable side operation**. Review the regional label, latitude/longitude and public geography source. Choose urban, coastal or woodland terrain; restore, survey or recover; and a layout seed. Optional news JSON must include a source event ID, HTTPS publisher URL, publisher, publication time, event country, supported theme and review ID. These are owner-supplied review inputs, not independently authenticated source verification.

The existing server owner gate loads the controls. **Generate, validate & save** creates a browser-local recipe, runs canonical resolver reachability checks, and offers Play or Resume plus a JSON export. Editing any input removes the launch link and clears the review checkbox. Reload restores form fields but never grants review automatically. An unchanged review reproduces its identity; review metadata does not randomize its layout.

Recipes use `prim3.generated.recipe.v1.<id>`. Tactical runs use the existing per-level save mechanism with that stable recipe identity. The legacy Transit, Forge and authored mission save keys are untouched. Regenerating an existing identity offers Resume; replacing a run remains an explicit Restart inside the game. Content-ID checks protect against accidental mismatch, not client tampering or malicious hash collisions.

News entries are available for **new starts until publication time + 24 hours**. This conservative preview does not invent a release timestamp or extend a stale story's life through re-review. Existing runs and debriefs can reopen after expiry; Restart/Replay cannot create a new expired run or erase the old one. Browser time/local storage are not trusted production enforcement.

No article body, headline, named adversary or instructions are copied into scenario text. The compiler uses a small theme enum and fixed training copy. Publisher attribution is retained without claiming every source originated with GDELT. No live Halo Ops feed, private records, credentials, model output, learner profile or operational telemetry enters this path.

## Actual gameplay variation

- **Technical: restore.** Reach one training-network checkpoint and perform Inspect → Restore → Verify, each through the canonical positioned interaction/AP resolver.
- **Recon: survey.** Reach two separated checkpoints and Observe → Corroborate at each.
- **Entry: recover.** Reach two supply caches and Secure each before extraction.
- Every required checkpoint must be complete before extraction is offered. Wrong roles, out-of-position actors, wrong phases, duplicate actions and missing AP are rejected by the existing resolver. Losing the required operator ends an unfinished exercise rather than hanging it.
- Urban blocks, coastal water/bridge/container layouts and woodland/outpost layouts are materially different. Seed, regional anchor, objective and source event/theme affect geometry. Maps cover 128 metres per side in the Forge document and use the existing approximately 3.54-metre tactical grid. Existing squad and opponent statistics are reused. Forty turns is a generous preview budget, not a balance claim.
- Each checkpoint has visible geometry consistent with its collision. Roofs have authored access. Canonical movement, seeded hostile turns, cover and combat remain upstream-owned; no vendored engine file changes.

## Geography and civic buildings

The coordinates are a **regional reference**, not survey-grade georeferencing. Terrain/layout are explicitly synthetic and do not purport to reconstruct streets, interiors or the real event. The helper converts local east/north offsets to approximate coordinates and wraps the date line; latitude is bounded to ±80 degrees.

Real civic/government building footprints must stay real in the eventual shared City adapter. This preview refuses supplied building/footprint payloads instead of silently moving or replacing them with generic structures. It creates no real civic targets or accusations. Exact public building projection, protected non-target treatment, terrain datasets, geometry rights/attribution and shared City metric gameplay are **unfinished**, not simulated by a renamed map.

## Verification and remaining release gates

Run the focused checks from repository root:

```
node --test scripts/test/prim3-generated-missions.test.mjs scripts/test/prim3-world.test.mjs scripts/test/prim3-lifecycle.test.mjs scripts/test/prim3-transit-level.test.mjs scripts/test/prim3-adaptive-missions.test.mjs
```

Current local result: **66 passed, 2 skipped, zero failures** across the five focused suites above. JavaScript syntax and changed-file whitespace checks passed. The two skips are the documented separate-repository canon checks. The complete repository suite, upstream vendor suite and live production acceptance were not run here. Browser acceptance is recorded below.

New checks cover nine combinations over twenty seeds (180 maps), every role's complete route/objective/extraction loop, saved debrief, source/review guards, geometry variation, roof reachability, visible checkpoint collision, corruption/retry identity and deterministic hostile turns. Complete route tests remove threats at fixture setup to isolate objectives; they do not establish combat difficulty or production playability. Legacy lifecycle/Transit/adaptive regressions are also run. The World suite's two upstream-canon checks require a separate Prim3 checkout and otherwise remain skipped.

Independent local browser validation passed on November 7 after integrating main `1f3b3d26df29135887e38fd38a831e8ace7aaa6f`. The complete, unfiltered `scripts/e2e/prim3-generated-missions.e2e.mjs` run exited zero. Review, repeat generation, save/resume and expiry passed at 390px and 1280px, as did denied-owner access and recipe-storage failure. The fixture serves real local Three.js **0.180.0**, verifies that package version, and only maps the exact CDN version requested by production imports; other external origins are blocked. It requires a ready renderer and nonempty canvas, dismisses the briefing before map screenshots, and checks page errors.

Six ordinary-threat completion cases passed: urban restoration, coastal recovery and woodland survey, each at 390px and 1280px. They completed in rounds 4, 5 and 8 respectively, with all three operatives alive and extracted. Woodland retained the ordinary firefight and ended with Recon at 3 HP. Each case checks actual state changes, mid-run reload, completed objectives, extraction, debrief and exact terminal-state reload. Screenshots and initial/command/final-state JSON are emitted for review. No enemies, HP, AP, collision, combat rules or saved game state are injected or weakened.

The completion runner uses ordinary Playwright pointer clicks for squad, action, confirmation and turn buttons. Link clicks use `noWaitAfter`, followed by bounded checks of the actual destination document URL, DOM readiness and real renderer readiness; this avoids racing the app's startup `replaceState` without skipping readiness. Movement destinations use the existing board `onTap` handler and ordinary confirmation buttons. This is **semantic board integration**, not proof of a complete physical pointer/touch navigation journey. These three fixed scenarios demonstrate playable completion, not balance across every seed or all nine terrain/objective combinations. Owner visual acceptance, physical device/touch acceptance and production acceptance remain separate.

The tactical workflow runs this expanded proof in a separate `generated-missions` job with a 30-minute timeout, pinned Playwright 1.57.0 and Three.js 0.180.0, and an always-run upload of screenshots, execution records and the run log. Existing tactical and spatial checks remain intact. The repaired test/workflow still needs fresh hosted validation on the final combined release commit; local results are not a deployment receipt.

Before releasing this owner preview, review its UX and attribution and pass fresh combined-commit CI. Before production news/geography release, replace local review inputs with authenticated immutable releases using the existing control plane; wire the reviewed Core news job without operational-feed leakage; implement exact civic geometry through the existing City contract; validate canonical PostgreSQL persistence/concurrency and server-side expiry; integrate signed learning checkpoints through the existing adaptive adapter. This tactical slice grants no LMS mastery, Principles credit or credential. Separate explicit approval is required for migration, merge, deployment, enablement or live job execution.
