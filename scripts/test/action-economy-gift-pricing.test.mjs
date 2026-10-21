import test from 'node:test';
import assert from 'node:assert/strict';
import {giftQuote,rangeForGift,proposedGifts,affordability} from '../action-economy-gift-pricing.mjs';
import {packs} from '../action-economy-unit-economics.mjs';

test('creator quote depends on acquisition pack, not fictional universal Bean rate',()=>{
 const gift=proposedGifts[2];
 const a=giftQuote(gift,packs[0]),b=giftQuote(gift,packs.at(-1));
 assert.notEqual(a.attributedPurchaseCents,b.attributedPurchaseCents);
});
test('range includes all eight pack prices',()=>{
 const r=rangeForGift(proposedGifts[1]);
 assert.equal(r.quotes.length,8);
 assert.ok(r.minimumCreatorCents<=r.maximumCreatorCents);
});
test('payout is USD cents, never A units',()=>{
 const q=giftQuote(proposedGifts[0],packs[0]);
 assert.equal(Number.isInteger(q.creatorCents),true);
 assert.equal(q.giftUnits,10);
});
test('affordability evaluates every channel',()=>{
 assert.equal(affordability().length,24);
});
test('invalid pricing is rejected',()=>{
 assert.throws(()=>giftQuote({units:-1},packs[0]));
});
