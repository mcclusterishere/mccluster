/** Metadata-only preflight. Does not extract, upload, reconstruct or render media. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const isId = (value) => typeof value === 'string' && ID.test(value);
const HASH = /^[a-f0-9]{64}$/;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
export function validateFrozenCapture(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false, errors: ['capture_required'] };
  if (!isId(input.capture_id)) errors.push('capture_id_invalid');
  if (!finite(input.instant_ms) || input.instant_ms < 0) errors.push('instant_invalid');
  if (!finite(input.max_sync_error_ms) || input.max_sync_error_ms < 0 || input.max_sync_error_ms > 100) errors.push('sync_tolerance_invalid');
  const views = Array.isArray(input.views) ? input.views : [];
  // Local preflight resource limit, not an assertion about a provider's model limit.
  if (views.length < 2 || views.length > 16) errors.push('view_count_2_to_16_required');
  const cameras = new Set();
  const assets = new Set();
  const hashes = new Set();
  for (const [i, v] of views.entries()) {
    if (!v || typeof v !== 'object') { errors.push(`view_${i}_invalid`); continue; }
    if (!isId(v.camera_id) || cameras.has(v.camera_id)) errors.push(`view_${i}_camera_invalid_or_duplicate`);
    if (!isId(v.asset_id) || assets.has(v.asset_id)) errors.push(`view_${i}_asset_invalid_or_duplicate`);
    cameras.add(v.camera_id); assets.add(v.asset_id);
    if (typeof v.sha256 !== 'string' || !HASH.test(v.sha256)) errors.push(`view_${i}_sha256_required`);
    else if (hashes.has(v.sha256)) errors.push(`view_${i}_duplicate_image`);
    hashes.add(v.sha256);
    if (!['image/jpeg', 'image/png'].includes(v.mime_type)) errors.push(`view_${i}_still_image_required`);
    if (!Number.isSafeInteger(v.width) || v.width < 1 || !Number.isSafeInteger(v.height) || v.height < 1) errors.push(`view_${i}_dimensions_invalid`);
    // Common capture-clock time, not per-file playback position; offsets must be resolved first.
    if (!finite(v.capture_time_ms) || v.capture_time_ms < 0 || !finite(v.sync_uncertainty_ms) || v.sync_uncertainty_ms < 0) errors.push(`view_${i}_timing_invalid`);
    else if (Math.abs(v.capture_time_ms - input.instant_ms) + v.sync_uncertainty_ms > input.max_sync_error_ms) errors.push(`view_${i}_not_synchronized`);
    if (v.url || v.path || v.data || v.base64) errors.push(`view_${i}_asset_reference_only`);
  }
  return { valid: errors.length === 0, errors };
}
export function prepareFrozenCapture(input) {
  const validation = validateFrozenCapture(input);
  if (!validation.valid) return { status: 'invalid', ...validation };
  return {
    status: 'metadata_validated_not_reconstructed',
    schema: 'mccluster.frozen-capture.v1',
    capture_id: input.capture_id,
    instant_ms: input.instant_ms,
    max_sync_error_ms: input.max_sync_error_ms,
    views: input.views.map(({ camera_id, asset_id, sha256, mime_type, width, height, capture_time_ms, sync_uncertainty_ms }) => ({ camera_id, asset_id, sha256, mime_type, width, height, capture_time_ms, sync_uncertainty_ms })),
    execution: { enabled: false, reason: 'provider_access_license_privacy_and_quality_review_required' },
    limitations: ['Not continuous dynamic reconstruction', 'Hidden surfaces and novel views may be synthesized', 'Synchronization metadata is not independently verified', 'Asset ownership must be checked by the authenticated media service']
  };
}
