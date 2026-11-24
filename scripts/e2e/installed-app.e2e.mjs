/* Installed iPhone presentation on the actual listening/World documents.
   CDP supplies real CSS env() insets; only navigator.standalone is simulated.
   Every request is intercepted. Audio is a real HTMLAudioElement playing a
   synthetic WAV, and the existing Music/World suites cover the globe itself. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || '/tmp/installed-app-proof';
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright');
const HOUSE = 'https://matthew.mccluster.org', WORLD = 'https://mccluster.org';
const USER = '11111111-1111-4111-8111-111111111111';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.woff2':'font/woff2' };
const DEVICES = [
  { name:'390', viewport:{width:390,height:844}, insets:{top:47,bottom:34,left:0,right:0} },
  { name:'430', viewport:{width:430,height:932}, insets:{top:59,bottom:34,left:0,right:0} },
  { name:'844-landscape', viewport:{width:844,height:390}, insets:{top:0,bottom:21,left:47,right:0} }
];
const checks = [], scenarios = [], staticFiles = new Map();
let browser;
await mkdir(OUT, { recursive:true });
function check(name, pass, detail) {
  checks.push({ name, pass:!!pass, ...(detail === undefined ? {} : {detail}) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : ' ' + JSON.stringify(detail)}`);
  assert.ok(pass, name);
}
const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;
function wav() {
  const rate = 8000, count = rate * 180, bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / rate) * 800), 44 + i * 2);
  return bytes;
}
const AUDIO = wav();
const IMAGE = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const POSTS = [1,2,3].map(n => ({ item_type:'post', post_id:`dddddddd-dddd-4ddd-8ddd-00000000000${n}`, occurred_at:new Date().toISOString(),
  actor:{m_uid:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',mccluster_id:'fixture.ana',display_name:'Fixture Ana'},
  post:{id:`dddddddd-dddd-4ddd-8ddd-00000000000${n}`,body:`Field note ${n}: a neighborhood cleanup, the next meeting, and how to help.`,visibility:'public',created_at:new Date().toISOString(),like_count:n,liked_by_me:false,media:[]} }));
const token = () => 'x.' + Buffer.from(JSON.stringify({sub:USER,exp:Math.floor(Date.now()/1000)+3600,email:'app-proof@fixture.invalid'})).toString('base64url') + '.y';
async function file(path) {
  if (!staticFiles.has(path)) staticFiles.set(path, await readFile(path));
  return staticFiles.get(path);
}
async function setInsets(cdp, insets) {
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets:{...insets,topMax:insets.top,bottomMax:insets.bottom,leftMax:insets.left,rightMax:insets.right} });
}
/* path: the page to open on Matthew's property (Listen when absent). drop(read) stands in for the network on the audio
   reads (the Release 1 dock fix): read = { key, n } (n: that file's nth read); it answers null for the plain bytes,
   { cut } for a short 206 of at most that many bytes of the real file (the browser asks for the rest with a Range
   read) or { status } instead of the bytes. */
