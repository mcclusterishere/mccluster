/* Control Room: six sections from one NAV, browser proof. Real control.html and
   modules from this checkout; EVERY network call is a synthetic fixture (sample
   names, no production data). At 390, 820 and 1280 px it proves: each of the six
   sections renders; the sidebar / phone bar, the More sheet and the ⌘K palette are
   all drawn from window.CR.nav; old routes (#work:*, #create:*, #ai, #analytics,
   #system:*, #apps and the old routers' aliases) land on their new view; a mount
   point renders "not available yet"; there is no horizontal overflow and no
   console error. Screenshots of each section at 390 and 1280 go to OUT.
   PLAYWRIGHT_DIR=<node_modules> [CHROMIUM_EXECUTABLE=…] node scripts/e2e/control-room-nav.e2e.mjs [outDir] */
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/control-room-nav-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const BASE='https://matthew.mccluster.org';
const TYPES={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
const OWNER='11111111-1111-4111-8111-111111111111';
const results=[];
function check(scope,name,condition,detail){results.push({scope,name,pass:!!condition});console.log((condition?'PASS ':'FAIL ')+'['+scope+'] '+name+(condition?'':' '+JSON.stringify(detail??null)));}
await mkdir(OUT,{recursive:true});
const json=(route,body,status=200,headers={})=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-expose-headers':'content-range',...headers},body:JSON.stringify(body)});
const ago=s=>new Date(Date.now()-s*1000).toISOString();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});

/* Sample records only. */
const THREADS=[
  {id:'t1',mode:'human',channel:'instagram',updated_at:ago(7200),last_inbound_at:ago(7200),last_outbound_at:ago(86400*3),comms_contacts:{display_name:'Jordan P. (sample)',address:'@sample.jordan'}},
  {id:'t2',mode:'assistant',channel:'email',updated_at:ago(10800),last_inbound_at:ago(10800),last_outbound_at:ago(86400),comms_contacts:{display_name:'Riley T. (sample)',address:'riley@example.invalid'}},
  {id:'t3',mode:'assistant',channel:'site',updated_at:ago(86400),last_inbound_at:ago(90000),last_outbound_at:ago(86400),comms_contacts:{display_name:'Lee B. (sample)',address:'site visitor'}}
];
const LEADS=[
  {id:'l1',name:'Sample buyer 14',email:'b14@example.invalid',campaign:'print-shop',want:'Print 12×18 · Night Shift',note:'$35',status:'new',at:ago(14400)},
  {id:'l2',name:'Riley T. (sample)',email:'riley@example.invalid',campaign:'merch-shop',want:'Hoodie (L)',note:'$48',status:'new',at:ago(7200)},
  {id:'l3',name:'Sam M. (sample)',email:'sam@example.invalid',campaign:'portrait-booking',want:'Portrait session · Nov 14',status:'replied',at:ago(21600)},
  {id:'l4',name:'Sample buyer 22',email:'b22@example.invalid',campaign:'print-shop',want:'Print 18×24 · Low Tide',note:'$65',status:'closed',at:ago(90000)}
];
/* /v1/work/{kind} rows carry `state`, the shape workers/mccluster/src/work.js listWork returns. */
const WORK={orders:[{id:'o1',title:'Studio print bundle (sample)',amount_cents:18000,currency:'usd',state:'paid',placed_at:ago(30000)},
    {id:'o2',title:'Framed print (sample)',amount_cents:9000,currency:'usd',state:'fulfilled',placed_at:ago(200000)},
    {id:'o3',title:'Cancelled tee (sample)',amount_cents:2500,currency:'usd',state:'cancelled',placed_at:ago(300000)}],
  bookings:[{id:'b1',title:'Portrait session (sample)',state:'confirmed',starts_at:ago(-86400*14),location:'Studio',created_at:ago(40000)},
    {id:'b2',title:'Event shoot (sample)',state:'completed',starts_at:ago(86400*5),location:'Hall',created_at:ago(86400*9)}],
  renewals:[{id:'r1',title:'Studio membership · Sample member 07',cadence:'monthly',state:'lapsed',amount_cents:2500,currency:'usd',renews_at:ago(86400)},
    {id:'r2',title:'Hosting (sample)',cadence:'annual',state:'upcoming',amount_cents:12000,currency:'usd',renews_at:ago(-86400*30)}],
  payments:[{id:'p1',title:'Site retainer (sample)',state:'failed',amount_cents:50000,currency:'usd',provider:'manual'},
    {id:'p2',title:'Logo work (sample)',state:'paid',amount_cents:30000,currency:'usd',provider:'manual'}],
  companies:[],tasks:[],relationships:[],projects:[],deliverables:[]};
