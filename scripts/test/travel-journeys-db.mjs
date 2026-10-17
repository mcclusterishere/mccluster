// Real PostgreSQL role/policy execution in an isolated PGlite instance, never production.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const require=createRequire(join(process.env.PGLITE_DIR||'/tmp/hu-qa/node_modules','package.json'));
const { PGlite }=require('@electric-sql/pglite');
const db=new PGlite();
try {
  for(const path of ['supabase/tests/supabase_api_roles.stub.sql','supabase/migrations/20261017050521_travel_journeys_private_v1.sql','supabase/tests/travel_journeys.behaviour.sql']) {
    const sql=await readFile(new URL('../../'+path,import.meta.url),'utf8');
    // gen_random_uuid() is built in. PGlite does not load Supabase's pgcrypto extension.
    await db.exec(sql.replace(/create extension if not exists pgcrypto;/gi,''));
  }
  console.log('PASS: journey CRUD, two-owner isolation, anonymous denial and server-side validation');
} finally { await db.close(); }
