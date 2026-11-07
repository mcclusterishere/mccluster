// Isolated local PostgreSQL-compatible database; never connects to canonical Supabase.
import { readFile } from 'node:fs/promises';
import { handleArcade } from '../../../workers/mccluster/src/arcade/index.js';
export const OWNER='11111111-1111-4111-8111-111111111111';
export const PEER='22222222-2222-4222-8222-222222222222';
export async function createArcadeDatabase() {
  const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table public.orgs(id uuid primary key,slug text,enabled boolean not null default true);create table public.org_members(org_id uuid,profile_id uuid,role text);grant select on public.orgs,public.org_members to service_role;grant usage on schema auth to service_role;
    insert into auth.users values('${OWNER}'),('${PEER}');insert into orgs(id,slug) values('${OWNER}','mccluster');insert into org_members values('${OWNER}','${OWNER}','owner'),('${OWNER}','${PEER}','member');`);
  await db.exec(await readFile(new URL('../../../supabase/pending/city_arcade_v1.sql',import.meta.url),'utf8'));
  let chain=Promise.resolve();
  const rpc=async(params)=>{
    const work=chain.then(async()=>{await db.exec('set role service_role');try{return (await db.query('select public.arcade_command($1,$2,$3,$4,$5) as result',[params.p_action,params.p_actor,params.p_id,params.p_document,params.p_revision])).rows[0].result;}finally{await db.exec('reset role');}});
    chain=work.catch(()=>{});return work;
  };
  const handle=request=>handleArcade(request,{ARCADE_CLOUD_ENABLED:'true',SUPABASE_URL:'https://local.invalid',SUPABASE_SERVICE_ROLE_KEY:'local-fixture-only'}, {
    requireHouseOwner:async r=>{
      const token=r.headers.get('authorization');if(!token)throw Object.assign(Error('Sign in'),{status:401});
      if(token!=='Bearer local-owner')throw Object.assign(Error('Owner required'),{status:403});return {id:OWNER};
    },
    fetchImpl:async(url,options)=>{try{return Response.json(await rpc(JSON.parse(options.body)));}catch(e){return Response.json({code:e.code},{status:400});}}
  });
  return {db,rpc,handle,close:()=>db.close()};
}
