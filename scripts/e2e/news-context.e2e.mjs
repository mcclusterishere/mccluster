/* Actual private Control UI with synthetic news/indicator responses. All network
   requests are intercepted; no provider, production row or account is used. */
import {createRequire} from 'node:module';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, join, extname, sep} from 'node:path';
import assert from 'node:assert/strict';
import {CONTEXT_INDICATORS} from '../../workers/mccluster/src/intel/news-context-indicators.js';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/news-context-ui-proof';
const HOUSE='https://matthew.mccluster.org',API='https://api.mccluster.org';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
const results=[];
await mkdir(OUT,{recursive:true});
function check(name,ok,detail){results.push({name,pass:!!ok});console.log((ok?'PASS ':'FAIL ')+name+(ok?'':' '+JSON.stringify(detail)));assert.ok(ok,name);}
const json=(route,value,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(value)});
const STORY='22222222-2222-4222-8222-222222222222';
const generated='2026-10-17T16:00:00.000Z';
function response(economy='US',partial=false){
  const indicators=CONTEXT_INDICATORS.map((spec,i)=>({...spec,latest:i===13?null:{period:'2024',value:i===0?2.875123456:i+10},previous:i===13?null:{period:'2022',value:i+8},change:i===13?null:{value:i===0?-5.124876544:2,unit:spec.delta_unit,from_period:'2022',to_period:'2024',period_gap_years:2},observation_age_years:i===13?null:2,freshness:i===13?'no_observation':'annual_context'}));
  const story={id:STORY,title:'Inflation and jobs in a fixture country',url:'https://example.test/story',publisher:'Fixture publisher',seen_at:'2026-10-16T12:00:00Z',imported_at:'2026-10-16T12:10:00Z',geography:{country_iso:economy,country_fips:'US',place:'Fixture city',lat:41.3,lon:-72.9,basis:'automated_place_mention'},topics:[{key:'prices',label:'Prices',terms:['inflation']}],summary:'The ingested headline mentions prices. Annual country observations provide background context.',indicator_ids:[indicators[2].id],comparisons:partial?[]:[indicators[2]],nearby_events:[],spatial_coverage:'empty_archive',limitations:['A place mention does not establish the event location.']};
  return {ok:true,schema:'news-context/v1',generated_at:generated,economy,country_name:economy==='US'?'United States':'United Kingdom',window:{since:'2026-10-14T16:00:00Z',until:generated,hours:72},coverage:{news_status:'available',news_returned:1,news_sample_limit:12,news_has_more:true,indicator_status:partial?'unavailable':'available',spatial_status:partial?'unavailable':'empty_archive'},sources:[{key:'gdelt',label:'Stored GDELT metadata',status:'read',detail:'Fixture ingested metadata only.',url:'https://www.gdeltproject.org/'},{key:'world_bank',label:'World Bank annual context',status:partial?'unavailable':'read',detail:partial?'Fixture upstream unavailable':'Current revision; historical availability at the news time is unknown.',retrieved_at:partial?null:generated,provider_updated_at:partial?null:'2026-10-15',url:'https://data.worldbank.org/',terms_url:'https://data.worldbank.org/summary-terms-of-use'}],indicators:partial?[]:indicators,stories:[story],limitations:['Annual national data does not measure local conditions or prove causation.']};
}
async function setup(width=390,role='owner'){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'});
  const behavior={owner:role==='owner',mode:'full',release:null},calls=[],errors=[];
  await context.addInitScript(({role})=>{
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    if(role==='guest')return;
    const exp=Math.floor(Date.now()/1000)+3600,id='11111111-1111-4111-8111-111111111111';
    localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:id,email:'fixture@invalid.test'})).replace(/=+$/,'')+'.y',refresh_token:'fixture-refresh',expires_at:exp,user:{id,email:'fixture@invalid.test'}}));
  },{role});
  await context.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname;
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(u.origin===API){
      if(p==='/v1/status')return json(route,behavior.owner?{ok:true,operator:{email:'fixture@invalid.test'}}:{error:'Forbidden'},behavior.owner?200:403);
      if(p==='/v1/intel/news-context'){
        calls.push({method:req.method(),query:Object.fromEntries(u.searchParams),authorized:!!req.headers().authorization});
        if(behavior.mode==='deferred')await new Promise(resolve=>behavior.release=resolve);
        if(behavior.mode==='failure')return json(route,{ok:false,error:'Fixture comparison unavailable',code:'unavailable'},503);
        const data=response(u.searchParams.get('economy')||'US',behavior.mode==='partial');
        if(behavior.mode==='unsafe'){data.stories[0].title='<img src=x onerror=alert(1)>';data.stories[0].url='javascript:alert(1)';}
        return json(route,data);
      }
      if(p==='/v1/workspaces/me')return json(route,{profile:{id:'11111111-1111-4111-8111-111111111111'},default_org_id:'o1',workspaces:[{org_id:'o1',slug:'mccluster',kind:'studio',name:'McCluster',role:behavior.owner?'owner':'member',enabled:true}]});
      if(p==='/v1/seek-first/sources')return json(route,{sources:[]});
      if(p==='/v1/seek-first/readiness')return json(route,{database_schema_ready:false});
      if(p==='/v1/intel/health')return json(route,{schema_ready:false,collector:{enabled:false},latest_run:null,last_successful_run:null});
      if(p==='/v1/intel/geo')return json(route,{ok:true,audience:'owner',totals:{records:0,located:0,unknown_location:0,suppressed_records:0,suppressed_buckets:0},buckets:[]});
      if(p==='/v1/analytics/business')return json(route,{ok:true,snapshot:{commerce:{available:false}}});
      if(p==='/v1/analytics/identity')return json(route,{coverage:{},journeys:[],tracks:[]});
      if(p==='/v1/analytics/visitors')return json(route,{ok:true,total:0,counts:{all:0,returning:0},visitors:[]});
      if(p==='/v1/analytics/flows')return json(route,{ok:true,flows:{}});
      if(p==='/v1/analytics/errors')return json(route,{ok:true,totals:{},errors:[],friction:[],journey:[]});
      return json(route,{ok:true});
    }
    if(u.hostname.endsWith('supabase.co')){
      if(p==='/auth/v1/user')return json(route,{id:'11111111-1111-4111-8111-111111111111',email:'fixture@invalid.test'});
      if(p==='/rest/v1/rpc/analytics_totals')return json(route,[{page_views:0,visitors:0,sessions:0,plays:0,events:0}]);
      if(p==='/rest/v1/rpc/is_admin'||p==='/rest/v1/rpc/is_ops')return json(route,behavior.owner);
      return json(route,[]);
    }
    if(u.origin===HOUSE){
      const path=resolve(ROOT,'.'+decodeURIComponent(p));
      if(path.startsWith(resolve(ROOT)+sep))try{return route.fulfill({body:await readFile(path),contentType:MIME[extname(path)]||'application/octet-stream'});}catch{}
      return route.fulfill({status:404,body:'Absent fixture asset'});
    }
    return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(HOUSE+'/control.html#analytics',{waitUntil:'domcontentloaded'});
  if(role!=='guest'){
    await page.waitForFunction(()=>!!window.CR?.analytics?.state.loaded&&!!window.MCC_BAR);
    if(role==='owner')await page.waitForFunction(()=>MCC_BAR.admin());
    await page.locator('[role=tab][data-cra-sec="intelligence"]').click();
    if(role==='owner')await page.waitForSelector('[data-nc-card]');
  }
  return {context,page,behavior,calls,errors};
}
try{
  for(const width of [390,1280]){
    const {context,page,behavior,calls,errors}=await setup(width);
    await page.waitForTimeout(150);
    check(`${width}: private card makes no news request on mount`,calls.length===0);
    await page.locator('#ncEconomy').fill('us');await page.locator('#ncCompare button').click();
    await page.waitForSelector('.nc-story');
    check(`${width}: Compare uses the authenticated country GET`,calls.length===1&&calls[0].method==='GET'&&calls[0].authorized&&calls[0].query.economy==='US'&&calls[0].query.hours==='72');
    const text=await page.locator('[data-nc-card]').innerText();
    check(`${width}: metadata scope, sample and observation dates stay explicit`,text.includes('Article text is not read')&&text.includes('2026-10-16 12:00:00 UTC')&&text.includes('more available beyond this sample')&&text.includes('event location unverified'));
    await page.locator('.nc-indicator-section summary').click();
    check(`${width}: all fourteen annual indicators are available for inspection`,await page.locator('[data-nc-indicator]').count()===14);
    const first=await page.locator('[data-nc-indicator]').first().innerText();
    check(`${width}: values, interval and missing observations are not collapsed`,first.includes('2.875123456')&&first.includes('2022 → 2024')&&first.includes('2 years')&&await page.locator('[data-nc-indicator]').last().innerText().then(t=>t.includes('Unavailable')));
    await page.locator('.nc-source-status summary').click();
    check(`${width}: provider retrieval, revision dates and source links are visible`,await page.locator('.nc-source-status').innerText().then(t=>t.includes('2026-10-17 16:00:00 UTC')&&t.includes('2026-10-15')&&t.includes('historical availability'))&&await page.locator('.nc-source-status a[href="https://data.worldbank.org/"]').count()===1);
    check(`${width}: expanded data fits the viewport`,await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth)&&await page.locator('[data-nc-card]').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    const targets=await page.locator('[data-nc-card] button,[data-nc-card] a,[data-nc-card] summary').evaluateAll(nodes=>nodes.filter(x=>x.getClientRects().length).map(x=>x.getBoundingClientRect().height));
    check(`${width}: news controls have 44px targets`,targets.length>0&&targets.every(height=>height>=44),targets);
    await page.locator('.nc-indicator-section summary').click();await page.locator('.nc-source-status summary').click();
    await page.locator('.cad-body').evaluate(el=>{el.scrollTop=0;});await page.screenshot({path:join(OUT,`news-context-${width}.png`)});
    await page.locator('[data-nc-story]').click();await page.waitForFunction(()=>!CR.newsContext.state.busy&&!!CR.newsContext.state.article);
    check(`${width}: selecting ingested metadata requests its exact story ID`,calls.at(-1).query.article_id===STORY&&!('economy' in calls.at(-1).query));
    behavior.mode='partial';await page.locator('[data-nc-country]').click();await page.waitForFunction(()=>!CR.newsContext.state.busy);
    check(`${width}: provider failure keeps news and labels indicators unavailable`,await page.locator('.nc-story').count()===1&&await page.locator('.nc-indicator-section summary').innerText()==='Annual indicators unavailable'&&await page.locator('[data-nc-indicator]').count()===0);
    behavior.mode='failure';await page.locator('#ncCompare button').click();await page.waitForSelector('[data-nc-card] [role=alert]');
    check(`${width}: failed new comparison cannot display stale results`,await page.locator('.nc-results').count()===0&&await page.locator('[data-nc-card] [role=alert]').innerText()==='Fixture comparison unavailable');
    behavior.mode='unsafe';await page.locator('#ncCompare button').click();await page.waitForSelector('.nc-story');
    check(`${width}: ingested text and links cannot inject active content`,await page.locator('.nc-story img,.nc-story a[href^="javascript:"]').count()===0&&await page.locator('.nc-story').innerText().then(t=>t.includes('<img src=x onerror=alert(1)>')));
    const count=calls.length;await page.waitForTimeout(150);check(`${width}: comparison never starts polling or saving`,calls.length===count&&calls.every(x=>x.method==='GET'));
    check(`${width}: private module has no page errors`,errors.length===0,errors);
    await context.close();
  }
  for(const role of ['guest','member']){
    const {context,page,calls}=await setup(390,role);await page.waitForTimeout(150);
    check(`${role}: owner news card and private requests remain absent`,await page.locator('[data-nc-card]').count()===0&&calls.length===0);
    await context.close();
  }
  for(const action of ['owner revocation','sign-out']){
    const {context,page,behavior}=await setup();behavior.mode='deferred';
    const pending=page.waitForRequest(r=>new URL(r.url()).pathname==='/v1/intel/news-context');
    await page.locator('#ncEconomy').fill('US');await page.locator('#ncCompare button').click();
    await pending;
    const deadline=Date.now()+5000;while(!behavior.release&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(behavior.release,'The comparison reaches its held fixture response');
    if(action==='owner revocation'){behavior.owner=false;await page.evaluate(()=>MCC_BAR.verifyAdmin());}
    else await page.evaluate(()=>MCC_AUTH.signOut());
    behavior.release();await page.waitForTimeout(150);
    check(`${action} cannot regain private data through a late response`,await page.locator('[data-nc-card]').count()===0&&await page.evaluate(()=>CR.newsContext.state.data===null&&!CR.newsContext.state.busy));
    await context.close();
  }
}finally{await writeFile(join(OUT,'results.json'),JSON.stringify(results,null,2));await browser.close();}
