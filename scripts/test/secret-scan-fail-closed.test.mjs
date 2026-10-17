import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../..', import.meta.url);
const file = new URL('../../.github/workflows/production-security-contract.yml', import.meta.url);
function execute(binary,args,opts={}) {
  const p=spawnSync(binary,args,{encoding:'utf8',...opts});
  if(p.error) throw p.error;
  return p;
}
async function scannerSnippet() {
  const content=await readFile(file,'utf8');
  const section=content.split('      - name: Reject obvious committed production secrets')[1]?.split('      - name: Validate Supabase function auth manifest')[0];
  assert.ok(section, 'security workflow scanner step absent');
  const lines=section.split('\n').filter(x=>x.startsWith('          ')).map(x=>x.slice(10));
  const snippet=lines.join('\n').trim();
  assert.match(snippet,/git grep -n -E -e/);
  assert.match(snippet,/result=\$\?/);
  return 'set -euo pipefail\n'+snippet+'\n';
}
test('secret scan succeeds for no matches and refuses a synthetic private key marker',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'mcc-security-scan-'));
  try{
    assert.equal(execute('git',['init','-q'],{cwd:dir}).status,0);
    await writeFile(path.join(dir,'sample.js'),'export const safe=1;\n');
    assert.equal(execute('git',['add','sample.js'],{cwd:dir}).status,0);
    const script=await scannerSnippet();
    assert.equal(execute('bash',['-c',script],{cwd:dir}).status,0);
    const marker='-'.repeat(5)+'BEGIN '+'TEST PRIVATE KEY'+'-'.repeat(5);
    await writeFile(path.join(dir,'sample.js'),marker+'\n');
    assert.equal(execute('git',['add','sample.js'],{cwd:dir}).status,0);
    const bad=execute('bash',['-c',script],{cwd:dir});
    assert.equal(bad.status,1);
    assert.match(bad.stderr,/Potential committed production secret matched/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('secret scanner option errors cannot be treated as clean',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'mcc-security-scan-failure-'));
  try{
    const bin=path.join(dir,'bin');await mkdir(bin);
    await writeFile(path.join(bin,'git'),'#!/bin/sh\nexit 129\n',{mode:0o755});
    const result=execute('bash',['-c',await scannerSnippet()],{cwd:dir,env:{...process.env,PATH:bin+':'+process.env.PATH}});
    assert.equal(result.status,129);
    assert.match(result.stderr,/Secret scanner failed/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
