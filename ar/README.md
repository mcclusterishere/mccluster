# McCluster AR — Unity client (Phase A scaffold)

One Unity project for iPhone and Android that puts a fictional storefront,
**GAURANFUCKING TEA**, on a real wall you control, and captures clean camera
frames with calibrated metadata. It is a client of the McCluster plane:
identity, missions and state stay with Worker `mccluster`
(`https://api.mccluster.org`), Supabase `zmnhbrjyhxzhkxmhkexs` and Core. It has
no backend, auth or database of its own.

> **Status: scaffold. Nothing here has run on a device or in the Unity Editor.**
> The code was written and checked against the AR Foundation 6.7.1 package
> source, but it was not compiled. Every on-device behaviour below is untested.

## Why `ar/` and not `native/ar-unity/`

`native/` is the Expo app (HERE). A Unity project inside it would break it.
Metro watches the whole Expo root, and Unity's `Library/PackageCache` (gigabytes,
untracked, created on first open) is full of `package.json` files that give
Metro haste-name collisions. `native/tsconfig.json` globs `**/*.ts`, and EAS
uploads the project folder. The two apps share nothing at build time, so they
sit side by side. A root `ar/` is private on both publish paths:

- `.github/workflows/deploy-pages.yml` strips `ar` before `gh-pages`, and
  probes `/ar/README.md` for a 404.
- `scripts/stage-cloudflare-pages.mjs` refuses it, because its allowlist does
  not name it.
- `scripts/test/publish-strip-parity.test.mjs` fails if the two disagree.

It is also not in the Worker bundle (`workers/mccluster` is the Worker root).

## Pinned versions (verified 2026-11-03)

| Piece | Version | Source |
| --- | --- | --- |
| Unity Editor | **6000.3.27f2** (Unity 6.3 LTS, revision `22188f149405`, released 2026-10-30) | `services.api.unity.com/unity/editor/release/v1/releases?stream=LTS` |
| AR Foundation | `com.unity.xr.arfoundation` **6.7.1** (needs Unity 6000.0+) | `packages.unity.com/com.unity.xr.arfoundation` (dist-tag latest) |
| Apple ARKit XR Plug-in | `com.unity.xr.arkit` **6.7.1** | `packages.unity.com/com.unity.xr.arkit` |
| Google ARCore XR Plug-in | `com.unity.xr.arcore` **6.7.1** | `packages.unity.com/com.unity.xr.arcore` |
| XR Plug-in Management | **4.6.1** | registry dist-tag latest (AR Foundation needs ≥ 4.4.0) |
| XR Core Utilities | **2.6.0** | registry; the version AR Foundation 6.7.1 depends on |
| Input System | **1.20.1** | registry dist-tag latest (AR Foundation needs ≥ 1.6.3) |
| uGUI (includes TextMeshPro) | **2.0.0** | built into Unity 6 |
| ARCore Extensions (later, optional) | **not installed**; newest tag `v1.57.0-arf6` | `git ls-remote https://github.com/google-ar/arcore-unity-extensions.git` |

The Editor may rewrite `Packages/manifest.json` slightly on first open, for
example by adding `packages-lock.json`. Commit what it writes.

Lightship and the old hosted 8th Wall platform were retired on 2026-02-28.
This project does not use them, and nothing here points at them.

## What is built

```
ar/
  Packages/manifest.json            exact package pins (above)
  ProjectSettings/ProjectVersion.txt the editor pin; Unity generates the rest on first open
  Assets/McCluster/
    Runtime/AnchorProvider.cs        the anchor contract (facade frame: +X right, +Y up, +Z into the wall)
    Runtime/ImageMarkerAnchorProvider.cs  Phase A: printed marker at a measured point (AR Foundation image tracking)
    Runtime/GeospatialAnchorProvider.cs   later mode, a stub that compiles without ARCore Extensions
    Runtime/FacadeSkin.cs            6 m × 4 m storefront (adjustable), occlusion, fallback ladder
    Runtime/FacadeTexture.cs         plain painted panels; all words are set as text, no artwork
    Runtime/CaptureSession.cs        clean CPU camera frames + CaptureManifestV1 (draft)
    Runtime/CaptureManifestV1.cs     the manifest shape, following the addendum §4 table
    Runtime/McClusterApi.cs          bundled business snapshot; lists the existing routes later phases use
    Runtime/ArHud.cs                 reality-view toggle (always on screen), capture opt-in, status line
    Resources/McClusterFacadeUnlit.shader  depth-tested unlit shader, so occlusion works
    Editor/McClusterArSetup.cs       menu: player settings, then scene, marker library and prefab
    Markers/mccluster-ar-marker-01.png    the image the app tracks (generated)
  Assets/StreamingAssets/fictional-city/businesses/gauranfucking-tea.json  offline snapshot (generated)
  print/mccluster-ar-marker-01.pdf  US Letter, prints the marker at 180 mm
tools/ar/export-business.mjs        manifest → snapshot, for any business id (--check for drift)
tools/ar/generate-marker.mjs        deterministic marker PNG + printable PDF
scripts/test/ar-unity-client.test.mjs
```

