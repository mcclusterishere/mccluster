// Diagnostic reproduction of an unresolved gap; successful exit CONFIRMS the bug.
// Usage: PGLITE_DIR=/tmp/productization-tools/node_modules node reproduce-stale-save.mjs /path/to/5e020833
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]);
const {freeSiteFixture}=await import(pathToFileURL(resolve(root,'workers/mccluster/test/support/free-site-fixture.mjs')));
const {handleManagedProjects}=await import(pathToFileURL(resolve(root,'workers/mccluster/src/managed-projects.js')));
const f=await freeSiteFixture();
const call=async(path,body)=>{
 const r=await handleManagedProjects(new Request('https://api.mccluster.org'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer fixture-alice'},body:body?JSON.stringify(body):undefined}),f.env,{fetchImpl:f.restFetch});
 return {status:r.status,body:await r.json()};
};
try {
 assert.equal((await call('/v1/projects',{slug:'stale-save',name:'Synthetic audit'})).status,201);
 const a=await call('/v1/projects/stale-save/edit'),b=await call('/v1/projects/stale-save/edit');
 assert.equal((await call('/v1/projects/stale-save/edit',{config:{words:{eyebrow:'First editor'}},expected_updated_at:a.body.updated_at})).status,200);
 assert.equal((await call('/v1/projects/stale-save/edit',{config:{words:{eyebrow:'Stale editor'}},expected_updated_at:b.body.updated_at})).status,200);
 assert.equal((await call('/v1/projects/stale-save/edit')).body.draft.words.eyebrow,'Stale editor');
 console.log('CONFIRMED GAP: second stale save returned 200 and overwrote first save; expected_updated_at is ignored. Diagnostic success is not release acceptance.');
} finally {await f.close();}
