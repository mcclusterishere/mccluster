// Actual globe/Finance UI, local Cesium, fixture identity, real local PostgreSQL RPC.
// No request is allowed to reach a hosted API, source, imagery service or account.
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/codex/cua_node/lib/node_modules','x'))('playwright');
const CESIUM=process.env.CESIUM_DIR, PREVIEW=process.env.FINANCE_PREVIEW_URL;
if(!CESIUM||!PREVIEW||!/^http:\/\/127\.0\.0\.1:\d+$/.test(PREVIEW))throw Error('Set CESIUM_DIR and loopback FINANCE_PREVIEW_URL');
const OUT=process.argv[2]||'/tmp/finance-globe-proof';await mkdir(OUT,{recursive:true});
const BASE='https://matthew.mccluster.org',OWNER='11111111-1111-4111-8111-111111111111';
const MIME={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2','.wasm':'application/wasm'};
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const results=[];
try{
 for(const width of [390,1280]){
  const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  const errors=[];let isOwner=true;
  await ctx.addInitScript(({owner})=>{
   localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
   const exp=Math.floor(Date.now()/1000)+3600;
   localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:owner,email:'owner@fixture.invalid'}))+'.y',expires_at:exp,user:{id:owner}}));
  },{owner:OWNER});
  const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});
  await ctx.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
   if(url.origin==='https://api.mccluster.org'){
    if(path.startsWith('/v1/intel/finance')){
     const response=await fetch(PREVIEW+path+url.search,{method:request.method(),headers:{authorization:'Bearer '+(isOwner?'local-owner-fixture':'non-owner'),'content-type':'application/json'},body:request.postData()||undefined});
     return route.fulfill({status:response.status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:await response.text()});
    }
    if(path==='/v1/intel/markets/exchanges')return json(route,{exchanges:[],generated_at:new Date().toISOString()});
    if(path.startsWith('/v1/intel/markets/country/'))return json(route,{country:{iso2:'US',name:'United States'},exchanges:[],provider:{id:'not-connected',state:'needs_key'},listings:{state:'needs_key'},macro:{},news:{country:{stories:[],status:'empty'}}});
    if(path==='/v1/status')return json(route,isOwner?{ok:true,operator:{email:'owner@fixture.invalid'}}:{error:'Forbidden'},isOwner?200:403);
    if(path==='/v1/world/access')return json(route,{release:{version:'globe-admin-preview/v1',admin_preview:isOwner},level:isOwner?'owner':'public',levels:[],unlocked_layers:[],locked_layers:[]});
    if(path==='/v1/mnet/bootstrap')return json(route,{identity:{mccluster_id:'fixture.owner',m_uid:'m-fixture'},profile:{display_name:'Fixture Owner'}});
    return json(route,{ok:true,items:[],threads:[],events:[],total:0});
   }
   if(url.hostname.endsWith('supabase.co'))return json(route,path==='/auth/v1/user'?{id:OWNER,email:'owner@fixture.invalid'}:[]);
   let file;
   if(url.hostname==='cesium.com'){
    const part=path.split('/Build/Cesium/')[1];if(part){const candidate=resolve(CESIUM,part);if(candidate.startsWith(resolve(CESIUM)+sep))file=candidate;}
   }else if(url.origin===BASE){const candidate=resolve(ROOT,decodeURIComponent(path.slice(1)));if(candidate.startsWith(resolve(ROOT)+sep))file=candidate;}
   if(file){try{return route.fulfill({body:await readFile(file),contentType:MIME[extname(file)]||'application/octet-stream',headers:{'access-control-allow-origin':'*'}});}catch{return route.fulfill({status:404,body:''});}}
   return route.abort();
  });
  const page=await ctx.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(BASE+'/action-globe.html?explore=1&halo=1',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#haloShell .hx-top',{timeout:60000});
  const renderer=await page.evaluate(()=>({viewer:!!window.HuGlobe?.viewer(),canvas:!!document.querySelector('#globe canvas')}));
  if(!renderer.viewer||!renderer.canvas)throw Error('Actual Cesium globe did not initialize');
  if(width<768)await page.locator('#haloShell .hx-collapse').click();
  await page.evaluate(()=>{window.__financeViewer=window.HuGlobe.viewer();window.__financeDocument=document;});
  await page.locator('[data-finance-open]').scrollIntoViewIfNeeded();
  await page.screenshot({path:join(OUT,`globe-${width}.png`)});
  await page.locator('[data-finance-open]').click();
  await page.waitForSelector('[data-f-results] [data-f-symbol="AAPL"]');
  await page.waitForFunction(()=>document.querySelector('[data-f-account]')?.textContent.includes('saved revision'));
  await page.locator('[data-f-results] [data-f-symbol="AAPL"]').click();
  await page.waitForSelector('[data-f-security] svg');
  if(!await page.locator('[data-f-security]').textContent().then(t=>t.includes('IEX')&&t.includes('adjusted')))throw Error('Missing feed/history labels');
  await page.getByText('Owner source and storage status',{exact:true}).click();
  await page.locator('[data-f-diagnose]').click();
  await page.waitForFunction(()=>document.querySelector('[data-f-control]')?.textContent.includes('ready'));
  await page.locator('[data-f-watch]').click();
  await page.waitForFunction(()=>document.querySelector('[data-f-status]')?.textContent.startsWith('Paper action saved'));
  await page.getByRole('button',{name:'Preview order',exact:true}).click();
  await page.getByRole('button',{name:'Confirm paper order',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-f-status]')?.textContent.startsWith('Paper action saved'));
  const saved=await page.locator('[data-f-account]').textContent();
  if(!saved.includes('AAPL')||!saved.includes('100.02'))throw Error('Paper fill missing');
  if(!await page.evaluate(()=>window.HuGlobe.viewer()===window.__financeViewer&&document===window.__financeDocument))throw Error('Finance left/replaced the globe');
  await page.screenshot({path:join(OUT,`finance-${width}.png`),fullPage:true});
  await page.reload();await page.waitForSelector('#haloShell .hx-top',{timeout:60000});
  if(width<768)await page.locator('#haloShell .hx-collapse').click();
  await page.locator('[data-finance-open]').click();
  await page.waitForFunction(()=>document.querySelector('[data-f-account]')?.textContent.includes('100.02'));
  const reloaded=await page.locator('[data-f-account]').textContent();
  if(reloaded!==saved)throw Error('Portfolio changed on reload');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);if(overflow)throw Error('Horizontal overflow');
  isOwner=false;
  await page.locator('[data-f-reload]').click();
  await page.waitForFunction(()=>document.querySelector('[data-f-status]')?.textContent==='Owner authentication required.');
  if(await page.locator('[data-f-account]').textContent())throw Error('Private data retained after denial');
  if(errors.length)throw Error(errors.join('\n'));
  results.push({width,actual_globe:renderer,same_viewer:true,historical_chart:true,watchlist:true,saved_reload:true,member_denied:true,overflow:false});
  await ctx.close();
 }
 console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
