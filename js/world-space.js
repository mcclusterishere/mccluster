/* Original, generic schematic geometry. No vendor/mission likeness or measured
   spacecraft attitude is implied. Orbit positions come only from supplied TLEs. */
(function(root){'use strict';
function coordinates(lon,lat){return typeof lon==='number'&&typeof lat==='number'&&Number.isFinite(lon)&&Number.isFinite(lat)&&Math.abs(lon)<=180&&Math.abs(lat)<=90}
function orbitTimes(rec,now=Date.now()){
 const motion=rec&&rec.no;if(typeof motion!=='number'||!Number.isFinite(motion)||motion<=0)return [];
 const minutes=2*Math.PI/motion;if(minutes<60||minutes>1800)return [];
 return Array.from({length:97},(_,i)=>new Date(now+i*minutes*60000/96));
}
let cached;
function satelliteModel(){
 if(cached)return cached;
 const positions=[],normals=[];
 // glTF uses Y-up; the solar panels span X. Dimensions are schematic metres.
 function box(cx,cy,cz,x,y,z){
  const v=[[-x,-y,-z],[x,-y,-z],[x,y,-z],[-x,y,-z],[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]].map(p=>[p[0]+cx,p[1]+cy,p[2]+cz]);
  for(const [ids,n] of [[[0,3,2,1],[0,0,-1]],[[4,5,6,7],[0,0,1]],[[0,4,7,3],[-1,0,0]],[[1,2,6,5],[1,0,0]],[[0,1,5,4],[0,-1,0]],[[3,7,6,2],[0,1,0]]]){
   for(const i of [0,1,2,0,2,3]){positions.push(...v[ids[i]]);normals.push(...n)}
  }
 }
 box(0,0,0,1.5,1.2,1);const bodyCount=positions.length/3;
 box(-6,0,0,3.5,.08,2);box(6,0,0,3.5,.08,2);const panelsCount=positions.length/3-bodyCount;
 box(0,2,0,.08,1,.08);
 const array=new Float32Array([...positions,...normals]),bytes=new Uint8Array(array.buffer);
 let binary='';for(const b of bytes)binary+=String.fromCharCode(b);
 const count=positions.length/3;
 const gltf={asset:{version:'2.0',generator:'McCluster generic satellite schematic'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],
  buffers:[{uri:'data:application/octet-stream;base64,'+btoa(binary),byteLength:bytes.length}],
  bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.length*4,target:34962},{buffer:0,byteOffset:positions.length*4,byteLength:normals.length*4,target:34962}],
  accessors:[],materials:[{pbrMetallicRoughness:{baseColorFactor:[.85,.73,.44,1],metallicFactor:.55,roughnessFactor:.45}},{pbrMetallicRoughness:{baseColorFactor:[.06,.24,.52,1],metallicFactor:.35,roughnessFactor:.55}}],meshes:[{primitives:[]}]};
 for(const [start,n,material] of [[0,bodyCount,0],[bodyCount,panelsCount,1],[bodyCount+panelsCount,count-bodyCount-panelsCount,0]]){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=start;i<start+n;i++)for(let j=0;j<3;j++){min[j]=Math.min(min[j],positions[i*3+j]);max[j]=Math.max(max[j],positions[i*3+j])}
  const a=gltf.accessors.length;gltf.accessors.push({bufferView:0,byteOffset:start*12,componentType:5126,count:n,type:'VEC3',min,max},{bufferView:1,byteOffset:start*12,componentType:5126,count:n,type:'VEC3'});
  gltf.meshes[0].primitives.push({attributes:{POSITION:a,NORMAL:a+1},material});
 }
 cached='data:model/gltf+json;base64,'+btoa(JSON.stringify(gltf));return cached;
}
let rocketCached;
function rocketModel(){
 if(rocketCached)return rocketCached;
 const p=[],n=[];const triangle=(vertices,normals)=>{p.push(...vertices.flat());n.push(...normals.flat())};
 for(let i=0;i<24;i++){
  const a=i*2*Math.PI/24,b=(i+1)*2*Math.PI/24,A=[Math.cos(a),0,Math.sin(a)],B=[Math.cos(b),0,Math.sin(b)],C=[B[0],14,B[2]],D=[A[0],14,A[2]],na=[A[0],0,A[2]],nb=[B[0],0,B[2]];
  triangle([A,D,C],[na,na,nb]);triangle([A,C,B],[na,nb,nb]);
  const slope=1/3,normal=v=>[v[0]/Math.hypot(1,slope),slope/Math.hypot(1,slope),v[2]/Math.hypot(1,slope)];
  triangle([D,[0,17,0],C],[normal(A),normal([(A[0]+B[0])/2,0,(A[2]+B[2])/2]),normal(B)]);
  triangle([[0,0,0],A,B],[[0,-1,0],[0,-1,0],[0,-1,0]]);
 }
 for(let i=0;i<4;i++){const a=i*Math.PI/2,x=Math.cos(a),z=Math.sin(a),normal=[-z,0,x];triangle([[x,0,z],[3*x,0,3*z],[x,4,z]],[normal,normal,normal])}
 const floats=new Float32Array([...p,...n]);let binary='';for(const b of new Uint8Array(floats.buffer))binary+=String.fromCharCode(b);
 const gltf={asset:{version:'2.0',generator:'McCluster generic launch vehicle schematic'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],buffers:[{uri:'data:application/octet-stream;base64,'+btoa(binary),byteLength:floats.byteLength}],bufferViews:[{buffer:0,byteLength:p.length*4},{buffer:0,byteOffset:p.length*4,byteLength:n.length*4}],accessors:[{bufferView:0,componentType:5126,count:p.length/3,type:'VEC3',min:[-3,0,-3],max:[3,17,3]},{bufferView:1,componentType:5126,count:n.length/3,type:'VEC3'}],materials:[{doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[.92,.92,.95,1],metallicFactor:.3,roughnessFactor:.5}}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},material:0}]}]};
 rocketCached='data:model/gltf+json;base64,'+btoa(JSON.stringify(gltf));return rocketCached;
}
root.HuSpace=Object.freeze({coordinates,orbitTimes,satelliteModel,rocketModel});
})(typeof window==='undefined'?globalThis:window);
