# Spatial capture manifest (CaptureManifestV1)

Status, 2026-11-03: **contract only.** This adds a versioned manifest, a validator and synthetic fixtures. It adds no
native app, no intake route, no storage, no migration and no reconstruction job. Nothing here is deployed or enabled.
Spec: the owner-adopted AR/reconstruction/weather addendum, §4 ("one camera session, several outputs") and §10.

| File | What it is |
| --- | --- |
| `docs/spatial/capture-manifest.v1.schema.json` | JSON Schema (2020-12) for the structure. |
| `packages/spatial-capture/validate.mjs` | Dependency-free validator: the structure plus the cross-field rules below. It runs in Node, the Worker and the browser. |
| `packages/spatial-capture/fixtures/*.json` | Two **synthetic** fixtures: a native ARKit capture on a LiDAR phone, and a browser live mission with no spatial consent. |
| `scripts/test/spatial-capture-manifest.test.mjs` | Tests: both fixtures pass, every rule fails when it should, and the schema and validator enums agree. |

Schema id: `mccluster.spatial.capture-manifest.v1`. The capability names `spatial.capture.submit` and the rest in
the addendum are design placeholders. They are **not** in `core/capabilities/catalog.json`, because the production
catalog may not hold planned entries (`core/test/control-tools.test.mjs`).

## One camera session, four roles

The client owns the camera **once**. Every output derives from that one session. It never opens a second camera
session for streaming and AR.

| Role (`outputs.*`) | Source | Visibility | Rule |
| --- | --- | --- | --- |
| `private_original` | `camera_pre_composite` | private | The existing live-mission proof. `recording_ref.kind = live_mission_chunks` reuses the chunked recording that already exists (below). |
| `spatial_keyframes` | `camera_pre_composite` | private | These exist only when `consent.spatial_capture_granted` is true **and** `allowed_uses` includes `reconstruction`. Otherwise `authorized: false` and `frames: []`. |
| `public_composition` | `composited` | public, per the publishing opt-ins | `use_for_reconstruction` is always `false`. The pin is a city label plus a 0.1° cell centre. No coordinate finer than 0.1° and no pose, track or trajectory may appear anywhere under it. |
| `replay_recipe` | references | private | It records `block_revision`, `asset_revision`, the camera path ref, the lighting time, NPC ids, a mission-state ref, the weather snapshot ref (`{region, generated_at}` from the Connecticut weather snapshot) and any generated additions. When it has generated additions it is labelled `reenactment` or `fiction`, never `faithful_replay`. `proof` is never true. |

Keyframes are sampled **before** fictional facades, NPCs, HUD or weather graphics are drawn. Otherwise reconstruction
would map our own signs and characters as physical objects.

## Records

| Record | Required | Notes |
| --- | --- | --- |
| `session.mission` | `assignment_id` or `live_session_id` (UUID) | Attaches to `action_mission_assignments` / the live run. |
| `session.device` | platform, client, `capabilities` booleans (`world_tracking`, `scene_depth_lidar`, `depth_sensor`, `imu`, `geospatial`) | Each capability is **checked on the device**, never assumed. Not every iPhone has LiDAR. |
| `session.consent` | `live_version` (`live-mission-v1`), `spatial_capture_granted`, `allowed_uses[]`, `model_training` | Spatial capture is a separate yes from going live. Training a general model is another separate decision. A grant names `spatial_capture_version` and `spatial_granted_at`. |
| `session.retention` | `original_days`, `keyframes_days`, `on_delete` (`retire_derivatives` or `rebuild_derivatives`) | Deleting one JPEG does not remove its appearance from a published splat. The policy says what happens to derivatives. |
| `timing` | `clock: monotonic`, `monotonic_epoch_utc`, `sync_uncertainty_ms`, optional `video_pts` | Frame times are on the sensor clock. The UTC mapping carries its uncertainty. |
| `cameras[]` | id, stored `image` size, `intrinsics` (fx, fy, cx, cy, `calibration_source`, `distortion.model`), `digital_zoom`, `stabilization` | Intrinsics describe the **stored** image after any crop or resize. A browser capture is always `calibration_source: estimated`. |
| keyframe `pose` | `convention`, `camera_to_session` (4×4, column-major, rigid), `tracking.state` (normal, limited or not_available), `session_origin_epoch`, optional `session_to_map {map_revision, transform, quality}` | `session_origin_epoch` increments on every origin reset. A frame with no tracking is never selected. A browser frame's pose can only be `source: estimated_offline`. |
| keyframe `position_prior` | `source` (gnss, fused or provider_vps), lat, lon, `h_acc_m`, `alt_ref` if alt | This is a prior, never truth. It is private. GPS proximity alone never merges two sessions. |
| keyframe `depth` | `source`, `measured`, `units: m`, `representation` (`camera_z` or `ray_distance`), `aligned_to_camera_id`, `confidence.present`, `sha256` | `sensor_lidar` and `sensor_tof` are `measured: true` and need the device capability. `estimated_depth_from_motion`, `estimated_learned` and `provider_geospatial` are `measured: false`. A learned estimate names its exact `model.checkpoint` and `model.license`. Provider geospatial depth never passes as local sensing. |
| keyframe `imu` | `stream_id` | Raw IMU is its own stream, kept separate from the pose computed from it. |
| keyframe `quality`, `lineage` | `selected_reason`; `processing_version`, image `sha256`, optional `upload_receipt` | A hash proves integrity of the bytes, not that the scene is true. |

