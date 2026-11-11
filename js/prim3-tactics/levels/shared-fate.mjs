// PROPOSED fictional client continuity yard. Not Equity Uprise HQ/B1 geometry.
import * as transit from './transit-relay.mjs';
import {buildHexGraph,worldToHex,axialKey,hexCorners} from '../hex-graph.mjs';
const M=transit.TILE_M;
// Metres are authoritative for collision; the same walls are drawn as a roofless
// tactical cutaway. These are fictional client buildings, never HQ geometry.
const box=(id,x1,x2,z1,z2,heightM=3,kind='wall')=>({id,minX:x1*M,maxX:x2*M,minZ:z1*M,maxZ:z2*M,heightM,kind});
export const BUILDINGS=[
 {id:'client-office',name:'Client office',minX:6*M,maxX:10*M,minZ:2*M,maxZ:7*M},
 {id:'equipment-bay',name:'Equipment bay',minX:12*M,maxX:16*M,minZ:9*M,maxZ:12*M}
];
export const ROOMS=[
 {id:'telemetry',name:'O · Telemetry',minX:6.2*M,maxX:9.8*M,minZ:2.2*M,maxZ:4.4*M},
 {id:'service',name:'A · Service access',minX:6.2*M,maxX:9.8*M,minZ:4.6*M,maxZ:6.8*M},
 {id:'bay-aisle',name:'Equipment aisle',minX:12.2*M,maxX:13.8*M,minZ:9.2*M,maxZ:11.8*M},
 {id:'backhaul',name:'R · Backhaul bench',minX:14.2*M,maxX:15.8*M,minZ:9.2*M,maxZ:11.8*M}
];
export const SOLIDS=[
 box('office-west',6,6.2,2,7),box('office-east',9.8,10,2,7),
 box('office-north-west',6,7,2,2.2),box('office-north-east',9,10,2,2.2),
 box('office-south-west',6,7,6.8,7),box('office-south-east',9,10,6.8,7),
 box('office-partition-west',6.2,7.2,4.4,4.6),box('office-partition-east',9,9.8,4.4,4.6),
 box('bay-west-north',12,12.2,9,9.8),box('bay-west-south',12,12.2,11.4,12),
 box('bay-east',15.8,16,9,12),box('bay-south',12,16,11.8,12),
 box('bay-north-west',12,13,9,9.2),box('bay-north-east',15,16,9,9.2),
 box('bay-partition-north',13.8,14,9.2,9.8),box('bay-partition-south',13.8,14,11.4,11.8),
 box('telemetry-desk',6.5,7.1,2.5,3.2,1,'prop'),box('service-desk',9,9.5,5,5.8,1,'prop'),
 box('backhaul-rack',15,15.5,11.1,11.6,2.1,'prop'),
 box('low-service-barrier',5,8,10,10+.6/M,1.1,'prop'),box('patch-cabinet',2,2+1.2/M,11,11+1.2/M,1.5,'prop')
];
export const NAV=buildHexGraph({bounds:{minX:M,maxX:18*M,minZ:M,maxZ:14*M},frame:{spacingM:M,origin:{x:9*M,z:7*M}},solids:SOLIDS,regionId:'shared-fate-client-interiors-v2'});NAV.frameId='shared-fate-client-metres.v2';NAV.floorId='client-ground';NAV.revision=2;NAV.weaponRangeUnitM=M;
export const nearest=(x,y)=>NAV.nodes.reduce((best,n,i)=>Math.hypot(n.position.x-x*M,n.position.z-y*M)<Math.hypot(NAV.nodes[best].position.x-x*M,NAV.nodes[best].position.z-y*M)?i:best,0);
const index=new Map(NAV.nodes.map((n,i)=>[n.id,i]));export const renderCell=i=>({x:NAV.nodes[i].position.x/M,y:NAV.nodes[i].position.z/M,z:0});export function pickCell(x,y){const h=worldToHex({x:x*M,z:y*M},NAV.frame);return index.get(axialKey(h.q,h.r))??null;}
export const EXIT=nearest(3,13),RELAY=nearest(15,10.5),OBSERVE=nearest(8,3),ACCESS=nearest(8,6);
export const inRoom=(node,id)=>{const p=NAV.nodes[node]?.position,r=ROOMS.find(r=>r.id===id);return !!p&&!!r&&p.x>r.minX&&p.x<r.maxX&&p.z>r.minZ&&p.z<r.maxZ;};
export const STATION_LABELS=[{node:OBSERVE,text:'O · Office telemetry'},{node:ACCESS,text:'A · Office service'},{node:RELAY,text:'R · Bay backhaul'},{node:EXIT,text:'X · Outdoor extraction'}].map(l=>({...renderCell(l.node),h:.4,kind:'objective',text:l.text}));
export const LABELS={E1:'Sari · Service lead / Field-E',R1:'Rafael · Field-R',T1:'Minh · Field-T'};
export const LEVEL={...transit,LEVEL_ID:'shared-fate-client-v2',W:20,H:16,FLOORS:1,toDisplay:(x,y)=>({X:x,Y:16-y}),surfaces:()=>[],SCENE:{authoredCutaway:true,canal:null,bridges:[],buildings:[],skybridge:null,stairs:[],containers:[],barricades:[],crates:[],tent:null,fence:null,relay:null,objective:{...renderCell(RELAY),h:1.5},extraction:{...renderCell(EXIT),r:.6},lamps:[{x:3,y:13},{x:15,y:4}],trees:[],rooftop:[],props:[...BUILDINGS.map(b=>({id:b.id+'-floor',kind:'ground',x:(b.minX+b.maxX)/2/M,z:(b.minZ+b.maxZ)/2/M,w:(b.maxX-b.minX)/M,d:(b.maxZ-b.minZ)/M,h:.015,y:-.015})),...SOLIDS.map(s=>({id:s.id,kind:'solid',x:(s.minX+s.maxX)/2/M,z:(s.minZ+s.maxZ)/2/M,w:(s.maxX-s.minX)/M,d:(s.maxZ-s.minZ)/M,h:s.heightM/M,cutawayH:s.kind==='wall'?.9/M:undefined,y:0}))]},hexGrid:{cover:NAV.coverEdges.map(c=>({...c,...renderCell(c.node)})),radius:1/Math.sqrt(3),polygons:NAV.nodes.map(n=>hexCorners(n.position,M).map(p=>({x:p.x/M,y:p.z/M}))),pick:(x,y)=>{const i=pickCell(x,y);return i==null?null:{...renderCell(i),nodeIndex:i};}}};
export function engineConfig(seed=20261111){const base=transit.engineConfig({seed}),spots={E1:[3,13],R1:[5,13],T1:[3,12],H1:[13,3],H2:[15,8]};const roster=base.units.filter(u=>spots[u.id]);const units=roster.map(u=>({...u,x:nearest(...spots[u.id]),y:0,z:0,patrol:[],hp:8,maxHp:8,moveRange:10.62,detectionRadius:30,weaponRange:40,aim:u.faction==='PLAYER'?85:35,weaponDamage:u.faction==='PLAYER'?4:1,ammo:6,magazineSize:6,reserveAmmo:18}));return {width:NAV.nodes.length,height:1,floors:1,seed,clock:38,metricNavigation:NAV,units,extractionRequired:true,nodes:[{...base.nodes[0],at:{x:RELAY,y:0,z:0,range:3.55,roles:['T']}}],technicalTruth:base.technicalTruth,battlefield:{levelId:LEVEL.LEVEL_ID,objectiveTiles:[{id:'RELAY',x:RELAY,y:0,z:0}],extractionZone:{x:EXIT,y:0,z:0,r:0}}};}
