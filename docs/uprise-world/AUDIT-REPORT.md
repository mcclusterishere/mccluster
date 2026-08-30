# UPRISE WORLD — PHASE 0 AUDIT REPORT

**Date:** 2026-08-09  
**Audited commit:** `445f5f64b91704829855d89aa02b4adeb86d316e`  
**Scope:** Phase 0 only; no application code, route, configuration, dependency, or visual asset was changed.

## Audit constraints and evidence notes

The required path `docs/uprise-world/REFERENCE-MANIFEST.md` was absent at the audited commit. Repository inspection found the apparent manifest at `docs/uprise-world/references/VISUAL-REFERENCE-MANIFEST.md` and the companion `docs/uprise-world/references/README.md`; both were read. This path mismatch required human resolution before visual implementation. (Post-audit note: the canonical `docs/uprise-world/REFERENCE-MANIFEST.md` path was subsequently added on `main`.)

The only canonical files present below `docs/uprise-world/references/` at the audited commit were the likeness sheet and Kingdom Stepper emblem, plus the two Markdown reference documents. Exact WARROOM, HM/AMMO/halo, SEEK FIRST/drone, 33-target, wardrobe, and style-reference source files described by the specifications were absent. They must not be regenerated from prose.

Code evidence below distinguishes implementation presence from runtime proof. Browser/WebGL profiling was unavailable because the checkout had neither Playwright nor a browser executable installed, and Phase 0 forbids installing dependencies. A runnable-device claim is therefore not made.

## 1. Current architecture map

