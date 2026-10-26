/* Actual recovered editor/renderer + project handler + pending SQL in isolated Postgres.
   Synthetic existing users, paid subscription and prepared media only; no external calls. */
import {createRequire} from 'node:module';import {resolve,extname} from 'node:path';import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';import assert from 'node:assert/strict';
import {projectTilesFixture,A,ORG} from '../../workers/mccluster/test/support/project-tiles-fixture.mjs';
import {prepareMedia} from '../../core/src/website-studio/prepare.mjs';
import {handleProjectTiles} from '../../workers/mccluster/src/project-tiles.js';
const ROOT=resolve(import.meta.dirname,'../..'),BASE='https://matthew.mccluster.org',CUSTOM='https://tenant.fixture.invalid';
const {chromium}=createRequire(resolve(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','fixture.cjs'))('playwright');
const prepared=await mkdtemp('/tmp/project-tiles-native-');
for(const [kind,file] of [['music','beat.wav'],['native_video','film.webm'],['immersive360','room360.jpg']])await prepareMedia(resolve(ROOT,'scripts/e2e/fixtures/front-media',file),resolve(prepared,kind),{kind});
const f=await projectTilesFixture(),ids=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
for(let i=0;i<3;i++)await f.prepare(ids[i],['music','native_video','immersive360'][i],A,false);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:390,height:844}}),errors=[];
await context.addInitScript(()=>{window.profileCalls=[];window.MCC_BAR={pageProfile:p=>window.profileCalls.push(p)};});
await context.route('**/*',async route=>{
 const req=route.request(),u=new URL(req.url());
 if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':BASE,'access-control-allow-headers':'*','access-control-allow-methods':'*'}});
 if(u.origin==='https://api.mccluster.org'||u.origin===CUSTOM&&u.pathname.startsWith('/v1/')){
  if(u.pathname==='/v1/creator-billing/entitlement')return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':BASE},body:JSON.stringify({paid:true,workspaces:[{org_id:ORG}]})});
  const r=await handleProjectTiles(new Request(req.url(),{method:req.method(),headers:req.headers(),body:['GET','HEAD'].includes(req.method())?undefined:req.postData()}),f.env,{db:f.db,fetchImpl:f.fetchImpl});
  return route.fulfill({status:r?.status||404,headers:{...Object.fromEntries(r?.headers||[]),'access-control-allow-origin':BASE},body:r?await r.text():'{}'});
 }
 if(u.pathname==='/js/mcc-auth.js')return route.fulfill({contentType:'text/javascript',body:"window.fixtureSession={access_token:'fixture-alice'};window.MCC={session:()=>window.fixtureSession,refreshIfNeeded:async()=>window.fixtureSession,user:async()=>window.fixtureSession?{id:'"+A+"'}:null};"});
 if(['/js/tabbar.js','/js/shell-boot.js'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
 if(u.pathname.includes('/storage/v1/object/sign/')){const name=u.pathname.split('/').pop(),kind=name==='audio.m4a'?'music':name==='panorama.jpg'?'immersive360':'native_video';return route.fulfill({status:200,contentType:name.endsWith('.m4a')?'audio/mp4':name.endsWith('.mp4')?'video/mp4':'image/jpeg',body:await readFile(resolve(prepared,kind,name))});}
 if(![BASE,CUSTOM].includes(u.origin))return route.abort();const file=resolve(ROOT,'.'+u.pathname);if(!file.startsWith(ROOT+'/'))return route.abort();
 try{return route.fulfill({body:await readFile(file),contentType:({'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
});
try{
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(BASE+'/website-studio.html?project=alpha');await page.click('#useTemplate');await page.getByText('Template ready. This draft is not saved yet.').waitFor();
 assert.equal(await page.locator('#tiles .ws-card').count(),3);
 await page.fill('#title','Consolidated owner site');
 for(let i=0;i<3;i++){await page.getByLabel('Your uploaded media',{exact:true}).nth(i).selectOption(ids[i]);await page.getByRole('button',{name:'Approve selected media for public use'}).nth(i).click();await page.getByText('Media approval saved. Publish remains a separate step.').waitFor();}
 await page.click('#save');await page.getByText('Saved to your account · revision 1').waitFor();
 await page.click('#preview');await page.locator('#previewPanel:not([hidden])').waitFor();assert.equal(await page.locator('#previewHost audio').count(),1);assert.equal(await page.locator('#previewHost video').count(),1);assert.equal(await page.getByRole('button',{name:'Enter 360 experience'}).count(),1);
 await page.click('#back');await page.click('#publish');await page.getByText('Published revision 1').waitFor();
 const href=await page.getByRole('link',{name:'Open published website'}).getAttribute('href');assert.equal(href,BASE+'/website-studio-view.html?project=alpha');
 const visitor=await context.newPage();visitor.on('pageerror',e=>errors.push(e.message));await visitor.goto(href);await visitor.getByRole('heading',{name:'Consolidated owner site'}).waitFor();assert.equal(await visitor.locator('#site audio').count(),1);
 const expectedProfile={name:'Consolidated owner site',logo:'',home:'website-studio-view.html?project=alpha'};
 assert.deepEqual(await visitor.evaluate(()=>window.MCC_PAGE_PROFILE),expectedProfile);assert.deepEqual(await visitor.evaluate(()=>window.profileCalls.at(-1)),expectedProfile);
 const tenant=await context.newPage();await tenant.addInitScript(()=>{window.MCC_STUDIO_HOST={project:'alpha',api:location.origin};});await tenant.goto(CUSTOM+'/website-studio-view.html?project=ignored');await tenant.getByRole('heading',{name:'Consolidated owner site'}).waitFor();assert.deepEqual(await tenant.evaluate(()=>window.MCC_PAGE_PROFILE),{...expectedProfile,home:'/website-studio-view.html'});assert.deepEqual(await tenant.evaluate(()=>window.profileCalls.at(-1)),{...expectedProfile,home:'/website-studio-view.html'});
 for(const selector of ['#site audio','#site video'])assert.equal(await visitor.locator(selector).evaluate(async media=>{media.muted=true;await media.play();await new Promise(r=>setTimeout(r,120));const played=media.currentTime>0&&media.duration>0;media.pause();return played;}),true);
 const row=(await f.db.select('managed_projects',{slug:'eq.alpha'}))[0];assert.equal(row.draft.words.eyebrow,'Keep cinematic draft');assert.equal(row.published.words.eyebrow,'Keep cinematic public');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);assert.equal(await visitor.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
 await mkdir('/tmp/project-tiles-proof',{recursive:true});await page.screenshot({path:'/tmp/project-tiles-proof/editor.png',fullPage:true});
 await page.fill('#title','Second revision');await page.click('#save');await page.getByText('Saved to your account · revision 2').waitFor();await visitor.reload();await visitor.getByRole('heading',{name:'Consolidated owner site'}).waitFor();
 await f.sql.query("update creator_site_media_state set state='withdrawn' where asset_id=$1",[ids[0]]);await visitor.reload();await visitor.getByText('This project could not load. Try again.').waitFor();assert.equal(await visitor.locator('audio').count(),0);assert.equal(await visitor.evaluate(()=>window.MCC_PAGE_PROFILE),null);assert.equal(await visitor.evaluate(()=>window.profileCalls.at(-1)),null);await tenant.reload();await tenant.getByText('This project could not load. Try again.').waitFor();assert.equal(await tenant.evaluate(()=>window.MCC_PAGE_PROFILE),null);assert.equal(await tenant.evaluate(()=>window.profileCalls.at(-1)),null);
 await page.setViewportSize({width:1440,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
 assert.deepEqual(errors,[]);console.log('PASS real SQL/browser: existing nonadmin paid account → template → owned private media approval → revision save/preview/publish → public playback; saved revision stays private; withdrawn media hidden; cinematic snapshots preserved; 390/1440 overflow; no JS errors');
}finally{await context.close();await browser.close();await f.close();await rm(prepared,{recursive:true,force:true});}
