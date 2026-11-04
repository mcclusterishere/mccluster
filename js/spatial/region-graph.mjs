// Shared data contract validation/path reference, not a tactical rules engine.
export const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function segmentDistance(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/l)):0;return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);}
function inside(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)yes=!yes;}return yes;}
export function walkable(region,p,margin=0){
  if(!p||![p.x,p.z].every(Number.isFinite))return false;
  const s=region.contract,b=s.bounds,r=s.actor.radiusM+margin;
  if(p.x<b.minX+r||p.x>b.maxX-r||p.z<b.minZ+r||p.z>b.maxZ-r)return false;
  if(!region.roads.some(road=>road.points.slice(1).some((v,i)=>segmentDistance(p,road.points[i],v)<=s.occupancy.roadHalfWidthM-r)))return false;
  return !region.buildings.some(b=>inside(p,b.rings[0])||b.rings.some(ring=>ring.some((v,i)=>segmentDistance(p,v,ring[(i+1)%ring.length])<r)));
}
export function clearEdge(region,a,b){const step=region.contract.occupancy.edgeSampleMaxM,n=Math.max(1,Math.ceil(distance(a,b)/step));for(let i=0;i<=n;i++)if(!walkable(region,{x:a.x+(b.x-a.x)*i/n,z:a.z+(b.z-a.z)*i/n},step/2))return false;return true;}
export function closestNode(region,topology,p){return region.graphs[topology].nodes.filter(n=>clearEdge(region,p,n.position)).sort((a,b)=>distance(p,a.position)-distance(p,b.position)||a.id.localeCompare(b.id))[0]||null;}
export function route(region,topology,position,targetId){
  const graph=region.graphs[topology],start=closestNode(region,topology,position),nodes=new Map(graph.nodes.map(n=>[n.id,n]));if(!start||!nodes.has(targetId))return null;
  const costs=new Map([[start.id,0]]),prev=new Map(),open=new Set([start.id]);
  while(open.size){const id=[...open].sort((a,b)=>costs.get(a)-costs.get(b)||a.localeCompare(b))[0];open.delete(id);if(id===targetId)break;
    for(const e of nodes.get(id).edges){const cost=costs.get(id)+e.costM;if(cost<(costs.get(e.to)??Infinity)){costs.set(e.to,cost);prev.set(e.to,id);open.add(e.to);}}
  }
  if(!costs.has(targetId))return null;const ids=[targetId];while(ids[0]!==start.id){const p=prev.get(ids[0]);if(!p)return null;ids.unshift(p);}
  return {ids,points:[position,...ids.map(id=>nodes.get(id).position)],costM:distance(position,start.position)+costs.get(targetId),floorId:region.contract.floor.id};
}
export function restorePosition(region,value){const c=region.contract;return value?.schema===c.state.schema&&value.regionId===c.id&&value.revision===c.revision&&value.frameId===c.frame.id&&value.floorId===c.floor.id&&['hex','square'].includes(value.topology)&&value.position?.y===c.floor.heightM&&walkable(region,value.position)?value:null;}
