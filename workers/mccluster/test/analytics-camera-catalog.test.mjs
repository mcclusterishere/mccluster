import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAustinCameras} from '../src/seek-first/camera-catalog.js';
import {executeAdapter} from '../src/seek-first/adapters.js';
const payload={meta:{view:{columns:['camera_id','camera_name','camera_status','latitude','longitude'].map(fieldName=>({fieldName}))}},data:[[1,'Main','TURNED_ON','30.2','-97.7'],[2,'Offline','TURNED_OFF',null,null],[1,'duplicate','','0','0']]};
test('camera metadata preserves offline and unknown geometry without inventing stream health',()=>{const r=normalizeAustinCameras(payload);assert.equal(r.length,2);assert.deepEqual(r[0].point,{lat:30.2,lon:-97.7});assert.equal(r[1].point,null);assert.equal(r[1].properties.catalog_status,'TURNED_OFF');assert.equal(r[0].properties.stream_health,'not_checked');assert.equal(r[0].observed_at,null);});
test('camera row cap and malformed response are bounded',()=>{assert.equal(normalizeAustinCameras(payload,1).length,1);assert.deepEqual(normalizeAustinCameras({}),[]);});
test('CCTV adapter supplies normalized records without requiring raw response exposure',async t=>{const original=global.fetch;t.after(()=>global.fetch=original);global.fetch=async()=>new Response(JSON.stringify(payload));const r=await executeAdapter('cctv',{limit:1});assert.equal(r.records.length,1);assert.equal(r.persistence,'transient');assert.match(r.note,/not been checked/);});
