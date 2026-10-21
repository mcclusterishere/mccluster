# Uprise World — Legacy Experiment Retrospective

**Status:** Legacy R&D artifact, intentionally frozen  
**Reclassified:** 2026-10-05  
**Active product backlog:** No  
**Release authority:** None. The archived implementation under `_unfinished/uprise-world/` is not a release candidate.

## Why it is being preserved

Uprise World consumed meaningful design and engineering effort. Deleting it would erase useful evidence about how McCluster approached immersive product design, mobile WebGL, spherical locomotion, landmark-driven narrative, visual-reference control, and performance constraints.

The value of the experiment is now primarily **what it teaches us about product sequencing**, not whether the old implementation can be completed.

## What the experiment proved

The repository contains working technical ideas worth retaining:

- browser-native Three.js/WebGL spherical locomotion;
- keyboard and coarse-pointer movement sharing one movement core;
- a data-driven landmark/check-in narrative model;
- a meaningful non-WebGL document fallback;
- an explicit visual-reference and screenshot-acceptance discipline;
- early performance-budget thinking for tablet/mobile hardware.

These are reusable engineering findings. They do not, by themselves, prove that a persistent 3D world was the right product.

## Where the approach spent complexity too early

The historical sequence committed significant effort to **world representation before validating the reason a user would repeatedly enter the world**.

The prototype accumulated spherical terrain, movement, camera behavior, landmarks, visual-material ambitions, character/reference requirements, loading/performance concerns, and future progression concepts while the core repeatable user loop remained weakly validated.

That created several compounding costs:

1. **Representation before job-to-be-done.** The system answered “what does the world look like?” before it had a hard answer to “what does the user accomplish here in the first 30 seconds?”
2. **Spatial fidelity before retention evidence.** Richer geometry and art direction could not substitute for a proven reason to return.
3. **Technical dependencies before progression design.** Persistence, unlocks, social meaning, and durable consequence were later requirements even though they should have shaped the earliest prototype.
4. **Mobile performance tax before product proof.** WebGL, camera, touch, LOD, loading, asset formats, and context-loss behavior became product work before the experience had earned that complexity.
5. **Sunk-cost pressure.** Once the world architecture existed, each next problem looked like another implementation gap instead of a signal to reconsider the product shape.

## Better counterfactual sequence

If the same product question were explored again, use this order:

### 1. Define the user job

Write one sentence that describes why a person opens the experience and what useful or emotionally meaningful outcome they get.

If that sentence depends on “because it is a 3D world,” the job is not yet clear enough.

### 2. Prove a 30-second loop without 3D

Prototype the smallest mobile interaction that expresses the core idea using ordinary DOM/UI:

- arrive;
- understand the situation;
- choose or discover one thing;
- act/check in/respond;
- receive a consequence;
- see what to do next.

Measure completion and comprehension before adding spatial navigation.

### 3. Add durable progression

Only after the loop works, prove that persistence makes it better:

- remembered progress;
- next unlock;
- visible personal record;
- reason to return;
- meaningful consequence of previous actions.

### 4. Test the social/action layer

Decide whether other people materially improve the loop. If so, test the smallest form of shared presence, proof, collaboration, or comparison without building a general multiplayer world.

### 5. Introduce spatial representation as a hypothesis

Ask what spatial navigation uniquely contributes. A map, 2.5D scene, guided path, room, or limited landmark view may provide the benefit at a fraction of the cost of a walkable planet.

Build the cheapest representation that can falsify the hypothesis.

### 6. Escalate visual fidelity only after behavior justifies it

Only then invest in richer assets, shaders, character systems, LOD, streaming, advanced camera behavior, or a persistent 3D environment.

Performance budgets and asset pipelines should be binding from the first spatial prototype rather than retrofit requirements.

## Reusable pieces

Before discarding or rewriting anything, treat these as donor material:

- spherical tangent locomotion math;
- unified keyboard/touch movement core;
- landmark/check-in data model;
- document fallback pattern;
- WebGL capability detection;
- visual reference manifest;
- screenshot acceptance framework;
- performance-budget documents;
- Phase 0 audit as a record of actual technical state.

Reuse means extracting a proven idea into a current product. It does **not** mean reviving the old application architecture wholesale.

## Revival gate

Uprise World may return to active development only when all of the following exist:

- a current product brief with a concrete user job;
- a mobile-first 30-second loop proven outside the old 3D implementation;
- an explicit retention/progression hypothesis;
- evidence that spatial navigation materially improves the experience;
- a defined scope smaller than “finish Uprise World”;
- current performance budgets and release acceptance criteria;
- a decision identifying which archived components are donors and which are deprecated.

Until those conditions are met, agent sessions must treat Uprise World as historical evidence and must not report its old roadmap items as current McCluster product gaps.
