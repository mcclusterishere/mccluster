// Isolated fixture database only. No network or live credentials.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(resolve(process.env.PGLITE_DIR || '/opt/node-tools/node_modules','fixture.cjs'));
const {PGlite}=require('@electric-sql/pglite');
const db=new PGlite();
try {
 await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);');
 await db.exec(await readFile(new URL('../supabase/pending/managed_projects_v1.sql',import.meta.url),'utf8'));
 const uid='11111111-1111-4111-8111-111111111111';
 await db.query('insert into auth.users values ($1)',[uid]);
 await db.query('insert into managed_projects(slug,owner_user_id,m_uid,name) values ($1,$2,$2,$3)',['test-project',uid,'Test']);
 for(const role of ['anon','authenticated']) {
  await db.exec('set role '+role);
  await assert.rejects(()=>db.query('select * from managed_projects'),/permission denied/);
  await assert.rejects(()=>db.query("update managed_projects set owner_user_id='22222222-2222-4222-8222-222222222222'"),/permission denied/);
  await db.exec('reset role');
 }
 await assert.rejects(()=>db.query('insert into managed_projects(slug,owner_user_id,m_uid,name) values ($1,$2,$2,$3)',['test-project',uid,'Takeover']),/duplicate key/);
 await assert.rejects(()=>db.query("update managed_projects set published='{}'::jsonb"),/check constraint/);
 await db.query("update managed_projects set published='{}'::jsonb,published_at=now()");
 await assert.rejects(()=>db.query('update managed_projects set removed_at=now()'),/check constraint/);
 await db.query('update managed_projects set removed_at=now(),published=null,published_at=null');
 await assert.rejects(()=>db.query("update managed_projects set registry_key='vaunt'"),/check constraint/);
 console.log('PASS: isolated project schema, direct anon/member access denied, slug uniqueness, publication/removal consistency, registry binding');
} finally {await db.close();}
