/* Uses the existing Control fixture suite. Every API read is intercepted.
   Capture: ANALYTICS_PROOF_ONLY=1 node scripts/e2e/analytics-measurement.e2e.mjs [outDir]
   Behavioral QA: node scripts/e2e/analytics-measurement.e2e.mjs [outDir]
   Runtime: PLAYWRIGHT_DIR, CHROMIUM_PATH, CESIUM_DIR (pinned Cesium 1.131.0). */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const fixedTime='2026-10-20T12:00:00Z';
process.env.ANALYTICS_FIXED_TIME=fixedTime;
const {context,settle,widths,browser,server,BASE,OUT,json}=await import('./analytics-unified.e2e.mjs');
const geometry=[];let checks=0;
function check(name,value){assert.ok(value,name);checks++;console.log('PASS '+name);}
const sizes=[{width:390,height:844},{width:820,height:1180},{width:1280,height:1000}];
try {
 if(!process.env.ANALYTICS_SKIP_CAPTURE)for(const theme of ['dark','light'])for(const size of sizes){
  const key=theme+'-'+size.width;
  const {ctx,page,errors}=await context(size,{reduced:true,theme,fixedTime,deviceScaleFactor:1});
  await page.goto(BASE+'/control.html#analytics',{waitUntil:'domcontentloaded'});
  check(key+' real globe',await settle(page));await page.waitForFunction(()=>window.CR.analytics.state.loaded);await page.waitForSelector('.cu-metrics');
  const w=await widths(page);check(key+' no horizontal overflow',w.scrollW===w.clientW);
  const g=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,themeLock:document.documentElement.dataset.themeLock,layout:Object.fromEntries(['.cra-stage','.cad-body','.appbar','.cu-geography'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return[s,{x:r.x,y:r.y,width:r.width,height:r.height}];}))}));
  check(key+' respects existing dark theme lock',g.theme==='dark'&&g.themeLock==='dark');
  geometry.push({preference:theme,width:size.width,...g});await page.screenshot({path:join(OUT,key+'.png')});
  check(key+' no runtime errors',!errors.length);
  await ctx.close();
 }
 if(geometry.length)await writeFile(join(OUT,'geometry.json'),JSON.stringify(geometry,null,2)+'\n');
 if(!process.env.ANALYTICS_PROOF_ONLY){
  if(!process.env.ANALYTICS_FALLBACK_ONLY)for(const size of sizes){
   const {ctx,page,errors}=await context(size,{reduced:true,theme:'dark',fixedTime,deviceScaleFactor:1});
   await ctx.route('**/rest/v1/rpc/analytics_stage_totals',route=>json(route,{version:'analytics-stage-totals/v1',stages:[{stage:'view',value:40},{stage:'content',value:18},{stage:'checkout',value:3},{stage:'purchase',value:2}],accounts:{made_an_account:4,confirmed_the_email:3},completeness:{status:'observed_complete'}}));
   await ctx.route('**/v1/analytics/audience-science?*',route=>json(route,{version:'audience-science/v2',totals:{music_listeners:18},profiles:[],measurement:{metric_version:'audience-science/v2',window:{since:'2026-10-19T12:00:00Z',until:fixedTime,timezone:'UTC'},snapshot:{watermark:null},completeness:{status:'partial',datasets:{events:{status:'limit_reached',rows:50000,limit:50000}}}}}));
   await page.goto(BASE+'/control.html#analytics',{waitUntil:'domcontentloaded'});check(size.width+' globe with partial response',await settle(page));await page.waitForFunction(()=>window.CR.analytics.state.loaded);
   check(size.width+' partial response visible',await page.locator('.cra-top').innerText().then(t=>t.includes('Partial data')));
   const earth=await page.locator('[data-cra-globe]').evaluate(el=>{el.dataset.testIdentity='same-earth';return el.querySelectorAll('canvas').length;});
   check(size.width+' one globe canvas',earth===1);
   check(size.width+' canonical view stage feeds Arrived',await page.locator('.cu-funnel>div').first().innerText().then(t=>/Arrived\s+40/.test(t)));
   await page.locator('[data-cra-pill] [data-cra-filters]').focus();await page.keyboard.press('Enter');
   check(size.width+' filter opens with keyboard focus',await page.locator('[data-cra-filter-sheet] [data-cra-filters]').evaluate(el=>el===document.activeElement));await page.keyboard.press('Escape');
   check(size.width+' Escape returns focus to filter trigger',await page.locator('[data-cra-pill] [data-cra-filters]').evaluate(el=>el===document.activeElement)&&await page.locator('[data-cra-filter-sheet]').isHidden());
   await page.locator('[role=tab][data-cra-sec="audience"]').click();
   check(size.width+' stages use whole-window devices',await page.locator('.cad-body').innerText().then(t=>t.includes('Stage activity')&&t.includes('Distinct devices across the whole selected window')&&t.includes('Purchase reports')&&!t.includes('Conversion funnel')));
   await page.locator('#craCountry').selectOption('US');await page.waitForFunction(()=>window.CR.analytics.state.geoAudience?.data?.totals.visitors===18);
   check(size.width+' card and map share selection',await page.evaluate(()=>{const A=window.CR.analytics,p=A.projection();return p.geography.country==='US'&&p.window.bounds==='[since,until)'&&p.snapshot.watermark===null&&A.geo.payload().context.selection_key===p.selection_key&&document.querySelector('[data-cra-projection]').dataset.craProjection===p.selection_key;}));
   check(size.width+' country selection preserves the globe',await page.locator('[data-cra-globe]').getAttribute('data-test-identity')==='same-earth');
   const w=await widths(page);check(size.width+' scoped partial view no overflow',w.scrollW===w.clientW);
   await page.locator('#craCountry').selectOption('');
   await page.screenshot({path:join(OUT,'partial-'+size.width+'.png')});
   await page.evaluate(()=>window.dispatchEvent(new CustomEvent('mcc:auth-changed',{detail:{signed_in:false}})));
   check(size.width+' sign-out removes private datasets',await page.evaluate(()=>{const A=window.CR.analytics;return A.state.revoked&&A.state.sites.length===0&&A.state.data.identity.journeys===undefined&&A.state.data.stageTotals===null;}));
   check(size.width+' no runtime errors after sign-out',!errors.length);
   await ctx.close();
  }
  const {ctx,page,errors}=await context(sizes[0],{reduced:true,theme:'dark',fixedTime,deviceScaleFactor:1});
  await ctx.addInitScript(()=>{const native=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return /webgl/i.test(kind)?null:native.call(this,kind,...args);};});
  await page.goto(BASE+'/control.html#analytics',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.CR.analytics.state.loaded);await page.waitForFunction(()=>document.querySelector('[data-crg-msg]')?.textContent.includes('WebGL unavailable'));
  check('no-WebGL removes third-party error overlay',await page.locator('.cesium-widget-errorPanel').count()===0);
  check('no-WebGL accessible explanation',await page.locator('[data-crg-msg]').getAttribute('role')==='status');
  await page.locator('[role=tab][data-cra-sec="audience"]').focus();await page.keyboard.press('Enter');await page.locator('#craCountry').selectOption('US');await page.waitForFunction(()=>window.CR.analytics.state.geoAudience?.data?.totals.visitors===18);
  check('no-WebGL country list and cards remain usable',await page.locator('.cad-body').innerText().then(t=>/unique visitors\s+18/i.test(t)));
  await page.screenshot({path:join(OUT,'no-webgl-390.png')});const unexpected=errors.filter(e=>!e.startsWith('Error constructing CesiumWidget.')||!e.includes('The browser supports WebGL, but initialization failed.'));console.log('Expected no-WebGL diagnostics: '+(errors.length-unexpected.length));check('no-WebGL no unexpected runtime errors: '+JSON.stringify(unexpected),!unexpected.length);await ctx.close();
 }
 console.log('PASS '+checks+' assertions');
}finally{await browser.close();server.close();}
