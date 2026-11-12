// Browser flow uses synthetic provider responses only. Never sends an email.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve, extname, join} from 'node:path';
const {chromium}=createRequire(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '/opt/codex/cua_node/lib/node_modules','package.json'))('playwright');
const root=resolve('.');
const server=createServer(async(req,res)=>{
 const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(!path.startsWith(root+'/'))return res.writeHead(403).end();
 try{res.setHeader('Content-Type',extname(path)==='.html'?'text/html':'text/javascript');res.end(await readFile(path));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:844}});
  let callback, exchanges=0, emails=0;const errors=[];
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin===base){
    if(u.pathname==='/game-hub.html')return route.fulfill({contentType:'text/html',body:'<h1>Fixture destination; owner gate tested separately</h1>'});
    return route.continue();
   }
   if(u.origin!=='https://zmnhbrjyhxzhkxmhkexs.supabase.co')return route.abort();
   const headers={'access-control-allow-origin':'*'};
   if(u.pathname.endsWith('/otp')){
    emails++;callback=u.searchParams.get('redirect_to');assert.equal(route.request().postDataJSON().create_user,false);
    return route.fulfill({headers,json:{}});
   }
   if(u.pathname.endsWith('/token')){exchanges++;return route.fulfill({headers,json:{access_token:'fixture-token',refresh_token:'fixture-refresh',expires_in:3600,user:{id:'fixture-user'}}});}
   if(u.pathname.endsWith('/user'))return route.fulfill({headers,json:{id:'fixture-user'}});
   return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/auth/email.html?next='+encodeURIComponent('/game-hub.html#m=chem108&play=molecule-rush'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
  assert.ok(await page.locator('#email').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16));
  await page.locator('#email').fill('fixture@example.test');await page.locator('#send').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('If this email'));
  await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Wait'));assert.equal(emails,1);
  // New tab in the same browser: localStorage PKCE state survives the email handoff.
  const landing=await context.newPage();landing.on('pageerror',e=>errors.push(e.message));
  await landing.goto(callback+'&code=fixture-code');await landing.locator('#finish').waitFor({state:'visible'});
  assert.equal(new URL(landing.url()).search,'');assert.equal(exchanges,0);
  await landing.locator('#finish').click();await landing.waitForURL('**/game-hub.html#*');
  assert.equal(landing.url(),base+'/game-hub.html#m=chem108&play=molecule-rush');assert.equal(exchanges,1);
  assert.equal(await landing.evaluate(()=>localStorage.getItem('mccdb_session')===localStorage.getItem('mcc_sess_keep')),true);
  await landing.goto(callback+'&code=fixture-code');await landing.locator('#finish').click();
  await landing.waitForFunction(()=>document.querySelector('#status').textContent.includes('expired'));
  assert.equal(exchanges,1);assert.equal(await landing.locator('#request').isVisible(),true);
  assert.deepEqual(errors,[]);await context.close();console.log(`email sign-in browser flow passed at ${width}px`);
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
