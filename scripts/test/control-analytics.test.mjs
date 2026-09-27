import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read=(p)=>readFile(p,'utf8');

test('Control Analytics cold render is safe before the first network load',async()=>{
  const js=await read('js/control-room/analytics.js');
  const context={window:{CR:{}},console};
  vm.createContext(context);
  vm.runInContext(js,context);
  context.window.CR.analytics.init({
    request:()=>Promise.resolve({}),
    supa:()=>Promise.resolve([])
  });
  assert.doesNotThrow(()=>context.window.CR.analytics.render());
  assert.match(context.window.CR.analytics.render(),/>Analytics</);
});

test('Control Analytics mount paints immediately and fails visibly instead of going blank',async()=>{
  const js=await read('js/control-room/analytics.js');
  const context={window:{CR:{}},console};
  vm.createContext(context);
  vm.runInContext(js,context);
  const A=context.window.CR.analytics;
  A.init({
    request:()=>Promise.reject(new Error('API unavailable')),
    supa:()=>Promise.reject(new Error('Supabase unavailable'))
  });
  const host={
    innerHTML:'',
    querySelector:()=>null,
    querySelectorAll:()=>[]
  };
  assert.doesNotThrow(()=>A.mount(host));
  assert.match(host.innerHTML,/>Analytics</);
  await new Promise((resolve)=>setTimeout(resolve,0));
  assert.match(host.innerHTML,/Analytics load failed/);
  assert.match(host.innerHTML,/did not load/);
  for(const section of ['overview','audience','content','identity','forensics','setup']){
    A.state.section=section;
    assert.doesNotThrow(()=>A.render(),section+' should render in a failed-data state');
    assert.ok(A.render().length>200,section+' rendered an empty surface');
  }
});

test('Control Analytics bounds concurrent reads instead of stampeding PostgREST',async()=>{
  const js=await read('js/control-room/analytics.js');
  const context={window:{CR:{}},console};
  vm.createContext(context);
  vm.runInContext(js,context);
  const A=context.window.CR.analytics;
  let active=0,peak=0,completed=0;
  const delayed=(value)=>new Promise((resolve)=>{
    active++;peak=Math.max(peak,active);
    setTimeout(()=>{active--;completed++;resolve(value);},8);
  });
  A.init({
    request:()=>delayed({}),
    supa:(path)=>String(path).startsWith('analytics_sites?')?Promise.resolve([]):delayed([])
  });
  let paints=0,html='';
  const host={
    get innerHTML(){return html;},
    set innerHTML(value){html=value;paints++;},
    querySelector:()=>null,
    querySelectorAll:()=>[]
  };
  A.mount(host);
  await new Promise((resolve)=>setTimeout(resolve,120));
  assert.ok(completed>=12,'expected the full analytics suite to complete');
  assert.ok(peak<=3,'analytics opened '+peak+' concurrent reads');
  assert.ok(paints>4,'completed reads should repaint progressively');
  assert.equal(A.state.loading,false);
});


test('custom range edits survive progressive Analytics repaints',async()=>{
  const js=await read('js/control-room/analytics.js');
  const context={window:{CR:{}},console};
  vm.createContext(context);
  vm.runInContext(js,context);
  const A=context.window.CR.analytics;
  const from={value:'',oninput:null},through={value:'',oninput:null};
  const host={
    innerHTML:'',
    querySelector:(sel)=>sel==='#craFrom'?from:sel==='#craThrough'?through:null,
    querySelectorAll:()=>[]
  };
  A.init({request:()=>Promise.resolve({}),supa:()=>Promise.resolve([])});
  A.mount(host);
  A.state.rangeId='custom';
  from.value='2026-09-01';through.value='2026-09-27';
  assert.equal(typeof from.oninput,'function');
  assert.equal(typeof through.oninput,'function');
  from.oninput();through.oninput();
  assert.equal(A.state.from,'2026-09-01');
  assert.equal(A.state.through,'2026-09-27');
  assert.match(A.render(),/value="2026-09-01"/);
  assert.match(A.render(),/value="2026-09-27"/);
});

