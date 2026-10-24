/* Halo's bounded object renderer. Far symbols, nearby 3D objects and a pinned
   inspection target share the SAME observed/calculated positions. No invented
   aircraft motion or measured spacecraft attitude. */
(function(root){'use strict';
const LIMITS=Object.freeze({flights:5000,satellites:240});
function limit(kind,value){const n=Number(value);return Number.isFinite(n)?Math.max(1,Math.min(LIMITS[kind],Math.floor(n))):LIMITS[kind]}
function visibleRows(rows,cap,selected){
 const out=rows.slice(0,cap);
 const picked=rows.find(r=>r.key===selected);
 if(picked&&!out.includes(picked)){if(out.length===cap)out.pop();out.push(picked)}
 return out;
}
function modelCandidates(rows,camera,cap,distance,selected,metric,visible){
 return rows.map(r=>({row:r,p:r.position()})).filter(x=>x.p&&(x.row.key===selected||visible(x.p))).map(x=>({...x,d:metric(camera,x.p)})).filter(x=>x.row.key===selected||x.d<=distance).sort((a,b)=>(b.row.key===selected)-(a.row.key===selected)||a.d-b.d||a.row.key.localeCompare(b.row.key)).slice(0,cap).map(x=>x.row);
}
function create({C,viewer,rows,onChange}){
 let alive=true,selected=null,last=0,modelsOn=true;
 const limits={...LIMITS},models=new Map();
 const credit=new C.Credit('Aircraft model: <a href="https://sketchfab.com/3d-models/boeing-747-9b16672038ba48f98e6d80a159044ed9">zairiq-123</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> · optimized by God’s Eye View',true);
 viewer.creditDisplay.addStaticCredit(credit);
 function remove(key){const e=models.get(key);if(e)viewer.entities.remove(e);models.delete(key)}
 function apply(){
  if(!alive)return;
  const occluder=new C.EllipsoidalOccluder(C.Ellipsoid.WGS84,viewer.camera.positionWC);
  for(const kind of Object.keys(limits)){
   const all=rows(kind),shown=visibleRows(all,limits[kind],selected),keys=new Set(shown.map(r=>r.key));
   for(const r of all){r.symbol.show=keys.has(r.key);if(r.label)r.label.show=keys.has(r.key)}
   const candidates=modelsOn?modelCandidates(shown.filter(r=>r.modelEligible!==false),viewer.camera.positionWC,kind==='flights'?24:12,kind==='flights'?250000:2500000,selected,C.Cartesian3.distance,p=>!!p&&occluder.isPointVisible(p)):[];
   const wanted=new Set(candidates.map(r=>r.key));
   for(const [key,e] of models)if(e.haloKind===kind&&!wanted.has(key))remove(key);
   for(const r of candidates){
    const p=r.position();if(!p)continue;
    if(!models.has(r.key)){
     const entity=viewer.entities.add({position:p,model:{uri:kind==='flights'?'assets/3d/halo/airplane.glb':root.HuSpace.satelliteModel(),minimumPixelSize:r.key===selected?100:32,maximumScale:kind==='flights'?300:18000},orientation:C.Transforms.headingPitchRollQuaternion(p,new C.HeadingPitchRoll(kind==='flights'?C.Math.toRadians((r.heading||0)+180):.5,0,0))});
     entity.haloKind=kind;entity.haloObjectPick=r.pick;models.set(r.key,entity);
    }
    const e=models.get(r.key);e.position=p;e.model.minimumPixelSize=r.key===selected?100:32;
   }
  }
  onChange?.(stats());viewer.scene.requestRender();
 }
 function tick(){
  if(!alive||document.hidden)return;
  const now=performance.now();if(now-last>=500){last=now;apply()}
  // Only the inspected orbital object is propagated every frame.
  if(selected){const r=rows('satellites').find(r=>r.key===selected),e=models.get(selected);if(r){const p=r.position();if(p){r.symbol.position=p;if(r.label)r.label.position=p;if(e)e.position=p}}}
 }
 function stats(){return Object.fromEntries(Object.keys(limits).map(k=>[k,{limit:limits[k],loaded:rows(k).length,shown:Math.min(limits[k],rows(k).length),models:[...models.values()].filter(e=>e.haloKind===k).length}]))}
 viewer.scene.preRender.addEventListener(tick);
 return Object.freeze({setLimit(k,n){if(!(k in limits))return;limits[k]=limit(k,n);apply()},setModels(on){modelsOn=!!on;apply()},select(key){selected=key;apply()},refresh:apply,stats,destroy(){alive=false;viewer.scene.preRender.removeEventListener(tick);for(const key of [...models.keys()])remove(key);for(const k of Object.keys(limits))for(const r of rows(k)){r.symbol.show=true;if(r.label)r.label.show=true}viewer.creditDisplay.removeStaticCredit(credit)}});
}
root.HaloObjects=Object.freeze({LIMITS,limit,visibleRows,modelCandidates,create});
})(typeof window==='undefined'?globalThis:window);
