import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { errorOrigin, summarizeErrors } from '../../workers/mccluster/src/analytics/forensic-insights.js';
const msg = "ReferenceError: Can't find variable: _AutofillCallbackHandler";
const src = 'https://matthew.mccluster.org/?utm_source=ig';
const cases = [
  [{msg,src}, 'injected'],
  [{msg:msg.replace('ReferenceError: ',''),src}, 'injected'],
  [{msg:'TypeError: checkout failed',src,iab:'instagram'}, 'site'],
  [{msg:'TypeError: _AutofillCallbackHandler broke checkout',src}, 'site'],
  [{msg:msg+'Suffix',src}, 'site'],
  [{msg,src:'https://matthew.mccluster.org/js/checkout.js'}, 'site'],
  [{msg,src,stack:'checkout@https://matthew.mccluster.org/js/checkout.js:2:1'}, 'site'],
];
for (const file of ['js/analytics.js','js/mc-analytics.js']) {
 test(file+' captures exact browser diagnostic and real errors without cancellation',async()=>{
  const source=await readFile(file,'utf8'), events=[], handlers={};
  const start=source.indexOf('  var INJECTED =');
  const end=source.indexOf(file==='js/analytics.js'?'  /* =========================================================':'  addEventListener("pagehide"',start);
  const context={URL,location:new URL(src),IAB:'instagram',safe:fn=>fn(),T:(name,props)=>events.push({name,props}),track:(name,props)=>events.push({name,props}),addEventListener:(name,fn)=>handlers[name]=fn};
  context.root=context; vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  for(const [p,expected] of cases){
   assert.equal(context.errorOrigin(p.src,p.msg,p.stack),expected,JSON.stringify(p));
   const e={message:p.msg,filename:p.src,error:{stack:p.stack},preventDefault(){throw Error('must not cancel');}};
   handlers.error(e);assert.equal(events.at(-1).props.origin,expected);assert.equal(events.at(-1).props.msg,p.msg);
  }
  handlers.unhandledrejection({reason:{message:'Checkout payment failed',stack:'checkout.js:1'}});
  assert.equal(events.at(-1).props.origin,'site');
  handlers.unhandledrejection({reason:{message:msg}});assert.equal(events.at(-1).props.origin,'injected');
  assert.equal(events.length,cases.length+2,'every event retained');
  assert.equal(context._AutofillCallbackHandler,undefined,'no fake global installed');
 });
}
test('historical classification is conservative and aggregation never merges site evidence into diagnostics',()=>{
 for(const [p,expected] of cases)assert.equal(errorOrigin(p),expected);
 assert.equal(errorOrigin({msg,src,origin:'site'}),'site');
 assert.equal(errorOrigin({msg:'TypeError: _AutofillCallbackHandler broke checkout',origin:'injected'}),'site');
 const rows=['injected','site'].map(origin=>({name:'js_error',props:{msg,src,origin},session_id:origin,at:'2026-10-25T00:00:00Z'}));
 const raw=JSON.stringify(rows), out=summarizeErrors(rows);
 assert.equal(out.errors.length,2);assert.equal(out.totals.site_errors,1);assert.equal(out.totals.injected_errors,1);assert.equal(JSON.stringify(rows),raw);
});
test('journey diagnostics stay visible and raw while actual failures remain red',async()=>{
 const c={window:{CR:{}},URL,console};vm.createContext(c);vm.runInContext(await readFile('js/control-room/forensics.js','utf8'),c);
 const F=c.window.CR.forensics;
 for(const [p,expected] of cases)assert.equal(F.describe({name:'js_error',props:p}).cat,expected==='injected'?'diagnostic':'friction');
 F.state.stack=[{type:'session',id:'fixture'}];
 F.state.detail={session:{started_at:'2026-10-25T00:00:00Z'},events:[{name:'js_error',at:'2026-10-25T00:00:01Z',props:{msg,src,origin:'injected',iab:'instagram'}}]};
 F.state.raw[0]=true;
 const html=F.render();assert.match(html,/crf-step--diagnostic/);assert.doesNotMatch(html,/crf-step--friction| went wrong<\/small>/);assert.match(html,/Browser diagnostics/);assert.match(html,/utm_source=ig/);assert.match(html,/crf-raw/);
});