async function setup(device, installed, owner = false, world = false, {dockModule = true, path = '', drop = null} = {}) {
  const context = await browser.newContext({viewport:device.viewport,isMobile:true,hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'});
  context.setDefaultTimeout(15000);
  const errors = [], requests = [], blocked = [], reads = {};
  await context.addInitScript(({installed,owner,token,USER}) => {
    Object.defineProperty(navigator, 'standalone', {configurable:true,value:installed});
    try {
      localStorage.setItem('mcc_privacy_ack', JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
      sessionStorage.setItem('mcc_premiere', '1');
      localStorage.setItem('mnet_tour_seen', '1');
      if (owner) localStorage.setItem('mccdb_session', JSON.stringify({access_token:token,refresh_token:'fixture-only',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:USER,email:'app-proof@fixture.invalid'}}));
    } catch {}
    const NativeAudio = window.Audio;
    window.__appAudio = []; window.__appMediaEvents = []; window.__appUnloads = 0;
    window.Audio = function (...args) {
      const a = new NativeAudio(...args); __appAudio.push(a);
      for (const type of ['pause','emptied','seeking']) a.addEventListener(type, () => __appMediaEvents.push({type,media:a,currentTime:a.currentTime}));
      return a;
    };
    window.Audio.prototype = NativeAudio.prototype;
    addEventListener('beforeunload', () => __appUnloads++);
  }, {installed,owner,token:token(),USER});
  const json = (r, body, status = 200) => r.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(body)});
  await context.route('**/*', async r => {
    const req = r.request(), u = new URL(req.url()), p = u.pathname;
    requests.push({origin:u.origin,path:p,method:req.method()});
    if (req.method() === 'OPTIONS') return r.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if (u.hostname === 'api.mccluster.org') {
      if (p === '/v1/status') return json(r, {ok:owner}, owner ? 200 : 403);
      if (p === '/v1/auth/handoff') return json(r, {token_hash:'fixture-one-use-hash'});
      if (p === '/v1/workspaces/me') return json(r, {ok:true,default_org_id:'fixture-org',profile:{id:USER},workspaces:owner ? [{org_id:'fixture-org',slug:'mccluster',name:'McCluster',kind:'studio',role:'owner',enabled:true}] : []});
      if (p === '/v1/mnet/bootstrap') return json(r, {ok:true,profile:{display_name:'Fixture owner',onboarding_complete:true},identity:{m_uid:USER,mccluster_id:'fixture-owner'},needs_onboarding:false,stats:{}});
      if (p === '/v1/mnet/public-feed' || p === '/v1/mnet/feed') return json(r, {items:POSTS,scope:'public',next_before:null});
      if (p === '/v1/world/place-scope') return json(r, {ok:true,enabled:false,country:null});
      if (p === '/v1/world/access') return json(r, {release:{version:'globe-admin-preview/v1',admin_preview:owner},level:owner ? 'admin' : 'public',unlocked_layers:[],locked_layers:[],layers:{}});
      if (p === '/v1/world/environment') return json(r, {ok:true,schema:'world-environment/v1',sources:[],events:[],missions:[]});
      return json(r, {ok:true,items:[],tracks:[],threads:[],posts:[],events:[],missions:[],layers:[],features:[],sources:[],locations:[],rights:{}});
    }
    if (u.hostname.endsWith('supabase.co')) {
      if (p === '/auth/v1/user') return json(r, {id:USER,email:'app-proof@fixture.invalid'});
      if (p === '/auth/v1/token' || p === '/auth/v1/verify') return json(r, {access_token:token(),refresh_token:'fixture-only',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:USER,email:'app-proof@fixture.invalid'}});
      return json(r, []);
    }
    if (u.hostname === 'cesium.com' && process.env.CESIUM_DIR) {
      const rel = p.split('/Build/Cesium/')[1], path = rel && resolve(process.env.CESIUM_DIR, rel);
      if (path && path.startsWith(resolve(process.env.CESIUM_DIR) + sep)) {
        try { return r.fulfill({body:await file(path),contentType:MIME[extname(path)] || 'application/octet-stream'}); } catch {}
      }
    }
    if ([HOUSE,WORLD].includes(u.origin)) {
      if (!dockModule && p === '/js/installed-app-dock.js') return r.abort();
      if (p.startsWith('/assets/audio/')) {
        const range = /bytes=(\d+)-(\d*)/.exec(req.headers().range || '');
        const key = p.split('/').pop(); reads[key] = (reads[key] || 0) + 1;
        const fault = drop ? drop({key,n:reads[key]}) : null;
        if (fault && fault.status) return r.fulfill({status:fault.status,body:''});
        /* a dropped read is this checkout's own MP3: Chromium plays its first bytes, where the stand-in WAV waits for more */
        const real = !!(fault && fault.cut), bytes = real ? await file(resolve(ROOT, '.' + decodeURIComponent(p))) : AUDIO, type = real ? 'audio/mpeg' : 'audio/wav';
        if (range) {
          const start = Number(range[1]);
          let end = Math.min(Number(range[2] || bytes.length - 1), bytes.length - 1);
          if (real) end = Math.min(end, start + fault.cut - 1);
          return r.fulfill({status:206,contentType:type,headers:{'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${bytes.length}`},body:bytes.subarray(start,end+1)});
        }
        return r.fulfill({contentType:type,headers:{'accept-ranges':'bytes'},body:bytes});
      }
      const path = resolve(ROOT, '.' + (p === '/' ? '/mnet.html' : decodeURIComponent(p)));
      if (path.startsWith(resolve(ROOT) + sep)) {
        try { return r.fulfill({body:await file(path),contentType:MIME[extname(path)] || 'application/octet-stream'}); } catch {}
      }
      if (/\.(png|jpe?g|webp|gif)$/.test(p)) return r.fulfill({contentType:'image/gif',body:IMAGE});
      return r.fulfill({status:404,body:'Fixture: missing local file'});
    }
    blocked.push(u.origin); return r.abort();
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  const cdp = await context.newCDPSession(page);
  await setInsets(cdp, device.insets);
  await page.goto(world ? WORLD + '/' : HOUSE + (path || '/listen.html'), {waitUntil:'load'});
  await page.waitForFunction(() => !!window.MCC_BAR && !!window.MCC_WORLD_AUDIO);
  await page.locator('.appbar').waitFor({state:'visible'});
  if (owner) await page.waitForFunction(() => MCC_BAR.admin() && document.querySelectorAll('.appbar [data-appnav]').length >= 10);
  if (installed && dockModule) await page.waitForFunction(() => document.documentElement.classList.contains('mcc-app-dock-ready'));
  if (!world && !path) await page.waitForFunction(() => !!window.MCC_MUSIC && !!document.getElementById('q'));
  await page.evaluate(() => document.fonts.ready);
  return {context,page,cdp,errors,requests,blocked};
}
async function envProbe(page) {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(probe); const cs = getComputedStyle(probe);
    const value = {top:parseFloat(cs.paddingTop),right:parseFloat(cs.paddingRight),bottom:parseFloat(cs.paddingBottom),left:parseFloat(cs.paddingLeft)};
    probe.remove(); return value;
  });
}
async function verifyEnv(page, device, scope) {
  const actual = await envProbe(page);
  check(scope + ': CSS env exposes the emulated device insets', Object.entries(device.insets).every(([key,value]) => near(actual[key],value,.1)), actual);
}
async function musicHeader(page, device, scope) {
  await page.evaluate(() => window.scrollTo(0,0));
  await page.waitForFunction(() => scrollY === 0);
  await page.locator('#mccAuthChip').waitFor({state:'visible'});
  const g = await page.evaluate(() => {
    const r = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    return {scrollY,brand:r('.music-contextbar__brand'),title:r('h1.greet'),auth:r('#mccAuthChip')};
  });
  check(scope + ': initial Music heading and account clear every physical safe edge', g.scrollY === 0 && [g.brand,g.title,g.auth].every(r =>
    r.top >= device.insets.top-.5 && r.left >= device.insets.left-.5 && r.right <= device.viewport.width-device.insets.right+.5), g);
  return g;
}
async function worldGeometry(surface) {
  return surface.evaluate(() => {
    const r = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    return {main:r('.mn'),header:r('.mn__top'),brand:r('.mn__brand'),mark:r('.mn__brand-mark'),headline:r('.wt-headline'),globe:r('#mnWorld'),auth:r('#mccAuthChip'),
      width:innerWidth,height:innerHeight,topOwner:document.documentElement.classList.contains('mcc-app-top'),scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth};
  });
}
function worldSafeEdges(g, device, scope, offset = {x:0,y:0}) {
  check(scope + ': World header, mark, headline and account clear every physical safe edge', [g.header,g.brand,g.mark,g.headline,g.auth].every(r =>
    r.width > 0 && r.height > 0 && offset.y+r.top >= device.insets.top-.5 && offset.x+r.left >= device.insets.left-.5 && offset.x+r.right <= device.viewport.width-device.insets.right+.5), {offset,geometry:g});
}
async function retainedGeometry(page, frame, device, scope) {
  await frame.waitForFunction(() => !!document.getElementById('mccWorldAudioStyle')?.sheet);
  await frame.locator('#mccAuthChip').waitFor({state:'visible'});
  const frameBox = await page.locator('#mccWorldAudioFrame').boundingBox(), child = await worldGeometry(frame);
  check(scope + ': retained World consumes physical insets exactly once', near(frameBox.y,device.insets.top) && near(frameBox.x,device.insets.left) && near(frameBox.x+frameBox.width,device.viewport.width-device.insets.right) &&
    near(frameBox.y+frameBox.height,device.viewport.height) && near(child.main.top,0) && near(child.main.left,0) && near(child.main.right,child.width) && near(child.main.bottom,child.height) && !child.topOwner && child.scrollWidth === child.clientWidth, {frameBox,child});
  worldSafeEdges(child,device,scope,frameBox);
  check(scope + ': retained account uses local spacing without a second device inset', near(child.auth.top,12,.1) && near(child.width-child.auth.right,12,.1), {auth:child.auth,frameBox,childEnv:await envProbe(frame)});
}
async function changeInsets(cdp, page, insets) {
  await setInsets(cdp,insets);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function dockGeometry(page) {
  return page.evaluate(() => {
    const rect = el => el ? el.getBoundingClientRect().toJSON() : null;
    const dock = document.querySelector('.appbar');
    return {dock:rect(dock),tabs:rect(dock.querySelector('.appbar__tabs')),left:rect(dock.querySelector('.appbar__music-left')),right:rect(dock.querySelector('.appbar__music-right')),
      keys:[...dock.querySelectorAll('[data-appnav]')].map(n => n.dataset.appnav),
      targets:[...dock.querySelectorAll('[data-appnav],button[data-app-player]')].filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden').map(n => ({key:n.dataset.appnav || n.dataset.appPlayer,...rect(n)})),
      wrapped:!!dock.querySelector('.appbar__tabs'),direct:dock.parentElement === document.body,
      width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth};
  });
}
async function checkDock(page, scope, baseline, device, active = true) {
  const g = await dockGeometry(page);
  check(scope + ': one compact dock remains a direct body child', g.direct && await page.locator('.appbar').count() === 1 && near(g.dock.height,46,.5), g);
  check(scope + ': dock is about one third shorter than the browser capsule', g.dock.height / baseline >= .63 && g.dock.height / baseline <= .71, {installed:g.dock.height,browser:baseline});
  check(scope + ': every navigation and music target remains at least 44px', g.targets.length >= 3 && g.targets.every(r => r.width >= 43.9 && r.height >= 43.9), g.targets);
  check(scope + ': every displayed target fits inside the dock', g.targets.every(r => r.left >= g.dock.left-.5 && r.right <= g.dock.right+.5 && r.top >= g.dock.top-.5 && r.bottom <= g.dock.bottom+.5), g.targets);
  check(scope + ': dock clears the home indicator and fits horizontally', g.dock.bottom <= g.height - device.insets.bottom + .5 && g.dock.left >= device.insets.left - .5 && g.dock.right <= g.width - device.insets.right + .5 && g.scrollWidth === g.clientWidth, g);
  if (active) check(scope + ': metadata and transport sit beside the middle navigation', g.left.width > 0 && g.right.width > 0 && g.left.right <= g.tabs.left + .5 && g.tabs.right <= g.right.left + .5, g);
  return g;
}
/* Listen lists albums and artists (Matthew, 2026-11-23, "Quick wins" Q2 in docs/music/MUSIC-RELEASE-20261119.md): a song's own play button is in its search results */
async function songButton(page) {
  const sel = '[data-music-play][data-album="here"][data-track="Who Did The Shoot"]';
  if (!(await page.$(sel))) { await page.fill('#q', 'Who Did The Shoot'); await page.waitForSelector(sel); }
  return page.locator(sel).first();
}
async function play(page) {
  await (await songButton(page)).click();
  await page.waitForFunction(() => MCC_MUSIC.current()?.title === 'Who Did The Shoot' && !MCC_MUSIC.audio.paused && MCC_MUSIC.audio.currentTime > .15);
}
async function audio(page) {
  return page.evaluate(() => ({time:MCC_MUSIC.audio.currentTime,src:MCC_MUSIC.audio.currentSrc,paused:MCC_MUSIC.audio.paused,title:MCC_MUSIC.current()?.title,
    real:MCC_MUSIC.audio instanceof HTMLAudioElement,same:!window.__originalAudio || __originalAudio === MCC_MUSIC.audio,unloads:__appUnloads,playing:__appAudio.filter(a => !a.paused && !a.ended).length}));
}
async function metadata(page, scope, surface = 'listen') {
  await page.waitForFunction(() => document.documentElement.classList.contains('mcc-app-dock-active'));
  const state = await page.evaluate(() => ({snapshot:MCC_NOW_PLAYING.snapshot(),title:document.querySelector('[data-app-player="title"]').textContent,artist:document.querySelector('[data-app-player="artist"]').textContent}));
  check(scope + ': dock describes the existing Now Playing owner', state.snapshot?.surface === surface && !!state.snapshot.title && state.title === state.snapshot.title && state.artist === state.snapshot.artist && state.snapshot.canPlay && state.snapshot.canPause, state);
}
async function retainedWorld(page) {
  await page.locator('.appbar [data-appnav="world"]').click();
  await page.waitForFunction(() => MCC_WORLD_AUDIO.active());
  const frame = await (await page.$('#mccWorldAudioFrame')).contentFrame();
  await frame.locator('body[data-world-audio-child="ready"]').waitFor();
  await page.locator('.world-audio-status').waitFor({state:'hidden'});
  return frame;
}
async function noErrors(run, scope) {
  check(scope + ': no page script errors', run.errors.length === 0, run.errors);
  scenarios.push({name:scope,requests:run.requests.length,blockedOrigins:[...new Set(run.blocked)],errors:run.errors});
}
async function failed(run, scope, error) {
  await run.page.screenshot({path:join(OUT,`failure-${scope.replace(/[^a-z0-9-]+/gi,'-')}.png`)}).catch(() => {});
  scenarios.push({name:scope,errors:run.errors,error:String(error.stack || error)});
  throw error;
}
async function browserBaseline(device) {
  const run = await setup(device,false), {page,cdp,context} = run, scope = device.name + ' browser';
  try {
    await verifyEnv(page,device,scope);
    await musicHeader(page,device,scope);
    const before = await dockGeometry(page);
    check(scope + ': browser keeps its unwrapped three-tab bar', !before.wrapped && before.keys.join(',') === 'music,home,world' && near(before.dock.height,68.4,1), before);
    check(scope + ': installed classes and dock are absent', await page.evaluate(() => !document.documentElement.classList.contains('mcc-installed-app') && !document.documentElement.classList.contains('mcc-app-top') && !document.getElementById('mccInstalledDock')));
    await setInsets(cdp,{top:0,bottom:0,left:0,right:0});
    const withoutInset = await dockGeometry(page);
    await setInsets(cdp,device.insets);
    check(scope + ': a safe-area value does not change browser bar height', near(before.dock.height,withoutInset.dock.height,.1), {before:before.dock.height,withoutInset:withoutInset.dock.height});
    await play(page); const frame = await retainedWorld(page);
    const frameBox = await page.locator('#mccWorldAudioFrame').boundingBox();
    check(scope + ': retained browser World still fills the original viewport', near(frameBox.x,0,.1) && near(frameBox.y,0,.1) && near(frameBox.width,device.viewport.width,.1) && near(await frame.locator('.mn').evaluate(n => n.getBoundingClientRect().top),0,.1), frameBox);
    await frame.locator('#mccAuthChip').waitFor({state:'visible'});
    const browserAccount = await frame.locator('#mccAuthChip').boundingBox();
    check(scope + ': browser account retains its existing env-based position', near(browserAccount.y,Math.max(12,device.insets.top)) && near(device.viewport.width-browserAccount.x-browserAccount.width,Math.max(12,device.insets.right)), browserAccount);
    const after = await dockGeometry(page);
    check(scope + ': music and World preserve the browser bar geometry', !after.wrapped && near(after.dock.height,before.dock.height,.1) && after.scrollWidth === after.clientWidth, after);
    await noErrors(run,scope); return before.dock.height;
  } catch (error) { await failed(run,scope,error); }
  finally { await context.close(); }
}
async function installedMusic(device, baseline) {
  const run = await setup(device,true), {page,cdp,context} = run, scope = device.name + ' installed Music';
  try {
    await verifyEnv(page,device,scope);
    await musicHeader(page,device,scope);
    await page.screenshot({path:join(OUT,`installed-${device.name}-music-initial.png`)});
    await play(page); await metadata(page,scope);
    const dock = await checkDock(page,scope,baseline,device);
    check(scope + ': the three guest destinations remain in their original order', dock.keys.join(',') === 'music,home,world', dock.keys);
    check(scope + ': the old floating music strip is hidden', await page.locator('.music-mini').isHidden());
    await page.evaluate(() => { window.__originalAudio = MCC_MUSIC.audio; window.__retentionStart = __appMediaEvents.length; });
    const before = await audio(page), frame = await retainedWorld(page);
    await page.waitForFunction(t => MCC_MUSIC.audio.currentTime > t + .25, before.time);
    const after = await audio(page);
    check(scope + ': World retains the exact advancing Audio element', before.real && after.same && !after.paused && after.playing === 1 && after.unloads === 0 && after.src === before.src && after.time > before.time, {before,after});
    check(scope + ': World entry never pauses, seeks or resets the playing source', await page.evaluate(() => __appMediaEvents.slice(__retentionStart).every(e => e.media !== __originalAudio)));
    await retainedGeometry(page,frame,device,scope);
    await frame.locator('html.mcc-app-dock-remote').waitFor();
    check(scope + ': only the parent navigation and integrated player remain visible', await frame.locator('.appbar').isHidden() && await frame.locator('#mnNowPlaying').isHidden() && await frame.locator('#mnWorldPlay').isHidden() && await page.locator('#mccWorldAudioControls').isHidden());
    await metadata(page,scope + ' in World'); await checkDock(page,scope + ' in World',baseline,device);
    await page.screenshot({path:join(OUT,`installed-${device.name}-world-with-music.png`)});
    if (device.insets.left !== device.insets.right) {
      const mirrored = {...device,insets:{...device.insets,left:device.insets.right,right:device.insets.left}};
      await changeInsets(cdp,page,mirrored.insets);
      await retainedGeometry(page,frame,mirrored,scope + ' right notch');
      await checkDock(page,scope + ' right notch',baseline,mirrored);
      await page.screenshot({path:join(OUT,`installed-${device.name}-world-right-notch.png`)});
      await changeInsets(cdp,page,device.insets);
    }
    await page.locator('[data-app-player="play"]').click();
    await page.waitForFunction(() => MCC_MUSIC.audio.paused);
    const paused = await audio(page); await page.waitForTimeout(250);
    check(scope + ': pause retains metadata and a working resume control', (await audio(page)).paused && near((await audio(page)).time,paused.time,.05) && await page.locator('[data-app-player="play"]').getAttribute('aria-label') === 'Play music' && await page.locator('[data-app-player="title"]').textContent() === paused.title, paused);
    await page.locator('[data-app-player="play"]').click();
    await page.waitForFunction(t => !MCC_MUSIC.audio.paused && MCC_MUSIC.audio.currentTime > t + .15, paused.time);
    await page.locator('[data-app-player="next"]').click();
    await page.waitForFunction(() => MCC_MUSIC.current()?.title === 'Runway Walk' && !MCC_MUSIC.audio.paused);
    await metadata(page,scope + ' next track');
    await page.locator('[data-app-player="previous"]').click();
    await page.waitForFunction(() => MCC_MUSIC.current()?.title === 'Who Did The Shoot' && !MCC_MUSIC.audio.paused);
    await metadata(page,scope + ' previous track');
    check(scope + ': next and previous use the same real player', (await audio(page)).same && (await audio(page)).playing === 1);
    // Closing the overlay starts history.back(); its restored scroll must
    // finish before the header proof deliberately returns to the page top.
    await Promise.all([
      page.waitForURL(url => !url.searchParams.has('world')),
      page.locator('.appbar [data-appnav="music"]').click()
    ]);
    await page.waitForFunction(() => !MCC_WORLD_AUDIO.active());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    check(scope + ': returning to Music preserves the document and playback', (await audio(page)).same && (await audio(page)).unloads === 0 && !(await audio(page)).paused);
    await musicHeader(page,device,scope + ' after returning');
    await page.screenshot({path:join(OUT,`installed-${device.name}-music.png`)});
    await noErrors(run,scope);
  } catch (error) { await failed(run,scope,error); }
  finally { await context.close(); }
}
async function directWorld(device, baseline) {
  const run = await setup(device,true,false,true), {page,cdp,context} = run, scope = device.name + ' installed World';
  try {
    await verifyEnv(page,device,scope);
    await page.locator('#mccAuthChip').waitFor({state:'visible'});
    const read = () => worldGeometry(page);
    const g = await read();
    worldSafeEdges(g,device,scope);
    check(scope + ': inset World ends at the viewport without overflow', near(g.main.top,device.insets.top) && near(g.main.left,device.insets.left) && near(g.main.right,g.width-device.insets.right) && near(g.main.bottom,g.height) && near(g.globe.top,device.insets.top) && g.scrollWidth === g.clientWidth, g);
    await page.locator('#mnWorldPlay').click();
    await page.waitForFunction(() => MCC_NOW_PLAYING.snapshot()?.surface === 'world' && MCC_NOW_PLAYING.snapshot().playing);
    await metadata(page,scope,'world'); await checkDock(page,scope,baseline,device);
    check(scope + ': direct World moves its title and play control into the dock', await page.locator('#mnNowPlaying').isHidden() && await page.locator('#mnWorldPlay').isHidden());
    await page.screenshot({path:join(OUT,`installed-${device.name}-direct-world.png`)});
    await page.locator('#mnFeedScope [data-feed-scope="equity"]').click();
    await page.waitForFunction(() => window.MCC_FEED_SCOPE?.get?.() === 'equity');
    await page.locator('.mn__world-expand').click();
    await page.waitForFunction(() => document.documentElement.classList.contains('wt-expanded'));
    const expanded = await read();
    check(scope + ': expanded globe honors the same physical insets', near(expanded.globe.top,device.insets.top) && near(expanded.globe.left,device.insets.left) && near(expanded.globe.right,device.viewport.width-device.insets.right) && expanded.globe.bottom <= expanded.height + .5, expanded);
    if (device.insets.left !== device.insets.right) {
      const mirrored = {...device,insets:{...device.insets,left:device.insets.right,right:device.insets.left}};
      await changeInsets(cdp,page,mirrored.insets);
      const rotated = await read();
      worldSafeEdges(rotated,mirrored,scope + ' right notch');
      check(scope + ': expanded globe also clears a notch on the right', near(rotated.globe.left,mirrored.insets.left) && near(rotated.globe.right,device.viewport.width-mirrored.insets.right) && near(rotated.main.left,mirrored.insets.left) && near(rotated.main.right,device.viewport.width-mirrored.insets.right) && rotated.scrollWidth === rotated.clientWidth, rotated);
      await changeInsets(cdp,page,device.insets);
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.documentElement.classList.contains('wt-expanded'));
    const shrunk = await read();
    check(scope + ': shrinking restores the original World rectangle', near(shrunk.globe.top,g.globe.top) && near(shrunk.globe.height,g.globe.height) && near(shrunk.main.bottom,g.height), shrunk);
    // Isolate the ordinary destination's CSS scope without invoking sign-in.
    await page.evaluate(() => { document.getElementById('mnFeedView').hidden = true; document.documentElement.classList.remove('mn-world-on'); });
    const sticky = await page.locator('.mn__top').evaluate(n => ({padding:parseFloat(getComputedStyle(n).paddingTop),position:getComputedStyle(n).position,brand:n.querySelector('.mn__brand').getBoundingClientRect().toJSON()}));
    check(scope + ': the ordinary sticky header consumes one inset too', near(sticky.padding,12+device.insets.top,.1) && sticky.position === 'sticky' && sticky.brand.top >= device.insets.top - .5 && sticky.brand.left >= device.insets.left-.5 && sticky.brand.right <= device.viewport.width-device.insets.right+.5, sticky);
    await noErrors(run,scope);
  } catch (error) { await failed(run,scope,error); }
  finally { await context.close(); }
}
async function ownerRegistry(device) {
  let baseline;
  for (const installed of [false,true]) {
    const run = await setup(device,installed,true), {page,context} = run, scope = device.name + (installed ? ' installed owner' : ' browser owner');
    try {
      await musicHeader(page,device,scope);
      await play(page);
      if (installed) await metadata(page,scope);
      const keys = await page.locator('.appbar [data-appnav]').evaluateAll(nodes => nodes.map(n => ({key:n.dataset.appnav,href:n.getAttribute('href')})));
      if (!installed) { baseline = keys; check(scope + ': baseline includes the complete owner registry', keys.length >= 10, keys); }
      else {
        check(scope + ': every owner destination and URL survives in its original order', JSON.stringify(keys) === JSON.stringify(baseline), {baseline,installed:keys});
        const g = await dockGeometry(page);
        check(scope + ': all owner tabs retain full 44px targets in the center scroller', g.targets.filter(t => t.key && !['open','play','previous','next'].includes(t.key)).every(t => t.width >= 43.9 && t.height >= 43.9) && await page.locator('.appbar__tabs').evaluate(n => n.scrollWidth >= n.querySelectorAll('[data-appnav]').length*44-.5 && getComputedStyle(n).overflowX === 'auto'), g);
        check(scope + ': owner dock and center viewport clear the physical screen edges', g.dock.left >= device.insets.left-.5 && g.dock.right <= device.viewport.width-device.insets.right+.5 && g.tabs.left >= g.dock.left-.5 && g.tabs.right <= g.dock.right+.5 && g.dock.bottom <= device.viewport.height-device.insets.bottom+.5, g);
        for (const {key} of keys) {
          const tab = page.locator(`.appbar [data-appnav="${key}"]`);
          await tab.scrollIntoViewIfNeeded();
          const reachable = await tab.evaluate(n => {
            const box = n.getBoundingClientRect(), clip = n.closest('.appbar__tabs').getBoundingClientRect();
            const x = (box.left+box.right)/2, y = (box.top+box.bottom)/2, hit = document.elementFromPoint(x,y);
            return {key:n.dataset.appnav,visible:box.left >= clip.left-.5 && box.right <= clip.right+.5 && box.top >= clip.top-.5 && box.bottom <= clip.bottom+.5,hit:!!hit && (hit === n || n.contains(hit)),width:box.width,height:box.height};
          });
          check(scope + ': ' + key + ' can be reached without shrinking or deleting tabs', reachable.visible && reachable.hit, reachable);
        }
        check(scope + ': owner dock does not create page overflow', await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth));
        await musicHeader(page,device,scope + ' with dock');
        await page.screenshot({path:join(OUT,`installed-${device.name}-owner-dock.png`)});
      }
      await noErrors(run,scope);
    } catch (error) { await failed(run,scope,error); }
    finally { await context.close(); }
  }
}
async function fallbackTransport(device) {
  const mirrored = {...device,insets:{...device.insets,left:device.insets.right,right:device.insets.left}};
  const run = await setup(mirrored,true,false,false,{dockModule:false}), {page,context} = run, scope = device.name + ' right-notch fallback';
  try {
    await verifyEnv(page,mirrored,scope);
    await play(page);
    const frame = await retainedWorld(page);
    await retainedGeometry(page,frame,mirrored,scope);
    await page.locator('#mccWorldAudioControls').waitFor({state:'visible'});
    await page.waitForFunction(() => {
      const controls = document.getElementById('mccWorldAudioControls');
      return !!controls?.style.top && !!controls.style.right;
    });
    const frameBox = await page.locator('#mccWorldAudioFrame').boundingBox();
    const expand = await frame.locator('.mn__world-expand').evaluate(n => n.getBoundingClientRect().toJSON());
    const controls = await page.locator('#mccWorldAudioControls').boundingBox();
    check(scope + ': unavailable dock keeps the existing transport usable', await page.locator('#mccInstalledDock').count() === 0 && !(await audio(page)).paused && controls.width >= 44 && controls.height >= 44, controls);
    check(scope + ': fallback transport translates both frame coordinates once', near(controls.y,frameBox.y+Math.max(67,Math.round(expand.top-60))) && near(controls.x+controls.width,frameBox.x+expand.right) && controls.x+controls.width <= mirrored.viewport.width-mirrored.insets.right+.5, {controls,frameBox,expand});
    await page.screenshot({path:join(OUT,`installed-${device.name}-right-notch-fallback.png`)});
    await noErrors(run,scope);
  } catch (error) { await failed(run,scope,error); }
  finally { await context.close(); }
}

/* ---------- ONE PLAY/PAUSE, AND MUTED IN ONE ROW (the Release 1 dock fix, 2026-11-23) ----------
   Matthew's direction of 2026-11-23: the bar's Music button pauses everywhere (one player), and the installed dock
   shows one Pause, not two.
   Release 1 carries 73349a06, which made the red Music tab Listen's Play/Pause beside the dock's own (two controls
   named "Pause music") and grew the dock a status row for every word the player said, Muted included. Where the tab
   is the page's Play/Pause (Listen) it is the one control; where it is the way to the music (the album, where it
   opens the shelf as before; the World over the music) the dock's own is, and the tab wears no second pause glyph.
   Muted lasts, so it is said in the song line's second line, one row; the trouble words keep the status row. Phone
   first: 390 and 320 wide.
   The verification of 4e2d4352 found three ways the one control still failed, each checked below: in the house
   owner's strip (ten tabs scrolling in 132 px) the Music tab scrolled out of reach and left the dock with none
   (DFV-1); on Listen a World song carried back from the Globe while Listen held a record left two, the tab for the
   record and the dock's own for the song (DFV-2); and the tab's play triangle at rest, the only Play once the dock's
   own was gone, was the room's grey on its red coin, about 1.2:1 (DFV-3). */
const PHONES = [
  { name:'390', viewport:{width:390,height:844}, insets:{top:47,bottom:34,left:0,right:0} },
  { name:'320', viewport:{width:320,height:568}, insets:{top:20,bottom:0,left:0,right:0} }
];
const PAUSE_PATH = 'M6 5h4v14H6zM14 5h4v14h-4z', PLAY_PATH = 'M8 5l11 7-11 7z';
/* every control the bar shows (its tabs and the dock's buttons): its label and the glyph it draws, "pause" (two bars),
   "play" (a triangle) or null. The Music tab draws in CSS (::before), the dock's buttons in SVG. */
async function barControls(page) {
  return page.evaluate(({PAUSE_PATH,PLAY_PATH}) => [...document.querySelectorAll('.appbar a[data-appnav],.appbar button[data-app-player]')]
    .filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden')
    .map(n => {
      let drawn = null, ink = null;
      if (n.matches('button')) { const d = n.querySelector('svg path')?.getAttribute('d'); drawn = d === PAUSE_PATH ? 'pause' : d === PLAY_PATH ? 'play' : null; }
      else if (n.dataset.appnav === 'music') {
        const b = getComputedStyle(n,'::before');
        drawn = !b.content || b.content === 'none' ? null : /gradient/.test(b.backgroundImage) ? 'pause' : /polygon/.test(b.clipPath) ? 'play' : null;
        ink = b.color; /* both glyphs are drawn in the pseudo-element's currentColor */
      }
      return {key:n.dataset.appnav || n.dataset.appPlayer,label:n.getAttribute('aria-label'),drawn,ink};
    }), {PAUSE_PATH,PLAY_PATH});
}
/* how many controls in the bar a screen reader is told start with these words (the accessible name, as Playwright
   computes it; a control that is not shown is not counted) */
async function named(page, words) {
  const bar = page.locator('.appbar');
  return await bar.getByRole('button',{name:words}).count() + await bar.getByRole('link',{name:words}).count();
}
async function musicTab(page) {
  const s = (await page.locator('.appbar [data-appnav="music"]').ariaSnapshot()).trim(), m = /^- (\w+) "([^"]*)"/.exec(s);
  return m ? `${m[1]} "${m[2]}"` : s;
}
/* the bar's Play/Pause controls a listener can see and reach: shown, inside the strip's window when they sit in it (a
   tab scrolled out of the owner's strip is not on screen), and the element a tap at their centre lands on */
