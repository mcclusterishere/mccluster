import test from 'node:test';
import assert from 'node:assert/strict';
import {observationsAsOf} from '../src/market/as-of.mjs';
const row={id:'initial',org_id:'fixture-org',connector_id:'fixture-source',external_id:'CPI:2026-01',status:'accepted',
 observed_at:'2026-01-31T00:00:00Z',created_at:'2026-02-10T12:00:00Z',ingested_at:'2026-02-10T12:00:00Z',
 content_hash:'original',payload:{value:100},source_ref:{provider:'fixture'},license_policy:{research_only:true},retention_policy:{days:365}};
const replay=(rows,at='2026-03-01T00:00:00Z')=>observationsAsOf(rows,{orgId:'fixture-org',at});
test('event dates and backfills never make observations available before first seen',()=>{
 assert.equal(replay([row],'2026-02-01T00:00:00Z').observations.length,0);
 const late={...row,id:'late',created_at:'2026-04-01T00:00:00Z'};
 assert.equal(replay([late]).excluded[0].reason,'not_known_at_decision');
 assert.equal(replay([row]).observations[0].known_at,row.created_at);
});
test('revision is selected only after knowledge time, independently of input ordering or replay receipt',()=>{
 const revised={...row,id:'revision',content_hash:'revised',payload:{value:101},created_at:'2026-03-15T00:00:00Z',ingested_at:'2026-03-15T00:00:00Z'};
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
test('A to B to A receipts exclude stale B rather than inventing revision order',()=>{
 const a={...row,ingested_at:'2026-05-01T00:00:00Z'};
 const b={...row,id:'b',content_hash:'B',payload:{value:101},created_at:'2026-03-15T00:00:00Z',ingested_at:'2026-03-15T00:00:00Z'};
 for(const rows of [[a,b],[b,a]])for(const at of ['2026-04-01T00:00:00Z','2026-06-01T00:00:00Z']){
  const result=replay(rows,at);assert.deepEqual(result.observations,[]);
  assert.equal(result.excluded.filter(x=>x.reason==='unreconstructable_revision_history').length,2);
 }
 // Before B was first observed there is no competing known payload.
 assert.equal(replay([a,b]).observations[0].content_hash,'original');
});
test('unambiguous earlier replays and a single repeated payload remain usable',()=>{
 const a={...row,ingested_at:'2026-03-01T00:00:00Z'};
 const b={...row,id:'b',content_hash:'B',created_at:'2026-03-15T00:00:00Z',ingested_at:'2026-06-01T00:00:00Z'};
 assert.equal(replay([a,b],'2026-04-01T00:00:00Z').observations[0].id,'b');
 assert.equal(replay([{...row,ingested_at:'2026-06-01T00:00:00Z'}]).observations[0].id,'initial');
 for(const receipt of [null,'invalid','2026-01-01T00:00:00Z',b.created_at]){
  assert.equal(replay([{...a,ingested_at:receipt},b],'2026-04-01T00:00:00Z').observations.length,0);
 }
});
test('microsecond availability excludes future records and preserves the exact cutoff',()=>{
 const first='2026-03-01T00:00:00.000900Z',r={...row,created_at:first,ingested_at:first};
 const before=replay([r],'2026-03-01T00:00:00.000100Z');
 assert.equal(before.observations.length,0);assert.equal(before.excluded[0].reason,'not_known_at_decision');
 assert.equal(before.decision_at,'2026-03-01T00:00:00.000100Z');
 assert.equal(replay([r],first).observations.length,1);
});
test('microsecond revision ordering and reversion fencing do not collapse to milliseconds',()=>{
 const a={...row,created_at:'2026-03-01T00:00:00.000100Z',ingested_at:'2026-03-01T00:00:00.000100Z'};
 const b={...row,id:'b',content_hash:'B',created_at:'2026-03-01T00:00:00.000900Z',ingested_at:'2026-03-01T00:00:00.000900Z'};
 assert.equal(replay([b,a],'2026-03-01T00:00:00.000500Z').observations[0].id,'initial');
 assert.equal(replay([a,b],'2026-03-01T00:00:00.001000Z').observations[0].id,'b');
 assert.equal(replay([{...a,ingested_at:'2026-03-01T00:00:00.000950Z'},b],'2026-03-01T00:00:00.001000Z').observations.length,0);
});
test('offset timestamps and pre-epoch microseconds normalize without precision loss',()=>{
 const time='2026-03-01T00:00:00.123456Z';
 const r={...row,created_at:time,ingested_at:time};
 for(const at of ['2026-03-01T05:30:00.123456+05:30','2026-02-28T20:30:00.123456-03:30']){
  const result=replay([r],at);assert.equal(result.observations.length,1);assert.equal(result.decision_at,time);
 }
 assert.equal(replay([],'1969-12-31T23:59:59.999999Z').decision_at,'1969-12-31T23:59:59.999999Z');
});
test('unsupported precision and impossible calendar/offset times fail closed',()=>{
 for(const at of ['2026-03-01T00:00:00.0000001Z','2026-02-30T00:00:00Z','2026-03-01T24:00:00Z','2026-03-01T00:00:60Z','2026-03-01T00:00:00+25:00','2026-03-01T00:00:00+00:60']){
  assert.throws(()=>replay([],at),/invalid_replay_input/);
  assert.equal(replay([{...row,created_at:at}]).excluded[0].reason,'missing_identity_or_first_seen');
 }
});
