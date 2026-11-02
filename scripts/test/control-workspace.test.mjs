import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import '../../js/control-room/nav.js';
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
test('every NAV leaf is a workspace route, and every old Control route still lands',async()=>{
  const N=globalThis.CR.nav;
  for(const l of N.leaves()){
    const r=C.resolve(l.leaf.route);
    assert.equal(r.hash,l.leaf.route);
    assert.equal(r.page,l.section.id==='insights'?'intelligence':l.section.id==='create'?'studio':'operations');
    for(const old of l.leaf.was.filter(w=>w.startsWith('#')))assert.equal(C.resolve(old).hash,l.leaf.route,old+' lost its home');
  }
  for(const [old,now] of [['#home','#home:today'],['#ai','#home:ask'],['#apps','#system:apps'],['#analytics','#insights:overview'],['#work:desk-bot','#people:inbox:ai-reply'],['#create:music','#sell:music:catalog']])assert.equal(C.resolve(old).hash,now);
});
test('aliases cannot navigate outside the declared routes',()=>{
  for(const [alias,hash] of [['#intelligence','#insights:overview'],['#studio','#create:projects:projects'],['#operations','#home:today'],['#work','#people:inbox:conversations']])assert.equal(C.resolve(alias).hash,hash);
  for(const invalid of ['https://evil.example','#analytics<script>','#__proto__',null,{}])assert.equal(C.resolve(invalid).hash,'#home:today');
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
test('one Halo: the workspace names the four screens on the globe and keeps no bridge to another site (owner, 2026-10-22)',()=>{
  assert.equal(C.HALO_PAGE,'action-globe.html?explore=1&halo=1');
  assert.equal(C.HALO_ORIGIN,undefined);assert.equal(C.acceptsHaloRequest,undefined);
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
test('Halo is a door to its own page: no frame of another site, no owner session sent anywhere',async()=>{
  const js=await read('js/control-room/workspace.js');
  assert.match(js,/<a class="cw-halo-door" data-cw-halo href="'\+C\.HALO_PAGE/);
  assert.doesNotMatch(js,/prime\.mccluster\.org|HALO_ORIGIN|halo-owner-token|createElement\('iframe'\)/);
  assert.doesNotMatch(js,/postMessage\(/);
  assert.match(js,/pagehide/);assert.match(js,/mcc:auth-changed/);
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
