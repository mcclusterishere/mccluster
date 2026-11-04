import fs from 'node:fs';
import crypto from 'node:crypto';
import {metricFrame,cellCenter,cellId} from '../../js/spatial/metric-frame.mjs';
import {walkable,clearEdge,closestNode,route} from '../../js/spatial/region-graph.mjs';
const source='core/data/spatial/bridgeport-golden-hill.v1.json',contract=JSON.parse(fs.readFileSync(source)),frame=metricFrame(contract.frame.anchor);
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const roadsSource=JSON.parse(fs.readFileSync(contract.sources.roads.path)),buildingsSource=JSON.parse(fs.readFileSync(contract.sources.buildings.path));
const local=p=>frame.toLocal({lon:p[0],lat:p[1],h:0});
const region={contract,provenance:{contractSha256:hash(source),roadsSha256:hash(contract.sources.roads.path),buildingsSha256:hash(contract.sources.buildings.path)},roads:roadsSource.features.filter(f=>contract.sources.roads.ids.includes(String(f.id))).map(f=>({id:String(f.id),name:f.properties.name,points:f.geometry.coordinates.map(local),coordinates:f.geometry.coordinates})),buildings:buildingsSource.features.map(f=>({id:String(f.id),rings:f.geometry.coordinates.map(r=>r.map(local)),coordinates:f.geometry.coordinates,name:f.id===279819?contract.sources.buildings.name:'CT source footprint '+f.id})),graphs:{}};
for(const topology of ['hex','square']){
  const nodes=[];
  for(let q=-100;q<=100;q++)for(let r=-100;r<=100;r++){const position=cellCenter(contract,topology,q,r);if(walkable(region,position,contract.occupancy.edgeSampleMaxM/2))nodes.push({id:cellId(contract.floor.id,topology,q,r),q,r,position,edges:[]});}
  if(nodes.length>contract.gating.maxNodesPerTopology)throw Error('Node budget');
  const lookup=new Map(nodes.map(n=>[`${n.q},${n.r}`,n]));
  for(const n of nodes)for(const [dq,dr] of contract.topologies[topology].neighbors){const other=lookup.get(`${n.q+dq},${n.r+dr}`);if(other&&clearEdge(region,n.position,other.position))n.edges.push({to:other.id,costM:Math.hypot(other.position.x-n.position.x,other.position.z-n.position.z)});}
  region.graphs[topology]={nodes};
  const entry=closestNode(region,topology,frame.toLocal(contract.entry)),destination=closestNode(region,topology,frame.toLocal(contract.destination));
  if(!entry||!destination)throw Error('Missing approach');
  Object.assign(region.graphs[topology],{entryId:entry.id,destinationId:destination.id});
  if(!route(region,topology,entry.position,destination.id))throw Error('Disconnected route');
}
const output=JSON.stringify(region);if(Buffer.byteLength(output)>contract.gating.maxAssetBytes)throw Error('Asset budget');
const dest='data/spatial/bridgeport-golden-hill.v1.json';
if(process.argv.includes('--check')){if(fs.readFileSync(dest,'utf8')!==output+'\n')throw Error('Generated spatial data stale');}else fs.writeFileSync(dest,output+'\n');
console.log(JSON.stringify({bytes:Buffer.byteLength(output),graphs:Object.fromEntries(Object.entries(region.graphs).map(([k,g])=>[k,{nodes:g.nodes.length,edges:g.nodes.reduce((n,x)=>n+x.edges.length,0),pathM:route(region,k,g.nodes.find(n=>n.id===g.entryId).position,g.destinationId).costM}]))},null,2));
