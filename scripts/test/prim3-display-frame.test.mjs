import test from 'node:test';
import assert from 'node:assert/strict';
import {displayFrame, displayPreferences, signed} from '../../js/prim3-tactics/display-frame.mjs';
test('courtyard centre frame places zero between the four middle cells without moving coordinates',()=>{
 const f=displayFrame(10,10,{x:7,y:6}); assert.deepEqual(f.origin,{x:4.5,z:4.5});
 assert.deepEqual(f.toDisplay(4.5,4.5),{x:0,y:0});
 assert.deepEqual(f.toDisplay(5.5,3.5),{x:1,y:1});
 assert.deepEqual(f.toDisplay(3.5,5.5),{x:-1,y:-1});
});
test('objective-relative display is invertible and honours physical metres per cell',()=>{
 const obj={x:7,y:6};const f=displayFrame(10,10,obj,'objective',3.54);
 assert.deepEqual(f.toDisplay(7,6),{x:0,y:0});
 assert.deepEqual(f.toDisplay(8,5),{x:3.54,y:3.54});
 const p=f.toDisplay(2,9);assert.deepEqual(f.toGround(p.x,p.y),{x:2,z:9});assert.deepEqual(obj,{x:7,y:6});
});
test('visual preference v1 rejects unknown versions and enum values',()=>{
 assert.deepEqual(displayPreferences('{broken'),{v:1,projection:'perspective',origin:'centre'});
 assert.deepEqual(displayPreferences('{"v":2,"projection":"top"}'),displayPreferences(null));
 assert.deepEqual(displayPreferences('{"v":1,"projection":"top","origin":"objective","units":99}'),{v:1,projection:'top',origin:'objective'});
 assert.equal(signed(0),'0');assert.equal(signed(-4.5),'-4.5');assert.equal(signed(4.5),'+4.5');
});