**The storefront.** Name, tagline, colour (`#e2b84b`), ads and staff (Mara
Costa, Lin Qiao, Eli Mensah) come from
`core/data/fictional-city/district.v1.json` via the exporter. None of it is
written in C#. The facade is plain panels: a fascia band in the shop's colour
carries the name as text, the window holds a dark VHS-ad poster (`PLAY >`, the
guarantee, a `0:00:30` counter, tracking-error lines) and a card with the second
ad line, and the door plate lists the staff. The shop has no supplied logo. The
manifest says "plain text signs carry the joke; no recovered logo is
imitated", so no mark is drawn. If the owner later supplies GAURANFUCKING TEA
artwork, it replaces the sign text unaltered.

**Occlusion.** `AROcclusionManager` sits on the AR camera. It requests
environment depth (LiDAR on iPhone, the Depth API on ARCore) and human
segmentation (supported non-LiDAR iPhones), preferring environment depth.
`ARCameraBackground` writes that depth before the scene draws, and the facade
shader depth-tests against it, so a person walking past stays in front of the
shop.

**Fallback ladder.** While world tracking is normal and the anchor is held,
the full facade shows. When tracking is limited or the anchor drops, the facade
fades out (0.6 s). After 1.5 s it becomes a floating sign card, which makes no
claim about where the shop is. After 6 s, or as soon as AR tracking is lost
altogether, the app shows the plain camera view. The **Reality view** button is
in the bottom-right in every mode, and one tap hides everything virtual.

**Capture.** Capture is off by default. The first tap explains what will be
saved, and nothing is saved until you confirm. Frames come from
`ARCameraManager.TryAcquireLatestCpuImage`, the camera image before rendering,
so the fake storefront cannot appear in reconstruction input. Each kept frame
is saved with:
- intrinsics from `XRCameraIntrinsics`, scaled to the saved image
- the camera pose in session space and relative to the anchor
- tracking state and the count of origin resets
- a GNSS prior from Unity `LocationService`, with its accuracy
- depth provenance: `sensor-lidar`, `estimated` or `none`, never mixed. Android
  depth is always `estimated`.
- the raw depth and confidence buffers, when available
- sharpness and exposure measures
- the selection or rejection reason
- SHA-256 hashes

Output stays on the phone in `Application.persistentDataPath/captures/<id>/`.
This build uploads nothing: no capture-upload route exists yet, and the
addendum's `spatial.capture.submit` is a design placeholder, not an endpoint.

**CaptureManifestV1 is a draft.** The canonical schema is being defined on
`claude/ct-weather-capture-contract-20261103`, which had not been pushed when
this was written. `CaptureManifestV1.cs` carries a `TODO(capture-contract)` to
conform to it exactly once it lands.

**Routes later phases use.** These all exist today and are listed in
`McClusterApi.Routes`; none is called in Phase A:
- Supabase auth token and refresh, the same calls `native/src/mcc.tsx` makes
- `GET /v1/me`
- the mission RPCs `join_action_mission_origin` and
  `action_globe_public_region_missions`
- `/v1/live/sessions` (with its chunk, heartbeat and complete actions), which
  is flag-gated and answers 503 until `LIVE_MISSIONS_ENABLED`; see
  `docs/control-plane/LIVE-MISSIONS.md`

## What is NOT verified

- **Compilation.** The scripts were checked by reading them against the AR
  Foundation 6.7.1, XR Management 4.6.1, Core Utils 2.6.0 and Input System
  1.20.1 package sources, not by compiling them. Expect to fix a few small
  errors on first open.