- **Framework/runtime:** `uprise-world.html` is a standalone static HTML document. Its inline ES-module script dynamically imports `mount()` from `js/uprise-world.js`. There is no framework router or bundler for this page. Root `package.json` contains Capacitor dependencies but no scripts and no Three.js package dependency. Uprise World is a browser-native static-site route, not React/Vue/Next and not a separately built application.
- **Entrypoint and route:** the public entrypoint is the literal file route `uprise-world.html`. Its module block performs WebGL detection, imports `js/uprise-world.js`, supplies the joystick element and `onCheckIn` callback, and owns the HUD/document-card DOM. Navigation is file-based; an isolated Proof Room can use a sibling HTML route without introducing a router.
- **Renderer:** `mount(canvas, opts)` in `js/uprise-world.js` creates `THREE.WebGLRenderer`, caps pixel ratio at 2, creates a `THREE.Scene`, exponential fog, and a `THREE.PerspectiveCamera`, then runs `requestAnimationFrame → step() → renderer.render(scene, cam)`. Rendering is direct Three.js/WebGL with one renderer and one scene. There is no renderer abstraction.
- **Three.js integration:** `js/uprise-world.js` imports `../vendor/three.module.min.js`; the vendored module is 365,552 bytes uncompressed. No npm import or loader is used. Three.js is locally vendored and deployment-safe for the web route, but the Android staging workflow currently omits `vendor/`.
- **Spherical world:** `R`, `relief(p)`, the `THREE.IcosahedronGeometry`, per-vertex displacement/color loop, `groundAt(n)`, and unit-normal player position `at` in `js/uprise-world.js` implement the planet. `step()` rotates `at` around a tangent axis using `applyAxisAngle`. Spherical gravity/tangent locomotion is real code, not only a design note. The current geometry request uses `new THREE.IcosahedronGeometry(R, 24)`, an extreme subdivision parameter that requires runtime profiling before it can be called safe.
- **Scene graph/world assembly:** `mount()` constructs the planet mesh; hemisphere/directional lights; a 700-point star field; one `THREE.Group` per data landmark containing box, roof, beacon and shaft meshes; and a `you` player group containing capsule and sphere meshes. All are added directly to one scene. World assembly is monolithic inside `mount()` and generated from primitives. There is no asset-loader layer, world factory, scene lifecycle class, or component hierarchy.
- **Player locomotion:** keyboard listeners and a pointer-driven stick feed forward/turn intent into `step()`. Heading builds tangent forward/right vectors; forward movement rotates the spherical position. Player transform is reset against `groundAt(at)` every frame. Keyboard and joystick both drive the same spherical movement core. Movement is frame-based (`WALK` radians per frame), not delta-time-based, so speed varies with frame rate.
- **Camera:** `step()` computes a third-person target behind/above the player, lerps camera position unless reduced motion is active, sets `cam.up` to the sphere normal, and looks at a point above the ground. `resize()` updates renderer size and projection aspect. Third-person spherical alignment and resize handling exist. There is no separate camera-look input, collision, occlusion, zoom, or portrait/orientation-specific composition.
- **Mobile/touch controls:** `uprise-world.html` displays `#uwStick` only under `@media (pointer: coarse)`. `mount()` attaches pointerdown/move/up/cancel listeners, uses pointer capture, and maps displacement to normalized movement/turn values. The canvas has `touch-action: none`. A coarse-pointer virtual movement joystick exists. There is no right-side touch camera-look zone and no explicit tap interaction; proximity triggers check-ins automatically. The visual knob is a static pseudo-element and does not follow input.
- **Landmarks/interactions:** `fetch("data/uprise-world.json")` supplies four records. `design.landmarks.forEach()` creates placeholder geometry. In `step()`, angular surface distance below 6.5 marks a landmark done and calls `opts.onCheckIn`. The HTML callback opens `#uwCard` and links the record document. Content is data-driven at the narrative/metadata layer, while placement and geometry are hard-coded from array index. Interaction is proximity-only and tightly split between renderer callback and page DOM.
- **State/persistence:** `marks[].done`, local heading, `at`, `started`, and key/stick maps are closure-local to `mount()`. The returned progress getter exposes current check-ins. There is no localStorage, IndexedDB, server write, state store, reload restore, or formal discovery/illustration state. Current progress persists only for the lifetime of the mounted page. The JSON's healed/unlocked narrative does not have an implemented state transition in the renderer.
- **Assets/loading:** runtime Uprise rendering uses generated geometry and a single JSON fetch. The page uses `assets/img/equity-uprise-logo.webp`; check-in links may open PDFs from `assets/credentials/`. `data/uprise-world.json` names future landmark/likeness/audio assets, but `js/uprise-world.js` has no GLTF, texture, image, audio, or progressive loader. Runtime initial loading is small and simple, but there is no production visual-asset pipeline, error handling for the JSON fetch, loading state, cache policy beyond no-cache, or disposal registry.
- **Materials/shaders/postprocessing:** the scene uses `MeshLambertMaterial`, `MeshBasicMaterial`, and `PointsMaterial`, vertex color and flat shading. No custom shader, texture material, `EffectComposer`, postprocessing pass, outline pass, or PBR map is present. The prototype is conventional flat-shaded 3D, but it is not concealing that with a fullscreen sketch filter. None of the six required Living Sketch material families exists.
- **WebGL fallback:** inline detection in `uprise-world.html` tries WebGL2 then WebGL; failure hides the canvas root/HUD/stick and leaves `.uw__floor`, which lists the four records and links to `equity-uprise.html`. Successful detection adds `uw--on` to visually move the floor offscreen. A meaningful document fallback exists for context-creation failure. It does not catch a rejected dynamic import, JSON fetch failure, renderer construction failure after detection, context loss, or runtime out-of-memory.
- **State/content data:** `data/uprise-world.json` is the single landmark/world narrative ledger and includes world, player, four landmarks, audio, fallback, and out-of-scope sections. Renderer-consumed fields are principally landmarks, name, order, `isFinale`, and document metadata passed back to HTML. Content is only partially renderer-driven: the world description, player selection, unlock/audio behavior, landmark reference paths, and healed-side unlock are not implemented by `mount()`.
- **Build/deploy:** `.github/workflows/deploy-pages.yml` stamps `__STAMP__`, removes internals, and force-pushes the static web root to `gh-pages`; `README.md` documents the Pages path. `.github/workflows/site-smoke.yml` installs Playwright in CI and runs `scripts/smoke.mjs`. `.github/workflows/build-android.yml` copies selected folders into `www/`, installs Capacitor, and builds an APK. GitHub Pages needs no Uprise compilation. The site smoke suite does not list `uprise-world.html`. Android staging copies `js/` but not `vendor/`, so `js/uprise-world.js`'s `../vendor/three.module.min.js` import would be missing in the staged native web root.