test('all six Analytics sections render representative successful data',async()=>{
  const js=await read('js/control-room/analytics.js');
  const context={window:{CR:{}},console};
  vm.createContext(context);
  vm.runInContext(js,context);
  const A=context.window.CR.analytics;
  A.init({request:()=>Promise.resolve({}),supa:()=>Promise.resolve([])});
  A.state.range={label:'7 days',since:'2026-09-20T00:00:00Z',until:'2026-09-27T00:00:00Z'};
  A.state.loaded=true;
  A.state.data={
    traffic:{byDay:[{day:'2026-09-27',page_views:10,visitors:4,sessions:5}],totals:{page_views:10,visitors:4,sessions:5,plays:3,events:20},pages:[{path:'index.html',count:10}],sources:[{source:'direct',count:5}],countries:[{country:'US',count:4}],networks:[{network:'wifi',count:4}]},
    funnel:[{arrived:10,heard_something:8,engaged:6,searched:3,asked_for_something:2,made_an_account:1,confirmed_the_email:1,reached_checkout:1,paid:0}],
    acquisition:[{source:'direct',people:4}],paths:[{from_page:'index.html',to_page:'listen.html',moves:3}],
    content:[{track:'pull up',album:'cia-mind-control',starts:3,listeners:2,repeat_listeners:1,plays_per_listener:1.5,full_plays:1,completions:1,shares:1}],
    contentEvents:[{event_name:'album_play',events:3}],
    identity:{coverage:{accounts:1,bridged_accounts:1,attributed_accounts:1,accounts_with_ip:1,accounts_with_location:1},tracks:[{track:'pull up',last_touch_accounts:1,assisted_accounts:1}],journeys:[{created_at:'2026-09-27T00:00:00Z',first_name:'Test',source:'direct',last_track:'pull up',minutes_after_last_track:5}]},
    forensics:{events:[{at:'2026-09-27T00:00:00Z',name:'page_view',path:'index.html',country:'US',device:{platform:'test'}}]},
    business:{snapshot:{users:{total:1,created_in_window:1},window:true,music:{plays:{in_window:3,total:3},revenue:{gross_cents_in_window:100,gross_cents:100}}}}
  };
  const expected={
    overview:/Traffic trend/,
    audience:/Conversion funnel/,
    content:/Reach vs repeat/,
    identity:/Source → track → account/,
    forensics:/Owner-only telemetry/,
    setup:/Install \/ verify/
  };
  for(const [section,marker] of Object.entries(expected)){
    A.state.section=section;
    assert.doesNotThrow(()=>A.render(),section+' threw');
    assert.match(A.render(),marker,section+' did not render its expected panel');
  }
});

test('Control Analytics uses the canonical analytics data plane',async()=>{
  const js=await read('js/control-room/analytics.js');
  for(const rpc of [
    'analytics_daily','analytics_totals','analytics_top','analytics_funnel',
    'analytics_acquisition','analytics_paths','analytics_content','analytics_content_events'
  ]){
    assert.ok(js.includes('rpc("'+rpc+'"'),rpc+' is not wired into Control Analytics');
  }
  assert.match(js,/\/v1\/analytics\/business\?since=/);
  assert.match(js,/\/v1\/analytics\/identity\?since=/);
  assert.match(js,/\/v1\/analytics\/forensics\?since=/);
  assert.doesNotMatch(js,/<iframe|analytics\.html\?control_embed/);
});

