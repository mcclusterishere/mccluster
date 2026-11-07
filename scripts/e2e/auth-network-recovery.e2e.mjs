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
const errors=[];
try {
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
 let passwordMode='stall';
 const jwt='fixture.'+Buffer.from(JSON.stringify({sub:'fixture-owner',email:'fixture@example.test',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture';
 const session={access_token:jwt,refresh_token:'fixture-refresh',expires_in:3600,user:{id:'fixture-owner',email:'fixture@example.test',user_metadata:{name:'Fixture'}}};
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());if(u.origin===base)return route.continue();
  if(u.pathname==='/auth/v1/token'&&u.searchParams.get('grant_type')==='password') {
    if(passwordMode==='stall') return; // leave request pending until the actual 12-second deadline aborts it
    return route.fulfill({json:session,headers:{'access-control-allow-origin':'*'}});
  }
  if(u.pathname==='/auth/v1/user')return route.fulfill({json:session.user,headers:{'access-control-allow-origin':'*'}});
  if(u.pathname==='/auth/v1/settings')return route.fulfill({json:{external:{}},headers:{'access-control-allow-origin':'*'}});
  if(u.href==='https://api.mccluster.org/v1/status')return route.fulfill({json:{ok:true},headers:{'access-control-allow-origin':'*'}});
  return route.abort();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/game-hub.html#m=chem108&play=molecule-rush');
 await page.locator('[data-owner-msg] a').tap();await page.waitForURL('**/account.html');
 await page.locator('#mccPrivacyLater').tap();
 await page.locator('#acInEmail').waitFor();
 // Stay on the account to verify success without navigating to other application flows.
 await page.goto(base+'/account.html?stay=1');
 await page.locator('#acInEmail').fill('fixture@example.test');await page.locator('#acInPass').fill('fixture-password');
 await page.locator('#acGo').tap();assert.equal(await page.locator('#acGo').isDisabled(),true);
 await page.locator('#acMsg').filter({hasText:'did not respond'}).waitFor({timeout:16000});
 assert.equal(await page.locator('#acGo').isDisabled(),false);
 assert.equal(await page.evaluate(()=>localStorage.getItem('mccdb_session')),null,'failed attempt does not create session');
 passwordMode='success';await page.locator('#acGo').tap();
 await page.waitForFunction(()=>!!localStorage.getItem('mccdb_session'));
 await page.goto(base+'/game-hub.html#m=chem108&play=molecule-rush');await page.locator('[data-start]').waitFor();
 assert.equal(await page.locator('html').getAttribute('data-owner-access'),'open');
 assert.deepEqual(errors,[]);
 console.log('PASS: actual phone-width owner Sign in link opens account; stalled password request recovers button in 12 seconds; retry succeeds; return to Molecule Rush passes fresh owner check. All auth/API responses synthetic, no production credentials or writes.');
} finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
