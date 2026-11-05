// Structural validator for the exported review artifact; not a substitute for
// Khronos validation, Blender import, browser rendering, or device measurements.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const file = new URL('./output/designer-kicks-retail-factory-review.glb', import.meta.url);
const bytes = await readFile(file);
assert.equal(bytes.readUInt32LE(0), 0x46546c67);
assert.equal(bytes.readUInt32LE(4), 2);
assert.equal(bytes.readUInt32LE(8), bytes.length);
const jsonLength = bytes.readUInt32LE(12);
assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength));
const binHeader = 20 + jsonLength;
assert.equal(bytes.readUInt32LE(binHeader + 4), 0x004e4942);
const binary = bytes.subarray(binHeader + 8);
assert.equal(bytes.readUInt32LE(binHeader), binary.length);
assert.equal(gltf.buffers.length, 1); assert.equal(gltf.buffers[0].byteLength, binary.length);
assert.equal(gltf.buffers[0].uri, undefined); assert.equal(gltf.images, undefined);
for (const view of gltf.bufferViews) {
  assert.equal(view.buffer, 0); assert.equal((view.byteOffset || 0) % 4, 0);
  assert.ok((view.byteOffset || 0) + view.byteLength <= binary.length);
}
function values(index) {
  const accessor = gltf.accessors[index], view = gltf.bufferViews[accessor.bufferView];
  const components = accessor.type === 'VEC3' ? 3 : 1;
  assert.ok([5126, 5125].includes(accessor.componentType));
  assert.ok(accessor.count * components * 4 <= view.byteLength);
  const result = [];
  for (let i = 0; i < accessor.count * components; i++) {
    const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0) + i * 4;
    const value = accessor.componentType === 5126 ? binary.readFloatLE(offset) : binary.readUInt32LE(offset);
    assert.ok(Number.isFinite(value)); result.push(value);
  }
  return result;
}
let triangles = 0;
for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
  assert.equal(primitive.mode, 4);
  const p = values(primitive.attributes.POSITION), n = values(primitive.attributes.NORMAL), indices = values(primitive.indices);
  assert.equal(p.length, n.length); assert.equal(indices.length % 3, 0);
  for (const index of indices) assert.ok(index < p.length / 3);
  triangles += indices.length / 3;
}
assert.equal(gltf.scenes.length, 3);
assert.equal(gltf.scenes[0].nodes.length, 2);
assert.equal(gltf.extras.notProductionIntegrated, true);
assert.equal(gltf.extras.collection.length, 13);
assert.equal(gltf.extras.collection[10].name, 'Repo Elevens');
for (const slot of gltf.extras.collection) assert.equal(slot.purchasable, false);
const report = {
  file: 'designer-kicks-retail-factory-review.glb', bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  floors: 2, batches: gltf.meshes.length, triangles,
  finitePositionsNormals: true, indicesInBounds: true, selfContained: true,
  structuralValidation: 'custom bounds and consistency checks only; Khronos validator not run',
  browserQA: 'blocked: Chromium process singleton socket Operation not permitted',
  blenderImport: 'not run', devicePerformance: 'not measured',
  render: 'deterministic CPU mesh views; not browser evidence'
};
await writeFile(new URL('./output/validation.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
