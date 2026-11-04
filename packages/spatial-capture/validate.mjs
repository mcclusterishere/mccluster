/* CaptureManifestV1 validator (mccluster.spatial.capture-manifest.v1). Dependency free; runs in Node, the Worker
   and the browser. Contract: docs/spatial/CAPTURE-MANIFEST.md; structure: docs/spatial/capture-manifest.v1.schema.json.

   validateCaptureManifest(manifest) -> { ok, errors: [{ path, code, message }] }

   Beyond structure it enforces the rules the schema cannot say:
     - one camera session, four roles: private original, spatial keyframes, public composition, replay recipe;
     - keyframes come from the camera BEFORE compositing; the public composition is never reconstruction input;
     - spatial keyframes exist only when spatial capture was separately consented and 'reconstruction' allowed;
     - depth provenance is never conflated: sensor depth needs a sensor-capable device, estimated depth is
       `measured: false` and a learned estimate names its exact checkpoint and licence;
     - intrinsics match the stored image (after crop/resize); poses are rigid 4x4 transforms;
     - the public pin is a 0.1-degree city cell, and nothing public carries a finer coordinate;
     - a browser capture's calibration is estimated, never reported as device-measured;
     - a replay with generated additions is labelled reenactment or fiction, never a faithful replay. */

export const SCHEMA_ID = 'mccluster.spatial.capture-manifest.v1';
export const CLIENTS = Object.freeze(['native-arkit', 'native-arcore', 'native-arcore-geospatial-ios', 'web-getusermedia']);
export const PLATFORMS = Object.freeze(['ios', 'android', 'web']);
export const ALLOWED_USES = Object.freeze(['live_mission_proof', 'reconstruction', 'localization_map', 'replay', 'public_composition']);
export const DEPTH_SOURCES = Object.freeze({
  sensor_lidar: { measured: true, needs: 'scene_depth_lidar' },
  sensor_tof: { measured: true, needs: 'depth_sensor' },
  estimated_depth_from_motion: { measured: false },
  estimated_learned: { measured: false, needsModel: true },
  provider_geospatial: { measured: false },
});
export const TRACKING = Object.freeze(['normal', 'limited', 'not_available']);
export const POSE_CONVENTIONS = Object.freeze(['arkit_y_up_rh', 'arcore_y_up_rh', 'opencv_z_forward', 'unknown']);
export const REPLAY_LABELS = Object.freeze(['faithful_replay', 'reenactment', 'fiction']);
export const COMPOSITE_LAYERS = Object.freeze(['fictional_facades', 'npcs', 'mission_props', 'hud', 'weather_graphics', 'captions']);

const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const isoOk = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)) && /T/.test(v);
const oneDecimal = (v) => fin(v) && Math.abs(Math.round(v * 10) - v * 10) < 1e-9;

