// Pure, deterministic prototype for FIFO purchase-lot gift settlement.
// No payment, wallet, ID, or payout integration. Not approved pricing.
import {proposedGifts} from './action-economy-gift-pricing.mjs';
const integer=(n)=>Number.isSafeInteger(n)&&n>=0;
export function settleGift({lots,giftId,creatorBps=4000,agencyBps=500}){
 const gift=proposedGifts.find(g=>g.id===giftId);
 if(!gift)throw Error('Unknown gift');
 if(!Array.isArray(lots)||!integer(creatorBps)||!integer(agencyBps)||
 creatorBps+agencyBps>10000)throw Error('Invalid settlement inputs');
 const ordered=lots.map((l,i)=>{
  if(!l||typeof l.id!=='string'||!l.id||!integer(l.unitsRemaining)||
  !Number.isSafeInteger(l.unitsPurchased)||l.unitsPurchased<=0||
  !integer(l.purchaseCents)||!integer(l.unitsConsumed)||l.unitsConsumed+l.unitsRemaining>l.unitsPurchased||
  !['web','ios','android','promo'].includes(l.channel)||
  (l.channel==='promo'&&l.purchaseCents!==0))throw Error('Invalid lot');
  return {...l,_index:i};
 }).sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''))||a._index-b._index);
 if(new Set(ordered.map(l=>l.id)).size!==ordered.length)throw Error('Duplicate lot');
 if(ordered.reduce((sum,l)=>sum+l.unitsRemaining,0)<gift.units)throw Error('Insufficient units');
 let needed=gift.units,creatorNumerator=0n,agencyNumerator=0n,valueNumerator=0n;
 const allocations=[];
 for(const lot of ordered){
  if(!needed)break;
  const count=Math.min(needed,lot.unitsRemaining);
  if(!count)continue;
  // Exact rational accounting across multiple purchase lots; round only once.
  // Numerators use a common denominator via a product of purchased-unit counts.
  const numerator=BigInt(count)*BigInt(lot.purchaseCents);
  const denominator=BigInt(lot.unitsPurchased);
  allocations.push({lotId:lot.id,units:count,purchaseCents:lot.purchaseCents,
   unitsPurchased:lot.unitsPurchased,channel:lot.channel,numerator,denominator});
  needed-=count;
 }
 // Sum fractional cents using exact BigInt rational arithmetic.
 let n=0n,d=1n;
 for(const a of allocations){n=n*a.denominator+a.numerator*d;d*=a.denominator;
  const gcd=(x,y)=>{while(y){[x,y]=[y,x%y];}return x;};
  const g=gcd(n,d);n/=g;d/=g;
 }
 valueNumerator=n;
 creatorNumerator=n*BigInt(creatorBps);
 agencyNumerator=n*BigInt(agencyBps);
 const creatorCents=Number(creatorNumerator/(d*10000n));
 const agencyCents=Number(agencyNumerator/(d*10000n));
 const attributedPurchaseCents=Number(n)/Number(d);
 if(!Number.isSafeInteger(creatorCents)||!Number.isSafeInteger(agencyCents)||
 !Number.isFinite(attributedPurchaseCents))throw Error('Settlement exceeds supported range');
 return {giftId,giftUnits:gift.units,creatorCents,agencyCents,
  attributedPurchaseCents,allocations:allocations.map(({numerator,denominator,...a})=>a),
  remainingLots:lots.map(l=>({...l,unitsRemaining:l.unitsRemaining-
   allocations.filter(a=>a.lotId===l.id).reduce((s,a)=>s+a.units,0),
   unitsConsumed:l.unitsConsumed+allocations.filter(a=>a.lotId===l.id).reduce((s,a)=>s+a.units,0)}))};
}