const MUSIC_FIRST=[{id:'m1',amount_cents:1000,currency:'usd',status:'paid',customer_email:'fan203@example.invalid',metadata:{track_title:'Album download · I AM HERE'},paid_at:ago(28800),created_at:ago(28800)}];

async function setup(viewport){
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:viewport.width<1000,ignoreHTTPSErrors:true,serviceWorkers:'block'});
  const errors=[];
  /* music_orders: the first read fails, later reads return whatever MUSIC holds now, so the test can prove Refresh refetches */
  const music={calls:0,rows:MUSIC_FIRST.slice()};
  await ctx.addInitScript(({OWNER})=>{
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    const exp=Math.floor(Date.now()/1000)+3600;
    localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:OWNER,email:'owner@fixture.invalid'})).replace(/=+$/,'')+'.y',refresh_token:'fixture-only',expires_at:exp,user:{id:OWNER,email:'owner@fixture.invalid'}}));
  },{OWNER});
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname;
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(u.origin==='https://api.mccluster.org'){
      if(p==='/health')return json(route,{ok:true});
      if(p==='/v1/status')return json(route,{ok:true,operator:{email:'owner@fixture.invalid'},database:{reachable:true}});
      if(p==='/v1/workspaces/me')return json(route,{ok:true,profile:{id:OWNER},default_org_id:'o1',workspaces:[{org_id:'o1',slug:'mccluster',kind:'studio',role:'owner',enabled:true,name:'McCluster'}]});
      if(p==='/v1/comms/threads')return json(route,{ok:true,threads:THREADS});
      const work=p.match(/^\/v1\/work\/([a-z]+)$/);
      if(work&&req.method()==='GET')return json(route,{[work[1]]:WORK[work[1]]||[]});
      return json(route,{ok:true,threads:[],apps:[],events:[],jobs:[],tools:[],decisions:[],leads:[],total:0});
    }
    if(u.hostname.endsWith('supabase.co')){
      if(p==='/auth/v1/user')return json(route,{id:OWNER,email:'owner@fixture.invalid'});
      if(p==='/rest/v1/leads')return json(route,LEADS,200,{'content-range':'0-3/4'});
      if(p==='/rest/v1/music_orders'){music.calls++;return music.calls===1?json(route,{message:'fixture outage'},503):json(route,music.rows);}
      return json(route,[]);
    }
    if(u.origin===BASE){
      const rel=p==='/'?'index.html':decodeURIComponent(p.replace(/^\//,''));const file=resolve(ROOT,rel);
      if(!file.startsWith(resolve(ROOT)+sep))return route.abort();
      try{return route.fulfill({body:await readFile(file),contentType:TYPES[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
    }
    return route.abort();
  });
  const page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource|net::ERR_FAILED/.test(m.text()))errors.push(m.text().slice(0,200));});
  return {ctx,page,errors,music};
}
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
async function settle(page){await page.waitForFunction(()=>window.CR&&window.CR.nav&&!document.getElementById('crApp').hidden&&document.getElementById('crSurface').childElementCount>0,null,{timeout:20000});await page.waitForTimeout(600);}
async function goto(page,hash){await page.evaluate(h=>{location.hash=h;},hash);await page.waitForFunction(h=>{const want=CR.nav.resolve(h).entry.leaf.route;return document.getElementById('crSurface').getAttribute('data-cr-route')===want&&location.hash===want;},hash,{timeout:15000});await page.waitForTimeout(500);}