- **Everything on a device:** tracking, occlusion, fallback timing, capture,
  thermal behaviour and battery use.
- **Marker axes.** The marker's "up" axis is assumed to be +Z of the tracked
  image, which the package does not document. If the facade appears rotated or
  behind the wall, set `markerRollDegrees` (90/180/270) or `flipNormal` on
  `ImageMarkerAnchorProvider`.
- **JPEG orientation.** Saved images use `MirrorX` so they match native sensor
  row order. Check one saved frame against the scene.
- **Depth values.** It is unconfirmed whether depth values are camera-Z or ray
  distance, and whether depth registers exactly to the colour image. The
  manifest says so.
- **Render pipeline.** The project uses the Built-in Render Pipeline, so no URP
  renderer feature is needed. Moving to URP later means adding
  `ARBackgroundRendererFeature`.
- **The pilot gates below.** None has been measured.

## Owner steps

### 1. Accounts

**Apple** (needed only for an iPhone build):
1. Enrol in the Apple Developer Program at developer.apple.com/programs ($99 a
   year). Enrolling as McCluster Corp needs a D-U-N-S number; enrolling as an
   individual is faster for a first test.
2. Once approved, go to Certificates, Identifiers & Profiles → Identifiers → +
   → App IDs → App, and register the bundle ID **`org.mccluster.ar`**. It
   matches the HERE app's `org.mccluster.here`.
3. No capabilities are needed for Phase A. Camera and location are ordinary
   permission prompts.

**Android:** no account is needed to put a debug APK on your own phone. Google
Play internal testing needs a Play Console developer account ($25, one time).

### 2. Install

1. Install Unity Hub, then Editor **6000.3.27f2**. In the Hub, choose Installs
   → Install Editor → Archive if it is not offered. Add the modules **iOS Build
   Support** and **Android Build Support** (with OpenJDK and the Android
   SDK & NDK tools).
2. For iPhone: a Mac with the current Xcode from the App Store, signed in with
   your Apple ID (Xcode → Settings → Accounts).

### 3. Open the project

1. In Unity Hub choose Add → Add project from disk, then pick this `ar/` folder.
   The first open resolves the packages and takes several minutes.
2. Run **Window → TextMeshPro → Import TMP Essential Resources**. Without it the
   storefront text does not draw.
3. Open **Edit → Project Settings → XR Plug-in Management**. Tick **Apple
   ARKit** on the iOS tab and **Google ARCore** on the Android tab.
4. Run **McCluster → AR → 1. Apply player settings**. This sets the bundle ID,
   iOS 15.0, Android API 29, IL2CPP/ARM64, OpenGLES3 and the purpose strings.
   Restart the Editor if Unity asks; input handling becomes "Both".
5. Run **McCluster → AR → 2. Build tea facade scene**.
6. Commit what Unity generated: the `.meta` files, `ProjectSettings/*.asset`,
   `Packages/packages-lock.json`, the scene, the prefab and
   `MarkerLibrary.asset`. Do not commit `Library/`, `Temp/` or `Builds/`;
   `ar/.gitignore` handles that.

### 4. Build to a phone

**iPhone:**
1. In File → Build Profiles, choose iOS → Switch Platform, then Build into
   `ar/Builds/ios`.
2. Open the generated `Unity-iPhone.xcodeproj` in Xcode.
3. Under Signing & Capabilities, tick "Automatically manage signing" and choose
   your team. The bundle ID is already `org.mccluster.ar`.
4. Plug in the iPhone, turn on Developer Mode (Settings → Privacy & Security),
   then Run.

**TestFlight**, when you are ready: in Xcode choose Product → Archive →
Distribute App → App Store Connect. Create the app record in App Store Connect
under the same bundle ID first. Internal testers need no review.

**Android debug APK:**
1. In File → Build Profiles, choose Android → Switch Platform.
2. Turn on USB debugging on the phone, then choose Build And Run.

**Android, Play internal testing:**
1. Create a release keystore under Player Settings → Publishing Settings. Keep
   it out of Git; `*.keystore` is ignored.
2. Turn on "Build App Bundle (Google Play)", build an `.aab`, and upload it to
   Play Console → Testing → Internal testing.

ARCore needs a device from Google's supported-devices list.

### 5. Print the marker and test against a wall