async function reachablePlayPause(page) {
  return page.evaluate(() => [...document.querySelectorAll('.appbar a[data-appnav],.appbar button[data-app-player]')].filter(n => {
    if (!/^(Play|Pause) music/.test(n.getAttribute('aria-label') || '') || !n.getClientRects().length || getComputedStyle(n).visibility === 'hidden') return false;
    const r = n.getBoundingClientRect(), strip = n.closest('.appbar__tabs'), c = strip && strip.getBoundingClientRect();
    if (c && (r.left < c.left - .5 || r.right > c.right + .5)) return false;
    const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return !!hit && (hit === n || n.contains(hit));
  }).map(n => `${n.dataset.appnav || n.dataset.appPlayer}:${n.getAttribute('aria-label')}`));
}
/* waits until the Music tab's name (its label, else its words) matches */
const tabSays = (page, words) => page.waitForFunction(w => {
  const t = document.querySelector('.appbar [data-appnav="music"]');
  return !!t && new RegExp(w).test(t.getAttribute('aria-label') || t.textContent.trim());
}, words);
const painted = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function dockState(page) {
  return page.evaluate(() => {
    const d = document.querySelector('.appbar'), q = s => d.querySelector(s);
    const box = el => { if (!el || !el.getClientRects().length) return null; const r = el.getBoundingClientRect(); return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height}; };
    const status = q('[data-app-player="status"]'), shown = !!status && getComputedStyle(status).display !== 'none';
    return {height:d.getBoundingClientRect().height,dock:box(d),title:q('[data-app-player="title"]')?.textContent ?? null,
      artist:q('[data-app-player="artist"]')?.textContent ?? null,label:q('[data-app-player="open"]')?.getAttribute('aria-label') ?? null,
      status:shown ? status.textContent : null,statusBox:shown ? box(status) : null,statusWhole:shown ? status.scrollWidth <= status.clientWidth : null,
      previous:box(q('[data-app-player="previous"]')),next:box(q('[data-app-player="next"]')),
      snapshot:window.MCC_NOW_PLAYING && MCC_NOW_PLAYING.snapshot(),
      scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth};
  });
}
async function listenOnePause(phone) {
  const run = await setup(phone,true), {page,context} = run, scope = phone.name + ' installed Listen';
  try {
    await play(page);
    await page.waitForFunction(() => document.documentElement.classList.contains('mcc-app-dock-active'));
    await tabSays(page,'^Pause');
    let c = await barControls(page);
    check(scope + ', a song playing: exactly one control in the bar is named Pause, the red Music tab (73349a06 left the dock\'s own beside it)',
      await named(page,/^Pause/) === 1 && await musicTab(page) === 'link "Pause music"', c);
    check(scope + ', a song playing: exactly one control in the bar is drawn as Pause', c.filter(x => x.drawn === 'pause').map(x => x.key).join() === 'music', c);
    check(scope + ': the dock shows no Play/Pause of its own beside the Music tab', !c.some(x => x.key === 'play'), c);
    let s = await dockState(page);
    check(scope + ': the dock stays one row, 46 px, with Previous, the song line and Next', near(s.height,46,1) && !s.status && !!s.title && !!s.previous && !!s.next, s);
    const g = await dockGeometry(page);
    check(scope + ': every target shown is at least 44 px and inside the dock', g.targets.length >= 6 && g.targets.every(r => r.width >= 43.9 && r.height >= 43.9 && r.left >= g.dock.left-.5 && r.right <= g.dock.right+.5), g.targets);
    check(scope + ': the page fits (scrollWidth === clientWidth)', g.scrollWidth === g.clientWidth, g);
    await page.screenshot({path:join(OUT,`one-pause-${phone.name}-listen-playing.png`)});
    /* the one control pauses and plays, with the truthful glyph and name */
    await page.locator('.appbar [data-appnav="music"]').click();
    await page.waitForFunction(() => MCC_MUSIC.audio.paused);
    await tabSays(page,'^Play');
    c = await barControls(page);
    check(scope + ', paused from the Music tab: it is the one control named Play and drawn as Play; nothing is named or drawn Pause',
      await named(page,/^Pause/) === 0 && await named(page,/^Play music/) === 1 && await musicTab(page) === 'link "Play music"' &&
      c.find(x => x.key === 'music')?.drawn === 'play' && !c.some(x => x.drawn === 'pause' || x.key === 'play'), c);
    /* the one Play there is the tab's triangle on its red coin: white, as its pause glyph is, never the room's grey
       (css/music-system-v2.css), which the red all but swallows (DFV-3: rgb(119, 120, 126) at 4e2d4352, about 1.2:1) */
    check(scope + ', paused from the Music tab: its play triangle is white on its red coin, as its pause glyph is',
      c.find(x => x.key === 'music')?.ink === 'rgb(255, 255, 255)' && await page.locator('.appbar [data-appnav="music"]').evaluate(n => n.classList.contains('is-here')), c);
    s = await dockState(page);
    check(scope + ', paused: the dock keeps the song line, one row', near(s.height,46,1) && s.title === (await audio(page)).title, s);
    await page.locator('.appbar [data-appnav="music"]').click();
    await page.waitForFunction(() => !MCC_MUSIC.audio.paused);
    await tabSays(page,'^Pause');
    check(scope + ', played again from the Music tab: one control named Pause again', await named(page,/^Pause/) === 1 && await musicTab(page) === 'link "Pause music"');
    /* the World over the music: there the Music tab is the way back, so the dock's own Play/Pause is the one control */
    await retainedWorld(page);
    await tabSays(page,'^Music$');
    c = await barControls(page);
    check(scope + ', the World open over the music: one control named Pause, the dock\'s own; the Music tab is the way back ("Music"), drawn at rest',
      await named(page,/^Pause/) === 1 && await page.locator('.appbar').getByRole('button',{name:'Pause music'}).count() === 1 &&
      await musicTab(page) === 'link "Music"' && c.filter(x => x.drawn === 'pause').map(x => x.key).join() === 'play' && c.find(x => x.key === 'music')?.drawn === 'play', c);
    await Promise.all([page.waitForURL(url => !url.searchParams.has('world')), page.locator('.appbar [data-appnav="music"]').click()]);
    await page.waitForFunction(() => !MCC_WORLD_AUDIO.active());
    await tabSays(page,'^Pause');
    c = await barControls(page);
    check(scope + ', back from the World: the Music tab is the one Pause again', !(await audio(page)).paused && await named(page,/^Pause/) === 1 &&
      await musicTab(page) === 'link "Pause music"' && !c.some(x => x.key === 'play'), c);
    await noErrors(run,scope);
  } catch (error) { await failed(run,scope,error); }
  finally { await context.close(); }
}
async function albumOnePause(phone) {
  const run = await setup(phone,true,false,false,{path:'/album.html?album=here'}), {page,context} = run, scope = phone.name + ' installed album';
  try {
    await page.waitForSelector('#tracks li');
    await page.locator('#tracks li').first().click();
    await page.waitForFunction(() => { const d = document.getElementById('deck'); return !!d && !d.paused && d.currentTime > .15; });
    await page.waitForFunction(() => document.documentElement.classList.contains('mcc-app-dock-active') && document.documentElement.getAttribute('data-app-player-surface') === 'album');
    await page.waitForFunction(() => document.querySelector('.appbar [data-app-player="play"]')?.getAttribute('aria-label') === 'Pause music');
    let c = await barControls(page);
    check(scope + ', a song playing: exactly one control in the bar is named Pause, the dock\'s own; the Music tab stays the way to the shelf ("Music")',
      await named(page,/^Pause/) === 1 && await page.locator('.appbar').getByRole('button',{name:'Pause music'}).count() === 1 && await musicTab(page) === 'link "Music"', c);
    check(scope + ', a song playing: exactly one control in the bar is drawn as Pause (the Music tab wore a second pause glyph)',
      c.filter(x => x.drawn === 'pause').map(x => x.key).join() === 'play', c);
    /* the tab stands on the room it points at, so its coin is the house red: its glyph stays white there, as the pause
       glyph was, never the room's grey that the red all but swallows (css/style.css, css/music-system-v2.css) */
    check(scope + ', a song playing: the Music tab\'s glyph is white on its red coin, as before',
      c.find(x => x.key === 'music')?.ink === 'rgb(255, 255, 255)' && await page.locator('.appbar [data-appnav="music"]').evaluate(n => n.classList.contains('is-here')), c);
    let s = await dockState(page);
    check(scope + ': the dock stays one row, 46 px', near(s.height,46,1) && !s.status && !!s.title, s);
    check(scope + ': the page fits (scrollWidth === clientWidth)', s.scrollWidth === s.clientWidth, s);
    await page.screenshot({path:join(OUT,`one-pause-${phone.name}-album-playing.png`)});
    await page.locator('.appbar [data-app-player="play"]').click();
    await page.waitForFunction(() => document.getElementById('deck').paused && document.querySelector('.appbar [data-app-player="play"]').getAttribute('aria-label') === 'Play music');
    c = await barControls(page);
    check(scope + ', paused from the dock: one control named Play, the dock\'s own; none named or drawn Pause; the Music tab still "Music"',
      await named(page,/^Pause/) === 0 && await named(page,/^Play music/) === 1 && await musicTab(page) === 'link "Music"' && !c.some(x => x.drawn === 'pause'), c);
    await page.locator('.appbar [data-app-player="play"]').click();
    await page.waitForFunction(() => !document.getElementById('deck').paused);
    /* Muted lasts: the album says it in the song line's second line, in one row */
    await page.evaluate(() => { document.getElementById('deck').muted = true; });
    await page.waitForFunction(() => /"Muted"/.test(JSON.stringify(MCC_NOW_PLAYING.snapshot())));
    await painted(page);
    s = await dockState(page);
    check(scope + ', muted: the dock stays one row (46 px), its artist line says Muted and the open button says why it is quiet',
      near(s.height,46,1) && !s.status && s.artist === 'Muted' && s.label === `Open player: ${s.title} — Muted`, s);
    check(scope + ', muted: the page fits', s.scrollWidth === s.clientWidth, s);
    await noErrors(run,scope);
  } catch (error) { await failed(run,scope,error); }
  finally { await context.close(); }
}
async function listenMuted(phone) {
  const run = await setup(phone,true), {page,context} = run, scope = phone.name + ' installed Listen, muted';
  try {
    await play(page);
    await page.waitForFunction(() => document.documentElement.classList.contains('mcc-app-dock-active'));
    const artist = await page.evaluate(() => MCC_NOW_PLAYING.snapshot().artist);
    await page.evaluate(() => { MCC_MUSIC.audio.muted = true; });
    await page.waitForFunction(() => /"Muted"/.test(JSON.stringify(MCC_NOW_PLAYING.snapshot())));
    await painted(page);
    const s = await dockState(page);
    check(scope + ': the dock stays one row, 46 px (73349a06 grew it a status row for Muted)', near(s.height,46,1) && !s.status, s);
    check(scope + ': its artist line says Muted, the engine\'s word', s.artist === 'Muted', s);
    check(scope + ': the open button still says why it is quiet', s.label === `Open player: ${s.title} — Muted`, s);
    check(scope + ': still one Play/Pause, the Music tab', await named(page,/^Pause/) === 1 && await musicTab(page) === 'link "Pause music"');
    check(scope + ': the page fits (scrollWidth === clientWidth)', s.scrollWidth === s.clientWidth, s);
    await page.screenshot({path:join(OUT,`one-pause-${phone.name}-listen-muted.png`)});
    await page.evaluate(() => { MCC_MUSIC.audio.muted = false; });
    await page.waitForFunction(a => document.querySelector('.appbar [data-app-player="artist"]')?.textContent === a, artist);
    const back = await dockState(page);
    check(scope + ', unmuted: the artist line is the artist again, one row', back.artist === artist && near(back.height,46,1) && !back.status, back);
    await noErrors(run,scope);
  } catch (error) { await failed(run,scope,error); }
  finally { await context.close(); }
}
async function listenReconnecting(phone) {
  /* the song's first read stops early and the rest is refused (scripts/e2e/music-background.e2e.mjs drops it the same way) */
  const song = 'who-did-the-shoot.mp3';
  const drop = q => q.key !== song ? null : q.n === 1 ? {cut:96000} : {status:503};
  const run = await setup(phone,true,false,false,{drop}), {page,context} = run, scope = phone.name + ' installed Listen, a drop';
  try {
    /* started from its search results, as play() starts it (Listen lists albums and artists since Quick wins Q2) */
    await (await songButton(page)).click();
    await page.waitForFunction(() => MCC_MUSIC.delivery().state === 'reconnecting', null, {timeout:25000});
    await page.waitForFunction(() => /Reconnecting/.test(document.querySelector('.appbar [data-app-player="status"]')?.textContent || ''), null, {timeout:5000});
    await painted(page);
    const s = await dockState(page);
    check(scope + ': Reconnecting… keeps the status row (73349a06): its whole words across the top of the dock, the controls below it',
      s.status === 'Reconnecting…' && s.statusWhole && s.height > 50 && s.statusBox.l >= s.dock.l - .5 && s.statusBox.r <= s.dock.r + .5 &&
      s.statusBox.b <= s.previous.t + .5 && s.statusBox.b <= s.next.t + .5 && near(s.dock.b,s.next.b,2), s);
    check(scope + ': the song line keeps the title and the artist', s.title === s.snapshot?.title && s.artist === s.snapshot?.artist, s);
    check(scope + ': the one Pause, which stops the tries, is the Music tab', await named(page,/^Pause/) === 1 && await musicTab(page) === 'link "Pause music"');
    check(scope + ': the page fits (scrollWidth === clientWidth)', s.scrollWidth === s.clientWidth, s);
    await page.screenshot({path:join(OUT,`one-pause-${phone.name}-listen-reconnecting.png`)});
    await noErrors(run,scope);
  } catch (error) { await failed(run,scope,error); }
  finally { await context.close(); }
}
/* DFV-1: the house owner's strip scrolls (ten tabs in 132 px, 126 at 320) and its first tab is the Music tab, the one
   Play/Pause on Listen; scrolled to its end, 4e2d4352 left no Play/Pause on screen at all. Pinned at the strip's start
   while it is the Play/Pause (BAR-RESTORE 4.2), it stays in reach, the tabs pass under it, and a tab the keyboard
   moves to comes to rest clear of it. */
