import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const workerRoot=resolve(here,'..');
const repoRoot=resolve(workerRoot,'..','..');

async function exists(path){try{await access(path,constants.F_OK);return true}catch{return false}}

test('legacy backend deployment entrypoints stay disabled',async()=>{
  assert.equal(await exists(resolve(repoRoot,'apps/api/Dockerfile')),false);
  assert.equal(await exists(resolve(repoRoot,'platform/cloudflare-edge/wrangler.jsonc')),false);
  const legacyApi=JSON.parse(await readFile(resolve(repoRoot,'apps/api/package.json'),'utf8'));
  const legacyEdge=JSON.parse(await readFile(resolve(repoRoot,'platform/cloudflare-edge/package.json'),'utf8'));
  assert.match(legacyApi.scripts.start,/DISABLED/);
  assert.match(legacyApi.scripts.dev,/DISABLED/);
  assert.match(legacyEdge.scripts.deploy,/DISABLED/);
  assert.match(legacyEdge.scripts.dev,/DISABLED/);
});

test('completed domain cutover cannot regress to the old runbook',async()=>{
  const [readme,cutover]=await Promise.all([
    readFile(resolve(repoRoot,'README.md'),'utf8'),
    readFile(resolve(repoRoot,'docs/domain-cutover.md'),'utf8')
  ]);
  assert.doesNotMatch(readme,/Cutover pending/i);
  assert.match(readme,/Cutover complete/i);
  assert.match(cutover,/Status:\s*complete/i);
});

test('heavy Site 0 source artifacts stay out of the active git tree',async()=>{
  assert.equal(await exists(resolve(repoRoot,'PRIM3+site+zero+perfect+model.zip')),false);
  assert.equal(await exists(resolve(repoRoot,'_unfinished/site0-game/viewer/assets/b3/site0_b3_full_res.spz')),false);
  assert.equal(await exists(resolve(repoRoot,'_unfinished/site0-game/viewer/assets/l3/site0_l3_full_res.spz')),false);
  const ignore=await readFile(resolve(repoRoot,'.gitignore'),'utf8');
  assert.match(ignore,/PRIM3\+site\+zero\+perfect\+model\.zip/);
  assert.match(ignore,/_full_res\.spz/);
});

test('retired material skin remains an inert stub',async()=>{
  const css=await readFile(resolve(repoRoot,'css/here-material.css'),'utf8');
  assert.match(css,/REMOVED 2026-08-15/);
  assert.doesNotMatch(css,/background-image|box-shadow|linear-gradient|url\(/i);
});
