// DOM/lifecycle proof with a simulated Cesium API. Not a rendered-device or real-auth test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {leadershipView} from '../workers/mccluster/src/finance/leadership.js';
const {JSDOM}=createRequire(join(process.env.DOM_TEST_MODULE_DIR||'/tmp/finance-roster-test-tools/node_modules','x'))('jsdom');
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,20));
function setup(){
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://fixture.invalid',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,root=w.document.getElementById('root');
 let now=Date.parse('2026-11-11T12:00:00Z'),token='owner',deny=false,delay=null;const calls=[],collections=[],handlers=[];
 class Collection{constructor(){this.rows=[];}add(row){this.rows.push(row);return row;}}
 class Handler{constructor(){this.fn=null;this.destroyed=false;handlers.push(this);}setInputAction(fn){this.fn=fn;}destroy(){this.destroyed=true;}}
 const C={PointPrimitiveCollection:Collection,LabelCollection:Collection,ScreenSpaceEventHandler:Handler,ScreenSpaceEventType:{MOUSE_MOVE:1},Cartesian3:{fromDegrees:(...args)=>args},Cartesian2:class{},DistanceDisplayCondition:class{},Color:{fromCssColorString:x=>x,BLACK:'black',WHITE:'white'},LabelStyle:{FILL_AND_OUTLINE:1}};
 const V={scene:{canvas:{},primitives:{add:x=>(collections.push(x),x),remove:x=>{const i=collections.indexOf(x);if(i>=0)collections.splice(i,1);}},requestRender(){},pick:()=>null},camera:{flyTo(x){V.flight=x;}}};
 w.Cesium=C;w.Date.now=()=>now;w.AbortSignal=AbortSignal;w.crypto.randomUUID=()=> 'fixture';
 w.fetch=async(url,options)=>{calls.push({url,options});const u=new URL(url),path=u.pathname.split('/').at(-1);if(delay&&u.searchParams.get('symbol')===delay.symbol){const d=delay;delay=null;await d.promise;}
  if(deny)return Response.json({code:'forbidden'},{status:403});
  if(path==='leadership')return Response.json({ok:true,...leadershipView({symbol:u.searchParams.get('symbol'),mic:u.searchParams.get('mic'),now})});
  if(path==='leadership-quote')return Response.json({quote:{bid:10,ask:11,currency:'USD',as_of:'2026-11-11T12:00:00Z',provider:'alpaca',feed:'iex',status:'real_time',session:'open'}});
  return Response.json({code:path==='account'?'finance_persistence_disabled':'needs_key'},{status:503});
 };
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const G={api:'https://fixture.invalid',token:()=>token,viewer:()=>V,esc,owner:()=>token==='owner'};
 w.eval(source('js/halo/finance-roster.js'));w.eval(source('js/halo/finance.js'));const ui=w.HaloFinance.mount(root,G);
 return {w,dom,root,ui,G,V,calls,collections,handlers,tick,now:x=>now=x,deny:()=>deny=true,token:x=>token=x,hold(symbol){let release;const promise=new Promise(r=>release=r);delay={symbol,promise};return release;},click(s){root.querySelector(s).click();},close(){ui.destroy();w.close();}};
}
test('actual Finance DOM shows sourced roster without price keys and maps business addresses using existing viewer',async()=>{
 const x=setup();try{await tick();assert.match(x.root.textContent,/5 reviewed companies/);assert.match(x.root.textContent,/Alpaca Paper credentials/);
 x.click('[data-r-symbol="AMD"]');await tick();assert.match(x.root.textContent,/Lisa T. Su/);assert.match(x.root.textContent,/2485 Augustine Drive/);assert.match(x.root.textContent,/address range interpolated/);
 x.click('[data-r-map]');assert.equal(x.collections.length,2);assert.equal(x.collections[0].rows.length,5);assert.deepEqual(x.collections[0].rows[0].position,[-121.971776930382,37.382307061778,100]);
 x.click('[data-r-locate]');assert.equal(x.V.flight.destination[2],3000);assert.equal(x.collections.length,2);assert.ok(x.handlers[0].destroyed);
 x.ui.setVisible(false);assert.equal(x.collections.length,0);assert.ok(x.handlers.every(h=>h.destroyed));assert.ok(x.calls.every(c=>c.options.method==='GET'));
 }finally{x.close();}
});
test('cached real-time hover becomes stale as source timestamp ages, without another provider request',async()=>{
 const x=setup();try{await tick();x.click('[data-r-symbol="AMD"]');await tick();x.click('[data-r-quote]');await tick();assert.match(x.root.querySelector('[data-r-quote-status]').textContent,/real_time.*alpaca.*iex/);
 x.now(Date.parse('2026-11-11T12:00:45Z'));x.click('[data-r-quote]');await tick();assert.match(x.root.querySelector('[data-r-quote-status]').textContent,/stale/);assert.equal(x.calls.filter(c=>c.url.includes('leadership-quote')).length,1);
 }finally{x.close();}
});
test('older issuer request cannot replace newer selection, and destroy prevents late repaint',async()=>{
 const x=setup();try{await tick();const release=x.hold('AMD');x.click('[data-r-symbol="AMD"]');await tick();x.click('[data-r-symbol="VZ"]');await tick();release();await tick();assert.match(x.root.querySelector('[data-r-detail]').textContent,/Verizon/);assert.doesNotMatch(x.root.querySelector('[data-r-detail]').textContent,/Lisa T/);
 const late=x.hold('AMD');x.click('[data-r-symbol="AMD"]');await tick();x.ui.destroy();late();await tick();assert.equal(x.root.textContent,'');
 }finally{x.dom.window.close();}
});
test('backend denial clears roster, financial snapshots, pins and controls; changed session cannot restore data',async()=>{
 const x=setup();try{await tick();x.click('[data-r-symbol="AMD"]');await tick();x.click('[data-r-map]');x.deny();x.click('[data-r-reload]');await tick();assert.equal(x.root.querySelector('[data-r-detail]').textContent,'');assert.equal(x.collections.length,0);assert.match(x.root.querySelector('[data-r-status]').textContent,/Owner authentication required/);assert.ok([...x.root.querySelectorAll('button')].every(b=>b.disabled));
 }finally{x.close();}
});
test('World mode controller preserves one iframe/viewer and tears down after repeated switching, revocation and pagehide',()=>{
 const dom=new JSDOM('<!doctype html><html data-world-mode="posts"><body><iframe id="mnWorldFrame"></iframe><div id="mnWorldFeed"></div></body></html>',{url:'https://fixture.invalid',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;let owner=true,mounts=0,destroys=0,picks=0;
 const frame=w.document.getElementById('mnWorldFrame'),viewer={};frame.contentWindow.HuGlobe={owner:()=>owner,viewer:()=>viewer};w.HaloFinance={mount(){mounts++;return {destroy(){destroys++;},selectLeadership(){picks++;}};}};
 w.eval(source('js/world-finance.mjs'));
 const mode=m=>{w.document.documentElement.dataset.worldMode=m;w.dispatchEvent(new w.Event('mcc:world-mode'));};
 for(let i=0;i<3;i++){mode('finance');assert.equal(w.document.querySelectorAll('#worldFinance').length,1);mode('posts');assert.equal(w.document.querySelectorAll('#worldFinance').length,0);}
 mode('finance');w.dispatchEvent(new w.MessageEvent('message',{origin:'https://evil.invalid',source:frame.contentWindow,data:{type:'hu:finance-company',symbol:'AMD',mic:'XNAS'}}));assert.equal(picks,0);
 w.dispatchEvent(new w.MessageEvent('message',{origin:w.location.origin,source:frame.contentWindow,data:{type:'hu:finance-company',symbol:'AMD',mic:'XNAS'}}));assert.equal(picks,1);
 owner=false;w.dispatchEvent(new w.MessageEvent('message',{origin:w.location.origin,source:frame.contentWindow,data:{type:'hu:finance-access'}}));assert.equal(w.document.querySelectorAll('#worldFinance').length,0);assert.equal(mounts,destroys);assert.equal(w.document.querySelectorAll('iframe').length,1);assert.equal(frame.contentWindow.HuGlobe.viewer(),viewer);w.close();
});
test('World news bridge sends no news markers in Finance and ignores a late news selection',()=>{
 const dom=new JSDOM('<!doctype html><html data-world-mode="finance"><body><iframe id="mnWorldFrame"></iframe><div id="mnFeed"></div></body></html>',{url:'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window,frame=w.document.getElementById('mnWorldFrame'),messages=[];let selected=null;
 frame.contentWindow.postMessage=data=>messages.push(data);w.MCC_WORLD_MODE={get:()=>w.document.documentElement.dataset.worldMode,set:mode=>selected=mode};w.MCC_WORLD_NEWS_ITEMS=()=>[{id:'news1',title:'Fixture',url:'https://example.com',domain:'example.com',lat:40,lon:-73}];w.eval(source('js/world-news-globe.js'));
 assert.equal(messages.at(-1).on,false);assert.equal(messages.at(-1).items.length,0);
 w.dispatchEvent(new w.MessageEvent('message',{source:frame.contentWindow,origin:w.location.origin,data:{type:'hu:world-news-selected',id:'news1'}}));assert.equal(selected,null);
 w.document.documentElement.dataset.worldMode='posts';w.dispatchEvent(new w.Event('mcc:world-mode'));assert.equal(messages.at(-1).on,true);assert.equal(messages.at(-1).items.length,1);w.close();
});