async function ownerListenPinned(phone) {
  const run = await setup(phone,true,true), {page,context} = run, scope = phone.name + ' installed owner Listen';
  try {
    await play(page);
    await page.waitForFunction(() => document.documentElement.classList.contains('mcc-app-dock-active'));
    await tabSays(page,'^Pause');
    const strip = page.locator('.appbar__tabs');
    const size = await strip.evaluate(n => ({scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,tabs:n.querySelectorAll('[data-appnav]').length,first:n.querySelector('[data-appnav]').dataset.appnav}));
    check(scope + ': the owner\'s strip scrolls, the Music tab first', size.tabs >= 10 && size.scrollWidth > size.clientWidth + 44 && size.first === 'music', size);
    check(scope + ', a song playing: the one Play/Pause in reach is the Music tab', JSON.stringify(await reachablePlayPause(page)) === '["music:Pause music"]', await reachablePlayPause(page));
    await strip.evaluate(n => { n.scrollLeft = n.scrollWidth; });
    await painted(page); await page.waitForTimeout(300);
    const scrolled = await strip.evaluate(n => n.scrollLeft);
    let reach = await reachablePlayPause(page);
    check(scope + ', the strip scrolled to its end: the one Play/Pause stays in reach, the Music tab pinned at the strip\'s start (4e2d4352 left none on screen)',
      scrolled > 44 && JSON.stringify(reach) === '["music:Pause music"]', {scrolled,reach});
    /* it stands on the bar's own ground: the tab scrolled beneath it does not show through */
    const ground = await page.locator('.appbar [data-appnav="music"]').evaluate(n => getComputedStyle(n).backgroundColor);
    check(scope + ', scrolled: the pinned tab is opaque, the tabs pass under it', /^rgb\(/.test(ground), ground);
    /* a finger on the pinned tab, as on the phone: it pauses, and the strip stays where the owner left it */
    const pin = await page.locator('.appbar [data-appnav="music"]').boundingBox();
    await page.touchscreen.tap(pin.x + pin.width / 2, pin.y + pin.height / 2);
    await page.waitForFunction(() => MCC_MUSIC.audio.paused);
    await tabSays(page,'^Play');
    reach = await reachablePlayPause(page);
    const still = await strip.evaluate(n => n.scrollLeft);
    check(scope + ', paused from the pinned tab: it is the one Play in reach, and the strip has not moved', JSON.stringify(reach) === '["music:Play music"]' && still === scrolled, {reach,scrolled,still});
    await page.touchscreen.tap(pin.x + pin.width / 2, pin.y + pin.height / 2);
    await page.waitForFunction(() => !MCC_MUSIC.audio.paused);
    await tabSays(page,'^Pause');
    check(scope + ', played again: the one Pause in reach', JSON.stringify(await reachablePlayPause(page)) === '["music:Pause music"]');
    /* the keyboard: from the last tab back to the second, every tab focused comes to rest clear of the pinned one */
    await page.locator('.appbar__tabs [data-appnav]').last().focus();
    const steps = [];
    for (let i = 0; i < size.tabs - 2; i++) {
      await page.keyboard.press('ArrowLeft');
      await painted(page); await page.waitForTimeout(120);
      steps.push(await page.evaluate(() => {
        const f = document.activeElement, pin = document.querySelector('.appbar [data-appnav="music"]');
        const r = f.getBoundingClientRect(), p = pin.getBoundingClientRect(), c = f.closest('.appbar__tabs').getBoundingClientRect();
        const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return {key:f.dataset.appnav, clear:f !== pin && r.left >= p.right - .5, inside:r.left >= c.left - .5 && r.right <= c.right + .5, hit:!!hit && (hit === f || f.contains(hit))};
      }));
    }
    check(scope + ': a tab the keyboard moves to is never hidden under the pinned Music tab', steps.length >= 8 && steps.every(s => s.clear && s.inside && s.hit), steps);
    check(scope + ': the page fits (scrollWidth === clientWidth)', await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth));
    await page.screenshot({path:join(OUT,`one-pause-${phone.name}-owner-listen-scrolled.png`)});
    await noErrors(run,scope);
  } catch (error) { await failed(run,scope,error); }
  finally { await context.close(); }
}
/* DFV-2: a returning listener's record held on Listen, the Globe (the World's song starts, as designed) and the Music
   tab back: the World's song plays on Listen. The dock shows that song, so its own Play/Pause is the one control, and
   the tab, which would take up the held record, is the way to the music; 4e2d4352 left both (link "Play music" for
   the record, button "Pause music" for the song). Taking the record up again from its own player gives the tab back
   its Play/Pause. In the browser, which has no dock, the bar keeps the tab as it was. */
