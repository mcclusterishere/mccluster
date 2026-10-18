/* Real archive data, real page/auth scripts, fixture APIs only. No claims,
   invitations, edits or media requests reach production. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||join(ROOT,'e2e-out','docket-cohort');
const require=createRequire(import.meta.url);
let chromium;
try { ({chromium}=require('playwright')); }
catch { ({chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules','x'))('playwright')); }
const archive=JSON.parse(await readFile(join(ROOT,'data/action/docket-516r-archive.json'),'utf8'));
const TYPES={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp'};
async function file(path){const p=normalize(decodeURIComponent(path)).replace(/^([.][.][/\\])+/,'');return {body:await readFile(join(ROOT,p)),contentType:TYPES[extname(p)]||'application/octet-stream'};}
const server=createServer(async(req,res)=>{try{const f=await file(new URL(req.url,'http://local').pathname);res.writeHead(200,{'content-type':f.contentType});res.end(f.body);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const BASE=`http://127.0.0.1:${server.address().port}`,results=[];
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
const user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',m_uid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',mccluster_id:'fixture.owner',display_name:'Fixture owner'};
function check(name,ok,detail){results.push({name,ok:!!ok,...(detail?{detail}:{})});}
async function scenario({member=false,owner='ocho-great',fallback=false,apiStatus=200,networkFailure=false,bodyReadFailure=null,invalidJson=false,malformedPayload=false,unpublished=[],missingEvent=false,manualGlobeReady=false,archiveDelay=0}={}){
 const data=structuredClone(archive),world={saves:[],claims:[],meReads:0,archiveReads:0,staticReads:0},errors=[];
 data.participants.forEach(p=>{p.claim_status=p.slug===owner?'claimed':'unclaimed';p.owner_m_uid=p.slug===owner?user.m_uid:null;p.provider_page=unpublished.includes(p.slug)?null:{title:p.display_name,headline:p.slug===owner?'An original headline':'',bio:p.slug===owner?'An original biography.':'',website_url:p.slug===owner?'https://example.invalid/original':'',publication_grant:'past_cohort'};});
 if(missingEvent)data.event=null;
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'});
 await ctx.addInitScript(({member,user})=>{
  localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-09-26',accepted_at:new Date().toISOString()}));localStorage.setItem('mnet_tour_seen','1');
  if(member){const t='x.'+btoa(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600,sub:user.id}))+'.y';localStorage.setItem('mccdb_session',JSON.stringify({access_token:t,refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600}));}
 },{member,user});
 if(bodyReadFailure)await ctx.addInitScript(({name,path})=>{
  const realFetch=window.fetch;
  window.__archiveBodyFailures=[];
  window.fetch=async function(input,init){
   const response=await realFetch(input,init);
   if(new URL(typeof input==='string'?input:input.url,location.href).pathname!==path)return response;
   const record={status:response.status,name:null,aborted:false};window.__archiveBodyFailures.push(record);
   // A real Response body fails after successful headers. AbortError waits for
   // the loader's own deadline; TypeError models an interrupted response stream.
   const body=new ReadableStream({start(controller){
    const fail=()=>{const error=name==='AbortError'?init.signal.reason:new TypeError('Fixture response stream interrupted');record.name=error.name;record.aborted=init.signal.aborted;controller.error(error);};
    if(name==='AbortError'&&!init.signal.aborted)init.signal.addEventListener('abort',fail,{once:true});else fail();
   }});
   return new Response(body,{status:response.status,headers:response.headers});
  };
 },{name:bodyReadFailure,path:'/v1/action-archive/'+archive.project.slug});
 await ctx.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  const headers={'access-control-allow-origin':BASE,'access-control-allow-credentials':'true','access-control-allow-headers':'authorization,apikey,content-type,prefer','access-control-allow-methods':'GET,POST,PATCH,DELETE'};
  const json=(body,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});
  if(u.origin===BASE){
   if(u.pathname==='/data/action/docket-516r-archive.json')world.staticReads++;
   if(u.pathname==='/action-globe.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><body style="background:#090b0d"><script>window.__received=[];window.__ready=false;window.__releaseReady=()=>{__ready=true;parent.postMessage({type:"hu:globe-ready",missionIds:[],missions:[]},location.origin)};addEventListener("message",e=>{if(e.source!==parent||e.origin!==location.origin)return;__received.push(e.data);if(e.data.type==="hu:hello"&&__ready)__releaseReady()});'+(manualGlobeReady?'':'__releaseReady();')+'</script></body>'});
   return route.continue();
  }
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(u.hostname==='api.mccluster.org'){
   if(u.pathname==='/v1/action-archive/'+archive.project.slug){
    world.archiveReads++;if(networkFailure)return route.abort();if(archiveDelay)await new Promise(r=>setTimeout(r,archiveDelay));const status=fallback?503:apiStatus;
    if(status!==200)return json({error:'fixture unavailable'},status);
    if(invalidJson)return route.fulfill({status:200,headers,contentType:'application/json',body:'{"project":'});
    return json(malformedPayload?{project:data.project,participants:data.participants,works:null}:data);
   }
   if(u.pathname==='/v1/action-archive/me'){world.meReads++;return json({participant:data.participants.find(p=>p.slug===owner)||null});}
   if(u.pathname.startsWith('/v1/action-archive/pages/')){
    const body=req.postDataJSON();world.saves.push({method:req.method(),path:u.pathname,contentType:req.headers()['content-type'],body});
    const p=data.participants.find(p=>p.slug===u.pathname.split('/').at(-1));if(!member||p?.slug!==owner)return json({error:'You can edit only your own claimed webpage.'},403);
    Object.assign(p.provider_page,{headline:body.headline,bio:body.bio,website_url:body.website_url});return json({saved:true,provider_page:p.provider_page});
   }
   if(/\/action-archive\/(claim|invitation|invitations)/.test(u.pathname)){world.claims.push(u.pathname);return json({error:'No claims in this test'},403);}
   if(u.pathname==='/v1/status')return json({error:'Forbidden'},403);
   if(u.pathname==='/v1/mnet/bootstrap')return json({identity:user,profile:user,next_step:null,tour_done_at:new Date().toISOString()});
   if(/\/v1\/mnet\/(public-)?feed/.test(u.pathname))return json({items:[],next_before:null});
   if(u.pathname==='/v1/world/news')return json({items:[],next_before:null,unavailable:true});
   return json({});
  }
  if(u.hostname==='zmnhbrjyhxzhkxmhkexs.supabase.co'){
   if(u.pathname.endsWith('/auth/v1/user'))return json(member?user:{error:'No session'},member?200:401);
   if(u.pathname.endsWith('/action_missions'))return json([]);
   if(u.pathname.endsWith('/rpc/action_record'))return json({verified_actions:0,points:0,in_progress:0,missions:[],skills:[],cohorts:[]});
   return json([]);
  }
  if(u.hostname==='matthew.mccluster.org'&&u.pathname.startsWith('/assets/')){try{return route.fulfill(await file(u.pathname));}catch{return route.fulfill({status:404,body:''});}}
  return route.abort();
 });
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 return {ctx,page,world,data,errors};
}
async function fit(page,name){const size=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));check(name,size.width===390&&size.scroll===390,size);}
async function archivePage(s,suffix=''){await s.page.goto(BASE+'/docket-516r-cohort.html'+suffix);await s.page.waitForSelector('#docketCohortPage .dc-work');}
async function globeMessages(page){return page.locator('#mnWorldFrame').evaluate(f=>f.contentWindow.__received||[]);}
const active=new Set();
async function make(options){const s=await scenario(options);active.add(s);return s;}
async function close(s){await s.ctx.close();active.delete(s);}
try{
 await mkdir(OUT,{recursive:true});
 {
  const s=await make();await archivePage(s);
  check('successful public archive loads directly without static substitution',s.world.archiveReads===1&&s.world.staticReads===0);
  check('project has exactly nine song panels and ten people',await s.page.locator('.dc-work').count()===9&&await s.page.locator('.dc-person').count()===10);
  check('two Environmental Injustice versions keep independent Music links',await s.page.locator('#docket-516r-environmental-injustice a').filter({hasText:'Play in Music'}).count()===2);
  const players=await s.page.locator('audio,video').evaluateAll(nodes=>nodes.map(n=>({tag:n.tagName,src:n.src})));
  check('published audio delegates playback to Music; direct video previews remain local',players.filter(p=>p.tag==='AUDIO').length===0&&players.filter(p=>p.tag==='VIDEO').length===3&&players.every(p=>!p.src.includes('drive.google.com')),players);
  check('published songs point at canonical Music routes',await s.page.locator('.dc-work a').filter({hasText:'Play in Music'}).count()===4);
  check('unpublished archives retain labelled archive links',await s.page.locator('.dc-work a').filter({hasText:'Listen in the archive'}).count()===6);
  check('cohort video is included',await s.page.locator(`a[href="${archive.media.find(m=>m.kind==='cohort_video').url}"]`).count()===1);
  check('primary link text contrasts with its light background',await s.page.locator('a.dc-button--primary').evaluateAll(nodes=>nodes.every(n=>{const c=getComputedStyle(n);return c.color==='rgb(20, 23, 25)'&&c.backgroundColor==='rgb(244, 241, 234)';})));
  await fit(s.page,'project page fits 390px');await s.page.screenshot({path:join(OUT,'project-390.png')});
  await archivePage(s,'#docket-516r-money-or-the-power');await s.page.waitForTimeout(30);check('song hash opens the matching completed mission',await s.page.locator('#docket-516r-money-or-the-power').getAttribute('open')!==null);
  check('guest page does not fetch ownership or show an editor',s.world.meReads===0&&await s.page.locator('.dc-edit').count()===0);
  check('project browser has no script errors',s.errors.length===0,s.errors);await close(s);
 }
 {
  const s=await make({member:true});await archivePage(s,'?person=ocho-great');await s.page.waitForSelector('.dc-edit');
  check('owner editor follows nested me.participant.provider_page',await s.page.locator('.dc-edit [name=headline]').inputValue()==='An original headline');
  check('claimed status overrides stale static unclaimed status',!await s.page.getByText('This webpage was prepared by the cohort organizer.',{exact:false}).count());
  await fit(s.page,'person page and owner editor fit 390px');await s.page.screenshot({path:join(OUT,'person-390.png')});
  const edit={project_slug:archive.project.slug,headline:'Neighborhood stories, recorded here',bio:'First line with a quote: "our neighborhood".\nA second line with & and an apostrophe: it\'s ours.',website_url:'https://example.invalid/new'};
  for(const k of ['headline','bio','website_url'])await s.page.locator(`.dc-edit [name=${k}]`).fill(edit[k]);
  await s.page.getByRole('button',{name:'Save webpage',exact:true}).click();await s.page.getByText('Your webpage is saved.',{exact:true}).waitFor();
  const save=s.world.saves[0];check('save uses authenticated JSON with the exact backend fields',s.world.saves.length===1&&save.method==='POST'&&save.path==='/v1/action-archive/pages/ocho-great'&&save.contentType==='application/json'&&JSON.stringify(save.body)===JSON.stringify(edit),save);
  check('all saved fields immediately update the visible webpage',await s.page.locator('#docketCohortPage > .dc-intro').first().textContent()===edit.headline&&await s.page.locator('#docketCohortPage > .dc-intro').nth(1).textContent()===edit.bio&&await s.page.getByRole('link',{name:'Visit website'}).getAttribute('href')===edit.website_url);
  check('owner edits never create a claim or invitation',s.world.claims.length===0);
  check('owner browser has no script errors',s.errors.length===0,s.errors);await close(s);
 }
 {
  const s=await make({member:true,owner:'mccluster'});await archivePage(s,'?person=ocho-great');await s.page.waitForTimeout(100);
  check('another signed-in participant cannot see this owner editor',s.world.meReads===1&&await s.page.locator('.dc-edit').count()===0);
  check('person links keep profile and webpage destinations distinct',new URL(await s.page.getByRole('link',{name:'View profile',exact:true}).getAttribute('href'),BASE).pathname==='/cohort-profile.html');
  await close(s);
 }
 {
  const s=await make({fallback:true});await archivePage(s);check('public API outage falls back to the real local archive',await s.page.locator('.dc-work').count()===9&&await s.page.locator('.dc-person').count()===10&&s.world.staticReads===1);
  await archivePage(s,'?person=ocho-great');check('approved static participant without provider_page can render its supplied fallback',await s.page.locator('#docketCohortPage h1').innerText()==='Ocho Great');await close(s);
 }
 for(const apiStatus of [403,404]){
  const s=await make({apiStatus});await s.page.goto(BASE+'/docket-516r-cohort.html');await s.page.getByText('The archive could not load right now.',{exact:true}).waitFor();
  check('explicit '+apiStatus+' does not restore the static archive',s.world.staticReads===0&&await s.page.locator('.dc-work').count()===0&&await s.page.locator('.dc-person').count()===0);await close(s);
 }
 {
  const s=await make({networkFailure:true});await archivePage(s);check('transient network failure can use the approved static archive',s.world.staticReads===1&&await s.page.locator('.dc-work').count()===9);await close(s);
 }
 for(const name of ['AbortError','TypeError']){
  const s=await make({bodyReadFailure:name});await archivePage(s);
  const reads=await s.page.evaluate(()=>window.__archiveBodyFailures);
  check(name+' after HTTP 200 uses the approved static archive',s.world.archiveReads===1&&s.world.staticReads===1&&await s.page.locator('.dc-work').count()===9&&reads.length===1&&reads[0].status===200&&reads[0].name===name&&(name!=='AbortError'||reads[0].aborted),reads);
  check(name+' fallback does not create browser errors',s.errors.length===0,s.errors);await close(s);
 }
 for(const invalid of ['invalidJson','malformedPayload']){
  const s=await make({[invalid]:true});await s.page.goto(BASE+'/docket-516r-cohort.html');await s.page.getByText('The archive could not load right now.',{exact:true}).waitFor();
  check(invalid+' in HTTP 200 is not silently replaced by the static archive',s.world.archiveReads===1&&s.world.staticReads===0&&await s.page.locator('.dc-work,.dc-person').count()===0);await close(s);
 }
 {
  const s=await make({member:true,unpublished:['ocho-great']});await archivePage(s);
  const person=s.page.locator('.dc-person').filter({has:s.page.getByRole('link',{name:'Ocho Great',exact:true})});
  check('unpublished webpage is not offered on its cohort card',await person.getByRole('link',{name:'Webpage',exact:true}).count()===0&&await person.getByRole('link',{name:'Profile',exact:true}).count()===1);
  check('unpublished contributor credits link to their profile instead',await s.page.locator('#docketCohortPage a').evaluateAll(nodes=>nodes.every(n=>{const u=new URL(n.href);return !(u.pathname.endsWith('/docket-516r-cohort.html')&&u.searchParams.get('person')==='ocho-great');})));
  await s.page.goto(BASE+'/docket-516r-cohort.html?person=ocho-great');await s.page.getByText('This cohort webpage is not published.',{exact:true}).waitFor();
  check('explicit null page cannot be rebuilt or edited from participant metadata',await s.page.locator('.dc-work,.dc-edit').count()===0&&s.world.staticReads===0&&s.world.meReads===0);await close(s);
 }
 {
  const s=await make({missingEvent:true});await archivePage(s);check('capstone count reflects whether an event exists',await s.page.locator('.dc-stats b').nth(2).innerText()==='0');await close(s);
 }
 {
  const s=await make();await s.page.goto(BASE+'/mnet.html?view=feed');await s.page.waitForFunction(()=>window.MCC_WORLD_MODE&&document.documentElement.classList.contains('mn-world-on'));
  check('World still defaults to Travel',await s.page.evaluate(()=>MCC_WORLD_MODE.get())==='travel');
  await s.page.click('.wt-world-modes [data-world-mode="missions"]');
  await s.page.click('.mn-swipe__filters [data-status="completed"]');
  await s.page.waitForSelector('#mnCompletedMissions .dc-series');
  await s.page.waitForFunction(()=>document.querySelector('#mnWorldFrame').contentWindow.__received.some(m=>m.type==='hu:completed-missions'&&m.events.length===1));
  const marker=(await globeMessages(s.page)).filter(m=>m.type==='hu:completed-missions').at(-1);
  check('Missions sends the one confirmed capstone place',marker.on===true&&marker.events.length===1&&marker.events[0].id===archive.event.slug&&marker.events[0].latitude===archive.event.latitude&&marker.events[0].longitude===archive.event.longitude&&marker.events[0].date==='2025-10-05',marker);
  await s.page.locator('#mnCompletedMissions .dc-series__summary').click();
  await s.page.getByRole('button',{name:'Show on globe',exact:true}).click();
  await s.page.waitForFunction(()=>document.querySelector('#mnWorldFrame').contentWindow.__received.some(m=>m.type==='hu:focus-place'));
  const focus=(await globeMessages(s.page)).filter(m=>m.type==='hu:focus-place').at(-1);check('capstone button focuses its public venue',focus?.lat===archive.event.latitude&&focus?.lon===archive.event.longitude);
  await s.page.evaluate(()=>{const n=document.querySelector('#mnCompletedMissions');window.__archiveScrolls=0;n.scrollIntoView=()=>window.__archiveScrolls++;window.postMessage({type:'hu:completed-selected',eventId:'docket-516r-2025-capstone'},location.origin);});
  await s.page.waitForTimeout(30);check('parent ignores spoofed marker selection from the page',await s.page.evaluate(()=>window.__archiveScrolls)===0);
  const frame=s.page.frames().find(f=>f.url().includes('/action-globe.html'));await frame.evaluate(id=>parent.postMessage({type:'hu:completed-selected',eventId:id},location.origin),archive.event.slug);
  await s.page.waitForFunction(()=>window.__archiveScrolls===1);check('real globe marker selection opens the capstone context',true);
  for(const mode of ['posts','travel']){await s.page.click(`.wt-world-modes [data-world-mode="${mode}"]`);await s.page.waitForFunction(()=>document.querySelector('#mnWorldFrame').contentWindow.__received.filter(m=>m.type==='hu:completed-missions').at(-1)?.on===false);const last=(await globeMessages(s.page)).filter(m=>m.type==='hu:completed-missions').at(-1);check(mode+' hides completed markers',last.on===false&&last.events.length===0);}
  await s.page.click('.wt-world-modes [data-world-mode="missions"]');check('returning to Missions does not duplicate the showcase',await s.page.locator('#mnCompletedMissions .dc-series').count()===1);await fit(s.page,'World showcase fits 390px');
  await s.page.locator('#mnCompletedMissions').screenshot({path:join(OUT,'world-showcase-390.png')});
  await s.page.goto(BASE+'/mnet.html?mode=missions&completed='+archive.event.slug);await s.page.waitForFunction(()=>window.MCC_WORLD_MODE&&document.documentElement.classList.contains('mn-world-on'));
  check('archive map deep link opens Missions',await s.page.evaluate(()=>MCC_WORLD_MODE.get())==='missions');
  if(await s.page.evaluate(()=>MCC_WORLD_MODE.get())==='missions'){
   await s.page.waitForSelector('#mnCompletedMissions .dc-series');await s.page.waitForFunction(()=>document.querySelector('#mnWorldFrame').contentWindow.__received.some(m=>m.type==='hu:focus-place'));
   const f=(await globeMessages(s.page)).filter(m=>m.type==='hu:focus-place').at(-1);check('archive map deep link focuses the selected capstone',f?.lat===archive.event.latitude&&f?.lon===archive.event.longitude);
  }
  check('World integration has no script errors',s.errors.length===0,s.errors);await close(s);
 }
 for(const deferred of ['globe','archive']){
  const s=await make({manualGlobeReady:deferred==='globe',archiveDelay:deferred==='archive'?400:0});
  await s.page.goto(BASE+'/mnet.html?mode=missions&completed='+archive.event.slug);await s.page.waitForSelector('#mnCompletedMissions .dc-series');
  if(deferred==='globe'){
   check('deep link waits until the globe is ready',!(await globeMessages(s.page)).some(m=>m.type==='hu:focus-place'));
   const frame=s.page.frames().find(f=>f.url().includes('/action-globe.html'));await frame.evaluate(()=>window.__releaseReady());
  }
  await s.page.waitForFunction(()=>document.querySelector('#mnWorldFrame').contentWindow.__received.some(m=>m.type==='hu:focus-place'));
  const focus=(await globeMessages(s.page)).filter(m=>m.type==='hu:focus-place');check('deep link focuses once with delayed '+deferred,focus.length===1&&focus[0].lat===archive.event.latitude&&focus[0].lon===archive.event.longitude);
  await close(s);
 }
 {
  const s=await make();await s.page.goto(BASE+'/cohort-profile.html?project=docket-516r-2025&person=ocho-great');await s.page.waitForSelector('#cohortProfile:not([hidden])');
  await fit(s.page,'separate cohort profile fits 390px');
  check('profile links to the same song anchors',await s.page.locator('#profileWorks a').evaluateAll(nodes=>nodes.every(n=>n.hash.startsWith('#docket-516r-'))));
  await s.page.screenshot({path:join(OUT,'cohort-profile-390.png')});
  await s.page.goto(BASE+'/cohort-claim.html');await s.page.getByText('A private invitation link is needed to claim a profile.',{exact:true}).waitFor();
  await fit(s.page,'invitation page without a token fits 390px');
  check('missing invitation stays disabled and does not make a claim request',await s.page.locator('#claimConfirm').isDisabled()&&s.world.claims.length===0);
  check('profile and invitation pages have no script errors',s.errors.length===0,s.errors);await s.page.screenshot({path:join(OUT,'cohort-invitation-390.png')});await close(s);
 }
}finally{
 await writeFile(join(OUT,'results.json'),JSON.stringify(results,null,2));
 for(const s of active)await s.ctx.close();await browser.close();server.close();
}
console.log(JSON.stringify(results,null,2));
assert.equal(results.filter(r=>!r.ok).length,0,'All cohort showcase checks pass');
