import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAustinCameraCatalog, normalizeCameraProviders, cameraCoverage } from '../src/seek-first/camera-catalog.js';
const payload = { meta: { view: { columns: [
  { fieldName: 'camera_id' }, { fieldName: 'camera_name' }, { fieldName: 'latitude' }, { fieldName: 'longitude' }, { fieldName: 'camera_url' }
] } }, data: [
  ['A1', 'First camera', 30.27, -97.74, 'https://example.org/camera'],
  ['A1', 'Duplicate', 30.27, -97.74, null],
  ['A2', 'Outside', 40.0, -97.74, null],
  ['A3', 'Missing position', null, null, null],
  ['A4', 'Second', 30.28, -97.75, 'javascript:alert(1)']
] };
test('camera catalog bounds, deduplicates, and never asserts live feed', () => {
  const records = normalizeAustinCameraCatalog(payload, { bbox: [-98, 30, -97, 31] });
  assert.deepEqual(records.map(r => r.external_id), ['austin:cctv:A1', 'austin:cctv:A4']);
  assert.equal(records[0].properties.feed_status, 'unverified');
  assert.equal(records[0].properties.stream_url, null);
  assert.equal(records[1].properties.catalog_url, null);
  assert.equal(records[0].properties.frame_reuse_authorized, false);
});
test('reject invalid bbox and unbounded limits', () => {
  assert.throws(() => normalizeAustinCameraCatalog(payload, { limit: 1000 }), RangeError);
  assert.throws(() => normalizeAustinCameraCatalog(payload, { bbox: [5, 5, -5, -5] }), RangeError);
});

test('reject missing coordinates rather than pinning them to Null Island', () => {
  const records = normalizeAustinCameraCatalog(payload);
  assert.equal(records.some(r => r.external_id === 'austin:cctv:A3'), false);
});
test('provider-neutral registry deduplicates and produces coarse coverage', () => {
  const cameras = normalizeCameraProviders([{ id: 'city', operator: 'City', jurisdiction: 'Test',
    source_url: 'https://example.org/catalog', cameras: [
      { id: 'one', lat: 30.2, lon: -97.7 }, { id: 'one', lat: 30.2, lon: -97.7 },
      { id: 'two', lat: 30.4, lon: -97.8 }, { id: 'invalid', lat: null, lon: null }
    ] }], { bbox: [-98, 30, -97, 31] });
  assert.equal(cameras.length, 2);
  assert.equal(cameras[0].properties.stream_url, null);
  assert.equal(cameraCoverage(cameras)[0].count, 2);
});
