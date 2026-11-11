// DRAFT gameplay slice of Transit / Relay's authored yard. No new story mission.
import * as transit from './transit-relay.mjs';
import { buildHexGraph, worldToHex, axialKey, hexCorners } from '../hex-graph.mjs';
const M=transit.TILE_M;
// The physical boxes below drive BOTH the opt-in renderer and body clearance.
// Positions/real dimensions are adapted from level3d's existing Transit props.
export function relaySolids() {
  const out=[];
  const box=(id,x,z,w,d,heightM)=>out.push({id,minX:(x-w/2)*M,maxX:(x+w/2)*M,minZ:(z-d/2)*M,maxZ:(z+d/2)*M,heightM});
  for(const c of transit.SCENE.containers){const long=c.w>=c.d;box(c.id,c.x+c.w/2-.5,c.y+c.d/2-.5,Math.min(c.w,(long?12.19:2.44)/M),Math.min(c.d,(long?2.44:12.19)/M),c.h);}
  transit.SCENE.barricades.forEach((b,j)=>{const long=b.w>=b.d;for(let i=0;i<(long?b.w:b.d);i++)box(`barrier-${j}-${i}`,b.x+(long?i:0),b.y+(long?0:i),long?.96:.6/M,long?.6/M:.96,1.1);});
  // A conservative authored crate stack envelope is also the visible geometry in this slice.
  transit.SCENE.crates.forEach((c,j)=>{for(let y=c.y;y<c.y+c.d;y++)for(let x=c.x;x<c.x+c.w;x++)box(`crate-${j}-${x}-${y}`,x,y,1.9/M,1.9/M,1.8);});
  box('relay',transit.SCENE.relay.x,transit.SCENE.relay.y,1.2/M,1.2/M,1.5);
  return out;
}
export const SOLIDS=relaySolids().filter(s=>s.maxX>=22*M&&s.minX<=40*M&&s.maxZ>=22*M&&s.minZ<=39*M);
export const NAV=buildHexGraph({bounds:{minX:22*M,maxX:40*M,minZ:22*M,maxZ:39*M},frame:{spacingM:M,origin:{x:31*M,z:30*M}},solids:SOLIDS});
NAV.weaponRangeUnitM=M; // Same authored aim falloff as Transit: one range unit = 3.54 metres.
const index=new Map(NAV.nodes.map((n,i)=>[n.id,i]));
export const nearest=(x,y)=>NAV.nodes.reduce((best,n,i)=>Math.hypot(n.position.x-x*M,n.position.z-y*M)<Math.hypot(NAV.nodes[best].position.x-x*M,NAV.nodes[best].position.z-y*M)?i:best,0);
export const renderCell=i=>({x:NAV.nodes[i].position.x/M,y:NAV.nodes[i].position.z/M,z:0});
export function pickCell(x,z){const h=worldToHex({x:x*M,z:z*M},NAV.frame);return index.get(axialKey(h.q,h.r))??null;}
export const RELAY=nearest(31,31),EXIT=nearest(31,38);
export const LEVEL={...transit,LEVEL_ID:'transit-relay-hex-v1',surfaces:()=>[],
  SCENE:{...transit.SCENE,containers:[],barricades:[],crates:[],relay:null,objective:transit.SCENE.relay,extraction:{...renderCell(EXIT),r:.6},props:SOLIDS.map(s=>({id:s.id,kind:'solid',x:(s.minX+s.maxX)/2/M,z:(s.minZ+s.maxZ)/2/M,w:(s.maxX-s.minX)/M,d:(s.maxZ-s.minZ)/M,h:s.heightM/M,y:0}))},
  hexGrid:{cover:NAV.coverEdges.map(c=>({...c,...renderCell(c.node)})),radius:1/Math.sqrt(3),polygons:NAV.nodes.map(n=>hexCorners(n.position,M).map(p=>({x:p.x/M,y:p.z/M}))),pick:(x,z)=>{const i=pickCell(x,z);return i==null?null:{...renderCell(i),nodeIndex:i};}}};
export function engineConfig(seed=20261109) {
  const base=transit.engineConfig({seed}),locations={E1:[29,38],R1:[30,38],T1:[32,38],H1:[37,28],H2:[24,31]};
  const units=base.units.filter(u=>locations[u.id]).map(u=>({...u,x:nearest(...locations[u.id]),y:0,z:0,patrol:[],moveRange:u.faction==='PLAYER'?10.62:7.08,detectionRadius:30,weaponRange:35,aim:u.faction==='PLAYER'?u.aim+10:58,ammo:4,magazineSize:4,reserveAmmo:12,weaponDamage:u.faction==='PLAYER'?u.weaponDamage:2}));
  return {width:NAV.nodes.length,height:1,floors:1,seed,clock:14,metricNavigation:NAV,units,extractionRequired:true,
    nodes:[{...base.nodes[0],at:{x:RELAY,y:0,z:0,range:3.55,roles:['T']}}],technicalTruth:{nodes:{RELAY:base.technicalTruth.nodes.RELAY}},
    battlefield:{levelId:'transit-relay-hex-v1',objectiveTiles:[{id:'RELAY',x:RELAY,y:0,z:0}],extractionZone:{x:EXIT,y:0,z:0,r:0}}};
}
