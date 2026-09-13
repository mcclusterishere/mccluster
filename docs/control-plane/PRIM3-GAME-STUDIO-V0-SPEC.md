# PRIM3 Autonomous Game Studio v0 Specification

Status: draft implementation target for PR #79.

## Purpose

Prove that McCluster Core can take a bounded PRIM3 mission specification, produce or modify a playable slice in an isolated workspace, launch it, enter it through an embodied playtest adapter, observe frames and machine state, act inside the world, collect synchronized evidence, evaluate the result, generate bounded repair work, replay the same seeded scenario, and return a reviewed artifact without autonomous merge or production deployment.

## Definition of done

v0 is complete only when one end-to-end run demonstrates all of the following:

1. A machine-readable mission spec validates before execution.
2. The engine adapter creates or opens a disposable game workspace.
3. A reproducible build artifact is produced.
4. The build launches under a bounded runtime budget.
5. A playtest agent receives observations from both pixels and structured state where available.
6. The agent issues bounded game actions through a declared action contract.
7. Telemetry, frame captures, action traces, engine logs and terminal outcome are time-correlated.
8. A deterministic evaluator scores mission completion, crashes, regressions, evidence completeness, efficiency and replay stability.
9. An independent reviewer can reject an unsupported success claim.
10. Failed gates become explicit repair tasks.
11. At least one repair task changes the game and produces a second build.
12. The identical seed/scenario is replayed and the system can show whether the measured result improved.
13. The result is returned as a branch/draft PR or preview artifact only. No automatic merge or production deploy occurs.

## First proving ground

`TEST_MISSION_000 — PRIM3 Tactical Sandbox`

The first environment is deliberately small and visually disposable. The purpose is to prove the autonomous production loop, not final art quality.

Required mechanics:
- squad/unit selection
- movement
- action points
- cover
- one hostile actor
- enemy turn
- one tactical objective
- extraction
- mission result state

Required playtest scenarios:
- happy path: reach objective, resolve hostile, extract
- blocked path: navigation obstacle forces alternate movement
- combat then extract: agent must complete tactical action before exiting

Required evidence:
- build log
- runtime log
- telemetry stream
- action trace
- visual captures
- evaluation result
- reviewer result
- replay comparison

## Game specification contract

Every autonomous build starts from a versioned game spec. The current v0 contract includes:

- identity: id, title, campaign, repository, engine
- canon provenance: explicit references and assumptions
- mission semantics: operation id, mastery stage, objectives, required mechanics, failure and completion conditions
- world context: synthetic or Halo-backed mode, optional geospatial anchor, context references
- playtest constraints: deterministic seed, step limit, runtime limit, scenarios, required evidence
- acceptance gates: completion threshold, crash ceiling, regression ceiling, deterministic replay requirement

The runtime implementation lives in `core/src/game-studio/game-spec.mjs` and must fail closed when a mission is too underspecified to evaluate.

## Embodied playtest contract

A playtest adapter is not allowed to claim success merely because the process remained alive. It must expose an observation/action loop.

Observation envelope:
- timestamp / monotonic step
- screenshot or rendered frame reference
- structured game state when available
- active unit / turn / AP
- objective state
- actor transforms or navigation state when available
- health/crash/performance signals

Action envelope:
- action id
- bounded command type
- arguments
- precondition
- expected observation change
- timeout

Examples include selecting a unit, selecting a destination, confirming movement, selecting an ability, targeting, ending a turn and triggering extraction. Engine-specific input details stay behind the adapter.

## Seeded replay requirement

Determinism is a first-class v0 gate. Every repair comparison must preserve:
- mission spec version
- scenario
- RNG seed
- initial world snapshot/hash
- engine version
- adapter version
- game commit
- evaluation version

If a system cannot reproduce the exact simulation, it must report the nondeterministic dimensions rather than pretending a before/after comparison is equivalent.

## Engine strategy

The control plane is engine-independent. v0 should implement the easiest fully automatable engine adapter first, expected to be Godot, while preserving contracts suitable for Unreal.

Godot target:
- headless/editor CLI for build and tests
- deterministic sandbox project
- structured state bridge exposed locally
- frame capture or viewport screenshots
- bounded input injection

Unreal target after contract proof:
- commandlet/automation framework integration
- functional tests / Gauntlet where appropriate
- Unreal Python/editor automation for authoring
- process/runtime telemetry adapter
- Cesium for Unreal experiments behind the same World Context Package contract

## Halo / Cesium boundary

Hitman's Halo is a world-intelligence and geospatial context source. It is not the authoritative mutable game state.

Halo produces versioned World Context Packages containing selected terrain/geospatial references, timestamps, source lineage, confidence and transformation metadata. The game studio converts a bounded package into tactical-world inputs. This preserves reproducibility and prevents live upstream feeds from silently changing a mission during evaluation.

## Research advancement loop

Frontier systems enter through experiments, not through direct production coupling.

For each candidate technique:
1. define hypothesis
2. declare baseline
3. pin implementation/version/model
4. declare compute budget
5. run seeded benchmark suite
6. capture artifacts and provenance
7. independent evaluation
8. compare quality/cost/latency/reproducibility
9. promote, retain as experiment, or reject

Target experiment families include multimodal embodied agents, self-repair loops, Cesium-to-tactical procedural blockouts, Gaussian-splat collision proxies, generative 3D assets, persistent NPC societies, world-model level dreaming, and learned policies for tactical QA.

## Safety and governance

v0 may autonomously:
- inspect approved repositories
- work in disposable worktrees
- build local/non-production artifacts
- run bounded playtests
- capture evidence
- create repair patches
- create branches/draft PRs when credentials/policy allow

v0 may not autonomously:
- merge to protected branches
- deploy production
- change auth/secrets/governance
- spend outside explicit budgets
- publish externally
- use production personal data for experiments
- weaken sandbox or network boundaries to make a test pass

## Promotion gate for PR #79

PR #79 should remain draft until the repository contains a real runtime adapter and evidence from at least one complete `TEST_MISSION_000` loop:

`spec -> build -> launch -> observe -> act -> telemetry -> evaluate -> review -> repair -> rebuild -> same-seed replay -> comparison`

Architecture alone does not satisfy this gate.
