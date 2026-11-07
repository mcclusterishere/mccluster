/* Local browser only. No provider request, real account or checkout. */
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire((process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules')+'/x')('playwright');
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
const html=(await read('music-creator.html')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const helper=await read('js/music-creator-page.js'),source=await read('js/music-creator-profile.js');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
try {
 for(const mode of ['late-owner','visible-owner','late-checkout','late-owner-switch']) {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:html}));
  await page.goto('https://fixture.invalid/music-creator.html?handle=alice');
  await page.evaluate(mode=>{
   window.token='A';window.pending=[];window.MCC={session:()=>token?{access_token:token}:null};
   window.MCC_BAR={pageProfile:p=>window.brand=p};
   window.fetch=async(url,init)=>{
    if(url.includes('current_m_uid')){
     const mine=init.headers.authorization==='Bearer A'?'owner-a':'owner-b';
     if(mode.startsWith('late-owner'))await new Promise(resolve=>pending.push(resolve));
     return new Response(JSON.stringify(mine));
    }
    if(url.includes('music-checkout')){await new Promise(resolve=>pending.push(resolve));return new Response(JSON.stringify({url:'https://checkout.fixture.invalid/session-a'}));}
    return new Response(JSON.stringify(url.includes('music_creator_profiles')?[{m_uid:'owner-a',handle:'alice',artist_name:'Alice',settings:{}}]:[]));
   };
  },mode);
  await page.addScriptTag({content:helper});await page.addScriptTag({content:source});
  await page.waitForFunction(()=>window.brand?.name==='Alice');
  if(mode==='visible-owner'||mode==='late-checkout')await page.waitForSelector('#apOwnerEdit');
  if(mode==='late-checkout'){
   await page.evaluate(()=>{const b=document.createElement('button');b.id='fixtureCheckout';b.dataset.offer='fixture';b.dataset.checkout='1';b.textContent='Buy';document.body.append(b);b.click();});
  }
  if(mode!=='visible-owner')await page.waitForFunction(()=>pending.length>0);
  await page.evaluate(mode=>{token=mode==='late-owner-switch'?'B':'';dispatchEvent(new Event('mcc:auth-changed'));for(const resolve of pending)resolve();},mode);
  await page.waitForTimeout(50);
  assert.equal(await page.locator('#apOwnerEdit,#apOwnerFront').count(),0,mode);
  assert.equal(new URL(page.url()).hostname,'fixture.invalid',mode);
  assert.equal(await page.evaluate(()=>brand.name),'Alice','public branding stays with viewed artist');
  if(mode==='late-checkout')assert.equal(await page.locator('#fixtureCheckout').isDisabled(),false);
  console.log('PASS '+mode);await page.close();
 }
}finally{await browser.close();}
