import assert from 'node:assert/strict';
import {model,evaluatePacks,packs} from '../action-economy-unit-economics.mjs';
import test from 'node:test';

test('eight provisional packs, each channel',()=>{
 assert.equal(packs.length,8);
 assert.equal(evaluatePacks().length,24);
});
test('web processing fixed fee makes small packs less profitable',()=>{
 const small=model({purchaseCents:99,channel:'web'});
 const large=model({purchaseCents:9999,channel:'web'});
 assert.ok(small.processingCents/small.purchaseCents>large.processingCents/large.purchaseCents);
});
test('higher channel fees reduce contribution',()=>{
 const web=model({purchaseCents:9999,channel:'web'});
 const ios=model({purchaseCents:9999,channel:'ios'});
 assert.ok(web.contributionCents>ios.contributionCents);
});
test('unused units remain outstanding; do not recognize all purchase cash as revenue',()=>{
 const r=model({purchaseCents:10000,consumption:0.25});
 assert.equal(r.spentCents,2500);
 assert.equal(r.outstandingCents,7500);
 assert.equal(r.creatorCents,1125);
});
test('negative margins are visible, not clipped',()=>{
 const r=model({purchaseCents:999,channel:'ios',creatorShare:0.9,agencyShare:0.1});
 assert.ok(r.contributionCents<0);
});
test('invalid inputs fail closed',()=>{
 assert.throws(()=>model({purchaseCents:-1}));
 assert.throws(()=>model({purchaseCents:100,channel:'other'}));
 assert.throws(()=>model({purchaseCents:100,creatorShare:1.1}));
});