## Where it attaches today: the live-mission paths

This was read from source on `main` (fe035461) and is **not** a claim about production configuration. The DB is not
reachable from this session, so migration state was not checked.

| Path | What it does now | How the manifest maps |
| --- | --- | --- |
| `js/live-mission-capture.js` | It runs `getUserMedia` with the environment camera at ideal 1280×720 plus the mic, never the screen. It publishes over WHIP (`js/whip-client.js`). `MediaRecorder` uploads a chunk every `chunk_seconds` (minimum 2, default 5, at 1.5 Mbps) via `PUT /v1/live/sessions/:id/chunks/:seq`. It also sends heartbeats, the third-party mode, "Mission complete", and the 12 publishing opt-ins (`live-publish-v1`). The consent version is `live-mission-v1`. | This is the `web-getusermedia` client. Its chunks are `private_original` (`recording_ref.kind = live_mission_chunks`). It has **no** intrinsics, pose or depth, so it emits no keyframes. Calibration would be `estimated`, and poses could only be `estimated_offline`. See `fixtures/valid-web-live-mission.json`. |
| `workers/mccluster/src/live/` (`index.js`, `recording.js`, `continuity.js`, `store.js`, `stream.js`, `webhook.js`) | It covers every `/v1/live` route. It hashes each chunk with SHA-256 and stores the receipt (`action_live_record_chunk`). It assembles the chunks after completion into one private Stream video over tus (`requiresignedurls`). It gives the continuity verdict (resume window 10 min, max 5 reconnects) and the city-cell `/now`. | The manifest reuses the run id (`live_session_id`) and the chunk hashes. A future `spatial.capture.submit` intake belongs beside these routes, under the same flag and auth, and is not a new backend. |
| `js/world-live-now-layer.js` | It reads `GET /v1/live/now` and draws **city cells**: it re-snaps every point to 0.1° and drops any without a city. | This sets the `public_pin` rule (`precision: city_cell`, one decimal). |
| `js/mnet-live.js` | The World's live **rooms** (not missions): one host over Stream WHIP/WHEP, host by grant (`network_live_host_grants`). The server reports `enabled` when `CF_ACCOUNT_ID` and `CF_STREAM_TOKEN` are set (`platform-api.js` `liveEnabled`). | It is not a capture source for spatial keyframes. It is listed because a rooms broadcast is a `public_composition` only. |
| `docs/control-plane/LIVE-MISSIONS.md` | "Status: flagged off and pending." Stream does not record WHIP, so the browser records. | The manifest keeps the separate recording path. A public livestream never leaves a reconstruction archive by itself. |
| `docs/control-plane/MISSION-ADMIN-APPROVAL.md` | Status **pending**: `supabase/pending/mission_admin_approval_v1.sql` (+ rollback). Proofs are born pending, and publishing needs admin approval. | Capture quality scores never approve proof, publish a mission or release money. |
| `docs/ACTION-NETWORK-LIVE-GOVERNANCE.md` | Canonical v1: hosting is a capability grant; real-money support is disabled. | Spatial roles add no new host role. |

