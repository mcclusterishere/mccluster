import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/* The scanner lives in its own always-on workflow now (secret-scan.yml:
   every path, every file type). The step's script is lifted out of the
   YAML and run against synthetic repositories, so the test exercises the
   exact bash CI runs: nothing is re-implemented here. */
const file = new URL('../../.github/workflows/secret-scan.yml', import.meta.url);
const contract = new URL('../../.github/workflows/production-security-contract.yml', import.meta.url);
function execute(binary,args,opts={}) {
  const p=spawnSync(binary,args,{encoding:'utf8',...opts});
  if(p.error) throw p.error;
  return p;
}
async function scannerSnippet() {
  const content=await readFile(file,'utf8');
  const section=content.split('      - name: Reject committed production secrets')[1];
  assert.ok(section, 'secret-scan workflow scanner step absent');
  const lines=section.split('\n').filter(x=>x.startsWith('          ')).map(x=>x.slice(10));
  const snippet=lines.join('\n').trim();
  assert.match(snippet,/git grep -n -E -e/);
  assert.match(snippet,/result=\$\?/);
  return 'set -euo pipefail\n'+snippet+'\n';
}
async function scan(files) {
  const dir=await mkdtemp(path.join(tmpdir(),'mcc-security-scan-'));
  try{
    assert.equal(execute('git',['init','-q'],{cwd:dir}).status,0);
    for (const [name,body] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir,name)),{recursive:true});
      await writeFile(path.join(dir,name),body);
    }
    assert.equal(execute('git',['add','-A'],{cwd:dir}).status,0);
    return execute('bash',['-c',await scannerSnippet()],{cwd:dir});
  }finally{await rm(dir,{recursive:true,force:true});}
}
/* the synthetic credentials are assembled at runtime so this file never
   carries a matching string itself */
const fake = {
  pem: '-'.repeat(5)+'BEGIN '+'TEST PRIVATE KEY'+'-'.repeat(5),
  ssh: '-'.repeat(5)+'BEGIN '+'OPENSSH PRIVATE KEY'+'-'.repeat(5),
  sbSecret: 'sb_'+'secret_'+'A1b2C3d4E5f6G7h8I9j0',
  jwt: 'eyJ'+'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'+'.'+'eyJ'+'yb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxfQ'+'.'+'Zm9vYmFyYmF6cXV4cXV1eHF1dXhxdXV4cXV1eA',
  whsec: 'whsec_'+'Ab12Cd34Ef56Gh78Ij90Kl12',
  rkLive: 'rk_'+'live_'+'Ab12Cd34Ef56Gh78Ij90',
  skTest: 'sk_'+'test_'+'Ab12Cd34Ef56Gh78Ij90',
  twilio: 'AC'+'0123456789abcdef0123456789abcdef',
  slack: 'xox'+'b-'+'1234567890-abcdefghij',
  google: 'AIza'+'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S',
  anthropic: 'sk-'+'ant-'+'api03-Ab12Cd34Ef56Gh78Ij90Kl12',
};
test('secret scan succeeds for no matches and refuses a synthetic private key marker',async()=>{
  const clean=await scan({'sample.js':'export const safe=1;\n'});
  assert.equal(clean.status,0,clean.stderr);
  const bad=await scan({'sample.js':fake.pem+'\n'});
  assert.equal(bad.status,1);
  assert.match(bad.stderr,/Potential committed production secret matched/);
});
test('every widened credential format is refused, Markdown included',async()=>{
  for (const [name,value] of Object.entries(fake)) {
    for (const ext of ['js','md']) {
      const r=await scan({[`notes.${ext}`]:`see ${value} here\n`});
      assert.equal(r.status,1,`${name} in .${ext} must be refused (stdout: ${r.stdout.slice(0,120)})`);
      assert.match(r.stderr,/Potential committed production secret matched/,name);
    }
  }
});
test('the public Supabase key, identifiers that merely end in _live_, and .example files pass',async()=>{
  const r=await scan({
    'js/live.js':'var SB_KEY = "sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";\nconst network_live_ping = network_live_Ab12Cd34Ef56Gh78Ij90;\n',
    'docs/notes.md':'The anon key is public by design; RLS is the wall. network_live_Ab12Cd34Ef56Gh78Ij90 is a job name.\n',
    'core/core.env.example':`STRIPE_KEY=${fake.rkLive}\nSUPABASE_SERVICE_ROLE_KEY=${fake.jwt}\n`,
  });
  assert.equal(r.status,0,r.stderr+r.stdout);
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
test('the scan is always on: no path filter, PRs and main, and the old path-filtered step is gone',async()=>{
  const yml=await readFile(file,'utf8');
  assert.match(yml,/^on:\n  pull_request:\n    branches: \[main\]\n  push:\n    branches: \[main\]\n/m,'every pull request into main, every push to main');
  assert.doesNotMatch(yml,/paths:/,'no path filter');
  assert.doesNotMatch(yml,/':!\*\.md'/,'Markdown is scanned');
  assert.match(yml,/^permissions:\n  contents: read/m);
  const old=await readFile(contract,'utf8');
  assert.doesNotMatch(old,/Reject obvious committed production secrets/,'the path-filtered copy of the scanner is retired');
});
