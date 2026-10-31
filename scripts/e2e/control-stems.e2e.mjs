/* Control → Create → Music → Stems: every instrument of a track, owner only, phone first.
   Real control.html + js/control-room/stems-panel.js; music-access and the private bucket are fixtures:
   seven short tones stand in for the stems. Checks: the stems load and play together on one clock,
   solo/mute set the mix, each stem has a download, a track with no stems can be separated (queued on
   Core with the right key), a non-operator is refused and gets no URLs, and 390px never scrolls sideways.
   PLAYWRIGHT_DIR=<node_modules> [CHROMIUM_EXECUTABLE=…] node scripts/e2e/control-stems.e2e.mjs [outDir] */
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/control-stems-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const BASE='https://matthew.mccluster.org';
const TYPES={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
const OWNER='11111111-1111-4111-8111-111111111111';
const STEMS=['vocals','drums','bass','guitar','piano','other','instrumental'];
const results=[];
function check(scope,name,ok,detail){results.push({scope,name,pass:!!ok});console.log((ok?'PASS ':'FAIL ')+'['+scope+'] '+name+(ok?'':' '+JSON.stringify(detail)));}
await mkdir(OUT,{recursive:true});
function tone(freq,seconds=6){const sr=8000,n=sr*seconds,b=Buffer.alloc(44+n*2);b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(2*Math.PI*freq*i/sr)*3000),44+i*2);return b;}
const WAVS=Object.fromEntries(STEMS.map((s,i)=>[s,tone(220+i*60)]));
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(body)});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required','--mute-audio']});

