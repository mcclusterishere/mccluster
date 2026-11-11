// Pointy axial hexes in world metres (X east, Z south, Y up). No square-cell snapping.
export const DIRECTIONS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
export const axialKey = (q,r) => `${q},${r}`;
export function hexToWorld(q,r,{spacingM,origin={x:0,z:0}}) {
  return {x:origin.x+spacingM*(q+r/2),y:0,z:origin.z+spacingM*Math.sqrt(3)/2*r};
}
export function worldToHex(p,frame) {
  const r=(p.z-frame.origin.z)/(frame.spacingM*Math.sqrt(3)/2),q=(p.x-frame.origin.x)/frame.spacingM-r/2;
  let x=Math.round(q),z=Math.round(r),y=Math.round(-q-r);
  const dx=Math.abs(x-q),dz=Math.abs(z-r),dy=Math.abs(y+q+r);
  if(dx>dy&&dx>dz)x=-y-z;else if(dz>dy)z=-x-y;
  return {q:x||0,r:z||0};
}
export function hexCorners(p,spacingM) {
  return Array.from({length:6},(_,i)=>({x:p.x+spacingM/Math.sqrt(3)*Math.cos(Math.PI/6+i*Math.PI/3),z:p.z+spacingM/Math.sqrt(3)*Math.sin(Math.PI/6+i*Math.PI/3)}));
}
// Exact segment versus an expanded AABB: conservative body clearance at corners.
export function crossesBox(a,b,box,padding=0) {
  let lo=0,hi=1;
  for(const axis of ['x','z']) {
    const d=b[axis]-a[axis],min=box['min'+axis.toUpperCase()]-padding,max=box['max'+axis.toUpperCase()]+padding;
    if(Math.abs(d)<1e-10){if(a[axis]<min||a[axis]>max)return false;continue;}
    const t1=(min-a[axis])/d,t2=(max-a[axis])/d;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));if(lo>hi)return false;
  }
  return true;
}
export function buildHexGraph({bounds,frame,solids,radiusM=.43,regionId='transit-relay-yard'}) {
  if(!Number.isFinite(radiusM)||radiusM<=0||!Number.isFinite(frame.spacingM)||frame.spacingM<=radiusM*2||
    ![frame.origin?.x,frame.origin?.z,bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ].every(Number.isFinite)||
    bounds.minX>=bounds.maxX||bounds.minZ>=bounds.maxZ||!Array.isArray(solids)||
    solids.some(s=>![s.minX,s.maxX,s.minZ,s.maxZ,s.heightM].every(Number.isFinite)||s.minX>s.maxX||s.minZ>s.maxZ||s.heightM<0))throw Error('Invalid hex geometry');
  if((bounds.maxX-bounds.minX)*(bounds.maxZ-bounds.minZ)/(frame.spacingM**2)>4000)throw Error('Hex region exceeds bounded slice budget');
  const clear=(a,b)=>!solids.some(s=>crossesBox(a,b,s,radiusM));
  const nodes=[],index=new Map();
  const corners=[{x:bounds.minX,z:bounds.minZ},{x:bounds.maxX,z:bounds.maxZ},{x:bounds.minX,z:bounds.maxZ},{x:bounds.maxX,z:bounds.minZ}].map(p=>worldToHex(p,frame));
  for(let r=Math.min(...corners.map(p=>p.r))-1;r<=Math.max(...corners.map(p=>p.r))+1;r++)for(let q=Math.min(...corners.map(p=>p.q))-1;q<=Math.max(...corners.map(p=>p.q))+1;q++){
    const position=hexToWorld(q,r,frame);
    if(position.x<bounds.minX+radiusM||position.x>bounds.maxX-radiusM||position.z<bounds.minZ+radiusM||position.z>bounds.maxZ-radiusM||!clear(position,position))continue;
    index.set(axialKey(q,r),nodes.length);nodes.push({id:axialKey(q,r),q,r,position,edges:[]});
  }
  const coverEdges=[];
  nodes.forEach((n,i)=>{
    for(const [dq,dr] of DIRECTIONS){const j=index.get(axialKey(n.q+dq,n.r+dr));if(j!=null&&clear(n.position,nodes[j].position))n.edges.push({to:j,cost:Math.hypot(n.position.x-nodes[j].position.x,n.position.z-nodes[j].position.z)});}
    for(const s of solids){if(s.heightM<.8)continue;const x=Math.max(s.minX,Math.min(s.maxX,n.position.x)),z=Math.max(s.minZ,Math.min(s.maxZ,n.position.z));
      if(Math.hypot(x-n.position.x,z-n.position.z)<=frame.spacingM*.65)coverEdges.push({node:i,type:s.heightM>=1.8?'HIGH':'LOW',bearing:Math.atan2(z-n.position.z,x-n.position.x),halfAngle:Math.PI/3});}
  });
  const ring=s=>[{x:s.minX,z:s.minZ},{x:s.maxX,z:s.minZ},{x:s.maxX,z:s.maxZ},{x:s.minX,z:s.maxZ}];
  return {schema:'prim3.metric-navigation/v1',regionId,revision:1,frameId:'transit-relay-metres.v1',floorId:'yard',topology:'hex',radiusM,sightPolicy:'opaque-footprints',nodes,coverEdges,occluders:solids.filter(s=>s.heightM>=1.8).map(ring),frame,bounds};
}
