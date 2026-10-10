// Action Network virtual gift unit economics: scenario tool, NOT production pricing.
// Run: node scripts/action-economy-unit-economics.mjs
// Rates are assumptions, not verified BIGO, Apple, Google or Stripe terms.
export const packs=Object.freeze([
 {units:50,cents:99},{units:100,cents:199},{units:250,cents:499},
 {units:524,cents:999},{units:1620,cents:2999},{units:5450,cents:9999},
 {units:16450,cents:29999},{units:33030,cents:59999}
]);
export const assumptions=Object.freeze({
 web:{variableFee:0.029,fixedFeeCents:30},
 ios:{variableFee:0.30,fixedFeeCents:0},
 android:{variableFee:0.30,fixedFeeCents:0}
});
export function model({purchaseCents,channel='web',consumption=1,creatorShare=0.45,agencyShare=0.05,
 fraudReserve=0.02,variableInfrastructure=0.03,channelRates=assumptions}){
 const fee=channelRates[channel];
 if(!fee)throw Error('Unknown channel');
 const rates=[consumption,creatorShare,agencyShare,fraudReserve,variableInfrastructure,fee.variableFee];
 if(!Number.isSafeInteger(purchaseCents)||purchaseCents<=0||rates.some(v=>!Number.isFinite(v)||v<0||v>1)||
 !Number.isSafeInteger(fee.fixedFeeCents)||fee.fixedFeeCents<0)throw Error('Invalid scenario');
 const spentCents=Math.round(purchaseCents*consumption);
 const outstandingCents=purchaseCents-spentCents; // face-value liability proxy, NOT GAAP deferred revenue
 const processingCents=Math.round(purchaseCents*fee.variableFee)+fee.fixedFeeCents;
 const creatorCents=Math.round(spentCents*creatorShare);
 const agencyCents=Math.round(spentCents*agencyShare);
 const riskCents=Math.round(purchaseCents*fraudReserve);
 const infrastructureCents=Math.round(spentCents*variableInfrastructure);
 const contributionCents=spentCents-processingCents-creatorCents-agencyCents-riskCents-infrastructureCents;
 const fullyConsumedBreakEvenCreatorShare=1-agencyShare-variableInfrastructure-
 (processingCents+riskCents)/purchaseCents;
 return {channel,purchaseCents,spentCents,outstandingCents,processingCents,creatorCents,agencyCents,
 riskCents,infrastructureCents,contributionCents,
 fullyConsumedBreakEvenCreatorShare:Number(fullyConsumedBreakEvenCreatorShare.toFixed(4)),
 // Purchase cash less direct expenses; not profit or recognized revenue.
 cashAfterDirectCostsCents:purchaseCents-processingCents-creatorCents-agencyCents-riskCents-infrastructureCents};
}
export function evaluatePacks(config={}){
 return packs.flatMap(pack=>Object.keys(assumptions).map(channel=>({
  units:pack.units,...model({purchaseCents:pack.cents,channel,...config})
 })));
}
if(import.meta.url===new URL('file://'+process.argv[1]).href){
 const rows=evaluatePacks();
 console.log('Illustrative unit economics: 100% consumption, 45% creator, 5% agency, 2% fraud, 3% infrastructure. USD cents.');
 console.table(rows.map(r=>({channel:r.channel,units:r.units,price:(r.purchaseCents/100).toFixed(2),
 fees:(r.processingCents/100).toFixed(2),creator:(r.creatorCents/100).toFixed(2),
 agency:(r.agencyCents/100).toFixed(2),contribution:(r.contributionCents/100).toFixed(2),
 marginPct:(100*r.contributionCents/r.purchaseCents).toFixed(1)})));
}
