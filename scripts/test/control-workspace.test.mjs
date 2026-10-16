import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import '../../js/control-room/workspace-core.js';
const C=globalThis.CR.workspaceCore;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const owner={org_id:'house',slug:'mccluster',kind:'studio',role:'owner',enabled:true};
const payload={default_org_id:'house',workspaces:[owner]};
test('exactly three pages and immutable route inventory',()=>{
  assert.deepEqual(C.pages,['intelligence','operations','studio']);
  assert.equal(new Set(C.routes.map(r=>r.hash)).size,C.routes.length);
  assert.ok(Object.isFrozen(C.routes));assert.ok(C.routes.every(Object.isFrozen));
});
test('all current native Control routes retain a home',async()=>{
  const source=await read('js/control-room-v2.js');
  for(const [name,surface,page] of [['WORK_VIEWS','work','operations'],['CREATE_VIEWS','create','studio'],['SYSTEM_VIEWS','system','operations']]){
    const list=JSON.parse(source.match(new RegExp('var '+name+' = (\\[[^;]+\\]);'))[1]);
    for(const view of list){const hash='#'+surface+':'+view;assert.equal(C.resolve(hash).hash,hash);assert.equal(C.resolve(hash).page,page);}
  }
  for(const surface of ['home','ai','apps','analytics'])assert.equal(C.resolve('#'+surface).hash,'#'+surface);
});
test('aliases cannot navigate outside the declared legacy routes',()=>{
  for(const [alias,hash] of [['#intelligence','#analytics'],['#studio','#create:projects'],['#operations','#home'],['#work','#work:inbox']])assert.equal(C.resolve(alias).hash,hash);
  for(const invalid of ['https://evil.example','#analytics<script>','#__proto__',null,{}])assert.equal(C.resolve(invalid).hash,'#home');
});
test('server ownership is explicit, enabled and house-scoped',()=>{
  assert.equal(C.isOwnerWorkspace(payload),true);
  for(const patch of [{role:'admin'},{role:'staff'},{slug:'client'},{kind:'business'},{enabled:false},{enabled:undefined}])assert.equal(C.isOwnerWorkspace({workspaces:[{...owner,...patch}]}),false);
  assert.equal(C.isOwnerWorkspace({owner:true,workspaces:[]}),false);
  assert.equal(C.isOwnerWorkspace(null),false);
});
test('chosen client workspace cannot inherit the owner presentation',()=>{
  const data={...payload,workspaces:[owner,{...owner,org_id:'client',slug:'client',kind:'business'}]};
  assert.equal(C.isOwnerWorkspace(data,'client'),false);
  assert.equal(C.isOwnerWorkspace(data,'house'),true);
});
test('Halo session replies require the pinned origin and exact direct frame',()=>{
  const expected={};const good={origin:C.HALO_ORIGIN,source:expected,data:{type:'mccluster:halo-owner-token:request'}};
  assert.equal(C.acceptsHaloRequest(good,expected),true);
  for(const patch of [{origin:'https://evil.example'},{origin:'https://prime.mccluster.org.evil.example'},{source:{}},{data:{type:'other'}}])assert.ok(!C.acceptsHaloRequest({...good,...patch},expected));
  assert.ok(!C.acceptsHaloRequest(good,null));
});
test('selection context allowlists geography, never sensitive analytics',()=>{
  assert.deepEqual(C.context({geo:{region:'US',state:'US-CT',email:'private',points:[1]},rangeId:'24h',token:'secret',bank:[4]}),{country:'US',state:'US-CT',period:'24h'});
  assert.equal(C.context({geo:{region:'US',state:'FR-75'}}).state,null);
  assert.equal(C.context({geo:{region:'g10:1:2'}}).country,null);
});
test('preview uses the existing Control page and leaves bar sources alone',async()=>{
  const html=await read('control.html'),js=await read('js/control-room/workspace.js');
  assert.match(html,/js\/control-room\/workspace\.js/);assert.match(html,/js\/tabbar\.js/);
  assert.match(js,/get\('workspace'\) !== '1'/);assert.match(js,/v1\/workspaces\/me/);
  assert.match(js,/data\?\.profile\?\.id/);assert.match(js,/No clone and no second analytics instance/);
  assert.doesNotMatch(js,/localStorage\.setItem|sessionStorage\.setItem|innerHTML\s*=\s*.*token/);
});
test('full Halo is an explicit choice, no wildcard token transmission',async()=>{
  const js=await read('js/control-room/workspace.js');
  assert.match(js,/frame\.src=C\.HALO_ORIGIN/);assert.match(js,/mccluster:halo-owner-token:clear/);
  assert.match(js,/frame\.contentWindow\.postMessage\([\s\S]*?,C\.HALO_ORIGIN\)/);
  assert.doesNotMatch(js,/postMessage\([^;]*['"]\*['"]/);
  assert.match(js,/pagehide/);assert.match(js,/mcc:auth-changed/);assert.match(js,/frame!==expectedFrame/);
});
test('globe material is preserved; lifecycle cancels hidden scenes and late initialization',async()=>{
  const globe=await read('js/control-room/analytics-globe.js');
  assert.match(globe,/"--an-earth": "#121316"/);
  assert.match(globe,/baseLayer: false, skyBox: false/);
  assert.match(globe,/api\.setActive/);assert.match(globe,/widget\.useDefaultRenderLoop = active/);
  assert.match(globe,/if \(destroyed\) return;\s*Cs = r\[0\]/);
  assert.match(globe,/resizeObserver\.disconnect/);assert.match(globe,/inputHandler\.destroy/);
});
test('new CSS uses touch-readable min-width-first controls',async()=>{
  const css=await read('css/control-workspace.css');
  assert.doesNotMatch(css,/@media\s*\(max-width/);
  assert.match(css,/minmax\(0,1fr\)/);assert.match(css,/max\(16px,1rem\)/);
  assert.match(css,/prefers-reduced-motion/);assert.match(css,/data-cw-blocked/);
});
