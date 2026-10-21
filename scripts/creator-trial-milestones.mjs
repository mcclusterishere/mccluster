// Three-day creator baseline and milestone proposal. Not a production entitlement or scheduler.
// All metrics are server-measured/verified; do not accept client-supplied traffic as trusted.
const metricKeys=['profileViews','qualifiedVisits','contentPublished','serviceClicks','inquiries','sales'];
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
export function creatorReportCard({creatorId,role,availableHoursWeekly,days,service,measurement='verified'}){
 if(typeof creatorId!=='string'||!creatorId||typeof role!=='string'||!role||
 !Number.isFinite(availableHoursWeekly)||availableHoursWeekly<=0||availableHoursWeekly>80||
 !Array.isArray(days)||days.length!==3||measurement!=='verified')throw Error('Invalid baseline');
 const dates=new Set();
 const totals=Object.fromEntries(metricKeys.map(k=>[k,0]));
 for(const day of days){
  if(!day||typeof day.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day.date)||dates.has(day.date))throw Error('Invalid day');
  dates.add(day.date);
  for(const k of metricKeys){
   if(!Number.isSafeInteger(day[k])||day[k]<0)throw Error('Invalid metric '+k);
   totals[k]+=day[k];
  }
 }
 const sorted=[...dates].sort();
 const consecutive=sorted.every((d,i)=>i===0||Math.round((Date.parse(d+'T00:00:00Z')-Date.parse(sorted[i-1]+'T00:00:00Z'))/86400000)===1);
 if(!consecutive)throw Error('Three consecutive calendar days required');
 const hasService=Boolean(service&&service.status==='published'&&typeof service.title==='string'&&service.title.trim()&&
 Number.isSafeInteger(service.priceCents)&&service.priceCents>=0&&service.bookingOrCheckoutEnabled===true);
 const hours=availableHoursWeekly;
 const publishGoal=Math.max(1,Math.min(7,Math.ceil(hours/3)));
 const viewsGoal=totals.profileViews===0?10:Math.max(totals.profileViews+3,Math.ceil(totals.profileViews*1.2));
 const clicksGoal=totals.serviceClicks===0?2:Math.max(totals.serviceClicks+1,Math.ceil(totals.serviceClicks*1.2));
 const milestones=[
  {id:'service',title:'Publish one bookable service',target:1,baseline:hasService?1:0,unit:'published_service',required:true},
  {id:'content',title:'Publish content consistently',target:publishGoal,baseline:totals.contentPublished,unit:'posts_per_week'},
  {id:'reach',title:'Increase qualified profile visibility',target:viewsGoal,baseline:totals.profileViews,unit:'profile_views_per_week'},
  {id:'intent',title:'Generate service interest',target:clicksGoal,baseline:totals.serviceClicks,unit:'service_clicks_per_week'}
 ];
 return {creatorId,role,trialStart:sorted[0],trialEnd:sorted[2],daysObserved:3,availableHoursWeekly:hours,
  baseline:totals,serviceReady:hasService,launchReady:hasService,
  reportCard:{serviceSetup:hasService?'ready':'action_required',
   contentActivity:totals.contentPublished>0?'observed':'no_activity_observed',
   reach:totals.profileViews>0?'observed':'no_activity_observed',
   salesSignal:totals.sales>0?'sales_observed':totals.inquiries>0?'inquiries_observed':totals.serviceClicks>0?'clicks_observed':'no_signal_observed'},
  milestones,consultation:{durationMinutes:15,complimentaryLimit:1,eligible:true,bookingStatus:'not_booked'},
  caveat:'Three days establish a provisional baseline, not a reliable forecast. Review milestones after 14 and 28 days.'};
}
