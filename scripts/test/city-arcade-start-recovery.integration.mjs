// Regression for audit finding W3 against the actual pending schema and Worker handler in isolated PGlite.
// A start must be replay-safe (owner-bound idempotency key) and running runs must be recoverable.
import assert from 'node:assert/strict';
import {createArcadeDatabase,OWNER,PEER} from './support/arcade-database.mjs';
import {TEA_MISSION} from '../../js/city-arcade/tea-action.mjs';
const {rpc,db,handle,close}=await createArcadeDatabase();let count=0;
const ok=(c,m)=>{assert.ok(c,m);count++;};
async function rejects(fn,code){await assert.rejects(fn,e=>e.code===code);count++;}
try{
 const id='bridgeport-main-elm';
 await rpc({p_action:'save',p_actor:OWNER,p_id:id,p_revision:0,p_document:{version:1,gameId:'gauranfucking-tea-tea-rush',locationId:id,tea:TEA_MISSION}});
 const key='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',start={p_action:'start',p_actor:OWNER,p_id:id,p_revision:1,p_document:{startKey:key}};
 await rejects(()=>rpc({...start,p_document:null}),'22023');            // key required
 await rejects(()=>rpc({...start,p_document:{startKey:'nope'}}),'22023');
 const a=await rpc(start),b=await rpc(start);
 ok(a.id===b.id,'exact retry returns the same frozen run');ok(a.document.tea.reward===b.document.tea.reward);
 ok((await db.query('select count(*)::int as n from arcade_runs')).rows[0].n===1,'one row for one requested start');
 await rejects(()=>rpc({...start,p_revision:0}),'40001');                // conflicting reuse of the same key
 const current=await rpc({p_action:'current',p_actor:OWNER,p_id:''});
 ok(current.length===1&&current[0].id===a.id&&current[0].status==='running'&&current[0].document.tea,'running run is recoverable');
 ok((await rpc({p_action:'current',p_actor:PEER,p_id:''}).catch(e=>e.code))==='42501','peer cannot read owner runs');
 const other=await rpc({...start,p_document:{startKey:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}});
 ok(other.id!==a.id,'a distinct intentional start creates a distinct run');
 ok((await rpc({p_action:'current',p_actor:OWNER,p_id:''})).length===2);
 await rpc({p_action:'finish',p_actor:OWNER,p_id:a.id,p_document:{status:'failed',served:0}});
 ok((await rpc({p_action:'current',p_actor:OWNER,p_id:''})).length===1,'finished runs leave the current list');
 // Worker routes: start requires the key, exact retry gives 201 with the same id, current is readable.
 const h=(path,init)=>handle(new Request('https://local.invalid/v1/arcade/'+path,{headers:{authorization:'Bearer local-owner','content-type':'application/json'},...init}));
 let r=await h('start/'+id,{method:'POST',body:JSON.stringify({expectedRevision:1})});ok(r.status===400,'Worker refuses a start without an idempotency key');
 r=await h('start/'+id,{method:'POST',body:JSON.stringify({expectedRevision:1,startKey:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'})});const first=(await r.json()).value;ok(r.status===201);
 r=await h('start/'+id,{method:'POST',body:JSON.stringify({expectedRevision:1,startKey:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'})});ok((await r.json()).value.id===first.id,'Worker replay returns the same run');
 r=await h('start/'+id,{method:'POST',body:JSON.stringify({expectedRevision:0,startKey:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'})});ok(r.status===409,'conflicting reuse is refused');
 r=await h('current');const list=(await r.json()).value;ok(r.status===200&&list.some(x=>x.id===first.id),'current-run read exposes the uncertain start');
 r=await handle(new Request('https://local.invalid/v1/arcade/current',{headers:{authorization:'Bearer member'}}));ok(r.status===403);
 console.log(`${count} start-recovery assertions passed.`);
}finally{await close();}
