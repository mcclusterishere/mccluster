import test from 'node:test';
import assert from 'node:assert/strict';
import {addressResults,createAddressSearch,currentPosition} from '../../js/travel/address-search.mjs';
import {directionsLink} from '../../js/travel/navigation-core.mjs';
import {legAction} from '../../js/travel/journey-core.mjs';
const feature={geometry:{type:'Point',coordinates:[-73.9857,40.7484]},properties:{name:'Empire State Building',street:'Fifth Avenue',housenumber:'350',city:'New York',country:'United States'}};
test('address results retain building number and coordinates; discard malformed and duplicate rows',()=>{
 const result=addressResults({features:[feature,feature,{...feature,geometry:{type:'Point',coordinates:[null,12]}},{geometry:{type:'Point',coordinates:[0,0]},properties:{}}]});
 assert.equal(result.length,1);assert.match(result[0].label,/350 Fifth Avenue/);assert.deepEqual(result[0].coordinates,[-73.9857,40.7484]);
});
test('search uses bounded public Photon query without cookies, referrer or GPS',async()=>{
 let called;const search=createAddressSearch(async(url,opts)=>{called={url:new URL(url),opts};return Response.json({features:[feature]});});
 assert.equal((await search('350 Fifth Avenue')).length,1);assert.equal(called.url.searchParams.get('q'),'350 Fifth Avenue');assert.equal(called.url.searchParams.has('lat'),false);assert.equal(called.opts.credentials,'omit');assert.equal(called.opts.referrerPolicy,'no-referrer');
});
test('provider failure does not invent a successful address; throttling prevents retries',async()=>{
 let calls=0;const search=createAddressSearch(async()=>{calls++;return new Response('',{status:429});});
 await assert.rejects(()=>search('350 Fifth Avenue'));await assert.rejects(()=>search('350 Fifth Avenue'),/busy/);assert.equal(calls,1);
});
test('GPS permission failure is recoverable and success preserves coordinate order',async()=>{
 const coordinates=await currentPosition({getCurrentPosition(ok,fail,options){assert.equal(options.timeout,12000);ok({coords:{longitude:-72.93,latitude:41.31}});}});assert.deepEqual(coordinates,[-72.93,41.31]);
 await assert.rejects(()=>currentPosition({getCurrentPosition(ok,fail){fail({code:1});}}),/Location access is off/);
});
test('directions preserve exact GPS and address coordinates and request navigation',()=>{
 const u=new URL(directionsLink({provider:'google',origin:{coordinates:[-72.93,41.31]},destination:{coordinates:feature.geometry.coordinates},navigate:true}));assert.equal(u.searchParams.get('origin'),'41.31,-72.93');assert.equal(u.searchParams.get('destination'),'40.7484,-73.9857');assert.equal(u.searchParams.get('dir_action'),'navigate');
 const flight=legAction({from:{label:'Current location',coordinates:[-72.93,41.31]},to:{label:'Lisbon',coordinates:[-9.14,38.72]},mode:'flight'},'main');assert.doesNotMatch(flight.url,/undefined/);
});
