import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {PGlite}=createRequire(resolve(process.env.PGLITE_DIR||'/opt/node-tools/node_modules','fixture.cjs'))('@electric-sql/pglite');
const db=new PGlite();
try{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);');
 await db.exec(await readFile(new URL('../supabase/pending/world_directory_v1.sql',import.meta.url),'utf8'));
 const id='11111111-1111-4111-8111-111111111111';await db.query('insert into auth.users values($1)',[id]);
 await db.query("insert into world_directory_listings(owner_user_id,m_uid,source_kind,source_key,entity_type,title,description,category,is_listed) values($1,$1,'project','alpha','service','Audio mastering','Mix and master songs','music',true)",[id]);
 assert.equal((await db.query("select id from world_directory_listings where search_document @@ to_tsquery('simple','audio & mastering')")).rows.length,1);
 assert.equal((await db.query("select id from world_directory_listings where search_document @@ to_tsquery('simple','design')")).rows.length,0);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>db.query('select * from world_directory_listings'),/permission denied/);await assert.rejects(()=>db.query('update world_directory_listings set is_listed=true'),/permission denied/);await db.exec('reset role');}
 await assert.rejects(()=>db.query("update world_directory_listings set online_only=true,location_label='Secret address'"),/check constraint/);
 await assert.rejects(()=>db.query("update world_directory_listings set source_kind='arbitrary-url'"),/check constraint/);
 const indexes=(await db.query("select indexname from pg_indexes where tablename='world_directory_listings'")).rows.map(r=>r.indexname);assert.ok(indexes.includes('world_directory_search_idx'));
 console.log('PASS isolated directory SQL: full-text filtering, anon/member denial, location/source constraints and search index');
}finally{await db.close();}
