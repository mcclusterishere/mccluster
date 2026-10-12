import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKETPLACE_POLICY_V1, quoteMarketplaceAllocation, validateMarketplacePolicy } from './commission-contract.mjs';
const capped = { ...MARKETPLACE_POLICY_V1, customerReferralCapCents: 500000, supplyReferralCapCents: 500000 };
test('default uses approved 5000 dollar caps but payouts remain disabled',()=>{
  const a=quoteMarketplaceAllocation({commissionableCents:10000,customerReferrerEligible:true,supplyReferrerEligible:true});
  assert.equal(a.customerReferrerCents,500);assert.equal(a.supplyReferrerCents,500);assert.equal(a.payable,false);
});
test('70/5/5/10/10 with configured caps',()=>{
  const a=quoteMarketplaceAllocation({commissionableCents:10000,policy:capped,customerReferrerEligible:true,supplyReferrerEligible:true});
  assert.deepEqual([a.providerCents,a.customerReferrerCents,a.supplyReferrerCents,a.operatorCents,a.reserveCents],[7000,500,500,1000,1000]);
});
test('caps apply independently, unused commissions return to operator',()=>{
  const a=quoteMarketplaceAllocation({commissionableCents:10000,policy:capped,customerReferrerEligible:true,supplyReferrerEligible:true,customerPreviouslyAccruedCents:499900,supplyPreviouslyAccruedCents:500000});
  assert.deepEqual([a.customerReferrerCents,a.supplyReferrerCents,a.operatorCents],[100,0,1900]);
});
test('rounding conserves every cent',()=>{
  for(const n of [0,1,2,3,9,99,101,10001]){
    const a=quoteMarketplaceAllocation({commissionableCents:n,policy:capped,customerReferrerEligible:true,supplyReferrerEligible:true});
    assert.equal(a.providerCents+a.customerReferrerCents+a.supplyReferrerCents+a.operatorCents+a.reserveCents,n);
  }
});
test('never enable payout by policy override',()=>{
  assert.throws(()=>validateMarketplacePolicy({...capped,payoutsEnabled:true}));
  assert.throws(()=>validateMarketplacePolicy({...capped,customerReferralCapCents:-1}));
  assert.throws(()=>quoteMarketplaceAllocation({commissionableCents:-1}));
});
