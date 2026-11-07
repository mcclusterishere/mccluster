/* The hint preview runs the PRIM3 engine files copied from mcclusterishere/Prim3. They must be the
   exact files named in js/prim3-tactics/SOURCE.json: no local edits, no silent drift. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const dir=new URL('../../js/prim3-tactics/',import.meta.url);
test('vendored PRIM3 tactical engine files match their recorded source hashes',async()=>{
  const src=JSON.parse(await readFile(new URL('SOURCE.json',dir),'utf8'));
  assert.equal(src.repository,'mcclusterishere/Prim3');
  assert.match(src.commit,/^[0-9a-f]{40}$/);
  for(const [name,meta] of Object.entries(src.files)){
    const sha=createHash('sha256').update(await readFile(new URL(name,dir))).digest('hex');
    assert.equal(sha,meta.sha256,name+' differs from '+src.repository+'@'+src.commit+':'+meta.from);
  }
});
test('the preview page is noindex, owner only, loads the engine as a module behind the gate and never autoplays a move',async()=>{
  const html=await readFile(new URL('../../prim3-tactics-preview.html',import.meta.url),'utf8');
  assert.match(html,/<meta name="robots" content="noindex, nofollow">/);
  /* owner, 2026-11-03: the games are on the owner's private account; js/owner-only.mjs imports the engine after a yes */
  assert.match(html,/data-owner-gate data-owner-template="tacTpl" data-owner-load="js\/prim3-tactics\/preview\.mjs"/);
  assert.match(html,/<script type="module" src="js\/owner-only\.mjs\?v=578e683088fd"><\/script>/);
  assert.doesNotMatch(html,/<script[^>]+src="js\/prim3-tactics\/preview\.mjs"/,'the engine is never a page script');
  const js=await readFile(new URL('preview.mjs',dir),'utf8');
  assert.doesNotMatch(js,/moveUnit\([^)]*suggestion/,'the hint result is never fed into moveUnit');
});
