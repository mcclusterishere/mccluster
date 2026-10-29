/* The owner's globe is Hitman's Halo (owner, 2026-10-22: "click the globe as matthew@mccluster.org signed in. It'll take
   you to the user globe and not the Hitman Halo globe"). Real pages and scripts from this checkout; the owner answers
   (/v1/status, /v1/world/access) and everything else are synthetic fixtures. A member's globe stays the World.
   PLAYWRIGHT_DIR=<node_modules> CESIUM_DIR=<Cesium Build dir> [CHROMIUM_EXECUTABLE=…] node scripts/e2e/owner-halo-globe.e2e.mjs [outDir] */
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/owner-halo-globe-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const BASE='https://matthew.mccluster.org',CESIUM=process.env.CESIUM_DIR;
if(!CESIUM)throw Error('CESIUM_DIR is required; the test never downloads runtime assets.');
const TYPES={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.geojson':'application/json','.wasm':'application/wasm','.glb':'model/gltf-binary','.ktx2':'image/ktx2'};
const OWNER='11111111-1111-4111-8111-111111111111',MEMBER='22222222-2222-4222-8222-222222222222';
const results=[];
function check(scope,name,ok,detail){results.push(ok);console.log((ok?'PASS ':'FAIL ')+'['+scope+'] '+name+(ok?'':' '+JSON.stringify(detail)));}
await mkdir(OUT,{recursive:true});
const json=(r,b,s=200)=>r.fulfill({status:s,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(b)});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
async function setup(viewport,who){
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:viewport.width<1000,ignoreHTTPSErrors:true,serviceWorkers:'block'});
  const errors=[];const owner=who===OWNER;
  await ctx.addInitScript(({who})=>{localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    const exp=Math.floor(Date.now()/1000)+3600;localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:who,email:who+'@fixture.invalid'})).replace(/=+$/,'')+'.y',refresh_token:'fixture',expires_at:exp,user:{id:who}}));},{who});
  await ctx.route('**/*',async r=>{
    const req=r.request(),u=new URL(req.url()),p=u.pathname;
    if(req.method()==='OPTIONS')return r.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(u.hostname==='cesium.com'){const rel=p.split('/Build/Cesium/')[1];const f=rel&&resolve(CESIUM,rel);if(f&&f.startsWith(resolve(CESIUM)+sep)){try{return r.fulfill({body:await readFile(f),contentType:TYPES[extname(f)]||'application/octet-stream'});}catch{}}return r.abort();}
    if(u.origin==='https://api.mccluster.org'){
      if(p==='/v1/status')return owner?json(r,{ok:true,operator:{email:'owner@fixture.invalid'}}):json(r,{error:'Forbidden'},403);
      if(p==='/v1/world/access')return json(r,{release:{version:'globe-admin-preview/v1',admin_preview:owner},level:owner?'owner':'public',levels:[],unlocked_layers:[],locked_layers:[]});
      if(p==='/v1/mnet/bootstrap')return json(r,{identity:{mccluster_id:owner?'matthew':'member.one',m_uid:'m-'+who.slice(0,4)},profile:{display_name:owner?'Matthew McCluster':'Member One'}});
      return json(r,{ok:true,items:[],threads:[],events:[],total:0});
    }
    if(u.hostname.endsWith('supabase.co')){if(p==='/auth/v1/user')return json(r,{id:who,email:who+'@fixture.invalid'});return json(r,[]);}
    /* the World host serves the same World page (mccluster.org is host-routed to it in production) */
    if(u.origin==='https://mccluster.org'&&(p==='/'||p==='/mnet.html'))return r.fulfill({contentType:'text/html',body:'<!doctype html><title>World</title><p id="worldFixture">The World feed</p>'});
    if(u.origin===BASE){const rel=p==='/'?'index.html':decodeURIComponent(p.replace(/^\//,''));const f=resolve(ROOT,rel);if(!f.startsWith(resolve(ROOT)+sep))return r.abort();
      try{return r.fulfill({body:await readFile(f),contentType:TYPES[extname(f)]||'application/octet-stream'});}catch{return r.fulfill({status:404,body:''});}}
    return r.abort();
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  return {ctx,page,errors};
}
const overflow=p=>p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
try{
  for(const vp of [{width:390,height:844},{width:1280,height:800}]){
    const scope='owner-'+vp.width;const {ctx,page,errors}=await setup(vp,OWNER);
    await page.goto(BASE+'/index.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.body.hasAttribute('data-appbar-admin'),null,{timeout:30000}).catch(()=>{});
    const globe=await page.evaluate(()=>{const a=document.querySelector('.appbar [data-appnav="halo"]');return a?{href:a.getAttribute('href'),label:a.getAttribute('aria-label')}:null;});
    check(scope,'the owner\'s bar globe opens Hitman\'s Halo, and there is no second (user) globe',!!globe&&/action-globe\.html\?explore=1&halo=1$/.test(globe.href)&&/Hitman’s Halo/.test(globe.label)&&!(await page.$('.appbar [data-appnav="world"]')),globe);
    await page.click('.appbar [data-appnav="halo"]');
    await page.waitForURL(/action-globe\.html\?explore=1&halo=/,{timeout:20000}).catch(()=>{});
    await page.waitForSelector('.hx-top',{timeout:60000}).catch(()=>{});
    await page.waitForTimeout(1500);
    const there=await page.evaluate(()=>({url:location.pathname+location.search,halo:!!document.querySelector('.hx-top'),lit:(document.querySelector('.appbar [data-appnav="halo"]')||{}).classList?.contains('is-here'),feed:(document.querySelector('.hx-feed')||{}).getAttribute?.('href')}));
    /* Halo writes its own route once it mounts (3f5a73eb, 2026-10-24): halo=1 opens on its World screen and the URL then reads
       halo=world&hours=24, so a reload or Back returns to the same screen and window */
    const landed=new URL(there.url,'http://x');
    check(scope,'tapping it lands in Halo (the four screens) on its World screen, with the globe lit',landed.pathname==='/action-globe.html'&&landed.searchParams.get('explore')==='1'&&landed.searchParams.get('halo')==='world'&&landed.searchParams.get('hours')==='24'&&there.halo&&there.lit===true,there);
    check(scope,'Halo carries the way to the World feed',!!there.feed&&/(mnet\.html\?view=feed|\?view=feed)$/.test(there.feed),there);
    const box=await page.evaluate(()=>{const f=document.querySelector('.hx-feed').getBoundingClientRect(),o=document.querySelector('.hx-operator').getBoundingClientRect(),b=document.querySelector('.hx-brand').getBoundingClientRect();return {feed:[Math.round(f.left),Math.round(f.right),Math.round(f.height)],op:[Math.round(o.left)],brand:[Math.round(b.right)],w:innerWidth};});
    check(scope,'the World feed door sits whole in the header, 44px tall, clear of the brand and the account button',box.feed[2]>=44&&box.feed[0]>=box.brand[0]-1&&box.feed[1]<=box.op[0]+1&&box.feed[1]<=box.w,box);
    const brand=await page.evaluate(()=>{const s=document.querySelector('.hx-brand span');return {full:s.scrollWidth<=s.clientWidth+1,label:getComputedStyle(document.querySelector('.hx-feed__long')).display!=='none'?'World feed':'Feed'};});
    check(scope,'the Halo name stays whole beside it ('+brand.label+')',brand.full&&(vp.width>=420?brand.label==='World feed':brand.label==='Feed'),brand);
    check(scope,'no horizontal overflow',(await overflow(page))===0,await overflow(page));
    await page.screenshot({path:join(OUT,`owner-halo-${vp.width}.png`)});
    /* the site opens the World the way it always does from a page with the player: in its own layer over the page (the
       music carries on, the address gains world=1), or as the page itself; either way it is the World feed */
    await page.click('.hx-feed');
    await page.waitForFunction(()=>/view=feed/.test(location.href)||(()=>{const f=document.getElementById('mccWorldAudioFrame');return !!(f&&/view=feed/.test(f.getAttribute('src')||''))&&!document.getElementById('mccWorldAudioShell').hidden;})(),null,{timeout:20000}).catch(()=>{});
    const opened=await page.evaluate(()=>{const f=document.getElementById('mccWorldAudioFrame');return {url:location.href,frame:f?f.getAttribute('src'):null,shown:!!(f&&!document.getElementById('mccWorldAudioShell').hidden)};}).catch(()=>({url:page.url()}));
    check(scope,'the World feed door opens the World feed',/view=feed/.test(opened.url)||(opened.shown&&/view=feed/.test(opened.frame||'')),opened);
    check(scope,'no JavaScript errors',errors.length===0,errors);
    await ctx.close();
  }
  {
    const scope='member';const {ctx,page,errors}=await setup({width:390,height:844},MEMBER);
    await page.goto(BASE+'/index.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.MCC_BAR&&window.MCC_BAR.auth().signed_in,null,{timeout:30000}).catch(()=>{});
    await page.waitForTimeout(1200);
    const bar=await page.evaluate(()=>({world:(document.querySelector('.appbar [data-appnav="world"]')||{}).getAttribute?.('href')||null,halo:!!document.querySelector('.appbar [data-appnav="halo"]')}));
    check(scope,'a member\'s globe is still the World, never Halo',!!bar.world&&/view=feed/.test(bar.world)&&!bar.halo,bar);
    check(scope,'no JavaScript errors',errors.length===0,errors);
    await ctx.close();
  }
}finally{await browser.close();}
const failed=results.filter(x=>!x).length;
console.log(`\n${results.length-failed}/${results.length} passed · screenshots in ${OUT}`);
process.exit(failed?1:0);
