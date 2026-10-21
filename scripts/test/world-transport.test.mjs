import test from 'node:test';
import assert from 'node:assert/strict';
import '../../js/world-transport.js';
const {directions,aircraft}=globalThis.HuTransport;
test('directions encode addresses and modes without requiring credentials',()=>{
 for(const mode of ['driving','transit','walking','bicycling']){
  const url=new URL(directions({destination:'477 Broad St, Bridgeport, CT',origin:'New Haven & Union Station',mode}));
  assert.equal(url.origin,'https://www.google.com');assert.equal(url.searchParams.get('api'),'1');
  assert.equal(url.searchParams.get('origin'),'New Haven & Union Station');assert.equal(url.searchParams.get('travelmode'),mode);
  assert.equal(url.searchParams.get('destination'),'477 Broad St, Bridgeport, CT');assert.equal(url.searchParams.has('key'),false);
 }
});
test('blank origin is left to the Maps app, and unsafe/invalid input cannot change the destination host',()=>{
 assert.equal(new URL(directions({destination:'javascript:alert(1)'})).origin,'https://www.google.com');
 assert.equal(new URL(directions({destination:'Bridgeport'})).searchParams.has('origin'),false);
 for(const x of [{destination:''},{destination:'x'.repeat(301)},{destination:'x',mode:'flight'},{destination:'x',mode:'toString'}])assert.equal(directions(x),null);
});
test('aircraft retain zero values and unknown telemetry; malformed coordinates are discarded',()=>{
 assert.deepEqual(aircraft(['abc',' TEST ',0,0,0,0,0]),{id:'abc',callsign:'TEST',lon:0,lat:0,altitude:0,speed:0,heading:0});
 assert.equal(aircraft(['abc','TEST',12,45,null,null,null]).altitude,null);
 for(const value of [null,'',false,NaN,Infinity])assert.equal(aircraft(['abc','TEST',value,45]),null);
 assert.equal(aircraft(['abc','TEST',181,45]),null);assert.equal(aircraft(['abc','TEST',12,91]),null);
});
