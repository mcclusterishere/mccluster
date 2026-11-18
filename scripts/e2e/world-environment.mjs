/* Run: node scripts/e2e/world-environment.mjs [outDir]
 * Actual mnet DOM, styles and World mode module. Unrelated application scripts and
 * Cesium rendering are isolated; canonical API responses are explicit fixtures.
 * No live service, deployment, capture or production-streaming claim is made.
 *
 * Two harnesses, at 390x844, 820x1180 and 1280x800 (WORLD-FEED-AND-MISSIONS-20261117.md, "Mobile first"):
 *  A. the panel's modules alone on the shipped DOM (mnet-modules.html serves mnet.html with every other script removed): the
 *     journey the module always had, from the sourced observations to a joined mission and its evidence, plus the auth race.
 *  B. the page as it ships (js/mnet.js and the panel together, every read a fixture, the globe frame a stub that records what
 *     it is told and can answer as the globe would): slice G1's observation posts in Everything and in the Equity Uprise tab,
 *     typed and stamped with the recorded time; Show on globe; the panel's health rows, tour and 2D controls; the fixed order
 *     of the messages; the honest line and zero posts while the module answers 503 or 404; daylight contrast by computed style;
 *     scrollWidth === clientWidth; no page errors.
 * Needs Playwright (PLAYWRIGHT_DIR if not resolvable) and nothing else: one page at a time.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=createRequire(path.join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright'));}
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url))); // no trailing slash: the containment check below appends path.sep
const outDir=process.argv[2]||process.env.WORLD_ENVIRONMENT_ARTIFACT_DIR||'';
const id='11111111-1111-4111-8111-111111111111',assignment='22222222-2222-4222-8222-222222222222';
const event={id:'usgs:test',title:'Fixture government observation',category:'Earthquake',lat:41,lon:-73,observed_at:'2026-11-06T12:00:00Z',fetched_at:'2026-11-07T12:00:00Z',stale:true,source:{label:'USGS',url:'https://earthquake.usgs.gov/earthquakes/eventpage/test'},actions:[{id:'verify',title:'Verify public guidance',description:'Check official notices remotely.',proof:'Link to official notice',safety:'Do not enter a hazardous area.'}]};
const fixture={schema:'world-environment/v1',events:[event],sources:[{label:'USGS',status:'available',coverage:'Global',observed_at:event.observed_at,fetched_at:event.fetched_at},{label:'NASA EONET',status:'unavailable',coverage:'Selected events'}],missions:[]};
/* slice G1 (lane L2): the feed fixture, the two policy bodies and the pure posts module the page uses, to say what to expect */
const FEED=JSON.parse(await readFile(path.join(root,'scripts/e2e/fixtures/environment/feed.json'),'utf8'));
const POLICY={503:JSON.parse(await readFile(path.join(root,'scripts/e2e/fixtures/environment/feed-policy-503.json'),'utf8')),404:JSON.parse(await readFile(path.join(root,'scripts/e2e/fixtures/environment/feed-policy-404.json'),'utf8'))};
const P=require(path.join(root,'js/world-environment-posts.js'));
const SIGNIFICANT=new Set(FEED.events.filter(P.significance).map(e=>e.id));
const WIDTHS=[{width:390,height:844,mobile:true},{width:820,height:1180,mobile:true},{width:1280,height:800,mobile:false}];
const server=http.createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  /* mnet-modules.html: the shipped DOM and CSS with only the modules under test and their real imports (harness A) */
  const modulesOnly=pathname==='/mnet-modules.html',file=path.resolve(root,'.'+(modulesOnly?'/mnet.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  let body=await readFile(file);const ext=path.extname(file);
  if(modulesOnly)body=body.toString().replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi,(whole,attrs)=>/src="js\/(?:travel\/world-travel\.mjs|world-environment(?:-mccluster)?\.mjs)/.test(attrs)?whole:'');
  res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.jpg':'image/jpeg'})[ext]||'application/octet-stream');res.end(body);
 }catch{res.writeHead(404);res.end();}
});
// One startup attempt; report a denied socket rather than bypassing restrictions.
try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});}catch(error){console.error('BLOCKED: local HTTP listener at 127.0.0.1: '+error.message);process.exitCode=2;throw error;}
const origin='http://127.0.0.1:'+server.address().port;
const shot=async(page,name)=>{if(!outDir)return;await mkdir(outDir,{recursive:true});await page.screenshot({path:path.join(outDir,name+'.png'),fullPage:true});};
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});

 /* ---------- A. the modules alone, as before ---------- */
 for(const {width,height} of WIDTHS){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();
  let joined=false,assigned=false,failJoin=true,approved=false,unavailable=false,holdOwner=false,releaseOwner,proof=null,proofShare=false,malformedTeam=true;
  const posts=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));if(process.env.WORLD_ENVIRONMENT_DEBUG)page.on('console',m=>console.error('console:',m.type(),m.text().slice(0,160)));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin===origin && url.pathname==='/action-globe.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Globe rendering isolated in fixture harness</body></html>'});
   if(url.origin===origin)return route.continue();
   if(url.origin!=='https://api.mccluster.org'||!url.pathname.startsWith('/v1/world/environment'))return route.fulfill({contentType:'application/json',body:'{}'});
   const endpoint=url.pathname.slice('/v1/world/environment'.length),method=request.method(),who=request.headers().authorization;
   const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':origin,'access-control-allow-headers':'authorization, content-type'},body:JSON.stringify(body)});
   // Private success envelopes are derived from the pinned transport contract (vendor transport requires ok:true; audit EQ4).
   const ok=(body,status=200)=>reply(status<400?{ok:true,...body}:body,status);
   if(method==='OPTIONS')return reply({});
   if(method==='POST')posts.push({endpoint,body:request.postDataJSON(),who});
   if(endpoint==='')return unavailable?reply({error:'Unavailable'},503):reply({...fixture,missions:approved?[{id,event_id:event.id,action_id:'verify',status:'open'}]:[]});
   if(!who)return reply({error:'Sign in'},401);
   if(endpoint==='/proofs')return who==='Bearer owner'?ok({proofs:proof?[{proof_id:proof.id,assignment_id:assignment,title:'Saved environmental mission',statement:proof.statement,status:proof.status,proof_revision:proof.revision}]:[]}):reply({error:'Owner required'},403);
   if(endpoint==='/assignments/'+assignment+'/proof'){
    if(method==='POST'){const input=request.postDataJSON();proof={id:'33333333-3333-4333-8333-333333333333',proof_id:'33333333-3333-4333-8333-333333333333',statement:input.statement,status:'pending',revision:'0123456789abcdef0123456789abcdef'};proofShare=input.share;return ok({proof_id:proof.id,assignment_id:assignment,status:'submitted',share:proofShare});}
    return ok({assignment_id:assignment,status:proof?'submitted':'joined',mission_status:'open',can_submit:true,can_share:false,share:proofShare,proof});
   }
   if(endpoint==='/team'){
    if(malformedTeam){malformedTeam=false;return reply({membership:{joined},assignments:[]});} // deliberately missing ok:true: explicit negative case
    if(method==='POST')joined=request.postDataJSON().join;
    return ok({membership:{joined},assignments:assigned?[{mission_id:id,assignment_id:assignment,status:'joined',mission_status:'open',title:'Saved environmental mission',event_id:event.id,source:event.source,observed_at:event.observed_at,capture_path:'/live-mission.html?assignment='+assignment}]:[]});
   }
   if(endpoint==='/oversight'){
    if(holdOwner && who==='Bearer owner'){holdOwner=false;await new Promise(resolve=>releaseOwner=resolve);return ok({missions:[{id,title:'Private owner proposal',status:'proposed',assignments:[{display_name:'Private member name',user_id:'secret',status:'joined'}]}]});}
    return who==='Bearer owner'?ok({missions:[{id,title:'Owner-reviewed proposal',status:approved?'open':'proposed',assignments:[{display_name:'Private member name',status:'joined'}]}]}):reply({error:'Owner required'},403);
   }
   if(endpoint.endsWith('/join')){if(failJoin)return ok({});assigned=true;return ok({assignment_id:assignment});}
   if(endpoint.endsWith('/review')){approved=request.postDataJSON().decision==='open';return ok({});}
   if(endpoint==='/missions/propose')return ok({id,status:'proposed'});
   return reply({error:'Unexpected endpoint'},404);
  });
  await page.addInitScript(()=>{window.__testToken=null;window.MCC_SUPA={token:async()=>window.__testToken};
   /* js/mnet.js is isolated here, so the feed strip's tab is wired by a stand-in that says what mnet.js says: MCC_FEED_SCOPE and
      mcc:feed-scope (owner, 2026-11-17: Environmental Justice is behind the feed's Equity Uprise tab) */
   let scope='global';window.MCC_FEED_SCOPE={get:()=>scope,set:next=>{if(next===scope)return;scope=next;document.querySelectorAll('[data-feed-scope]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.feedScope===scope)));window.dispatchEvent(new CustomEvent('mcc:feed-scope',{detail:{scope}}));}};
   document.addEventListener('click',event=>{const b=event.target.closest&&event.target.closest('[data-feed-scope]');if(b)window.MCC_FEED_SCOPE.set(b.dataset.feedScope);});});
  const auth=async value=>{await page.evaluate(value=>{window.__testToken=value;window.dispatchEvent(new Event('mcc:auth-changed'));},value);};
  const waitText=async(selector,text)=>{await page.waitForFunction(({selector,text})=>document.querySelector(selector)?.textContent.includes(text),{selector,text});};
  await page.goto(origin+'/mnet-modules.html');await page.waitForFunction(()=>!!window.MCC_WORLD_MODE);
  assert.equal(await page.locator('#mnWorldFrame').count(),1);
  /* no centre mode bar for anyone but the house owner, and no Missions or E=UP mode in it at all */
  assert.equal(await page.locator('.wt-world-modes').isVisible(),false);
  assert.equal(await page.locator('.wt-world-modes [data-world-mode="missions"], .wt-world-modes [data-world-mode="environment"]').count(),0);
  const originalFrame=await page.locator('#mnWorldFrame').getAttribute('src');
  await page.locator('#mnFeedScope [data-feed-scope="equity"]').click();
  await waitText('#weEvents','Fixture government observation');assert.equal(posts.length,0);
  assert.match(await page.locator('#weStatus').textContent(),/Some sources are unavailable/);
  await page.locator('#weEvents button').click();
  assert.match(await page.locator('#weDetail').textContent(),/Observed[\s\S]*2026[\s\S]*Retrieved[\s\S]*2026/);
  assert.equal(await page.locator('#weDetail a').getAttribute('href'),event.source.url);
  assert.equal(await page.locator('#weOwner').isVisible(),false);
  assert.equal(await page.locator('a[href*="live-mission.html"]:visible').count(),0);
  const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,panel:document.getElementById('wePanel').scrollWidth,panelClient:document.getElementById('wePanel').clientWidth}));
  assert.equal(dimensions.scroll,dimensions.client,JSON.stringify(dimensions));assert.ok(dimensions.panel<=dimensions.panelClient,JSON.stringify(dimensions));
  for(let i=0;i<3;i++){await page.locator('#mnFeedScope [data-feed-scope="global"]').click();assert.equal(await page.locator('#wePanel').isVisible(),false);await page.locator('#mnFeedScope [data-feed-scope="equity"]').click();}
  assert.equal(await page.locator('#mnWorldFrame').getAttribute('src'),originalFrame);assert.equal(await page.locator('#mnWorldFrame').count(),1);
  await auth('member');await waitText('#weTeam','Team membership is not available yet');assert.equal(posts.length,0);
  await page.getByRole('button',{name:'Check membership'}).click();await waitText('#weTeam','Join the team');
  await page.getByRole('button',{name:'Join the team',exact:true}).click();assert.equal(posts.length,0);
  await page.locator('#weJoinConsent').check();await page.getByRole('button',{name:'Join the team',exact:true}).click();await waitText('#weTeam','You are on');assert.equal(posts[0].endpoint,'/team');
  await page.getByRole('button',{name:'Suggest this mission for review'}).click();await waitText('#weStatus','saved for owner review');assert.equal(posts[1].endpoint,'/missions/propose');
  assert.equal(await page.getByRole('button',{name:'Join approved mission'}).count(),0);
  await auth('owner');await waitText('#weOwner','Owner-reviewed proposal');
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Approve mission',exact:true}).click();assert.equal(posts.length,2);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Approve mission',exact:true}).click();await waitText('#weOwner','Status: open');
  await auth('member');await waitText('#weTeam','You are on');assert.equal(await page.locator('#weOwner').isVisible(),false);assert.equal(await page.getByText('Private member name').count(),0);
  await page.getByRole('button',{name:'Join approved mission'}).click();await waitText('#weStatus','No assignment was confirmed');
  assert.equal(await page.getByRole('link',{name:'Check recording availability'}).count(),0);
  failJoin=false;await page.getByRole('button',{name:'Join approved mission'}).click();await waitText('#weDetail','Your mission: joined');
  assert.equal(await page.getByRole('link',{name:'Check recording availability'}).getAttribute('href'),'/live-mission.html?assignment='+assignment);
  assert.equal(posts.filter(p=>p.endpoint.endsWith('/join')).length,2);
  await page.getByRole('button',{name:'Open mission evidence'}).click();
  await waitText('#weProof','No evidence has been submitted');
  await page.getByLabel('What did you complete? Include dates, sources and what remains uncertain.').fill('Checked the dated official accessibility guidance remotely.');
  const sharing=page.getByLabel('After owner verification, I want this proof and statement posted to the public Action Network feed.');assert.equal(await sharing.isChecked(),false);
  await page.getByLabel('I checked this evidence, have permission to submit it, and removed other people’s private information.').check();
  await page.getByRole('button',{name:'Submit evidence for review'}).click();
  await waitText('#weStatus','public sharing off');assert.equal(await page.locator('#weProof').isVisible(),false);assert.equal(proofShare,false);
  await page.getByRole('button',{name:'Open mission evidence'}).click();await waitText('#weProof','Evidence review: pending');await page.getByRole('button',{name:'Close evidence'}).click();
  // An owner response completing after sign-out must never restore private rows.
  holdOwner=true;await auth('owner');
  for(let i=0;i<100&&!releaseOwner;i++)await page.waitForTimeout(20);assert.ok(releaseOwner,'owner request started');
  await page.locator('#mnFeedScope [data-feed-scope="global"]').click();await auth(null);releaseOwner();await page.waitForTimeout(100);
  await page.locator('#mnFeedScope [data-feed-scope="equity"]').click();
  assert.equal(await page.locator('#weOwner').isVisible(),false);assert.equal(await page.getByText('Private member name').count(),0);assert.equal(await page.getByRole('link',{name:'Check recording availability'}).count(),0);
  await auth('member');await waitText('#weTeam','You are on');
  unavailable=true;await page.getByRole('button',{name:'Refresh sources'}).click();await waitText('#weStatus','No current observations');assert.equal(await page.locator('#weEvents button').count(),0);await waitText('#weAssignments','Saved environmental mission');assert.match(await page.locator('#weAssignments').textContent(),/not in the current feed/);
  assert.deepEqual(errors,[],'No runtime errors in the tested modules');
  await shot(page,'world-environment-modules-'+width);
  console.log(`PASS A ${width}px: actual World DOM, no overflow, one iframe, no mode bar for a visitor, repeated tab switching, source dates/unavailability, malformed-envelope refusal, explicit team/proposal/review/join, confirmed assignment link, auth race privacy. Fixtures only.`);
  await context.close();
 }

 /* ---------- B. the page as it ships: the observation posts and the globe's spine (slice G1) ---------- */
 const UUID=n=>`0e1f0000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const mission=(n,title,created_at)=>({id:UUID(n),campaign_id:null,title,description:'Fixture mission: what to do and how to show it.',domain:'community',difficulty:1,base_points:10,proof_required:true,verification_mode:'review',skills:['service'],capacity:null,status:'open',starts_at:null,ends_at:null,kind:'civic',created_at});
 /* three open missions whose times fall between the fixture's quakes, so the Equity Uprise tab's order by time is checkable */
 const MISSIONS=[mission(101,'Fixture mission, the newest','2026-11-17T20:30:00Z'),mission(102,'Fixture mission, midday','2026-11-17T12:00:00Z'),mission(103,'Fixture mission, yesterday','2026-11-16T09:00:00Z')];
 const PEER={m_uid:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',mccluster_id:'fixture.ana',display_name:'Fixture Ana'};
 const POSTS=[1,2,3,4,5,6,7,8].map(k=>{const at=new Date(Date.now()-k*3600e3).toISOString(),pid=`dddddddd-dddd-4ddd-8ddd-00000000000${k}`;return {item_type:'post',post_id:pid,occurred_at:at,actor:PEER,post:{id:pid,body:`Field note ${k}: what we did, what is next, and who can help.`,visibility:'public',created_at:at,like_count:0,liked_by_me:false,media_locked:0}};});
 const NEWS=[1,2,3,4,5,6].map(k=>({id:`ffffffff-ffff-4fff-8fff-00000000000${k}`,title:`World story ${k}: councils weigh a budget for public transit`,url:`https://news${k%2}.example/story/${k}`,domain:`news${k%2}.example`,seen_at:new Date(Date.now()-k*900e3).toISOString(),place:'Hartford, Connecticut, United States',lat:41.76,lon:-72.68,country:'US'}));
 /* the globe frame, stubbed: it records every message the page and the panel send it (window.__got) and can answer as the globe
    would (window.__send); it says hu:globe-ready once, as the real frame does after boot */
 const STUB='<!doctype html><html><head><meta charset="utf-8"><title>stub</title></head><body>Globe rendering isolated in fixture harness<script>window.__got=[];addEventListener("message",function(e){if(e.source===parent)window.__got.push(e.data);});window.__send=function(m){parent.postMessage(m,location.origin);};setTimeout(function(){window.__send({type:"hu:globe-ready",missionIds:[],dataPending:true});},50);</script></body></html>';
 const LAYER_STATE={type:'hu:environment-layer-state',layer:'fires',status:'available',reason:null,http:200,schema:'world-environment-fires/v1',generated_at:'2026-11-17T20:00:00Z',fetched_at:'2026-11-17T20:00:30Z',last_success_at:'2026-11-17T20:00:30Z',coverage:'Global VIIRS active-fire detections from NOAA-20 in the 24 hours before retrieval',attribution:'NASA FIRMS, VIIRS 375 m active fire product (NOAA-20, near real-time)',license:'NASA data, CC0 1.0 (U.S. public domain)',url:'https://firms.modaps.eosdis.nasa.gov/',count:600,total:600,truncated:false,
  sources:[{id:'firms_viirs_noaa20',label:'NASA FIRMS VIIRS NOAA-20',status:'available',reason:null,fetched_at:'2026-11-17T20:00:30Z',last_success_at:'2026-11-17T20:00:30Z',coverage:'Global VIIRS active-fire detections from NOAA-20 in the 24 hours before retrieval',attribution:'NASA FIRMS, VIIRS 375 m active fire product (NOAA-20, near real-time)',license:'NASA data, CC0 1.0 (U.S. public domain)',url:'https://firms.modaps.eosdis.nasa.gov/'}],
  digest:{cells:[[-119,34,220,1830.4,212.5,'2026-11-17T19:30:00Z'],[-63,-10,180,420.2,96.1,'2026-11-17T18:00:00Z']],cell_degrees:1,count:600,total:600,windows:[]}};
 const SELECTED={type:'hu:environment-selected',id:'fire:NOAA-20:2026-11-17T19:30:00Z:-118.4:34.1',layer:'fires',kind:'fire_detection',title:'VIIRS detection',facts:[{label:'Satellite',value:'NOAA-20'},{label:'Radiative power',value:'12.5 MW'}],source:{id:'firms_viirs_noaa20',label:'NASA FIRMS VIIRS NOAA-20',url:'https://firms.modaps.eosdis.nasa.gov/',attribution:'NASA FIRMS, VIIRS 375 m active fire product (NOAA-20, near real-time)',license:'NASA data, CC0 1.0 (U.S. public domain)'},observed_at:'2026-11-17T19:30:00Z',observed_label:'Acquired',observed_date_only:false,fetched_at:'2026-11-17T20:00:30Z',coverage:'Global VIIRS active-fire detections from NOAA-20 in the 24 hours before retrieval',status:'available',reason:null,lat:34.1,lon:-118.4,via:'pick',illustrative:null,modelled:false};
 async function openPage({width,height,mobile},{daylight='night',environment='available'}={}){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'}),page=await context.newPage();
  const errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',m=>{if(/TypeError|ReferenceError|SyntaxError/.test(m.text()))errors.push(m.text().slice(0,300));if(process.env.WORLD_ENVIRONMENT_DEBUG)console.error('console:',m.type(),m.text().slice(0,200));});
  await context.addInitScript(()=>{localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));localStorage.setItem('mnet_tour_seen','1');});
  const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'},body:JSON.stringify(body)});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url()),p=url.pathname;
   if(url.origin===origin&&p==='/action-globe.html')return route.fulfill({contentType:'text/html',body:STUB});
   if(url.origin===origin)return route.continue();
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
   if(url.hostname==='api.mccluster.org'){
    requests.push(p);
    if(p==='/v1/world/environment')return environment==='available'?json(route,FEED):json(route,POLICY[environment],Number(environment));
    if(p.startsWith('/v1/world/environment/'))return json(route,{ok:false,code:'not_found'},404); /* the page itself never asks for a layer route */
    if(p==='/v1/mnet/public-feed')return json(route,{items:POSTS,scope:'public',next_before:null});
    if(p==='/v1/world/news')return json(route,{ok:true,items:NEWS,next_before:null,attribution:{name:'The GDELT Project',url:'https://www.gdeltproject.org/'}});
    if(p==='/v1/world/place-scope')return json(route,{ok:true,enabled:false,country:null});
    if(p==='/v1/world/news-heat')return json(route,{ok:true,window_hours:24,countries:{US:6},total:6,capped:false,posts:{}});
    if(p==='/v1/world/members')return json(route,{ok:true,basis:'accounts_by_latest_signed_in_ip_place',window_days:400,exact:false,k:5,countries:{}});
    if(p==='/v1/world/access')return json(route,{release:{version:'globe-admin-preview/v1',admin_preview:false},level:'public',unlocked_layers:[],locked_layers:[],layers:{}});
    if(p==='/v1/status')return json(route,{error:'Forbidden'},403);
    return json(route,{});
   }
   if(url.hostname.endsWith('.supabase.co')){
    if(p==='/auth/v1/user')return json(route,{msg:'no session'},401);
    if(p==='/auth/v1/settings')return json(route,{external:{email:true}});
    if(p==='/rest/v1/action_missions')return json(route,MISSIONS);
    if(p==='/rest/v1/action_mission_details')return json(route,[]);
    return json(route,[]);
   }
   return route.fulfill({status:204,body:''});
  });
  await context.addInitScript(()=>{window.__envDetails=[];window.addEventListener('mcc:world-environment-events',e=>{window.__envDetails.push(e.detail);});});
  await page.goto(origin+'/mnet.html?view=feed&daylight='+daylight,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.MCC_WORLD_MODE&&!!window.MCC_FEED_SCOPE&&document.documentElement.classList.contains('mn-world-on'),null,{timeout:60000});
  return {context,page,errors,requests};
 }
 const globe=page=>page.frame({url:/action-globe\.html/});
 const got=async page=>{const f=globe(page);return f?await f.evaluate(()=>window.__got):[];};
 const fromGlobe=async(page,msg)=>{await globe(page).evaluate(m=>window.__send(m),msg);};
 /* postMessage is asynchronous: wait for the frame to have logged a matching message after index `after` */
 const waitGot=async(page,after,pred,what)=>{for(let i=0;i<100;i++){const list=(await got(page)).slice(after),hit=list.find(pred);if(hit)return hit;await page.waitForTimeout(50);}assert.fail('the frame never got '+what+': '+JSON.stringify((await got(page)).slice(after).map(m=>m.type)));};
 const feedSeq=page=>page.evaluate(()=>[...document.querySelectorAll('#mnFeed > article')].map(a=>a.hasAttribute('data-observation-post')?'o:'+a.getAttribute('data-observation-post'):a.hasAttribute('data-mission-post')?'m:'+a.getAttribute('data-mission-post'):a.hasAttribute('data-news-id')?'n':a.hasAttribute('data-post-id')?'p':'?'));
 /* the page, the panel and the feed must not scroll sideways; when the feed does, name what sticks out past its right edge */
 const fits=page=>page.evaluate(()=>{const feed=document.getElementById('mnFeed'),edge=feed.getBoundingClientRect().right+0.5;const over=[...feed.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().right>edge&&el.getClientRects().length).slice(0,8).map(el=>el.tagName.toLowerCase()+'.'+[...el.classList].join('.')+'@'+Math.round(el.getBoundingClientRect().right-edge));return {sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,psw:document.getElementById('wePanel').scrollWidth,pcw:document.getElementById('wePanel').clientWidth,fsw:feed.scrollWidth,fcw:feed.clientWidth,over};});
 for(const device of WIDTHS){
  const {context,page,errors,requests}=await openPage(device);
  /* Everything: the significant observations ride along, one after every six other items, each typed by the system author */
  await page.waitForFunction(()=>document.querySelectorAll('#mnFeed .mn__observation-post').length>0,null,{timeout:30000});
  const everything=await feedSeq(page);
  const obs=everything.map((x,i)=>x.startsWith('o:')?i:-1).filter(i=>i>=0);
  assert.ok(obs.length>=2,'significant observations in Everything: '+JSON.stringify(everything));
  let since=0;for(let i=0;i<everything.length;i++){if(everything[i].startsWith('o:')){assert.ok(since>=6,'at least six other items before each observation: '+JSON.stringify(everything));since=0;}else since++;}
  for(const x of everything.filter(x=>x.startsWith('o:')))assert.ok(SIGNIFICANT.has(x.slice(2)),'only a significant event rides in Everything: '+x);
  const keyed=everything.filter(x=>/^[om]:/.test(x));assert.equal(new Set(keyed).size,keyed.length,'each observation and mission once');
  const typed=await page.evaluate(()=>[...document.querySelectorAll('#mnFeed .mn__observation-post')].map(a=>({id:a.getAttribute('data-observation-post'),author:a.querySelector('.mn__author-name').textContent,sub:a.querySelector('.mn__author-sub').textContent,title:a.querySelector('.mn__observation-post-title').textContent,body:a.querySelector('.mn__observation-post-body').textContent,globe:!!a.querySelector('[data-observation-globe]'),source:(a.querySelector('.mn__observation-source')||{}).href||'',icon:!!a.querySelector('.mn__observation-post-icon svg'),img:a.querySelectorAll('img').length})));
  for(const t of typed){assert.equal(t.author,'Environmental desk');assert.match(t.sub,/^Environmental observation · /);assert.match(t.sub,/ · (Recorded|Retrieved) /);assert.match(t.body,/Coverage: .+ · Status: (available|stale|unavailable)/);assert.ok(t.icon&&t.img===0,'a plain line icon, never a picture or the mark');assert.match(t.source,/^https:\/\//);}
  /* the Equity Uprise tab: every observation and the missions in one list by time, newest first, each typed */
  await page.locator('#mnFeedScope [data-feed-scope="equity"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#mnFeed [data-mission-post]').length>0&&document.querySelectorAll('#mnFeed .mn__observation-post').length>0,null,{timeout:30000});
  await page.waitForFunction(()=>getComputedStyle(document.getElementById('wePanel')).display!=='none',null,{timeout:30000});
  const tab=await feedSeq(page);
  const stamps=await page.evaluate(()=>[...document.querySelectorAll('#mnFeed > article')].map(a=>a.hasAttribute('data-observation-post')?{id:a.getAttribute('data-observation-post'),sub:a.querySelector('.mn__author-sub').textContent}:{mission:a.getAttribute('data-mission-post'),head:a.querySelector('.mn__author-name').textContent}));
  assert.ok(tab.some(x=>x.startsWith('m:'))&&tab.some(x=>x.startsWith('o:')),'missions and observations together: '+JSON.stringify(tab));
  const expected=P.interleaveByTime(MISSIONS.map(m=>({missionPost:true,id:m.id,created_at:m.created_at})),P.observationPosts({events:FEED.events,sources:FEED.sources,unavailable:false,layers:{}},Date.now()),{pageSize:20}).map(x=>x.missionPost?'m:'+x.id:'o:'+x.id);
  assert.deepEqual(tab,expected,'the page of twenty, by time, as the pure module orders it');
  assert.equal(tab[0],'o:usgs:fx-gen-50','the newest quake leads');assert.equal(tab[1],'m:'+UUID(101),'then the mission created at 20:30');
  for(const s of stamps){if(s.mission)assert.match(s.head,/^Civic mission/);else assert.match(s.sub,/^Environmental observation · /);}
  const quakeSub=stamps.find(s=>s.id==='usgs:fx-gen-50').sub;
  assert.match(quakeSub,new RegExp('Recorded '+new Date('2026-11-17T20:50:00Z').toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),'the recorded time, in local time: '+quakeSub);
  /* Load more pages the merged list; the NHC storm, whose provider gives no time, sits among the undated at the end, labelled */
  for(let i=0;i<4;i++){if(await page.locator('#mnMore').isHidden())break;await page.locator('#mnMore').click();await page.waitForTimeout(150);}
  const all=await page.evaluate(()=>[...document.querySelectorAll('#mnFeed .mn__observation-post')].map(a=>({id:a.getAttribute('data-observation-post'),sub:a.querySelector('.mn__author-sub').textContent,globe:a.querySelector('.mn__observation-globe').textContent.trim()})));
  assert.equal(all.length,FEED.events.length,'every observation is a post in the tab, the unplaced ones too');
  const storm=all.find(a=>a.id==='nhc:fx-al19');assert.match(storm.sub,/ · Retrieved .+ · source gives no event time$/);assert.equal(storm.globe,'Show on globe');
  assert.equal(all.find(a=>a.id==='nws:fx-heat-ca').globe,'No mapped point','a zone-only alert offers no globe');
  /* a source that gives no event time is ordered by its retrieval time, labelled as such: the storm (retrieved 20:05) sits after the
     quakes recorded later and before the ones recorded earlier; the oldest recorded observation comes last */
  const at=id=>all.findIndex(a=>a.id===id);assert.ok(at('usgs:fx-gen-50')<at('nhc:fx-al19')&&at('nhc:fx-al19')<at('usgs:fx-gen-48'),JSON.stringify(all.slice(0,6).map(a=>a.id)));
  assert.equal(all.at(-1).id,'eonet:EONET_fx_ice_1','the oldest recorded observation last');
  /* the panel spoke to the globe in the fixed order: layers before pins, on activation and again on hu:globe-ready */
  const spine=(await got(page)).filter(m=>/^hu:environment-(layers|pins)$/.test(m.type)).map(m=>m.type+':'+m.on);
  const firstLayersOn=spine.indexOf('hu:environment-layers:true'),firstPinsOn=spine.indexOf('hu:environment-pins:true');
  assert.ok(firstLayersOn>=0&&firstPinsOn>firstLayersOn,'layers on before pins on: '+spine.join(' '));
  const pinsOn=(await got(page)).filter(m=>m.type==='hu:environment-pins'&&m.on).at(-1);
  assert.equal(pinsOn.items.length,62);assert.equal(pinsOn.items.filter(i=>i.significant).length,16);assert.equal(JSON.stringify(pinsOn).includes('notice'),false,'the pins carry the public fields only');
  /* G1R-10: the pins carry the feed providers' terms, the six public fields of the feed's own source records, for the globe to answer with */
  assert.deepEqual(pinsOn.sources,FEED.sources.map(x=>({id:x.id,label:x.label,url:x.url,attribution:x.attribution,license:x.license,coverage:x.coverage})),'the feed\'s own terms ride with the pins');
  /* the feed route is read once by the panel; the page never reads a layer route */
  assert.equal(requests.filter(p=>p==='/v1/world/environment').length,1,JSON.stringify(requests));assert.equal(requests.some(p=>p.startsWith('/v1/world/environment/')),false);
  /* Show on globe from the tab: hu:environment-focus to the frame with the event's id */
  const before=(await got(page)).length;
  await page.locator('#mnFeed [data-observation-globe="usgs:fx-gen-50"]').click();
  const focus=await waitGot(page,before,m=>m.type==='hu:environment-focus','hu:environment-focus');
  assert.deepEqual(focus,{type:'hu:environment-focus',id:'usgs:fx-gen-50'});
  assert.equal(await page.evaluate(()=>window.MCC_FEED_SCOPE.get()),'equity');
  /* the panel's health rows: the four feed sources, then the globe's layer state with the Worker's own words; its digest becomes a
     summarised fire post (one per 1-degree area, never one per detection) */
  await page.locator('#wePanel details summary').first().click();
  const rows=await page.evaluate(()=>[...document.querySelectorAll('#weSources > li')].map(li=>li.textContent));
  assert.equal(rows.length,4);assert.match(rows.find(r=>/NASA EONET/.test(r)),/stale/);assert.match(rows.find(r=>/NASA EONET/.test(r)),/refused, failed or answered an error/);assert.match(rows.find(r=>/NOAA NHC/.test(r)),/Last success/);
  await fromGlobe(page,LAYER_STATE);
  await page.waitForFunction(()=>document.querySelectorAll('#weSources > li').length===5,null,{timeout:10000});
  const fires=await page.evaluate(()=>[...document.querySelectorAll('#weSources > li')].map(li=>li.textContent).find(r=>/Fires/.test(r)));
  assert.match(fires,/available/);assert.match(fires,/600 of 600/);assert.match(fires,/CC0 1\.0/);
  await page.waitForFunction(()=>!!document.querySelector('#mnFeed [data-observation-post="firecell:-119:34"]'),null,{timeout:10000});
  const cell=await page.evaluate(()=>{const a=document.querySelector('#mnFeed [data-observation-post="firecell:-119:34"]');return {title:a.querySelector('.mn__observation-post-title').textContent,body:a.querySelector('.mn__observation-post-body').textContent,globe:a.querySelector('[data-observation-globe]').getAttribute('data-observation-globe')};});
  assert.equal(cell.title,'Fire detections · 1° area at 34°, -119° (south-west corner)');assert.match(cell.body,/Detections: 220 · Summed radiative power: 1830\.4 MW/);
  assert.equal(await page.locator('#mnFeed [data-observation-post^="firecell:"]').count(),2,'two areas with radiative power, not 600 detections');
  /* G1R-7: the same layer state again (its digest unchanged) is not handed to the page again; and the same words dispatched again
     repaint no card: the first observation card's node survives */
  const dispatched=await page.evaluate(()=>window.__envDetails.length);
  await fromGlobe(page,LAYER_STATE);await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>window.__envDetails.length),dispatched,'an identical digest is not dispatched again');
  const kept=await page.evaluate(()=>{const first=document.querySelector('#mnFeed [data-observation-post]');first.__mark=true;window.dispatchEvent(new CustomEvent('mcc:world-environment-events',{detail:window.__envDetails.at(-1)}));const again=document.querySelector('#mnFeed [data-observation-post]');return {same:again===first,marked:again.__mark===true,cards:document.querySelectorAll('#mnFeed > article').length};});
  assert.ok(kept.same&&kept.marked,'the same words again repaint nothing: '+JSON.stringify(kept));
  /* G1R-3: a layer with two source records keeps one row, which renders every record with its own retrieval time; the layer's
     counts head the row once */
  const TIDES_STATE={...LAYER_STATE,layer:'tides',schema:'world-environment-tides/v1',fetched_at:'2026-11-17T19:56:00Z',last_success_at:'2026-11-17T19:56:00Z',coverage:'The latest observed water level at 20 documented NOAA stations',attribution:'NOAA CO-OPS',license:'Public domain (U.S. Government work); NOAA asks to be credited',url:'https://tidesandcurrents.noaa.gov/',count:14,total:20,digest:{answered:14,stations:20},
   sources:[{id:'coops_stations',label:'NOAA CO-OPS stations',status:'available',reason:null,fetched_at:'2026-11-17T08:00:00Z',last_success_at:'2026-11-17T08:00:00Z',coverage:'NOAA CO-OPS water-level stations: U.S. coasts, the Great Lakes and territories',attribution:'NOAA CO-OPS',license:'Public domain (U.S. Government work); NOAA asks to be credited',url:'https://tidesandcurrents.noaa.gov/'},{id:'coops_latest',label:'NOAA CO-OPS latest water levels',status:'available',reason:null,fetched_at:'2026-11-17T19:56:00Z',last_success_at:'2026-11-17T19:56:00Z',coverage:'The latest observed water level at 20 documented NOAA stations',attribution:'NOAA CO-OPS',license:'Public domain (U.S. Government work); NOAA asks to be credited',url:'https://tidesandcurrents.noaa.gov/'}]};
  await fromGlobe(page,TIDES_STATE);
  await page.waitForFunction(()=>document.querySelectorAll('#weSources > li').length===6,null,{timeout:10000});
  const tide=await page.evaluate(()=>{const li=[...document.querySelectorAll('#weSources > li')].find(x=>/^Water levels/.test(x.textContent));return {head:li.querySelector(':scope > p').textContent,counts:(li.textContent.match(/14 of 20 shown/g)||[]).length,records:[...li.querySelectorAll('ul.we-records > li')].map(r=>r.textContent)};});
  assert.equal(tide.records.length,2,'every source record the layer carries');assert.match(tide.head,/^Water levels/);assert.equal(tide.counts,1,'the layer\'s counts once');
  const localTime=iso=>new Date(iso).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
  assert.match(tide.records[0],/^NOAA CO-OPS stations/);assert.ok(tide.records[0].includes('Retrieved '+localTime('2026-11-17T08:00:00Z')),tide.records[0]);
  assert.match(tide.records[1],/^NOAA CO-OPS latest water levels/);assert.ok(tide.records[1].includes('Retrieved '+localTime('2026-11-17T19:56:00Z')),tide.records[1]);
  assert.doesNotMatch(tide.records.join(' '),/14 of 20/);
  const b2=(await got(page)).length;await page.locator('#mnFeed [data-observation-globe="firecell:-119:34"]').click();
  assert.deepEqual(await waitGot(page,b2,m=>m.type==='hu:environment-focus','hu:environment-focus'),{type:'hu:environment-focus',id:'cell:-119:34'},'a fire area focuses the globe\'s cell id');
  /* a pick on the globe that is no feed row: the globe-selection card, with the item's own time labelled */
  await fromGlobe(page,SELECTED);
  await page.waitForFunction(()=>/Selected on the globe/.test(document.getElementById('weDetail').textContent),null,{timeout:10000});
  const card=await page.locator('#weDetail').textContent();
  assert.match(card,/VIIRS detection/);assert.match(card,/Acquired/);assert.match(card,/Retrieved/);assert.match(card,/Coverage/);assert.match(card,/Status\s*available/);assert.doesNotMatch(card,/Observed/);
  /* the tour and the view: the controls post their messages; the words follow the globe's state */
  const b3=(await got(page)).length;
  await page.locator('#wePlay').click();
  await waitGot(page,b3,m=>m.type==='hu:environment-scene'&&m.action==='play','hu:environment-scene play');
  await fromGlobe(page,{type:'hu:environment-scene-state',playing:true,index:0,total:16,id:'usgs:fx-gen-48',title:'M6.3 · Fixture event 48',queue:'significant',reason:null});
  await page.waitForFunction(()=>document.getElementById('wePlay').textContent==='Pause tour',null,{timeout:5000});
  assert.match(await page.locator('#weSceneStatus').textContent(),/Scene 1 of 16/);
  const b3n=(await got(page)).length;await page.locator('#weNext').click();await waitGot(page,b3n,m=>m.type==='hu:environment-scene'&&m.action==='next','hu:environment-scene next');
  const b3v=(await got(page)).length;await page.locator('#weView2d').click();
  await waitGot(page,b3v,m=>m.type==='hu:environment-view'&&m.mode==='2d','hu:environment-view 2d');
  await fromGlobe(page,{type:'hu:environment-view-state',mode:'2d',morphing:false});
  await page.waitForFunction(()=>document.getElementById('weView2d').getAttribute('aria-pressed')==='true',null,{timeout:5000});
  assert.equal(await page.locator('#weView2d').textContent(),'3D globe');
  /* G1R-11: the Play/Pause button changes its label and carries no aria-pressed; G1R-6: every panel button is a form control at 16px or more */
  const controls=await page.evaluate(()=>({pressed:document.getElementById('wePlay').hasAttribute('aria-pressed'),sizes:Object.fromEntries(['wePlay','wePrev','weNext','weReplay','weView2d','weRefresh'].map(id=>[id,parseFloat(getComputedStyle(document.getElementById(id)).fontSize)]))}));
  assert.equal(controls.pressed,false,'no aria-pressed on a button whose label names the next action');
  assert.ok(Object.values(controls.sizes).every(s=>s>=16),'panel buttons at 16px or more: '+JSON.stringify(controls.sizes));
  /* nothing scrolls sideways, in the page, the panel or the feed */
  const dims=await fits(page);
  assert.equal(dims.sw,dims.cw,JSON.stringify(dims));assert.ok(dims.psw<=dims.pcw,JSON.stringify(dims));
  /* every post's action row bleeds 6 px into the gutter by design (css/mnet.css, .mn-world-on #mnFeed .mn__post-actions margin:8px -6px -4px,
     mission and member posts alike); nothing else in the feed may stick out, so an observation post that overflowed would be named here */
  assert.ok(dims.over.every(x=>/^div\.mn__post-actions@[1-6]$/.test(x)),JSON.stringify(dims));
  /* back to Everything: Show on globe from there turns the feed to the Equity Uprise tab first */
  await page.locator('#mnFeedScope [data-feed-scope="global"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#mnFeed .mn__observation-post').length>0,null,{timeout:10000});
  const b4=(await got(page)).length;
  await page.locator('#mnFeed [data-observation-globe]').first().click();
  assert.equal(await page.evaluate(()=>window.MCC_FEED_SCOPE.get()),'equity');
  await waitGot(page,b4,m=>m.type==='hu:environment-focus','hu:environment-focus from Everything');
  assert.deepEqual(errors,[],'no page errors');
  await shot(page,'world-environment-page-'+device.width);
  console.log(`PASS B ${device.width}px: the page as it ships; significant observations in Everything at most one in six, every observation in the Equity Uprise tab with the missions by time, typed and stamped (recorded, or retrieved and said so), Show on globe, layers before pins, health rows, a summarised fire area, the globe-selection card, tour and 2D controls, no sideways scroll, no page errors. Fixtures only.`);
  await context.close();
  /* by day: the panel, its buttons and status words, and the observation post's head read 4.5:1 or better on their grounds */
  const day=await openPage(device,{daylight:'day'});
  await day.page.locator('#mnFeedScope [data-feed-scope="equity"]').click();
  await day.page.waitForFunction(()=>getComputedStyle(document.getElementById('wePanel')).display!=='none'&&document.querySelectorAll('#mnFeed .mn__observation-post').length>0,null,{timeout:30000});
  await day.page.locator('#wePanel details summary').first().click();
  const contrast=await day.page.evaluate(()=>{
   const bgOf=el=>{for(let n=el;n;n=n.parentElement){const b=getComputedStyle(n).backgroundColor;if(b&&b!=='rgba(0, 0, 0, 0)'&&b!=='transparent')return b;}return 'rgb(255, 255, 255)';};
   const rgb=s=>{const m=/rgba?\((\d+), (\d+), (\d+)/.exec(s);return m?[+m[1],+m[2],+m[3]]:[0,0,0];};
   const lum=([r,g,b])=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};
   const ratio=(x,y)=>{const a=lum(rgb(x)),b=lum(rgb(y));return Math.round(((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05))*100)/100;};
   const of=(name,el)=>el?{name,text:el.textContent.trim().slice(0,40),ink:getComputedStyle(el).color,ground:bgOf(el),ratio:ratio(getComputedStyle(el).color,bgOf(el))}:{name,missing:true};
   const q=s=>document.querySelector(s);
   return {phase:document.documentElement.dataset.daylight,rows:[of('title',q('#weTitle')),of('eyebrow',q('#wePanel .we-eyebrow')),of('subtle',q('#wePanel .we-subtle')),of('refresh',q('#weRefresh')),of('play',q('#wePlay')),of('view',q('#weView2d')),of('status available',q('#weSources .we-status[data-status="available"]')),of('status stale',q('#weSources .we-status[data-status="stale"]')),of('list button',q('#weEvents button strong')),of('post author',q('#mnFeed .mn__observation-post .mn__author-name')),of('post sub',q('#mnFeed .mn__observation-post .mn__author-sub')),of('post title',q('#mnFeed .mn__observation-post-title')),of('post body',q('#mnFeed .mn__observation-post-body')),of('post action',q('#mnFeed .mn__observation-post .mn__action-label')),of('honest line',q('#weUnavailable'))]};
  });
  assert.equal(contrast.phase,'day');
  for(const r of contrast.rows){if(r.name==='honest line')continue;assert.ok(!r.missing,r.name+' is on the page');assert.ok(r.ratio>=4.5,`${r.name} "${r.text}" ${r.ink} on ${r.ground} is ${r.ratio}:1`);}
  const dayDims=await fits(day.page);assert.equal(dayDims.sw,dayDims.cw,JSON.stringify(dayDims));
  assert.deepEqual(day.errors,[]);
  await shot(day.page,'world-environment-day-'+device.width);
  console.log(`PASS day ${device.width}px: ${contrast.rows.filter(r=>!r.missing).map(r=>r.name+' '+r.ratio).join(', ')}`);
  await day.context.close();
 }
 /* the module refused (production answers 503 until the owner enables it; 404 when it is disabled): the honest line, no panel,
    and not one observation post anywhere */
 for(const code of ['503','404']){
  const {context,page,errors,requests}=await openPage(WIDTHS[0],{environment:code});
  await page.waitForFunction(()=>document.querySelectorAll('#mnFeed > article').length>0,null,{timeout:30000});
  await page.waitForFunction(()=>document.documentElement.getAttribute('data-we-feed')==='unavailable',null,{timeout:30000});
  await page.locator('#mnFeedScope [data-feed-scope="equity"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#mnFeed [data-mission-post]').length>0,null,{timeout:30000});
  const tab=await page.evaluate(()=>({note:getComputedStyle(document.getElementById('weUnavailable')).display,text:document.getElementById('weUnavailable').textContent.trim(),panel:getComputedStyle(document.getElementById('wePanel')).display,posts:document.querySelectorAll('#mnFeed .mn__observation-post').length,missions:document.querySelectorAll('#mnFeed [data-mission-post]').length}));
  assert.equal(tab.note,'block');assert.equal(tab.text,'Environmental reports are not available right now.');assert.equal(tab.panel,'none');assert.equal(tab.posts,0,'no observation posts while the module answers '+code);assert.equal(tab.missions,3,'the missions still post');
  await page.locator('#mnFeedScope [data-feed-scope="global"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#mnFeed > article').length>0,null,{timeout:10000});
  assert.equal(await page.locator('#mnFeed .mn__observation-post').count(),0);
  assert.equal(requests.filter(p=>p==='/v1/world/environment').length,1,'one read, no retry loop against a refusing gate');
  assert.deepEqual(errors,[]);
  console.log(`PASS ${code} 390px: the honest line, no panel, zero observation posts, the missions untouched.`);
  await context.close();
 }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
