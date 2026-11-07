// Offline boundary fixture for the real public renderer; API responses are synthetic.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const root=process.env.ROOT||resolve(import.meta.dirname,'../..');
const html=(await readFile(resolve(root,'front.html'),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const source=await readFile(resolve(root,'js/front-member.js'),'utf8');
const {chromium}=createRequire((process.env.PLAYWRIGHT_DIR||'/tmp/selfservice-tools/node_modules')+'/x')('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
const origin='https://fixture.invalid',canonical='website-studio-view.html?project=alpha';
try {
 for(const [name,status,url,ok] of [['canonical',200,canonical,true],['external',200,'https://other.invalid/',true],['other-project',200,'website-studio-view.html?project=beta',true],['absolute',200,origin+'/'+canonical,true],['unavailable',503,canonical,true],['not-ok',200,canonical,false]]) {
  const page=await browser.newPage();const requests=[];
  await page.route('**/*',route=>{const u=new URL(route.request().url());requests.push(u.href);
   if(u.origin==='https://api.mccluster.org')return route.fulfill({status,contentType:'application/json',body:JSON.stringify({ok,presentation:'tiles',url})});
   if(u.pathname==='/front.html')return route.fulfill({contentType:'text/html',body:html});
   if(u.pathname==='/website-studio-view.html')return route.fulfill({contentType:'text/html',body:'<h1>Tile destination</h1>'});
   return route.fulfill({body:''});
  });
  await page.goto(origin+'/front.html?project=alpha');await page.addScriptTag({content:source});
  if(name==='canonical'){await page.waitForURL(origin+'/'+canonical);await page.getByRole('heading',{name:'Tile destination'}).waitFor();}
  else{await page.waitForFunction(()=>document.documentElement.dataset.frontState==='empty');assert.equal(page.url(),origin+'/front.html?project=alpha');assert.equal(requests.some(u=>u.includes('/website-studio-view.html')||u.startsWith('https://other.invalid')),false);}
  console.log('PASS project tile redirect '+name);await page.close();
 }
} finally {await browser.close();}
