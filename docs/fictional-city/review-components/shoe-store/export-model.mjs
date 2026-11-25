/* Build a portable GLB from the same model records used by the city geometry kit.
   Offline/local: THREE180_DIR must point to an already verified Three 0.180 build. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createStoreLayout } from './layout.mjs';
import { buildStoreFloorModel } from './model.mjs';
const here=dirname(fileURLToPath(import.meta.url)), root=resolve(here,'../../../..');
const threePath=process.env.THREE180_DIR;
if(!threePath)throw new Error('THREE180_DIR must point to the verified Three 0.180 build');
const threeUrl=pathToFileURL(resolve(threePath,'three.module.js')).href;
const THREE=await import(threeUrl);if(THREE.REVISION!=='180')throw new Error('Expected Three revision 180');
const source=(await readFile(resolve(root,'js/fictional-city/geometry.mjs'),'utf8')).replace("from 'three'",`from '${threeUrl}'`);
const {createGeometryKit}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const kit=createGeometryKit(),layout=createStoreLayout(), chunks=[],views=[],accessors=[],materials=[],meshes=[],nodes=[],floorNodes=[],records=[];
let offset=0;
function addAccessor(array,type,componentType,extra={}){
 const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength), padded=Buffer.alloc(Math.ceil(bytes.length/4)*4);bytes.copy(padded);chunks.push(padded);
 const view=views.push({buffer:0,byteOffset:offset,byteLength:bytes.length})-1;offset+=padded.length;
 return accessors.push({bufferView:view,componentType,count:array.length/(type==='VEC3'?3:1),type,...extra})-1;
}
for(const floor of layout.floors){
 const group=new THREE.Group(), batch=kit.batch(group);buildStoreFloorModel(layout,floor.id,{batch,detail:'near'});batch.finish();const children=[];
 for(const mesh of group.children){
  if(!mesh.isInstancedMesh)continue;
  const geom=mesh.geometry, p=geom.getAttribute('position'),n=geom.getAttribute('normal'),indices=geom.index, positions=[],normals=[],faces=[];
  const matrix=new THREE.Matrix4(),normalMatrix=new THREE.Matrix3(),v=new THREE.Vector3();
  for(let instance=0;instance<mesh.count;instance++){
   mesh.getMatrixAt(instance,matrix);normalMatrix.getNormalMatrix(matrix);const start=positions.length/3;
   for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(matrix);positions.push(v.x,v.y,v.z);v.fromBufferAttribute(n,i).applyMatrix3(normalMatrix).normalize();normals.push(v.x,v.y,v.z);}
   for(let i=0;i<(indices?indices.count:p.count);i++)faces.push(start+(indices?indices.getX(i):i));
  }
  const mins=[Infinity,Infinity,Infinity],maxs=[-Infinity,-Infinity,-Infinity];for(let i=0;i<positions.length;i++){mins[i%3]=Math.min(mins[i%3],positions[i]);maxs[i%3]=Math.max(maxs[i%3],positions[i]);}
  const color=mesh.material.color.toArray(),material=materials.push({name:floor.id+'-'+mesh.material.color.getHexString(),pbrMetallicRoughness:{baseColorFactor:[...color,1],metallicFactor:.18,roughnessFactor:.7}})-1;
  const prim={attributes:{POSITION:addAccessor(new Float32Array(positions),'VEC3',5126,{min:mins,max:maxs}),NORMAL:addAccessor(new Float32Array(normals),'VEC3',5126)},indices:addAccessor(new Uint32Array(faces),'SCALAR',5125),material,mode:4};
  const mi=meshes.push({name:floor.id+'-'+material,primitives:[prim]})-1;children.push(nodes.push({name:floor.id+'-batch-'+material,mesh:mi})-1);
  records.push({floor:floor.id,color:mesh.material.color.getHexString(),positions,faces});
 }
 floorNodes.push(nodes.push({name:floor.label,translation:[0,floor.elevation,0],children,extras:{floorId:floor.id,elevationMeters:floor.elevation}})-1);kit.clearGroup(group);
}
const bin=Buffer.concat(chunks),gltf={asset:{version:'2.0',generator:'McCluster City authored procedural review component'},scene:0,scenes:[{name:'Retail and factory assembly',nodes:floorNodes},{name:'Retail only',nodes:[floorNodes[0]]},{name:'Factory only',nodes:[floorNodes[1]]}],nodes,meshes,materials,accessors,bufferViews:views,buffers:[{byteLength:bin.length}],extras:{provenance:layout.provenance,modelId:layout.id,version:layout.version,sourceAddressBinding:'pending-region-integration',collectionStatus:'13 owner-approved creative city labels; designs, powers and purchases pending',collection:layout.collection,notProductionIntegrated:true}};
let json=Buffer.from(JSON.stringify(gltf));const padded=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(padded);json=padded;
const head=Buffer.alloc(12);head.writeUInt32LE(0x46546c67,0);head.writeUInt32LE(2,4);head.writeUInt32LE(12+8+json.length+8+bin.length,8);
const jh=Buffer.alloc(8);jh.writeUInt32LE(json.length);jh.writeUInt32LE(0x4e4f534a,4);const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);
const out=resolve(here,'output');await mkdir(out,{recursive:true});await writeFile(resolve(out,'designer-kicks-retail-factory-review.glb'),Buffer.concat([head,jh,json,bh,bin]));await writeFile(resolve(out,'mesh-review.json'),JSON.stringify(records));
await writeFile(resolve(out,'layout.v1.json'),JSON.stringify(layout,null,2)+'\n');
console.log(JSON.stringify({file:'designer-kicks-retail-factory-review.glb',bytes:head.readUInt32LE(8),floors:floorNodes.length,batches:meshes.length,triangles:records.reduce((n,r)=>n+r.faces.length/3,0),revision:THREE.REVISION}));kit.dispose();
