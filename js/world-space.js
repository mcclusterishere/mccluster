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
root.HuSpace=Object.freeze({coordinates,orbitTimes,satelliteModel});
})(typeof window==='undefined'?globalThis:window);
