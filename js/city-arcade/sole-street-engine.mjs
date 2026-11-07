import {SOLE_MISSION,STREET_STOPS,validateSoleMission} from './sole-config.mjs';
export {SOLE_MISSION,STREET_STOPS,validateSoleMission} from './sole-config.mjs';
const key=p=>p.join(',');
export function roadGraph(neighborhood,closed=[]){
 const nodes=new Map(),edges=[];
 for(const road of neighborhood.roads){if(closed.includes(road.id))continue;
  for(let i=1;i<road.points.length;i++){
   const a=road.points[i-1],b=road.points[i],ka=key(a),kb=key(b),distance=Math.hypot(b[0]-a[0],b[1]-a[1]);
   for(const [k,p]of [[ka,a],[kb,b]])if(!nodes.has(k))nodes.set(k,{point:p,links:[]});
   nodes.get(ka).links.push({id:kb,distance});nodes.get(kb).links.push({id:ka,distance});edges.push({a,b,width:road.width,id:road.id});
  }
 }
 return {nodes,edges};
}
export function nearestNode(graph,p){return [...graph.nodes.keys()].sort((a,b)=>Math.hypot(...graph.nodes.get(a).point.map((v,i)=>v-p[i]))-Math.hypot(...graph.nodes.get(b).point.map((v,i)=>v-p[i])))[0];}
export function streetPath(graph,from,to){
 const start=nearestNode(graph,from),end=graph.nodes.has(key(to))?key(to):null;if(!start||!end)return [];
 const costs=new Map([[start,0]]),previous=new Map(),open=new Set([start]);
 while(open.size){const current=[...open].sort((a,b)=>costs.get(a)-costs.get(b))[0];open.delete(current);if(current===end){const out=[];let p=end;while(p){out.unshift(graph.nodes.get(p).point);p=previous.get(p);}return out;}
  for(const e of graph.nodes.get(current).links){const cost=costs.get(current)+e.distance;if(cost<(costs.get(e.id)??Infinity)){costs.set(e.id,cost);previous.set(e.id,current);open.add(e.id);}}
 }return [];
}
function segmentDistance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
export function newStreetRun(config,neighborhood,spawn){
 config=validateSoleMission(config);
 for(const p of STREET_STOPS)if(!neighborhood.roads.some(r=>r.id===p.roadId&&r.points.some(pt=>key(pt)===key(p.point))))throw Error('Shared road checkpoint changed');
 if(config.blockedRoads.some(id=>!neighborhood.roads.some(r=>r.id===id)))throw Error('Unknown road closure');
 const graph=roadGraph(neighborhood,config.blockedRoads);if(!graph.nodes.has(key(spawn)))throw Error('Entrance is blocked');const points=[spawn,...config.route.map(id=>STREET_STOPS.find(p=>p.id===id).point),spawn];
 for(let i=1;i<points.length;i++)if(!streetPath(graph,points[i-1],points[i]).length)throw Error('Closed roads leave a checkpoint unreachable');
 return {config,player:[...spawn],spawn:[...spawn],remaining:config.duration,index:0,score:0,status:'ready',encounters:{},message:'Follow the glowing route to Robbery 1s.'};
}
export function targetPoint(s){return s.index<4?STREET_STOPS.find(p=>p.id===s.config.route[s.index]).point:s.spawn;}
export function stepStreet(s,input,dt,graph){
 if(s.status!=='playing')return s;dt=Math.max(0,Math.min(Number.isFinite(dt)?dt:0,.05));
 const n={...s,player:[...s.player],remaining:Math.max(0,s.remaining-dt)};
 if(n.remaining===0)return {...n,status:'failed',message:'Time is up. Return to the map or try again.'};
 const dx=Math.sign(input.x||0),dy=Math.sign(input.y||0),len=Math.hypot(dx,dy)||1;
 const next=[n.player[0]+dx/len*n.config.speed*dt,n.player[1]+dy/len*n.config.speed*dt];
 const candidates=[next,[n.player[0],next[1]],[next[0],n.player[1]]];
 const allowed=candidates.find(p=>graph.edges.some(e=>segmentDistance(p,e.a,e.b)<=e.width/2+1));
 if(allowed)n.player=allowed;
 else if(dx||dy)n.message='Street edge. Follow the glowing legal route around the block.';
 if(Math.hypot(...targetPoint(n).map((v,i)=>v-n.player[i]))<3.5){
  if(n.index<4){n.index++;n.score+=n.config.reward;n.message=n.index===4?'All four pairs collected. Follow the glow back to your entrance.':'Pair collected. Next checkpoint is glowing.';}
  else{n.status='won';n.message='Collection complete. Your entrance is right here.';}
 }
 return n;
}
export function encounterAction(s,id,action,clue){
 if(s.status!=='playing')return s;const e=s.config.encounters.find(e=>e.id===id);if(!e)return s;
 const point=STREET_STOPS.find(p=>p.id===e.stopId).point;if(Math.hypot(...point.map((v,i)=>v-s.player[i]))>12)return {...s,message:'Move closer to the optional fashion decoy.'};
 const current=s.encounters[id]||'new',n={...s,encounters:{...s.encounters}};
 if(action==='inspect'&&current==='new'){n.encounters[id]='inspected';n.message='Look at the shoes. Which clue actually proves the mismatch?';}
 else if(action==='identify'&&current==='inspected'){
  if(clue===e.evidence){n.encounters[id]='identified';n.message='Mismatch confirmed. The stage-prop shoes can be confiscated.';}
  else{n.encounters[id]='dismissed';n.remaining=Math.max(0,n.remaining-e.penaltySeconds);n.message='Wrong clue. Time penalty; the decoy walks away. Return to your main route.';}
 }else if(action==='confiscate'&&current==='identified'){n.encounters[id]='confiscated';n.message='Prop shoes confiscated for the skit. Record your roast to finish.';}
 else if(action==='roast'&&current==='confiscated'){n.encounters[id]='done';n.score+=e.reward;n.message='On-camera skit: '+e.roast+' Back to the glowing shoe route.';}
 return n;
}
