// Local synthetic identities and PostgreSQL fixture only. Never import in runtime code.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const { PGlite }=createRequire(join(process.env.PGLITE_DIR||'/tmp/mccluster-owner-tools/node_modules','entry.cjs'))('@electric-sql/pglite');
export const owner='11111111-1111-4111-8111-111111111111';
export const other='22222222-2222-4222-8222-222222222222';
export async function ownerFrontFixture({dataDir}={}) {
  const db = new PGlite(dataDir);
  const exists=(await db.query("select to_regclass('public.site_content') as name")).rows[0].name;
  if(!exists){
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_user::text$$;
    create function public.mnet_is_admin() returns boolean language sql stable security definer as $$select auth.uid()='${owner}'::uuid$$;
    grant usage on schema auth to anon,authenticated,service_role;`);
  }
  for(const path of (exists?[]:['supabase/migrations/20260922100313_site_content_live_editing.sql','supabase/migrations/20260922100615_site_content_service_role_path.sql','supabase/pending/owner_front_publication_v1.sql']))
    await db.exec(await readFile(new URL('../../../'+path,import.meta.url),'utf8'));
  if(exists)await db.exec(await readFile(new URL('../../../supabase/pending/owner_front_publication_v1.sql',import.meta.url),'utf8'));
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
  return db;
}