## 2. What already works

- Static entry and progressive fallback in `uprise-world.html`.
- Spherical locomotion algorithm in `step()` plus `groundAt()`/`relief()`.
- Unified keyboard/touch movement path.
- Third-person spherical camera baseline.
- Data-driven landmark metadata from `data/uprise-world.json`.
- Proximity check-ins and callback boundary via `opts.onCheckIn`.
- Session-local progress inspection via returned progress getter and `_debug` references.
- Reduced-motion accommodation using `prefers-reduced-motion`.
- Basic resize handling.
- Static GitHub Pages deployment path.
- No fullscreen-filter trap.

Runtime qualifications:

- Full Uprise page mount, locomotion, check-in, fallback switching, and renderer statistics are **NOT MEASURED** in a real browser because no browser/Playwright installation exists in the checkout and dependencies were not installed.
- The repository-wide browser smoke workflow exists, but `scripts/smoke.mjs` does not include `uprise-world.html`; it is therefore not evidence that Uprise currently loads.
- The Android workflow's missing `vendor/` staging is code evidence of a likely native-shell failure, not a measured APK failure.

## 3. What is reusable for Living Sketch

- `data/uprise-world.json`: reuse behind a small content adapter; do not bind Proof Room material state directly into the production landmark ledger during Phase 1.
- Tangent movement math in `js/uprise-world.js` `step()`, plus `relief()`/`groundAt()`: preserve unchanged during Proof Room work.
- `uprise-world.html` feature detection and `.uw__floor`: preserve production route unchanged in Phase 1; use the same fallback principle on the isolated route.
- `mount(canvas, opts)` callback contract: reuse as an architectural pattern, not by adding Proof Room responsibilities to this monolith.
- Keyboard plus pointer state normalization in `js/uprise-world.js`: preserve unchanged for the production sphere; adapt normalized intent in the isolated Proof Room.
- Third-person camera calculations and `resize()`: reusable as a baseline, with new composition testing in the Proof Room.
- `vendor/three.module.min.js`: reuse for Phase 1 to avoid a new dependency, after verifying/staging `vendor/` for every target.
- Canonical reference files in `docs/uprise-world/references/`: preserve byte-for-byte.
- GitHub Pages workflow: preserve.

Primitive landmark/player construction and Lambert/Basic materials are useful as honest prototype baselines but should not be copied into a Living Sketch renderer and relabeled.

## 4. Conflicts and gaps against the Bible

### Visual/rendering conflicts

- `js/uprise-world.js` builds a fully filled, fogged, star-backed sphere with flat-shaded Lambert materials; `uprise-world.html` backgrounds are near-black. This conflicts with warm-white paper substrate, visible negative space, charcoal grounding, and selective pigment.
- Planet, landmarks, and capsule/sphere player are conventional complete meshes with uniform digital fills. There are no broken contours, graphite construction traces, paper breakthrough, wash pooling, charcoal strokes, or controlled overdraw.
- Landmark beacons are bright ruby spheres with translucent vertical shafts, functionally close to the conventional glowing-marker language prohibited by the Proof Room spec.
- The check-in panel is a dark rounded glass-like card with border, blur, and shadow rather than a physical document embedded into a sketchbook page.
- No `PaperMaterial`, `GraphiteMaterial`, `InkMaterial`, `WatercolorMaterial`, `CharcoalMaterial`, `AnnotationMaterial`, or mobile-safe material path exists.
- There is no fullscreen postprocess filter, which is good, but there is also no asset/material-level Living Sketch system.

### Character/reference gaps

