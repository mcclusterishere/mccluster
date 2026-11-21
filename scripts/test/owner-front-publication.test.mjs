import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../../js/control-room/front-page.js',import.meta.url),'utf8');
const defaults=()=>({scenes:{doors:true,vaunt:true,night:true,world:true},scroll:{duration:0.85,touchLerp:0.14},
  vr:{enabled:true,hold:true,band:[0.4,0.5],yaw:0,pitch:0,spots:[{yaw:0,pitch:0,label:'Home',href:'hire.html',blank:false,urgent:false}]},
  night:{arrive:0.74},start:'cabin',song:'antisocial',visible:true});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const ok=data=>({ok:true,text:async()=>JSON.stringify(data),json:async()=>data});
const snapshot=(revision='0',value=null)=>({schema:'owner-front-publication/v1',revision,value,updated_at:null,history:[]});

function harness(fetchImpl=async()=>ok(snapshot())){
  const events={},formEvents={},actionEvents={},historyEvents={},calls=[];
  let currentToken='owner-token',answerPreview=true;
  const frameWin={postMessage(message){if(message.type==='mcc:front-preview'&&answerPreview)queueMicrotask(()=>events.message({origin:'https://fixture.test',source:frameWin,data:{type:'mcc:front-applied',seq:message.seq,commit:message.commit,config:message.config||defaults()}}));}};
  const iframe={contentWindow:frameWin,parentNode:null};
  const form={addEventListener:(name,fn)=>formEvents[name]=fn};
  const host={querySelector(q){return q==='[data-cfp-frame]'?iframe:q==='[data-cfp-form]'?form:q==='[data-cfp-actions]'?{addEventListener:(name,fn)=>actionEvents[name]=fn}:q==='[data-cfp-history]'?{addEventListener:(name,fn)=>historyEvents[name]=fn}:null;},querySelectorAll:()=>[]};
  const window={CR:{},MCC_SUPA:{url:'https://fixture.test',key:'public-fixture',token:async()=>currentToken},addEventListener:(name,fn)=>events[name]=fn};
  const context={window,document:{querySelector:()=>null},location:{origin:'https://fixture.test'},console,setTimeout,clearTimeout,atob,
    fetch:async(url,init)=>{calls.push({url,init});return fetchImpl(url,init);}};
  vm.runInNewContext(source,context);
  const api=window.CR.frontPage;
  api.init({request(){},render(){}});api.render();api.bind({querySelector:()=>host});
  events.message({origin:'https://fixture.test',source:frameWin,data:{type:'mcc:front-ready'}});
  const click=(name,revision)=>{
    const button={disabled:false,getAttribute:key=>key==='data-cfp'?name:revision};
    (name==='history'?historyEvents:actionEvents).click({target:{closest:()=>button}});
  };
  return {api,calls,events,click,frameWin,setToken:t=>currentToken=t,setPreviewAnswer:v=>answerPreview=v,
    change(name,value){formEvents.change({target:{name,value,checked:!!value,isConnected:true}});}};
}

test('unavailable publication service leaves preview usable and never invokes a legacy writer',async()=>{
  const h=harness(async url=>url.includes('/rpc/')?{ok:false,status:404,text:async()=>JSON.stringify({code:'PGRST202',message:'missing'})}:ok([]));
  for(let i=0;i<4;i++)await tick();
  assert.equal(h.api.state.publicationReady,false);assert.ok(h.api.state.draft);
  assert.match(h.api.render(),/Versioned publishing is not installed/);
  h.change('song','here');await tick();h.click('save');await tick();
  assert.equal(h.calls.filter(c=>/publish|site_content_set|site_content_revert/.test(c.url)).length,0);
});

test('history and reset only stage drafts; publish uses the loaded revision and reset publishes null',async()=>{
  let writes=[];
  const h=harness(async(url,init)=>{
    if(url.endsWith('publish_v1')){writes.push(JSON.parse(init.body));return ok(snapshot(String(writes.length+1),writes.at(-1).p_value===null?null:JSON.stringify(writes.at(-1).p_value)));}
    return ok({...snapshot('1',JSON.stringify(defaults())),history:[{id:'1',value:JSON.stringify({...defaults(),song:'here'})}]});
  });
  await tick();await tick();
  h.click('history','1');await tick();assert.equal(h.api.state.draft.song,'here');assert.equal(writes.length,0);
  h.click('save');await tick();await tick();assert.equal(writes[0].p_expected_revision,'1');assert.equal(writes[0].p_value.song,'here');
  h.click('reset');await tick();assert.equal(writes.length,1);
  h.click('save');await tick();await tick();assert.equal(writes[1].p_value,null);assert.equal(writes[1].p_expected_revision,'2');
});

