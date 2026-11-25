import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {handleCreatorDomainHost} from '../src/creator-domain-host.js';
import {handleManagedProjects} from '../src/managed-projects.js';
import {handleProjectTiles} from '../src/project-tiles.js';
import {projectTilesFixture,A,B,ORG} from './support/project-tiles-fixture.mjs';

test('custom host composes real project/tiles authorities over pending SQL; owner/id, unpublish and front switch fail closed',{skip:!process.env.PGLITE_DIR},async()=>{
 const f=await projectTilesFixture();
 try {
  // The shared fixture models id alone. Replace that model with the real pending
  // domain migrations so this composed check exercises their identity guards.
  await f.sql.exec('alter table managed_projects drop column id');
  for(const file of ['creator_domains_v1.sql','creator_domain_targets_v1.sql'])await f.sql.exec(await readFile(new URL('../../../supabase/pending/'+file,import.meta.url),'utf8'));
  const id=(await f.db.select('managed_projects',{slug:'eq.alpha'}))[0].id;
  await f.sql.query("insert into creator_domains(auth_user_id,handle,hostname,verification_token,target_type,target_id,status,ssl_status,ownership_verified_at) values($1,'alpha','www.customer.org','fixture-proof','managed_project',$2,'active','active',now())",[A,id]);
  const document=structuredClone((await f.call('/templates')).body.templates[0].definition);
  const assets=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
  for(let i=0;i<3;i++){await f.prepare(assets[i],document.tiles[i].kind);document.tiles[i].source_ref={type:'media_asset',key:assets[i]};}
  document.title='Published custom-domain fixture';
  assert.equal((await f.call('','PUT',{expected_revision:0,document})).status,200);
  assert.equal((await f.call('/publish','POST',{expected_revision:1,confirm_public:true,org_id:ORG})).status,200);
  const env={...f.env,CREATOR_DOMAINS_ENABLED:'true',CREATOR_DOMAINS_ZONE_ID:'fixture',CREATOR_DOMAINS_API_TOKEN:'fixture',CREATOR_DOMAINS_CNAME:'sites.mccluster.org'};
  const pages=[];let expectedOverride={},tilesOverride={};
  const fetchImpl=async(input,init={})=>{
   const u=new URL(input);
   if(u.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:5,data:'sites.mccluster.org.'}]});
   if(u.hostname==='matthew.mccluster.org'){
    assert.ok(['/front.html','/website-studio-view.html'].includes(u.pathname));pages.push(u.pathname);
    return new Response(await readFile(new URL('../../../'+u.pathname.slice(1),import.meta.url),'utf8'),{headers:{'content-type':'text/html'}});
   }
   return f.restFetch(input,init);
  };
  const assertClean=(req,options)=>{assert.equal(req.headers.get('authorization'),null);assert.equal(req.headers.get('cookie'),null);assert.equal(new URL(req.url).search,'');assert.equal(options.expectedAuthUserId,A);assert.equal(options.expectedProjectId,id);};
  const projectPublic=(req,e,options)=>{assertClean(req,options);return handleManagedProjects(req,e,{...options,db:f.db,...expectedOverride});};
  const projectTilesPublic=(req,e,options)=>{assertClean(req,options);return handleProjectTiles(req,e,{...options,db:f.db,...tilesOverride});};
  const call=(path='/')=>handleCreatorDomainHost(new Request('https://www.customer.org'+path,{headers:{authorization:'Bearer fixture-bob',cookie:'session=private'}}),env,{fetchImpl,authorizeEntitlement:async()=>true,projectPublic,projectTilesPublic});
  const shell=await call('/?project=beta');assert.equal(shell.status,200);assert.equal(shell.headers.get('cache-control'),'no-store');
  const html=await shell.text();assert.match(html,/window\.MCC_STUDIO_HOST=\{"handle":"alpha","project":"alpha","api":"https:\/\/www.customer.org"\}/);assert.equal(pages.at(-1),'/website-studio-view.html');
  const data=await call('/v1/projects/alpha/tiles/public');assert.equal(data.status,200);const payload=await data.json();assert.equal(payload.document.title,document.title);assert.match(payload.media['tile-1:content'].url,/\/object\/sign\/mnet-media\//);assert.equal(payload.draft,undefined);
  assert.equal((await call('/v1/projects/beta/tiles/public')).status,404);
  for(const mismatch of [{expectedAuthUserId:B},{expectedProjectId:B}]){
   expectedOverride=mismatch;assert.equal((await call()).status,404);expectedOverride={};
   tilesOverride=mismatch;assert.equal((await call('/v1/projects/alpha/tiles/public')).status,404);tilesOverride={};
  }
  await assert.rejects(f.sql.query('update managed_projects set owner_user_id=$1 where slug=\'alpha\'',[B]),/immutable/);
  await assert.rejects(f.sql.query('update managed_projects set id=$1 where slug=\'alpha\'',[B]),/immutable/);
  const edit=async(path,method,body)=>handleManagedProjects(new Request('https://api.mccluster.org/v1/projects/alpha'+path,{method,headers:{authorization:'Bearer fixture-alice'},...(body?{body:JSON.stringify(body)}:{})}),env,{db:f.db,fetchImpl});
  assert.equal((await edit('/published','DELETE')).status,200);assert.equal((await call()).status,404);
  assert.equal((await edit('/edit','POST',{config:{words:{eyebrow:'Published front fixture'}},publish:true})).status,200);
  const frontShell=await call();assert.equal(frontShell.status,200);assert.match(await frontShell.text(),/window\.MCC_FRONT_HOST=/);assert.equal(pages.at(-1),'/front.html');
  const front=await call('/v1/projects/alpha');assert.equal(front.status,200);assert.equal((await front.json()).config.words.eyebrow,'Published front fixture');
  assert.equal((await call('/v1/projects/alpha/tiles/public')).status,404);
  await f.sql.query("update network_profiles set visibility='private' where m_uid=$1",[A]);assert.equal((await call()).status,404);
 } finally {await f.close();}
});
