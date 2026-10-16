import test from 'node:test';
import assert from 'node:assert/strict';
import '../../js/world-space.js';
const {coordinates,orbitTimes,satelliteModel}=globalThis.HuSpace;
test('space locations accept actual zero coordinates and reject missing/nonphysical positions',()=>{
 assert.equal(coordinates(0,0),true);for(const p of [[null,0],[0,null],['1',2],[181,0],[0,91],[NaN,0]])assert.equal(coordinates(...p),false);
});
test('orbit sampling spans one supplied period at bounded resolution, never invents a missing orbit',()=>{
 const times=orbitTimes({no:2*Math.PI/92},1000000);assert.equal(times.length,97);assert.equal(+times[0],1000000);assert.equal(+times.at(-1)-times[0],92*60000);
 for(const no of [null,0,-1,NaN,Infinity,1e-8])assert.deepEqual(orbitTimes({no}),[]);
});
test('schematic glTF has complete finite geometry and self-contained buffers',()=>{
 const uri=satelliteModel();assert.equal(uri,satelliteModel());
 const gltf=JSON.parse(atob(uri.split(',')[1]));assert.equal(gltf.asset.version,'2.0');
 const bytes=Buffer.from(gltf.buffers[0].uri.split(',')[1],'base64');assert.equal(bytes.length,gltf.buffers[0].byteLength);
 for(const a of gltf.accessors){const v=gltf.bufferViews[a.bufferView];assert.ok(a.byteOffset+a.count*12<=v.byteLength);const data=new Float32Array(bytes.buffer,bytes.byteOffset+v.byteOffset+a.byteOffset,a.count*3);assert.ok([...data].every(Number.isFinite));}
 assert.equal(gltf.meshes[0].primitives.length,3);
});