test('one range controls all analytics panels and stale requests cannot repaint',async()=>{
  const js=await read('js/control-room/analytics.js');
  for(const id of ['24h','7d','30d','90d','all','custom']) assert.ok(js.includes('"'+id+'"'),id+' range is absent');
  assert.match(js,/S\.rangeId=b\.getAttribute\("data-cra-range"\)/);
  assert.match(js,/var q=\+\+S\.seq/);
  assert.match(js,/if\(q!==S\.seq\)return/);
  assert.match(js,/p_since:r\.since,p_until:r\.until/);
  assert.doesNotMatch(js,/daily=\{p_since:r\.querySince/);
  assert.match(js,/S\.loading=true;S\.loaded=false;S\.error=null;S\.errors=\{\};S\.data=blankData\(\);paint\(\)/,
    'range selection must repaint immediately before the network read completes');
});

test('Analytics uses distinct visual forms for distinct questions',async()=>{
  const js=await read('js/control-room/analytics.js');
  for(const fn of ['line','donut','rank','funnel','scatter','flow']){
    assert.match(js,new RegExp('function '+fn+'\\('),fn+' visual is missing');
  }
  assert.match(js,/Traffic trend/);
  assert.match(js,/Geography/);
  assert.match(js,/Conversion funnel/);
  assert.match(js,/Reach vs repeat/);
  assert.match(js,/Source → track → account/);
});

test('Control Analytics is mobile-first',async()=>{
  const css=await read('css/control-analytics.css');
  assert.match(css,/@media \(min-width:36rem\)/);
  assert.match(css,/@media \(min-width:54rem\)/);
  assert.doesNotMatch(css,/@media\s*\(max-width:/);
  assert.match(css,/font-size:max\(16px,1rem\)/);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/overflow-x:auto/);
});

test('owner identity and forensics endpoints are owner-only and exact-window aware',async()=>{
  const router=await read('workers/mccluster/src/analytics/router.js');
  assert.match(router,/path === '\/v1\/analytics\/identity'/);
  assert.match(router,/path === '\/v1\/analytics\/forensics'/);
  assert.match(router,/async function handleIdentityAnalytics/);
  assert.match(router,/async function handleForensics/);
  const idStart=router.indexOf('async function handleIdentityAnalytics');
  const fStart=router.indexOf('async function handleForensics');
  const cleanStart=router.indexOf('function cleanTxt',fStart);
  assert.match(router.slice(idStart,fStart),/await requireHouseOwner\(env, user\)/);
  assert.match(router.slice(fStart,cleanStart),/await requireHouseOwner\(env, user\)/);
  assert.match(router,/membership\?\.role !== 'owner'/);
  assert.match(router,/url\.searchParams\.get\('since'\)/);
  assert.match(router,/url\.searchParams\.get\('until'\)/);
  assert.match(router,/minutes_after_last_track/);
  assert.match(router,/assisted_tracks/);
});

test('business snapshot supports explicit selected-window bounds',async()=>{
  const router=await read('workers/mccluster/src/analytics/router.js');
  assert.match(router,/rawSince = url\.searchParams\.get\('since'\)/);
  assert.match(router,/rawUntil = url\.searchParams\.get\('until'\)/);
  assert.match(router,/at >= sinceMs && at < untilMs/);
  assert.match(router,/if \(untilIso\) q\.append\(timeColumn/);
});


test('identity bridge reconstruction keeps recent rows and bounds the attribution interval',async()=>{
  const router=await read('workers/mccluster/src/analytics/router.js');
  assert.match(router,/const bridgeSince = new Date\(since\.getTime\(\) - 7 \* 86400000\)/);
  assert.match(router,/const bridgeUntil = new Date\(until\.getTime\(\) \+ 7 \* 86400000\)/);
  assert.match(router,/device_id=not\.is\.null.*at=gte\./s);
  assert.match(router,/order=at\.desc/);
});

test('Audience analytics stays inside the exact selected property and timestamp window',async()=>{
  const js=await read('js/control-room/analytics.js');
  assert.match(js,/daily=\{p_since:r\.since,p_until:r\.until,p_site:site,p_tz:tz\(\)\}/);
  assert.doesNotMatch(js,/v_engagement_daily/);
  assert.match(js,/Audience trend/);
  assert.match(js,/S\.data\.traffic&&S\.data\.traffic\.byDay/);
  assert.match(js,/site===null\?rpc\("analytics_funnel"/);
  assert.match(js,/\{name:"business",run:function\(\)\{return site===null\?S\.request/);
  assert.match(js,/Control will not mix another property into this view/);
  assert.doesNotMatch(js,/analytics_engagement_site|analytics_funnel_site/);
});
