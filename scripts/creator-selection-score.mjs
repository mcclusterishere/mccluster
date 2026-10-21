// Provisional creator selection scoring. Never auto-reject on this score alone.
// Talent scores must be evidence-based and independently reviewed.
export const SCORE_VERSION='creator-selection-v1';
const dimensions=['market','talent','execution'];
export function creatorSelectionScore({market,talent,execution,reviewers=0,marketSample=0}){
 const input={market,talent,execution};
 for(const key of dimensions)if(!Number.isFinite(input[key])||input[key]<0||input[key]>100)throw Error('Invalid '+key+' score');
 if(!Number.isSafeInteger(reviewers)||reviewers<0||!Number.isSafeInteger(marketSample)||marketSample<0)throw Error('Invalid evidence');
 const eligible=reviewers>=2&&marketSample>=20;
 return {version:SCORE_VERSION,dimensions:input,score:Math.round((market+talent+execution)/3*10)/10,
  reviewStatus:eligible?'ready_for_human_selection':'insufficient_evidence',
  flags:[...(reviewers<2?['talent_requires_two_independent_reviews']:[]),...(marketSample<20?['comparison_pool_too_small']:[])],
  policy:'Decision support only; do not use for automatic acceptance, exclusion or earnings decisions.'};
}
export function percentileWithinPool(value,peers){
 if(!Number.isFinite(value)||!Array.isArray(peers)||peers.length<20||peers.some(x=>!Number.isFinite(x)))return null;
 const less=peers.filter(x=>x<value).length;
 const equal=peers.filter(x=>x===value).length;
 return Math.round(100*(less+equal/2)/peers.length*10)/10;
}
