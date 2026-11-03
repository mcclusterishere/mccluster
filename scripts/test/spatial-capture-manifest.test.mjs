/* CaptureManifestV1 (docs/spatial/CAPTURE-MANIFEST.md, packages/spatial-capture/validate.mjs). Synthetic fixtures
   only: no device, person or place visit produced them. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateCaptureManifest, SCHEMA_ID, CLIENTS, ALLOWED_USES, DEPTH_SOURCES, TRACKING, REPLAY_LABELS, COMPOSITE_LAYERS,
} from '../../packages/spatial-capture/validate.mjs';

const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const fixture = (n) => JSON.parse(read(`packages/spatial-capture/fixtures/${n}.json`));
const NATIVE = fixture('valid-native-arkit-lidar');
const WEB = fixture('valid-web-live-mission');
const codes = (m) => validateCaptureManifest(m).errors.map((e) => e.code);
const mutate = (base, fn) => { const m = structuredClone(base); fn(m); return m; };
const frame0 = (m) => m.outputs.spatial_keyframes.frames[0];

test('both synthetic fixtures are valid and marked synthetic', () => {
  for (const m of [NATIVE, WEB]) {
    assert.match(m.$comment, /SYNTHETIC/);
    assert.deepEqual(validateCaptureManifest(m).errors, []);
  }
});

test('the schema file and the validator agree on ids and enums', () => {
  const schema = JSON.parse(read('docs/spatial/capture-manifest.v1.schema.json'));
  assert.equal(schema.properties.schema.const, SCHEMA_ID);
  assert.deepEqual(schema.properties.session.properties.device.properties.client.enum, CLIENTS);
  assert.deepEqual(schema.properties.session.properties.consent.properties.allowed_uses.items.enum, ALLOWED_USES);
  assert.deepEqual(schema.$defs.keyframe.properties.depth.properties.source.enum, Object.keys(DEPTH_SOURCES));
  assert.deepEqual(schema.$defs.keyframe.properties.pose.properties.tracking.properties.state.enum, TRACKING);
  assert.deepEqual(schema.properties.outputs.properties.replay_recipe.oneOf[1].properties.label.enum, REPLAY_LABELS);
  assert.deepEqual(schema.properties.outputs.properties.public_composition.properties.layers.items.enum, COMPOSITE_LAYERS);
  const doc = read('docs/spatial/CAPTURE-MANIFEST.md');
  for (const f of ['js/live-mission-capture.js', 'js/mnet-live.js', 'js/world-live-now-layer.js', 'workers/mccluster/src/live/', 'LIVE_MISSIONS_ENABLED', 'supabase/pending/live_missions_v1.sql', 'MISSION-ADMIN-APPROVAL.md', 'ACTION-NETWORK-LIVE-GOVERNANCE.md']) assert.ok(doc.includes(f), `doc maps ${f}`);
});

test('keyframes need their own spatial consent and the reconstruction use', () => {
  assert.ok(codes(mutate(NATIVE, (m) => { m.session.consent.spatial_capture_granted = false; })).includes('authorization'));
  assert.ok(codes(mutate(NATIVE, (m) => { m.session.consent.spatial_capture_granted = false; m.outputs.spatial_keyframes.authorized = false; })).includes('unauthorized_frames'));
  assert.ok(codes(mutate(NATIVE, (m) => { m.session.consent.allowed_uses = ['live_mission_proof']; m.outputs.spatial_keyframes.authorized = false; })).includes('unauthorized_frames'));
  assert.ok(codes(mutate(NATIVE, (m) => { delete m.session.consent.model_training; })).includes('boolean'), 'training is its own explicit decision');
  assert.ok(codes(mutate(NATIVE, (m) => { m.session.mission = {}; })).includes('mission_link'));
});

test('no feedback contamination: keyframes are pre-composite and the composited view is never reconstruction input', () => {
  assert.ok(codes(mutate(NATIVE, (m) => { m.outputs.spatial_keyframes.source = 'composited'; })).includes('pre_composite'));
  assert.ok(codes(mutate(NATIVE, (m) => { m.outputs.public_composition.use_for_reconstruction = true; })).includes('feedback'));
  assert.ok(codes(mutate(NATIVE, (m) => { m.outputs.private_original.visibility = 'public'; })).includes('private'));
});

test('depth provenance is never conflated', () => {
  assert.ok(codes(mutate(NATIVE, (m) => { frame0(m).depth.source = 'estimated_learned'; })).includes('depth_provenance'), 'an estimate cannot be measured');
  assert.ok(codes(mutate(NATIVE, (m) => { frame0(m).depth.source = 'estimated_learned'; frame0(m).depth.measured = false; })).includes('model'), 'a learned estimate names its checkpoint');
  assert.deepEqual(codes(mutate(NATIVE, (m) => { Object.assign(frame0(m).depth, { source: 'estimated_learned', measured: false, model: { name: 'Depth Anything 3', checkpoint: 'DA3-SMALL', license: 'Apache-2.0' } }); })), []);
  assert.ok(codes(mutate(NATIVE, (m) => { m.session.device.capabilities.scene_depth_lidar = false; })).includes('depth_device'), 'no LiDAR depth from a device without LiDAR');
  assert.ok(codes(mutate(NATIVE, (m) => { frame0(m).depth.source = 'provider_geospatial'; })).includes('depth_provenance'), 'provider geometry is not a local sensor');
  assert.ok(codes(mutate(NATIVE, (m) => { delete frame0(m).depth.representation; })).includes('enum'), 'camera_z vs ray distance is explicit');
});

test('intrinsics match the stored image and poses are rigid transforms', () => {
  assert.ok(codes(mutate(NATIVE, (m) => { frame0(m).image.width = 960; frame0(m).image.height = 720; })).includes('intrinsics_mismatch'));
  assert.ok(codes(mutate(NATIVE, (m) => { m.cameras[0].image = { width: 960, height: 720 }; })).includes('intrinsics_mismatch'), 'downscaled image with full-size intrinsics');
  assert.ok(codes(mutate(NATIVE, (m) => { frame0(m).pose.camera_to_session[0] = 2; })).includes('rigid'));
  assert.ok(codes(mutate(NATIVE, (m) => { frame0(m).pose.camera_to_session[3] = 1; })).includes('rigid'));
  assert.ok(codes(mutate(NATIVE, (m) => { frame0(m).pose.tracking.state = 'not_available'; })).includes('untracked'));
  assert.ok(codes(mutate(NATIVE, (m) => { m.outputs.spatial_keyframes.frames.reverse(); })).includes('order'));
});

test('public output stays at city-cell precision with no tracks', () => {
  assert.ok(codes(mutate(NATIVE, (m) => { m.outputs.public_composition.public_pin.cell_lat = 41.172; })).includes('pin_precision'));
  assert.ok(codes(mutate(NATIVE, (m) => { m.outputs.public_composition.overlay = { lat: 41.17201, lon: -73.18853 }; })).includes('public_precision'));
  assert.ok(codes(mutate(NATIVE, (m) => { m.outputs.public_composition.trajectory = []; })).includes('public_track'));
});

test('a browser capture never claims device calibration or device poses', () => {
  assert.ok(codes(mutate(WEB, (m) => { m.cameras[0].intrinsics.calibration_source = 'device_reported'; })).includes('web_calibration'));
  const withFrames = mutate(WEB, (m) => {
    m.session.consent = { ...m.session.consent, spatial_capture_granted: true, spatial_capture_version: 'spatial-capture-v1', spatial_granted_at: '2026-11-03T15:58:00Z', allowed_uses: ['live_mission_proof', 'reconstruction'] };
    m.outputs.spatial_keyframes.authorized = true;
    const f = structuredClone(NATIVE.outputs.spatial_keyframes.frames[1]);
    f.camera_id = 'getusermedia-environment'; f.image.width = 1280; f.image.height = 720;
    m.outputs.spatial_keyframes.frames = [f];
  });
  assert.ok(codes(withFrames).includes('web_pose'));
  withFrames.outputs.spatial_keyframes.frames[0].pose.source = 'estimated_offline';
  assert.deepEqual(codes(withFrames), []);
});

test('a replay with generated additions is a reenactment or fiction, never proof', () => {
  assert.ok(codes(mutate(NATIVE, (m) => { m.outputs.replay_recipe.label = 'faithful_replay'; })).includes('generated_label'));
  assert.ok(codes(mutate(NATIVE, (m) => { m.outputs.replay_recipe.proof = true; })).includes('not_proof'));
});
