import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {creatorSelectionScore,percentileWithinPool} from '../creator-selection-score.mjs';
const sql=readFileSync(new URL('../../supabase/migrations/pending/20261010003000_creator_selection_pool.sql',import.meta.url),'utf8');
test('three equally weighted pillars',()=>{
 const r=creatorSelectionScore({market:30,talent:90,execution:60,reviewers:2,marketSample:20});
 assert.equal(r.score,60);assert.equal(r.reviewStatus,'ready_for_human_selection');
});
test('insufficient reviews and peers cannot yield ready status',()=>{
 const r=creatorSelectionScore({market:30,talent:90,execution:60,reviewers:1,marketSample:5});
 assert.equal(r.reviewStatus,'insufficient_evidence');
 assert.equal(percentileWithinPool(3,[1,2,3]),null);
});
test('percentile uses tie midrank',()=>assert.equal(percentileWithinPool(10,Array(20).fill(10)),50));
test('owner-only views and server-only reviewer writes',()=>{
 assert.match(sql,/creator_selection_profile_owner_read/);
 assert.match(sql,/creator_selection_snapshot_owner_read/);
 assert.match(sql,/creator_user_id=\(select auth\.uid\(\)\)/);
 assert.doesNotMatch(sql,/grant insert.*to authenticated/);
 assert.match(sql,/unique\(creator_user_id,reviewer_user_id,rubric_version\)/);
 assert.match(sql,/creator_selection_snapshot_immutable before update or delete/);
});
