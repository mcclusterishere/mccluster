import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

const source = readFileSync('js/analytics.js', 'utf8');
function tracker({failFirst=false, consent=true}={}) {
  const sent=[], listeners={}, docListeners={}, values=new Map();
  const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),key:i=>[...values.keys()][i],get length(){return values.size;}};
  const location=new URL('https://matthew.mccluster.org/listen.html?token=URLSECRET#private');
  const document={referrer:'https://user:password@example.org/from?token=REFSECRET#private',visibilityState:'visible',addEventListener:(n,f)=>(docListeners[n]??=[]).push(f)};
  let allowed=consent;
  const context={location,document,navigator:{},localStorage:storage,sessionStorage:storage,URL,URLSearchParams,
    crypto:{randomUUID},setTimeout:()=>1,setInterval:()=>1,clearTimeout(){},
    mccPrivacyAcknowledged:()=>allowed,mccControlPreview:()=>false,
    fetch:async(url,init)=>{sent.push({url,init,body:JSON.parse(init.body)});return {ok:!(failFirst && sent.length===1),clone:()=>({json:async()=>({ok:true})})};}};
  context.window={performance:{now:()=>0},crypto:context.crypto,navigator:context.navigator,addEventListener:(n,f)=>(listeners[n]??=[]).push(f)};
  const factoryStart=source.indexOf('/* EVENT_OUTBOX_FACTORY_BEGIN */'), factoryEnd=source.indexOf('/* EVENT_OUTBOX_FACTORY_END */');
  vm.runInNewContext(source.slice(factoryStart,factoryEnd),context);
  vm.runInNewContext(source.slice(source.indexOf('/* PLAYBACK_MEASUREMENT_FACTORY_BEGIN */'),source.indexOf('/* PLAYBACK_MEASUREMENT_FACTORY_END */')),context);
  const start=source.indexOf('window.MCC_TRACK = (function () {'),end=source.indexOf('\n})();',start)+6;
  vm.runInNewContext(source.slice(start,end),context);
  return {sent,values,document,track:context.window.MCC_TRACK,playback:context.window.MCC_PLAYBACK,revoke(){allowed=false;},
    fire(name,event={}){for(const fn of (listeners[name]||[]))fn(event);},
    hide(){document.visibilityState='hidden';for(const fn of docListeners.visibilitychange||[])fn({});}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('diagnostics preserve the exact browser signature and real app evidence, stripping URL secrets',async()=>{
  const t=tracker();
  t.track('js_error',{msg:"ReferenceError: Can't find variable: _AutofillCallbackHandler",src:'https://matthew.mccluster.org/listen.html?utm_source=ig&access_token=SECRET',origin:'injected',iab:'instagram',custom:'PRIVATE'});
  t.track('js_error',{msg:'TypeError: cannot read properties of null',src:'https://user:pass@matthew.mccluster.org/js/app.js?token=SECRET',line:12,col:4,origin:'site',stack:'render@https://matthew.mccluster.org/js/app.js:12:4',email:'private@example.org'});
  t.fire('pagehide');await settle();
  const [browser,app]=t.sent[0].body.events;
  assert.equal(browser.props.msg,"ReferenceError: Can't find variable: _AutofillCallbackHandler");
  assert.equal(browser.props.origin,'injected');assert.equal(browser.props.iab,'instagram');
  assert.equal(app.props.origin,'site');assert.equal(app.props.line,12);assert.equal(app.props.col,4);
  assert.equal(app.props.stack,'render@https://matthew.mccluster.org/js/app.js:12:4');
  assert.equal(app.referrer,'https://example.org/from');
  assert.doesNotMatch(JSON.stringify(t.sent),/SECRET|PRIVATE|user:pass|private@example/);
});

test('interaction allowlists omit screen prose and copied text; URLs and custom properties are bounded',async()=>{
  const t=tracker();
  t.track('click',{text:'Private visitor biography',el:'button.submit',href:'/account?email=visitor@example.org#session',x:4,body:'PRIVATE'});
  t.track('copy',{chars:23,text:'Private visitor biography'});
  const cycle={};cycle.self=cycle;
  t.track('product_action',{nested:{email:'visitor@example.org',access_token:'SECRET',message:'PRIVATE',ok:1},memo:'email visitor@example.org Bearer SECRET',cycle,nonfinite:Infinity,items:Array(40).fill(1)});
  t.fire('pagehide');await settle();
  const [click,copy,custom]=t.sent[0].body.events;
  assert.equal(click.props.href,'https://matthew.mccluster.org/account');assert.equal(click.props.x,4);
  assert.deepEqual(copy.props,{chars:23});assert.deepEqual(custom.props.nested,{ok:1});
  assert.equal(custom.props.items.length,20);assert.equal(custom.props.nonfinite,null);
  assert.doesNotMatch(JSON.stringify(t.sent),/Private visitor|visitor@example|SECRET|PRIVATE/);
});

test('late hidden and pagehide producers use keepalive; BFCache restore resumes batching',async()=>{
  const t=tracker();t.track('page_view',{});t.hide();
  t.track('dwell',{s:12});t.track('page_leave',{visible_s:12});await settle();
  assert.deepEqual(t.sent.flatMap(x=>x.body.events.map(e=>e.name)),['page_view','dwell','page_leave']);
  assert.ok(t.sent.every(x=>x.init.keepalive));
  t.document.visibilityState='visible';t.fire('pageshow');t.track('click',{});assert.equal(t.sent.length,3);
  t.fire('pagehide');t.track('page_leave',{});await settle();
  assert.equal(t.sent.length,5);assert.ok(t.sent[4].init.keepalive);
});

test('fallback retries reuse minimized event IDs and consent revocation blocks later events',async()=>{
  const t=tracker({failFirst:true});t.track('js_rejection',{msg:'password=SECRET email=visitor@example.org',origin:'site'});t.fire('pagehide');await settle();
  assert.equal(t.sent.length,2);assert.deepEqual(t.sent[0].body,t.sent[1].body);
  assert.match(t.sent[0].body.events[0].id,/^[a-f0-9-]{36}$/);assert.doesNotMatch(JSON.stringify(t.sent),/SECRET|visitor@example/);
  t.revoke();t.track('page_leave',{});await settle();assert.equal(t.sent.length,2);
  const no=tracker({consent:false});no.track('page_view',{});no.fire('pagehide');await settle();assert.equal(no.sent.length,0);
});

// The storage event may arrive after consent was accepted again in another tab.
// Invalidate the old counter even when the next sample sees current consent.
test('cross-tab withdrawal or storage clear ends playback attempts before re-acceptance',()=>{
  const t=tracker(), audio={currentTime:0,playbackRate:1,paused:false,seeking:false,readyState:4};
  for(const key of ['mcc_privacy_ack',null]) {
    const old=t.playback.create(audio);assert.ok(old);old.playing();
    t.fire('storage',{key,newValue:null});
    assert.equal(old.valid(),false);assert.equal(old.seconds(),null);
    assert.equal(old.report().playback_attempt_id,undefined);
    const fresh=t.playback.create(audio);assert.ok(fresh);assert.equal(fresh.valid(),true);
  }
});
