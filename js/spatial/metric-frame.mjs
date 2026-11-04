// Data-contract math only. No game engine, renderer, permissions or save mutation.
const RAD=Math.PI/180, A=6378137, E2=(1/298.257223563)*(2-1/298.257223563);
export function ecef({lon,lat,h=0}) {
  if (![lon,lat,h].every(Number.isFinite)||Math.abs(lat)>90||Math.abs(lon)>180) throw Error('Invalid geodetic coordinate');
  const p=lat*RAD,l=lon*RAD,n=A/Math.sqrt(1-E2*Math.sin(p)**2);
  return [(n+h)*Math.cos(p)*Math.cos(l),(n+h)*Math.cos(p)*Math.sin(l),(n*(1-E2)+h)*Math.sin(p)];
}
export function metricFrame(anchor) {
  const o=ecef(anchor),l=anchor.lon*RAD,p=anchor.lat*RAD,sl=Math.sin(l),cl=Math.cos(l),sp=Math.sin(p),cp=Math.cos(p);
  return {
    toLocal(geo) {const a=ecef(geo).map((v,i)=>v-o[i]);return {x:-sl*a[0]+cl*a[1],y:cp*cl*a[0]+cp*sl*a[1]+sp*a[2],z:sp*cl*a[0]+sp*sl*a[1]-cp*a[2]};},
    toGeo({x,y=0,z}) {
      if(![x,y,z].every(Number.isFinite))throw Error('Invalid metric coordinate');
      const X=o[0]-sl*x+cp*cl*y+sp*cl*z,Y=o[1]+cl*x+cp*sl*y+sp*sl*z,Z=o[2]+sp*y-cp*z;
      const d=Math.hypot(X,Y);let lat=Math.atan2(Z,d*(1-E2)),h=0;
      for(let i=0;i<8;i++){const n=A/Math.sqrt(1-E2*Math.sin(lat)**2);h=d/Math.cos(lat)-n;lat=Math.atan2(Z,d*(1-E2*n/(n+h)));}
      return {lon:Math.atan2(Y,X)/RAD,lat:lat/RAD,h};
    }
  };
}
export function cellCenter(spec,topology,q,r) {
  const t=spec.topologies[topology];if(!t||![q,r].every(Number.isFinite))throw Error('Invalid topology/cell');
  return {x:t.origin.x+(topology==='hex'?t.radiusM*Math.sqrt(3)*(q+r/2):t.sideM*q),y:spec.floor.heightM,z:t.origin.z+(topology==='hex'?1.5*t.radiusM*r:t.sideM*r)};
}
export function localCell(spec,topology,{x,z}) {
  const t=spec.topologies[topology];if(!t||![x,z].every(Number.isFinite))throw Error('Invalid topology/position');
  x-=t.origin.x;z-=t.origin.z;
  if(topology==='square')return {q:Math.round(x/t.sideM),r:Math.round(z/t.sideM)};
  const q=(Math.sqrt(3)/3*x-z/3)/t.radiusM,r=2*z/(3*t.radiusM),s=-q-r;
  let Q=Math.round(q),R=Math.round(r),S=Math.round(s);const dq=Math.abs(Q-q),dr=Math.abs(R-r),ds=Math.abs(S-s);
  if(dq>=dr&&dq>=ds)Q=-R-S;else if(dr>=ds)R=-Q-S;
  return {q:Q,r:R};
}
export const cellId=(floor,topology,q,r)=>`${floor}:${topology}:${q}:${r}`;
export function polygon(spec,topology,q,r){const c=cellCenter(spec,topology,q,r),t=spec.topologies[topology];return topology==='hex'?Array.from({length:6},(_,i)=>({x:c.x+t.radiusM*Math.cos((60*i-30)*RAD),z:c.z+t.radiusM*Math.sin((60*i-30)*RAD)})):[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].map(([x,z])=>({x:c.x+x*t.sideM,z:c.z+z*t.sideM}));}