const SECTIONS=['home','people','sell','create','insights','system'];
const OLD=[['#work:inbox','#people:inbox:conversations'],['#work:desk-bot','#people:inbox:ai-reply'],['#work:crm','#people:deals:pipeline'],['#work:people','#people:contacts'],['#work:operations','#sell:store:operations'],['#work:payments','#sell:payments:payments'],
  ['#create:music','#sell:music:catalog'],['#create:build','#system:build'],['#create:library','#create:projects:library'],['#create:socials','#create:publish:channels'],['#create:funding','#system:uprise:funding'],
  ['#ai','#home:ask'],['#apps','#system:apps'],['#system:logs','#system:observability'],['#home','#home:today'],['#analytics','#insights:overview']];

try{
  for(const vp of [{width:390,height:844},{width:820,height:1180},{width:1280,height:860}]){
    const scope=vp.width+'px';
    const {ctx,page,errors,music}=await setup(vp);
    await page.goto(BASE+'/control.html#home',{waitUntil:'domcontentloaded'});
    await settle(page);
    check(scope,'#home lands on Home → Today',await page.evaluate(()=>location.hash)==='#home:today');

    /* the nav element is drawn from NAV */
    const nav=await page.evaluate(()=>({
      sections:[...document.querySelectorAll('#crSections [data-section]')].map(a=>a.dataset.section),
      subs:[...document.querySelectorAll('#crSections .cr-sections__subs a')].map(a=>a.getAttribute('href')),
      expected:CR.nav.NAV.map(s=>s.id),expectedSubs:CR.nav.NAV.flatMap(s=>s.items.map(i=>i.route)),
      phone:[...document.querySelectorAll('#crSections li.is-phone [data-section]')].filter(a=>a.getBoundingClientRect().width>0).map(a=>a.dataset.section),
      more:!!document.getElementById('crMore')}));
    check(scope,'sidebar / bar sections come from NAV',JSON.stringify(nav.sections)===JSON.stringify(nav.expected),nav);
    check(scope,'sidebar items come from NAV',JSON.stringify(nav.subs)===JSON.stringify(nav.expectedSubs));
    if(vp.width<1024)check(scope,'phone bar: Home People Sell Create + More',JSON.stringify(nav.phone)===JSON.stringify(['home','people','sell','create'])&&nav.more,nav.phone);
    else check(scope,'desktop sidebar is visible with all six sections',await page.evaluate(()=>{const n=document.getElementById('crSections');const r=n.getBoundingClientRect();return r.left===0&&r.width>200&&[...n.querySelectorAll('[data-section]')].every(a=>a.getBoundingClientRect().width>0);}));

    /* every section renders, without overflow, and is screenshotted */
    for(const s of SECTIONS){
      await goto(page,'#'+s);
      const ok=await page.evaluate(sec=>{const root=document.getElementById('crSurface');return root.getAttribute('data-cr-surface')===sec&&(sec==='insights'?!!document.getElementById('crAnalyticsMount'):!!root.querySelector('.cr-h1'));},s);
      check(scope,s+' renders',ok);
      if(s==='insights')await page.waitForTimeout(1500);
      check(scope,s+' has no horizontal overflow',await overflow(page)===0,await overflow(page));
      const active=await page.evaluate(()=>document.querySelector('#crSections .cr-sections__item.is-active')?.dataset.section||document.querySelector('#crSections #crMore.is-active')?.id);
      check(scope,s+' is the active nav section',active===s||(vp.width<1024&&['insights','system'].includes(s)&&active==='crMore'),active);
      if(vp.width===390||vp.width===1280)await page.screenshot({path:join(OUT,s+'-'+vp.width+'.png')});
    }

    /* views inside items: segmented control and item tabs */
    await goto(page,'#people:inbox:ai-reply');
    check(scope,'People → Inbox → AI reply renders the desk-bot settings',await page.locator('[data-crd]').count()===1&&await page.locator('.cr-seg--views a.is-on').textContent()==='AI reply');
    await goto(page,'#people:inbox:conversations');
    await page.locator('.cr-thread').first().click();await page.waitForTimeout(400);
    check(scope,'the conversation carries an AI reply switch',await page.locator('.cr-aireply [role="switch"]').count()===1);
    await goto(page,'#sell:orders:all');
    const orders=await page.evaluate(()=>[...document.querySelectorAll('.cr-orders .cr-order')].length);
    check(scope,'Sell → Orders lists every source in one list',orders>=4,orders);
    /* Work rows are read by `state`: a fulfilled order is done, a cancelled one is a problem, a confirmed booking is open */
    const kpis=await page.evaluate(()=>[...document.querySelectorAll('.cr-kpi2')].map(k=>[k.querySelector('.cr-kpi2__label').textContent,k.querySelector('.cr-kpi2__value').textContent]));
    check(scope,'Problems counts the cancelled order record',JSON.stringify(kpis).includes('["Problems","1"]'),kpis);
    check(scope,'open list carries the confirmed booking and the paid order',/Confirmed/.test(await page.locator('.cr-orders').textContent())&&/Paid/.test(await page.locator('.cr-orders').textContent()));
    await page.locator('[data-order-phase="done"]').click();await page.waitForTimeout(200);
    const done=await page.locator('.cr-orders').textContent();
    check(scope,'Done shows the fulfilled order and the completed booking',/Fulfilled/.test(done)&&/Completed/.test(done)&&!/Cancelled/.test(done),done.slice(0,200));
    await page.locator('[data-order-phase="problems"]').click();await page.waitForTimeout(200);
    check(scope,'Problems shows the cancelled order',/Cancelled tee/.test(await page.locator('.cr-orders').textContent()));
    await page.locator('[data-order-phase="open"]').click();await page.waitForTimeout(200);
    /* the first music read failed: no music rows, and the failure is not cached as the answer */
    check(scope,'a failed music read shows no music orders',await page.locator('[data-order-type="music"] b').textContent()==='0');
    music.rows=MUSIC_FIRST.concat([{id:'m2',amount_cents:200,currency:'usd',status:'paid',customer_email:'fan118@example.invalid',metadata:{track_title:'Single · Late Bloom (refreshed)'},paid_at:ago(60),created_at:ago(60)}]);
    await page.locator('.cr-head [data-action="refresh"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-order-type="music"] b')?.textContent==='2',null,{timeout:10000}).catch(()=>{});
    check(scope,'Refresh refetches music orders after a failure and shows the new one',await page.locator('[data-order-type="music"] b').textContent()==='2',await page.locator('[data-order-type="music"] b').textContent());
    music.rows=music.rows.map(r=>r.id==='m2'?{...r,status:'refunded'}:r);
    await page.locator('.cr-head [data-action="refresh"]').click();
    await page.waitForFunction(()=>/Refunded/.test(document.querySelector('.cr-orders')?.textContent||'')||document.querySelector('[data-order-phase="problems"]'),null,{timeout:10000});
    await page.locator('[data-order-phase="problems"]').click();await page.waitForTimeout(300);
    check(scope,'Refresh refetches a successful read too: the changed order moves to Problems',/Late Bloom \(refreshed\)/.test(await page.locator('.cr-orders').textContent()));
    await page.locator('[data-order-phase="open"]').click();await page.waitForTimeout(150);
    await page.locator('[data-order-type="music"]').click();await page.waitForTimeout(200);
    check(scope,'type chips filter the one list',await page.locator('[data-order-type="music"].is-on').count()===1);
    await goto(page,'#sell:store:marketplace');
    check(scope,'a mount point renders "not available yet"',/not available yet/i.test(await page.locator('[data-cr-slot="marketplace"]').textContent()));
    await goto(page,'#sell:store:direct');
    check(scope,'Sell → Store → Direct sales renders the registered module (#678), not a placeholder',await page.locator('[data-cr-slot]').count()===0&&/Direct sales/.test(await page.locator('.cr-leaf').textContent()));
    await goto(page,'#sell:music:lyrics');
    check(scope,'Lyrics & stems mount point exists',await page.locator('[data-cr-slot="lyrics"]').count()===1);
    await goto(page,'#home:today');
    const needs=await page.locator('.cr-today .cr-panel2').first().textContent();
    check(scope,'Needs you aggregates orders, unanswered, failed renewals and payments',/New order/i.test(needs)&&/Unanswered/i.test(needs)&&/Renewal lapsed/i.test(needs)&&/Payment failed/i.test(needs),needs.slice(0,300));
    /* exactly the lapsed renewal and the failed payment, read from `state`: not the upcoming renewal or the paid payment */
    check(scope,'Needs you lists one lapsed renewal and one failed payment by state',(needs.match(/Renewal lapsed/g)||[]).length===1&&(needs.match(/Payment failed/g)||[]).length===1&&/Sample member 07/.test(needs)&&/Site retainer/.test(needs)&&!/Hosting \(sample\)|Logo work/.test(needs));
    check(scope,'a fulfilled or cancelled order record is not a new order',!/Framed print|Cancelled tee/.test(needs));
    check(scope,'Home carries the AI command bar',await page.locator('#crHeroInput').count()===1);

    /* old routes redirect through NAV `was` */
    for(const [old,now] of OLD){
      await page.evaluate(h=>{location.hash=h;},old);
      await page.waitForFunction(h=>location.hash===h,now,{timeout:8000}).catch(()=>{});
      check(scope,old+' → '+now,await page.evaluate(()=>location.hash)===now,await page.evaluate(()=>location.hash));
    }
    await page.goto(BASE+'/control.html#work:pipeline',{waitUntil:'domcontentloaded'});await settle(page);
    check(scope,'a cold load of an old route is replaced, not stacked',await page.evaluate(()=>location.hash)==='#people:deals:pipeline');

    /* palette entries come from NAV and find old names */
    await page.locator('#crCommandOpen').click();await page.waitForTimeout(200);
    const pal=await page.evaluate(()=>({n:document.querySelectorAll('#crPaletteResults [data-palette-route]').length,leaves:CR.nav.leaves().length}));
    check(scope,'the palette lists every NAV leaf',pal.n===pal.leaves,pal);
    await page.locator('#crPaletteInput').fill('desk bot');await page.waitForTimeout(150);
    check(scope,'the palette finds a view by its old name',await page.locator('#crPaletteResults [data-palette-route]').first().getAttribute('data-palette-route')==='#people:inbox:ai-reply');
    await page.keyboard.press('Enter');await page.waitForTimeout(400);
    check(scope,'Enter opens it',await page.evaluate(()=>location.hash)==='#people:inbox:ai-reply');

    /* phone: More sheet lists Insights and System from NAV */
    if(vp.width<1024&&await page.locator('#crMore').isVisible()){
      await page.locator('#crMore').click();await page.waitForTimeout(200);
      const more=await page.evaluate(()=>[...document.querySelectorAll('#crMoreSheet [data-nav-route]')].map(a=>a.dataset.navRoute));
      check(scope,'More lists Insights and System',JSON.stringify(more)===JSON.stringify(['#insights','#system']),more);
      if(vp.width===390)await page.screenshot({path:join(OUT,'more-390.png')});
      await page.keyboard.press('Escape');
      check(scope,'Escape closes More',await page.locator('#crMoreSheet').isHidden());
    }
    check(scope,'no console errors',errors.length===0,errors);
    await ctx.close();
  }
}finally{await browser.close();}
const failed=results.filter(r=>!r.pass);
console.log(`\n${results.length-failed.length}/${results.length} passed`);
if(failed.length)process.exit(1);
