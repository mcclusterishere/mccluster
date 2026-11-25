import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../js/halo/events.js',import.meta.url),'utf8');
const context={};vm.createContext(context);vm.runInContext(source,context);const E=context.HaloEvents;
test('every existing physical layer has a distinct named visual family',()=>{
  assert.equal(E.kindFor('quakes',{}),'quake');assert.equal(E.kindFor('fires',{}),'heat');assert.equal(E.kindFor('perimeters',{}),'fire');assert.equal(E.kindFor('tides',{}),'tide');assert.equal(E.kindFor('vessels',{}),'vessel');assert.equal(E.kindFor('weather',{kind:'tornado'}),'tornado');assert.equal(E.kindFor('natural',{kind:'volcano'}),'volcano');assert.equal(E.kindFor('weather',{kind:'unknown'}),'alert');
});
test('bad positions and expired warnings cannot enter the scene',()=>{
  for(const p of [{lon:null,lat:1},{lon:0,lat:null},{lon:Infinity,lat:1},{lon:181,lat:1},{lon:1,lat:91}])assert.equal(E.valid(p),false);
  assert.equal(E.valid({lon:0,lat:0}),true);assert.equal(E.expired({expires_at:'2026-01-01'},Date.parse('2026-01-02')),true);assert.equal(E.expired({expires_at:null}),false);
});
test('the renderer has finite detail budgets and a cleanup path',()=>{
  assert.equal(E.MOTION_CAP,48);assert.equal(E.MODEL_CAP,8);assert.match(source,/document.hidden/);assert.match(source,/prefers-reduced-motion/);assert.match(source,/removeEventListener\(tick\)/);assert.match(source,/clearInterval\(clock\)/);
});

test('animation reuses bounded texture IDs instead of allocating an image every frame',()=>{
  assert.match(source,/imageId:'halo-event:'/);
  assert.match(source,/\.setImage\('halo-event:'/);
  assert.doesNotMatch(source,/r\.b\.image\s*=/);
});

test('moving geometry uses dynamic properties so asynchronous builds can finish',()=>{
  assert.match(source,/new C.CallbackPositionProperty/);
  assert.match(source,/p\.radius/);
  assert.doesNotMatch(source,/else[^\n]*p\.e\.position=/);
});
