/* Real Control page/modules + real plan handler, synthetic PostgREST/provider.
   No network leaves this test. Screenshots contain fixture story text only. */
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {handlePlans,handleReferences} from '../../workers/mccluster/src/media/plans.js';
const ROOT=resolve(fileURLToPath(new URL('../../',import.meta.url))),OUT=process.argv[2]||'/tmp/production-studio-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/codex/cua_node/lib/node_modules','x'))('playwright');
const BASE='https://matthew.mccluster.org',ORG='123e4567-e89b-42d3-a456-426614174000',OWNER='323e4567-e89b-42d3-a456-426614174000',MODEL='423e4567-e89b-42d3-a456-426614174000',JOB='523e4567-e89b-42d3-a456-426614174000',ASSET='623e4567-e89b-42d3-a456-426614174000';
const model={id:MODEL,provider:'fal',display_name:'Fixture reference video',capability:'image-to-video',parameter_schema:{properties:{image_url:{type:'string',title:'Reference image'},duration:{type:'number',minimum:1,maximum:10}},required:['image_url','duration']}};
const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2'};
const env={SUPABASE_URL:'https://db.fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only'};
await mkdir(OUT,{recursive:true});const results=[];
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try { for(const width of [390,768,1280]) {
  const records=new Map(),refs=[],calls=[],errors=[];let denied=false,failGeneration=false;
  const priorFetch=globalThis.fetch;
  globalThis.fetch=async(href,opts={})=>{
    const u=new URL(href),table=u.pathname.split('/').pop(),body=opts.body&&JSON.parse(opts.body),key=(u.searchParams.get('id')||'').replace('eq.','');
    const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
    if(table==='org_members')return json([{role:denied?'viewer':'owner',orgs:{id:ORG,enabled:true,kind:'studio',name:'Fixture'}}]);
    if(table==='media_entities'){if(body){const row={id:crypto.randomUUID(),...body};refs.push(row);return json([row]);}return json(refs);}
    if(table==='work_projects')return json([]);
    if(table==='media_assets')return json([{id:ASSET,job_id:JOB,org_id:ORG}]);
    if(table==='media_jobs')return json([{id:JOB,org_id:ORG,status:'completed'}]);
    assert.equal(table,'media_workflows');
    if(opts.method==='POST'){records.set(body.id,body);return json([body]);}
    if(opts.method==='PATCH'){const row=records.get(key);if(!row||u.searchParams.get('config->>hash')!=='eq.'+row.config.hash)return json([]);records.set(key,{...row,...body});return json([records.get(key)]);}
    return json(key?(records.has(key)?[records.get(key)]:[]):[...records.values()]);
  };
  const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',acceptDownloads:true});
  await ctx.addInitScript(({OWNER})=>{
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    const exp=Math.floor(Date.now()/1000)+3600;
    localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:OWNER,email:'owner@fixture.invalid'}))+'.y',refresh_token:'fixture-only',expires_at:exp,user:{id:OWNER,email:'owner@fixture.invalid'}}));
  },{OWNER});
  const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname;
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(u.origin==='https://api.mccluster.org'){
      const body=req.postData()?req.postDataJSON():null;calls.push({path:p,method:req.method(),body});
      if(p==='/v1/status')return json(route,{ok:true,operator:{email:'owner@fixture.invalid'},database:{reachable:true}});
      if(p==='/v1/workspaces/me')return json(route,{default_org_id:ORG,workspaces:[{org_id:ORG,slug:'mccluster',role:'owner',kind:'studio',enabled:true}]});
      if(p==='/v1/media/models')return json(route,{models:[model]});
      if(p==='/v1/media/references'||p.startsWith('/v1/media/plans')){
        try{const r=await(p.endsWith('references')?handleReferences:handlePlans)(new Request(req.url(),{method:req.method(),...(body?{body:JSON.stringify(body)}:{})}),env,{id:OWNER});return json(route,r);}catch(e){return json(route,{error:e.message},e.status||500);}
      }
      if(p==='/v1/media/estimate')return json(route,{estimate:{available:true,estimated_cost_usd_micros:250000},quote_hash:'fixture-quote',provider:'fal',model_id:MODEL});
      if(p==='/v1/media/generate')return failGeneration?route.abort():json(route,{job:{id:JOB,status:'queued'}});
      if(p==='/v1/media/jobs/'+JOB)return json(route,{job:{id:JOB,status:'completed'},assets:[{id:ASSET,job_id:JOB,media_type:'video',url:'https://fixture.invalid/take.mp4'}]});
      return json(route,{ok:true,projects:[],threads:[],apps:[],jobs:[],events:[],leads:[],tools:[],decisions:[],total:0});
    }
    if(u.hostname.endsWith('supabase.co')){if(p==='/auth/v1/user')return json(route,{id:OWNER,email:'owner@fixture.invalid'});if(p==='/functions/v1/music-access')return json(route,{ok:true,operator:true,tracks:[],creators:[],offers:[]});return json(route,[]);}
    if(u.origin===BASE){const path=resolve(ROOT,'.'+decodeURIComponent(p));if(!path.startsWith(ROOT+sep))return route.abort();try{return route.fulfill({body:await readFile(path),contentType:TYPES[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}}
    return route.abort();
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(BASE+'/control.html#create:projects');
    const click=async(name)=>{await page.locator('[data-plan-action="'+name+'"]').click();await page.waitForFunction(()=>!CR.productionPlan.state.busy);};
    await page.locator('[data-plan-action="new"]').waitFor({timeout:30000});await click('new');
    await page.locator('[data-plan-field="title"]').fill('Fixture production '+width);await page.locator('[data-plan-field="script"]').fill('Owner-authored script. Preserve this exactly.');await click('save');
    assert.equal(records.size,1);const key=[...records.keys()][0];assert.equal(records.get(key).config.revision,1);
    await page.locator('[data-plan-field="script"]').fill('Owner-authored second revision.');await click('save');assert.equal(records.get(key).config.revision,2);
    await click('reload');assert.equal(await page.locator('[data-plan-field="script"]').inputValue(),'Owner-authored second revision.');
    await page.getByText('Characters and references',{exact:true}).click();await page.locator('[data-ref="name"]').fill('Own face');await page.locator('[data-ref="url"]').fill('https://fixture.invalid/owner-face.png');await page.locator('[data-ref="prompt"]').fill('Preserve face asymmetry');await page.locator('[data-ref="owned"]').check();await click('reference');assert.equal(refs.length,1);
    await page.selectOption('[data-plan-episode]','prim3/S02E03');
    await click('add-scene');await page.locator('[data-plan-field="scene.title"]').fill('Arrival');await page.locator('[data-plan-field="scene.prompt"]').fill('Quiet arrival, preserve reference face.');
    await page.selectOption('[data-plan-model]',MODEL);await page.selectOption('[data-plan-reference]',refs[0].id);assert.equal(await page.locator('[data-plan-input="image_url"]').inputValue(),'https://fixture.invalid/owner-face.png');await page.locator('[data-plan-input="duration"]').fill('5');
    await click('estimate');assert.equal(calls.filter(c=>c.path==='/v1/media/generate').length,0);assert.equal(await page.locator('[data-plan-action="generate"]').isEnabled(),true);
    await page.locator('[data-plan-field="scene.prompt"]').fill('Changed prompt');assert.equal(await page.locator('[data-plan-action="generate"]').isDisabled(),true);await click('estimate');
    await click('generate');assert.equal(calls.filter(c=>c.path==='/v1/media/generate').length,1);assert.equal(calls.find(c=>c.path==='/v1/media/generate').body.input.image_url,'https://fixture.invalid/owner-face.png');
    await click('takes');await page.locator('[data-plan-select]').click();await click('save');
    const [download]=await Promise.all([page.waitForEvent('download'),click('export')]);const path=join(OUT,'timeline-'+width+'.json');await download.saveAs(path);const manifest=JSON.parse(await readFile(path));assert.equal(manifest.rendered_video,false);assert.equal(manifest.episode_link.episode_id,'S02E03');assert.equal(manifest.episode_link.status,'draft');assert.equal(manifest.hash,records.get(key).config.hash);assert.equal(manifest.scenes[0].asset_id,ASSET);
    await page.reload();await page.locator('[data-plan-action="list"]').waitFor();await click('list');await page.selectOption('[data-plan-open]',key);await page.waitForFunction(()=>!!CR.productionPlan.state.saved);assert.equal(await page.locator('[data-plan-field="script"]').inputValue(),'Owner-authored second revision.');
    failGeneration=true;await click('estimate');await click('generate');assert.equal(records.get(key).config.plan.scenes[0].submission.state,'uncertain');await click('reload');await click('estimate');assert.equal(await page.locator('[data-plan-action="generate"]').isDisabled(),true);failGeneration=false;
    await page.selectOption('[data-plan-restore]','1');assert.equal(await page.locator('[data-plan-field="script"]').inputValue(),'Owner-authored script. Preserve this exactly.');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert.equal(overflow,0);
    assert.equal(await page.locator('[data-plan-field="script"]').evaluate(n=>parseFloat(getComputedStyle(n).fontSize)>=16),true);
    await page.screenshot({path:join(OUT,'studio-'+width+'.png'),fullPage:true});
    assert.deepEqual(errors,[]);results.push({width,passed:true,scope:'real Control + plan handler; synthetic database and generation'});
  }catch(e){await page.screenshot({path:join(OUT,'failure-'+width+'.png'),fullPage:true});throw e;}finally{await ctx.close();globalThis.fetch=priorFetch;}
} }finally{await browser.close();await writeFile(join(OUT,'results.json'),JSON.stringify(results,null,2));}
console.log(JSON.stringify(results,null,2));
