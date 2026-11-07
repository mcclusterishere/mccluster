import test from 'node:test';
import assert from 'node:assert/strict';
import '../../js/control-room/system-summary.js';
const S=globalThis.CR.systemSummary;
test('only shared traces group events; duplicate IDs are counted once per source',()=>{
  const rows=[{id:1,source:'worker',trace_id:'a',level:'error'},{id:1,source:'worker',trace_id:'a',level:'error'},{id:2,trace_id:'a',level:'info',outcome:'ok'},{id:3,level:'error',route:'/same'},{id:4,level:'error',route:'/same'},{id:1,source:'core',level:'warn'}];
  const groups=S.groupEvents(rows);
  assert.equal(groups.length,4);assert.equal(groups.reduce((n,g)=>n+g.events.length,0),5);
  assert.equal(groups[0].level,'error');assert.equal(groups[0].success.id,2);
  assert.equal(S.groupEvents([{level:'warn'},{level:'warn'}]).length,2);
});
test('timeline orders newest first and never infers recovery or total incidents',()=>{
  const html=S.render([{id:1,trace_id:'a',occurred_at:'2026-01-01',level:'error'},{id:2,trace_id:'a',occurred_at:'2026-01-02',outcome:'ok',level:'info'}],{loaded:true,hasMore:true});
  assert.match(html,/1 error entry/);assert.match(html,/not incident counts/);assert.match(html,/More events are available/);assert.match(html,/does not prove recovery/);
  assert.equal(S.groupEvents([{id:1,occurred_at:'2026-01-01'},{id:2,occurred_at:'2026-01-02'}])[0].events[0].id,2);
});
test('missing reads and fields remain unknown, evidence is escaped',()=>{
  assert.match(S.render([]),/unavailable/);assert.match(S.render([],{loaded:true}),/does not prove/);
  const html=S.render([{id:'"><script>',event_name:'<img onerror=alert(1)>',level:'error'}],{loaded:true});
  assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;img/);assert.match(html,/Unknown in the loaded events/);
  const flow=S.dependencies({api:true,database:false});assert.match(flow,/✓ Check passed/);assert.match(flow,/! Check failed/);assert.match(flow,/\? Not reported/);assert.match(flow,/Age unknown/);
});

test('known event names and recorded failure reasons get plain explanations without invented causes',()=>{
  const d=S.explain({event_name:'core.job.objective_reflection.failed',source:'core',message:'canceling statement due to statement timeout'});
  assert.equal(d.title,'Objective review failed');assert.match(d.reason,/time limit/);assert.equal(d.source,'Background work');
  assert.match(S.explain({message:'fetch failed'}).reason,/does not establish which dependency/);
  assert.match(S.explain({event_name:'unknown'}).reason,/does not establish/);
});
