import test from 'node:test';
import assert from 'node:assert/strict';
import {settleGift} from '../action-economy-lots.mjs';
const lot=(id,unitsRemaining,unitsPurchased,purchaseCents,createdAt,channel='web')=>
 ({id,unitsRemaining,unitsPurchased,purchaseCents,unitsConsumed:unitsPurchased-unitsRemaining,createdAt,channel});
test('FIFO consumes oldest purchase lot first',()=>{
 const r=settleGift({giftId:'signal',lots:[lot('new',100,100,199,'2026-10-02'),lot('old',20,50,99,'2026-10-01')]});
 assert.deepEqual(r.allocations.map(a=>[a.lotId,a.units]),[['old',20],['new',30]]);
 assert.equal(r.remainingLots.find(l=>l.id==='old').unitsRemaining,0);
});
test('payout computed in USD cents with final rounding only',()=>{
 const r=settleGift({giftId:'spark',lots:[lot('a',50,50,99,'2026-10-01')]});
 assert.equal(r.creatorCents,7);
 assert.equal(r.agencyCents,0);
});
test('promotional units do not create cash compensation',()=>{
 const r=settleGift({giftId:'spark',lots:[lot('promo',10,10,0,'2026-10-01','promo')]});
 assert.equal(r.creatorCents,0);
 assert.equal(r.agencyCents,0);
});
test('mixed paid and promotional lots preserve their separate economics',()=>{
 const r=settleGift({giftId:'signal',lots:[lot('promo',20,20,0,'2026-10-01','promo'),lot('paid',100,100,199,'2026-10-02')]});
 assert.equal(r.allocations.length,2);
 assert.equal(r.creatorCents,23);
});
test('insufficient balance, duplicate lots, and excess share reject',()=>{
 assert.throws(()=>settleGift({giftId:'headline',lots:[lot('a',100,100,199,'2026-10-01')]}));
 assert.throws(()=>settleGift({giftId:'spark',lots:[lot('a',50,50,99,'2026-10-01'),lot('a',50,50,99,'2026-10-02')]}));
 assert.throws(()=>settleGift({giftId:'spark',lots:[lot('a',50,50,99,'2026-10-01')],creatorBps:9000,agencyBps:2000}));
});
