// The Level Forge's document model (prim3-level-builder/model.js), its UMD wrapper adapted to an ES module.
// Structural checks only: playability is js/prim3-tactics/levels/forge.mjs (the game's export + resolver).
// scripts/test/prim3-forge-level.test.mjs holds this body equal to the editor's.
export function createLevelModel(initialCatalog) {
  'use strict';
  const catalog = { assets: [] }, index = new Map();
  const clone = x => JSON.parse(JSON.stringify(x));
  const key = p => `${p.x},${p.y},${p.layer || 0}`;
  const uid = () => 'obj-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2, 9));
  const isRecord = x => !!x && typeof x === 'object' && !Array.isArray(x);
  const finite = (x, a, b) => typeof x === 'number' && Number.isFinite(x) && x >= a && x <= b;
  const integer = (x, a, b) => finite(x, a, b) && Number.isInteger(x);
  const idOK = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(x);
  const nominal = {
    'concrete-tile-8':[8,8], 'soil-tile-8':[8,8], 'grass-tile-8':[8,8], 'water-tile-16':[16,8],
    'warehouse-16':[16,12], 'tower-8':[8,8], 'wall-8':[8,1], 'low-barrier-4':[4,1],
    'high-cover-4':[4,2], 'container-12':[12,4], 'crate-2':[2,2], 'bridge-16':[16,6],
    'stairs-8':[4,8], 'catwalk-8':[8,4], 'ladder-8':[2,1], 'pipe-stack-6':[3,6],
    'hvac-3':[3,3], 'relay-terminal':[2,2], 'gate-8':[8,1], 'fence-8':[8,1],
    'tree-8':[6,6], 'rock-cluster':[4,3], 'spawn-marker':[3,3], 'extraction-marker':[5,5]
  };
  function setCatalog(value) {
    if (!value || !Array.isArray(value.assets)) throw new Error('The asset catalog is missing.');
    Object.assign(catalog, value); index.clear();
    for (const asset of catalog.assets) index.set(asset.id, asset);
    return catalog;
  }
  if (initialCatalog) setCatalog(initialCatalog);
  function assetFor(id) { return index.get(id); }
  function boundsFor(object) {
    const a = assetFor(object.assetId), fallback = nominal[object.assetId] || [2,2];
    const fp = a?.footprint || {width:fallback[0],depth:fallback[1]}, s = object.scale ?? 1;
    let w = Math.max(1, Math.ceil(fp.width * s - .00001)), d = Math.max(1, Math.ceil(fp.depth * s - .00001));
    if ((object.rotation || 0) % 180) [w,d] = [d,w];
    return {x:object.x,y:object.y,w,d,elevation:object.elevation || 0,h:(a?.height || 1) * s};
  }
  function newObject(assetId,x,y) { return {id:uid(),assetId,x:Math.round(x),y:Math.round(y),rotation:0,elevation:0,scale:1}; }
  function createBlank() {
    return {schemaVersion:1,id:'level-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36)),title:'Untitled operation',
      bounds:{minX:-64,maxX:63,minY:-64,maxY:63},objects:[],
      spawns:[{id:'E',role:'E',team:'player',x:-20,y:-36,layer:0},{id:'R',role:'R',team:'player',x:-16,y:-40,layer:0},{id:'T',role:'T',team:'player',x:-24,y:-40,layer:0}],
      objective:{type:'relay',x:0,y:0},extraction:{x:-20,y:-40,radius:8},connections:[],
      metadata:{theme:'white-industrial',description:'',tags:[]}};
  }
  function createStarter() {
    const d = createBlank(); d.title = 'Whitewater / Relay';
    const put=(assetId,x,y,extra={})=>{const o={...newObject(assetId,x,y),...extra};d.objects.push(o);return o;};
    for(let x=-64;x<64;x+=16)put('water-tile-16',x,-24);
    for(const x of [-28,-2,30])put('bridge-16',x,-28,{rotation:90});
    put('warehouse-16',-40,-4); put('warehouse-16',14,8); put('warehouse-16',-18,30);
    put('tower-8',-52,30); put('tower-8',40,30); put('warehouse-16',20,-54);
    put('stairs-8',-34,-12); put('stairs-8',20,0);
    put('container-12',-52,-14); put('container-12',28,-12); put('container-12',-6,-48);
    for(const [x,y]of[[-15,-12],[5,-10],[-18,12],[6,6],[26,-2],[-5,20]])put('low-barrier-4',x,y);
    for(const [x,y]of[[-33,-35],[-8,-33],[16,-35],[-20,18],[36,16]])put('crate-2',x,y);
    put('pipe-stack-6',-14,4); put('high-cover-4',7,18); put('wall-8',40,-5,{rotation:90});
    for(const [x,y]of[[-60,-50],[-54,8],[-34,36],[48,8],[47,-48],[-7,48]]){
      put('soil-tile-8',x,y); put('tree-8',x+1,y+1);
    }
    for(const [x,y]of[[-52,-38],[36,45],[45,-33]])put('grass-tile-8',x,y);
    d.spawns.push({id:'H1',role:'guard',team:'enemy',x:-6,y:6,layer:0},
      {id:'H2',role:'guard',team:'enemy',x:8,y:2,layer:0},
      {id:'H3',role:'guard',team:'enemy',x:34,y:2,layer:0},
      {id:'H4',role:'sentry',team:'enemy',x:-30,y:2,layer:1},
      {id:'H5',role:'sentry',team:'enemy',x:22,y:14,layer:1});
    return d;
  }
  function inside(p,r) { return p.x>=r.x&&p.x<r.x+r.w&&p.y>=r.y&&p.y<r.y+r.d; }
  function validNode(p,b) { return isRecord(p)&&integer(p.x,b.minX,b.maxX)&&integer(p.y,b.minY,b.maxY)&&[0,1].includes(p.layer??0); }
  function validate(d,{playable=false}={}) {
    const errors=[],warnings=[];
    if(!isRecord(d))return {ok:false,errors:['A level must be a JSON object.'],warnings};
    if(d.schemaVersion!==1)errors.push('Unsupported level schema version.');
    if(!idOK(d.id))errors.push('Level ID must contain 1–80 letters, numbers, underscores or hyphens.');
    if(typeof d.title!=='string'||!d.title.trim()||d.title.length>80)errors.push('Give the level a title of 1–80 characters.');
    const b=d.bounds;
    if(!isRecord(b)||!['minX','maxX','minY','maxY'].every(k=>integer(b[k],-256,255))||b.maxX-b.minX+1<128||b.maxY-b.minY+1<128||b.maxX-b.minX+1>256||b.maxY-b.minY+1>256||b.minX>0||b.maxX<0||b.minY>0||b.maxY<0)
      return {ok:false,errors:[...errors,'Map bounds must contain the origin and span 128–256 cells on each axis.'],warnings};
    if(!Array.isArray(d.objects)||d.objects.length>500)return {ok:false,errors:[...errors,'A level supports at most 500 placed assets.'],warnings};
    const ids=new Set();
    for(const o of d.objects){
      if(!isRecord(o)||!idOK(o.id)||ids.has(o.id)){errors.push('Every placed object needs a unique valid ID.');continue;}
      ids.add(o.id);
      if(!index.has(o.assetId)){errors.push(`Unknown asset: ${String(o.assetId).slice(0,80)}.`);continue;}
      if(!integer(o.x,b.minX,b.maxX)||!integer(o.y,b.minY,b.maxY)||![0,90,180,270].includes(o.rotation??0)||!integer(o.elevation??0,0,24)||!finite(o.scale??1,.5,3)){
        errors.push(`${o.id}: position, quarter-turn rotation, elevation or scale is invalid.`);continue;
      }
      const r=boundsFor(o);if(r.x+r.w>b.maxX+1||r.y+r.d>b.maxY+1)errors.push(`${assetFor(o.assetId).name} extends beyond the map.`);
      if((o.elevation||0)>0&&['Terrain','Nature'].includes(assetFor(o.assetId).category))warnings.push(`${assetFor(o.assetId).name} is elevated; check its support.`);
    }
    if(!isRecord(d.objective)||d.objective.type!=='relay'||d.objective.x!==0||d.objective.y!==0)errors.push('The relay objective must stay at the origin (0, 0).');
    if(!isRecord(d.extraction)||!integer(d.extraction.x,b.minX,b.maxX)||!integer(d.extraction.y,b.minY,b.maxY)||!integer(d.extraction.radius,2,16))errors.push('Extraction needs an in-bounds coordinate and radius of 2–16.');
    if(!Array.isArray(d.spawns)||d.spawns.length>32)errors.push('A level supports at most 32 operative and hostile spawns.');
    else{
      const seen=new Set(),positions=new Set();
      for(const s of d.spawns){
        if(!isRecord(s)||!idOK(s.id)||seen.has(s.id)||!validNode(s,b)||!['player','enemy'].includes(s.team)||!['E','R','T','guard','sentry'].includes(s.role)){
          errors.push('Each spawn needs a unique ID, valid role, team and grid position.');continue;
        }
        seen.add(s.id);
        if(positions.has(key(s)))errors.push(`Spawn ${s.id} shares a cell with another unit.`);positions.add(key(s));
        if(s.team==='player'&&(!['E','R','T'].includes(s.id)||s.role!==s.id))errors.push('Player spawns must be E / Entry, R / Recon and T / Tech.');
        if(s.team==='enemy'&&!['guard','sentry'].includes(s.role))errors.push('Hostiles use guard or sentry roles.');
      }
      if(playable)for(const id of ['E','R','T'])if(!d.spawns.some(s=>s&&s.id===id&&s.team==='player'))errors.push(`Place the ${id} operative spawn before testing.`);
    }
    if(!Array.isArray(d.connections)||d.connections.length>64)errors.push('Use at most 64 traversal connections.');
    else for(const c of d.connections){
      if(!isRecord(c)||!idOK(c.id)||!validNode(c.from,b)||!validNode(c.to,b)||!['stairs','ladder'].includes(c.type||'stairs')||!integer(c.cost??1,1,128))errors.push('Traversal connections need valid endpoints and an integer cost of 1–128.');
    }
    if(errors.length)return {ok:false,errors:[...new Set(errors)],warnings:[...new Set(warnings)]};
    // playable: the E/R/T presence check above; reachability and footing are the canonical resolver's (forge.mjs)
    return {ok:errors.length===0,errors:[...new Set(errors)],warnings:[...new Set(warnings)]};
  }
  function compile(d,{skipValidation=false}={}){
    if(!skipValidation){const result=validate(d);if(!result.ok)throw new Error(result.errors.join(' '));}
    const bounds={...d.bounds,min:d.bounds.minX,max:d.bounds.maxX},buildings=[],boxes=[],bridges=[],waters=[],groundBridges=[],worldParts=[],stairObjects=[];
    const roofs=[],blockers=[];
    function addParts(o,asset,rect){
      const s=o.scale??1,a=(o.rotation||0)*Math.PI/180,c=Math.cos(a),sn=Math.sin(a);
      for(const [i,p]of(asset.parts||[]).entries())worldParts.push({...p,id:o.id+'-'+i,x:rect.x+rect.w/2+(p.x*c+p.z*sn)*s,y:(o.elevation||0)+p.y*s,z:rect.y+rect.d/2+(-p.x*sn+p.z*c)*s,w:p.w*s,h:p.h*s,d:p.d*s,r:[p.r?.[0]||0,(p.r?.[1]||0)+a,p.r?.[2]||0],objectId:o.id,ground:asset.category==='Terrain',water:o.assetId==='water-tile-16'});
    }
    for(const o of d.objects){
      const asset=assetFor(o.assetId);if(!asset)continue;
      const r={...boundsFor(o),id:o.id,name:asset.name,z:o.elevation||0,assetId:o.assetId};
      const surface=(asset.surfaceHeight??({'warehouse-16':8,'tower-8':12,'container-12':4,'catwalk-8':4,'bridge-16':.3}[o.assetId]??0))*(o.scale??1)+(o.elevation||0);
      addParts(o,asset,r);
      if(o.assetId==='water-tile-16'){waters.push(r);continue;}
      if(o.assetId==='bridge-16'&&surface<1){groundBridges.push(r);continue;}
      if(['stairs-8','ladder-8'].includes(o.assetId)){stairObjects.push({...o,rect:r});blockers.push({...r,h:r.h,cover:'none'});continue;}
      if(['warehouse-16','tower-8','container-12'].includes(o.assetId)){
        const roof={...r,h:surface};buildings.push(roof);roofs.push(roof);blockers.push({...r,h:surface,cover:asset.cover});
      }else if(o.assetId==='catwalk-8'||(o.assetId==='bridge-16'&&surface>=1)){
        const roof={...r,h:surface};bridges.push(roof);roofs.push(roof);
      }else if(asset.blocksMovement){const v={...r,h:asset.height*(o.scale??1),cover:asset.cover,type:asset.category==='Cover'?'cover':'crate',color:asset.category==='Nature'?'#507d51':'#e8ece8'};boxes.push(v);blockers.push(v);}
    }
    const relay={id:'relay',x:0,y:0,layer:0},evac={x:d.extraction.x,y:d.extraction.y,r:d.extraction.radius};
    const relayAsset=assetFor('relay-terminal');if(relayAsset)addParts({id:'objective-relay',x:0,y:0,rotation:0,elevation:0,scale:1},relayAsset,{x:-.5,y:-.5,w:2,d:2});
    const roofCache=new Map(),standCache=new Map(),buildingIds=new Set(buildings.map(b=>b.id));
    const roofAt=p=>{const k=`${p.x},${p.y}`;if(!roofCache.has(k))roofCache.set(k,roofs.filter(r=>inside(p,r)).sort((a,b)=>b.h-a.h)[0]);return roofCache.get(k);};
    const heightAt=p=>(p.layer||0)===1?(roofAt(p)?.h||0):0;
    function rawCanStand(p){
      if(!validNode(p,bounds))return false;
      const layer=p.layer||0,h=heightAt(p);
      if(layer===1){if(!roofAt(p))return false;return !blockers.some(r=>!buildingIds.has(r.id)&&r.z>=h-.1&&r.z<h+2&&inside(p,r));}
      if(blockers.some(r=>r.z<1.5&&inside(p,r)))return false;
      if(waters.some(r=>inside(p,r))&&!groundBridges.some(r=>inside(p,r)))return false;
      return p.x!==relay.x||p.y!==relay.y;
    }
    function canStand(p){if(!p)return false;const k=key(p);if(!standCache.has(k))standCache.set(k,rawCanStand(p));return standCache.get(k);}
    const stairs=(d.connections||[]).map(c=>({id:c.id,type:c.type||'stairs',from:{...c.from},to:{...c.to},width:2,cost:c.cost||1,manual:true}));
    for(const o of stairObjects){
      const r=o.rect,cx=Math.floor(r.x+r.w/2),cy=Math.floor(r.y+r.d/2),rot=o.rotation||0;
      let from,to;
      if(rot===0){from={x:cx,y:r.y-1,layer:0};to={x:cx,y:r.y+r.d,layer:1};}
      else if(rot===90){from={x:r.x-1,y:cy,layer:0};to={x:r.x+r.w,y:cy,layer:1};}
      else if(rot===180){from={x:cx,y:r.y+r.d,layer:0};to={x:cx,y:r.y-1,layer:1};}
      else{from={x:r.x+r.w,y:cy,layer:0};to={x:r.x-1,y:cy,layer:1};}
      const rise=(assetFor(o.assetId).surfaceHeight||8)*(o.scale??1)+(o.elevation||0);
      if(canStand(from)&&canStand(to)&&Math.abs(heightAt(to)-rise)<.6&&!stairs.some(s=>key(s.from)===key(from)&&key(s.to)===key(to)))stairs.push({id:o.id+'-access',type:o.assetId==='ladder-8'?'ladder':'stairs',from,to,width:r.w,cost:Math.ceil(Math.abs(from.x-to.x)+Math.abs(from.y-to.y)+Math.abs(heightAt(to)-heightAt(from)))});
    }
    function neighbors(p){
      const out=[];for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const n={x:p.x+dx,y:p.y+dy,layer:p.layer||0,cost:1};if(canStand(n)&&Math.abs(heightAt(n)-heightAt(p))<.6)out.push(n);}
      for(const s of stairs){if(key(p)===key(s.from)&&canStand(s.to))out.push({...s.to,cost:s.cost});if(key(p)===key(s.to)&&canStand(s.from))out.push({...s.from,cost:s.cost});}return out;
    }
    function coverAt(p){const h=heightAt(p);let v=0;for(const b of blockers){if(b.cover==='none'||b.z>h+2||b.z+b.h<h+.5)continue;const dx=Math.max(b.x-p.x,0,p.x-(b.x+b.w-1)),dy=Math.max(b.y-p.y,0,p.y-(b.y+b.d-1));if(dx+dy<=2)v=Math.max(v,b.cover==='full'?2:1);}return v;}
    function blocksSight(a,b){const ah=heightAt(a)+1.55,bh=heightAt(b)+1.55,steps=Math.max(2,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)*2));for(let i=1;i<steps;i++){const t=i/steps,p={x:a.x+.5+(b.x-a.x)*t,y:a.y+.5+(b.y-a.y)*t},h=ah+(bh-ah)*t;if(blockers.some(r=>inside(p,r)&&h>r.z&&h<r.z+r.h))return true;}return false;}
    return {id:d.id,title:d.title,bounds,buildings,boxes,bridges,waters,groundBridges,stairs,canal:null,gate:null,medkit:null,relay,evac,
      spawnDefinitions:clone(d.spawns),worldParts,theme:'white-industrial',authoringDocument:clone(d),
      heightAt,canStand,neighbors,coverAt,blocksSight,key,roofAt};
  }
  return {catalog,setCatalog,assetFor,boundsFor,newObject,createBlank,createStarter,validate,compile,clone};
}
