import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx={};vm.runInNewContext(fs.readFileSync(new URL('../../js/halo/objects.js',import.meta.url),'utf8'),ctx);const api=ctx.HaloObjects;
test('density is independent, bounded, and retains the inspected object within the budget',()=>{
 const rows=Array.from({length:100},(_,i)=>({key:String(i)}));
 assert.equal(api.limit('flights',99999),5000);assert.equal(api.limit('satellites',99999),240);assert.equal(api.limit('flights',-1),1);
 const result=api.visibleRows(rows,10,'99');assert.equal(result.length,10);assert.equal(result.at(-1).key,'99');assert.equal(rows.length,100);
});
test('3D candidates respect horizon, distance and GPU budget; selected object wins',()=>{
 const rows=Array.from({length:5000},(_,i)=>({key:String(i),position:()=>i+1}));rows.push({key:'invalid',position:()=>null});
 const result=api.modelCandidates(rows,0,24,100,'4999',(a,b)=>Math.abs(a-b),p=>p%2===0);
 assert.equal(result.length,24);assert.equal(result[0].key,'4999');assert.ok(result.slice(1).every(r=>r.position()%2===0&&r.position()<=100));
});
test('renderer creates a bounded fleet, keeps density and destroys models, listener and credits',()=>{
 const entities=new Set(),listeners=new Set(),credits=new Set();
 class HPR{};class Credit{};class Occluder{isPointVisible(){return true}};
 const C={Credit,EllipsoidalOccluder:Occluder,Ellipsoid:{WGS84:{}},Cartesian3:{distance:(a,b)=>Math.abs(a-b)},Math:{toRadians:x=>x*Math.PI/180},HeadingPitchRoll:HPR,Transforms:{headingPitchRollQuaternion:()=>({})}};
 const viewer={entities:{add:e=>(entities.add(e),e),remove:e=>entities.delete(e)},camera:{positionWC:0},creditDisplay:{addStaticCredit:c=>credits.add(c),removeStaticCredit:c=>credits.delete(c)},scene:{requestRender(){},preRender:{addEventListener:f=>listeners.add(f),removeEventListener:f=>listeners.delete(f)}}};
 const rows=Array.from({length:100},(_,i)=>({key:'flights:'+i,symbol:{},position:()=>i+1,pick:{layer:'flights'}}));
 const renderer=api.create({C,viewer,rows:k=>k==='flights'?rows:[]});renderer.refresh();assert.equal(entities.size,24);
 renderer.setLimit('flights',5);assert.equal(entities.size,5);assert.equal(rows.filter(r=>r.symbol.show).length,5);
 renderer.select('flights:99');assert.equal(entities.size,5);assert.equal(rows[99].symbol.show,true);
 renderer.setModels(false);assert.equal(entities.size,0);assert.equal(renderer.stats().flights.shown,5);
 renderer.destroy();assert.equal(entities.size,0);assert.equal(listeners.size,0);assert.equal(credits.size,0);assert.ok(rows.every(r=>r.symbol.show));
});
