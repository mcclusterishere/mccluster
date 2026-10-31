import test from 'node:test';import assert from 'node:assert/strict';
import {writeSiteObject,handleCustomerSiteStorage} from '../src/customer-site-storage.js';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
function fixture(){const writes=[],patches=[],reservations=[];let actual=null;
 const db={actor:async()=>({auth_uid:A,m_uid:A}),select:async()=>[],rpc:async(n,b)=>{reservations.push(b);return{id:'r1'};},patch:async(...v)=>patches.push(v)};
 const provider={put:async(b,p,stream)=>{const bytes=new Uint8Array(await new Response(stream).arrayBuffer());writes.push(bytes);actual=bytes.length;},head:async()=>actual};
 return {db,provider,writes,patches,reservations,set actual(x){actual=x;}};
}
const input=f=>({db:f.db,env:{},user:A,bucket:'front-media',path:A+'/still.webp',bytes:3,body:new Response(new Uint8Array([1,2,3])).body,type:'image/webp',storageImpl:f.provider});
test('server counts actual streamed bytes and verifies durable size; over/under declarations retain reservation',async()=>{
 let f=fixture();assert.equal((await writeSiteObject(input(f))).bytes,3);assert.equal(f.patches[0][2].state,'settled');
 for(const bytes of [2,4]){f=fixture();await assert.rejects(()=>writeSiteObject({...input(f),bytes}),/reserved size/);assert.equal(f.patches.length,0);assert.equal(f.reservations.length,1);}
 f=fixture();f.provider.head=async()=>99;await assert.rejects(()=>writeSiteObject(input(f)),/reconciliation/);assert.equal(f.patches.length,0);
 f=fixture();f.provider.put=async()=>{throw Error('connection lost after upstream commit');};await assert.rejects(()=>writeSiteObject(input(f)),/connection lost/);assert.equal(f.patches.length,0);
 f=fixture();f.db.rpc=async()=>{throw Object.assign(Error('full'),{status:429});};await assert.rejects(()=>writeSiteObject(input(f)),/full/);assert.equal(f.writes.length,0);
});
test('upload route rejects other tenants and path tricks before reserving bytes',async()=>{
 const f=fixture();for(const path of [B+'/still.webp',A+'/../'+B+'/still.webp',A+'/projects/stolen/still.webp']){
 const r=await handleCustomerSiteStorage(new Request('https://api.mccluster.org/v1/customer-site/media?path='+encodeURIComponent(path),{method:'POST',headers:{'content-type':'image/webp','x-site-bytes':'3'},body:new Uint8Array([1,2,3])}),{}, {db:f.db,storageImpl:f.provider});assert.ok([400,404].includes(r.status));}
 assert.equal(f.reservations.length,0);
});
test('recovery releases only old confirmed absence and settles exact bytes; no absence guess on provider failure',async()=>{
 const f=fixture();const records=[{id:'young',bucket:'front-media',path:A+'/young',bytes:3,created_at:new Date().toISOString()},{id:'old',bucket:'front-media',path:A+'/old',bytes:3,created_at:'2020-01-01'}];
 f.db.select=async()=>records;f.db.rpc=async()=>({quota_bytes:500000000});
 const call=()=>handleCustomerSiteStorage(new Request('https://api.mccluster.org/v1/customer-site/storage',{method:'POST'}),{},{db:f.db,storageImpl:f.provider});
 assert.equal((await call()).status,200);assert.equal(f.patches.length,1);assert.equal(f.patches[0][1].id,'eq.old');assert.equal(f.patches[0][2].state,'released');
 f.patches.length=0;f.actual=3;assert.equal((await call()).status,200);assert.equal(f.patches.length,2);assert.ok(f.patches.every(p=>p[2].state==='settled'));
 f.patches.length=0;f.provider.head=async()=>{throw Error('unavailable');};assert.equal((await call()).status,503);assert.equal(f.patches.length,0);
});
