/* Real Control UI, synthetic sessions only. Run with analytics-unified's environment. */
import assert from 'node:assert/strict';
import {context,settle,widths,browser,server,BASE,OUT,json} from './analytics-unified.e2e.mjs';
const message="ReferenceError: Can't find variable: _AutofillCallbackHandler";
const session={session_id:'diagnostic-fixture',started_at:'2026-10-25T12:00:00Z',ended_at:'2026-10-25T12:00:27Z',duration_s:27,engaged_s:25,page_views:1,clicks:1,plays:1,max_depth:100,friction:3,errors:2,user_agent:'Mozilla/5.0 (iPad) Instagram 330',display_name:'A visitor with a deliberately long display name',pages:['/album.html']};
const events=[['page_view',{}],['js_error',{msg:message,src:'https://matthew.mccluster.org/?utm_source=ig',origin:'injected',iab:'instagram'}],['js_error',{msg:'Checkout failed',origin:'site'}],['play_failed',{track:'Fixture song',error:'NotAllowedError'}],['music_play',{track:'Fixture song'}]].map(([name,props],i)=>({name,props,path:'/album.html',at:`2026-10-25T12:00:0${i}Z`}));
let checks=0;
function check(ok,label){assert.ok(ok,label);checks++;console.log('PASS '+label);}
try {
 for(const width of [390,820,1024,1440]){
  const {ctx,page,errors}=await context({width,height:width===1024?768:1000},{deviceScaleFactor:1});
  await ctx.route('https://api.mccluster.org/v1/analytics/sessions?**',r=>json(r,{ok:true,total:1,counts:{all:1},sessions:[session]}));
  await page.goto(BASE+'/control.html#analytics',{waitUntil:'domcontentloaded'});await settle(page);
  await page.getByRole('tab',{name:'Site health',exact:true}).click();
  await page.waitForSelector('[data-crf-session]');
  // Mount the actual detail renderer and bind its raw, jump and back controls.
  await page.evaluate(({session,events})=>{
   const f=window.CR.forensics;f.state.stack=[{type:'session',id:session.session_id}];f.state.detail={session,events,visitor:{key:'fixture',sessions:[]}};
   f.mount(document.querySelector('[data-crf-host]'),{range:f.state.range});
  },{session,events});
  for(const nested of [false,true]){
   await page.locator('[data-crf-host]').evaluate((el,n)=>{el.style.width=n?'min(100%, 320px)':'';},nested);
   const scope=width+(nested?' narrow':'');
   const measurement=await page.locator('.crf-detail').evaluate(el=>({fit:el.scrollWidth===el.clientWidth,cards:[...el.querySelectorAll('.crf-kpi')].map(card=>{const b=card.querySelector('b'),small=card.querySelector('small'),range=document.createRange();range.selectNodeContents(b);return {w:card.clientWidth,fit:b.scrollWidth<=b.clientWidth,lines:range.getClientRects().length,label:small.scrollWidth<=small.clientWidth};}),head:el.querySelector('.crf-dh').scrollWidth<=el.querySelector('.crf-dh').clientWidth}));
   check(measurement.fit,scope+' detail fits '+JSON.stringify(measurement));
   check(measurement.cards.length===7&&measurement.cards.every(c=>c.w>=140&&c.fit&&c.lines===1&&c.label),scope+' seven readable metrics');
   check(measurement.head,scope+' header fits');
   check(await page.locator('.crf-step--diagnostic').count()===1,scope+' diagnostic neutral and visible');
   check(await page.locator('.crf-step--friction').count()===2,scope+' real error and playback failure stay red');
   check((await page.locator('.crf-sec').filter({has:page.getByRole('heading',{name:/Where it went wrong/})}).innerText()).includes('2'),scope+' only actionable trouble counted');
   await page.locator('.crf-step--diagnostic button').click();
   check((await page.locator('.crf-raw').innerText()).includes('utm_source=ig'),scope+' raw evidence expands');
   await page.locator('.crf-step--diagnostic button').click();
   const w=await widths(page);check(w.scrollW===w.clientW,scope+' viewport fits');
   await page.locator('.crf-dh').scrollIntoViewIfNeeded();
   await page.screenshot({path:OUT+`/health-${width}${nested?'-nested':''}.png`});
  }
  await page.locator('[data-crf-back]').click();check(await page.locator('.crf-detail').count()===0,width+' back returns to sessions');
  check(errors.length===0,width+' no unexpected browser errors '+errors.join(';'));
  await ctx.close();
 }
 console.log(`${checks} site-health checks passed`);
} finally {await browser.close();server.close();}
