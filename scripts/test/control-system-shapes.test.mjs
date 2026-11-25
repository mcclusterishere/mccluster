import test from 'node:test';
import assert from 'node:assert/strict';
import '../../js/control-room/system-summary.js';
const S=globalThis.CR.systemSummary;
// Synthetic records shaped like core/src/runner.mjs + Worker observability.
const job=(id,type,message)=>({id,trace_id:'trace-'+id,request_id:'job-'+id,event_kind:'job',event_name:`core.job.${type}.failed`,level:'error',outcome:'error',source:'core',service:'mccluster-core',route:`core:job:${type}`,status_code:null,resource_type:'ops_agent_job',resource_id:'job-'+id,message,detail:{attempt:2,status:'failed'},occurred_at:'2026-01-01T12:00:00Z'});
const rows=[job(1,'local_analysis','fetch failed'),job(2,'local_analysis','fetch failed'),job(3,'objective_reflection','canceling statement due to statement timeout'),job(4,'prim3_agent_news','No usable model comment'),{id:5,trace_id:'trace-api',event_kind:'request',level:'error',outcome:'error',source:'worker',method:'GET',route:'/v1/analytics/event-inventory',status_code:502,occurred_at:'2026-01-01T12:01:00Z'},{id:6,event_kind:'dependency',level:'warn',outcome:'refused',source:'worker',message:'meta_error_190',occurred_at:'2026-01-01T12:02:00Z'}];
test('real event shapes preserve terminal attempts, warnings, source distinctions and separate jobs',()=>{
  const groups=S.groupEvents(rows);
  assert.equal(groups.length,6);assert.equal(groups.filter(g=>g.level==='error').length,5);
  assert.ok(groups.every(g=>g.success===null));
  const html=S.render(rows,{loaded:true,hasMore:true});
  for(const label of ['Local analysis failed','Objective review failed','Game news generation failed','GET /v1/analytics/event-inventory','Warning recorded','Background work','Original event evidence','&quot;attempt&quot;: 2','&quot;status_code&quot;: 502'])assert.ok(html.includes(label),label);
  assert.match(html,/5 error entries/);assert.match(html,/not incident counts/);
});
test('warning ok and HTTP failure never become reported success',()=>{
  assert.equal(S.groupEvents([{id:1,level:'warn',outcome:'ok'},{id:2,level:'error',outcome:'ok',status_code:502}]).filter(g=>g.success).length,0);
});
