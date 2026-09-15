# McCluster Autonomous Game Studio

Status: v0.1 foundation

## Objective

Turn `game.build` into a durable, provider-independent McCluster capability that can plan, create, build, enter, play, measure, review, repair, and preview a game experience without granting autonomous production-deploy, merge, or unrestricted spending authority.

The initial target is PRIM3: a sophisticated tactical 3D game whose campaign, canon, real-world context, Hitman's Halo/Cesium spatial data, code, generated assets, and playtest evidence are all coordinated through McCluster Core.

## Production loop

`canon/campaign -> machine-readable game spec -> world context -> level plan -> asset plan -> implementation -> build -> embodied playtest -> telemetry evaluation -> independent review -> repair -> preview`

The repair stage loops back through implementation/build/playtest until acceptance criteria pass, a bounded repair budget is exhausted, a safety gate trips, or the owner stops the run.

## Roles

- `studio.director`: turns intent/canon into acceptance criteria and production scope.
- `world.intelligence`: gathers geospatial/current-world evidence with provenance.
- `level.architect`: creates tactical spaces, encounter graphs, traversal, objectives, and world anchors.
- `asset.director`: resolves generated/reconstructed/reused assets and licensing.
- `game.engineer`: modifies game source only in disposable worktrees.
- `build.engineer`: creates reproducible playable artifacts.
- `playtest.agent`: enters the running build, observes, acts, explores, and records evidence.
- `qa.evaluator`: scores gameplay, completion, performance, regressions, visual defects, and canon consistency.
- `independent.reviewer`: reviews the evidence package independently from the builder.
- `repair.agent`: converts failed metrics into bounded repair tasks.
- `release.manager`: creates non-production previews after gates pass.

These are logical roles, not necessarily permanently loaded models.

## Evidence contract

A stage cannot claim success merely because an agent says it succeeded. Each run must produce machine-readable evidence appropriate to the stage, including provenance, build logs, synchronized playtest telemetry, screenshots/video where useful, evaluation outputs, and an independent review record.

## Capability boundaries

The studio must call stable McCluster capabilities instead of binding orchestration logic directly to a vendor. Target capabilities include:

- `repo.inspect`
- `research.web`
- `code.build`
- `world.generate`
- `model3d.generate`
- `image.generate`
- `audio.generate`
- `video.generate`
- `deploy.preview`

Later embodied execution should gain its own stable capabilities, such as `game.launch`, `game.observe`, `game.act`, `game.playtest`, and `game.evaluate`, rather than hiding engine-specific automation inside one executor.

## Engine strategy

The orchestration layer must be engine-agnostic. Godot is the default self-hostable experiment target because it is open source and automatable, but Unreal, web/Cesium experiences, simulators, and future engines can sit behind adapters. Engine choice belongs in the game specification and capability router, not in the control-plane contract.

## Hitman's Halo and the world layer

Hitman's Halo is a spatial nervous system and sensor/adapter surface, not the authoritative world database. The studio may request bounded world context from Halo/Cesium and the broader World ingestion layer, then capture a versioned snapshot with timestamps, coordinates, confidence, and source provenance for a specific operation. Game content must not silently mutate because a live feed changed after a build began.

## Safety and governance

v0.1 intentionally does not:

- merge source automatically;
- deploy production automatically;
- authorize unbounded spending;
- allow a builder to approve its own work;
- treat open-web claims as canonical truth;
- give game agents unrestricted access to production credentials.

Disposable worktrees, isolated credentials, explicit budgets, source provenance, and builder/reviewer separation remain mandatory.

## v0.1 shipped in this branch

- deterministic game-studio planning kernel;
- `game_build_plan` Core executor;
- an 11-stage production loop with gates and evidence contracts;
- runner registration;
- tests and syntax checks.

## Next increments

### v0.2 — playable local loop

Add engine adapters and a first `game.playtest` implementation that launches a build, captures frames/logs, executes bounded actions, records telemetry, and returns an evidence bundle. Start with a tiny PRIM3 vertical slice rather than the entire campaign.

### v0.3 — repair loop

Connect failed evaluations to bounded `code.build`/asset tasks, rebuild, replay, compare metrics, and stop on convergence or budget limits.

### v0.5 — geospatial/world-aware production

Introduce versioned World Context Packages derived from Halo/Cesium and governed `research.web`; add real terrain/building/road anchors while preserving fictional clandestine facilities and gameplay geometry.

### v1 — autonomous studio

Run production DAGs across planner, code, media, 3D/world, embodied playtest, evaluation, independent review, preview deploy, provenance memory, and rented GPU nodes. Human approval remains at governance-defined consequential boundaries.
