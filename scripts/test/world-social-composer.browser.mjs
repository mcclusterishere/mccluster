// Offline browser integration of the real composer markup/createPost function.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH?pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href:'playwright');
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const source=await read('js/mnet.js'),html=await read('mnet.html');
const publish=source.slice(source.indexOf('  function createPost()'),source.indexOf('  // a post can be'));
const composer=html.slice(html.indexOf('        <article class="mn__composer"'),html.indexOf('        <!-- WORLD NEWS (owner'));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('**/*',r=>r.request().isNavigationRequest()?r.fulfill({contentType:'text/html',body:'<!doctype html>'}):r.abort());
 await page.goto('https://mccluster.org/composer-fixture');
 await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'+composer+'</body></html>');
 await page.addStyleTag({content:await read('css/style.css')});
 await page.addStyleTag({content:await read('css/mnet.css')});
 await page.evaluate(()=>{
  window.worldCount=0;window.externalCount=0;window.publishKeys=[];window.lostResponse=true;window.connected=true;
  window.MCC_AUTH_STATE={verified:true,signed_in:true,user:{id:'alice'}};
  window.MCC={api:async(path,init)=>{
   let data;
   if(path.includes('/creator-billing/entitlement'))data={workspaces:[{org_id:'org-alice'}]};
   else if(path.includes('/customer-social/status'))data={configured:window.connected,connection:{account_id:'account-alice',status:'connected',handle:'alice'}};
   else if(path.includes('/customer-social/action-targets'))data={campaigns:[],missions:[]};
   else if(path.includes('/mnet/deliveries'))data={deliveries:window.saved?[window.saved]:[]};
   else if(path.endsWith('/submit')){window.publishKeys.push(path);window.externalCount++;window.saved.state='queued';if(window.lostResponse){window.lostResponse=false;throw Error('Lost response');}data={publish_job:{id:'job-one',state:'queued'}};}
   else if(path.includes('/mnet/posts')){window.worldCount++;data={post:{id:'world-one'}};if(init.body.delivery){window.saved={id:'delivery-one',user:'alice',org:'org-alice',account:'account-alice',worldId:'world-one',jobId:'job-one',state:'draft'};data.delivery={...window.saved};}}
   else throw Error('Unexpected '+path);
   return new Response(JSON.stringify(data));
  }};
  window.fetch=async()=>new Response('{}');
 });
 await page.addScriptTag({content:await read('js/world-publish-core.js')});
 await page.addScriptTag({content:await read('js/world-social-composer.js')});
 await page.waitForFunction(()=>document.getElementById('mnExternalOptIn').disabled===false);
 await page.addScriptTag({content:`
 var APP='mccluster-web'; var state={mediaAssets:[{id:'media-alice',file:new File(['fixture'],'reel.mp4',{type:'video/mp4'})}],placeScope:{enabled:false},world:{}};
 function $(id){return document.getElementById(id)};function pickedTrack(){return null};
 function setStatus(node,text){node.textContent=text};function api(path,init){return MCC.api(path,init).then(r=>r.json())};
 function clearMediaQueue(){state.mediaAssets=[]};function loadFeed(){return Promise.resolve()};function track(){};
 ${publish}
 $('mnPost').onclick=createPost;
 $('mnPostBody').addEventListener('focus',()=>{$('mnComposer').classList.add('is-open')});
 MCC_WORLD_COMPOSER.preview({caption:'Hello World',media:state.mediaAssets});
 `});
 await page.locator('#mnPostBody').fill('Hello World');
 await page.locator('#mnExternalDestinations').evaluate(el=>el.open=true);
 await page.locator('#mnExternalOptIn').check();
 await page.locator('#mnPost').click();
 await page.getByRole('button',{name:'Retry Instagram only'}).waitFor();
 assert.equal(await page.evaluate(()=>worldCount),1);
 assert.match(await page.locator('#mnExternalDeliveries').innerText(),/World: published/);
 await page.getByRole('button',{name:'Retry Instagram only'}).click();
 await page.getByRole('button',{name:'Refresh Instagram status'}).waitFor();
 assert.equal(await page.evaluate(()=>worldCount),1);
 assert.equal(await page.evaluate(()=>publishKeys[0]===publishKeys[1]),true);
 await page.evaluate(()=>{MCC_WORLD_COMPOSER.user('');MCC_WORLD_COMPOSER.user('alice');});
 await page.getByRole('button',{name:'Refresh Instagram status'}).waitFor();
 assert.equal(await page.evaluate(()=>worldCount),1);
 if(process.env.COMPOSER_SCREENSHOT) await page.screenshot({path:process.env.COMPOSER_SCREENSHOT,fullPage:true});
 // A new World-only post still succeeds while provider configuration is absent.
 await page.evaluate(()=>{connected=false;});
 await page.locator('#mnPostBody').fill('World only');
 await page.locator('#mnPost').click();
 await page.waitForFunction(()=>worldCount===2);
 assert.equal(await page.evaluate(()=>externalCount),2);
 await page.evaluate(()=>{MCC_AUTH_STATE={verified:true,signed_in:false,user:null};window.dispatchEvent(new CustomEvent('mcc:auth-state',{detail:MCC_AUTH_STATE}));});
 assert.equal(await page.locator('#mnExternalOptIn').isDisabled(),true);
 assert.equal(await page.locator('#mnExternalDeliveries').isHidden(),true);
 const sizes=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
 assert.equal(sizes.width,sizes.scroll);
 console.log('Real World composer fixture: World success + Instagram failure/retry, unchanged World count, opt-in reset, provider-unavailable World post, sign-out cleanup and 390px layout passed.');
}finally{await browser.close();}
