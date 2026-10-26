/** Fully intercepted browser fixtures: no live accounts or external network. */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'fixture-loader.cjs'));
const { chromium } = require('playwright');
const base = resolve(import.meta.dirname, '../..');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless:true, args:['--no-sandbox'] });
const page = await browser.newPage({ viewport:{width:390,height:844} });
let session = {access_token:'alice'};
let front = {ok:true,handle:'alice',draft:{},published:null,publicly_available:false};
let status = 200;
let billingStatus = 200;
let calls = [];
let slow = false;
const org = '11111111-1111-4111-8111-111111111111';
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname === 'api.mccluster.org') {
    const token = route.request().headers().authorization;
    calls.push({path:url.pathname,token});
    if (url.pathname === '/v1/fronts/me') {
      const body = JSON.stringify(front), code = status;
      if (slow && token === 'Bearer alice') await new Promise(r=>setTimeout(r,250));
      await route.fulfill({status:code,contentType:'application/json',body}).catch(()=>{});
    } else await route.fulfill({status:billingStatus,contentType:'application/json',body:JSON.stringify({paid:true,workspaces:[{org_id:org}]})});
    return;
  }
  if (url.pathname === '/js/mcc-auth.js') {
    await route.fulfill({contentType:'application/javascript',body:`window.fixtureSession=${JSON.stringify(session)};window.MCC={session:()=>window.fixtureSession,refreshIfNeeded:async()=>window.fixtureSession};`}); return;
  }
  if (['/js/tabbar.js','/js/shell-boot.js'].includes(url.pathname)) { await route.fulfill({contentType:'application/javascript',body:''}); return; }
  if (url.hostname !== 'fixture.test') { await route.abort(); return; }
  try { const file = resolve(base, '.' + url.pathname); if (!file.startsWith(base + '/')) throw new Error('path');
    await route.fulfill({body:await readFile(file), contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css'})[extname(file)] || 'application/octet-stream'});
  } catch { await route.fulfill({status:404,body:''}); }
});
async function ready() { await page.locator('#siteStatus[aria-busy="false"]').waitFor(); }
async function open() { await page.goto('https://fixture.test/customer-site.html'); await ready(); }
async function text() { return page.locator('#siteStatus').innerText(); }
try {
  session=null; await open(); assert.match(await text(), /Sign in or create account/); assert.equal(calls.length,0);
  session={access_token:'alice'}; await open(); assert.match(await text(), /Draft saved/); assert.equal(await page.getByRole('link',{name:'View published page'}).count(),0);
  assert.match(await page.getByRole('link',{name:'External social'}).getAttribute('href'), new RegExp(org));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
  front={...front,published:{},publicly_available:true}; await open(); assert.equal(await page.getByRole('link',{name:'View published page'}).getAttribute('href'),'front.html?u=alice');
  front={...front,publish_blocker:'private_profile'}; await open(); assert.equal(await page.getByRole('link',{name:'View published page'}).count(),0); assert.equal(await page.getByRole('link',{name:'Review profile visibility'}).getAttribute('href'),'mccluster-creator-studio.html');
  front={...front,publish_blocker:'removed'}; await open(); assert.match(await text(), /removed and cannot be published/);
  status=401; await open(); assert.equal(await page.getByRole('link',{name:'Sign in again'}).count(),1);
  status=409; await open(); assert.equal(await page.getByRole('link',{name:'Complete profile',exact:true}).getAttribute('href'),'mnet.html?view=profile');
  status=503; billingStatus=503; await open(); assert.match(await text(), /could not check your front page/); assert.doesNotMatch(await text(), /Active workspace subscription/);
  status=200; billingStatus=200; front={ok:true,handle:'bob',draft:{},publicly_available:false}; await page.getByRole('button',{name:'Refresh status'}).first().click(); await ready(); assert.match(await text(), /@bob/);
  front={ok:true,handle:'javascript:alert(1)',published:{},publicly_available:true}; await open(); assert.equal(await page.getByRole('link',{name:'View published page'}).count(),0);
  slow=true; front={ok:true,handle:'alice',draft:{},publicly_available:false};
  const pendingAlice = page.waitForRequest(r=>r.url().includes('/v1/fronts/me') && r.headers().authorization === 'Bearer alice');
  await page.getByRole('button',{name:'Refresh status'}).first().click();
  await pendingAlice;
  front={ok:true,handle:'bob',draft:{},publicly_available:false};
  await page.evaluate(()=>{ window.fixtureSession={access_token:'bob'}; window.dispatchEvent(new Event('mcc:auth-changed')); }); await ready();
  await page.waitForTimeout(350); assert.match(await text(), /@bob/); assert.doesNotMatch(await text(), /@alice/);
  await page.evaluate(()=>{ window.fixtureSession=null; window.dispatchEvent(new Event('mcc:auth-changed')); }); await ready(); assert.doesNotMatch(await text(), /@bob|11111111/);
  await page.setViewportSize({width:1440,height:900}); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
  console.log('PASS: signed-out, draft/live/private/removed/profile-required, outage + retry, unsafe handle, two-account stale response isolation, sign-out clearing, phone/desktop overflow');
} finally { await browser.close(); }
