import test from 'node:test';
import assert from 'node:assert/strict';
import {observationsAsOf} from '../src/market/as-of.mjs';
const row={id:'initial',org_id:'fixture-org',connector_id:'fixture-source',external_id:'CPI:2026-01',status:'accepted',
 observed_at:'2026-01-31T00:00:00Z',created_at:'2026-02-10T12:00:00Z',ingested_at:'2026-11-07T12:00:00Z',
 content_hash:'original',payload:{value:100},source_ref:{provider:'fixture'},license_policy:{research_only:true},retention_policy:{days:365}};
const replay=(rows,at='2026-03-01T00:00:00Z')=>observationsAsOf(rows,{orgId:'fixture-org',at});
test('event dates and backfills never make observations available before first seen',()=>{
 assert.equal(replay([row],'2026-02-01T00:00:00Z').observations.length,0);
 const late={...row,id:'late',created_at:'2026-04-01T00:00:00Z'};
 assert.equal(replay([late]).excluded[0].reason,'not_known_at_decision');
 assert.equal(replay([row]).observations[0].known_at,row.created_at);
});
test('revision is selected only after knowledge time, independently of input ordering or replay receipt',()=>{
 const revised={...row,id:'revision',content_hash:'revised',payload:{value:101},created_at:'2026-03-15T00:00:00Z'};
 assert.equal(replay([revised,row]).observations[0].payload.value,100);
 const later=replay([row,revised],'2026-04-01T00:00:00Z');assert.equal(later.observations[0].payload.value,101);
 assert.equal(later.coverage,'provided_records_only');assert.equal(later.publication_time_claimed,false);
});
test('policies, provenance and connector namespaces survive projection',()=>{
 const r=replay([row,{...row,id:'second',connector_id:'another-source'}]);assert.equal(r.observations.length,2);
 for(const o of r.observations){assert.deepEqual(o.license_policy,row.license_policy);assert.deepEqual(o.retention_policy,row.retention_policy);assert.deepEqual(o.source_ref_current,row.source_ref);}
});
test('missing policy, missing first-seen time and conflicting simultaneous revisions fail closed',()=>{
 for(const patch of [{license_policy:{}},{retention_policy:null},{created_at:null},{status:'rejected'}])assert.equal(replay([{...row,...patch}]).observations.length,0);
 const conflict={...row,id:'conflict',content_hash:'different',payload:{value:999}};
 assert.equal(replay([row,conflict]).observations.length,0);assert.equal(replay([row,conflict]).excluded[0].reason,'ambiguous_same_time_revision');
});
test('mixed organizations, unzoned cutoffs and unbounded inputs are rejected',()=>{
 assert.throws(()=>replay([{...row,org_id:'other'}]),/replay_org_mismatch/);
 assert.throws(()=>replay([row],'2026-03-01'),/invalid_replay_input/);
 assert.throws(()=>replay(Array(5001).fill(row)),/invalid_replay_input/);
});