1. Print `ar/print/mccluster-ar-marker-01.pdf` at **100% / Actual size**. Check
   with a ruler that the 100 mm bar measures 100 mm and the square measures
   **180 mm**. If either is off, the app's scale is off by the same amount.
2. Tape it flat (no curl) to a wall you control, with the top edge up. Matte
   paper avoids glare.
3. Measure where the marker's centre sits on the storefront you want: the
   distance from the facade's bottom-centre, to the right (x) and up (y). Put
   those numbers in `FacadeSkin → Marker On Facade Meters`, and the storefront
   width and height in `Facade Size Meters` (default 6 × 4). Rebuild.
4. In daylight, point the phone at the marker from 1–2 m until the status reads
   "Marker locked", then walk back to 5–10 m. The shop should stay on the wall.
5. Try each fallback on purpose. Cover the camera: the facade should fade, then
   show the sign card, then the reality view. Shake the phone. Tap Reality view.
6. To check alignment, put tape marks at 4–6 known points on the wall (corners
   of the drawn facade), measured with a tape. Capture from 3, 6 and 12 m, and
   note the screen offset between each painted corner and its tape mark.

## Phase A pilot gates (targets from the addendum; none measured)

| Gate | Target | Status |
| --- | --- | --- |
| Facade alignment | median ≤ 0.10 m, p95 ≤ 0.25 m against held-out control points at 3–12 m; also report screen-space error | **unmeasured** |
| Phone performance | 30 fps sustained for 15 min on each declared device (AR + capture together); report thermal, memory, bytes, battery | **unmeasured** |
| Fallback behaviour | tracking limited/lost hides or degrades the facade (fade → card → reality); reality view always one tap | **implemented, untested** |
| No feedback contamination | reconstruction inputs are camera images only, never rendered storefronts | **by construction (CPU image); untested on device** |
| Depth honesty | `sensor-lidar` / `estimated` / `none` recorded per frame, never conflated | **implemented, untested** |

Do not expand past one facade until these pass on real phones. No result from
the Editor or a simulator counts as a passed outdoor test.

## Device test matrix (exact models to be chosen at test time)

| Class | Example to pick | What it proves |
| --- | --- | --- |
| LiDAR iPhone | an iPhone Pro model with LiDAR | environment-depth occlusion, `sensor-lidar` depth, the alignment gates |
| Non-LiDAR iPhone | a recent non-Pro iPhone | human-segmentation occlusion only; depth `none`; the fallback ladder |
| Android (ARCore supported) | a current mid-range or flagship on Google's ARCore list | Depth API occlusion, `estimated` depth, OpenGLES3 path |

Record for every run: the exact model, OS version, app commit, lighting,
distance and the measured numbers.

## Later: geospatial anchoring (not installed)

When the real building is chosen, `GeospatialAnchorProvider` gets implemented
behind the same `AnchorProvider` contract:

1. Install ARCore Extensions for AR Foundation through Package Manager →
   Install package from git URL. Pin a release tag, for example
   `https://github.com/google-ar/arcore-unity-extensions.git#v1.57.0-arf6`.
   Confirm the tag against Google's current release notes when you do it.
2. Add the scripting define `MCCLUSTER_ARCORE_EXTENSIONS`.
3. In a Google Cloud project, enable the **ARCore API**. Prefer keyless
   authorization. If an API key is ever used, enter it only in Project Settings
   → XR Plug-in Management → ARCore Extensions, on your machine. **Never commit
   a key**; secret scanning rejects `AIza…` strings.
4. Turn on Geospatial in the ARCore Extensions settings and the
   `ARCoreExtensionsConfig`, and check `AREarthManager.IsGeospatialModeSupported`.

Facade mode stays gated on the measured alignment targets above, not on a GPS
fix.

## Regenerating the data

```
node tools/ar/export-business.mjs --id gauranfucking-tea   # after the tea shop changes in the manifest
node tools/ar/export-business.mjs --check                  # CI-style drift check
node tools/ar/generate-marker.mjs                          # only if the marker spec changes (then reprint)
node --test scripts/test/ar-unity-client.test.mjs
```

The snapshot's `source.sha256` records which manifest it came from. When the
app is online it compares that hash with the published manifest and reports
`current` or `stale`. It never rewrites lore on the device.

Unity is not built in CI, because that needs a licence. CI checks what can be
checked without the Editor.
