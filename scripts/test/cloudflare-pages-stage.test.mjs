import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, lstat, symlink, truncate } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SCRIPT=fileURLToPath(new URL('../stage-cloudflare-pages.mjs',import.meta.url));
const SHA='a'.repeat(40);
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'pages-safe-release-'));
  const input=join(root,'public'),output=join(root,'stage');
  await mkdir(join(input,'js'),{recursive:true});
  await mkdir(join(input,'assets','img'),{recursive:true});
  await writeFile(join(input,'index.html'),'<!doctype html><html><body>McCluster</body></html>');
  await writeFile(join(input,'404.html'),'<!doctype html><html><body>Not found</body></html>');
  await writeFile(join(input,'js','tabbar.js'),'export const bar=true;');
  await writeFile(join(input,'assets','img','icon.png'),'fixture');
  await mkdir(join(input,'data'),{recursive:true});
  await writeFile(join(input,'data','environments.json'),'{"environments":{"here":{"bg":"assets/img/icon.png"}}}');
  return {root,input,output};
}
function run({input,output},sha=SHA){
  return spawnSync(process.execPath,[SCRIPT,'--input',input,'--output',output,'--commit',sha],{encoding:'utf8'});
}
async function exists(path){try{return (await lstat(path)).isFile()}catch{return false}}
test('public-only staging strips even source accidentally retained by legacy gh-pages export',async()=>{
  const f=await fixture();
  await mkdir(join(f.input,'core','src'),{recursive:true});
  await mkdir(join(f.input,'platform','config'),{recursive:true});
  await mkdir(join(f.input,'data','analytics'),{recursive:true});
  await writeFile(join(f.input,'core','src','broker-edge-auth.mjs'),'backend secret-shaped source');
  await writeFile(join(f.input,'platform','config','server-inventory.json'),'{}');
  await writeFile(join(f.input,'data','analytics','application-schema-inventory.json'),'{}');
  await writeFile(join(f.input,'.mcp.json'),'{"internal":true}');
  await writeFile(join(f.input,'CNAME'),'matthew.mccluster.org');
  await mkdir(join(f.input,'assets','3d','prim3-site0'),{recursive:true});
  await writeFile(join(f.input,'assets','3d','prim3-site0','MasterFacility.glb'),'private authored geometry');
  const r=run(f);
  assert.equal(r.status,0,r.stderr);
  assert.equal(await exists(join(f.output,'core','src','broker-edge-auth.mjs')),false);
  assert.equal(await exists(join(f.output,'.mcp.json')),false);
  assert.equal(await exists(join(f.output,'platform','config','server-inventory.json')),false);
  assert.equal(await exists(join(f.output,'data','analytics','application-schema-inventory.json')),false);
  assert.equal(await exists(join(f.output,'CNAME')),false);
  assert.equal(await exists(join(f.output,'assets','3d','prim3-site0','MasterFacility.glb')),false);
  assert.equal(await exists(join(f.output,'data','environments.json')),true,'album presentation environments remain public');
  assert.equal(await exists(join(f.output,'js','tabbar.js')),true);
  const excluded=JSON.parse(await readFile(f.output+'.excluded.json','utf8'));
  assert.ok(excluded.excluded_paths.includes('core/'));
  assert.ok(excluded.excluded_paths.some(p=>p.startsWith('assets/3d/')));
  assert.equal(await exists(join(f.output,'excluded.json')),false,'operator report is never web-delivered');
  const record=JSON.parse(await readFile(join(f.output,'mccluster-release.json'),'utf8'));
  assert.equal(record.source_sha,SHA);
  assert.equal(record.asset_count,6);
  assert.ok(/^[0-9a-f]{64}$/.test(record.manifest_sha256));
});
test('raw private main repository is refused instead of silently sanitized',async()=>{
  const f=await fixture();
  await writeFile(join(f.input,'AGENTS.md'),'Control security');
  const r=run(f);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/PRIVATE SOURCE CHECKOUT/);
});
test('file-size, suspicious secrets, and unknown signatures are fail-closed',async()=>{
  for(const mode of ['big','secret','sha']){
    const f=await fixture();
    if(mode==='big'){const path=join(f.input,'assets','img','huge.mp4');await writeFile(path,'');await truncate(path,25*1024*1024+1)}
    if(mode==='secret')await writeFile(join(f.input,'js','public.js'),'const leaked='+JSON.stringify(['sk','live','12345678901234567890'].join('_'))+';');
    const r=run(f,mode==='sha'?'not-a-sha':SHA);
    assert.notEqual(r.status,0,mode+' must be refused');
  }
});
test('public export does not follow symlinks into private runtime files',async()=>{
  const f=await fixture();
  await symlink(join(f.root,'outside-secret'),join(f.input,'js','link.js'));
  const r=run(f);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/Symbolic link/);
});

test('a credential near the end of a >2 MiB JavaScript bundle cannot bypass the streaming scan',async()=>{
  const f=await fixture();
  const fake=['sk','live','9876543210987654321098765'].join('_');
  await writeFile(join(f.input,'js','giant.js'),'x'.repeat(2*1024*1024+512)+fake);
  const r=run(f);
  assert.notEqual(r.status,0,'large text must be scanned all the way through');
  assert.match(r.stderr,/Possible secret/);
});
