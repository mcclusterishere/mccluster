// Engine adapter for an already validated, single-surface metric graph. Geography remains
// the caller's authority. Cell x is an opaque node index, never a metre or axial coordinate.
export function normalizeMetricNavigation(input) {
  const n = structuredClone(input);
  if (n?.schema !== 'prim3.metric-navigation/v1' || !n.regionId || !n.frameId || !n.floorId ||
      !Number.isInteger(n.revision) || n.revision < 1 || !['hex', 'square'].includes(n.topology) ||
      !Array.isArray(n.nodes) || !n.nodes.length || n.nodes.length > 5000 ||
      !Array.isArray(n.occluders) || n.sightPolicy !== 'opaque-footprints' ||
      !Number.isFinite(n.radiusM) || n.radiusM <= 0) throw new Error('Invalid metric navigation');
  if (n.weaponRangeUnitM != null && (!Number.isFinite(n.weaponRangeUnitM) || n.weaponRangeUnitM <= 0)) throw new Error('Invalid metric weapon scale');
  const ids = new Set();
  for (const node of n.nodes) {
    if (typeof node.id !== 'string' || ids.has(node.id) || !node.position ||
        ![node.position.x, node.position.y, node.position.z].every(Number.isFinite) ||
        node.position.y !== 0 || !Array.isArray(node.edges)) throw new Error('Invalid metric node');
    ids.add(node.id);
  }
  for (let i = 0; i < n.nodes.length; i++) for (const e of n.nodes[i].edges) {
    const b = n.nodes[e.to];
    if (!Number.isInteger(e.to) || !b || e.to === i || !Number.isFinite(e.cost) || e.cost <= 0 ||
        Math.abs(e.cost - Math.hypot(n.nodes[i].position.x - b.position.x, n.nodes[i].position.z - b.position.z)) > 1e-7) throw new Error('Invalid metric edge');
  }
  for (const ring of n.occluders) if (!Array.isArray(ring) || ring.length < 3 ||
    ring.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) throw new Error('Invalid sight footprint');
  if (n.coverEdges != null) {
    if (!Array.isArray(n.coverEdges)) throw new Error('Invalid metric cover');
    for (const c of n.coverEdges) if (!Number.isInteger(c.node) || !n.nodes[c.node] ||
        !['LOW', 'HIGH'].includes(c.type) || !Number.isFinite(c.bearing) ||
        !Number.isFinite(c.halfAngle) || c.halfAngle <= 0 || c.halfAngle > Math.PI / 2)
      throw new Error('Invalid metric cover');
  }
  const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
  return freeze(n);
}
export function metricPoint(state, cell) {
  return cell?.y === 0 && Number(cell.z || 0) === 0 && Number.isInteger(cell.x)
    ? state.metricNavigation?.nodes[cell.x]?.position : undefined;
}
export function metricDistance(state, a, b) {
  const p = metricPoint(state, a), q = metricPoint(state, b);
  return p && q ? Math.hypot(p.x - q.x, p.z - q.z) : Infinity;
}
function cross(a, b, c) { return (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x); }
function on(a,b,p) { return Math.abs(cross(a,b,p)) < 1e-8 && p.x >= Math.min(a.x,b.x)-1e-8 && p.x <= Math.max(a.x,b.x)+1e-8 && p.z >= Math.min(a.z,b.z)-1e-8 && p.z <= Math.max(a.z,b.z)+1e-8; }
function intersects(a,b,c,d) {
  return on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b)||
    (cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0);
}
function inside(p, ring) {
  let yes=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if(on(a,b,p)) return true;
    if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x) yes=!yes;
  }
  return yes;
}
export function metricSight(state, a, b) {
  const p=metricPoint(state,a),q=metricPoint(state,b);
  return Boolean(p&&q&&!state.metricNavigation.occluders.some(ring => inside(p,ring)||inside(q,ring)||
    ring.some((v,i)=>intersects(p,q,v,ring[(i+1)%ring.length]))));
}
export function metricEdge(state,a,b) {
  if(!metricPoint(state,a)||!metricPoint(state,b)) return null;
  return state.metricNavigation.nodes[a.x].edges.find(e=>e.to===b.x) || null;
}
export function metricOccupant(state,a,b,occupants,exceptId) {
  const p=metricPoint(state,a),q=metricPoint(state,b); if(!p||!q)return null;
  return occupants.find(u=>{
    if(u.id===exceptId||u.dead||u.statuses?.includes('EXTRACTED'))return false;
    const v=metricPoint(state,u); if(!v)return false;
    const dx=q.x-p.x,dz=q.z-p.z,l=dx*dx+dz*dz;
    const t=l?Math.max(0,Math.min(1,((v.x-p.x)*dx+(v.z-p.z)*dz)/l)):0;
    return Math.hypot(v.x-p.x-t*dx,v.z-p.z-t*dz)<2*state.metricNavigation.radiusM;
  })||null;
}
export function metricReach(state,start,maxCost,{occupants,exceptId,stopAt},geo) {
  const startKey=start.x,cost=new Map([[startKey,0]]),prev=new Map(),open=new Set([startKey]);
  while(open.size) {
    const k=[...open].sort((a,b)=>cost.get(a)-cost.get(b)||a-b)[0];open.delete(k);
    if(k===stopAt)break;
    for(const edge of state.metricNavigation.nodes[k].edges) {
      const to={x:edge.to,y:0,z:0},from={x:k,y:0,z:0},nd=cost.get(k)+edge.cost;
      if(nd>maxCost+1e-7||!geo.walkable(to.x,0,0)||metricOccupant(state,from,to,occupants,exceptId))continue;
      if(nd<(cost.get(edge.to)??Infinity)) {cost.set(edge.to,nd);prev.set(edge.to,{from:k,linkId:null});open.add(edge.to);}
    }
  }
  return {cost,prev,geo,startKey};
}

// Bearings are world X/Z radians, never the opaque node index. Cover protects a
// wedge towards a physical obstacle; moving around that wedge exposes a flank.
export function metricCover(state, target, attacker) {
  const p = metricPoint(state, target), a = metricPoint(state, attacker);
  const edges = (state.metricNavigation.coverEdges || []).filter(c => c.node === target.x);
  if (!p || !a || !edges.length) return { type: 'NONE', bonus: 0, flanked: false };
  const bearing = Math.atan2(a.z - p.z, a.x - p.x);
  const protectedEdges = edges.filter(c => Math.abs(Math.atan2(Math.sin(bearing - c.bearing), Math.cos(bearing - c.bearing))) <= c.halfAngle);
  const type = protectedEdges.some(c => c.type === 'HIGH') ? 'HIGH' : protectedEdges.length ? 'LOW' : 'NONE';
  return { type, bonus: type === 'HIGH' ? 40 : type === 'LOW' ? 20 : 0, flanked: type === 'NONE' };
}
