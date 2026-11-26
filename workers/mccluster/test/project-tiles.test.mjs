import test from 'node:test';import assert from 'node:assert/strict';
import {handleManagedProjects} from '../src/managed-projects.js';
import {projectTilesFixture,A,B,ORG} from './support/project-tiles-fixture.mjs';
const ids=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
test('explicit free site publication needs owner, public profile and approved media but no subscription',{skip:!process.env.PGLITE_DIR},async()=>{
 const f=await projectTilesFixture();try{
 f.env.CUSTOMER_SITE_OFFER_ENABLED='true';f.providerActive=false;await f.sql.exec('delete from creator_billing_subscriptions;delete from org_members;');
 const doc=structuredClone((await f.call('/templates')).body.templates[0].definition);for(let i=0;i<3;i++){await f.prepare(ids[i],doc.tiles[i].kind);doc.tiles[i].source_ref={type:'media_asset',key:ids[i]};}
 await f.call('','PUT',{expected_revision:0,document:doc});assert.equal((await f.call('')).body.free_publication,true);
 assert.equal((await f.call('/publish','POST',{expected_revision:1,confirm_public:true})).status,200);
 assert.equal((await f.call('/public','GET',null,null)).status,200);assert.equal((await f.db.select('managed_projects',{slug:'eq.alpha'}))[0].studio_org_id,null);
 assert.equal((await f.call('/publish','POST',{expected_revision:1,confirm_public:true},'bob')).status,404);
 await f.sql.query("update creator_site_media_state set public_approved=false where asset_id=$1",[ids[0]]);assert.equal((await f.call('/public','GET',null,null)).status,409);
 await f.sql.exec('set role authenticated');await assert.rejects(()=>f.sql.query("select project_tile_publish_free_v1($1,$1,'alpha',1)",[A]),/permission denied/);await f.sql.exec('reset role');
 }finally{await f.close();}
});
test('paid nonadmin template → revision → private media preview → public project, preserving cinematic snapshots',{skip:!process.env.PGLITE_DIR},async()=>{
 const f=await projectTilesFixture();try{
 const template=(await f.call('/templates')).body.templates[0];const doc=structuredClone(template.definition);
 for(let i=0;i<3;i++){await f.prepare(ids[i],doc.tiles[i].kind);doc.tiles[i].source_ref={type:'media_asset',key:ids[i]};}doc.title='Alice real fixture';
 const saved=await f.call('','PUT',{expected_revision:0,document:doc});assert.equal(saved.status,200);assert.equal(saved.body.revision,1);
 assert.equal((await f.call('/public','GET',null,null)).status,404);
 assert.equal((await f.call('/preview','POST',{})).status,200);
 assert.equal((await f.call('','PUT',{expected_revision:0,document:doc})).status,409);
 assert.equal((await f.call('/publish','POST',{expected_revision:1,confirm_public:true,org_id:ORG})).status,200);
 const pub=await f.call('/public','GET',null,null);assert.equal(pub.status,200);assert.equal(pub.body.document.title,doc.title);assert.match(pub.body.media['tile-1:content'].url,/\/object\/sign\/mnet-media\//);assert.equal(pub.body.draft,undefined);
 const row=(await f.db.select('managed_projects',{slug:'eq.alpha'}))[0];assert.equal(row.presentation,'tiles');assert.equal(row.draft.words.eyebrow,'Keep cinematic draft');assert.equal(row.published.words.eyebrow,'Keep cinematic public');
 const managed=async(path,method='GET',body)=>{const r=await handleManagedProjects(new Request('https://api.mccluster.org/v1/projects/alpha'+path,{method,headers:{authorization:'Bearer fixture-alice'},body:body?JSON.stringify(body):undefined}),f.env,{db:f.db,fetchImpl:f.restFetch});return {status:r.status,body:await r.json()};};
 assert.equal((await managed('')).body.presentation,'tiles');
 assert.equal((await managed('/published','DELETE')).status,200);
 assert.equal((await managed('')).status,404);
 assert.equal((await f.db.select('managed_projects',{slug:'eq.alpha'}))[0].published.words.eyebrow,'Keep cinematic public');
 await f.call('/publish','POST',{expected_revision:1,confirm_public:true,org_id:ORG});
 assert.equal((await managed('/edit','POST',{config:{words:{eyebrow:'Switch back to front'}},publish:true})).status,200);
 const switched=(await f.db.select('managed_projects',{slug:'eq.alpha'}))[0];assert.equal(switched.presentation,'front');assert.ok(switched.studio_revision_id);
 assert.equal((await f.call('/public','GET',null,null)).status,404);
 assert.equal((await managed('')).body.config.words.eyebrow,'Switch back to front');
 await f.call('/publish','POST',{expected_revision:1,confirm_public:true,org_id:ORG});
 assert.equal((await f.call('/public','GET',null,null,{expectedAuthUserId:B})).status,404);assert.equal((await f.call('/public','GET',null,null,{expectedProjectId:B})).status,404);
 await f.sql.query("update creator_site_media_state set state='withdrawn' where asset_id=$1",[ids[0]]);assert.equal((await f.call('/public','GET',null,null)).status,409);
 }finally{await f.close();}
});
test('cross-owner/private/canceled subscription and direct member mutations fail; revision data stays private',{skip:!process.env.PGLITE_DIR},async()=>{
 const f=await projectTilesFixture();try{
 const doc=(await f.call('/templates')).body.templates[0].definition;for(let i=0;i<3;i++){await f.prepare(ids[i],doc.tiles[i].kind,i===0?B:A);doc.tiles[i].source_ref={type:'media_asset',key:ids[i]};}
 assert.equal((await f.call('','PUT',{expected_revision:0,document:doc},'bob')).status,404);
 assert.equal((await f.call('','PUT',{expected_revision:0,document:doc})).status,200);
 assert.equal((await f.call('/preview','POST',{})).status,409);
 assert.equal((await f.call('/publish','POST',{expected_revision:1,confirm_public:true,org_id:ORG})).status,409);
 await f.sql.query("update network_profiles set visibility='private' where m_uid=$1",[A]);assert.equal((await f.call('/publish','POST',{expected_revision:1,confirm_public:true,org_id:ORG})).status,409);
 await f.sql.query("update network_profiles set visibility='public' where m_uid=$1",[A]);f.providerActive=false;assert.equal((await f.call('/publish','POST',{expected_revision:1,confirm_public:true,org_id:ORG})).status,403);
 await f.sql.exec('set role authenticated');await assert.rejects(()=>f.sql.query('update managed_projects set presentation=\'tiles\''),/permission denied/);await assert.rejects(()=>f.sql.query('select * from creator_site_revisions'),/permission denied/);await assert.rejects(()=>f.sql.query('select project_tile_publish_v1($1,$1,\'alpha\',1,$2)',[A,ORG]),/permission denied/);await f.sql.exec('reset role');
 }finally{await f.close();}
});
