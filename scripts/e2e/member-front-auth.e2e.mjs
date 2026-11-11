/* Local browser fixtures: delayed private reads/saves must not survive account changes. */
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire((process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules')+'/x')('playwright');
const html=(await readFile(new URL('../../member-front.html',import.meta.url),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const source=await readFile(new URL('../../js/member-front.js',import.meta.url),'utf8');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
try {
 for(const stage of ['bootstrap','people','workspace','save','front']) {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route('**/*',route=>route.fulfill({body:html,contentType:'text/html'}));
  await page.goto('https://fixture.invalid/member-front.html?handle=alice&card=1');
  await page.evaluate(stage=>{
   window.token='A';window.pending=[];window.calls=[];window.brands=[];
   const profile={identity:{mccluster_id:'alice'},profile:{display_name:'Alice',bio:'Private editor value'},counts:{}};
   window.MCC_BAR={pageProfile:p=>brands.push(p),perspective:()=>{}};
   window.MCC={session:()=>token?{access_token:token}:null,api:async(path,init)=>{
    calls.push({path,token:init.headers.authorization});
    const result=path.includes('bootstrap')?{identity:{mccluster_id:'alice'}}:path.includes('people')?profile:path.includes('operators')?{tenants:[{id:'a',name:'Private Operator',role:'owner'}]}:path.includes('clearance')?{approval_status:'approved',can_drive:true}:path.includes('drivers')?{driver:{id:'a'}}:{};
    const hold=(stage==='bootstrap'&&path.includes('bootstrap'))||(stage==='people'&&path.includes('people'))||(stage==='workspace'&&(path.includes('drivers')||path.includes('operators')))||(stage==='save'&&init.method==='PATCH');
    if(hold)await new Promise(resolve=>pending.push(resolve));
    return new Response(JSON.stringify(result));
   }};
   window.fetch=async()=>{if(stage==='front')await new Promise(resolve=>pending.push(resolve));return new Response(JSON.stringify({ok:true,handle:'alice',config:{}}));};
  },stage);
  await page.addScriptTag({content:source});
  if(stage==='save'){
   await page.waitForFunction(()=>!document.getElementById('mfCustomize').hidden);
   await page.evaluate(()=>{document.getElementById('mfCustomize').click();document.getElementById('mfEditForm').dispatchEvent(new Event('submit',{cancelable:true}));});
  }
  await page.waitForFunction(()=>pending.length>0);
  await page.evaluate(()=>{token='';dispatchEvent(new Event('mcc:auth-changed'));for(const resolve of pending)resolve();});
  await page.waitForTimeout(50);
  const state=await page.evaluate(()=>({privateHidden:['mfCustomize','mfOwnerPanel','mfDriverPanel','mfOperatorPanel','mfBuild','mfFront'].every(id=>document.getElementById(id).hidden),open:document.getElementById('mfEditor').open,fields:[...document.querySelectorAll('#mfEditForm input,#mfEditForm textarea')].every(n=>!n.value),brand:brands.at(-1),calls}));
  assert.equal(state.privateHidden,true,stage);assert.equal(state.open,false,stage);assert.equal(state.fields,true,stage);assert.equal(state.brand,null,stage);
  assert(state.calls.every(c=>c.token==='Bearer A'),stage);
  if(stage==='save')assert.equal(state.calls.filter(c=>c.path.includes('people')).length,1,'save must not fetch profile after signout');
  console.log('PASS delayed '+stage+' response after signout');
  await page.close();
 }
} finally {await browser.close();}
