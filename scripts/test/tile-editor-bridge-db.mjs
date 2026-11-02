import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {handleProjectTiles} from '../../workers/mccluster/src/project-tiles.js';
const {PGlite}=createRequire(resolve(process.env.PGLITE_DIR||'/tmp/productization-tools/node_modules','fixture.cjs'))('@electric-sql/pglite');
const db=new PGlite(),root=new URL('../../',import.meta.url),A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';let n=0;
const ok=(a,b)=>{assert.deepEqual(a,b);n++;};
const file=p=>readFile(new URL(p,root),'utf8');
async function denied(fn,code){await assert.rejects(fn,e=>e.code===code);n++;}
async function role(r){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:r})]);await db.exec('set role '+r);}
async function bridge(action,head=null,revision=null,document=null,who=A){return(await db.query("select project_tile_editor_v2($1,$1,'alpha',$2,$3,$4,$5,null) r",[who,action,head,revision,document])).rows[0].r;}
try{
 const pins=JSON.parse(await file('supabase/tests/editor-versioned/tile-bridge-hashes.json'));
 for(const [path,hash] of Object.entries(pins))ok(createHash('sha256').update(await file(path)).digest('hex'),hash);
 for(const f of ['api-roles','storage','account-fixture','site-content','site-content-service','member-fronts','managed-projects','project-identity','studio-dependencies'])await db.exec((await file('supabase/tests/editor-versioned/'+f+'.sql')).replaceAll('create extension if not exists pgcrypto;',''));
 for(const f of ['website_studio_v2','project_tiles_v1','project_tiles_free_v1','editor_versioned_contracts_v1','project_tile_editor_v2'])await db.exec(await file('supabase/pending/'+f+'.sql'));
 await db.exec(await file('supabase/pending/project_tile_editor_v2.sql'));
 await db.query("insert into managed_projects(slug,owner_user_id,m_uid,name) values('alpha',$1,$1,'Alpha')",[A]);
 const doc=(await db.query('select definition from creator_site_template_versions limit 1')).rows[0].definition;
 for(const r of ['anon','authenticated','service_role'])ok((await db.query("select has_function_privilege($1,'project_tile_editor_v2(uuid,uuid,text,text,bigint,integer,jsonb,uuid)','execute') p",[r])).rows[0].p,r==='service_role');
 await role('anon');await denied(()=>bridge('read'),'42501');await role('authenticated');await denied(()=>bridge('read'),'42501');
 await role('service_role');await denied(()=>bridge('save',1,0,doc,B),'P0002');
 await denied(()=>db.query("select project_tile_editor_v2($1,$2,'alpha','read')",[A,B]),'42501');
 ok((await bridge('read')).editor_revision,1);
 const saved=await bridge('save',1,0,doc);ok(saved.editor_revision,2);ok(saved.studio_revision,1);
 await denied(()=>bridge('save',1,1,doc),'PT409');await denied(()=>bridge('save',2,0,doc),'PT409');
 await denied(()=>db.query("select project_tile_save_v1($1,$1,'alpha',1,$2)",[A,doc]),'PT409');ok((await bridge('read')).studio_revision,1);
 const published=await bridge('publish_free',2,1);ok(published.editor_revision,3);ok(published.presentation,'tiles');
 await denied(()=>bridge('withdraw',2,1),'PT409');
 const withdrawn=await bridge('withdraw',3,1);ok(withdrawn.owner_withdrawn,true);ok(withdrawn.removed,true);
 await denied(()=>bridge('publish_free',4,1),'42501');
 const recovered=await bridge('recover',4,1);ok(recovered.removed,false);ok(recovered.owner_withdrawn,false);
 ok((await db.query("select studio_revision_id from managed_projects where slug='alpha'")).rows[0].studio_revision_id,null);
 const front=await bridge('switch_front',5,1);ok(front.presentation,'front');
 ok((await db.query("select published from managed_projects where slug='alpha'")).rows[0].published,null);
 ok((await db.query("select document from creator_site_drafts limit 1")).rows[0].document,doc);
 await role('postgres');ok((await db.query("select operation from private.editor_versions order by revision desc limit 1")).rows[0].operation,'tiles_switch_front');
 await db.exec("create function bridge_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic';end$$;create trigger zz_bridge_failure after update on managed_projects for each row execute function bridge_failure();");
 await role('service_role');await denied(()=>bridge('save',6,1,doc),'P0001');ok((await bridge('read')).studio_revision,1);ok((await bridge('read')).editor_revision,6);
 await role('postgres');await db.exec('drop trigger zz_bridge_failure on managed_projects');
 // Real HTTP handler with SQL-backed select/RPC; media publish validation stays in existing handler.
 const store={actor:async()=>({auth_uid:A,m_uid:A}),select:async(table,filters)=>{let q='select * from '+table;const entries=Object.entries(filters||{}).filter(([k])=>k!=='limit');const args=[];if(entries.length)q+=' where '+entries.map(([k,v])=>{assert.ok(v.startsWith('eq.'));args.push(v.slice(3));return k+'=$'+args.length;}).join(' and ');return(await db.query(q,args)).rows;},rpc:async(name,args)=>{await role('service_role');try{return(await db.query('select '+name+'('+Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')+') r',Object.values(args))).rows[0].r;}catch(e){e.status=e.code==='PT409'?409:e.code==='42501'?403:503;throw e;}finally{await role('postgres');}}};
 const env={WEBSITE_STUDIO_ENABLED:'true',EDITOR_V2_ENABLED:'true',CUSTOMER_SITE_OFFER_ENABLED:'true'};
 const call=(path,method='GET',body)=>handleProjectTiles(new Request('https://fixture.invalid/v2/projects/alpha/tiles'+path,{method,body:body?JSON.stringify(body):undefined}),env,{db:store});
 let r=await call('');ok(r.status,200);ok((await r.json()).editor_revision,6);
 r=await call('','PUT',{expected_revision:1,document:doc});ok(r.status,400);
 r=await call('','PUT',{expected_revision:1,expected_editor_revision:6,document:doc});ok(r.status,200);ok((await r.json()).editor_revision,7);
 r=await call('/withdraw','POST',{expected_revision:2,expected_editor_revision:6});ok(r.status,409);
 r=await call('/publish','POST',{expected_revision:2,expected_editor_revision:7,confirm_public:true});ok(r.status,400); // empty media forbidden even through v2
 console.log('PASS '+n+' bridge SQL/HTTP assertions: double CAS, permissions, draft retention, explicit switch, rollback, media guard and legacy fencing');
}finally{await db.close();}
