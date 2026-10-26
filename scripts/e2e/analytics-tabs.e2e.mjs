/* Every Analytics chapter and its secondary controls, with synthetic data only.
   Run with the same PLAYWRIGHT_DIR, CESIUM_DIR and CHROMIUM_PATH as analytics-unified. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {context,settle,widths,browser,server,BASE,OUT,json} from './analytics-unified.e2e.mjs';
const checks=[];
function check(name,ok,detail){checks.push({name,pass:!!ok});console.log(`${ok?'PASS':'FAIL'} ${name}`);assert.ok(ok,name+' '+JSON.stringify(detail||''));}
const tabs=['Overview','Audience','Journeys','Content','Action & business','World intelligence','Cameras','Adaptive','Site health','Data explorer','Setup'];
const songs=Array.from({length:26},(_,i)=>({track:'Fixture track '+(i+1),album:'Audit album',listeners:35-i,starts:70-i*2,repeat_listeners:12,plays_per_listener:2,last_touch_accounts:2,assisted_accounts:3}));
const journeys=Array.from({length:65},(_,i)=>({first_name:'Fixture',last_name:'Account '+(i+1),created_at:new Date(Date.now()-i*60000).toISOString(),source:i%2?'direct':'fixture',last_track:songs[i%26].track,country:'US',assisted_tracks:[],email:'fixture'+i+'@example.test'}));
try{
for(const width of [390,820,1024,1440]){
 const scope=String(width),{ctx,page,errors,calls}=await context({width,height:width===390?844:1000},{deviceScaleFactor:1});
 let cameraFail=true,archiveFail=false;
 await ctx.route('https://api.mccluster.org/v1/seek-first/readiness',route=>json(route,{database_schema_ready:true}));
 await ctx.route('https://api.mccluster.org/v1/seek-first/records?**',route=>archiveFail?json(route,{error:'Stored event read unavailable'},503):json(route,{records:[
  {kind:'event',record_type:'earthquake',name:'Stored earthquake',observed_at:new Date().toISOString(),properties:{magnitude:3}},
  {kind:'entity',record_type:'station',name:'Stored station',observed_at:new Date().toISOString(),properties:{}},
  {kind:'observation',record_type:'temperature',name:'Stored temperature',observed_at:new Date().toISOString(),properties:{value_number:0,unit:'C'}}
 ]}));
 await ctx.route('https://api.mccluster.org/v1/seek-first/ingestion-runs?**',route=>json(route,{runs:[]}));
 await ctx.route('https://api.mccluster.org/v1/analytics/identity?**',route=>json(route,{coverage:{accounts:65,bridged_accounts:65,attributed_accounts:65},journeys,tracks:songs}));
 await ctx.route('https://api.mccluster.org/v1/analytics/event-inventory',route=>json(route,{ok:true,measured_at:new Date().toISOString(),summary:{names:173,unclassified_names:1,unclassified_events:4,mismatched_names:0},rows:Array.from({length:173},(_,i)=>({name:'audit_event_'+String(i).padStart(3,'0'),raw_total:i+1,lean_total:i+1,recent_24h:1,recent_7d:3,taxonomy_stage:'view',taxonomy_note:'Synthetic event for layout checks',first_seen_at:new Date().toISOString()})),providers:{instagram:{reauthorization_required:true,status:'reauthorization_required',connected_accounts:1,imported_posts:0,metric_snapshots:0}}}));
 await ctx.route('https://api.mccluster.org/v1/analytics/cameras',route=>cameraFail?json(route,{error:'Halo connection is not configured'},503):json(route,{ok:true,catalog_count:3,stale_count:0,retrieved_at:new Date().toISOString(),packs:[{name:'Test provider',cameras:3,status:'ok'}],cameras:[1,2,3].map(id=>({id:String(id),name:'Camera '+id,pack:'Test provider'}))}));
 await ctx.route('https://api.mccluster.org/v1/analytics/experience?**',route=>json(route,{totals:{decisions:30,impressions:20,visible:10,interactions:4,outcomes:0},registry:{policies:[{key:'control-order',version:'v1',plane:'production',mode:'promoted',algorithm:'identity_order',enabled:true}],experiments:[],research_projects:[]},recent:[{id:'fixture-1',created_at:new Date().toISOString(),surface:'music.next_step',policy:'control-order@v1',eligible_count:26,selected:songs.map(s=>({id:s.track})),events:[{name:'experience_impression'}]}]}));
 await ctx.route('https://api.mccluster.org/v1/analytics/sessions?**',route=>json(route,{ok:true,total:1,counts:{all:1,visitors:1},sessions:[{session_id:'audit-session',started_at:new Date().toISOString(),duration_s:45,events:3,pages:['/audit'],country:'US'}]}));
 await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/rest/v1/rpc/analytics_content',route=>json(route,songs));
 await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/rest/v1/events_lean?**',route=>json(route,[{at:new Date().toISOString(),name:'page_view',path:'/audit',is_bot:false}]));
 await page.goto(BASE+'/control.html#analytics',{waitUntil:'domcontentloaded'});
 await settle(page);await page.waitForFunction(()=>window.CR.analytics.state.loaded);
 for(const name of tabs){
  await page.getByRole('tab',{name,exact:true}).click();
  await page.getByRole('tabpanel',{name,exact:true}).waitFor();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const w=await widths(page);check(scope+' '+name+' viewport fits',w.scrollW===w.clientW,w);
  const body=await page.locator('.cad-body').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth,height:el.clientHeight,text:el.innerText.length}));
  check(scope+' '+name+' bounded readable panel',body.scroll<=body.client+1&&body.height>100&&body.text>20,body);
  for(const nested of [false,true]){
   await page.locator('.cad-body').evaluate((el,n)=>el.style.maxWidth=n?'340px':'',nested);
   const metrics=await page.locator('.cad-body').evaluate(el=>[...el.querySelectorAll('.cra-kpi strong,.cu-fact>strong')].filter(x=>x.getClientRects().length).map(x=>{const r=document.createRange();r.selectNodeContents(x);return {text:x.textContent,fit:x.scrollWidth<=x.clientWidth+1,lines:r.getClientRects().length};}));
   check(scope+' '+name+(nested?' nested':'')+' metric values stay readable',metrics.every(x=>x.fit&&x.lines===1),metrics);
  }
  await page.locator('.cad-body').evaluate(el=>el.style.maxWidth='');
  const selected=await page.getByRole('tab',{name,exact:true}).evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===el||el.contains(hit);});
  check(scope+' '+name+' tab is not covered',selected);
  await page.screenshot({path:OUT+'/'+scope+'-'+name.toLowerCase().replace(/[^a-z]+/g,'-')+'.png'});
  await page.locator('.cad-body').evaluate(el=>el.scrollTop=el.scrollHeight);
  await page.screenshot({path:OUT+'/'+scope+'-'+name.toLowerCase().replace(/[^a-z]+/g,'-')+'-end.png'});
  await page.locator('.cad-body').evaluate(el=>el.scrollTop=0);
 }
 // Overview shortcuts, keyboard navigation, scroll restoration and shared actions.
 await page.getByRole('tab',{name:'Overview',exact:true}).click();
 await page.getByRole('button',{name:/Unique visitors:.*Open details/}).click();check(scope+' visitor metric opens Audience',await page.getByRole('tabpanel',{name:'Audience',exact:true}).isVisible());
 const ticks=await page.locator('.cra-chart--hourly .cra-axis--x').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,right:r.right,text:el.textContent};}));
 check(scope+' hourly labels do not overlap',ticks.length===24&&ticks.every((t,i)=>!i||t.x>=ticks[i-1].right-1),ticks);
 const values=await page.locator('.cra-chart--hourly .cra-axis:not(.cra-axis--x)').allTextContents();check(scope+' small-count axis has unique ticks',values.length>=2&&new Set(values).size===values.length,values);
 await page.getByRole('tab',{name:'Audience',exact:true}).press('End');
 check(scope+' End reaches Setup',await page.getByRole('tabpanel',{name:'Setup',exact:true}).isVisible());
 await page.getByRole('tab',{name:'Setup',exact:true}).press('Home');check(scope+' Home reaches Overview',await page.getByRole('tabpanel',{name:'Overview',exact:true}).isVisible());
 await page.getByRole('button',{name:'Inspect data connections',exact:true}).click();check(scope+' data status opens Connections',await page.getByRole('heading',{name:'Data connections',exact:true}).isVisible());
 // Journey controls must expose rows beyond the former hard cap of sixty.
 await page.getByRole('tab',{name:'Journeys',exact:true}).click();
 check(scope+' all journey songs remain available',await page.locator('.cra-table tbody tr').count()===26);
 check(scope+' journey first page',await page.locator('.cra-acct').count()===30);
 await page.getByRole('button',{name:'Show more accounts',exact:true}).click();await page.getByRole('button',{name:'Show more accounts',exact:true}).click();
 check(scope+' every returned account is reachable',await page.locator('.cra-acct').count()===65);
 await page.locator('[data-cra-path]').first().click();check(scope+' path filters accounts',await page.locator('.cra-acct').count()<65);
 await page.getByRole('button',{name:'Show everyone',exact:true}).click();check(scope+' path filter clears',await page.locator('.cra-acct').count()===30);
 // Content selection and readable keyboard-scrollable wide tables.
 await page.getByRole('tab',{name:'Content',exact:true}).click();await page.locator('.cra-reach__row[data-cra-pick]').nth(1).click();
 check(scope+' track selection updates readout',(await page.locator('.cra-reach__name').innerText()).includes('Fixture track 2'));
 check(scope+' wide table is keyboard reachable',await page.locator('.cra-scroll').evaluateAll(els=>els.every(el=>el.scrollWidth<=el.clientWidth+2||el.tabIndex===0)));
 // Stored events and observations must not disappear behind entity-only reads.
 await page.getByRole('tab',{name:'World intelligence',exact:true}).click();
 await page.locator('#cuSourceSearch').fill('Geological');check(scope+' source search updates immediately',await page.locator('[data-cu-source]').count()===1);
 await page.locator('[data-cu-source]').click();await page.getByRole('button',{name:'Read stored records',exact:true}).click();await page.waitForFunction(()=>!CR.analyticsUnified.state.reading);
 check(scope+' archive includes all stored record kinds',await page.locator('.cu-records details').count()===3);
 await page.locator('.cu-records details').last().locator('summary').click();
 check(scope+' measurement details preserve zero and type',(await page.locator('.cu-records').innerText()).includes('temperature')&&(await page.locator('.cu-records').innerText()).includes('"value_number": 0'));
 archiveFail=true;await page.getByRole('button',{name:'Read stored records',exact:true}).click();await page.waitForFunction(()=>!CR.analyticsUnified.state.reading);
 check(scope+' failed archive clears stale records',await page.locator('.cu-records details').count()===0&&(await page.locator('.cad-body').innerText()).includes('Stored event read unavailable'));
 // Event dictionary: all rows, inline details, instant search with retained focus.
 await page.getByRole('tab',{name:'Data explorer',exact:true}).click();await page.getByRole('button',{name:'Events',exact:true}).click();await page.locator('#cuEventQuery').waitFor();
 check(scope+' dictionary starts with fifty',await page.locator('details.cu-dataset-row').count()===50);
 for(let i=0;i<3;i++)await page.getByRole('button',{name:'Show more event names',exact:true}).click();
 check(scope+' every event name is reachable',await page.locator('details.cu-dataset-row').count()===173);
 await page.locator('#cuEventQuery').fill('audit_event_172');check(scope+' event search updates without blur',await page.locator('details.cu-dataset-row').count()===1);
 check(scope+' event search keeps focus',await page.locator('#cuEventQuery').evaluate(el=>el===document.activeElement));
 await page.locator('details.cu-dataset-row summary').click();
 const eventBox=await page.locator('details.cu-dataset-row').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,display:getComputedStyle(el).display}));
 check(scope+' expanded event detail fills its row',eventBox.display==='block'&&eventBox.scroll<=eventBox.width,eventBox);
 await page.screenshot({path:OUT+'/'+scope+'-event-detail.png'});
 await page.getByRole('button',{name:'Datasets',exact:true}).click();await page.locator('#cuDatasetSearch').fill('Evidence');check(scope+' dataset search updates immediately',await page.locator('[data-cu-dataset]').count()===1);
 await page.getByRole('button',{name:'Field directory',exact:true}).click();await page.locator('#cuFieldSearch').fill('analytics_site_daily');check(scope+' field search updates immediately',(await page.locator('.cu-records').innerText()).includes('analytics_site_daily'));
 // Setup is checked without creating production properties; browser validity and a read-only pulse.
 await page.getByRole('tab',{name:'Setup',exact:true}).click();await page.getByRole('button',{name:'Test installation',exact:true}).click();await page.waitForFunction(()=>!window.CR.analytics.state.pulseLoading);
 check(scope+' installation test reports receipt',(await page.locator('.cad-body').innerText()).includes('Receiving data'));
 check(scope+' installation list uses a full row',await page.locator('.cra-card .cra-live').evaluate(el=>getComputedStyle(el).display==='grid'));
 await page.locator('[name=site_name]').fill('');await page.getByRole('button',{name:'Add website',exact:true}).click();check(scope+' empty property submission blocked',await page.locator('[name=site_name]').evaluate(el=>!el.validity.valid));
 // On-demand camera failure and recovery, image decoding, provider selection.
 await page.getByRole('tab',{name:'Cameras',exact:true}).click();await page.getByRole('button',{name:'Load camera catalog',exact:true}).click();await page.getByRole('alert').filter({hasText:'Halo connection'}).waitFor();
 check(scope+' camera connection error visible',await page.getByRole('button',{name:'Load camera catalog',exact:true}).isEnabled());cameraFail=false;
 await page.getByRole('button',{name:'Load camera catalog',exact:true}).click();await page.getByRole('button',{name:'Test provider',exact:true}).click();await page.getByRole('button',{name:'Verify this provider',exact:true}).click();await page.waitForFunction(()=>!window.CR.analyticsCameras.state.running);
 check(scope+' camera verification rejects invalid images',await page.evaluate(()=>Object.values(window.CR.analyticsCameras.state.checks).filter(c=>c.status==='verified').length===1));
 await page.screenshot({path:OUT+'/'+scope+'-camera-result.png'});
 // The four health views and search all mount independently.
 await page.getByRole('tab',{name:'Site health',exact:true}).click();
 for(const name of ['Sessions','Visitors','Flows','Errors']){await page.locator('.crf-seg').getByRole('tab',{name,exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.crf-item--ghost'));check(scope+' health '+name+' renders',(await page.locator('.crf-list').innerText()).length>20);}
 check(scope+' no JavaScript errors',errors.length===0,errors);
 await ctx.close();
}
}finally{await writeFile(OUT+'/checks.json',JSON.stringify(checks,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