- The `you` group in `js/uprise-world.js` is a capsule body plus sphere head and cannot meet likeness, hair, facial-hair, posture, garment, or canonical-mark criteria.
- `data/uprise-world.json` still calls the player style "low-poly, cel-shaded," directly conflicting with the Living Sketch Bible.
- Required path `docs/uprise-world/REFERENCE-MANIFEST.md` was absent at the audited commit; the found manifest had a different path/name.
- Only `mccluster-character-likeness-sheet-approved.png` and `kingdom-stepper-approved.png` existed among canonical visual binaries under the reference tree. Exact approved wardrobe and remaining emblem sources required by the Proof Room spec were absent. This is a **BLOCKER** for the later canonical protagonist phase, not permission to approximate them.
- The character likeness PNG is 1536×1024 and 7,506 bytes; visual adequacy was not judged during this architecture-only audit. Canonical screenshot comparison is **NOT MEASURED** because no visual implementation exists.

### World/state/content gaps

- Landmark geometry and positions are derived from array index and fixed trigonometric formulas; actual silhouettes/reference paths in JSON are not consumed.
- No illustration LOD exists.
- No `IllustrationState` or `DiscoveryState` exists; `marks[].done` is one boolean.
- Check-in only recolors a beacon. The landmark does not become more complete, annotations do not draw in, and discovery does not persist beyond page lifetime.
- `data/uprise-world.json` describes healed-side unlocking, audio, lyrics, selectable fellows, and lazy track policy, but `js/uprise-world.js` does not implement them.
- Proof Room requires touch camera look and tap interaction. Current touch input supplies movement/heading on one joystick; proximity automatically opens the document card.

### Runtime/architecture gaps

- `mount()` combines fetch, scene construction, content placement, input listeners, simulation, interaction, camera, rendering, and lifecycle. Proof Room systems should not be added to this function.
- Movement uses fixed-per-frame `WALK`, so slower devices move more slowly in real time. A delta-time controller is required for robust tablet testing, but production locomotion must not be refactored during Phase 1.
- `stop()` cancels animation and disposes only the renderer. It does not remove global key/resize listeners, joystick listeners, or explicitly dispose geometries/materials.
- JSON fetch/import/renderer failures after initial WebGL detection have no catch path. WebGL context loss/restoration is not handled.
- Pixel ratio is capped at 2 but is not adaptively reduced from measured frame time, and no quality hysteresis exists.
- `THREE.IcosahedronGeometry(R, 24)` is an obvious performance/correctness risk. Actual triangle count/memory is **NOT MEASURED**.
- There is no loading indicator, asset progress, lazy scene boundary, texture compression, atlas, GLTF loader, KTX2/Basis support, illustration LOD performance path, renderer-info HUD, or automated Uprise browser test.
- The Pages pipeline publishes `vendor/`, but `.github/workflows/build-android.yml` does not copy it into `www/`.

## 5. Performance baseline

### Measured static baseline

| Item | Uncompressed bytes | gzip bytes | Notes |
|---|---:|---:|---|
| `uprise-world.html` | 6,954 | 2,907 | Route UI and inline WebGL gate. |
| `js/uprise-world.js` | 11,239 | 4,458 | Current renderer/game module. |
| `data/uprise-world.json` | 8,744 | 3,283 | Narrative/content ledger. |
| `vendor/three.module.min.js` | 365,552 | 86,854 | Largest required runtime script. |
| **Above four core files** | **392,489** | **97,502** | Excludes shared CSS, logo/favicon, headers, opened documents. |

Relevant repository asset totals:

- `assets/landmarks/`: 9,348,588 bytes on disk; not loaded by current renderer.
- `assets/likeness/`: 9,724,975 bytes on disk; not loaded by current renderer.
- `docs/uprise-world/references/`: 58,186 bytes of file content (72 KiB filesystem usage at audit); deployment strips `docs/`, so these are not public runtime payload.