async function listenWorldSong(phone, installed = true) {
  const run = await setup(phone,installed), {page,context} = run, scope = phone.name + (installed ? ' installed' : ' browser') + ' Listen, a World song over a held record';
  try {
    await play(page);
    await page.waitForTimeout(400);
    await page.goto(HOUSE + '/listen.html', {waitUntil:'load'});
    await page.waitForFunction(() => !!window.MCC_BAR && !!window.MCC_WORLD_AUDIO && !!window.MCC_MUSIC);
    if (installed) await page.waitForFunction(() => document.documentElement.classList.contains('mcc-app-dock-ready'));
    await page.waitForFunction(() => typeof window.MCC_NP_PLAY === 'function' && !MCC_MUSIC.current() && /Pick up at/.test(document.getElementById('musicMiniAlbum')?.textContent || ''));
    await tabSays(page,'^Play music$');
    await retainedWorld(page);
    await page.waitForFunction(() => MCC_NOW_PLAYING.snapshot()?.surface === 'world' && MCC_NOW_PLAYING.snapshot().playing);
    await Promise.all([page.waitForURL(url => !url.searchParams.has('world')), page.locator('.appbar [data-appnav="music"]').click()]);
    await page.waitForFunction(() => !MCC_WORLD_AUDIO.active());
    await page.waitForFunction(() => MCC_NOW_PLAYING.snapshot()?.surface === 'world' && MCC_NOW_PLAYING.snapshot().playing && !MCC_MUSIC.current());
    await painted(page);
    if (!installed) {
      check(scope + ': the browser keeps its bar as it was: the Music tab is still the held record\'s Play (link "Play music")', await musicTab(page) === 'link "Play music"' && !(await page.$('[data-app-player]')));
      await noErrors(run,scope); return;
    }
    await page.waitForFunction(() => document.documentElement.getAttribute('data-app-player-surface') === 'world');
    let c = await barControls(page);
    check(scope + ': the World\'s song plays on Listen, and the dock holds one Play/Pause, its own; the Music tab is the way to the music (4e2d4352 also made it "Play music" for the held record)',
      await named(page,/^(Play|Pause) music/) === 1 && await page.locator('.appbar').getByRole('button',{name:'Pause music'}).count() === 1 &&
      await musicTab(page) === 'link "Music"' && c.filter(x => x.drawn === 'pause').map(x => x.key).join() === 'play', c);
    await page.screenshot({path:join(OUT,`one-pause-${phone.name}-listen-world-song.png`)});
    await page.locator('.appbar [data-app-player="play"]').click();
    await page.waitForFunction(() => MCC_NOW_PLAYING.snapshot()?.surface === 'world' && !MCC_NOW_PLAYING.snapshot().playing);
    await page.waitForFunction(() => document.querySelector('.appbar [data-app-player="play"]')?.getAttribute('aria-label') === 'Play music');
    check(scope + ', the song paused from the dock: one control named Play, the dock\'s own; the Music tab still "Music"',
      await named(page,/^(Play|Pause) music/) === 1 && await page.locator('.appbar').getByRole('button',{name:'Play music'}).count() === 1 && await musicTab(page) === 'link "Music"');
    await page.locator('#musicMiniPlay').click();
    await page.waitForFunction(() => !!MCC_MUSIC.current() && !MCC_MUSIC.audio.paused && MCC_NOW_PLAYING.snapshot()?.surface === 'listen');
    await tabSays(page,'^Pause');
    c = await barControls(page);
    check(scope + ', the held record taken up from its own player: the Music tab is the one Play/Pause again, the dock shows none of its own',
      await named(page,/^(Play|Pause) music/) === 1 && await musicTab(page) === 'link "Pause music"' && !c.some(x => x.key === 'play'), c);
    check(scope + ': the page fits (scrollWidth === clientWidth)', await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth));
    await noErrors(run,scope);
  } catch (error) { await failed(run,scope,error); }
  finally { await context.close(); }
}
async function browserListen(phone) {
  const run = await setup(phone,false), {page,context} = run, scope = phone.name + ' browser Listen';
  try {
    await play(page);
    await tabSays(page,'^Pause');
    const g = await dockGeometry(page);
    check(scope + ': the ordinary capsule bar, as before: unwrapped, 68.4 px, the three tabs, no dock and no installed classes',
      !g.wrapped && near(g.dock.height,68.4,1) && g.keys.join(',') === 'music,home,world' &&
      await page.evaluate(() => !document.getElementById('mccInstalledDock') && !document.documentElement.classList.contains('mcc-installed-app') && !document.querySelector('[data-app-player]')), g);
    check(scope + ', a song playing: the Music tab is the Play/Pause (link "Pause music", 73349a06), the only control in the bar named Pause',
      await musicTab(page) === 'link "Pause music"' && await named(page,/^Pause/) === 1);
    check(scope + ': the mini player stays above the bar, as before', await page.locator('.music-mini').isVisible());
    await page.locator('.appbar [data-appnav="music"]').click();
    await page.waitForFunction(() => MCC_MUSIC.audio.paused);
    await tabSays(page,'^Play');
    check(scope + ': a tap on the Music tab pauses the song, and it is then link "Play music"', await musicTab(page) === 'link "Play music"' && await named(page,/^Pause/) === 0);
    await page.locator('.appbar [data-appnav="music"]').click();
    await page.waitForFunction(() => !MCC_MUSIC.audio.paused);
    await tabSays(page,'^Pause');
    check(scope + ': another tap plays it again', await musicTab(page) === 'link "Pause music"');
    check(scope + ': the page fits (scrollWidth === clientWidth)', g.scrollWidth === g.clientWidth, g);
    await noErrors(run,scope);
  } catch (error) { await failed(run,scope,error); }
  finally { await context.close(); }
}
const DOCK_FIX = [['installed Listen one Play/Pause',listenOnePause],['installed album one Play/Pause',albumOnePause],
  ['installed Listen muted',listenMuted],['installed Listen reconnecting',listenReconnecting],['browser Listen',browserListen],
  ['installed owner Listen pinned',ownerListenPinned],['installed Listen World song',phone => listenWorldSong(phone,true)],
  ['browser Listen World song',phone => listenWorldSong(phone,false)]];
