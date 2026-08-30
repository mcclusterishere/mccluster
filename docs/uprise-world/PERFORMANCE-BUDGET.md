# UPRISE WORLD — PERFORMANCE BUDGET

Version 1.0

Primary target: modern iPad/tablet browser. Desktop may scale upward; tablet is the binding performance target.

## Frame-rate budget

- Target: 60 FPS.
- Acceptable sustained range: 45–60 FPS during normal exploration.
- Absolute normal-play floor: 30 FPS.
- Any visual feature that causes sustained sub-30 FPS during ordinary Proof Room play must be simplified, disabled on mobile, or removed.
- Short one-time loading spikes are allowed only if interaction is not blocked and they are measured/documented.

## Frame-time targets

- 60 FPS target: ~16.7 ms/frame.
- 45 FPS acceptable: ~22.2 ms/frame.
- 30 FPS hard floor: ~33.3 ms/frame.

Codex must profile CPU and GPU bottlenecks rather than guessing.

## Initial-load budget

Proof Room goal on good broadband, cold load where feasible:

- first interactive target: <5 seconds;
- Uprise-specific initial transferred payload target: <= 8 MB compressed;
- preferred initial payload: <= 5 MB compressed;
- no single nonessential texture should exceed 1 MB compressed without documented justification;
- defer noncritical assets until after first interaction.

If the current application baseline already exceeds these numbers, Codex must report baseline versus incremental Uprise payload separately rather than silently violating the target.

## Texture budget

Tablet defaults:

- prefer 1024 px textures for normal world assets;
- 2048 px only for hero/canonical assets where visual comparison proves 1024 insufficient;
- avoid 4096 px textures on tablet unless measured and explicitly approved;
- use compressed GPU textures such as KTX2/Basis where supported and appropriate;
- use atlases where they reduce state changes and duplicate overhead;
- do not bake giant transparent canvases for sparse sketch marks.

## Device pixel ratio

Adaptive DPR is mandatory.

Suggested quality tiers:

- high: DPR capped around 2.0 if performance permits;
- medium: DPR around 1.5;
- low: DPR around 1.0–1.25.

DPR may step down automatically when sustained frame time exceeds budget. Avoid oscillation by using hysteresis/cooldowns.

## Geometry budget

The Living Sketch look must come from art direction, not polygon density.

- prefer low- to moderate-complexity GLB geometry;
- reuse/instance repeated props;
- simplify hidden/back faces when practical;
- avoid high-poly foliage;
- avoid subdividing geometry merely to create sketch texture;
- character may receive the largest geometry allowance, but must still be tablet-conscious.

Codex must report triangle counts for the Proof Room scene and identify the top five heaviest meshes.

## Material/shader budget

- no enormous fullscreen shader stack;
- Living Sketch cannot depend solely on postprocessing;
- minimize simultaneous transparent layers;
- avoid multiple expensive screen-space effects;
- no SSR, volumetric fog, cinematic DOF, heavy bloom, or similar desktop effects unless disabled by default on tablet and specifically justified;
- keep custom material families modular and measurable.

Target material families remain:

- PaperMaterial
- GraphiteMaterial
- InkMaterial
- WatercolorMaterial
- CharcoalMaterial
- AnnotationMaterial

Each family should have a mobile-safe path.

## Shadows and lighting

- broad/simple lighting preferred;
- minimize shadow-casting lights;
- default tablet path should use zero or one inexpensive dynamic shadow source unless testing proves more is safe;
- fake/illustrated charcoal grounding is preferred over costly realistic shadows when it better matches the visual language.

## Draw-call budget

Proof Room target:

- preferred <= 150 draw calls on tablet during typical view;
- investigate >200;
- >300 requires explicit justification and measurement.

Use instancing, batching, atlases, and state reuse where they do not damage the artwork.

## Memory budget

- avoid retaining duplicate decoded textures/models;
- dispose abandoned GPU resources;
- do not preload the future world into the Proof Room;
- keep Proof Room self-contained and lazy-load nonessential artifacts.

Codex must capture a browser memory/GPU-resource snapshot where available and report obvious leaks or uncontrolled growth after repeated enter/exit interactions.

## Illustration LOD as performance system

Illustration LOD is both an art rule and optimization tool.

Far state should reduce:

- texture resolution/coverage;
- line density;
- material layers;
- annotation visibility;
- geometry/detail where possible.

Medium adds only what is visually necessary. Near receives the richest treatment.

Do not keep near-state rendering active and merely hide it with opacity.

## Adaptive quality controls

Tablet build should be capable of reducing, independently where useful:

- DPR;
- texture resolution;
- line density;
- annotation density;
- shadow quality;
- secondary motion/jitter;
- decorative wash layers.

Core identity must survive low quality: recognizable McCluster, paper, graphite/ink/wash progression, canonical clothing graphics, and discovery state.

## Touch responsiveness

Input responsiveness outranks decorative effects.

- touch movement/camera must remain responsive under normal load;
- stylized animation must not introduce input latency;
- no expensive pointer-move handlers that allocate each frame;
- no hover-dependent interaction.

## Orientation and resize

Proof Room must survive:

- portrait-to-landscape resize where supported;
- browser chrome changes;
- split-view/resizable viewport conditions where practical;
- no unrecoverable WebGL resize failure.

## Profiling requirement

Before a phase can claim tablet-ready performance, Codex must report:

1. device/browser used (or closest available emulator/test device);
2. viewport and DPR;
3. average FPS during a 30-second representative walk;
4. worst sustained FPS segment;
5. approximate transferred initial payload;
6. draw calls and triangle count at a representative near view;
7. largest assets by transfer size;
8. any adaptive quality changes triggered.

## Performance gate

PASS:
- normal exploration stays >=30 FPS;
- target experience is generally 45+ FPS on modern iPad-class hardware where testable;
- touch remains responsive;
- no uncontrolled memory growth;
- load/payload targets are met or deviations are explicitly documented with a corrective plan.

FAIL:
- sustained <30 FPS;
- interaction/input stalls;
- unmeasured expensive effects remain enabled;
- desktop-only quality is treated as completion;
- full near-detail assets remain active at all distances;
- Codex cannot state where the performance cost is coming from.