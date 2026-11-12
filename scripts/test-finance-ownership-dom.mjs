// Actual ownership/Finance DOM with fixture transport. No account access, signup or trade.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {ownershipOptionsView} from '../workers/mccluster/src/finance/ownership-options.js';
import {universeSummary,universeView} from '../workers/mccluster/src/finance/universe.js';
const {JSDOM}=createRequire(join(process.env.DOM_TEST_MODULE_DIR||'/tmp/finance-roster-test-tools/node_modules','x'))('jsdom');
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),tick=()=>new Promise(r=>setTimeout(r,20)),now=Date.parse('2026-11-12T12:00:00Z');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setup(){const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window,root=w.document.getElementById('root');let deny=false,hold=null;const calls=[];
 const ask=async path=>{calls.push(path);if(deny)throw {status:403,code:'forbidden'};const p=new URL(path,'https://fixture.invalid/').searchParams;if(hold&&p.get('issuer_id')===hold.id){const h=hold;hold=null;await h.promise;}return ownershipOptionsView({issuer_id:p.get('issuer_id'),symbol:p.get('symbol'),mic:p.get('mic'),now});};
 w.eval(source('js/halo/finance-ownership.js'));const ui=w.HaloFinanceOwnership.mount(root,{esc},ask);
 return {w,root,ui,calls,deny:()=>deny=true,hold(id){let release;const promise=new Promise(r=>release=r);hold={id,promise};return release;},change(s,value){root.querySelector(s).value=value;root.querySelector(s).dispatchEvent(new w.Event('change',{bubbles:true}));},close(){ui.destroy();w.close();}};
}
test('ownership DOM keeps nominee/DRS/ADR methods, monetary vs share minima and unknown fees distinct',async()=>{
 const x=setup();try{await tick();assert.equal(x.root.querySelectorAll('.hm__ownership-route').length,13);assert.match(x.root.textContent,/Plan nominee holding; whole-share DRS exit/);assert.match(x.root.textContent,/Registered ADRs, not underlying ordinary shares/);assert.match(x.root.textContent,/1 existing whole share/);assert.match(x.root.textContent,/Unknown, not a zero fee/);assert.match(x.root.textContent,/General-public wording; U.S.-specific acceptance unconfirmed/);assert.match(x.root.textContent,/No general Japanese registrar first-purchase DSPP/);assert.equal(x.w.localStorage.length,0);
 x.change('[data-o-domicile]','JP');assert.equal(x.root.querySelectorAll('.hm__ownership-route').length,1);assert.match(x.root.querySelector('[data-o-routes]').textContent,/Sony Group/);assert.match(x.root.querySelector('[data-o-routes]').textContent,/underlying Japanese ordinary shares/);
 }finally{x.close();}
});
test('issuer matching rejects ticker-only selection and does not join Air Liquide to US AI',async()=>{
 const x=setup();try{await tick();const before=x.calls.length;await x.ui.select({symbol:'AI'});assert.equal(x.calls.length,before);assert.match(x.root.querySelector('[data-o-status]').textContent,/Verified listing identity is needed/);assert.equal(x.root.querySelectorAll('.hm__ownership-route').length,0);
 await x.ui.select({symbol:'AI',mic:'XNYS'});assert.equal(x.root.querySelectorAll('.hm__ownership-route').length,0);assert.doesNotMatch(x.root.querySelector('[data-o-routes]').textContent,/Air Liquide/);
 await x.ui.select({issuer_id:'sec:0000788784'});assert.equal(x.root.querySelectorAll('.hm__ownership-route').length,1);assert.match(x.root.querySelector('[data-o-routes]').textContent,/Public Service Enterprise/);
 }finally{x.close();}
});
test('latest issuer request wins and denied access or destroy prevents late rendering',async()=>{
 const x=setup();try{await tick();const release=x.hold('sec:0000080424');const old=x.ui.select({issuer_id:'sec:0000080424'});await tick();await x.ui.select({issuer_id:'sec:0000788784'});release();await old;assert.match(x.root.querySelector('[data-o-routes]').textContent,/Public Service Enterprise/);assert.doesNotMatch(x.root.querySelector('[data-o-routes]').textContent,/Procter/);
 x.deny();await x.ui.select();assert.match(x.root.querySelector('[data-o-status]').textContent,/Owner authentication required/);assert.equal(x.root.querySelector('[data-o-routes]').textContent,'');assert.ok([...x.root.querySelectorAll('select,button')].every(e=>e.disabled));x.ui.destroy();assert.equal(x.root.textContent,'');
 }finally{x.w.close();}
});
test('existing Finance dashboard and saved watch selection open issuer-bound research without a new watchlist or writes',async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window,root=w.document.getElementById('root'),calls=[];w.AbortSignal=AbortSignal;
 let holdMarket=null;w.fetch=async(url,opts)=>{calls.push({url,method:opts.method});const u=new URL(url),path=u.pathname.split('/').at(-1),p=u.searchParams;
  if(path==='ownership-options')return Response.json(ownershipOptionsView({issuer_id:p.get('issuer_id'),symbol:p.get('symbol'),mic:p.get('mic'),now}));
  if(path==='dashboard')return Response.json({baseline:{status:'unknown'},universe:universeSummary({now})});
  if(path==='universe')return Response.json(universeView({q:'PROCTER & GAMBLE',now}));
  if(path==='market'&&p.has('symbol')){if(holdMarket){const h=holdMarket;holdMarket=null;await h;}return Response.json({quote:{instrument:{symbol:'PG',mic:'XNYS'},status:'stale',session:'closed',bid:null,ask:null},history:{instrument:{symbol:'PG',mic:'XNYS'},bars:[],period:'1Y'}});}
  if(path==='market')return Response.json({items:[]});
  return Response.json({code:'finance_persistence_disabled'},{status:503});
 };
 for(const p of ['js/halo/finance-ownership.js','js/halo/finance-dashboard.js','js/halo/finance.js'])w.eval(source(p));const ui=w.HaloFinance.mount(root,{esc,api:'https://fixture.invalid',token:()=> 'owner'});
 try{await tick();const b=root.querySelector('[data-f-ownership-issuer="sec:0000080424"]');assert.ok(b);b.click();await tick();assert.match(root.querySelector('[data-o-routes]').textContent,/Procter/);
 // The same saved-symbol control already used by the canonical account's watchlist.
 const watch=w.document.createElement('button');watch.dataset.fSymbol='PG';root.append(watch);watch.click();await tick();assert.ok(calls.some(c=>c.url.includes('ownership-options?symbol=PG&mic=XNYS')));assert.match(root.querySelector('[data-o-routes]').textContent,/Procter/);assert.ok(calls.every(c=>c.method==='GET'));assert.equal(w.localStorage.length,0);
 let releaseMarket;holdMarket=new Promise(r=>releaseMarket=r);watch.click();await tick();const issuer=w.document.createElement('button');issuer.dataset.fOwnershipIssuer='sec:0000788784';root.append(issuer);issuer.click();await tick();releaseMarket();await tick();assert.match(root.querySelector('[data-o-routes]').textContent,/Public Service Enterprise/);assert.doesNotMatch(root.querySelector('[data-o-routes]').textContent,/Procter/);
 holdMarket=new Promise(r=>releaseMarket=r);watch.click();await tick();root.querySelector('[data-o-all]').click();await tick();releaseMarket();await tick();assert.equal(root.querySelectorAll('.hm__ownership-route').length,13);
 w.dispatchEvent(new w.StorageEvent('storage',{key:'mccdb_session'}));assert.equal(root.querySelector('[data-o-routes]').textContent,'');assert.match(root.querySelector('[data-o-status]').textContent,/Owner authentication required/);
 }finally{ui.destroy();w.close();}
});
