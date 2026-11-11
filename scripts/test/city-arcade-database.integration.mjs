import assert from 'node:assert/strict';
import {createArcadeDatabase,OWNER,PEER} from './support/arcade-database.mjs';
import {SOLE_MISSION} from '../../js/city-arcade/sole-config.mjs';
import {TEA_MISSION} from '../../js/city-arcade/tea-action.mjs';
const {db,rpc,handle,close}=await createArcadeDatabase();let count=0;
const id='bridgeport-main-elm',document={version:1,gameId:'gauranfucking-tea-tea-rush',locationId:id,tea:structuredClone(TEA_MISSION)};
let starts=0;const call=(action,revision,doc=document,actor=OWNER,target=id)=>rpc({p_action:action,p_actor:actor,p_id:target,p_document:action==='start'?{startKey:`dddddddd-dddd-4ddd-8ddd-${String(++starts).padStart(12,'0')}`}:doc,p_revision:revision??null});
async function rejects(fn,code){await assert.rejects(fn,e=>e.code===code);count++;}
try{
  for(const role of ['anon','authenticated'])for(const sql of ['select * from public.arcade_missions','select * from public.arcade_runs',`select public.arcade_command('read','${OWNER}','${id}')`]){
    await db.exec('set role '+role);await rejects(()=>db.query(sql),'42501');await db.exec('reset role');
  }
  await rejects(()=>call('save',0,document,PEER),'42501');
  let m=await call('save',0);assert.equal(m.revision,1);count++;
  await rejects(()=>call('save',0),'40001');
  m=await call('save',1,{...document,tea:{...document.tea,reward:50}});assert.equal(m.revision,2);count++;
  const old=await db.query('select document from arcade_mission_versions where revision=1');assert.equal(old.rows[0].document.tea.reward,100);count++;
  await db.exec('set role service_role');await rejects(()=>db.query('update arcade_mission_versions set revision=9'),'42501');await db.exec('reset role');
  await rejects(()=>call('save',2,{...document,tea:{...document.tea,route:[null]}}),'23514');
  await rejects(()=>call('start',1),'40001');
  const run=await call('start',2);assert.equal(run.document.tea.reward,50);count++;
  const result={status:'won',served:5};let r=await call('finish',null,result,OWNER,run.id);assert.equal(r.score,250);count++;
  assert.deepEqual(await call('finish',null,result,OWNER,run.id),r);count++;
  await rejects(()=>call('finish',null,{status:'failed',served:0},OWNER,run.id),'40001');
  const run2=await call('start',2);await rejects(()=>call('finish',null,{status:'won',served:1},OWNER,run2.id),'22023');
  const h=await call('history');assert.equal(h.length,1);count++;
  await db.exec(`update org_members set role='member' where profile_id='${OWNER}'`);await rejects(()=>call('read'),'42501');await db.exec(`update org_members set role='owner' where profile_id='${OWNER}'`);
  for(const [token,status] of [[null,401],['member',403]]){const response=await handle(new Request('https://local.invalid/v1/arcade/missions/'+id,{headers:token?{authorization:'Bearer '+token}:{}}));assert.equal(response.status,status);count++;}
  for(const [payload,status] of [[{document,expectedRevision:2,p_actor:PEER},400],[{document:{...document,locationId:'government-building'},expectedRevision:2},422]]){
    const r=await handle(new Request('https://local.invalid/v1/arcade/missions/'+id,{method:'PUT',headers:{authorization:'Bearer local-owner','content-type':'application/json'},body:JSON.stringify(payload)}));assert.equal(r.status,status);count++;
  }
  const response=await handle(new Request('https://local.invalid/v1/arcade/results',{headers:{authorization:'Bearer local-owner'}}));assert.equal(response.status,200);assert.equal((await response.json()).value.length,1);count++;
  const soleDoc={version:1,gameId:'designer-kicks-sole-run',locationId:id,sole:structuredClone(SOLE_MISSION)},sid='sole-'+id;
  const sm=await call('save',0,soleDoc,OWNER,sid);assert.equal(sm.document.sole.encounters[0].roast,SOLE_MISSION.encounters[0].roast);count++;
  const sr=await call('start',1,null,OWNER,sid);
  await rejects(()=>call('finish',null,{status:'won',served:4,encounters:['invented']},OWNER,sr.id),'22023');
  const resultSole=await call('finish',null,{status:'won',served:4,encounters:['replica-courier']},OWNER,sr.id);assert.equal(resultSole.score,475);count++;
  await rejects(()=>call('save',1,{...soleDoc,sole:{...soleDoc.sole,route:['main-elm','main-elm','main-elm','main-elm']}},OWNER,sid),'23514');
  const unreachable={...soleDoc,sole:{...soleDoc.sole,blockedRoads:['bridgeport-osm-186839735-0','bridgeport-osm-10173135-0']}};
  const bad=await handle(new Request('https://local.invalid/v1/arcade/missions/'+sid,{method:'PUT',headers:{authorization:'Bearer local-owner','content-type':'application/json'},body:JSON.stringify({document:unreachable,expectedRevision:1})}));assert.equal(bad.status,422);count++;
  console.log(`${count} isolated database/API assertions passed.`);
}finally{await close();}
