import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAirQuality, fetchAirQuality, handleHaloLayers } from '../src/world-halo-layers.js';
import { globeRelease, globeFeatureForPath } from '../../../packages/release-policy/globe.mjs';
const now=Date.parse('2026-10-24T05:00:00Z');
const stations={features:[{properties:{location_id:'1',location_name_en:'Toronto'},geometry:{coordinates:[-79.4,43.7]}}]};
const obs=(aqhi,age=0,id='1')=>({properties:{location_id:id,aqhi,observation_datetime:new Date(now-age).toISOString()}});
test('AQHI preserves scale, joins real stations and rejects missing, old and future readings',()=>{
 const readings=normalizeAirQuality(stations,{features:[obs(2,1000),obs(11),obs(5,0,'unknown'),obs(9,0,'missing')]},now);
 assert.equal(readings.length,1);assert.equal(readings[0].scale,'AQHI');assert.equal(readings[0].label,'10+');assert.equal(readings[0].band,'Very high');
 for(const value of [null,'',true,-1,'no'])assert.equal(normalizeAirQuality(stations,{features:[obs(value)]},now).length,0);
 for(const age of [7*3600000,-600000])assert.equal(normalizeAirQuality(stations,{features:[obs(4,age)]},now).length,0);
 assert.equal(normalizeAirQuality(stations,{features:[obs(4,3*3600000)]},now)[0].stale,true);
 assert.equal(normalizeAirQuality(stations,{features:[obs(0)]},now)[0].label,'1');
});
test('provider reads both bounded collections; malformed feed cannot become successful empty data',async()=>{
 const urls=[];const result=await fetchAirQuality({},async url=>{urls.push(String(url));return Response.json(String(url).includes('aqhi-stations')?stations:{features:[{properties:{location_id:'1',aqhi:3,observation_datetime:new Date().toISOString()}}]});});
 assert.equal(result.count,1);assert.equal(urls.length,2);assert.ok(urls.every(u=>u.includes('limit=500')));assert.ok(urls.some(u=>u.includes('latest=true')));
 await assert.rejects(()=>fetchAirQuality({},async()=>Response.json({})),/Invalid ECCC/);
});
test('new route is owner-preview only and failure is unavailable, never fake readings',async()=>{
 assert.equal(globeFeatureForPath('/v1/world/layers/airquality'),'airquality');assert.equal(globeRelease('airquality'),'admin_preview');assert.equal(globeRelease('airquality',{WORLD_GLOBE_WITHDRAWN:'airquality'}),'withdrawn');
 const r=await handleHaloLayers(new Request('https://api.mccluster.org/v1/world/layers/airquality'),{}, {fetchImpl:async()=>new Response('',{status:503})});const b=await r.json();assert.equal(b.unavailable,true);assert.deepEqual(b.readings,[]);assert.equal(r.headers.get('cache-control'),'private, no-store');
});
