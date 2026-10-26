/* Actual owner UI with synthetic identity scopes; no production reads. */
import assert from 'node:assert/strict';
import {context,settle,widths,browser,server,BASE,OUT,json} from './analytics-unified.e2e.mjs';
const A='723e4567-e89b-42d3-a456-426614174777',B='823e4567-e89b-42d3-a456-426614174888',key='u:'+A;
const stamp='2026-10-25T12:00:00Z';
const base={session_id:'mixed-fixture',device_id:'shared-device',started_at:stamp,ended_at:'2026-10-25T12:00:27Z',duration_s:27,engaged_s:25,page_views:1,clicks:1,plays:1,max_depth:100,friction:0,pages:['/listen.html'],play_metric_version:'browser-start/v3'};
const buckets=[{key:'d:shared-device',events:1},{key,events:1},{key:'u:'+B,events:1}];
const rows=[null,A,B].map((uid,i)=>({id:'event-'+i,uid,device_id:'shared-device',name:'page_view',path:'/listen.html',at:`2026-10-25T12:00:0${i}Z`,props:{title:uid===A?'Account A evidence':uid===B?'Account B evidence':'Unattributed evidence'}}));
let checks=0;const check=(ok,label)=>{assert.ok(ok,label);checks++;console.log('PASS '+label);};
try {
 for(const width of [390,820,1024,1440]){
  const {ctx,page,errors}=await context({width,height:width===1024?768:1000},{deviceScaleFactor:1});
  let fail=width===390;const detailRequests=[];
  const full={...base,uid:null,identity_status:'mixed',identity_buckets:buckets};
  await ctx.route('https://api.mccluster.org/v1/analytics/sessions?**',r=>json(r,{ok:true,total:1,counts:{all:1,identified:1},sessions:[full]}));
  await ctx.route('https://api.mccluster.org/v1/analytics/visitors?**',r=>json(r,{ok:true,total:3,counts:{all:3,identified:2},visitors:[{visitor_key:key,uid:A,display_name:'Account A fixture with a long readable label',sessions:1,events:1}]}));
  await ctx.route('https://api.mccluster.org/v1/analytics/visitors/**',r=>{
   if(fail)return json(r,{error:'Analytics identity upgrade is required before this view can load. Retry after the upgrade is available.'},503);
   const selected=decodeURIComponent(new URL(r.request().url()).pathname.split('/').at(-1)),uid=selected.slice(2);
   return json(r,{ok:true,visitor:{key:selected,uid,devices:['shared-device'],profile:{display_name:uid===A?'Account A fixture with a long readable label':'Account B fixture'},history_status:'ready',history_days:180,total:1,sessions:[{...base,uid,visitor_key:selected,identity_status:'event_bound_account'}]}});
  });
  await ctx.route('https://api.mccluster.org/v1/analytics/sessions/mixed-fixture**',r=>{
   const u=new URL(r.request().url()),scope=u.searchParams.get('visitor_key'),history=u.searchParams.has('include_history');detailRequests.push(u);
   const selected=scope?rows.filter(e=>scope==='u:'+e.uid):rows;
   return json(r,{ok:true,scope:scope?{visitor_key:scope,kind:'event_bound_subset'}:null,session:scope?{...base,uid:scope.slice(2),identity_status:'event_bound_account'}:full,events:selected,
    visitor:scope?{key:scope,uid:scope.slice(2),profile:{display_name:'Account A fixture'},history_status:history?'ready':'not_loaded',sessions:history?[{...base,visitor_key:scope}]:null,total:history?1:null}:
      {key:null,uid:null,identity_buckets:buckets,identity_status:'mixed',history_status:'choose_identity',sessions:null,total:null}});
  });
  await page.goto(BASE+'/control.html#analytics',{waitUntil:'domcontentloaded'});await settle(page);
  await page.getByRole('tab',{name:'Site health',exact:true}).click();
  await page.getByRole('tab',{name:'Visitors',exact:true}).click();await page.locator('[data-crf-visitor]').first().waitFor();
  check((await page.locator('.crf-lead').innerText()).includes('observed profiles'),width+' profile counts do not claim distinct people');
  await page.locator('[data-crf-visitor]').first().click();
  if(fail){await page.getByRole('button',{name:'Retry',exact:true}).waitFor();check(await page.locator('.crf-kpis').count()===0,'missing SQL stays an actionable failure');fail=false;await page.getByRole('button',{name:'Retry',exact:true}).click();}
  await page.locator('.crf-kpis').waitFor();
  check((await page.locator('.crf-detail').innerText()).includes('Only events recorded with this account ID'),'account history explains exact attribution');
  await page.locator('.crf-detail [data-crf-session]').first().click();await page.locator('[data-crf-history]').waitFor();
  check(detailRequests.at(-1).searchParams.get('visitor_key')===key,width+' profile-to-session link retains identity scope');
  check(await page.locator('.crf-step').count()===1,width+' scoped timeline excludes anonymous and other-account events');
  check(!(await page.locator('.crf-detail').innerText()).includes('Account B evidence'),width+' other-account activity is not presented as this account');
  await page.locator('[data-crf-history]').click();await page.waitForFunction(()=>CR.forensics.state.detail.visitor.history_status==='ready');
  check(detailRequests.at(-1).searchParams.get('visitor_key')===key,width+' lazy history retains identity scope');
  for(const nested of [false,true]){
   await page.locator('[data-crf-host]').evaluate((el,n)=>el.style.width=n?'min(100%,320px)':'',nested);
   const size=await page.locator('.crf-detail').evaluate(el=>({fit:el.scrollWidth===el.clientWidth,head:el.querySelector('.crf-dh').scrollWidth===el.querySelector('.crf-dh').clientWidth,
    cards:[...el.querySelectorAll('.crf-kpi')].map(c=>{const b=c.querySelector('b'),range=document.createRange();range.selectNodeContents(b);return {width:c.clientWidth,fit:b.scrollWidth<=b.clientWidth,lines:range.getClientRects().length};})}));
   check(size.fit&&size.head&&size.cards.length===7&&size.cards.every(c=>c.width>=140&&c.fit&&c.lines===1),width+(nested?' nested':'')+' scoped metrics remain readable '+JSON.stringify(size));
   const w=await widths(page);check(w.scrollW===w.clientW,width+' viewport fits');
   await page.locator('.crf-dh').scrollIntoViewIfNeeded();await page.screenshot({path:OUT+`/visitor-scope-${width}${nested?'-nested':''}.png`});
  }
  await page.getByRole('button',{name:'View whole session',exact:true}).click();await page.getByRole('heading',{name:'Mixed identity session',exact:true}).waitFor();
  check(await page.locator('.crf-step').count()===3,width+' whole session preserves all raw scopes');
  check(await page.locator('.crf-detail [data-crf-visitor]').count()===3,width+' mixed identity offers explicit scope choices');
  check(await page.locator('[data-crf-history]').count()===0,width+' mixed session does not load guessed account history');
  await page.locator('[data-crf-back]').click();await page.getByRole('button',{name:'View whole session',exact:true}).waitFor();
  check(detailRequests.at(-1).searchParams.get('visitor_key')===key,width+' back restores scoped session');
  await page.locator('[data-crf-close]').click();check(await page.locator('.crf-detail').count()===0,width+' close returns to profile list');
  check(errors.length===0,width+' no browser errors '+errors.join(';'));await ctx.close();
 }
 console.log(`${checks} visitor evidence browser checks passed`);
}finally{await browser.close();server.close();}
