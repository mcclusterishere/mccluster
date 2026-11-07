// Intercepted UI contract only; independent SQL fixtures exercise provider authority.
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,join} from 'node:path';
import assert from 'node:assert/strict';
import {presentDomain,domainCapabilities} from '../../workers/mccluster/src/creator-domains.js';
const {chromium}=createRequire(resolve(process.env.PLAYWRIGHT_DIR||'/tmp/first-offer-tools/node_modules','fixture.cjs'))('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']}),ROOT=process.cwd(),BASE='https://matthew.mccluster.org',OUT='/tmp/customer-domain-recovery-proof';await mkdir(OUT,{recursive:true});
try{for(const width of [390,1440]){
 const ctx=await browser.newContext({viewport:{width,height:900}});let mutations=0;
 const env={CREATOR_DOMAINS_ENABLED:'true',CREATOR_DOMAINS_ZONE_ID:'fixture',CREATOR_DOMAINS_API_TOKEN:'fixture',CREATOR_DOMAINS_CNAME:'sites.mccluster.org'};
 const row={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',auth_user_id:'11111111-1111-4111-8111-111111111111',handle:'owner',hostname:'customer.org',verification_token:'synthetic',provider_state:'reconciliation_required',status:'error',last_error:'Provider ownership needs reviewed reconciliation.'};
 await ctx.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='api.mccluster.org'){if(route.request().method()!=='GET')mutations++;return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({domains:[presentDomain(row,env)],targets:[{type:'member_front',id:row.auth_user_id,slug:'owner',label:'Personal site'}],capabilities:domainCapabilities(env)})});}
  if(u.pathname==='/js/backend.js')return route.fulfill({contentType:'text/javascript',body:"window.MCC_SUPA={token:async()=> 'fixture-owner'};"});
  if(['/js/tabbar.js','/js/shell-boot.js','/js/mcc-auth.js'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:''});
  if(u.origin!==BASE)return route.fulfill({body:'{}'});
  try{const path=resolve(ROOT,'.'+u.pathname);assert.ok(path.startsWith(ROOT+'/'));return route.fulfill({body:await readFile(path),contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 const page=await ctx.newPage();await page.addInitScript(()=>window.MCC_SUPA={token:async()=> 'fixture-owner'});await page.goto(BASE+'/customer-domains.html',{waitUntil:'domcontentloaded'});await page.getByText(/Status: reconciliation required/).waitFor();
 assert.equal(await page.getByRole('button',{name:'Verify again'}).count(),0);assert.equal(await page.getByRole('button',{name:'Disconnect',exact:true}).count(),0);
 assert.doesNotMatch(await page.locator('#domains').innerText(),/Add these records/);assert.match(await page.locator('#domains').innerText(),/24 hours/);
 await page.locator('#domainRefresh').click();await page.getByText(/Status: reconciliation required/).waitFor();assert.equal(mutations,0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);await page.screenshot({path:join(OUT,'domain-recovery-'+width+'.png'),fullPage:true});
 row.provider_state='none';row.status='ownership_pending';await page.locator('#domainRefresh').click();await page.getByRole('button',{name:'Verify again'}).waitFor();assert.match(await page.locator('#domains').innerText(),/Do not replace apex A\/AAAA/);assert.equal(mutations,0);await ctx.close();console.log('PASS '+width+': unresolved provider state has no blind retry/delete or DNS instruction, conditional CNAME/apex copy, snapshot expiry, no mutation or overflow');
}}finally{await browser.close();}
