/* Halo Markets (owner, 2026-11-02): the Markets layer on the owner's Halo globe puts exchanges at their cities, and a
   country opens its Markets card: GDP with source and age, exchanges open/closed with local time, listed companies with a
   price or an honest "needs paid feed" note, and market news. Real pages and scripts from this checkout; the owner answers
   and every /v1/intel/markets/* answer are synthetic fixtures shaped like workers/mccluster/src/intel/world-markets.js.
   PLAYWRIGHT_DIR=<node_modules> CESIUM_DIR=<Cesium Build dir> [CHROMIUM_EXECUTABLE=…] node scripts/e2e/halo-markets.e2e.mjs [outDir] */
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/halo-markets-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const BASE='https://matthew.mccluster.org',CESIUM=process.env.CESIUM_DIR;
if(!CESIUM)throw Error('CESIUM_DIR is required; the test never downloads runtime assets.');
const TYPES={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.geojson':'application/json','.wasm':'application/wasm','.glb':'model/gltf-binary','.ktx2':'image/ktx2'};
const OWNER='11111111-1111-4111-8111-111111111111';
const results=[];
function check(scope,name,ok,detail){results.push(ok);console.log((ok?'PASS ':'FAIL ')+'['+scope+'] '+name+(ok?'':' '+JSON.stringify(detail)));}
await mkdir(OUT,{recursive:true});
const json=(r,b,s=200)=>r.fulfill({status:s,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(b)});

/* ---------- fixtures, in the Worker's shapes ---------- */
const NOW=new Date().toISOString(),AGO=m=>new Date(Date.now()-m*60e3).toISOString();
const provider=state=>({id:'finnhub',label:'Finnhub',state,tier:'free',secret_name:'FINNHUB_API_KEY',coverage:'Free tier: every listed security per exchange; quotes for US listings only.'});
const ex=(mic,name,short,city,country,lat,lon,open,time,sessions=[['09:30','16:00']])=>({mic,name,short,city,country,lat,lon,timezone:'UTC',sessions,days:[1,2,3,4,5],session:{state:open?'open':'closed',reason:open?'regular_session':'after_close',local_time:time,basis:'regular_schedule',holidays_modeled:false},listings:{provider:'finnhub',covered:true,quotes:country==='US'?'available':'needs_paid_feed'}});
const EX=[ex('XNYS','New York Stock Exchange','NYSE','New York','US',40.7069,-74.0113,true,'10:42'),ex('XNAS','Nasdaq Stock Market','Nasdaq','New York','US',40.7568,-73.986,true,'10:42'),
  ex('XLON','London Stock Exchange','LSE','London','GB',51.5154,-0.099,true,'15:42',[['08:00','16:30']]),ex('XTKS','Tokyo Stock Exchange','TSE','Tokyo','JP',35.682,139.779,false,'00:42',[['09:00','11:30'],['12:30','15:30']])];
const obs=(indicator,value,period,extra={})=>({indicator,value,period,retrieved_at:AGO(3),is_live:false,geography:{provider_code:'USA'},...extra});
const country=(iso2,name,state)=>({ok:true,schema:'world-markets/v1',generated_at:NOW,country:{iso2,iso3:iso2==='US'?'USA':iso2==='GB'?'GBR':'JPN',name},
  macro:{is_live:false,world_bank:{status:'available',observations:[obs('NY.GDP.MKTP.CD',29184890000000,'2024'),obs('NY.GDP.PCAP.CD',85809.9,'2024'),obs('NY.GDP.MKTP.KD.ZG',2.8,'2024')]},
    imf:{status:'available',observations:[obs('NGDPD',32642.373,'2026',{value_usd:32642373000000}),obs('NGDPDPC',95212.1,'2026'),obs('NGDP_RPCH',2.3,'2026',{previous:{period:'2025',value:2.0}})]}},
  exchanges:EX.filter(x=>x.country===iso2),provider:provider(state),listings:{route:'/v1/intel/markets/country/'+iso2+'/listings',state:state==='ready'?'ready':state},
  news:{country:{status:'available',stories:[{id:'a',title:name+' stocks rally as investors weigh a central bank rate decision that runs long enough to wrap twice on a phone',url:'https://news.example/a',publisher:'news.example',seen_at:AGO(42)},{id:'b',title:'Bond markets steady in '+name,url:'https://news.example/b',publisher:'wire.example',seen_at:AGO(180)}]},
    provider:state==='ready'?{status:'available',source:'Finnhub',items:[{title:'Global markets steady ahead of the jobs report',url:'https://news.example/g',source:'Fixture Wire',published_at:AGO(20)}]}:{status:state,items:[]}}});
const US_ROWS=[['AAPL','APPLE INC','XNAS',190.5,0.79],['AMZN','AMAZON.COM INC','XNAS',201.2,-1.31],['IBM','INTL BUSINESS MACHINES CORP','XNYS',null,null],['JPM','JPMORGAN CHASE & CO','XNYS',null,null],['KO','COCA-COLA CO','XNYS',null,null],['VERYLONGTICKERX','A COMPANY WITH AN EXTREMELY LONG REGISTERED NAME THAT NEVER BREAKS ANYWHERE','XNYS',null,null]];
const listings=(iso2,q)=>{
  const rows=iso2==='US'?US_ROWS.filter(r=>!q||r[0].toLowerCase().includes(q)||r[1].toLowerCase().includes(q)).map(([s,n,mic,p,c])=>({symbol:s,display_symbol:s,name:n,type:'Common Stock',mic,exchange:mic==='XNAS'?'Nasdaq':'NYSE',currency:'USD',price:p,change:p&&c,change_pct:c,as_of:p?AGO(1):null,price_status:p?'quote':'on_request'}))
    :[{symbol:'VOD.L',display_symbol:'VOD.L',name:'VODAFONE GROUP PLC',type:'Common Stock',mic:'XLON',exchange:'LSE',currency:'GBP',price:null,price_status:'needs_paid_feed'},{symbol:'BP.L',display_symbol:'BP.L',name:'BP PLC',type:'Common Stock',mic:'XLON',exchange:'LSE',currency:'GBP',price:null,price_status:'needs_paid_feed'}];
  return {ok:true,schema:'world-markets/v1',state:'ok',provider:provider('ready'),total:rows.length,offset:0,limit:25,has_more:false,listings:rows,listings_retrieved_at:AGO(30),exchanges:[]};
};
const companyFix={ok:true,state:'ok',symbol:'AAPL',profile:{name:'Apple Inc',industry:'Technology',currency:'USD',ipo:'1980-12-12',market_cap:{value:3e12,unit:'USD'},website:'https://www.apple.com/'},quote:{status:'quote',price:190.5,change:1.5,change_pct:0.79,as_of:AGO(1),source:'Finnhub'},news:{status:'available',items:[{title:'Apple earnings beat estimates',url:'https://news.example/aapl',source:'Fixture Wire',published_at:AGO(90)}]}};

const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
async function setup(viewport){
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:viewport.width<1000,ignoreHTTPSErrors:true,serviceWorkers:'block'});
  const errors=[],asked=[],slow={country:0,listingsAll:0};
  const later=ms=>new Promise(r=>setTimeout(r,ms));
  await ctx.addInitScript(({who})=>{localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    const exp=Math.floor(Date.now()/1000)+3600;localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:who,email:who+'@fixture.invalid'})).replace(/=+$/,'')+'.y',refresh_token:'fixture',expires_at:exp,user:{id:who}}));},{who:OWNER});
  await ctx.route('**/*',async r=>{
    const req=r.request(),u=new URL(req.url()),p=u.pathname;
    if(req.method()==='OPTIONS')return r.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(u.hostname==='cesium.com'){const rel=p.split('/Build/Cesium/')[1];const f=rel&&resolve(CESIUM,rel);if(f&&f.startsWith(resolve(CESIUM)+sep)){try{return r.fulfill({body:await readFile(f),contentType:TYPES[extname(f)]||'application/octet-stream'});}catch{}}return r.abort();}
    if(u.origin==='https://api.mccluster.org'){
      if(p.startsWith('/v1/intel/markets/'))asked.push({path:p+u.search,auth:req.headers().authorization||''});
      if(p==='/v1/status')return json(r,{ok:true,operator:{email:'owner@fixture.invalid'}});
      if(p==='/v1/world/access')return json(r,{release:{version:'globe-admin-preview/v1',admin_preview:true},level:'owner',levels:[],unlocked_layers:[],locked_layers:[]});
      if(p==='/v1/mnet/bootstrap')return json(r,{identity:{mccluster_id:'matthew',m_uid:'m-1111'},profile:{display_name:'Matthew McCluster'}});
      if(p==='/v1/intel/markets/exchanges')return json(r,{ok:true,schema:'world-markets/v1',generated_at:NOW,provider:provider('ready'),exchanges:EX});
      if(p==='/v1/intel/markets/country/US'){if(slow.country)await later(slow.country);return json(r,country('US','United States','ready'));}
      if(p==='/v1/intel/markets/country/GB')return json(r,country('GB','United Kingdom','ready'));
      if(p==='/v1/intel/markets/country/JP')return json(r,country('JP','Japan','needs_key'));
      let m=p.match(/^\/v1\/intel\/markets\/country\/([A-Z]{2})\/listings$/);if(m&&slow.listingsAll&&!u.searchParams.get('q')){await later(slow.listingsAll);await json(r,listings(m[1],''));asked.push({path:'LISTINGS-ALL-DELIVERED'});return;}if(m)return json(r,listings(m[1],(u.searchParams.get('q')||'').toLowerCase()));
      if(p==='/v1/intel/markets/company/AAPL')return json(r,companyFix);
      return json(r,{ok:true,items:[],threads:[],events:[],total:0});
    }
    if(u.hostname.endsWith('supabase.co')){if(p==='/auth/v1/user')return json(r,{id:OWNER,email:'owner@fixture.invalid'});return json(r,[]);}
    if(u.origin===BASE){const rel=p==='/'?'index.html':decodeURIComponent(p.replace(/^\//,''));const f=resolve(ROOT,rel);if(!f.startsWith(resolve(ROOT)+sep))return r.abort();
      try{return r.fulfill({body:await readFile(f),contentType:TYPES[extname(f)]||'application/octet-stream'});}catch{return r.fulfill({status:404,body:''});}}
    return r.abort();
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  return {ctx,page,errors,asked,slow};
}
const overflow=p=>p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
/* every visible control inside the card: at least 44px in both directions */
const smallTargets=p=>p.evaluate(()=>[...document.querySelectorAll('#haloMarkets button,#haloMarkets a,#haloMarkets input')].filter(e=>e.offsetParent).map(e=>{const b=e.getBoundingClientRect();return {t:(e.textContent||e.getAttribute('aria-label')||e.tagName).trim().slice(0,30),w:Math.round(b.width),h:Math.round(b.height)}}).filter(x=>x.h<44||x.w<44));
try{
  for(const vp of process.env.MARKETS_E2E_ONLY==='races'?[]:[{width:390,height:844},{width:820,height:1180},{width:1280,height:800}]){
    const scope='halo-markets-'+vp.width;const {ctx,page,errors,asked}=await setup(vp);
    await page.goto(BASE+'/action-globe.html?explore=1&halo=1',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('[data-item="markets"] input',{state:'attached',timeout:60000}).catch(()=>{});
    const row=await page.evaluate(()=>{const r=document.querySelector('[data-item="markets"]');return r?{label:r.querySelector('.hx-layer__name').textContent,group:r.closest('[data-group]').dataset.group}:null;});
    check(scope,'World data lists a Markets group with its exchanges layer',!!row&&row.group==='markets',row);
    /* the owner's own switch, as tapped */
    await page.evaluate(()=>document.querySelector('[data-item="markets"] input').click());
    await page.waitForFunction(()=>{const s=window.HaloConsole&&HaloConsole.state();return s&&s.layers&&s.layers.markets&&s.layers.markets.state==='on';},null,{timeout:20000}).catch(()=>{});
    const layer=await page.evaluate(()=>HaloConsole.state().layers.markets);
    check(scope,'the layer turns on and counts open exchanges against all of them',layer.on&&layer.text==='3 open / 4',layer);
    check(scope,'exchanges are read with the owner session from the owner route',asked.some(a=>a.path==='/v1/intel/markets/exchanges'&&/^Bearer /.test(a.auth)),asked);
    /* a tap on the Nasdaq pin (Halo's pick receives what Cesium picked) opens the United States, Nasdaq preselected */
    const picked=await page.evaluate(()=>HaloConsole.pick({id:{marketPick:true,mic:'XNAS',country:'US'}}));
    await page.waitForFunction(()=>document.querySelectorAll('#haloMarkets [data-symbol]').length>0,null,{timeout:15000}).catch(()=>{});
    const card=await page.evaluate(()=>{const c=document.getElementById('haloMarkets');return {shown:!!c&&!c.hidden,title:c&&c.querySelector('h2').textContent,stats:[...c.querySelectorAll('.hm__stat')].map(s=>s.textContent),ex:[...c.querySelectorAll('[data-mic]')].map(b=>[b.dataset.mic,b.getAttribute('aria-pressed'),b.querySelector('.hm__ex-state b').textContent]),rows:[...c.querySelectorAll('[data-symbol]')].map(b=>b.dataset.symbol),prices:[...c.querySelectorAll('.hm__px')].map(x=>x.textContent),news:c.querySelectorAll('.hm__news li').length,notes:c.textContent};});
    check(scope,'a pin tap opens the Markets card for that country',picked===true&&card.shown&&card.title==='United States',card);
    check(scope,'GDP shows value, period, source and age, and says it is not live',card.stats.some(s=>/GDP, 2026 IMF estimate\$32\.6 trn.*IMF WEO · retrieved 3m ago · not live/.test(s))&&card.stats.some(s=>/GDP, 2024 reported\$29\.2 trn.*World Bank WDI/.test(s))&&/never live/.test(card.notes),card.stats);
    check(scope,'exchanges show open/closed and the tapped one filters the listings',card.ex.length===2&&card.ex.every(e=>e[2]==='Open')&&card.ex.find(e=>e[0]==='XNAS')[1]==='true'&&asked.some(a=>/listings\?.*mic=XNAS/.test(a.path)),{ex:card.ex,asked});
    check(scope,'listed companies carry a price with its change and age, or say why not',card.rows.includes('AAPL')&&card.prices.some(t=>/190\.50 USD\+0\.79% · 1m ago/.test(t))&&card.prices.some(t=>/Tap for price/.test(t)),card.prices);
    check(scope,'market news is tied to the country and the provider headlines',card.news>=3,card.news);
    /* search, then a company */
    await page.fill('#haloMarkets [data-q]','apple');
    await page.waitForFunction(()=>document.querySelectorAll('#haloMarkets [data-symbol]').length===1,null,{timeout:10000}).catch(()=>{});
    check(scope,'the search narrows the list on the server',asked.some(a=>/q=apple/.test(a.path)),asked.map(a=>a.path));
    await page.click('#haloMarkets [data-symbol="AAPL"]');
    await page.waitForFunction(()=>/Apple Inc/.test((document.querySelector('#haloMarkets .hm__company')||{}).textContent||''),null,{timeout:10000}).catch(()=>{});
    const co=await page.evaluate(()=>({card:(document.querySelector('#haloMarkets .hm__company')||{}).textContent||'',news:document.querySelector('#haloMarkets [data-news]').textContent}));
    check(scope,'a company opens its quote, profile and its own news',/Last price190\.50 USD/.test(co.card)&&/Market cap \$3 trn/.test(co.card)&&/Apple earnings beat estimates/.test(co.news),co);
    const placed=await page.evaluate(()=>{const b=document.getElementById('haloMarkets').getBoundingClientRect();return {l:Math.round(b.left),r:Math.round(b.right),t:Math.round(b.top),b:Math.round(b.bottom),w:innerWidth,h:innerHeight};});
    check(scope,vp.width<760?'a bottom sheet on a phone, full width':'a side panel on the right',vp.width<760?placed.l===0&&placed.r===placed.w:placed.r<=placed.w-12&&placed.l>=placed.w*0.4,placed);
    check(scope,'every control in the card is a 44px target',(await smallTargets(page)).length===0,await smallTargets(page));
    check(scope,'no horizontal overflow (scrollWidth === clientWidth)',(await overflow(page))===0,await overflow(page));
    const inner=await page.evaluate(()=>{const b=document.querySelector('#haloMarkets [data-body]');return b.scrollWidth-b.clientWidth;});
    check(scope,'the card itself does not scroll sideways',inner===0,inner);
    await page.screenshot({path:join(OUT,`halo-markets-us-${vp.width}.png`),timeout:120000});
    await page.evaluate(()=>{document.querySelector('#haloMarkets [data-body]').scrollTop=1e5;});
    await page.screenshot({path:join(OUT,`halo-markets-us-news-${vp.width}.png`),timeout:120000});
    /* a country tap on the globe (the countries layer announces it) opens a non-US card: prices need the paid feed */
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('hu:country',{detail:{code:'GB',name:'United Kingdom'}})));
    await page.waitForFunction(()=>document.querySelector('#haloMarkets h2').textContent==='United Kingdom'&&document.querySelectorAll('#haloMarkets [data-symbol]').length===2,null,{timeout:10000}).catch(()=>{});
    const gb=await page.evaluate(()=>[...document.querySelectorAll('#haloMarkets .hm__px')].map(x=>x.textContent));
    check(scope,'a country tap opens its card; non-US prices say they need a paid feed, never a number',gb.length===2&&gb.every(t=>t==='Price needs paid feed'),gb);
    await page.screenshot({path:join(OUT,`halo-markets-gb-${vp.width}.png`),timeout:120000});
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('hu:country',{detail:{code:'JP',name:'Japan'}})));
    await page.waitForFunction(()=>document.querySelector('#haloMarkets h2').textContent==='Japan'&&/FINNHUB_API_KEY/.test(document.querySelector('#haloMarkets [data-list-note]').textContent),null,{timeout:10000}).catch(()=>{});
    const jp=await page.evaluate(()=>({note:document.querySelector('#haloMarkets [data-list-note]').textContent,rows:document.querySelectorAll('#haloMarkets [data-symbol]').length,closed:[...document.querySelectorAll('#haloMarkets .hm__ex-state b')].map(b=>b.textContent)}));
    check(scope,'without a key the card says which secret is missing and shows no rows',/FINNHUB_API_KEY secret on Worker mccluster/.test(jp.note)&&jp.rows===0&&jp.closed.join()==='Closed',jp);
    if(vp.width===390)await page.screenshot({path:join(OUT,`halo-markets-jp-${vp.width}.png`),timeout:120000});
    await page.click('#haloMarkets [data-close]');
    const closed=await page.evaluate(()=>document.getElementById('haloMarkets').hidden);
    check(scope,'the card closes',closed,closed);
    await page.evaluate(()=>document.querySelector('[data-item="markets"] input').click());
    await page.waitForFunction(()=>HaloConsole.state().layers.markets.on===false,null,{timeout:5000}).catch(()=>{});
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('hu:country',{detail:{code:'US',name:'United States'}})));
    await page.waitForTimeout(300);
    check(scope,'with the layer off a country tap opens nothing',await page.evaluate(()=>document.getElementById('haloMarkets').hidden),null);
    check(scope,'no JavaScript errors',errors.length===0,errors);
    await ctx.close();
  }
  /* RACES (Codex review of #689): a pin refresh during a card load must not strand the card on "Loading…", and an older
     unfiltered listings answer must not replace a newer search's answer */
  {
    const scope='halo-markets-races';const {ctx,page,errors,asked,slow}=await setup({width:390,height:844});
    await page.goto(BASE+'/action-globe.html?explore=1&halo=1',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('[data-item="markets"] input',{state:'attached',timeout:60000}).catch(()=>{});
    await page.evaluate(()=>document.querySelector('[data-item="markets"] input').click());
    await page.waitForFunction(()=>HaloConsole.state().layers.markets.state==='on',null,{timeout:20000}).catch(()=>{});
    slow.country=1500;
    await page.evaluate(()=>HaloConsole.pick({id:{marketPick:true,mic:'XNYS',country:'US'}}));
    await page.waitForTimeout(300);
    const pinsBefore=asked.filter(a=>a.path==='/v1/intel/markets/exchanges').length;
    /* the owner's Refresh data re-reads the pins, as the 60 s refresh does, while the country answer is still in flight */
    await page.evaluate(()=>[...document.querySelectorAll('.hx-btn')].find(b=>b.textContent==='Refresh data').click());
    /* swiftshader keeps the page's thread busy: wait for the answer, not for a fixed time */
    await page.waitForFunction(()=>!/Loading/.test(document.querySelector('#haloMarkets [data-sub]').textContent)&&document.querySelectorAll('#haloMarkets [data-symbol]').length>0,null,{timeout:20000}).catch(()=>{});
    const after=await page.evaluate(()=>({sub:document.querySelector('#haloMarkets [data-sub]').textContent,stats:document.querySelectorAll('#haloMarkets .hm__stat').length,rows:document.querySelectorAll('#haloMarkets [data-symbol]').length}));
    check(scope,'a pin refresh during a card load still paints the card and its listings',asked.filter(a=>a.path==='/v1/intel/markets/exchanges').length>pinsBefore&&!/Loading/.test(after.sub)&&after.stats>0&&after.rows>0,after);
    slow.country=0;slow.listingsAll=1500;
    const n=asked.length;
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('hu:country',{detail:{code:'US',name:'United States'}})));
    await page.waitForFunction(()=>document.querySelector('#haloMarkets h2').textContent==='United States'&&document.querySelectorAll('#haloMarkets .hm__stat').length>0,null,{timeout:10000}).catch(()=>{});
    const t0=Date.now();while(Date.now()-t0<5000&&!asked.slice(n).some(a=>/\/listings\?/.test(a.path)&&!/q=/.test(a.path)))await page.waitForTimeout(50);
    await page.fill('#haloMarkets [data-q]','apple');
    /* the search answer lands first; then wait until the slow unfiltered answer has been delivered and given time to paint */
    const t1=Date.now();while(Date.now()-t1<15000&&!asked.slice(n).some(a=>a.path==='LISTINGS-ALL-DELIVERED'))await page.waitForTimeout(100);
    await page.waitForTimeout(1500);
    const rows=await page.evaluate(()=>({rows:[...document.querySelectorAll('#haloMarkets [data-symbol]')].map(b=>b.dataset.symbol),note:document.querySelector('#haloMarkets [data-list-note]').textContent}));
    check(scope,'an older unfiltered answer arriving after a search does not replace the search result',asked.slice(n).some(a=>/q=apple/.test(a.path))&&rows.rows.join()==='AAPL'&&/matching "apple"/.test(rows.note),rows);
    check(scope,'no JavaScript errors',errors.length===0,errors);
    await ctx.close();
  }
}finally{await browser.close();}
const failed=results.filter(x=>!x).length;
console.log(`\n${results.length-failed}/${results.length} passed · screenshots in ${OUT}`);
process.exit(failed?1:0);