**Flag state, from source:**

- `workers/mccluster/wrangler.toml` has `LIVE_MISSIONS_ENABLED = "false"`. Every `/v1/live` route answers 503.
- `supabase/pending/live_missions_v1.sql` (+ rollback) is in `pending/`, so the repo does not show it applied.
- The secrets named for live missions (`CF_LIVE_NOTIFICATION_SECRET`, optional `CF_STREAM_WEBHOOK_SECRET`) are
  `wrangler secret` values and cannot be confirmed from source.

Tests on those paths:

- `workers/mccluster/test/live-missions.test.mjs`
- `workers/mccluster/test/mnet-live.test.mjs`
- `scripts/test/live-missions-client.test.mjs`
- `scripts/test/action-network-live-governance.test.mjs`
- `scripts/test/completed-mission-globe.test.mjs`

## What a native ARKit / ARCore client must emit (not built)

1. **One session.**
   - On ARKit, one `ARSession` (`ARWorldTrackingConfiguration`, with `sceneDepth` only when
     `supportsFrameSemantics(.sceneDepth)` is true).
   - On ARCore, one `Session`, with the Depth API only when `isDepthModeSupported`.
   - From that session, feed the WHIP encoder with the **composited** view. Feed the private recorder and the
     keyframe sampler with the **camera image** (`ARFrame.capturedImage` / `Frame.acquireCameraImage`), before any
     rendering.
2. **Per selected keyframe:**
   - the stored JPEG/HEIC with its SHA-256;
   - `camera.intrinsics` rescaled to the stored size;
   - `camera.transform` / `Camera.getPose` as a column-major 4×4 with the convention named;
   - `trackingState` and its reason;
   - the monotonic timestamp (`ARFrame.timestamp` / `Frame.getTimestamp`);
   - for depth, `ARDepthData.depthMap` plus `confidenceMap` as `sensor_lidar`, `camera_z`, metres. ARCore depth is
     `estimated_depth_from_motion` unless the device's hardware depth is the documented source.
3. **Session events:**
   - increment `session_origin_epoch` on relocalization or a reset;
   - keep raw IMU as its own stream;
   - keep GNSS (`CLLocation` / `Location`) as `position_prior` with its accuracies;
   - the ARCore Geospatial pose, if used, is `provider_vps` / `provider_geospatial`, never local sensing.
4. **Degrade:** on limited or not-available tracking, fade any facade, select no frames, and keep the reality view.
5. **Consent UI:** show live consent and spatial-capture consent as two separate choices. Offer a role with no mapping.
   Show the intended uses and retention.
6. **Upload:** small manifests promptly; frames resumably. Use idempotent `capture_id` and `frame_id`.
7. **Validate** with `validateCaptureManifest` before upload. The server re-validates.

## Unity Phase A scaffold compatibility

The Unity scaffold under `ar/` captures device-local alignment-pilot records using
`mccluster.capture-manifest.v1-draft`. It does **not** emit this canonical schema.
`packages/spatial-capture/validate.mjs` rejects that draft, and it must never be
uploaded or used for reconstruction by relabelling its schema id.

Its opt-in is for the local owner pilot, not canonical reconstruction or model training.
Mission linkage, explicit allowed uses and retention, the four output roles, measured
clock uncertainty, canonical pose conversion and verified depth representation/registration
remain to be implemented and validated on devices. Unknown measurements cannot be
replaced with invented defaults. See `ar/README.md` and `TODO(capture-contract)` in
`ar/Assets/McCluster/Runtime/CaptureManifestV1.cs`. The scaffold has no upload route.

## What remains

- Canonical contract integration and consent UI for the native ARKit/ARCore scaffold.
- The intake route (beside `/v1/live`, flagged) and private storage.
- Retention jobs.
- Field tests on named devices: a LiDAR iPhone, a non-LiDAR iPhone and a representative Android. These cover
  combined AR, stream, recording and sampling load; thermal behaviour; and bytes per accepted frame.
- Reconstruction (COLMAP baseline) on OVH workers.

No outdoor capture has been made. No device has been tested.
