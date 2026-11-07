// Local files and synthetic API responses only. No production requests.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {initialDraft,project} from '../../js/portfolio-progression-model.mjs';
const require=createRequire((process.env.PORTFOLIO_TOOLS||'/tmp/portfolio-tools/node_modules')+'/x');
const {chromium}=require('playwright');
const root=new URL('../../',import.meta.url).pathname;
const catalog=JSON.parse(await readFile(root+'data/portfolio-progression.json'));
const roles=JSON.parse(await readFile(root+'data/roles.json'));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
let draft=initialDraft(catalog),revision=0,published=null,deny=false,failSave=false;
const context=await browser.newContext({viewport:{width:390,height:844}});
await context.addInitScript(()=>localStorage.setItem('mccdb_session',JSON.stringify({access_token:'fixture'})));
await context.route('**/*',async route=>{const u=new URL(route.request().url());
 if(u.hostname==='api.mccluster.org'){
  const suffix=u.pathname.replace('/v1/portfolio-progression','');const body=route.request().postDataJSON();let status=200,data;
  if(suffix==='/public')data={snapshot:published,published_at:published?'2026-11-07T00:00:00Z':null};
  else if(deny){status=403;data={error:'Owner access required'};}
  else if(!body)data={draft,revision};
  else if(failSave){status=503;data={error:'Storage unavailable'};}
  else if(suffix==='/preview')data={snapshot:project(draft,catalog,roles,[],{publicOnly:true}),revision,digest:'fixture-preview'};
  else {if(suffix==='/publish')published=project(draft,catalog,roles,[],{publicOnly:true});else if(suffix==='/unpublish')published=null;else draft=body.draft;data={revision:++revision};}
  return route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});
 }
 if(u.hostname!=='matthew.mccluster.org')return route.abort();
 // Global navigation is outside this isolated feature test.
 if(u.pathname==='/js/tabbar.js')return route.fulfill({contentType:'text/javascript',body:''});
 const p=resolve(root,'.'+u.pathname);if(!p.startsWith(root))return route.abort();
 try{return route.fulfill({contentType:({'.html':'text/html','.mjs':'text/javascript','.json':'application/json','.css':'text/css'})[extname(p)]||'text/javascript',body:await readFile(p)});}catch{return route.fulfill({status:404,body:''});}
});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const base='https://matthew.mccluster.org/character.html';
try{
 await page.goto(base+'?edit=1');await page.waitForSelector('[data-status="chemistry"]');
 await page.selectOption('[data-status="chemistry"]','self_reported');await page.check('[data-visible="chemistry"]');
 await page.click('#preview');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Save your changes'));
 failSave=true;await page.click('#save');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Storage unavailable'));assert.equal(revision,0);failSave=false;
 await page.click('#save');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('draft saved'));
 await page.reload();await page.waitForSelector('[data-status="chemistry"]');assert.equal(await page.inputValue('[data-status="chemistry"]'),'self_reported');
 await page.click('#preview');await page.waitForSelector('#publish-controls:not([hidden])');assert.equal(await page.locator('#publish').isDisabled(),true);assert.equal(await page.locator('#sheet article').count(),1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
 await mkdir('/tmp/portfolio-review',{recursive:true});await page.screenshot({path:'/tmp/portfolio-review/character-390.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);await page.screenshot({path:'/tmp/portfolio-review/character-1440.png',fullPage:true});
 await page.check('#confirm');await page.click('#publish');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('snapshot published'));
 await page.goto(base);await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Published snapshot'));assert.equal(await page.locator('#sheet article').count(),1);assert.equal(await page.locator('#controls').isVisible(),false);
 await page.goto(base+'?edit=1');await page.waitForSelector('#controls:not([hidden])');await page.click('#unpublish');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Snapshot unpublished'));assert.equal(published,null);
 await page.evaluate(()=>window.dispatchEvent(new Event('mcc:auth-changed')));assert.equal(await page.locator('#controls').isVisible(),false);assert.equal(await page.locator('#sheet').textContent(),'');
 deny=true;await page.reload();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Owner access required'));assert.equal(await page.locator('#controls').isVisible(),false);
 assert.deepEqual(errors,[]);console.log('PASS: mobile/desktop no overflow; edit/save/failure/reload; preview/confirm/publish/public/revoke; account change and denied owner; no page errors. Screenshots: /tmp/portfolio-review');
}finally{await browser.close();}
