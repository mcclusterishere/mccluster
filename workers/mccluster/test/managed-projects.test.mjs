import test from 'node:test';
import assert from 'node:assert/strict';
import {handleManagedProjects} from '../src/managed-projects.js';
const alice='11111111-1111-4111-8111-111111111111', bob='22222222-2222-4222-8222-222222222222';
function fixture(){
 const rows=[],visibility={[alice]:'public',[bob]:'public'};
 const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
 const response=(b,status=200)=>new Response(JSON.stringify(b),{status});
 const fetchImpl=async(url,init={})=>{
  const u=new URL(url); if(u.pathname==='/auth/v1/user')return response({id:init.headers.authorization==='Bearer alice'?alice:bob});
  const table=u.pathname.split('/').pop();
  if(table==='m_auth_user_links')return response([{m_uid:u.searchParams.get('auth_user_id').slice(3)}]);
  if(table==='network_profiles')return response([{visibility:visibility[u.searchParams.get('m_uid').slice(3)]}]);
  assert.equal(table,'managed_projects');
  const match=r=>[...u.searchParams].every(([k,v])=> !v.startsWith('eq.') && v!=='is.null' || (v==='is.null'?r[k]==null:r[k]===v.slice(3)));
  if(init.method==='POST'){const r=JSON.parse(init.body);if(rows.some(x=>x.slug===r.slug))return response({code:'23505'},409);rows.push(r);return response([r]);}
  const selected=rows.filter(match);
  if(init.method==='PATCH'){for(const r of selected)Object.assign(r,JSON.parse(init.body));}
  return response(selected);
 };
 const call=async(path='',method='GET',body,who='alice')=>{const r=await handleManagedProjects(new Request('https://api.test/v1/projects'+path,{method,headers:who?{authorization:'Bearer '+who}:{},body:body?JSON.stringify(body):undefined}),env,{fetchImpl});return {status:r.status,body:await r.json()};};
 return {call,rows,visibility};
}
test('two existing nonadmin owners: create, private draft, publish, isolation, collision and tombstone',async()=>{
 const {call,rows}=fixture();
 assert.equal((await call('','POST',{slug:'alice-project',name:'Alice'})).status,201);
 assert.equal((await call('','POST',{slug:'bob-project',name:'Bob'},'bob')).status,201);
 assert.equal((await call('/alice-project', 'GET',null,null)).status,404);
 assert.equal((await call('/alice-project/edit','GET',null,'bob')).status,404);
 assert.equal((await call('/alice-project/edit','POST',{config:{},publish:true},'bob')).status,404);
 assert.deepEqual((await call('','GET',null,'bob')).body.projects.map(p=>p.slug),['bob-project']);
 assert.equal((await call('','POST',{slug:'alice-project',name:'Takeover'},'bob')).status,409);
 assert.equal((await call('/alice-project/edit','POST',{config:{},owner_user_id:bob})).status,400);
 assert.equal((await call('/alice-project/edit','POST',{config:{words:{eyebrow:'Draft only'}}})).status,200);
 assert.equal((await call('/alice-project','GET',null,null)).status,404);
 assert.equal((await call('/alice-project/edit','POST',{config:{words:{eyebrow:'Public'}},publish:true})).status,200);
 const publicPage=await call('/alice-project','GET',null,null);assert.equal(publicPage.status,200);assert.equal(publicPage.body.draft,undefined);assert.equal(publicPage.body.owner_user_id,undefined);
 assert.equal((await call('/alice-project/published','DELETE',null,'bob')).status,404);
 assert.equal((await call('/alice-project/published','DELETE')).status,200);
 assert.equal((await call('/alice-project','GET',null,null)).body.code,'project_unavailable');
 assert.equal((await call('/alice-project','DELETE')).status,200);
 assert.equal((await call('/alice-project/edit','POST',{config:{},publish:true})).status,403);
 assert.equal((await call('','POST',{slug:'alice-project',name:'Reuse'},'bob')).status,409);
 assert.equal(rows[0].owner_user_id,alice);
});
test('private profiles, reserved names, invalid media, no auth and missing storage fail closed',async()=>{
 const {call,visibility}=fixture();
 assert.equal((await call('','POST',{slug:'vaunt',name:'Claim Vaunt'})).status,400);
 assert.equal((await call('','POST',{slug:'new-project',name:'Project',registry_key:'vaunt'})).status,400);
 assert.equal((await call('','GET',null,null)).status,401);
 await call('','POST',{slug:'my-project',name:'Project'});
 visibility[alice]='private';
 assert.equal((await call('/my-project/edit','POST',{config:{},publish:true})).status,409);
 assert.equal((await call('/my-project/edit')).body.publish_blocker,'private_profile');
 assert.equal((await call('/my-project/edit','POST',{config:{}})).status,200);
 visibility[alice]='public'; await call('/my-project/edit','POST',{config:{},publish:true});
 visibility[alice]='private';assert.equal((await call('/my-project','GET',null,null)).status,404);
 assert.equal((await call('/my-project/edit','POST',{config:{media:{cabin:{kind:'video',src:'https://db.test/storage/v1/object/public/front-media/'+bob+'/cabin.mp4'}}}})).status,400);
 const r=await handleManagedProjects(new Request('https://api.test/v1/projects'),{}); assert.equal(r.status,503);
});

test('same owner project media is isolated from personal page and other projects',async()=>{
 const {call}=fixture();
 for(const slug of ['project-one','project-two']) await call('','POST',{slug,name:slug});
 const prefix='https://db.test/storage/v1/object/public/front-media/'+alice+'/';
 assert.equal((await call('/project-one/edit')).body.media_prefix,prefix+'projects/project-one/');
 const config=src=>({media:{cabin:{kind:'video',src}}});
 assert.equal((await call('/project-one/edit','POST',{config:config(prefix+'personal.mp4')})).status,400);
 assert.equal((await call('/project-one/edit','POST',{config:config(prefix+'projects/project-two/cabin.mp4')})).status,400);
 assert.equal((await call('/project-one/edit','POST',{config:config(prefix+'projects/project-one/cabin.mp4'),publish:true})).status,200);
 assert.equal((await call('/project-one','GET',null,null)).body.config.media.cabin.src,prefix+'projects/project-one/cabin.mp4');
});
