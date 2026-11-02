// Disposable PostgreSQL only; used by SQL behavior tests and browser mocks.
// npm install --prefix /tmp/lyric-tools --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.10
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
export const ACTOR='00000000-0000-4000-8000-0000000000a1',CREATOR='00000000-0000-4000-8000-0000000000b1',TRACK='20000000-0000-4000-8000-0000000000a1';
export async function lyricDatabase({install=true}={}) {
 const mod=process.env.PGLITE_MODULE_PATH;
 if(!mod)throw new Error('Set PGLITE_MODULE_PATH to an isolated @electric-sql/pglite@0.5.10 installation');
 const {PGlite}=await import(pathToFileURL(resolve(mod)).href);
 const {pgcrypto}=await import(pathToFileURL(resolve(mod,'../contrib/pgcrypto.js')).href);
 const db=new PGlite({extensions:{pgcrypto}});
 const apply=async path=>db.exec((await readFile(resolve(root,path),'utf8')).replace(/^\\.*$/mg,''));
 for(const p of ['supabase/tests/supabase_api_roles.stub.sql','supabase/tests/music_creator_onboarding.stub.sql','supabase/tests/music_release_integrity.stub.sql','supabase/migrations/20260920041011_music_creator_platform_v1.sql','supabase/migrations/20260920041250_music_commerce_v1.sql','supabase/tests/music_release_payment_integrity.seed.sql','supabase/migrations/20261030001000_music_release_payment_integrity_v1.sql'])await apply(p);
 // The real release guard is loaded above. Only Control authority is a small
 // fixture here; its shape and capability match the existing production RPC.
 await db.exec(`create table public.orgs(id uuid primary key,slug text);insert into public.orgs values('10000000-0000-4000-8000-000000000000','mccluster');
 create table public.lyric_test_operators(id uuid primary key);insert into public.lyric_test_operators values('${ACTOR}');
 create function public.control_authorize_service(p_actor uuid,p_org uuid,p_capability text,p_resource_type text,p_resource_id text,p_request_hash text,p_approval_id uuid) returns jsonb language sql stable security definer set search_path=pg_catalog as $$select jsonb_build_object('allowed',p_capability='ops.use' and exists(select 1 from public.lyric_test_operators where id=p_actor))$$;
 alter policy music_creator_tracks_read on public.creator_tracks to authenticated;
 create policy music_creator_tracks_public_read on public.creator_tracks for select to anon using(status='published');`);
 const publicDoc={plain:'Current creator text',timed:{line:[{begin:0,end:2,content:'Current creator text'}]}};
 await db.query("update public.creator_tracks set lyrics=$1::jsonb where id=$2",[JSON.stringify(publicDoc),TRACK]);
 if(install)await apply('supabase/pending/music_lyric_revisions_v1.sql');
 async function asRole(role,actor){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role,sub:actor})]);await db.exec('set role '+role);}
 async function service(){await asRole('service_role',ACTOR);}
 const admin={async rpc(name,args){
  if(!['music_lyrics_get','music_lyrics_save','music_lyrics_export'].includes(name))throw new Error('Unexpected fixture RPC');
  try{await service();const keys=Object.keys(args);const r=await db.query('select public.'+name+'('+keys.map((k,i)=>k+' => $'+(i+1)).join(',')+') as value',keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]));return{data:r.rows[0].value,error:null};}catch(error){return{data:null,error:{code:error.code,message:error.message}};}
 }};
 return{db,admin,apply,asRole,service,async track(){await db.exec('reset role');return(await db.query('select * from public.creator_tracks where id=$1',[TRACK])).rows[0];},async close(){await db.close();}};
}
