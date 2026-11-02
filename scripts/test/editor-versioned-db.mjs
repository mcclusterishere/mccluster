// Portable real SQL tests. npm install --prefix /tmp/editor-tools @electric-sql/pglite@0.5.11
// PGLITE_DIR=/tmp/editor-tools/node_modules node scripts/test/editor-versioned-db.mjs
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {handleManagedProjects} from '../../workers/mccluster/src/managed-projects.js';
import {handleVersionedEditor} from '../../workers/mccluster/src/editor-versioned.js';
const {PGlite}=createRequire(resolve(process.env.PGLITE_DIR||'/tmp/productization-tools/node_modules','fixture.cjs'))('@electric-sql/pglite');
const root=new URL('../../',import.meta.url),db=new PGlite();
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',O='33333333-3333-4333-8333-333333333333';
let checks=0;
const ok=(a,b)=>{assert.deepEqual(a,b);checks++;};
async function file(path){return readFile(new URL(path,root),'utf8');}
async function role(name,id){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:name,sub:id})]);await db.exec('set role '+name);}
async function owned(kind,key,action='read',expected=null,data=null,restore=null,actor=A){return (await db.query('select public.editor_owned_v2($1,$2,$3,$4,$5,$6,$7) result',[actor,kind,key,action,expected,data,restore])).rows[0].result;}
async function site(action='read',expected=null,data=null,restore=null){return (await db.query("select public.site_content_v2('index.html','@front',$1,$2,$3,$4) result",[action,expected,data,restore])).rows[0].result;}
async function denies(fn,code){await assert.rejects(fn,e=>e.code===code);checks++;}
try {
 const pins=JSON.parse(await file('supabase/tests/editor-versioned/fixture-hashes.json'));
 for(const [path,hash] of Object.entries(pins)){const text=await file(path);ok(createHash('sha256').update(text).digest('hex'),hash);}
 for(const f of ['api-roles','storage','account-fixture','site-content','site-content-service','member-fronts','managed-projects','project-identity'])await db.exec((await file('supabase/tests/editor-versioned/'+f+'.sql')).replaceAll('create extension if not exists pgcrypto;',''));
 await db.exec("insert into managed_projects(slug,owner_user_id,m_uid,name) values ('alice-project','"+A+"','"+A+"','Alice'),('bob-project','"+B+"','"+B+"','Bob')");
 await db.exec(await file('supabase/tests/editor-versioned/studio-dependencies.sql'));
 for(const name of ['website_studio_v2','project_tiles_v1','project_tiles_free_v1'])await db.exec(await file('supabase/pending/'+name+'.sql'));
 await db.exec(await file('supabase/tests/editor-versioned/editor-contract-c150.sql'));
 const migration=await file('supabase/pending/editor_versioned_contracts_v1.sql');await db.exec(migration);await db.exec(migration);
 // Assert actual ACLs, rather than printing them.
 for(const r of ['anon','authenticated','service_role']){
  ok((await db.query("select has_table_privilege($1,'private.editor_versions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') p",[r])).rows[0].p,false);
  ok((await db.query("select has_function_privilege($1,'public.editor_owned_v2(uuid,text,text,text,bigint,jsonb,bigint)','execute') p",[r])).rows[0].p,r==='service_role');
  ok((await db.query("select has_function_privilege($1,'public.site_content_v2(text,text,text,bigint,jsonb,bigint)','execute') p",[r])).rows[0].p,r==='authenticated');
 }
 await role('anon');await denies(()=>owned('project','alice-project'),'42501');await denies(()=>site(),'42501');
 await role('authenticated',A);await denies(()=>site(),'42501');await denies(()=>owned('project','alice-project'),'42501');
 await role('service_role');await denies(()=>owned('project','bob-project'),'P0002');
 ok((await owned('project','alice-project')).revision,0);
 ok((await owned('project','alice-project','save',0,{words:{eyebrow:'one'}})).revision,1);
 await denies(()=>owned('project','alice-project','save',0,{words:{eyebrow:'stale'}}),'PT409');
 await denies(()=>db.exec("update managed_projects set draft='{}' where slug='alice-project'"),'PT409');
 // A legacy, unenrolled object still works, and its mutation is recorded.
 await db.exec("update managed_projects set draft='{}' where slug='bob-project'");
 ok((await owned('project','bob-project','read',null,null,null,B)).revision,1);
 ok((await owned('project','alice-project','publish',1,{words:{eyebrow:'two'}})).revision,2);
 const restored=await owned('project','alice-project','restore',2,null,1);ok(restored.revision,3);ok(restored.snapshot.draft.words.eyebrow,'one');ok(restored.snapshot.published.words.eyebrow,'two');
 await denies(()=>owned('project','alice-project','restore',3,null,1,B),'P0002');
 await denies(()=>owned('project','alice-project','restore',3,null,99),'P0002');
 ok((await owned('project','alice-project','history')).history[0].operation,'restore');
 // Full transaction rollback must roll source and history/revision back together.
 await db.exec('begin');await owned('project','alice-project','save',3,{words:{eyebrow:'rolled-back'}});await db.exec('rollback');
 ok((await owned('project','alice-project')).revision,3);
 await role('postgres');
 await db.exec("create function public.editor_test_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic downstream failure';end$$; create trigger zz_editor_test_failure after update on managed_projects for each row execute function editor_test_failure();");
 await role('service_role');await denies(()=>owned('project','alice-project','save',3,{words:{eyebrow:'must rollback'}}),'P0001');
 ok((await owned('project','alice-project')).revision,3);ok((await owned('project','alice-project')).snapshot.draft.words.eyebrow,'one');
 await denies(()=>owned('project','alice-project','withdraw',3),'P0001');ok((await owned('project','alice-project')).owner_withdrawn,false);ok((await owned('project','alice-project')).snapshot.removed_at,null);
 await role('postgres');await db.exec('drop trigger zz_editor_test_failure on managed_projects; drop function editor_test_failure()');
 await role('postgres');await db.exec("update network_profiles set visibility='private' where m_uid='"+A+"'");await role('service_role');
 await denies(()=>owned('project','alice-project','publish',3,{}),'42501');ok((await owned('project','alice-project')).revision,3);
 await role('postgres');await db.exec("update network_profiles set visibility='public' where m_uid='"+A+"'");await role('service_role');
 // Personal front creation, stale unpublish, draft-only restore and moderation fencing.
 ok((await owned('front','me','save',0,{words:{eyebrow:'personal'}})).revision,1);
 ok((await owned('front','me','publish',1,{words:{eyebrow:'public'}})).revision,2);
 await denies(()=>owned('front','me','unpublish',1),'PT409');
 ok((await owned('front','me','unpublish',2)).snapshot.published,null);
 ok((await owned('front','me','restore',3,null,1)).snapshot.draft.words.eyebrow,'personal');
 await denies(()=>owned('front','alice','takedown',4,{reason:'forged'},null,B),'42501');
 // Existing legacy moderation remains possible after enrollment, increments version.
 await db.exec("update member_fronts set removed_at=now(),removed_reason='synthetic moderation',published=null,published_at=null where handle='alice'");
 ok((await owned('front','me')).revision,5);
 await denies(()=>owned('front','me','publish',4,{}),'PT409');
 await denies(()=>owned('front','me','publish',5,{}),'42501');
 await denies(()=>owned('front','me','restore',5,null,1),'42501');
 await denies(()=>db.exec("update member_fronts set removed_at=null where handle='alice'"),'PT409');
 await role('postgres');await db.exec("update m_auth_user_links set m_uid='"+A+"' where auth_user_id='"+B+"'");await role('service_role');
 await denies(()=>owned('front','me','history',null,null,null,B),'42501');
 await role('postgres');await db.exec("update m_auth_user_links set m_uid='"+B+"' where auth_user_id='"+B+"'");await role('service_role');
 // Site content preserves existing audit and full slot snapshot fields, including deletion.
 await role('authenticated',O);
 ok((await site()).revision,0);
 ok((await site('save',0,{value:'{"scene":1}',kind:'text',original:'shipped',fragile:true})).revision,1);
 await denies(()=>site('save',0,{value:'stale'}),'PT409');
 await denies(()=>db.exec("select site_content_set('index.html','@front','blind')"),'PT409');
 await site('save',1,{value:'{"scene":2}',kind:'text'});
 const sr=await site('restore',2,null,1);ok(sr.snapshot.value,'{"scene":1}');ok(sr.snapshot.fragile,true);ok(sr.revision,3);
 ok((await site('reset',3)).snapshot,null);
 const undo=await site('restore',4,null,3);ok(undo.snapshot.value,'{"scene":1}');ok(undo.revision,5);
 await denies(()=>site('save',5,{value:'x'.repeat(20001)}),'23514');ok((await site()).revision,5);
 await role('postgres');ok((await db.query("select count(*)::int n from site_content_history where page='index.html' and slot='@front'")).rows[0].n,5);
 await denies(()=>db.exec("delete from private.editor_versions"),'42501');
 await denies(()=>db.exec('truncate site_content'),'42501');
 // Run the actual HTTP handler over SQL RPCs and fixture Auth; no production requests.
 const fetchImpl=async(input,init)=>{
  const url=new URL(input);
  if(url.pathname==='/auth/v1/user'){const token=new Headers(init.headers).get('authorization');return token==='Bearer expired'?Response.json({}, {status:401}):Response.json({id:token==='Bearer bob'?B:A});}
  if(!url.pathname.startsWith('/rest/v1/rpc/')){
   await role('service_role');
   const table=url.pathname.split('/').pop();assert.ok(['managed_projects','m_auth_user_links','network_profiles'].includes(table));
   const identifier=k=>{assert.match(k,/^[a-z_]+$/);return '"'+k+'"';};
   if(init.method==='POST'){
    assert.equal(table,'managed_projects');const data=JSON.parse(init.body),keys=Object.keys(data);
    const rows=await db.query('insert into managed_projects('+keys.map(identifier).join(',')+') values('+keys.map((k,i)=>'$'+(i+1)).join(',')+') returning *',Object.values(data));return Response.json(rows.rows);
   }
   assert.ok(!init.method||init.method==='GET');const values=[],conditions=[];
   for(const [k,v] of url.searchParams){if(['select','limit','order'].includes(k))continue;
    if(v==='is.null')conditions.push(identifier(k)+' is null');
    else {assert.ok(v.startsWith('eq.'));values.push(v.slice(3));conditions.push(identifier(k)+'=$'+values.length);}
   }
   const select=url.searchParams.get('select')||'*';const rows=await db.query('select '+(select==='*'?'*':select.split(',').map(identifier).join(','))+' from '+identifier(table)+(conditions.length?' where '+conditions.join(' and '):''),values);return Response.json(rows.rows);
  }
  assert.equal(url.pathname,'/rest/v1/rpc/editor_owned_v2');
  const b=JSON.parse(init.body);await role('service_role');
  try{return Response.json(await owned(b.p_kind,b.p_key,b.p_action,b.p_expected,b.p_data,b.p_restore,b.p_actor));}
  catch(e){return Response.json({code:e.code,message:e.message},{status:400});}
 };
 const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',EDITOR_V2_ENABLED:'true'};
 const http=async(path,body,token='alice')=>handleVersionedEditor(new Request('https://api.mccluster.org'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token},body:body?JSON.stringify(body):undefined}),env,{fetchImpl});
 ok((await http('/v2/projects/alice-project/edit',{expected_revision:3,config:{words:{eyebrow:'HTTP'}}})).status,200);
 ok((await http('/v2/projects/alice-project/edit',{expected_revision:3,config:{}})).status,409);
 ok((await http('/v2/projects/alice-project/history',null,'bob')).status,404);
 ok((await http('/v2/projects/alice-project/restore',{expected_revision:4,restore_revision:1})).status,200);
 ok((await http('/v2/projects/alice-project/edit',{expected_revision:5,config:{},owner_user_id:B})).status,400);
 ok((await http('/v2/projects/alice-project/edit',{expected_revision:5,config:{words:{eyebrow:'x'.repeat(70000)}}})).status,413);
 ok((await http('/v2/projects/alice-project/edit',null,'expired')).status,401);
 ok((await http('/v2/projects/alice-project/edit',{expected_revision:5,config:{media:{still:{src:'https://fixture.invalid/storage/v1/object/public/front-media/'+B+'/foreign.png'}}}})).status,400);
 ok((await handleVersionedEditor(new Request('https://api.mccluster.org/v2/fronts/me/edit'),{...env,EDITOR_V2_ENABLED:'false'},{fetchImpl})).status,503);
 // Exact #681 validator: offer settings survive; project media never enters personal fronts.
 const prefix='https://fixture.invalid/storage/v1/object/public/front-media/';
 const offer={layout:'offers',offer_page:{title:'Services',intro:'Existing template',cards:[{title:'One',body:'Details',image:prefix+A+'/projects/alice-project/card.png'}]}};
 const offered=await http('/v2/projects/alice-project/edit',{expected_revision:5,config:offer});ok(offered.status,200);
 ok((await offered.json()).snapshot.draft.offer_page.cards[0].image,offer.offer_page.cards[0].image);
 ok((await http('/v2/projects/alice-project/edit',{expected_revision:6,config:{layout:'offers'}})).status,400);
 ok((await http('/v2/fronts/me/edit',{expected_revision:0,config:{media:{still:{src:prefix+B+'/projects/bob-project/private.png'}}}},'bob')).status,400);
 ok((await http('/v2/fronts/me/edit',{expected_revision:0,config:{layout:'offers',offer_page:{title:'Personal',intro:'Own offer',logo:prefix+B+'/projects/bob-project/logo.png'}}},'bob')).status,400);
 ok((await http('/v2/fronts/me/edit',{expected_revision:0,config:{layout:'offers',offer_page:{title:'Personal',intro:'Own offer',logo:prefix+B+'/logo.png'}}},'bob')).status,200);
 ok((await http('/v2/fronts/me/edit',{expected_revision:1,config:{media:{still:{src:prefix+B+'/./projects/bob-project/private.png'}}}},'bob')).status,400);
 // Immutable historical drafts must pass the same current media restrictions.
 await role('postgres');await db.exec("insert into managed_projects(slug,owner_user_id,m_uid,name,registry_key) values ('vaunt','"+A+"','"+A+"','Vaunt','vaunt')");
 ok((await http('/v2/projects/vaunt/edit',{expected_revision:1,config:{layout:'offers',offer_page:{title:'No',intro:'Protected'}}})).status,403);
 // Withdrawal is recoverable removal, never hard deletion or automatic publication.
 ok((await http('/v2/projects/alice-project/withdraw',{expected_revision:5})).status,409);
 ok((await http('/v2/projects/alice-project/withdraw',{expected_revision:6},'bob')).status,404);
 const withdrawn=await http('/v2/projects/alice-project/withdraw',{expected_revision:6});ok(withdrawn.status,200);
 const w=await withdrawn.json();ok(w.revision,7);ok(w.owner_withdrawn,true);ok(w.snapshot.published,null);ok(Boolean(w.snapshot.removed_at),true);ok(w.snapshot.draft.offer_page.title,'Services');
 ok((await http('/v2/projects/alice-project/edit',{expected_revision:7,publish:true,config:offer})).status,403);
 ok((await http('/v2/projects/alice-project/recover',{expected_revision:6})).status,409);
 const recovery=await http('/v2/projects/alice-project/recover',{expected_revision:7});ok(recovery.status,200);
 const recovered=await recovery.json();ok(recovered.revision,8);ok(recovered.owner_withdrawn,false);ok(recovered.snapshot.removed_at,null);ok(recovered.snapshot.published,null);ok(recovered.snapshot.id,w.snapshot.id);
 const history=await (await http('/v2/projects/alice-project/history')).json();ok(history.history.slice(0,2).map(v=>v.operation),['recover','withdraw']);ok(history.history[0].actor,A);
 ok((await http('/v2/projects/alice-project/recover',{expected_revision:8})).status,403);
 await role('service_role');await denies(()=>db.exec("update managed_projects set removed_at=now(),published=null,published_at=null where slug='alice-project'"),'PT409');
 await db.exec("update managed_projects set removed_at=now() where slug='bob-project'");
 await denies(()=>owned('project','bob-project','recover',2,null,null,B),'42501');
 await denies(()=>owned('front','me','withdraw',1,null,null,B),'22023');
 // Every public route mount in #681 remains present; v2 reaches actual platform routing.
 const entry=await file('workers/mccluster/src/entry-platform.js');
 for(const name of ['handleVersionedEditor','handleManagedProjects','handleMemberFronts','handleProjectTiles','handleCustomerSiteModules','handleCreatorDomainOrders'])ok(entry.includes(name),true);
 // Exact #681 Studio SQL remains functional for unenrolled projects.
 await role('postgres');await db.exec("insert into managed_projects(slug,owner_user_id,m_uid,name) values ('tile-project','"+A+"','"+A+"','Tiles')");
 const document=(await db.query("select definition from creator_site_template_versions where template_key='motion-portfolio' and version=1")).rows[0].definition;
 await role('service_role');
 const tileSave=async slug=>(await db.query('select project_tile_save_v1($1,$1,$2,0,$3) result',[A,slug,document])).rows[0].result;
 const tile=await tileSave('tile-project');ok(tile.revision,1);
 await db.query("select project_tile_publish_free_v1($1,$1,'tile-project',1)",[A]);
 await denies(()=>owned('project','tile-project','save',3,{}),'22023');
 // Known integration gate: enrollment must never silently discard Studio writes.
 const beforeDrafts=(await db.query('select count(*)::int n from creator_site_drafts')).rows[0].n;
 await denies(()=>tileSave('alice-project'),'PT409');
 ok((await db.query('select count(*)::int n from creator_site_drafts')).rows[0].n,beforeDrafts);
 ok((await owned('project','alice-project')).snapshot.presentation,'front');
 console.log('BASELINE BEFORE BRIDGE: enrolled front-to-Tile writes conflict atomically; no Studio draft leaks. Dedicated bridge suite tests the additive solution.');
 // Primary free-builder backend journey uses actual project routes + SQL, fixture Auth only.
 const projectHttp=async(path,body,token='alice')=>handleManagedProjects(new Request('https://api.mccluster.org'+path,{method:body?'POST':'GET',headers:token?{authorization:'Bearer '+token}:{},body:body?JSON.stringify(body):undefined}),env,{fetchImpl});
 const created=await projectHttp('/v1/projects',{slug:'free-journey',name:'My site'});ok(created.status,201);
 const createdBody=await created.json();ok(createdBody.slug,'free-journey');
 ok((await projectHttp('/v1/projects/free-journey',null,null)).status,404);
 const initial=await (await http('/v2/projects/free-journey/edit')).json();
 const freeConfig={words:{eyebrow:'My first website'},media:{still:{src:prefix+A+'/projects/free-journey/image.png'}}};
 ok((await http('/v2/projects/free-journey/edit',{expected_revision:initial.revision,config:freeConfig})).status,200);
 const resumed=await (await http('/v2/projects/free-journey/edit')).json();ok(resumed.snapshot.draft.words.eyebrow,'My first website');
 ok((await http('/v2/projects/free-journey/edit',{expected_revision:resumed.revision,publish:true,config:freeConfig})).status,200);
 const publicPage=await projectHttp('/v1/projects/free-journey',null,null);ok(publicPage.status,200);
 const publicBody=await publicPage.json();ok(publicBody.config.media.still.src,freeConfig.media.still.src);ok(publicBody.draft,undefined);ok(publicBody.owner_user_id,undefined);
 ok((await http('/v2/projects/free-journey/edit',{expected_revision:resumed.revision+1,config:{}},'bob')).status,404);
 ok((await http('/v2/projects/free-journey/withdraw',{expected_revision:resumed.revision+1})).status,200);
 ok((await projectHttp('/v1/projects/free-journey',null,null)).status,404);
 ok((await http('/v2/projects/free-journey/recover',{expected_revision:resumed.revision+2})).status,200);
 ok((await projectHttp('/v1/projects/free-journey',null,null)).status,404);
 console.log('PASS free-builder backend journey: actual create/save/resume/publish/public-read/withdraw/recover handlers with SQL; no ordinary-user admin grant. Auth, image bytes and browser renderer remain real-service gates.');
 // READBACK CONTRACT (frontend js/editor-revisions.js reconcile): after a lost response the history row at expected+1
 // must name the operation (and restored_from for restore) and the snapshot must show its effect; a bare revision step is
 // never proof. Driven through the real HTTP adapter over real SQL on the free-journey project.
 {
  const hist=async()=>await (await http('/v2/projects/free-journey/history')).json();
  const before=await hist();const base=before.revision;
  // a plain save: row operation 'save' at base+1 with the saved draft
  const saved=await (await http('/v2/projects/free-journey/edit',{expected_revision:base,config:{words:{eyebrow:'readback'}}})).json();
  let h=await hist();let row=h.history.find(r=>r.revision===base+1);
  ok(h.revision,base+1);ok(row.operation,'save');ok(JSON.stringify(row.snapshot.draft.words),JSON.stringify({eyebrow:'readback'}));ok(h.snapshot.published,null);
  // FINDING 2: the saved draft equals a would-be publish body, yet published is null: the frontend must not call this "published"
  ok(saved.snapshot.published,null);
  // restore: row operation 'restore' with restored_from = the requested revision
  const restored=await (await http('/v2/projects/free-journey/restore',{expected_revision:base+1,restore_revision:base})).json();
  h=await hist();row=h.history.find(r=>r.revision===base+2);
  ok(restored.revision,base+2);ok(row.operation,'restore');ok(row.restored_from,base);ok(h.snapshot.published,null);
  // an unrelated step (another save) after a lost restore attempt is distinguishable: operation differs
  await http('/v2/projects/free-journey/edit',{expected_revision:base+2,config:{words:{eyebrow:'someone else'}}});
  h=await hist();row=h.history.find(r=>r.revision===base+3);ok(row.operation,'save');ok(row.restored_from,null);
  // a protected (enrolled) record rejects a blind legacy write at the SQL trigger (PT409). The CURRENT legacy adapter
  // (managed-projects.js) surfaces that as a generic 503, indistinguishable from an outage: recorded as a backend request
  // (map PT409 → 409 code 'protected'); the frontend never treats any legacy error as retryable, so it stays safe meanwhile.
  const blind=await projectHttp('/v1/projects/free-journey/edit',{config:{words:{eyebrow:'blind'}}});
  ok([409,503].includes(blind.status),true);
  const after=await hist();ok(after.revision,base+3);ok(after.snapshot.draft.words.eyebrow,'someone else');
  console.log('PASS readback contract: history rows carry operation/restored_from; publish state is explicit; protected record refuses blind legacy write');
 }
 // History entries are private even with an authenticated SQL role.
 await role('authenticated',A);await denies(()=>db.query('select * from private.editor_versions'),'42501');
 console.log('PASS: '+checks+' assertions; SQL roles/ACLs, own/cross-account, first/stale/legacy writes, restore/audit, rollback, private publication, personal takedown fencing, real HTTP adapter over SQL. Native simultaneous sessions tested separately.');
}finally{await db.close();}
