import test from 'node:test';
import assert from 'node:assert/strict';
import {creatorReportCard} from '../creator-trial-milestones.mjs';
const days=[1,2,3].map(n=>({date:'2026-10-0'+n,profileViews:n*2,qualifiedVisits:n,contentPublished:1,serviceClicks:n-1,inquiries:0,sales:0}));
const base={creatorId:'creator-1',role:'videographer',availableHoursWeekly:6,days,service:null};
test('creates a personalized three-day report with mandatory service',()=>{
 const r=creatorReportCard(base);
 assert.equal(r.launchReady,false);assert.equal(r.daysObserved,3);
 assert.equal(r.milestones.find(m=>m.id==='service').required,true);
 assert.equal(r.milestones.find(m=>m.id==='content').target,2);
 assert.equal(r.consultation.complimentaryLimit,1);
});
test('published and bookable service satisfies launch requirement',()=>{
 const r=creatorReportCard({...base,service:{title:'Video editing',status:'published',priceCents:5000,bookingOrCheckoutEnabled:true}});
 assert.equal(r.launchReady,true);
});
test('hours change publishing targets',()=>{
 assert.ok(creatorReportCard({...base,availableHoursWeekly:21}).milestones[1].target>
 creatorReportCard(base).milestones[1].target);
});
test('incomplete, duplicated, or nonconsecutive data fails',()=>{
 assert.throws(()=>creatorReportCard({...base,days:days.slice(0,2)}));
 assert.throws(()=>creatorReportCard({...base,days:[days[0],days[0],days[2]]}));
 assert.throws(()=>creatorReportCard({...base,days:[days[0],days[1],{...days[2],date:'2026-10-05'}]}));
});
test('client asserted data cannot be labeled verified',()=>{
 assert.throws(()=>creatorReportCard({...base,measurement:'self_reported'}));
});
