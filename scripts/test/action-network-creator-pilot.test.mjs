import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePilot} from '../action-network-creator-pilot.mjs';
const row=(creatorId,source,stage,daysObserved,activeDays,acquisitionCents,contributionCents)=>({creatorId,source,stage,daysObserved,activeDays,acquisitionCents,contributionCents});
test('calculates acquisition cost and actual contribution by source',()=>{
 const [r]=analyzePilot([row('a','organic','monetized',28,[0,7,22],1000,2500),row('b','organic','onboarded',28,[1],500,0)]);
 assert.equal(r.recruited,2);assert.equal(r.published,1);assert.equal(r.monetized,1);
 assert.equal(r.week4RetentionRate,0.5);assert.equal(r.acquisitionCostPerPublishedCents,1500);
 assert.equal(r.netContributionCents,1000);
});
test('does not mislabel immature cohorts as churned',()=>{
 const [r]=analyzePilot([row('a','referral','published',8,[7],100,0)]);
 assert.equal(r.week4RetentionRate,null);assert.equal(r.week4Eligible,0);
});
test('zero denominators are null, not fabricated',()=>{
 const [r]=analyzePilot([row('a','direct','invited',28,[],0,0)]);
 assert.equal(r.acquisitionCostPerPublishedCents,null);
 assert.equal(r.contributionToAcquisitionRatio,null);
});
test('duplicate creator IDs and negative costs fail',()=>{
 assert.throws(()=>analyzePilot([row('a','x','published',28,[],0,0),row('a','x','published',28,[],0,0)]));
 assert.throws(()=>analyzePilot([row('b','x','published',28,[],-1,0)]));
});
