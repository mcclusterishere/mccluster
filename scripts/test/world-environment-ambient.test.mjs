/* No network or private records. Public composition is independent of the
 * selected workspace; only the existing transport's public route is requested. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountEnvironment } from '../../vendor/equity-uprise/src/environment/panel.mjs';
import { mcclusterEnvironmentAdapter } from '../../js/world-environment-mccluster.mjs';

class Element {
  constructor() { this.children=[]; this.hidden=false; this.textContent=''; }
  set innerHTML(value) { this.ids=Object.fromEntries([...value.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));this.children=Object.values(this.ids); }
  querySelector(selector) { return this.ids?.[selector.slice(1)] || null; }
  querySelectorAll() { return []; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children=items; }
  setAttribute() {} removeAttribute() {} scrollIntoView() {}
}
const flush=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));};
const observation={id:'usgs:fixture',title:'Fixture quake',lat:41,lon:-73,observed_at:'2026-11-09T12:00:00Z',fetched_at:'2026-11-09T12:01:00Z',stale:false,source:{label:'USGS',url:'https://earthquake.usgs.gov/'},actions:[]};
const body={schema:'world-environment/v1',events:[observation,{...observation,id:'nws:unmapped',title:'Unlocated alert',lat:null,lon:null,source:{label:'NOAA NWS',url:'https://www.weather.gov/'}}],sources:[],missions:[]};
function fixture({ambient=true,fail=false,pause=false,lateController=false}={}) {
  const panel=new Element(),frame={contentWindow:{}},handlers=new Map(),calls=[],sent=[];
  let mode='posts',release,tokenReads=0,controllerReady=!lateController;
  const w={location:{origin:'https://example.invalid'},addEventListener:(k,v)=>handlers.set(k,v),removeEventListener:(k,v)=>{if(handlers.get(k)===v)handlers.delete(k);}};
  const d={hidden:false,documentElement:{dataset:{worldMode:'posts'}},createElement:()=>new Element()};
  const setMode=value=>{mode=value;d.documentElement.dataset.worldMode=value;handlers.get('environment:mode')?.();};
  const adapter={panel,frame,ambientEvidence:ambient,mode:()=>mode,token:async()=>{tokenReads++;return null;},signIn(){},sendGlobe:data=>sent.push(data),revealPanel:()=>{if(!controllerReady)return false;if(mode!=='environment')setMode('environment');return true;},request:async(path,options)=>{calls.push({path,options});if(path!=='')throw Error('Unexpected private request');if(pause)await new Promise(r=>release=r);if(fail)throw Error('Provider unavailable');return structuredClone(body);}};
  const mounted=mountEnvironment(w,d,adapter);
  return {panel,frame,w,d,handlers,calls,sent,setMode,mounted,ready:()=>{controllerReady=true;setMode('posts');},release:()=>release?.(),tokenReads:()=>tokenReads};
}

test('initial News view fetches public evidence and maps it without a layer switch',async()=>{
  const f=fixture();try{await flush();assert.equal(f.panel.hidden,true);assert.deepEqual(f.calls.map(x=>x.path),['']);assert.equal(f.tokenReads(),0);
    const pins=f.sent.at(-1);assert.equal(pins.on,true);assert.equal(pins.items.length,1);assert.match(pins.items[0].title,/^USGS · Fixture quake/);assert.equal(pins.items[0].stale,false);
    assert.deepEqual(Object.keys(pins.items[0]).sort(),['id','lat','lon','stale','title']);
    assert.equal(f.panel.querySelector('#weEvents').children.length,2);
  }finally{f.mounted.destroy();}
});
test('repeated News/detail navigation retains public pins and never writes',async()=>{
  const f=fixture();try{await flush();for(let i=0;i<3;i++){f.setMode('environment');await flush();f.setMode('posts');await flush();assert.equal(f.sent.at(-1).on,true);assert.equal(f.sent.at(-1).items.length,1);}
    assert.ok(f.calls.every(c=>c.path===''&&!c.options?.auth&&!c.options?.method));
  }finally{f.mounted.destroy();}
});
test('a hidden-panel search does not silently filter the ambient public globe',async()=>{
  const f=fixture();try{await flush();f.setMode('environment');f.panel.querySelector('#weSearch').oninput({target:{value:'not present'}});assert.equal(f.sent.at(-1).items.length,0);
    f.setMode('posts');assert.equal(f.sent.at(-1).items.length,1);
  }finally{f.mounted.destroy();}
});
test('selecting a real globe pin opens its sourced detail but foreign messages do not',async()=>{
  const f=fixture();try{await flush();const message=f.handlers.get('message');message({origin:'https://evil.invalid',source:f.frame.contentWindow,data:{type:'hu:environment-selected',id:observation.id}});assert.equal(f.panel.hidden,true);
    message({origin:f.w.location.origin,source:{},data:{type:'hu:environment-selected',id:observation.id}});assert.equal(f.panel.hidden,true);
    message({origin:f.w.location.origin,source:f.frame.contentWindow,data:{type:'hu:environment-selected',id:'unknown'}});assert.equal(f.panel.hidden,true);
    message({origin:f.w.location.origin,source:f.frame.contentWindow,data:{type:'hu:environment-selected',id:observation.id}});await flush();assert.equal(f.panel.hidden,false);assert.equal(f.panel.querySelector('#weDetail').hidden,false);assert.equal(f.sent.at(-1).selected,observation.id);
  }finally{f.mounted.destroy();}
});
test('feed failure yields no fabricated or retained current pins',async()=>{
  const f=fixture({fail:true});try{await flush();assert.equal(f.sent.at(-1).on,true);assert.deepEqual(f.sent.at(-1).items,[]);assert.match(f.panel.querySelector('#weStatus').textContent,/unavailable/);}finally{f.mounted.destroy();}
});
test('unmount during public fetch cannot recreate pins and teardown stays idempotent',async()=>{
  const f=fixture({pause:true});f.mounted.destroy();const count=f.sent.length;f.release();await flush();assert.equal(f.sent.length,count);assert.equal(f.sent.at(-1).on,false);f.mounted.destroy();assert.equal(f.sent.length,count);
});
test('portable hosts without ambient composition retain their previous mode contract',async()=>{
  const f=fixture({ambient:false});try{await flush();assert.equal(f.calls.length,0);assert.equal(f.sent.at(-1).on,false);f.setMode('environment');await flush();assert.equal(f.sent.at(-1).on,true);f.setMode('posts');assert.equal(f.sent.at(-1).on,false);}finally{f.mounted.destroy();}
});
test('consumer composition enables ambient evidence and opens existing environment mode',()=>{
  const modes=[];let mode='posts';const adapter=mcclusterEnvironmentAdapter({location:{origin:'https://mccluster.org'},fetch(){},MCC_WORLD_MODE:{get:()=>mode,set:value=>{mode=value;modes.push(value);}}});
  assert.equal(adapter.ambientEvidence,true);adapter.revealPanel();assert.deepEqual(modes,['environment']);
  adapter.revealPanel();assert.deepEqual(modes,['environment'],'ordinary detail selection must not reload private state or discard an open editor');
});


test('a pin selected before the asynchronous mode controller is ready opens on initialization',async()=>{
  const f=fixture({lateController:true});try{await flush();f.handlers.get('message')({origin:f.w.location.origin,source:f.frame.contentWindow,data:{type:'hu:environment-selected',id:observation.id}});
    assert.equal(f.panel.hidden,true);assert.equal(f.tokenReads(),0);
    f.ready();await flush();assert.equal(f.panel.hidden,false);assert.equal(f.sent.at(-1).selected,observation.id);assert.equal(f.panel.querySelector('#weDetail').hidden,false);assert.equal(f.tokenReads(),1,'one private-state check on the actual detail navigation');
    f.setMode('posts');assert.equal(f.panel.hidden,true,'the old selection must not replay after later deliberate navigation');
  }finally{f.mounted.destroy();}
});
test('a queued startup selection cannot navigate after the panel is destroyed',async()=>{
  const f=fixture({lateController:true});await flush();f.handlers.get('message')({origin:f.w.location.origin,source:f.frame.contentWindow,data:{type:'hu:environment-selected',id:observation.id}});f.mounted.destroy();const count=f.sent.length;f.ready();await flush();assert.equal(f.panel.hidden,true);assert.equal(f.sent.length,count);assert.equal(f.tokenReads(),0);
});
test('the McCluster host explicitly reports navigation readiness',()=>{
  const w={location:{origin:'https://mccluster.org'},fetch(){}};const adapter=mcclusterEnvironmentAdapter(w);assert.equal(adapter.revealPanel(),false);
  let mode='posts';w.MCC_WORLD_MODE={get:()=>mode,set:value=>mode=value};assert.equal(adapter.revealPanel(),true);assert.equal(mode,'environment');
});
