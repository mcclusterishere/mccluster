import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/* deploy-cloudflare-pages.sh must refuse a project whose production branch is
   not main (a --branch=main upload would only be a preview) and a source SHA
   that is not on origin/main. curl and wrangler are faked on PATH. */
const ROOT=fileURLToPath(new URL('../..',import.meta.url));
const SCRIPT=join(ROOT,'scripts','deploy-cloudflare-pages.sh');
const mainSha=spawnSync('git',['-C',ROOT,'rev-parse','--verify','--quiet','origin/main^{commit}'],{encoding:'utf8'}).stdout.trim();

async function fixture(projectBody,curlExit=0){
  const root=await mkdtemp(join(tmpdir(),'pages-deploy-'));
  const input=join(root,'public'),bin=join(root,'bin');
  await mkdir(join(input,'js'),{recursive:true});
  await mkdir(join(input,'assets','img'),{recursive:true});
  await mkdir(bin);
  await writeFile(join(input,'index.html'),'<!doctype html><title>x</title>');
  await writeFile(join(input,'404.html'),'<!doctype html><title>x</title>');
  await writeFile(join(input,'js','tabbar.js'),'export {};');
  await writeFile(join(input,'assets','img','icon.png'),'png');
  await writeFile(join(bin,'curl'),`#!/bin/sh\ncat >/dev/null\nprintf '%s' '${projectBody}'\nexit ${curlExit}\n`);
  await writeFile(join(bin,'wrangler'),`#!/bin/sh\necho "$@" >> "${join(root,'wrangler.log')}"\n`);
  await chmod(join(bin,'curl'),0o755);await chmod(join(bin,'wrangler'),0o755);
  return {root,input,bin};
}
function run(f,sha=mainSha){
  return spawnSync('bash',[SCRIPT],{encoding:'utf8',env:{
    PATH:f.bin+':'+process.env.PATH,PAGES_PUBLIC_EXPORT:f.input,PAGES_RELEASE_DIR:join(f.root,'dist'),
    MC_SOURCE_SHA:sha,CLOUDFLARE_ACCOUNT_ID:'0'.repeat(32),CLOUDFLARE_API_TOKEN:'test-token'}});
}
async function deployed(f){try{return (await readFile(join(f.root,'wrangler.log'),'utf8')).includes('pages deploy')}catch{return false}}
const project=branch=>JSON.stringify({success:true,result:{name:'mccluster-web',production_branch:branch}});

test('a project whose production branch is main is deployed',{skip:!mainSha&&'no origin/main ref'},async()=>{
  const f=await fixture(project('main'));
  const r=run(f);
  assert.equal(r.status,0,r.stderr);
  assert.ok(await deployed(f));
});
test('any other production branch, a missing project or unreadable JSON fails closed',{skip:!mainSha&&'no origin/main ref'},async()=>{
  for(const [body,code] of [[project('production'),0],[JSON.stringify({success:true,result:{}}),0],['not json',0],['',22]]){
    const f=await fixture(body,code);
    const r=run(f);
    assert.equal(r.status,2,body+': '+r.stderr);
    assert.equal(await deployed(f),false,body+' must not upload');
  }
});
test('a source SHA that is not on origin/main is refused before any upload',{skip:!mainSha&&'no origin/main ref'},async()=>{
  const f=await fixture(project('main'));
  const r=run(f,'f'.repeat(40));
  assert.equal(r.status,2);
  assert.match(r.stderr,/not on origin\/main/);
  assert.equal(await deployed(f),false);
});
