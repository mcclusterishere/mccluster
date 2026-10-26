// Disposable Postgres with synthetic existing identities, provider subscription and prepared assets.
// No live credentials, persistent grants or network calls. Runs the actual pending SQL.
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {handleProjectTiles} from '../../src/project-tiles.js';
import {fail} from '../../src/website-studio/service.mjs';
export const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',ORG='33333333-3333-4333-8333-333333333333';
export async function projectTilesFixture(){
 const {PGlite}=createRequire(resolve(process.env.PGLITE_DIR||'/opt/node-tools/node_modules','fixture.cjs'))('@electric-sql/pglite');
 const sql=new PGlite();
 await sql.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);
 create table m_people(id uuid primary key,status text default 'active');
 create table m_auth_user_links(auth_user_id uuid,m_uid uuid,is_primary boolean);
 create table network_profiles(m_uid uuid,visibility text);
 create function current_m_uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table orgs(id uuid primary key);
 create table org_members(org_id uuid,profile_id uuid,role text);
 create table creator_billing_subscriptions(owner_user_id uuid,org_id uuid,status text,stripe_subscription_id text,stripe_price_id text,current_period_end timestamptz);
 create table media_assets(id uuid primary key,asset_type text,role text,storage_path text,metadata jsonb);
 create table media_jobs(id uuid primary key,status text,result jsonb,error jsonb,completed_at timestamptz,updated_at timestamptz);
 create table network_posts(id uuid,author_m_uid uuid,visibility text,media jsonb,deleted_at timestamptz,removed_at timestamptz);
 `);
 for(const file of ['managed_projects_v1.sql','website_studio_v2.sql','project_tiles_v1.sql'])await sql.exec(await readFile(new URL('../../../../supabase/pending/'+file,import.meta.url),'utf8'));
 // Domain integration adds this separately; only the fixture models it here.
 await sql.exec('alter table managed_projects add column id uuid unique default gen_random_uuid();');
 for(const id of [A,B]){
  await sql.query('insert into auth.users values($1)',[id]);await sql.query('insert into m_people(id) values($1)',[id]);await sql.query('insert into m_auth_user_links values($1,$1,true)',[id]);await sql.query("insert into network_profiles values($1,'public')",[id]);
 }
 await sql.query('insert into orgs values($1)',[ORG]);await sql.query("insert into org_members values($1,$2,'owner')",[ORG,A]);
 await sql.query("insert into creator_billing_subscriptions values($1,$2,'active','sub_fixture','price_fixture','2099-01-01')",[A,ORG]);
 for(const [id,slug] of [[A,'alpha'],[B,'beta']])await sql.query("insert into managed_projects(slug,owner_user_id,m_uid,name,draft,published,published_at) values($1,$2,$2,$1,'{\"words\":{\"eyebrow\":\"Keep cinematic draft\"}}','{\"words\":{\"eyebrow\":\"Keep cinematic public\"}}',now())",[slug,id]);
 await sql.exec('grant all on all tables in schema public to service_role;grant usage on schema public to service_role;');
 let signed=0,providerActive=true;
 const identifier=x=>{if(!/^[a-z_][a-z0-9_]*$/.test(x))throw Error('Unsafe fixture SQL identifier');return '"'+x+'"';};
 function where(filters,params){const conditions=[];for(const [key,value] of Object.entries(filters)){
  if(['limit','order'].includes(key))continue;const k=identifier(key);
  if(value==='is.null'){conditions.push(k+' is null');continue;}
  if(value==='not.is.null'){conditions.push(k+' is not null');continue;}
  if(value.startsWith('in.(')){const vals=value.slice(4,-1).split(',');conditions.push(k+' in ('+vals.map(v=>{params.push(v);return '$'+params.length;}).join(',')+')');continue;}
  const dot=value.indexOf('.'),op={eq:'=',neq:'<>',gt:'>',lt:'<'}[value.slice(0,dot)];if(!op)throw Error('Unsupported fixture filter');params.push(value.slice(dot+1));conditions.push(k+op+'$'+params.length);
 }return conditions.length?' where '+conditions.join(' and '):'';}
 const db={
  async actor(request){const h=request.headers.get('authorization');if(!['Bearer fixture-alice','Bearer fixture-bob'].includes(h))throw fail(401,'Sign in first');const uid=h.endsWith('alice')?A:B;return {m_uid:uid,auth_uid:uid};},
  async select(table,filters={},columns='*'){const values=[];let q='select '+(columns==='*'?'*':columns.split(',').map(identifier).join(','))+' from '+identifier(table)+where(filters,values);if(filters.order){const [k,direction]=filters.order.split('.');q+=' order by '+identifier(k)+(direction==='desc'?' desc':' asc');}if(filters.limit)q+=' limit '+Number(filters.limit);return(await sql.query(q,values)).rows;},
  async patch(table,filters,body){const values=[];const set=Object.entries(body).map(([k,v])=>{values.push(v);return identifier(k)+'=$'+values.length;});await sql.query('update '+identifier(table)+' set '+set.join(',')+where(filters,values),values);},
  async rpc(name,args){await sql.exec('set role service_role');try{return(await sql.query('select '+identifier(name)+'('+Object.keys(args).map((k,i)=>identifier(k)+'=> $'+(i+1)).join(',')+') as result',Object.values(args).map(v=>typeof v==='object'?JSON.stringify(v):v))).rows[0].result;}catch(e){throw fail(e.code==='40001'?409:e.code==='42501'?403:e.code==='54000'?429:503,e.message);}finally{await sql.exec('reset role');}},
  async sign(path){signed++;return 'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/sign/mnet-media/'+path+'?token=fixture';}
 };
 const env={SUPABASE_URL:'https://zmnhbrjyhxzhkxmhkexs.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture',STRIPE_SECRET_KEY:'sk_test_fixture',CREATOR_STARTER_MONTHLY_PRICE_ID:'price_fixture',WEBSITE_STUDIO_ENABLED:'true'};
 const fetchImpl=async()=>new Response(JSON.stringify({status:providerActive?'active':'canceled',metadata:{mccluster_user_id:A},items:{data:[{price:{id:'price_fixture'}}]}}),{status:200});
 async function restFetch(input,init={}){
  const u=new URL(input);if(u.hostname==='api.stripe.com')return fetchImpl(input,init);
  if(u.pathname==='/auth/v1/user'){const h=new Headers(init.headers).get('authorization');return new Response(JSON.stringify({id:h==='Bearer fixture-alice'?A:B}),{status:200});}
  const table=u.pathname.split('/').pop(),filters=Object.fromEntries(u.searchParams),columns=filters.select||'*';delete filters.select;
  if(init.method==='PATCH'){await db.patch(table,filters,JSON.parse(init.body));}
  return new Response(JSON.stringify(await db.select(table,filters,columns)),{status:200});
 }
 async function call(path='',method='GET',body,who='alice',deps={}){const r=await handleProjectTiles(new Request('https://api.mccluster.org/v1/projects/alpha/tiles'+path,{method,headers:who?{authorization:'Bearer fixture-'+who}:{},body:body?JSON.stringify(body):undefined}),env,{db,fetchImpl,...deps});return {status:r.status,body:await r.json()};}
 async function prepare(id,kind,owner=A,approved=true){const path=`studio/${owner}/${id}/original`,files=[{name:kind==='music'?'audio.m4a':kind==='native_video'?'video.mp4':'panorama.jpg'}];
  await sql.query("insert into media_assets(id,asset_type,role,storage_path,metadata) values($1,$2,'website_studio_source',$3,'{}')",[id,kind,path]);
  await sql.query("insert into creator_site_media_state(asset_id,owner_m_uid,state,expected_bytes,source_path,kind,settings,output_manifest,public_approved) values($1,$2,'ready',16,$3,$4,'{}',$5,$6)",[id,owner,path,kind,JSON.stringify({files}),approved]);
 }
 return {sql,db,env,fetchImpl,restFetch,call,prepare,get signed(){return signed;},set providerActive(v){providerActive=v;},close:()=>sql.close()};
}