test('conflicts and unknown outcomes preserve the draft and require reconciliation instead of retry',async()=>{
  for(const code of ['40001','network']){
    let attempts=0;
    const h=harness(async(url)=>{
      if(!url.endsWith('publish_v1'))return ok(snapshot());
      attempts++;if(code==='network')throw new Error('connection lost');
      return {ok:false,status:409,text:async()=>JSON.stringify({code,message:'The live page changed.'})};
    });
    await tick();await tick();h.change('song','here');await tick();h.click('save');await tick();await tick();
    assert.equal(h.api.state.draft.song,'here');assert.equal(h.api.state.dirty,true);assert.equal(h.api.state.publicationReady,false);
    h.click('save');await tick();assert.equal(attempts,1);
  }
});

test('account changes fence delayed history responses and old preview acknowledgements',async()=>{
  let finish;
  const h=harness(()=>new Promise(resolve=>finish=resolve));
  await tick();const oldSeq=h.api.state.seq;
  h.setToken('other-token');h.events['mcc:auth-changed']();
  finish(ok({...snapshot('9',JSON.stringify(defaults())),history:[{id:'9',value:'private'}]}));
  await tick();await tick();
  h.events.message({origin:'https://fixture.test',source:h.frameWin,data:{type:'mcc:front-applied',seq:oldSeq,commit:true,config:defaults()}});
  assert.equal(h.api.state.history.length,0);assert.equal(h.api.state.draft,null);assert.equal(h.api.state.applied,null);
  assert.equal(h.api.state.revision,null);assert.equal(h.api.state.publicationReady,false);
});

test('the editor does not publish after logout during a pending preview acknowledgement',async()=>{
  const h=harness();await tick();await tick();h.change('song','here');await tick();h.setPreviewAnswer(false);h.click('save');
  h.setToken(null);h.events['mcc:auth-changed']();await tick();await tick();
  assert.equal(h.calls.some(c=>c.url.endsWith('publish_v1')),false);
  assert.equal(h.api.state.draft,null);
});

test('refreshing a JWT for the same account preserves the private editing session',async()=>{
  const h=harness();await tick();await tick();
  const jwt=expiry=>'x.'+Buffer.from(JSON.stringify({sub:'same-owner',exp:expiry})).toString('base64url')+'.y';
  h.setToken(jwt(1));h.events['mcc:auth-changed']();await tick();h.click('reload');await tick();await tick();
  h.change('song','here');await tick();
  h.setToken(jwt(2));h.events['mcc:auth-changed']();await tick();
  assert.equal(h.api.state.draft.song,'here');assert.equal(h.api.state.publicationReady,true);
});

test('malformed service responses and failed public reads do not invent a successful live load',async()=>{
  const h=harness(async url=>url.includes('/rpc/')?ok({schema:'unknown'}):{ok:false,status:503,json:async()=>[]});
  await tick();await tick();assert.equal(h.api.state.publicationReady,false);assert.equal(h.api.state.draft,null);
  assert.match(h.api.render(),/Live settings could not be read/);
});

test('the immediate copy pencil is absent in private Control previews but unchanged on the standalone page',()=>{
  const pencil=readFileSync(new URL('../../js/site-editor.js',import.meta.url),'utf8');
  for(const path of ['control.html','front-studio.html','index.html']){
    let sessionReads=0;
    const w={parent:{location:{origin:'https://fixture.test',pathname:'/'+path}}};
    vm.runInNewContext(pencil,{window:w,document:{},location:{origin:'https://fixture.test',pathname:'/index.html'},
      localStorage:{getItem(){sessionReads++;return null;}}});
    assert.equal(sessionReads,path==='index.html'?1:0,path);
  }
});
