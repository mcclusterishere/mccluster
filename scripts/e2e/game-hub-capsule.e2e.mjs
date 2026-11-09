// Real browser, local HTTP only. Owner API is a fixture; no production session or writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = createRequire(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '/opt/node-tools/node_modules','package.json'))('playwright');
const root = resolve('.');
const server = createServer(async (req,res) => {
  const path = resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!path.startsWith(root+'/')) {res.writeHead(403).end(); return;}
  try { const data=await readFile(path); res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(path)] || 'application/octet-stream');res.end(data); }
  catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
await mkdir('/tmp/game-hub-selector-evidence',{recursive:true});
const errors=[];
try {
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce'});
 // A valid silent WAV exercises real browser media events without streaming a production asset.
 const wav=Buffer.alloc(44+8000*2*60);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 await context.route('**/*',route=>{
 const u=new URL(route.request().url());
 if(/\.(mp3|wav|m4a)(?:$|\?)/.test(u.href)) return route.fulfill({contentType:'audio/wav',body:wav});
 if(u.origin===base) return route.continue();
 if(u.href==='https://api.mccluster.org/v1/status') return route.fulfill({json:{ok:true},headers:{'access-control-allow-origin':'*'}});
 return route.abort();
 });
 await context.addInitScript(()=>{
 localStorage.setItem('mccdb_session',JSON.stringify({access_token:'local-test-fixture'}));
 localStorage.setItem('mcc.gamehub.music.v1',JSON.stringify({modules:{chem108:{track:1,time:12}}}));
 const NativeAudio=window.Audio;window.audioCount=0;window.Audio=function(...args){window.audioCount++;return new NativeAudio(...args);};
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const url=base+'/game-hub.html#m=chem108&play=molecule-rush';
 await page.goto(url);await page.locator('[data-start]').waitFor();
 const toggle=page.locator('[data-capsule-toggle]'), handle=page.locator('[data-capsule-drag]');
 assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 await page.waitForFunction(()=>!!window.MCC_MUSIC);
 assert.equal(await page.evaluate(()=>audioCount),1,'one shared audio transport');
 await page.locator('[data-hub-music-play]').tap();
 await page.waitForFunction(()=>MCC_MUSIC.audio.paused===false);
 const first=await page.evaluate(()=>MCC_MUSIC.current().title);
 await page.locator('[data-music-next]').tap();
 await page.waitForFunction(first=>MCC_MUSIC.current().title!==first,first);
 const song=await page.evaluate(()=>MCC_MUSIC.current().title);
 await toggle.tap();await page.locator('[data-module=prim3-security]').tap();
 assert.equal(await page.evaluate(()=>MCC_MUSIC.current().title),song);
 assert.equal(await page.evaluate(()=>MCC_MUSIC.audio.paused),false);
 await page.locator('[data-hub-music-play]').tap();
 assert.equal(await page.evaluate(()=>MCC_MUSIC.audio.paused),true);
 assert.equal(await page.locator('#musicMini').isVisible(),false);
 await page.goto(url);await page.locator('[data-start]').waitFor();
 await handle.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');
 const moved=await page.locator('#ghCapsule').boundingBox();assert.ok(moved.x>12&&moved.y>64);
 await toggle.focus();await page.keyboard.press('Enter');
 assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 await page.locator('button[data-module=chem108]').focus();await page.keyboard.press('Escape');
 assert.equal(await toggle.evaluate(el=>el===document.activeElement),true);
 const h=await handle.boundingBox();await page.mouse.move(h.x+20,h.y+20);await page.mouse.down();await page.mouse.move(h.x+100,h.y+110,{steps:10});await page.mouse.up();
 const saved=await page.evaluate(()=>localStorage.getItem('mcc.gamehub.capsule.v1'));assert.ok(saved);
 await page.reload();await page.locator('[data-start]').waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('mcc.gamehub.capsule.v1')),saved);
 // Real touch pointer sequence on the dedicated handle, not synthetic DOM drag events.
 const session=await context.newCDPSession(page);const touch=await handle.boundingBox();
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touch.x+20,y:touch.y+20}]});
 await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touch.x+20,y:touch.y+60}]});
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.ok((await handle.boundingBox()).y>touch.y,'touch drag moves controls');
 assert.equal(await toggle.getAttribute('aria-expanded'),'false','drag does not expand');
 await toggle.click();await page.locator('[data-capsule-move=reset]').click();await page.keyboard.press('Escape');
 const reset=await page.locator('#ghCapsule').boundingBox();assert.equal(reset.x,12);assert.equal(reset.y,64);
 for(const [width,height] of [[320,568],[390,568],[390,844],[844,390],[1024,768]]) {
  await page.setViewportSize({width,height});await page.locator('[data-start]').click();
  for(const expanded of [false,true]) {
   if(expanded) await toggle.click();
   for(const answer of await page.locator('.mr-opt').all()) {
    await answer.scrollIntoViewIfNeeded();
    assert.ok(await answer.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),`answer hit target ${width} expanded=${expanded}`);
   }
   assert.ok(await page.evaluate(()=>{const a=document.querySelector('#ghCapsule').getBoundingClientRect(),b=document.querySelector('#ghMain').getBoundingClientRect();return a.bottom<=b.top&&b.height>=80;}),'reserved workspace');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),'no horizontal overflow');
   if(expanded) await page.keyboard.press('Escape');
  }
  await page.screenshot({path:`/tmp/game-hub-selector-evidence/playing-${width}x${height}.png`});
  await page.locator('.mr-opt').first().click();await page.locator('[data-answer-title]').waitFor();
  await page.reload();await page.locator('[data-start]').waitFor();
 }
 await page.setViewportSize({width:390,height:844});
 await page.addStyleTag({content:'html{font-size:200%}'});
 await page.locator('[data-start]').click();
 await page.locator('.mr-opt').first().click();await page.locator('[data-answer-title]').waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),'200% text no page overflow');
 await page.screenshot({path:'/tmp/game-hub-selector-evidence/text-200.png'});
 if(process.env.AXE_PATH) {await page.addScriptTag({path:process.env.AXE_PATH});const result=await page.evaluate(()=>axe.run('#ghCapsule'));assert.deepEqual(result.violations.map(v=>v.id),[]);}
 const fallback=await context.newPage();
 await fallback.route('**/js/music-engine.js',route=>route.abort());
 await fallback.goto(url);await fallback.locator('[data-start]').click();
 await fallback.getByText('Music unavailable',{exact:true}).waitFor();
 assert.equal(await fallback.locator('[data-hub-music-play]').isDisabled(),true);
 assert.equal(await fallback.locator('.mr-opt').count(),4,'music failure does not block study');
 await fallback.close();
 // A missing optional music catalogue must not prevent Chemistry from becoming playable.
 const missingAlbum=await context.newPage();
 await missingAlbum.route('**/data/albums.json',route=>route.abort());
 await missingAlbum.goto(url);
 await missingAlbum.locator('[data-start]').waitFor({timeout:10000});
 await missingAlbum.locator('[data-start]').click();
 assert.equal(await missingAlbum.locator('.mr-opt').count(),4,'album catalogue failure does not block Molecule Rush');
 await missingAlbum.close();
 // Chemistry is the public exception to the private Game Hub.
 // Use a brand-new guest browser with no synthetic owner token or account.
 const guestContext=await browser.newContext({viewport:{width:390,height:568},hasTouch:true,reducedMotion:'reduce'});
 await guestContext.route('**/*',route=>{
  if(new URL(route.request().url()).origin===base)return route.continue();
  return route.abort();
 });
 const guest=await guestContext.newPage();
 const guestErrors=[];guest.on('pageerror',e=>guestErrors.push(e.message));
 await guest.goto(base+'/game-hub.html#m=chem108&play=molecule-rush');
 await guest.locator('[data-owner-msg]').getByText(/Sign in with the house owner/).waitFor();
 assert.equal(await guest.locator('#ghModules').count(),0,'private hub remains gated');
 await guest.locator('a[href="chem108.html"]').click();
 await guest.waitForURL('**/chem108.html');
 await guest.locator('#chemTrialStart').waitFor();
 assert.equal(await guest.locator('[data-start]').count(),0,'trial begins only on explicit choice');
 await guest.locator('#chemTrialStart').click();
 await guest.locator('[data-start]').waitFor();
 assert.ok(await guest.evaluate(()=>JSON.parse(localStorage.getItem('mcc.chem108.guest-trial.v1')).startedAt>0),'guest trial remembered');
 await guest.locator('[data-start]').click();
 assert.equal(await guest.locator('.mr-opt').count(),4,'real chemistry round is playable when logged out');
 for(const option of await guest.locator('.mr-opt').all()){
  await option.scrollIntoViewIfNeeded();
  assert.ok(await option.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'guest answer is hittable on phone');
 }
 await guest.evaluate(()=>{
  const at=Date.now()-7*24*60*60*1000-1000;
  localStorage.setItem('mcc.chem108.guest-trial.v1',JSON.stringify({version:1,startedAt:at,lastSeen:at}));
 });
 await guest.reload();
 await guest.locator('#chemTrialAccount').waitFor({state:'visible'});
 assert.equal(await guest.locator('#chemTrialGame').isVisible(),false,'expired trial cannot keep playing');
 assert.match(await guest.locator('#chemTrialMessage').innerText(),/seven-day guest preview has ended/i);
 assert.deepEqual(guestErrors,[]);
 await guestContext.close();
 // DEEP AUDIT W4 (2026-11-09): on the public trial page an account answer belongs to the session that asked for it.
 // The account code is the real js/mcc-auth.js and the bar is the real one. Only the account service's HTTP replies
 // are a fixture, held per bearer token until released, so a "late" answer is a reply that really arrives late.
 const ACCOUNT='https://zmnhbrjyhxzhkxmhkexs.supabase.co/auth/v1/',cors={'access-control-allow-origin':'*'};
 // Tokens shaped like the real ones (the payload names the account), built here, unsigned, accepted only by this fixture.
 const part=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const fixtureToken=(subject,turn=1)=>[part({alg:'none',typ:'JWT'}),part({sub:subject,turn,exp:Math.floor(Date.now()/1000)+3600}),'fixture'].join('.');
 const memberA=fixtureToken('fixture-member-a'),memberARefreshed=fixtureToken('fixture-member-a',2),memberB=fixtureToken('fixture-member-b');
 const members={[memberA]:{id:'fixture-member-a'},[memberARefreshed]:{id:'fixture-member-a'},[memberB]:{id:'fixture-member-b'}};
 const WEEK=7*24*60*60*1000,EXPIRED=WEEK+60000,ACTIVE=60000;
 const PROMPT={heading:'Continue with an M Account',start:null,account:true},WELCOME={heading:'Welcome back',start:'Play Chemistry',account:false};
 const sessionOf=token=>JSON.stringify({access_token:token,refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600});
 const until=async(test,what)=>{for(let i=0;i<200;i++){if(await test())return;await new Promise(r=>setTimeout(r,25));}throw new Error('timed out waiting for '+what);};
 async function trialAccount(host,{member,trialAge,offline=false},run){
  const context=await host.newContext({viewport:{width:390,height:568},hasTouch:true,reducedMotion:'reduce'});
  const gates=new Map(),pageErrors=[];
  const gate=token=>{if(!gates.has(token)){let release;const open=new Promise(r=>release=r);gates.set(token,{open,release,asked:0});}return gates.get(token);};
  await context.route('**/*',async route=>{
   const request=route.request(),u=new URL(request.url());
   if(u.href===base+'/__another-tab.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Another tab</title>'});
   if(u.origin===base)return route.continue();
   if(u.href===ACCOUNT+'logout')return route.fulfill({status:204,headers:cors});
   if(u.href!==ACCOUNT+'user'||offline)return route.abort();
   const token=(request.headers().authorization||'').replace(/^Bearer /,''),held=gate(token);
   held.asked++;await held.open;
   // the tab may have moved on while its reply was held
   await route.fulfill(members[token]?{json:members[token],headers:cors}:{status:401,json:{msg:'invalid JWT'},headers:cors}).catch(()=>{});
  });
  // Instrumentation only: note the session each real MCC.user() call was made under and when it settles, so the run
  // waits for "the held reply has been delivered" instead of guessing a delay.
  await context.addInitScript(()=>{
   let auth;window.__lookups=[];window.__shows=[];window.__heard=0;window.__born=Math.random();
   window.addEventListener('pageshow',e=>window.__shows.push(e.persisted));
   window.addEventListener('storage',()=>{window.__heard++;});
   Object.defineProperty(window,'MCC',{configurable:true,get:()=>auth,set(value){
    auth=value;const user=value.user;
    value.user=function(){
     let token=null;try{token=JSON.parse(localStorage.getItem('mccdb_session')||'null').access_token;}catch(e){}
     const lookup={token,settled:false},done=()=>{lookup.settled=true;};window.__lookups.push(lookup);
     const reply=user.apply(this,arguments);reply.then(done,done);return reply;
    };
   }});
  });
  const otherTab=await context.newPage();await otherTab.goto(base+'/__another-tab.html');
  await otherTab.evaluate(([stored,age])=>{
   localStorage.clear();
   if(stored){localStorage.setItem('mccdb_session',stored);localStorage.setItem('mcc_sess_keep',stored);}
   if(age!=null){const at=Date.now()-age;localStorage.setItem('mcc.chem108.guest-trial.v1',JSON.stringify({version:1,startedAt:at,lastSeen:at}));}
  },[member?sessionOf(member):null,trialAge]);
  const tab=await context.newPage();tab.on('pageerror',e=>pageErrors.push(e.message));
  await tab.goto(base+'/chem108.html');
  const made=token=>tab.waitForFunction(t=>window.__lookups.some(l=>l.token===t),token);
  const trial={
   page:tab,release:token=>gate(token).release(),
   panel:async()=>({heading:await tab.locator('#chemTrialHeading').innerText(),start:await tab.locator('#chemTrialStart').isVisible()?await tab.locator('#chemTrialStart').innerText():null,account:await tab.locator('#chemTrialAccount').isVisible()}),
   // every MCC.user() call made under this session has reached the account service
   asked:async token=>{await made(token);const calls=await tab.evaluate(t=>window.__lookups.filter(l=>l.token===t).length,token);await until(()=>gate(token).asked>=calls,'the account lookups to reach the service');},
   // and every one of them has been answered and handed back to the page
   answered:async token=>{await made(token);await tab.waitForFunction(t=>window.__lookups.every(l=>l.token!==t||l.settled),token);},
   // what a sign-in, sign-out or token refresh in another tab leaves in storage; this tab hears only the storage events
   storeInOtherTab:async next=>{
    const heard=await tab.evaluate(()=>window.__heard);
    await otherTab.evaluate(stored=>{for(const key of ['mccdb_session','mcc_sess_keep']){if(stored)localStorage.setItem(key,stored);else localStorage.removeItem(key);}},next?sessionOf(next):null);
    await tab.waitForFunction(before=>window.__heard>before,heard);
   }
  };
  try{await run(trial);assert.deepEqual(pageErrors,[]);}
  finally{for(const held of gates.values())held.release();await context.close();}
 }
 // A signs out while the account service is still answering for A; the answer arrives afterwards.
 await trialAccount(browser,{member:memberA,trialAge:EXPIRED},async t=>{
  await t.page.locator('#chemTrialAccount').waitFor({state:'visible'});
  await t.asked(memberA);
  await t.page.evaluate(()=>MCC.signOut());
  t.release(memberA);await t.answered(memberA);
  assert.deepEqual(await t.panel(),PROMPT,'an account answer that arrives after sign-out verifies nothing');
  assert.equal(await t.page.locator('#chemTrialGame').isVisible(),false);
 });
 // Another tab signs in as B while A's lookup is still out; A's answer arrives first, then B's.
 await trialAccount(browser,{member:memberA,trialAge:EXPIRED},async t=>{
  await t.page.locator('#chemTrialAccount').waitFor({state:'visible'});
  await t.asked(memberA);
  await t.storeInOtherTab(memberB);
  await t.asked(memberB);
  t.release(memberA);await t.answered(memberA);
  assert.deepEqual(await t.panel(),PROMPT,'the first account\'s late answer cannot verify the second account\'s session');
  t.release(memberB);
  await t.page.getByRole('heading',{name:'Welcome back'}).waitFor({timeout:5000});
  assert.deepEqual(await t.panel(),WELCOME,'the second account is verified by its own answer');
 });
 // A verified member is in the middle of a round when another tab refreshes the same member's token, then signs out.
 await trialAccount(browser,{member:memberA,trialAge:EXPIRED},async t=>{
  t.release(memberA);t.release(memberARefreshed);
  await t.page.getByRole('heading',{name:'Welcome back'}).waitFor();
  await t.page.locator('#chemTrialStart').click();
  await t.page.locator('[data-start]').click();
  assert.equal(await t.page.locator('.mr-opt').count(),4,'the member is playing a real round');
  await t.storeInOtherTab(memberARefreshed);
  assert.equal(await t.page.locator('.mr-opt').count(),4,'a token refresh for the same member is not a sign-out: the round goes on');
  assert.equal(await t.page.locator('#chemTrialMessage').innerText(),'Signed-in account verified.');
  await t.storeInOtherTab(null);
  await t.page.locator('#chemTrialAccount').waitFor({state:'visible',timeout:5000});
  assert.deepEqual(await t.panel(),PROMPT,'sign-out in another tab ends the verification');
  assert.equal(await t.page.locator('#chemTrialGame').isVisible(),false,'and closes the round only the account allowed');
  assert.equal(await t.page.locator('.mr-opt').count(),0);
  assert.match(await t.page.locator('#chemTrialMessage').innerText(),/seven-day guest preview has ended/i);
 });
 // The account service cannot be reached: a guest who still has trial days keeps them, and nothing is granted from the stored token.
 await trialAccount(browser,{member:memberA,trialAge:ACTIVE,offline:true},async t=>{
  await t.page.getByRole('heading',{name:'Your chemistry trial'}).waitFor();
  await t.answered(memberA);
  assert.deepEqual(await t.panel(),{heading:'Your chemistry trial',start:'Play Chemistry',account:false});
  await t.page.locator('#chemTrialStart').click();
  await t.page.locator('[data-start]').waitFor();
  assert.match(await t.page.locator('#chemTrialMessage').innerText(),/^Guest trial: .+ remaining\.$/);
 });
 // A member leaves the trial page, signs out where they went, and comes back with Back. What returns from the
 // back/forward cache is the old document with its old state and no events heard in between. Playwright switches that
 // cache off by default, so this case runs in a browser launched with it on and reports when the build will not restore.
 let restored=false;
 const restoring=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox'],ignoreDefaultArgs:['--disable-back-forward-cache']});
 try{
  await trialAccount(restoring,{member:memberA,trialAge:EXPIRED},async t=>{
   t.release(memberA);
   await t.page.getByRole('heading',{name:'Welcome back'}).waitFor();
   const born=await t.page.evaluate(()=>window.__born);
   await t.page.goto(base+'/__another-tab.html');
   await t.page.evaluate(()=>{localStorage.removeItem('mccdb_session');localStorage.removeItem('mcc_sess_keep');});
   await t.page.goBack({waitUntil:'commit'});
   await t.page.locator('#chemTrialHeading').waitFor();
   const back=await t.page.evaluate(()=>({born:window.__born,persisted:window.__shows[window.__shows.length-1]}));
   if(back.born!==born||back.persisted!==true)return;
   await t.page.locator('#chemTrialAccount').waitFor({state:'visible',timeout:5000});
   assert.deepEqual(await t.panel(),PROMPT,'a page restored after signing out elsewhere is not verified');
   restored=true;
  });
 }finally{await restoring.close();}
 assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('mcc.gamehub.music.v1')).modules.chem108.time),12,'legacy music preferences preserved');
 console.log('PASS: one real shared transport, playback/course switch/next/pause, mouse/touch/keyboard movement, reset/persistence, collapse/focus, answer hit-testing compact+expanded at 320/390/844/1024, 200% text, screenshots. Auth and audio fixtures; actual shared navigation loaded.');
 console.log('PASS: Chem 108 trial account answers stay with the session that asked (real js/mcc-auth.js and bar; account-service replies held by a fixture): late answer after sign-out, account switch from another tab, same-member token refresh then sign-out in another tab mid-round, unreachable account service keeps the guest preview.');
 console.log(restored?'PASS: a trial page restored from the back/forward cache after signing out elsewhere is not verified (real restore of the same document, pageshow persisted).':'NOT RUN: back/forward-cache restore of the trial page. This browser build reloaded the page instead of restoring it, so only scripts/test/chem108-trial-account.test.mjs covered the restore path.');
} finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