/* INSTALLED_APP_ONLY=<words>[|<words>] runs only the dock-fix scenarios whose name ("390 installed Listen muted") holds
   them, a local check of one fix; unset, the whole suite runs */
const ONLY = (process.env.INSTALLED_APP_ONLY || '').split('|').filter(Boolean);
try {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox','--autoplay-policy=document-user-activation-required','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
  if (!ONLY.length) {
    for (const device of DEVICES) {
      const baseline = await browserBaseline(device);
      await installedMusic(device,baseline);
      await directWorld(device,baseline);
      await ownerRegistry(device);
    }
    await fallbackTransport(DEVICES.find(device => device.insets.left !== device.insets.right));
  }
  /* each dock-fix scenario runs to its first failing check; the next one still runs */
  for (const phone of PHONES) for (const [name,fn] of DOCK_FIX) {
    if (ONLY.length && !ONLY.some(words => `${phone.name} ${name}`.includes(words))) continue;
    try { await fn(phone); } catch (error) { process.exitCode = 1; console.error(`${phone.name} ${name}: ${String(error.message || error).split('\n')[0]}`); }
  }
} catch (error) {
  process.exitCode = 1;
  checks.push({name:'suite completed',pass:false,error:String(error.stack || error)});
  console.error(error.stack || error);
} finally {
  await browser?.close();
  await writeFile(join(OUT,'report.json'), JSON.stringify({pass:!process.exitCode,checks,scenarios},null,2));
}
