// Actual dashboard DOM with stub transport. No real browser, custodian, feed or writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {universeSummary,universeView} from '../workers/mccluster/src/finance/universe.js';
const {JSDOM}=createRequire(join(process.env.DOM_TEST_MODULE_DIR||'/tmp/finance-roster-test-tools/node_modules','x'))('jsdom');
const src=readFileSync(new URL('../js/halo/finance-dashboard.js',import.meta.url),'utf8'),tick=()=>new Promise(r=>setTimeout(r,20));
function setup(){const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window,root=w.document.getElementById('root');let denied=false,hold=null;const calls=[];
 const ask=async path=>{calls.push(path);if(denied)throw {code:'forbidden',status:403};const u=new URL(path,'https://fixture.invalid/');if(hold&&u.searchParams.get('q')===hold.q){const h=hold;hold=null;await h.promise;}
  if(u.pathname==='/dashboard')return {baseline:{status:'unknown'},universe:universeSummary()};
  if(u.pathname==='/universe')return universeView({q:u.searchParams.get('q')||'',scope:u.searchParams.get('scope')||'directory',exchange:u.searchParams.get('exchange')||'',offset:Number(u.searchParams.get('offset')||0),limit:Number(u.searchParams.get('limit')||25)});
  if(u.pathname==='/economy')return {observations:[{label:'Real GDP growth, annual',value:2.4,unit:'%',period:'2025',frequency:'annual',source:'World Bank, World Development Indicators',retrieved_at:'2026-11-11T00:00:00Z',is_live:false}]};throw Error(path);
 };
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));w.eval(src);const ui=w.HaloFinanceDashboard.mount(root,{esc},ask);
 return {w,root,dom,ui,calls,denied:()=>denied=true,hold(q){let release;const promise=new Promise(r=>release=r);hold={q,promise};return release;},click(s){root.querySelector(s).click();},submit(s){root.querySelector(s).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));},close(){ui.destroy();w.close();}};
}
test('unknown actual holdings are not displayed as a zero balance or paper holdings; sourced directory is paginated',async()=>{
 const x=setup();try{await tick();assert.match(x.root.querySelector('[data-d-baseline]').textContent,/Actual holdings: unknown/);assert.match(x.root.textContent,/Unknown holdings are not an empty portfolio/);assert.match(x.root.querySelector('[data-d-coverage]').textContent,/10,414.*8,009/);assert.equal(x.root.querySelectorAll('[data-d-results] li').length,25);assert.match(x.root.querySelector('[data-d-results-status]').textContent,/1–25 of 10414/);
 x.click('[data-d-next]');await tick();assert.match(x.root.querySelector('[data-d-results-status]').textContent,/26–50/);x.click('[data-d-previous]');await tick();assert.match(x.root.querySelector('[data-d-results-status]').textContent,/1–25/);assert.equal(x.w.localStorage.length,0);
 }finally{x.close();}
});
test('sector pilot is visibly research-only with no security or ownership inference',async()=>{
 const x=setup();try{await tick();x.root.querySelector('[data-d-scope]').value='sector_pilot';x.submit('[data-d-search]');await tick();assert.match(x.root.querySelector('[data-d-results-status]').textContent,/of 18/);assert.equal(x.root.querySelectorAll('[data-d-results] li').length,18);assert.match(x.root.querySelector('[data-d-results]').textContent,/ordinary_registered_share/);assert.match(x.root.querySelector('[data-d-results]').textContent,/direct-purchase eligibility unknown/);assert.ok(x.root.querySelector('[data-d-next]').disabled);
 }finally{x.close();}
});
test('contribution scenario rounds up cents, keeps returns separate and performs no network/storage write',async()=>{
 const x=setup();try{await tick();const before=x.calls.length;for(const [name,value]of Object.entries({target:'120000.01',contributed:'20000',months:'48',perIssuer:'500'}))x.root.querySelector('[name="'+name+'"]').value=value;x.submit('[data-d-plan]');assert.match(x.root.querySelector('[data-d-plan-result]').textContent,/\$100,000.01 remaining.*\$2,083.34 per month.*200 initial/);assert.equal(x.calls.length,before);assert.equal(x.w.localStorage.length,0);
 x.root.querySelector('[name="perIssuer"]').value='1.001';x.submit('[data-d-plan]');assert.match(x.root.querySelector('[data-d-plan-result]').textContent,/at most two decimal/);
 }finally{x.close();}
});
test('latest directory filter wins; denied access clears financial scenario and source results',async()=>{
 const x=setup();try{await tick();const release=x.hold('AMD');x.root.querySelector('[data-d-query]').value='AMD';x.submit('[data-d-search]');await tick();x.root.querySelector('[data-d-query]').value='VZ';x.submit('[data-d-search]');await tick();release();await tick();assert.match(x.root.querySelector('[data-d-results]').textContent,/VERIZON/);assert.doesNotMatch(x.root.querySelector('[data-d-results]').textContent,/ADVANCED MICRO/);
 x.root.querySelector('[name="target"]').value='123456.78';x.root.querySelector('[name="contributed"]').value='45678.90';x.root.querySelector('[name="perIssuer"]').value='999';x.denied();x.click('[data-d-economy]');await tick();assert.match(x.root.querySelector('[data-d-status]').textContent,/Owner authentication required/);assert.equal(x.root.querySelector('[data-d-results]').textContent,'');assert.ok([...x.root.querySelectorAll('input,button,select')].every(b=>b.disabled));assert.ok([...x.root.querySelectorAll('input')].every(b=>b.value===''));
 }finally{x.close();}
});
test('annual economic context loads on request and is not mislabeled real-time',async()=>{
 const x=setup();try{await tick();assert.ok(!x.calls.includes('economy'));x.click('[data-d-economy]');await tick();assert.match(x.root.querySelector('[data-d-economy-result]').textContent,/period 2025.*annual.*not live/);assert.match(x.root.querySelector('[data-d-economy-result]').textContent,/World Bank.*retrieved/);x.ui.destroy();assert.equal(x.root.textContent,'');
 }finally{x.dom.window.close();}
});
test('integrated Finance session revocation clears populated contribution inputs, not just results',async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window,root=w.document.getElementById('root');let token='owner';
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));w.AbortSignal=AbortSignal;
 w.fetch=async url=>{const u=new URL(url),path=u.pathname.split('/').at(-1);if(path==='dashboard')return Response.json({baseline:{status:'unknown'},universe:universeSummary()});if(path==='universe')return Response.json(universeView());return Response.json({code:'finance_persistence_disabled'},{status:503});};
 w.eval(src);w.eval(readFileSync(new URL('../js/halo/finance.js',import.meta.url),'utf8'));const ui=w.HaloFinance.mount(root,{esc,api:'https://fixture.invalid',token:()=>token});
 try{await tick();root.querySelector('[name="target"]').value='100000';root.querySelector('[name="contributed"]').value='60000';token='another-session';w.dispatchEvent(new w.StorageEvent('storage',{key:null,newValue:null}));assert.equal(root.querySelector('[name="target"]').value,'');assert.equal(root.querySelector('[name="contributed"]').value,'');assert.equal(root.querySelector('[data-d-results]').textContent,'');assert.match(root.querySelector('[data-d-status]').textContent,/Owner authentication required/);}
 finally{ui.destroy();w.close();}
});
