import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire((process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules')+'/x'),{chromium}=require('playwright');
const root=resolve(new URL('../../',import.meta.url).pathname);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox']});
try{
for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.route('**/*',async route=>{
  const path=new URL(route.request().url()).pathname;
  try {const content=await readFile(resolve(root,'.'+path));await route.fulfill({body:content,contentType:extname(path)==='.css'?'text/css':'application/octet-stream'});}catch{await route.fulfill({status:404,body:''});}
 });
 const html=(await readFile(root+'/mnet.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('<head>','<head><base href="https://fixture.test/">');
 await page.setContent(html);
 await page.evaluate(()=>{
  window.calls=[];window.MCC_MNET={api:async(path,init)=>{calls.push({path,init});return {};},esc:s=>String(s)};
  window.SpeechRecognition=class{start(){window.rec=this;}abort(){window.aborted=true;}};
 });
 let script=await readFile(root+'/js/mnet-live.js','utf8');
 script=script.replace('})(window, document);','w.testLive={mount:function(){M=w.MCC_MNET;studio.session={id:"fixture"};mountActorControls();},end:endBroadcast};})(window, document);');
 await page.addScriptTag({content:script});
 await page.evaluate(()=>{window.testLive.mount();document.getElementById("mnStudioGo").hidden=true;document.getElementById("mnStudioEnd").hidden=false;document.getElementById('mnStudio').showModal();});
 await page.locator('#mnActorInvite').check();
 await page.waitForFunction(()=>document.getElementById('mnActorStatus').textContent.includes('invited'));
 await page.locator('#mnActorCue').fill('Build the community studio.');
 await page.locator('#mnActorSend').click();
 await page.waitForFunction(()=>calls.some(c=>c.init?.body?.source==='typed'));
 await page.locator('#mnActorCaptions').check();
 await page.evaluate(()=>{const result=[{transcript:'A synthetic speech caption.'}];result.isFinal=true;rec.onresult({resultIndex:0,results:[result]});});
 await page.waitForFunction(()=>calls.some(c=>c.init?.body?.source==='browser_caption'));
 await page.locator('#mnActorInvite').uncheck();
 await page.waitForFunction(()=>document.getElementById('mnActorStatus').textContent.includes('paused'));
 assert.equal(await page.evaluate(()=>window.aborted),true);
 assert.equal(await page.locator('#mnActorCaptions').isChecked(),false);
 const overflow=await page.locator('#mnActorControls').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth}));assert.equal(overflow.scroll,overflow.client);
 const inputSize=await page.locator('#mnActorCue').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));assert.ok(inputSize>=16);
 await mkdir('/tmp/live-actors-proof',{recursive:true});await page.screenshot({path:`/tmp/live-actors-proof/live-${width}.png`});
 await page.evaluate(()=>window.testLive.end(true));assert.equal(await page.locator('#mnActorControls').isVisible(),false);
 console.log(`PASS ${width}px: invite, typed cue, opt-in caption, pause, end, input size, overflow`);
 await page.close();
}
}finally{await browser.close();}
