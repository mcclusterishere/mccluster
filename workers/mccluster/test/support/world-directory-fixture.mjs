import {handleWorldDirectory} from '../../src/world-directory.js';
export const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
export function directoryFixture(){
 const tables={world_directory_listings:[],network_profiles:[{m_uid:A,visibility:'public',discoverable:true},{m_uid:B,visibility:'public',discoverable:true}],managed_projects:[{slug:'alpha',name:'Alpha',owner_user_id:A,m_uid:A,published_at:'2026-01-01',published:{},removed_at:null},{slug:'beta',name:'Beta',owner_user_id:B,m_uid:B,published_at:'2026-01-01',published:{},removed_at:null}],member_fronts:[]};
 const env={SUPABASE_URL:'https://db.fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture'},calls=[];
 const json=(b,status=200)=>new Response(JSON.stringify(b),{status});
 const fetchImpl=async(input,init={})=>{
  const u=new URL(input);calls.push(u.toString());
  if(u.pathname==='/auth/v1/user')return json({id:new Headers(init.headers).get('authorization')==='Bearer alice'?A:B});
  const table=u.pathname.split('/').pop();
  if(table==='m_auth_user_links')return json([{m_uid:u.searchParams.get('auth_user_id').slice(3)}]);
  if(!tables[table])return json({code:'42P01'},404);
  const matches=r=>[...u.searchParams].every(([k,v])=>{
   if(v.startsWith('eq.'))return String(r[k])===v.slice(3);
   if(v==='is.null')return r[k]==null;
   if(v==='not.is.null')return r[k]!=null;
   if(v.startsWith('in.('))return v.slice(4,-1).split(',').includes(r[k]);
   if(v.startsWith('fts(simple).'))return v.slice(12).split(' & ').every(w=>(r.title+' '+r.description+' '+r.category).toLowerCase().includes(w.toLowerCase()));
   if(v.startsWith('ilike.'))return (r.location_label+' '+r.service_area).toLowerCase().includes(v.slice(7,-1).toLowerCase());
   return true;
  });
  if(init.method==='POST'){const b=JSON.parse(init.body);if(tables[table].some(r=>['owner_user_id','source_kind','source_key','entity_type'].every(k=>r[k]===b[k])))return json({code:'23505'},409);b.id='33333333-3333-4333-8333-'+String(tables[table].length+1).padStart(12,'0');tables[table].push(b);return json([b]);}
  const rows=tables[table].filter(matches).slice(0,Number(u.searchParams.get('limit'))||1000);
  if(init.method==='PATCH')rows.forEach(r=>Object.assign(r,JSON.parse(init.body)));
  if(init.method==='DELETE')tables[table]=tables[table].filter(r=>!rows.includes(r));
  return json(rows);
 };
 const call=async(path='',method='GET',body,who=null)=>{const r=await handleWorldDirectory(new Request('https://api.fixture/v1/world-directory'+path,{method,headers:who?{authorization:'Bearer '+who}:{},body:body?JSON.stringify(body):undefined}),env,{fetchImpl});return{status:r.status,body:await r.json()};};
 return {tables,env,fetchImpl,call,calls};
}
