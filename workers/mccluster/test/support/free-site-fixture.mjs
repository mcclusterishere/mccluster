// Only existing account/org/profile authority plus the free-site pending schemas.
// Deliberately no paid, registrar, music, Studio, social-delivery or processing tables.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',O='33333333-3333-4333-8333-333333333333';
export async function freeSiteFixture(){
 const {PGlite}=createRequire(resolve(process.env.PGLITE_DIR||'/tmp/first-offer-tools/node_modules','fixture.cjs'))('@electric-sql/pglite');
 const sql=new PGlite();
 const read=async p=>(await readFile(new URL('../../../../'+p,import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;','');
 for(const f of ['supabase_api_roles.stub.sql','supabase_storage.stub.sql'])await sql.exec(await read('supabase/tests/'+f));
 await sql.exec(`alter table m_people add column status text default 'active';
 create table m_auth_user_links(auth_user_id uuid,m_uid uuid,is_primary boolean);
 create table network_profiles(m_uid uuid,visibility text);
 create table orgs(id uuid primary key,slug text);
 create table org_members(org_id uuid,profile_id uuid,role text);
 grant select on m_people,m_auth_user_links,network_profiles,orgs,org_members to service_role;`);
 for(const f of ['member_fronts_v1.sql','managed_projects_v1.sql','managed_project_identity_v1.sql','customer_site_storage_v1.sql','customer_site_modules_v1.sql','customer_site_addresses_v1.sql','canonical_artist_bindings_v1.sql'])await sql.exec(await read('supabase/pending/'+f));
 for(const id of [A,B,O]){
  await sql.query('insert into auth.users(id) values($1)',[id]);await sql.query('insert into m_people(id) values($1)',[id]);await sql.query('insert into m_auth_user_links values($1,$1,true)',[id]);await sql.query("insert into network_profiles values($1,'public')",[id]);
 }
 await sql.query("insert into orgs values($1,'mccluster')",[O]);await sql.query("insert into org_members values($1,$1,'owner')",[O]);
 const identifier=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw Error('Invalid fixture identifier');return '"'+s+'"';};
 async function restFetch(input,init={}){
  const u=new URL(input),headers=new Headers(init.headers),response=(v,status=200)=>new Response(JSON.stringify(v),{status});
  if(u.pathname==='/auth/v1/user'){const id={alice:A,bob:B,operator:O}[headers.get('authorization')?.replace('Bearer fixture-','')];return response(id?{id}:{},id?200:401);}
  if(!u.pathname.startsWith('/rest/v1/'))throw Error('Unexpected external request: '+u.pathname);
  const name=u.pathname.split('/').pop();const params=[];let query;
  const param=v=>{params.push(v!==null&&typeof v==='object'?JSON.stringify(v):v);return '$'+params.length;};
  const where=()=>{const clauses=[];for(const [k,v]of u.searchParams){if(['select','limit','order'].includes(k))continue;if(v==='is.null')clauses.push(identifier(k)+' is null');else if(v.startsWith('eq.'))clauses.push(identifier(k)+'='+param(v.slice(3)));else throw Error('Unknown fixture filter');}return clauses.length?' where '+clauses.join(' and '):'';};
  try{
   await sql.exec('set role service_role');
   if(u.pathname.includes('/rpc/')){const b=JSON.parse(init.body);query='select '+identifier(name)+'('+Object.entries(b).map(([k,v])=>identifier(k)+'=>'+param(v)).join(',')+') as result';return response((await sql.query(query,params)).rows[0].result);}
   if(init.method==='POST'){const b=JSON.parse(init.body);query='insert into '+identifier(name)+'('+Object.keys(b).map(identifier).join(',')+') values('+Object.values(b).map(param).join(',')+') returning *';}
   else if(init.method==='PATCH'){const b=JSON.parse(init.body);query='update '+identifier(name)+' set '+Object.entries(b).map(([k,v])=>identifier(k)+'='+param(v)).join(',')+where()+' returning *';}
   else{const cols=u.searchParams.get('select')||'*';query='select '+(cols==='*'?'*':cols.split(',').map(identifier).join(','))+' from '+identifier(name)+where();const order=u.searchParams.get('order');if(order){const[k,d]=order.split('.');query+=' order by '+identifier(k)+(d==='desc'?' desc':' asc');}if(u.searchParams.has('limit'))query+=' limit '+Number(u.searchParams.get('limit'));}
   return response((await sql.query(query,params)).rows);
  }catch(e){return response({code:e.code,message:e.message},e.code==='23505'?409:400);}finally{await sql.exec('reset role');}
 }
 return {sql,restFetch,env:{SUPABASE_URL:'https://zmnhbrjyhxzhkxmhkexs.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture',CUSTOMER_SITE_OFFER_ENABLED:'true'},close:()=>sql.close()};
}
