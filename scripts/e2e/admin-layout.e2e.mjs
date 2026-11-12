/* Isolated real-module UI proof. The adapter is synthetic, never a backend claim. */
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const out=process.argv[2]||'/tmp/admin-layout-proof';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox']});
const results=[];function check(name,ok){results.push({name,pass:!!ok});assert.ok(ok,name);console.log('PASS '+name);}
try{for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Same-origin fixture only. Reload remounts the editor, preserving the simulated server record.
 await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:12px;font:16px system-ui}*{box-sizing:border-box}</style><main id="editor"></main><div id="routes"></div><div id="deck"></div>'}));
 await page.goto('https://fixture.invalid/');
 await page.addStyleTag({content:await readFile('css/control-admin-layout.css','utf8')});
 for(const f of ['nav','section-groups','analytics-layout','analytics-deck'])await page.addScriptTag({content:await readFile('js/control-room/'+f+'.js','utf8')});
 await page.evaluate(()=>{
  window.record={schema:'analytics-layout/v1',revision:'1',layout:CR.analyticsLayout.defaults()};window.user='owner';window.allow=true;window.writes=0;window.delay=false;
  window.adapter={load:async()=>{if(!allow)throw Object.assign(Error('Denied'),{status:403});return structuredClone(record);},save:async({expectedRevision,layout})=>{writes++;if(delay)await new Promise(r=>window.release=r);if(!allow)throw Object.assign(Error('Denied'),{status:403});if(expectedRevision!==record.revision)throw Object.assign(Error('Conflict'),{status:409});record={schema:'analytics-layout/v1',revision:String(Number(record.revision)+1),layout};return structuredClone(record);}};
  window.mount=function(enabled=true){window.editorControl?.dispose();document.getElementById('editor').innerHTML=CR.analyticsLayout.render();window.editorControl=CR.analyticsLayout.bind(document,{adapter:enabled?adapter:null,identity:async()=>user,onSaved:v=>CR.analyticsDeck.configure(v),onInvalidate:()=>CR.analyticsDeck.configure(null)});};mount();
 });
 const status=page.locator('[data-layout-status]');await status.filter({hasText:'Saved layout loaded'}).waitFor();
 check(width+' owner loads exactly six views',await page.locator('[data-layout-body] li').count()===6);
 await page.getByRole('button',{name:'Move Content earlier',exact:true}).click();await page.locator('[data-layout-default="content"]').selectOption('adaptive');await page.getByRole('button',{name:'Save layout',exact:true}).click();await status.filter({hasText:'Layout saved'}).waitFor();
 await page.evaluate(()=>mount());await status.filter({hasText:'Saved layout loaded'}).waitFor();
 check(width+' reload retains saved order and detail',await page.evaluate(()=>CR.analyticsDeck.chapters[1][0]==='content')&&await page.locator('[data-layout-default="content"]').inputValue()==='adaptive');
 await page.getByRole('button',{name:'Use default arrangement'}).click();check(width+' reset is not an automatic write',await page.evaluate(()=>writes===1));
 await page.getByRole('button',{name:'Save layout',exact:true}).click();await status.filter({hasText:'Layout saved'}).waitFor();
 check(width+' explicit reset persists',await page.evaluate(()=>record.layout.order[1]==='audience'));
 await page.evaluate(()=>record.revision='20');await page.getByRole('button',{name:'Save layout',exact:true}).click();await status.filter({hasText:'changed elsewhere'}).waitFor();check(width+' stale writer locked until reload',await page.getByRole('button',{name:'Save layout',exact:true}).isDisabled());
 await page.getByRole('button',{name:'Reload saved layout'}).click();await status.filter({hasText:'Saved layout loaded'}).waitFor();
 await page.evaluate(()=>{allow=false;});await page.getByRole('button',{name:'Save layout',exact:true}).click();await status.filter({hasText:'Access or account changed'}).waitFor();check(width+' revoked role clears editor',await page.locator('[data-layout-body] li').count()===0);
 await page.evaluate(()=>{allow=true;mount();});await status.filter({hasText:'Saved layout loaded'}).waitFor();
 await page.evaluate(()=>{delay=true;});await page.getByRole('button',{name:'Save layout',exact:true}).click();await page.waitForFunction(()=>typeof release==='function');await page.evaluate(()=>{user='other';dispatchEvent(new Event('mcc:auth-changed'));release();});
 await page.waitForTimeout(80);check(width+' in-flight old account result cannot repopulate',await page.locator('[data-layout-body] li').count()===0);
 await page.evaluate(()=>mount(false));check(width+' absent persistence disables save',await page.getByRole('button',{name:'Save layout',exact:true}).isDisabled());
 for(const section of ['sell','create','system']){
  const routes=await page.evaluate(id=>CR.nav.leaves().filter(x=>x.section.id===id).map(x=>x.leaf.route),section);
  for(const route of routes){await page.evaluate(hash=>{location.hash=hash;window.drawRoute=()=>{const e=CR.nav.resolve(location.hash).entry;document.getElementById('routes').innerHTML=CR.sectionGroups.render(e);};window.onhashchange=drawRoute;drawRoute();},route);check(width+' retained route '+route,await page.locator('.cr-local-items [aria-current="page"]').count()===1);}
 }
 await page.evaluate(()=>{location.hash='#sell:orders';});await page.waitForTimeout(30);await page.evaluate(()=>{location.hash='#system:apps';});await page.waitForTimeout(30);await page.goBack();await page.waitForTimeout(30);check(width+' browser Back restores local category',await page.locator('.cr-local-items [aria-current="page"]').textContent()==='Orders');
 check(width+' phone/desktop no horizontal page overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
 await page.screenshot({path:join(out,`layout-${width}.png`),fullPage:true});check(width+' no script errors',errors.length===0);await page.close();
}}finally{await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));await browser.close();}