export function validateCaptureManifest(m) {
  const errors = [];
  const err = (path, code, message) => errors.push({ path, code, message });
  const need = (obj, key, path, test, code, message) => { if (!isObj(obj) || !test(obj[key])) err(`${path}.${key}`, code, message); };

  if (!isObj(m)) return { ok: false, errors: [{ path: '$', code: 'not_object', message: 'manifest must be an object' }] };
  if (m.schema !== SCHEMA_ID) err('$.schema', 'schema', `schema must be ${SCHEMA_ID}`);
  need(m, 'capture_id', '$', (v) => UUID.test(String(v || '')), 'uuid', 'capture_id must be a UUID');
  need(m, 'created_at', '$', isoOk, 'time', 'created_at must be an ISO time');

  /* ---------- session ---------- */
  const s = m.session;
  if (!isObj(s)) err('$.session', 'required', 'session is required');
  const mission = s?.mission;
  if (!isObj(mission) || !['assignment_id', 'live_session_id'].some((k) => UUID.test(String(mission[k] || '')))) {
    err('$.session.mission', 'mission_link', 'a capture attaches to a live mission: assignment_id or live_session_id (UUID)');
  }
  const device = s?.device;
  need(device, 'platform', '$.session.device', (v) => PLATFORMS.includes(v), 'enum', `platform is one of ${PLATFORMS.join(', ')}`);
  need(device, 'client', '$.session.device', (v) => CLIENTS.includes(v), 'enum', `client is one of ${CLIENTS.join(', ')}`);
  const caps = isObj(device?.capabilities) ? device.capabilities : null;
  if (!caps) err('$.session.device.capabilities', 'required', 'device capabilities are required (checked, never assumed)');
  else for (const k of ['world_tracking', 'scene_depth_lidar', 'depth_sensor', 'imu', 'geospatial']) {
    if (typeof caps[k] !== 'boolean') err(`$.session.device.capabilities.${k}`, 'boolean', `${k} must be true or false as checked on the device`);
  }
  if (device?.client === 'web-getusermedia' && device?.platform !== 'web') err('$.session.device.platform', 'client_platform', 'a browser capture is platform web');
  if (device?.client?.startsWith('native-arkit') && device?.platform !== 'ios') err('$.session.device.platform', 'client_platform', 'ARKit runs on ios');

  const consent = s?.consent;
  need(consent, 'live_version', '$.session.consent', (v) => typeof v === 'string' && v.length > 0, 'required', 'the live-mission consent version (e.g. live-mission-v1)');
  need(consent, 'spatial_capture_granted', '$.session.consent', (v) => typeof v === 'boolean', 'boolean', 'spatial capture consent is its own explicit yes or no');
  need(consent, 'model_training', '$.session.consent', (v) => typeof v === 'boolean', 'boolean', 'training a general model is a separate explicit decision');
  const uses = Array.isArray(consent?.allowed_uses) ? consent.allowed_uses : null;
  if (!uses) err('$.session.consent.allowed_uses', 'required', 'allowed_uses is required');
  else for (const u of uses) if (!ALLOWED_USES.includes(u)) err('$.session.consent.allowed_uses', 'enum', `unknown use ${u}`);
  if (consent?.spatial_capture_granted === true) {
    need(consent, 'spatial_capture_version', '$.session.consent', (v) => typeof v === 'string' && v.length > 0, 'required', 'a granted spatial capture names its consent text version');
    need(consent, 'spatial_granted_at', '$.session.consent', isoOk, 'time', 'when spatial capture was granted');
  }
  const ret = s?.retention;
  need(ret, 'original_days', '$.session.retention', (v) => Number.isInteger(v) && v > 0, 'integer', 'original retention in days');
  need(ret, 'keyframes_days', '$.session.retention', (v) => Number.isInteger(v) && v > 0, 'integer', 'keyframe retention in days');
  need(ret, 'on_delete', '$.session.retention', (v) => ['retire_derivatives', 'rebuild_derivatives'].includes(v), 'enum', 'what happens to derived splats/meshes when a source is deleted');

  /* ---------- timing ---------- */
  const t = m.timing;
  need(t, 'clock', '$.timing', (v) => v === 'monotonic', 'enum', 'frame times are on a monotonic sensor clock');
  need(t, 'monotonic_epoch_utc', '$.timing', isoOk, 'time', 'UTC time of monotonic zero');
  need(t, 'sync_uncertainty_ms', '$.timing', (v) => fin(v) && v >= 0, 'number', 'clock-to-UTC uncertainty in ms');

  /* ---------- cameras ---------- */
  const cameras = new Map();
  if (!Array.isArray(m.cameras) || !m.cameras.length) err('$.cameras', 'required', 'at least one camera');
  else m.cameras.forEach((c, i) => {
    const p = `$.cameras[${i}]`;
    if (!isObj(c) || typeof c.camera_id !== 'string' || !c.camera_id) { err(p, 'required', 'camera_id'); return; }
    cameras.set(c.camera_id, c);
    const w = c.image?.width, h = c.image?.height;
    if (!(Number.isInteger(w) && w > 0 && Number.isInteger(h) && h > 0)) err(`${p}.image`, 'size', 'image width and height (the STORED image, after crop/resize)');
    const k = c.intrinsics;
    if (!isObj(k) || ![k.fx, k.fy, k.cx, k.cy].every(fin) || k.fx <= 0 || k.fy <= 0) err(`${p}.intrinsics`, 'intrinsics', 'fx, fy, cx, cy in pixels of the stored image');
    else if (Number.isInteger(w) && Number.isInteger(h) && (k.cx <= 0 || k.cx >= w || k.cy <= 0 || k.cy >= h)) err(`${p}.intrinsics`, 'intrinsics_mismatch', 'principal point lies outside the stored image: intrinsics were not rescaled with the image');
    if (!isObj(k) || !['device_reported', 'calibrated', 'estimated'].includes(k.calibration_source)) err(`${p}.intrinsics.calibration_source`, 'enum', 'device_reported, calibrated or estimated');
    if (device?.client === 'web-getusermedia' && k?.calibration_source !== 'estimated') err(`${p}.intrinsics.calibration_source`, 'web_calibration', 'a browser capture has no device calibration: mark it estimated');
    if (!isObj(k?.distortion) || typeof k.distortion.model !== 'string') err(`${p}.intrinsics.distortion`, 'required', 'distortion model (none if rectified)');
    if (!['off', 'on', 'unknown'].includes(c.stabilization)) err(`${p}.stabilization`, 'enum', 'video stabilization off, on or unknown');
    if (!(fin(c.digital_zoom) && c.digital_zoom >= 1)) err(`${p}.digital_zoom`, 'number', 'digital zoom factor (1 = none)');
  });

  /* ---------- outputs: one session, four roles ---------- */
  const o = m.outputs;
  if (!isObj(o)) { err('$.outputs', 'required', 'outputs are required'); return { ok: false, errors }; }
  const orig = o.private_original;
  need(orig, 'role', '$.outputs.private_original', (v) => v === 'private_original', 'role', 'role private_original');
  need(orig, 'visibility', '$.outputs.private_original', (v) => v === 'private', 'private', 'the original recording is private');
  need(orig, 'source', '$.outputs.private_original', (v) => v === 'camera_pre_composite', 'pre_composite', 'the original is the camera before any AR compositing');
  need(orig, 'recording_ref', '$.outputs.private_original', (v) => isObj(v) && ['live_mission_chunks', 'native_file'].includes(v.kind), 'required', 'where the original lives (live_mission_chunks reuses the existing recording path)');

  const kf = o.spatial_keyframes;
  need(kf, 'role', '$.outputs.spatial_keyframes', (v) => v === 'spatial_keyframes', 'role', 'role spatial_keyframes');
  need(kf, 'visibility', '$.outputs.spatial_keyframes', (v) => v === 'private', 'private', 'keyframes, poses and precise positions are private');
  need(kf, 'source', '$.outputs.spatial_keyframes', (v) => v === 'camera_pre_composite', 'pre_composite', 'keyframes are sampled before compositing: our own signs and NPCs must never be reconstructed as physical');
  const frames = Array.isArray(kf?.frames) ? kf.frames : null;
  if (!frames) err('$.outputs.spatial_keyframes.frames', 'required', 'frames array (may be empty)');
  const spatialAllowed = consent?.spatial_capture_granted === true && uses?.includes('reconstruction');
  if (kf?.authorized !== spatialAllowed) err('$.outputs.spatial_keyframes.authorized', 'authorization', 'authorized must equal: spatial capture granted AND reconstruction allowed');
  if (!spatialAllowed && frames?.length) err('$.outputs.spatial_keyframes.frames', 'unauthorized_frames', 'no spatial keyframes without separate spatial capture consent');

  const pub = o.public_composition;
  need(pub, 'role', '$.outputs.public_composition', (v) => v === 'public_composition', 'role', 'role public_composition');
  need(pub, 'source', '$.outputs.public_composition', (v) => v === 'composited', 'composited', 'the public stream is the composited AR view');
  need(pub, 'use_for_reconstruction', '$.outputs.public_composition', (v) => v === false, 'feedback', 'the composited view is never reconstruction input');
  if (!Array.isArray(pub?.layers) || pub.layers.some((l) => !COMPOSITE_LAYERS.includes(l))) err('$.outputs.public_composition.layers', 'enum', `layers from ${COMPOSITE_LAYERS.join(', ')}`);
  const pin = pub?.public_pin;
  if (pin !== null && pin !== undefined) {
    if (!isObj(pin) || pin.precision !== 'city_cell' || !oneDecimal(pin.cell_lat) || !oneDecimal(pin.cell_lng) || typeof pin.city !== 'string') {
      err('$.outputs.public_composition.public_pin', 'pin_precision', 'a public pin is a city label and a 0.1-degree cell centre, never a finer point');
    }
  }
  // nothing under the public composition may carry a finer coordinate
  (function scan(v, path) {
    if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${path}[${i}]`));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) {
      if (/^(lat|lon|lng|latitude|longitude|cell_lat|cell_lng)$/i.test(k) && fin(x) && !oneDecimal(x)) err(`${path}.${k}`, 'public_precision', 'a public coordinate finer than 0.1 degree');
      else if (/trajectory|track|pose|camera_to/i.test(k)) err(`${path}.${k}`, 'public_track', 'poses and trajectories are never public');
      else scan(x, `${path}.${k}`);
    }
  })(pub, '$.outputs.public_composition');
  need(pub, 'publishing', '$.outputs.public_composition', (v) => isObj(v) && typeof v.version === 'string', 'required', 'the publishing opt-ins it falls under (live-publish-v1)');

  const rr = o.replay_recipe;
  if (rr !== null && rr !== undefined) {
    if (!isObj(rr) || !REPLAY_LABELS.includes(rr.label)) err('$.outputs.replay_recipe.label', 'enum', `label is ${REPLAY_LABELS.join(', ')}`);
    else {
      if (Array.isArray(rr.generated_additions) && rr.generated_additions.length && rr.label === 'faithful_replay') err('$.outputs.replay_recipe.label', 'generated_label', 'a replay with generated additions is a reenactment or fiction');
      if (rr.proof === true) err('$.outputs.replay_recipe.proof', 'not_proof', 'a replay is never mission proof');
      if (!isObj(rr.weather) && rr.weather !== null) err('$.outputs.replay_recipe.weather', 'required', 'weather snapshot reference ({ region, generated_at }) or null');
    }
  }

  /* ---------- keyframes ---------- */
  let lastT = -Infinity;
  (frames || []).forEach((f, i) => {
    const p = `$.outputs.spatial_keyframes.frames[${i}]`;
    if (!isObj(f)) { err(p, 'required', 'frame object'); return; }
    if (typeof f.frame_id !== 'string' || !f.frame_id) err(`${p}.frame_id`, 'required', 'frame_id');
    if (!fin(f.t_mono_s)) err(`${p}.t_mono_s`, 'number', 'monotonic seconds');
    else { if (f.t_mono_s < lastT) err(`${p}.t_mono_s`, 'order', 'frames in monotonic order'); lastT = f.t_mono_s; }
    const cam = cameras.get(f.camera_id);
    if (!cam) err(`${p}.camera_id`, 'camera', 'camera_id names a declared camera');
    const img = f.image;
    if (!isObj(img) || !SHA.test(String(img.sha256 || ''))) err(`${p}.image.sha256`, 'sha256', 'content hash of the stored image');
    if (cam && isObj(img) && (img.width !== cam.image?.width || img.height !== cam.image?.height)) err(`${p}.image`, 'intrinsics_mismatch', 'stored image size differs from its camera: intrinsics would not match');
    const pose = f.pose;
    if (!isObj(pose)) err(`${p}.pose`, 'required', 'pose (tracking state not_available when none)');
    else {
      if (!TRACKING.includes(pose.tracking?.state)) err(`${p}.pose.tracking.state`, 'enum', `tracking is ${TRACKING.join(', ')}`);
      if (!POSE_CONVENTIONS.includes(pose.convention)) err(`${p}.pose.convention`, 'enum', `axes convention is ${POSE_CONVENTIONS.join(', ')}`);
      if (!Number.isInteger(pose.session_origin_epoch) || pose.session_origin_epoch < 0) err(`${p}.pose.session_origin_epoch`, 'integer', 'increments on every tracking origin reset');
      if (pose.tracking?.state !== 'not_available') {
        const M = pose.camera_to_session;
        if (!Array.isArray(M) || M.length !== 16 || !M.every(fin)) err(`${p}.pose.camera_to_session`, 'matrix', '4x4 column-major camera-to-session transform');
        else if (Math.abs(M[3]) > 1e-6 || Math.abs(M[7]) > 1e-6 || Math.abs(M[11]) > 1e-6 || Math.abs(M[15] - 1) > 1e-6) err(`${p}.pose.camera_to_session`, 'rigid', 'bottom row must be 0 0 0 1 (column-major)');
        else {
          const det = M[0] * (M[5] * M[10] - M[9] * M[6]) - M[4] * (M[1] * M[10] - M[9] * M[2]) + M[8] * (M[1] * M[6] - M[5] * M[2]);
          if (Math.abs(det - 1) > 1e-3) err(`${p}.pose.camera_to_session`, 'rigid', 'rotation part must be orthonormal with determinant 1');
        }
        if (device?.client === 'web-getusermedia' && pose.source !== 'estimated_offline') err(`${p}.pose.source`, 'web_pose', 'a browser camera has no device pose: only an offline estimate');
      }
      if (pose.session_to_map !== undefined && pose.session_to_map !== null) {
        const sm = pose.session_to_map;
        if (!isObj(sm) || typeof sm.map_revision !== 'string' || !Array.isArray(sm.transform) || sm.transform.length !== 16 || !fin(sm.quality)) err(`${p}.pose.session_to_map`, 'map_link', 'map_revision, 16-number transform and quality');
      }
    }
    if (f.selected === true && pose?.tracking?.state === 'not_available') err(`${p}.selected`, 'untracked', 'a frame without tracking is not selected for reconstruction');
    const prior = f.position_prior;
    if (prior !== undefined && prior !== null) {
      if (!isObj(prior) || !['gnss', 'fused', 'provider_vps'].includes(prior.source) || !fin(prior.lat) || !fin(prior.lon) || !fin(prior.h_acc_m)) err(`${p}.position_prior`, 'prior', 'source, lat, lon and horizontal accuracy (a prior, never truth)');
      if (isObj(prior) && prior.alt_m !== undefined && !['ellipsoid_wgs84', 'navd88', 'msl_unknown'].includes(prior.alt_ref)) err(`${p}.position_prior.alt_ref`, 'enum', 'altitude convention');
    }
    const d = f.depth;
    if (d !== undefined && d !== null) {
      const rule = DEPTH_SOURCES[d?.source];
      if (!rule) err(`${p}.depth.source`, 'enum', `depth source is ${Object.keys(DEPTH_SOURCES).join(', ')}`);
      else {
        if (d.measured !== rule.measured) err(`${p}.depth.measured`, 'depth_provenance', `${d.source} is ${rule.measured ? 'a sensor measurement' : 'an estimate'}: measured must be ${rule.measured}`);
        if (rule.needs && caps?.[rule.needs] !== true) err(`${p}.depth.source`, 'depth_device', `${d.source} needs a device whose ${rule.needs} capability was checked true`);
        if (rule.needsModel && !(isObj(d.model) && typeof d.model.checkpoint === 'string' && typeof d.model.license === 'string')) err(`${p}.depth.model`, 'model', 'a learned estimate names its exact checkpoint and licence');
      }
      if (d?.units !== 'm') err(`${p}.depth.units`, 'enum', 'depth in metres');
      if (!['camera_z', 'ray_distance'].includes(d?.representation)) err(`${p}.depth.representation`, 'enum', 'camera_z or ray_distance, said explicitly');
      if (!cameras.has(d?.aligned_to_camera_id)) err(`${p}.depth.aligned_to_camera_id`, 'camera', 'which camera the depth map is aligned to');
      if (!SHA.test(String(d?.sha256 || ''))) err(`${p}.depth.sha256`, 'sha256', 'content hash of the depth map');
      if (!isObj(d?.confidence) || typeof d.confidence.present !== 'boolean') err(`${p}.depth.confidence`, 'required', 'whether a confidence map exists');
    }
    if (f.imu !== undefined && f.imu !== null && !(isObj(f.imu) && typeof f.imu.stream_id === 'string')) err(`${p}.imu`, 'imu', 'raw IMU is referenced as its own stream, separate from the pose');
    const q = f.quality;
    if (!isObj(q) || typeof q.selected_reason !== 'string') err(`${p}.quality.selected_reason`, 'required', 'why the frame was selected or rejected');
    if (!isObj(f.lineage) || typeof f.lineage.processing_version !== 'string') err(`${p}.lineage.processing_version`, 'required', 'processing version');
  });

  return { ok: errors.length === 0, errors };
}
