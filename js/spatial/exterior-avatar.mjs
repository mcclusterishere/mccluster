// Original low-poly player/rider glyph; no surveyed objects or external asset service.
export function avatarModel(bike=false){
 const p=[],n=[],colors=[];
 function box(x,y,z,w,h,d,color){
  const v=[[x-w/2,y-h/2,z-d/2],[x+w/2,y-h/2,z-d/2],[x+w/2,y+h/2,z-d/2],[x-w/2,y+h/2,z-d/2],[x-w/2,y-h/2,z+d/2],[x+w/2,y-h/2,z+d/2],[x+w/2,y+h/2,z+d/2],[x-w/2,y+h/2,z+d/2]];
  for(const [ids,normal] of [[[0,3,2,1],[0,0,-1]],[[4,5,6,7],[0,0,1]],[[0,4,7,3],[-1,0,0]],[[1,2,6,5],[1,0,0]],[[3,7,6,2],[0,1,0]],[[0,1,5,4],[0,-1,0]]])for(const i of [0,1,2,0,2,3]){p.push(...v[ids[i]]);n.push(...normal);colors.push(...color);}
 }
 const blue=[.12,.55,.85,1],dark=[.08,.12,.18,1],skin=[.64,.42,.28,1];
 box(0,1.05,0,.48,.62,.27,blue);box(0,1.56,0,.3,.34,.28,skin);
 for(const side of [-1,1]){box(side*.14,.43,bike?.12:0,.17,.75,.2,dark);box(side*.32,1.04,bike?.18:0,.14,.58,.15,blue);}
 if(bike){for(const z of [-.67,.67])for(let i=0;i<16;i++){const a=i*Math.PI/8;box(0,.36+Math.cos(a)*.34,z+Math.sin(a)*.34,.09,.12,.12,dark);}box(0,.65,0,.1,.1,1.2,[.9,.35,.12,1]);box(0,.83,-.15,.28,.1,.3,dark);box(0,1,.65,.65,.08,.08,dark);}
 const arrays=[new Float32Array(p),new Float32Array(n),new Float32Array(colors)],bytes=new Uint8Array(arrays.reduce((sum,a)=>sum+a.byteLength,0));let offset=0;
 const views=arrays.map(a=>{bytes.set(new Uint8Array(a.buffer),offset);const v={buffer:0,byteOffset:offset,byteLength:a.byteLength,target:34962};offset+=a.byteLength;return v;});
 const base64=b=>{let s='';for(const x of b)s+=String.fromCharCode(x);return btoa(s);};
 const min=[0,1,2].map(k=>Math.min(...p.filter((_,i)=>i%3===k))),max=[0,1,2].map(k=>Math.max(...p.filter((_,i)=>i%3===k)));
 const gltf={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,COLOR_0:2},material:0}]}],materials:[{pbrMetallicRoughness:{metallicFactor:0,roughnessFactor:1},doubleSided:true}],buffers:[{uri:'data:application/octet-stream;base64,'+base64(bytes),byteLength:bytes.length}],bufferViews:views,accessors:arrays.map((a,i)=>({bufferView:i,componentType:5126,count:p.length/3,type:i===2?'VEC4':'VEC3',...(i===0?{min,max}:{})}))};
 return 'data:model/gltf+json;base64,'+base64(new TextEncoder().encode(JSON.stringify(gltf)));
}