Largest relevant source files include `assets/likeness/mcc-top-down.png` (3,825,097 bytes), `assets/likeness/mcc-profile-left.png` (3,676,104), `assets/landmarks/bridgeport-city-hall/aerial-01.png` (3,246,280), `assets/credentials/georgia-youth-innovation-civic-leadership-week-proclamation.pdf` (2,985,047), and `assets/landmarks/bridgeport-city-hall/aerial-03.png` (2,288,876). None is fetched on initial Uprise mount in current code.

### Not measured

- Current production build/bundle output: **NOT MEASURED** — route is unbundled static source and root `package.json` has no build script.
- Browser-transferred payload including compression/cache/headers: **NOT MEASURED**.
- First interactive/load time: **NOT MEASURED**.
- Draw calls and rendered triangles: **NOT MEASURED**.
- Geometry memory and top five rendered meshes: **NOT MEASURED**.
- FPS/average frame time/worst sustained segment: **NOT MEASURED**.
- Browser JS heap/GPU memory/context loss: **NOT MEASURED**.
- iPad/mobile Safari touch latency, orientation behavior, sustained 30-second walk: **NOT MEASURED**.
- Android APK behavior/size: **NOT MEASURED**.

### Current performance risks

- `IcosahedronGeometry` detail 24 is the highest immediate risk and could block scene creation before a frame is rendered.
- Fixed-per-frame locomotion makes behavior dependent on achieved FPS and obscures performance comparisons.
- DPR is capped but never adaptively stepped down.
- Every landmark has four separate meshes/material instances; future expansion would scale draw calls linearly without batching/instancing.
- Render loop allocates objects per frame in places such as tangent/quaternion work, increasing GC pressure.
- Lifecycle disposal is incomplete.
- Large likeness/landmark source images are unsuitable for direct tablet delivery without approved derivatives and lazy loading.

## 6. Proposed isolated Proof Room architecture

Use a sibling static route, `uprise-proof-room.html`, importing a separate `js/uprise-proof-room/index.js`. Do not branch behavior inside `uprise-world.html` or add Proof Room code to `js/uprise-world.js`.

The isolated route should:

- reuse the existing vendored Three.js module after verifying/staging `vendor/` for every target;
- contain its own canvas, accessible fallback, loading/error surface, and lifecycle owner;
- construct only the exact Proof Room shell for the current roadmap phase: spawn, short street, one building, one tree, one vehicle, one utility prop, one document location;
- expose a small debug/readout API for camera position, current state, `renderer.info`, quality tier, and deterministic screenshot markers;
- route normalized keyboard/touch intent through an isolated controller with delta time, touch movement, touch camera look, and tap interaction—without altering current production controls;
- keep scene construction, input, camera, interactions, content, materials, illustration state, discovery state, and persistence in separate small modules as those roadmap phases are approved;
- lazy-load future canonical character/art assets only in the Proof Room;
- define formal illustration/discovery state in renderer-independent modules when corresponding gates begin;
- provide six material-family modules only in the Living Sketch material phase, with mobile-safe quality paths and no fullscreen filter dependency;
- preserve a paper/document HTML fallback when WebGL creation or module loading fails.

Isolation by a sibling route is preferred over a query flag because it prevents a failed experimental import/material from taking down `uprise-world.html`, is directly smoke-testable, survives static deploy, and can be omitted from navigation until explicitly approved. Phase 1 must not replace the existing world or expand its map.

The canonical player cannot be completed until absent exact wardrobe/emblem references are supplied or their canonical repository paths are clarified. Phase 1 shell work can remain placeholder-only according to the gated roadmap; it must not smuggle a generated protagonist into the scene.

## 7. Exact file plan

### CREATE — Phase 1 only

- `uprise-proof-room.html`
- `js/uprise-proof-room/index.js`
- `js/uprise-proof-room/scene.js`
- `js/uprise-proof-room/input.js`
- `js/uprise-proof-room/player-controller.js`
- `js/uprise-proof-room/camera.js`
- `js/uprise-proof-room/debug.js`
- `data/uprise-proof-room.json`

### MODIFY — Phase 1 only

