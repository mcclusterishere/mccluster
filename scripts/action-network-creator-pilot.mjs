// Action Network creator pilot analysis. Offline, privacy-minimized prototype.
// Input rows are synthetic or consented operational metrics, not identity records.
// No guarantees of creator earnings or attribution to BIGO economics.
export function analyzePilot(rows,{windowDays=28}={}){
 if(!Array.isArray(rows)||!Number.isInteger(windowDays)||windowDays<7)throw Error('Invalid pilot');
 const ids=new Set();
 const bySource=new Map();
 for(const r of rows){
  if(!r||typeof r.creatorId!=='string'||!r.creatorId||ids.has(r.creatorId)||
   typeof r.source!=='string'||!r.source||
   !Number.isInteger(r.acquisitionCents)||r.acquisitionCents<0||
   !Number.isInteger(r.contributionCents)||r.contributionCents<0||
   !Number.isInteger(r.daysObserved)||r.daysObserved<0||
   !Array.isArray(r.activeDays)||r.activeDays.some(d=>!Number.isInteger(d)||d<0||d>=windowDays)||
   r.activeDays.some((d,i,a)=>a.indexOf(d)!==i)||
   !['invited','signed_up','onboarded','published','monetized'].includes(r.stage))
   throw Error('Invalid creator cohort row');
  ids.add(r.creatorId);
  const b=bySource.get(r.source)||{source:r.source,recruited:0,onboarded:0,published:0,monetized:0,
   retainedWeek4:0,week4Eligible:0,acquisitionCents:0,contributionCents:0};
  b.recruited++;
  const stage=['invited','signed_up','onboarded','published','monetized'].indexOf(r.stage);
  if(stage>=2)b.onboarded++;
  if(stage>=3)b.published++;
  if(stage>=4)b.monetized++;
  // Week-four retention is reported only when a full 28-day window is observable.
  if(r.daysObserved>=28){b.week4Eligible++;if(r.activeDays.some(d=>d>=21&&d<28))b.retainedWeek4++;}
  b.acquisitionCents+=r.acquisitionCents;
  b.contributionCents+=r.contributionCents;
  bySource.set(r.source,b);
 }
 return [...bySource.values()].map(b=>({...b,
  activationRate:b.recruited?b.published/b.recruited:null,
  monetizationRate:b.recruited?b.monetized/b.recruited:null,
  week4RetentionRate:b.week4Eligible?b.retainedWeek4/b.week4Eligible:null,
  acquisitionCostPerPublishedCents:b.published?b.acquisitionCents/b.published:null,
  netContributionCents:b.contributionCents-b.acquisitionCents,
  contributionToAcquisitionRatio:b.acquisitionCents?b.contributionCents/b.acquisitionCents:null
 })).sort((a,b)=>a.source.localeCompare(b.source));
}
if(import.meta.url===new URL('file://'+process.argv[1]).href){
 console.log('Creator pilot analyzer ready. Supply consented aggregate or pseudonymous pilot rows; no real data bundled.');
}
