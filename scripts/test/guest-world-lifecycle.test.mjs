import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../../js/guest-world.js',import.meta.url),'utf8');
async function fixture(){
 const timers=new Map(),events={},loads={},replacements=[];let timerId=0,observe,srcWrites=0,top=2000;
 const location={href:'about:blank',replace:url=>{replacements.push(url);location.href='https://example.test/'+url;}};
 const frame={isConnected:true,contentWindow:{location},getAttribute:()=> 'guest-globe.html?entry=parent',addEventListener:(k,f)=>loads[k]=f,set src(v){srcWrites++;this.assigned=v;}};
 const panel={hidden:false,hasAttribute:()=>true,querySelector:s=>s==='iframe[data-src]'?frame:null,getBoundingClientRect:()=>({top,bottom:top+400})};
 const window={innerHeight:800,addEventListener:(k,f)=>events[k]=f,IntersectionObserver:function(cb){observe=cb;this.observe=()=>{};this.disconnect=()=>{};}};window.parent=window;
 const document={baseURI:'https://example.test/front.html',getElementById:()=>panel,documentElement:{getAttribute:()=>null},activeViewTransition:null};
 vm.runInNewContext(code,{window,document,location:{origin:'https://example.test'},URL,IntersectionObserver:window.IntersectionObserver,localStorage:{getItem:()=>null},Promise,JSON,atob,setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)});
 await Promise.resolve();await Promise.resolve();
 return {frame,panel,document,events,loads,replacements,timers,srcWrites:()=>srcWrites,near:()=>{top=100;observe([{isIntersecting:true}]);},far:()=>{top=2000;},tick:()=>{const queued=[...timers.values()];timers.clear();queued.forEach(fn=>fn());}};
}
test('a stranded initial iframe gets one replacement, while a committed globe never reloads',async()=>{
 const f=await fixture();assert.equal(f.srcWrites(),0);f.near();assert.equal(f.srcWrites(),1);f.tick();assert.deepEqual(f.replacements,['https://example.test/guest-globe.html?entry=parent']);f.near();f.tick();assert.equal(f.replacements.length,1);
 const ready=await fixture();ready.near();ready.frame.contentWindow.location.href='https://example.test/guest-globe.html';ready.loads.load();ready.tick();ready.events.pageshow();ready.tick();assert.equal(ready.replacements.length,0);assert.equal(ready.srcWrites(),1);
});
test('hidden/offscreen/departed or replaced frames do not recover; restored blank frame can recover once',async()=>{
 for(const change of [f=>f.panel.hidden=true,f=>f.far(),f=>f.events.pagehide(),f=>f.frame.isConnected=false]){const f=await fixture();f.near();change(f);f.tick();assert.equal(f.replacements.length,0);}
 const f=await fixture();f.near();f.events.pagehide();f.tick();assert.equal(f.timers.size,0);f.events.pageshow();f.tick();assert.equal(f.replacements.length,1);
});
test('parent reveal completes before starting a child and pagehide cancels a queued reveal',async()=>{
 const f=await fixture();let finish;f.document.activeViewTransition={finished:new Promise(r=>finish=r)};f.near();assert.equal(f.srcWrites(),0);finish();await Promise.resolve();await Promise.resolve();assert.equal(f.srcWrites(),1);
 const g=await fixture();let complete;g.document.activeViewTransition={finished:new Promise(r=>complete=r)};g.near();g.events.pagehide();complete();await Promise.resolve();await Promise.resolve();assert.equal(g.srcWrites(),0);
});
