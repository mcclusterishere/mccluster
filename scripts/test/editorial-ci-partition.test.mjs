import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../e2e/world-screen.e2e.mjs',import.meta.url),'utf8');
const workflow=await readFile(new URL('../../.github/workflows/human-uprise-editorial.yml',import.meta.url),'utf8');
test('CI preserves the composer as a required fresh-browser job and ordinary editorial still selects it',()=>{
 assert.match(workflow,/suite: \[database, editorial, editorial-video-composer,/);
 assert.match(workflow,/editorial\) E2E_EXCLUDE=editorial-video-composer E2E_ONLY=editorial node scripts\/e2e\/world-screen.e2e.mjs/);
 assert.match(workflow,/editorial-video-composer\) E2E_ONLY=editorial-video-composer node scripts\/e2e\/world-screen.e2e.mjs/);
 assert.match(source,/if \(runs\('editorial-video-composer'\)/);
 const expr=source.match(/const runs = \(scope\) => (.+);/)[1];
 const select=(only,exclude,scope)=>Function('ONLY','EXCLUDE','scope','return '+expr)(only,exclude,scope);
 for(const scope of ['editorial','editorial-state','editorial-members','editorial-video','editorial-video-composer']){
  assert.equal(select('editorial','',scope),true);
  assert.equal(Number(select('editorial','editorial-video-composer',scope))+Number(select('editorial-video-composer','',scope)),1,scope+' executes exactly once across CI jobs');
 }
 assert.match(source,/process.exit\(failed.length \|\| results.length === 0 \? 1 : 0\)/);
 const composer=source.slice(source.indexOf("const scope = 'editorial-video-composer'"),source.indexOf('/* Create: a cover'));
 assert.equal((composer.match(/check\(scope,/g)||[]).length,8);
 assert.match(composer,/await page.click\('#mnPost'\)/);
 assert.doesNotMatch(composer,/force\s*:\s*true|\.evaluate\([^\n]*\.click\(/);
});
