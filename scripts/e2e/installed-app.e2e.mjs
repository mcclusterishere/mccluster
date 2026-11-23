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
async function setup(device, installed, owner = false, world = false, {dockModule = true} = {}) {
  const context = await browser.newContext({viewport:device.viewport,isMobile:true,hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'});
  context.setDefaultTimeout(15000);
  const errors = [], requests = [], blocked = [];
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
        if (range) {
          const start = Number(range[1]), end = Math.min(Number(range[2] || AUDIO.length - 1), AUDIO.length - 1);
          return r.fulfill({status:206,contentType:'audio/wav',headers:{'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${AUDIO.length}`},body:AUDIO.subarray(start,end+1)});
        }
        return r.fulfill({contentType:'audio/wav',headers:{'accept-ranges':'bytes'},body:AUDIO});
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
  await page.goto(world ? WORLD + '/' : HOUSE + '/listen.html', {waitUntil:'load'});
  await page.waitForFunction(() => !!window.MCC_BAR && !!window.MCC_WORLD_AUDIO);
  await page.locator('.appbar').waitFor({state:'visible'});
  if (owner) await page.waitForFunction(() => MCC_BAR.admin() && document.querySelectorAll('.appbar [data-appnav]').length >= 10);
  if (installed && dockModule) await page.waitForFunction(() => document.documentElement.classList.contains('mcc-app-dock-ready'));
  if (!world) await page.waitForFunction(() => !!window.MCC_MUSIC && !!document.getElementById('q'));
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
async function play(page) {
  /* Listen lists albums and artists (Matthew, 2026-11-23, "Quick wins" Q2 in docs/music/MUSIC-RELEASE-20261119.md): a song's own play button is in its search results */
  const sel = '[data-music-play][data-album="here"][data-track="Who Did The Shoot"]';
  if (!(await page.$(sel))) { await page.fill('#q', 'Who Did The Shoot'); await page.waitForSelector(sel); }
  await page.locator(sel).first().click();
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
try {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox','--autoplay-policy=document-user-activation-required','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
  for (const device of DEVICES) {
    const baseline = await browserBaseline(device);
    await installedMusic(device,baseline);
    await directWorld(device,baseline);
    await ownerRegistry(device);
  }
  await fallbackTransport(DEVICES.find(device => device.insets.left !== device.insets.right));
} catch (error) {
  process.exitCode = 1;
  checks.push({name:'suite completed',pass:false,error:String(error.stack || error)});
  console.error(error.stack || error);
} finally {
  await browser?.close();
  await writeFile(join(OUT,'report.json'), JSON.stringify({pass:!process.exitCode,checks,scenarios},null,2));
}
