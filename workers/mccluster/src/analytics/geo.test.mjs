import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateGeoEvents,ownerGeoResponse} from './geo.js';
const event={latitude:41.32,longitude:-72.92,country:'US',region:'CT'};
test('suppresses small cohorts and never returns visitor identifiers',()=>{
  assert.equal(aggregateGeoEvents(Array(4).fill(event),'day','now').cells.length,0);
  const data=aggregateGeoEvents(Array(6).fill({...event,ip:'private',uid:'secret'}),'day','now');
  assert.deepEqual(data.cells,[{region:'US / CT',visits:6,lat:42,lon:-72}]);
  assert.doesNotMatch(JSON.stringify(data),/private|secret|ip|uid/);
});
test('owner authorization precedes database access',async()=>{
  let queried=false;
  await assert.rejects(()=>ownerGeoResponse({url:new URL('https://api.example/v1/analytics/geo'),
    env:{},user:{},requireHouseOwner:async()=>{throw Object.assign(new Error('Forbidden'),{status:403});},
    sbRowsPaged:async()=>{queried=true;return [];},json:x=>x}),/Forbidden/);
  assert.equal(queried,false);
});
test('limits period and query scope',async()=>{
  let path;
  const data=await ownerGeoResponse({url:new URL('https://api.example/v1/analytics/geo?granularity=week'),
    env:{},user:{id:'owner'},requireHouseOwner:async()=>{},
    sbRowsPaged:async(_,p,limit)=>{path=p;assert.equal(limit,10000);return Array(5).fill(event);},json:x=>x});
  assert.match(path,/site_id=is.null/);assert.doesNotMatch(path,/limit=10000/);
  assert.equal(data.granularity,'week');assert.equal(data.cells.length,1);
});
