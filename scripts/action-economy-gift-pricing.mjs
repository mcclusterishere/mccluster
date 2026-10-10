// Gift pricing proposal only. No checkout, wallet, or payout integration.
// Gift compensation is USD cents, not redeemable A units.
// No BIGO conversion ratio is assumed.
import {packs,model} from './action-economy-unit-economics.mjs';

export const proposedGifts=Object.freeze([
 {id:'spark',name:'Spark',units:10},
 {id:'signal',name:'Signal',units:50},
 {id:'spotlight',name:'Spotlight',units:100},
 {id:'encore',name:'Encore',units:500},
 {id:'headline',name:'Headline',units:1000}
]);
export function giftQuote(gift,pack,{creatorShare=0.4,agencyShare=0.05,channel='web'}={}){
 if(!gift||!Number.isSafeInteger(gift.units)||gift.units<=0||!pack||
 !Number.isSafeInteger(pack.units)||pack.units<=0||!Number.isSafeInteger(pack.cents)||pack.cents<=0)
 throw Error('Invalid gift or pack');
 const attributedPurchaseCents=gift.units*pack.cents/pack.units;
 // Floor rather than round to avoid promising more than the modeled share.
 const creatorCents=Math.floor(attributedPurchaseCents*creatorShare);
 const agencyCents=Math.floor(attributedPurchaseCents*agencyShare);
 return {giftId:gift.id,giftUnits:gift.units,packUnits:pack.units,channel,
  attributedPurchaseCents:Number(attributedPurchaseCents.toFixed(4)),
  creatorCents,agencyCents,
  // Non-binding estimated economics; processor fixed fee belongs to purchase, not gift.
  creatorShare,agencyShare};
}
export function rangeForGift(gift,config={}){
 const quotes=packs.map(pack=>giftQuote(gift,pack,config));
 return {giftId:gift.id,units:gift.units,
  minimumCreatorCents:Math.min(...quotes.map(q=>q.creatorCents)),
  maximumCreatorCents:Math.max(...quotes.map(q=>q.creatorCents)),
  quotes};
}
export function affordability({creatorShare=0.4,agencyShare=0.05}={}){
 return packs.flatMap(pack=>['web','ios','android'].map(channel=>{
  const scenario=model({purchaseCents:pack.cents,channel,creatorShare,agencyShare});
  return {units:pack.units,channel,contributionCents:scenario.contributionCents,
   contributionRate:Number((scenario.contributionCents/pack.cents).toFixed(4))};
 }));
}
if(import.meta.url===new URL('file://'+process.argv[1]).href){
 console.log('Provisional gift quote ranges (40% creator, 5% agency, full consumption). Not approved payout promises.');
 console.table(proposedGifts.map(g=>{const r=rangeForGift(g);return {gift:g.name,units:g.units,
  minCreatorUSD:(r.minimumCreatorCents/100).toFixed(2),maxCreatorUSD:(r.maximumCreatorCents/100).toFixed(2)};}));
 console.table(affordability());
}