- `scripts/smoke.mjs` — add isolated-route desktop/mobile mount, fallback, no-console-error, and resize checks after the route exists.
- `.github/workflows/build-android.yml` — copy `vendor/` into `www/` so both the existing Uprise World and isolated route can resolve vendored Three.js. This deployment change must be explicitly approved before Phase 1.

No modification to `uprise-world.html`, `js/uprise-world.js`, `data/uprise-world.json`, global `css/style.css`, `package.json`, or Pages deploy workflow is required for Phase 1 shell.

### PRESERVE / DO NOT TOUCH

- `uprise-world.html`
- `js/uprise-world.js`
- `data/uprise-world.json`
- `vendor/three.module.min.js`
- `vendor/three.core.min.js`
- `equity-uprise.html`
- `assets/credentials/`
- `assets/landmarks/`
- `assets/likeness/`
- `docs/uprise-world/references/`
- `docs/uprise-world/CODEX-IMPLEMENTATION-BIBLE.md`
- `docs/uprise-world/PROOF-ROOM-SPEC.md`
- `docs/uprise-world/SCREENSHOT-ACCEPTANCE-CRITERIA.md`
- `docs/uprise-world/PERFORMANCE-BUDGET.md`
- `docs/uprise-world/UPRISE-WORLD-ROADMAP.md`
- `.github/workflows/deploy-pages.yml`
- `css/style.css`
- `sw.js`

### POSSIBLE FUTURE DEPRECATION — not Phase 0 or Phase 1

- Primitive landmark/player construction inside `mount()` in `js/uprise-world.js` may later be replaced only after validated Living Sketch systems migrate to production.
- Ruby beacon sphere/shaft and generic `#uwCard` presentation may later yield to approved annotation/document language.
- Obsolete `"low-poly, cel-shaded"` player.style in `data/uprise-world.json` should eventually be corrected through an approved data migration.
- Monolithic scene/input/camera responsibilities in `js/uprise-world.js` may eventually use adapters proven in the room; do not preemptively refactor them.

Later gated Proof Room files, not authorized for Phase 1, include `js/uprise-proof-room/materials/{paper,graphite,ink,watercolor,charcoal,annotation}.js`, `illustration-state.js`, `discovery-state.js`, `persistence.js`, `interactions.js`, and approved runtime derivatives under `assets/uprise-proof-room/`.

## 8. Risk register

