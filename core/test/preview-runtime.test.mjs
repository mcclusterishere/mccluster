import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
const root = await mkdtemp(path.join(tmpdir(),'owned-preview-'));
const repos = path.join(root,'repos'), previews=path.join(root,'previews'), source=path.join(root,'source'), repo=path.join(repos,'demo');
process.env.MCCLUSTER_REPO_ROOT = repos;
process.env.MCCLUSTER_WORKTREE_ROOT = path.join(root,'worktrees');
process.env.MCCLUSTER_PREVIEW_ROOT = previews;
process.env.MCCLUSTER_PREVIEW_ENABLED = '1';
process.env.MCCLUSTER_PREVIEW_PUBLIC_BASE = 'https://preview.example.test/p';
process.env.MCCLUSTER_CODE_REPOS = 'owner/demo';
const { previewDeploy } = await import('../src/executors/preview-deploy.mjs');
const { createPreviewServer, cleanupExpired } = await import('../src/preview-gateway.mjs');
const { confinedPath, publishAssets } = await import('../src/preview-policy.mjs');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,stdio:'pipe',env:{...process.env,GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.test',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.test'}}).toString().trim();
let server, base, result;
before(async()=>{
 await mkdir(source); await mkdir(repos); await mkdir(previews);
 git(source,'init','--initial-branch=main');
 await writeFile(path.join(source,'index.html'),'<html><body>Owned preview<script src="app.js"></script></body></html>');
 await writeFile(path.join(source,'app.js'),'window.preview = true;');
 await writeFile(path.join(source,'.env'),'SENTINEL_DO_NOT_PUBLISH=test-only');
 await writeFile(path.join(source,'credentials.json'),'{"sentinel":"test-only"}');
 git(source,'add','.');git(source,'commit','-m','static fixture');
 git(repos,'clone',source,repo);
 server=createPreviewServer({root:previews});server.listen(0,'127.0.0.1');await once(server,'listening');
 base=`http://127.0.0.1:${server.address().port}`;
 result=await previewDeploy({id:'durable-job-1',target_id:'owner/demo',input:{ref:'main'}});
});
after(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await rm(root,{recursive:true,force:true});});
test('real Git ref publishes a reachable static preview with exact commit and expiry',async()=>{
 assert.equal(result.commit,git(repo,'rev-parse','origin/main'));
 assert.equal(result.provider,'mccluster-core');assert.equal(result.production,false);
 const response=await fetch(`${base}/p/${result.slug}/`);
 assert.equal(response.status,200);assert.match(await response.text(),/Owned preview/);
 assert.match(response.headers.get('content-security-policy'),/sandbox allow-scripts/);
 assert.doesNotMatch(response.headers.get('content-security-policy'),/allow-same-origin/);
 const js=await fetch(`${base}/p/${result.slug}/app.js`);
 assert.match(js.headers.get('content-type'),/javascript/);
});
test('job redelivery is idempotent and never moves the repository branch',async()=>{
 const before=git(repo,'rev-parse','HEAD');
 assert.deepEqual(await previewDeploy({id:'durable-job-1',target_id:'owner/demo',input:{ref:'main'}}),result);
 assert.equal(git(repo,'rev-parse','HEAD'),before);
});
test('dotfiles, credentials and metadata cannot be fetched',async()=>{
 for(const file of ['.env','.git','credentials.json','metadata.json']){
   assert.equal((await fetch(`${base}/p/${result.slug}/${file}`)).status,404);
 }
 await assert.rejects(access(path.join(previews,result.slug,'public','.env')));
});
test('HEAD returns headers without a body and unsupported methods are refused',async()=>{
 const response=await fetch(`${base}/p/${result.slug}/`,{method:'HEAD'});
 assert.equal(response.status,200);assert.equal(await response.text(),'');
 assert.equal((await fetch(`${base}/p/${result.slug}/`,{method:'POST'})).status,405);
});
test('symlinked parent directories cannot expose external files',async()=>{
 const external=path.join(root,'private');await mkdir(external);await writeFile(path.join(external,'file.txt'),'private');
 await symlink(external,path.join(previews,result.slug,'public','linked'));
 assert.equal((await fetch(`${base}/p/${result.slug}/linked/file.txt`)).status,404);
 await assert.rejects(confinedPath(path.join(previews,result.slug,'public'),'linked/file.txt'),/symbolic/);
 await rm(path.join(previews,result.slug,'public','linked'));
});
test('invalid TTLs, unsafe directories and unapproved repositories fail closed',async()=>{
 for(const ttl of [NaN,0,169]) await assert.rejects(previewDeploy({id:'x',target_id:'owner/demo',input:{ref:'main',ttl_hours:ttl}}),/TTL/);
 await assert.rejects(previewDeploy({id:'x',target_id:'owner/demo',input:{ref:'main',directory:'../private'}}),/inside repository/);
 await assert.rejects(previewDeploy({id:'x',target_id:'other/demo',input:{ref:'main'}}),/allowlisted/);
});
test('publication quotas reject a site before it can become visible',async()=>{
 const destination=path.join(root,'limited');await mkdir(destination);
 await assert.rejects(publishAssets(source,destination,{maxBytes:1,maxFiles:10}),/limits/);
});
test('invalid and expired metadata cannot become immortal previews',async()=>{
 const filename=path.join(previews,result.slug,'metadata.json');
 await writeFile(filename,JSON.stringify({...result,expires_at:'invalid'}));
 assert.equal((await fetch(`${base}/p/${result.slug}/`)).status,503);
 await cleanupExpired(previews);await access(filename);
 await writeFile(filename,JSON.stringify({...result,expires_at:'2000-01-01T00:00:00Z'}));
 assert.equal((await fetch(`${base}/p/${result.slug}/`)).status,410);
 await cleanupExpired(previews);await assert.rejects(access(filename));
});
test('public gateway never inherits Core credentials and builder has a distinct identity',async()=>{
 const gateway=await readFile(new URL('../systemd/mccluster-preview-gateway.service',import.meta.url),'utf8');
 const builder=await readFile(new URL('../systemd/mccluster-preview-build@.service',import.meta.url),'utf8');
 assert.doesNotMatch(gateway,/^EnvironmentFile=.*core\.env/m);
 assert.match(builder,/DynamicUser=yes/);assert.match(builder,/TemporaryFileSystem=\/:ro/);
 assert.doesNotMatch(builder,/EnvironmentFile=/);
});
