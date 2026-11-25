import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const context={window:{CR:{}},Intl};vm.createContext(context);vm.runInContext(await readFile('js/control-room/analytics-unified.js','utf8'),context);
const U=context.window.CR.analyticsUnified;
const state=()=>({site:'__first_party__',range:{label:'24 hours'},updatedAt:'2026-01-01',errors:{},quality:{},completed:{totals:true,business:true,missions:true,funnel:true},data:{traffic:{totals:{visitors:0,page_views:12}},business:{snapshot:{window:{},users:{created_in_window:2},music:{plays:{in_window:7}},commerce:{available:true,live_in_window:{net_cents:1234}}}},missions:[{submitted:3}],funnel:[]}});
const render=s=>U.overview(s,{scopeLabel:()=> 'Worldwide · 24 hours',chart:'<svg aria-label="Existing trend"></svg>'});
test('three groups retain all six drilldowns, zero values, currency and distinct time scopes',()=>{
  const html=render(state());assert.equal((html.match(/class="cu-summary-group"/g)||[]).length,3);
  for(const label of ['Audience','Content','Business','Unique visitors: 0','Page views: 12','Music plays: 7','New accounts: 2','Verified sales: $12.34','Awaiting review: 3','Mission assignments · all time','Existing trend'])assert.ok(html.includes(label),label);
  for(const target of ['audience','content','identity','action'])assert.ok(html.includes('data-cra-sec="'+target+'"'));
});
test('failed and waiting reads never display stale values as current',()=>{
  const s=state();s.errors.totals={message:'offline'};s.completed.business=false;
  const html=render(s);assert.ok(html.includes('Unique visitors: —'));assert.ok(html.includes('Verified sales: —'));assert.ok(html.includes('Some data unavailable'));assert.ok(html.includes('Waiting for data'));
});
test('external properties do not expose house commerce or accounts',()=>{
  const s=state();s.site='external-fixture';const html=render(s);
  assert.equal((html.match(/class="cu-summary-group"/g)||[]).length,2);
  assert.doesNotMatch(html,/Verified sales|New accounts|Awaiting review/);
});