| Risk | Severity | Likelihood | Evidence | Mitigation |
|---|---|---|---|---|
| Current sphere regression | HIGH | MEDIUM | Locomotion, camera, scene, input, check-ins coexist in `js/uprise-world.js`. | Separate route/module tree; no Phase 1 changes to production world files. |
| Touch controls regress/remain incomplete | HIGH | HIGH | Existing joystick exists, but no camera-look zone/tap interaction/cleanup. | Preserve production joystick; build/test isolated input; real iPad gate. |
| Mobile Safari/iPad misses frame floor | BLOCKER | HIGH | Detail-24 planet, fixed-frame movement, DPR up to 2, no adaptive quality; device metrics NOT MEASURED. | Instrument renderer/FPS; cap scene; adaptive DPR; real 30-second target-device profile. |
| Current renderer fails before first frame | BLOCKER | MEDIUM | `new THREE.IcosahedronGeometry(R, 24)` is extreme; browser mount NOT MEASURED. | First approved runtime task captures failure/renderer stats; do not reuse this geometry in Proof Room. |
| Camera usability/composition | HIGH | MEDIUM | No touch look, collision, portrait framing, deterministic capture markers. | Isolated camera controller; screenshot markers; orientation tests. |
| WebGL fallback regression | HIGH | MEDIUM | Existing preflight fallback works, but import/fetch/runtime errors are uncaught. | Leave production route intact; catch init errors in new route; forced-fallback test. |
| Route/navigation regression | MEDIUM | LOW | File-based routes, no router. | Add sibling route without changing existing links. |
| Android/native route broken | HIGH | HIGH | Android workflow stages `js/` but omits `vendor/`. | Minimal workflow fix to copy `vendor/`; assert staged file. |
| Pages stamping/exposure break | MEDIUM | LOW | Static deploy stamps HTML and strips internal docs. | Avoid changing workflow; use `__STAMP__` on new route. |
| Asset payload exceeds budget | HIGH | HIGH | Landmark/likeness sources total ~19 MB and individual sources exceed 3 MB. | Keep out of initial load; approved derivatives; compression/lazy loading. |
| Memory/resource leak | HIGH | MEDIUM | `stop()` does not remove listeners or dispose scene resources. | Proof Room owns cleanup and explicit disposal; repeat enter/exit test. |
| Shader/material incompatibility | HIGH | MEDIUM | No custom material precedent or browser/GPU matrix measurements. | Six modular families, feature probes, mobile-safe variants. |
| Illustration LOD becomes opacity-only | HIGH | MEDIUM | No LOD/state architecture exists. | Formal states; activate/deactivate real layers/geometry; measure `renderer.info`. |
| Canonical visual references are misused | BLOCKER | HIGH | Required manifest path mismatch at audit and most exact marks/wardrobe/style sources absent. | Human resolves manifest path and supplies exact assets; never regenerate missing marks. |
| Generic 3D mislabeled Living Sketch | BLOCKER | MEDIUM | Current renderer is primitive Lambert/Basic 3D. | Still-image acceptance and reference comparison; reject fullscreen-filter/uniform-outline shortcuts. |
| Discovery/content becomes renderer-coupled | MEDIUM | HIGH | Current `marks[].done` lives inside renderer closure. | Add renderer-independent state in approved later phase. |
| Current-user regression | HIGH | LOW | Production route carries four real record links and usable fallback. | Preserve production route and ship experiment under isolated unlinked route. |
| False confidence from tests | HIGH | HIGH | Site smoke exists but omits Uprise. | Add targeted route/fallback/resize/console checks; separate runtime evidence from visual/tablet acceptance. |

## 9. Recommended Phase 1 implementation order

This order is limited to **Phase 1 — Visual Proof Room shell**. It does not implement the canonical protagonist, six final material families, illustration LOD, draw-in/discovery, document language, real landmark, or world expansion.

1. **Resolve blockers at the human gate.** Approve this audit, resolve the manifest path, and record how/when absent canonical assets will arrive.
2. **Add isolated route and failure boundary.** Create `uprise-proof-room.html` with neutral placeholder presentation, loading/error handling, readable fallback, and dynamically imported mount. Do not link it from production navigation yet.
3. **Establish lifecycle and diagnostics.** Create `index.js` and `debug.js`, reuse vendored Three.js, expose renderer info/camera/quality state, and guarantee listener/GPU cleanup.
4. **Create exact minimal scene shell.** In `scene.js` and `data/uprise-proof-room.json`, author only spawn, short street, one building, one tree, one parked vehicle, one utility prop, and one document location. Use explicit honest placeholders; do not call them Living Sketch materials.
5. **Add isolated navigation controllers.** Implement delta-time desktop movement, touch movement, touch look, tap intent, third-person camera, reduced-motion handling, and resize/orientation recovery. Do not extract/refactor current spherical controls.
6. **Repair target staging minimally.** With explicit approval, update `.github/workflows/build-android.yml` to stage `vendor/` and assert imported module exists.
7. **Add automated Phase 1 checks.** Extend `scripts/smoke.mjs` for direct route load at desktop/coarse-pointer sizes, forced fallback, zero page errors, exact object count/identities, resize recovery, movement intent, and current `uprise-world.html` availability.
8. **Capture and review the first complete shell render.** Take mandated screenshot and evaluate only applicable Phase 1 composition/structure criteria. Compile/smoke pass is not visual acceptance. Stop at mandatory first-render review point.
9. Only after Gate 1 passes and the user explicitly approves continuation should Phase 2 begin.

## Phase 0 stop statement

The nine required audit outputs are complete. Application code was not changed. All unavailable measurements are labeled **NOT MEASURED** above. Phase 1 has not begun and must not begin until explicit human approval.