async function setup(viewport,{owner=true}={}){
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:viewport.width<1000,serviceWorkers:'block'});
  const db={calls:[],stemFetches:0},errors=[];
  await ctx.addInitScript(({OWNER})=>{
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    const exp=Math.floor(Date.now()/1000)+3600;
    localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:OWNER,email:'owner@fixture.invalid'})).replace(/=+$/,'')+'.y',refresh_token:'fixture-only',expires_at:exp,user:{id:OWNER,email:'owner@fixture.invalid'}}));
  },{OWNER});
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname;
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(u.origin==='https://api.mccluster.org'){
      if(p==='/v1/status')return owner?json(route,{ok:true,operator:{email:'owner@fixture.invalid'},database:{reachable:true}}):json(route,{error:'Forbidden'},403);
      if(p==='/v1/workspaces/me')return json(route,{ok:true,profile:{id:OWNER},default_org_id:'o1',workspaces:[{org_id:'o1',slug:'mccluster',kind:'studio',role:'owner',enabled:true,name:'McCluster'}]});
      return json(route,{ok:true,threads:[],apps:[],events:[],jobs:[],tools:[],decisions:[],leads:[],total:0});
    }
    if(u.hostname==='fixture-storage.invalid'){db.stemFetches++;const s=p.split('/').pop().replace('.wav','');return route.fulfill({status:200,contentType:'audio/wav',headers:{'access-control-allow-origin':'*'},body:WAVS[s]});}
    if(u.hostname.endsWith('supabase.co')){
      if(p==='/auth/v1/user')return json(route,{id:OWNER,email:'owner@fixture.invalid'});
      if(p==='/functions/v1/music-access'){
        const b=req.postDataJSON()||{};db.calls.push(b);
        if(!owner)return json(route,{error:'operator permission required'},403);
        if(b.action==='operator-dashboard')return json(route,{ok:true,tracks:[],creators:[],offers:[]});
        if(b.action==='operator-stems-list'){
          if(b.track_key!=='test-drive')return json(route,{ok:true,track_key:b.track_key,stems:[]});
          return json(route,{ok:true,track_key:'test-drive',model:'htdemucs_6s',format:'mp3',seconds:6,expires_in:900,stems:STEMS.map(s=>({stem:s,bytes:3800000,seconds:6,peak_dbfs:-1.2,rms_dbfs:-17.5,url:`https://fixture-storage.invalid/stems/test-drive/${s}.wav`,download_url:`https://fixture-storage.invalid/stems/test-drive/${s}.wav?download=test-drive-${s}.mp3`}))});
        }
        if(b.action==='operator-stems-queue')return json(route,{ok:true,queued:true,job_id:'j1'});
        return json(route,{ok:true});
      }
      return json(route,[]);
    }
    if(u.origin===BASE){
      const rel=p==='/'?'index.html':decodeURIComponent(p.replace(/^\//,''));
      if(/^assets\/(audio|video)\//.test(rel))return route.fulfill({status:404,body:''});
      const file=resolve(ROOT,rel);if(!file.startsWith(resolve(ROOT)+sep))return route.abort();
      try{return route.fulfill({body:await readFile(file),contentType:TYPES[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
    }
    return route.abort();
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  return {ctx,page,db,errors};
}
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
async function openStems(page){
  await page.goto(`${BASE}/control.html#create:music`,{waitUntil:'domcontentloaded'});
  await page.locator('[data-crom-section="stems"]').waitFor({timeout:30000});
  await page.locator('[data-crom-section="stems"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-crs-pick] option').length>5,null,{timeout:15000});
}
const gains=page=>page.evaluate(()=>{const g=window.CR.stemsPanel.state.gains;return Object.fromEntries(Object.keys(g).map(k=>[k,g[k].gain.value]));});

{
  const {ctx,page,db,errors}=await setup({width:390,height:844});
  await openStems(page);
  await page.selectOption('[data-crs-pick]',{label:'Test Drive — Whip Equipped'});
  await page.locator('[data-crs-play]').waitFor({timeout:20000});
  check('390','all seven files load (six instruments + instrumental)',await page.locator('.crs-stem').count()===7&&db.stemFetches===7,{fetches:db.stemFetches});
  check('390','a download for every stem',await page.locator('.crs-stem a[download]').count()===7,{});
  let g=await gains(page);
  check('390','the full mix plays by default: every instrument up, the instrumental bus silent',['vocals','drums','bass','guitar','piano','other'].every(k=>g[k]===1)&&g.instrumental===0,g);
  await page.locator('[data-crs-play]').click();await page.waitForTimeout(900);
  const t=await page.evaluate(()=>window.CR.stemsPanel._test.now());
  check('390','Play runs every stem on one clock',t>0.4&&await page.evaluate(()=>window.CR.stemsPanel.state.sources.length)===7,{t});
  await page.locator('[data-crs-solo="drums"]').click();
  g=await gains(page);
  check('390','Solo drums: only the drums sound',g.drums===1&&['vocals','bass','guitar','piano','other','instrumental'].every(k=>g[k]===0),g);
  await page.locator('[data-crs-solo="drums"]').click();await page.locator('[data-crs-mute="vocals"]').click();
  g=await gains(page);
  check('390','Mute vocals: everything else stays',g.vocals===0&&g.drums===1&&g.bass===1,g);
  await page.locator('[data-crs-mute="vocals"]').click();await page.locator('[data-crs-solo="instrumental"]').click();
  g=await gains(page);
  check('390','Play alone on the instrumental',g.instrumental===1&&g.vocals===0&&g.drums===0,g);
  await page.locator('[data-crs-play]').click();
  check('390','Pause stops every source',await page.evaluate(()=>window.CR.stemsPanel.state.playing===false&&window.CR.stemsPanel.state.sources.length===0),{});
  check('390','no sideways scroll',(await overflow(page))===0,{});
  const small=await page.evaluate(()=>[...document.querySelectorAll('[data-crs-pick]')].filter(e=>parseFloat(getComputedStyle(e).fontSize)<16).length);
  check('390','the picker is at least 16px',small===0,{small});
  const tiny=await page.evaluate(()=>[...document.querySelectorAll('.crs-btn,[data-crs-play]')].filter(e=>e.getBoundingClientRect().height<44).length);
  check('390','every control is a 44px target',tiny===0,{tiny});
  await page.locator('.crs').screenshot({path:join(OUT,'control-stems-390.png')});
  /* a track with no stems yet */
  await page.selectOption('[data-crs-pick]',{label:'Hundun (B-Side) — Whip Equipped'});
  await page.locator('[data-crs-queue]').waitFor({timeout:10000});
  await page.locator('[data-crs-queue]').click();
  await page.waitForFunction(()=>/Queued on McCluster Core/.test(document.querySelector('.crs-msg').textContent),null,{timeout:10000});
  const q=db.calls.find(c=>c.action==='operator-stems-queue');
  check('390','Separate stems queues Core with the shelf key and its audio',q&&q.track_key==='hundun-b-side'&&q.src==='assets/audio/hundun-b-side.mp3',q);
  check('390','no page errors',errors.length===0,errors.slice(0,5));
  await ctx.close();
}
{
  const {ctx,page,errors}=await setup({width:1280,height:900});
  await openStems(page);
  await page.selectOption('[data-crs-pick]',{label:'Test Drive — Whip Equipped'});
  await page.locator('[data-crs-play]').waitFor({timeout:20000});
  check('desktop','the same seven stems and controls',await page.locator('.crs-stem').count()===7,{});
  check('desktop','no sideways scroll',(await overflow(page))===0,{});
  await page.locator('.crs').screenshot({path:join(OUT,'control-stems-desktop.png')});
  check('desktop','no page errors',errors.length===0,errors.slice(0,5));
  await ctx.close();
}
{
  const {ctx,page,db}=await setup({width:390,height:844},{owner:false});
  await page.goto(`${BASE}/control.html#create:music`,{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2500);
  if(await page.locator('[data-crom-section="stems"]').count()){
    await page.locator('[data-crom-section="stems"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-crs-pick] option').length>5,null,{timeout:15000}).catch(()=>{});
    if(await page.locator('[data-crs-pick] option',{hasText:'Test Drive'}).count()){
      await page.selectOption('[data-crs-pick]',{label:'Test Drive — Whip Equipped'});
      await page.waitForFunction(()=>/operator permission required/.test((document.querySelector('.crs')||{}).textContent||''),null,{timeout:10000}).catch(()=>{});
      check('non-owner','the refusal is shown, not hidden',/operator permission required/.test(await page.locator('.crs').innerText()),{});
    }
  }
  check('non-owner','no stem audio is ever fetched',db.stemFetches===0,{fetches:db.stemFetches});
  await ctx.close();
}
await browser.close();
const failed=results.filter(r=>!r.pass);
console.log(`\n${results.length-failed.length}/${results.length} checks passed`);
process.exit(failed.length?1:0);
