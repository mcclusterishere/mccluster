/* Control → Work → Desk bot browser proof. Real control.html and modules from this
   checkout; EVERY network call is a synthetic fixture. The `inbox` edge function is
   stubbed at the network layer with the shapes supabase/functions/inbox/index.ts
   returns (kb_list, kb_put, kb_drop, kb_try, shared_put, ai_spend, outbound,
   channels, set_channel, tools, approvals, decide), including its owner gate and its
   "name which org this is for" refusal. Nothing here reaches Supabase.
   Replaces scripts/inbox-desk-smoke.mjs, which drove js/inbox-desk.js on a page that
   could never load it.
   PLAYWRIGHT_DIR=<node_modules> [CHROMIUM_EXECUTABLE=…] node scripts/e2e/control-desk-bot.e2e.mjs [outDir] */
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUT=process.argv[2]||'/tmp/control-desk-bot-proof';
const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR||'/opt/node-tools/node_modules','x'))('playwright');
const BASE='https://matthew.mccluster.org';
const TYPES={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
const OWNER='11111111-1111-4111-8111-111111111111';
const D1='d1000000-0000-4000-8000-000000000001',D2='d2000000-0000-4000-8000-000000000002';
const results=[];
function check(scope,name,condition,detail){results.push({scope,name,pass:!!condition});console.log((condition?'PASS ':'FAIL ')+'['+scope+'] '+name+(condition?'':' '+JSON.stringify(detail)));}
await mkdir(OUT,{recursive:true});
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'},body:JSON.stringify(body)});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const ago=s=>new Date(Date.now()-s*1000).toISOString();

/* The desk's state, as the function would hold it. */
function desk(){
  return {
    docs:[
      {id:D1,kind:'page',title:'McCluster Sites',url:'https://example.org/sites/',source:'staff',enabled:true,chunks:4,embedded:4,updated_at:ago(7200)},
      {id:D2,kind:'page',title:'I AM HERE',url:null,source:'staff',enabled:true,chunks:3,embedded:0,updated_at:ago(86400)}
    ],
    shared:{},
    channels:[
      {key:'site',label:'The website',enabled:true,can_reply_comments:false,can_send_dm:true,dm_window_hours:null,note:'Needs nobody\'s permission.',credential:null,token_present:false},
      {key:'instagram',label:'Instagram',enabled:false,can_reply_comments:true,can_send_dm:true,dm_window_hours:24,note:'Needs app review.',credential:{token_env:'META_PAGE_TOKEN',last_error:'OAuthException: token expired'},token_present:false},
      {key:'bluesky',label:'Bluesky',enabled:false,can_reply_comments:false,can_send_dm:true,dm_window_hours:null,note:'Nothing pushes.',credential:{token_env:'BSKY_APP_PASSWORD',last_error:null},token_present:false}
    ],
    approvals:[{id:'ap000000-0000-4000-8000-000000000001',tool:'unlock_door',reason:'somebody is locked out of the west door',arguments:{door:'west'},created_at:ago(60),expires_at:new Date(Date.now()+3000e3).toISOString()}],
    calls:[]
  };
}
const SPEND={ok:true,day:{cost_micros:1640000,calls:38,failures:1},budget_micros:2000000,spent_micros:1640000,recent:[
  {purpose:'answer',model:'claude-opus-5',cost_micros:41200,latency_ms:2300,ok:true,at:ago(30)},
  {purpose:'embed',model:'voyage-4',cost_micros:12,latency_ms:180,ok:false,error:'voyage 429: rate limited',at:ago(40)}]};
const OUTBOUND={outbound:[
  {channel:'instagram',state:'refused',costs_money:false,body:'Thanks for the follow!',refusal:'the 24h window on instagram closed 6h ago.',created_at:ago(100)},
  {channel:'site',state:'sent',costs_money:false,body:'A five page site is 2,500 dollars.',created_at:ago(200)},
  {channel:'x',state:'queued',costs_money:true,body:'thank you for following',created_at:ago(300)}]};
const TOOLS={servers:[{id:'sv1',name:'the church building',url:'https://shiloh.invalid/mcp',enabled:true,auth_kind:'bearer',token_env:'SHILOH_MCP',token_present:true,tools_refreshed_at:ago(120),last_error:null}],
  tools:[{id:'t1',server_id:'sv1',name:'sanctuary_temp',description:'What it is reading now.',enabled:true,risk:'read',auto:true,rejected:null},
    {id:'t3',server_id:'sv1',name:'unlock_door',description:'Opens a door.',enabled:false,risk:'act',auto:false,rejected:null}]};

/* role: what the caller is in the org; orgs: the caller's memberships (the function's org_members read) */
function inboxFn(state,{role='owner',orgs=[{id:'o1',slug:'mccluster',name:'McCluster'}],tagOrg=false}){
  const OWNER_ONLY=['set_channel','send','followers','kb_put','kb_drop','shared_put','poll','set_server','set_tool','set_experiment'];
  return (body,auth)=>{
    state.calls.push({body,auth});
    if(!/^Bearer x\./.test(auth||''))return [403,{error:'staff only'}];
    const asked=typeof body.org==='string'?body.org:'';
    const org=asked?orgs.find(o=>o.slug===asked||o.id===asked):(orgs.length===1?orgs[0]:null);
    if(!org)return [403,{error:orgs.length>1?'name which org this is for':'staff only',orgs:orgs.map(o=>({...o,role}))}];
    if(OWNER_ONLY.includes(body.action)&&role!=='owner')return [403,{error:`${body.action} is the owner's to do, and you are ${role} here`}];
    switch(body.action){
      case 'kb_list':return [200,{ok:true,documents:state.docs.map(d=>({...d,_org:org.slug,title:tagOrg?org.name+': '+d.title:d.title}))}];
      case 'kb_put':{
        if(!String(body.title||'').trim()||!String(body.body||'').trim())return [400,{error:'title and body are required'}];
        const prior=state.docs.find(d=>d.kind===(body.kind||'page')&&(body.url?d.url===body.url:d.title===body.title));
        if(prior){prior.title=body.title;prior.updated_at=new Date().toISOString();prior.chunks=2;prior.embedded=2;}
        else state.docs.unshift({id:'d3000000-0000-4000-8000-00000000000'+state.docs.length,kind:body.kind||'page',title:body.title,url:body.url,source:'staff',enabled:true,chunks:2,embedded:2,updated_at:new Date().toISOString()});
        return [200,{ok:true,indexed:true,chunks:2,embedded:true}];
      }
      case 'kb_drop':
        if(!/^[0-9a-f-]{36}$/i.test(String(body.id||'')))return [400,{error:'bad id'}];
        state.docs=state.docs.filter(d=>d.id!==body.id);return [200,{ok:true}];
      case 'kb_try':return [200,{ok:true,hits:[{title:'McCluster Sites — Pricing',url:null,score:.03,fts_rank:1,vec_rank:1,body:'A five page site is 2,500 dollars.'},{title:'I AM HERE',url:null,score:.01,fts_rank:null,vec_rank:2,body:'Out now everywhere.'}]}];
      case 'shared_put':{const k=String(body.key||'').trim().toLowerCase();if(!k)return [400,{error:'key is required'}];if(!body.value){delete state.shared[k];return [200,{ok:true,removed:k}];}state.shared[k]=body.value;return [200,{ok:true,key:k}];}
      case 'ai_spend':return [200,SPEND];
      case 'outbound':return [200,OUTBOUND];
      case 'channels':return [200,{org:{id:org.id,slug:org.slug,name:org.name,role},channels:state.channels}];
      case 'set_channel':{const c=state.channels.find(x=>x.key===body.channel);if(!c)return [400,{error:'no such channel: '+body.channel}];c.enabled=!!body.enabled;return [200,{ok:true}];}
      case 'tools':return [200,TOOLS];
      case 'approvals':return [200,{approvals:state.approvals}];
      case 'decide':state.approvals=state.approvals.filter(a=>a.id!==body.id);return [200,{state:body.approve?'approved':'denied',result:body.approve?'Done: the west door is open.':null}];
      default:return [200,{ok:true}];
    }
  };
}

async function setup(viewport,opts={}){
  const ctx=await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:viewport.width<1000,ignoreHTTPSErrors:true,serviceWorkers:'block'});
  const state=desk(),errors=[],requested=[];const fn=inboxFn(state,opts);
  await ctx.addInitScript(({OWNER})=>{
    localStorage.setItem('mcc_privacy_ack',JSON.stringify({version:'2026-10-19',accepted_at:new Date().toISOString()}));
    const exp=Math.floor(Date.now()/1000)+3600;
    localStorage.setItem('mccdb_session',JSON.stringify({access_token:'x.'+btoa(JSON.stringify({exp,sub:OWNER,email:'owner@fixture.invalid'})).replace(/=+$/,'')+'.y',refresh_token:'fixture-only',expires_at:exp,user:{id:OWNER,email:'owner@fixture.invalid'}}));
  },{OWNER});
  await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname;requested.push(u.origin+p);
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    if(u.origin==='https://api.mccluster.org'){
      if(p==='/health')return json(route,{ok:true});
      if(p==='/v1/status')return json(route,{ok:true,operator:{email:'owner@fixture.invalid'},database:{reachable:true}});
      if(p==='/v1/workspaces/me')return json(route,{ok:true,profile:{id:OWNER},default_org_id:'o1',workspaces:[{org_id:'o1',slug:'mccluster',kind:'studio',role:'owner',enabled:true,name:'McCluster'}]});
      return json(route,{ok:true,threads:[],apps:[],events:[],jobs:[],tools:[],decisions:[],leads:[],total:0});
    }
    if(u.hostname.endsWith('supabase.co')){
      if(p==='/auth/v1/user')return json(route,{id:OWNER,email:'owner@fixture.invalid'});
      if(p==='/functions/v1/inbox'&&req.method()==='POST'){const asked=req.postDataJSON()||{};if(opts.hold)await opts.hold(asked);const [status,body]=fn(asked,req.headers().authorization);return json(route,body,status);}
      return json(route,[]);
    }
    if(u.origin===BASE){
      const rel=p==='/'?'index.html':decodeURIComponent(p.replace(/^\//,''));const file=resolve(ROOT,rel);
      if(!file.startsWith(resolve(ROOT)+sep))return route.abort();
      try{return route.fulfill({body:await readFile(file),contentType:TYPES[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
    }
    return route.abort();
  });
  const page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(/TypeError|ReferenceError|SyntaxError/.test(m.text()))errors.push(m.text().slice(0,200));});
  return {ctx,page,state,errors,requested};
}
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
const text=page=>page.locator('[data-crd]').textContent();
const calls=(state,action)=>state.calls.filter(c=>c.body.action===action);
async function tab(page,name){await page.locator(`[data-crd-tab="${name}"]`).click();await page.waitForFunction(n=>document.querySelector(`[data-crd-tab="${n}"]`)?.classList.contains('is-on')&&!/Reading the desk/.test(document.querySelector('[data-crd]').textContent),name,{timeout:15000});}

try{
  for(const vp of [{width:390,height:844},{width:820,height:1180},{width:1280,height:800}]){
    const scope=vp.width+'px';
    const app=await setup(vp);const {page,state}=app;
    await page.goto(BASE+'/control.html#work:desk-bot',{waitUntil:'domcontentloaded'});
    await page.waitForSelector(`[data-crd-doc="${D1}"]`,{timeout:30000});
    check(scope,'the desk bot is a Work view at #work:desk-bot',await page.locator('#crViewSelect').inputValue()==='desk-bot');
    let t=await text(page);
    check(scope,'knowledge: both documents listed, unembedded chunks called out',/McCluster Sites/.test(t)&&/I AM HERE/.test(t)&&/3 unembedded/.test(t));
    check(scope,'every call is the inbox function with the operator bearer and the Control workspace org',state.calls.length>0&&state.calls.every(c=>/^Bearer x\./.test(c.auth)&&c.body.org==='mccluster'),state.calls.map(c=>c.body));
    check(scope,'no horizontal overflow',(await overflow(page))===0,await overflow(page));
    if(vp.width===390){
      const small=await page.evaluate(()=>[...document.querySelectorAll('[data-crd] button, [data-crd] input, [data-crd] textarea')].filter(el=>el.getBoundingClientRect().height<44).map(el=>el.outerHTML.slice(0,80)));
      check(scope,'every tab, button and field is a 44px target',small.length===0,small);
      const fonts=await page.evaluate(()=>[...document.querySelectorAll('[data-crd] input, [data-crd] textarea')].map(el=>parseFloat(getComputedStyle(el).fontSize)));
      check(scope,'form controls are at least 16px (no iOS focus zoom)',fonts.length>0&&fonts.every(f=>f>=16),fonts);
    }
    await page.screenshot({path:join(OUT,`desk-knowledge-${vp.width}.png`)});

    await page.fill('#crdTryQ','how much for a website');
    await page.locator('[data-crd-try-form] button[type="submit"]').click();
    await page.waitForFunction(()=>/keyword #1/.test(document.querySelector('[data-crd]').textContent),null,{timeout:15000});
    t=await text(page);
    check(scope,'kb_try shows keyword and meaning ranks apart',/meaning #2/.test(t)&&/no keyword match/.test(t)&&calls(state,'kb_try')[0]?.body.q==='how much for a website');

    await page.fill('#crdKbTitle','Hours');
    await page.fill('#crdKbBody','# Hours\nOpen Tuesday to Saturday.');
    await page.locator('[data-crd-put-form] button[type="submit"]').click();
    await page.waitForFunction(()=>/2 chunks, embedded/.test(document.querySelector('[data-crd]').textContent)&&/Hours/.test(document.querySelector('.cro-list')?.textContent||''),null,{timeout:15000});
    const put=calls(state,'kb_put')[0]?.body;
    check(scope,'add: kb_put with title, body, no url, kind page, and the list re-reads',put&&put.title==='Hours'&&/Tuesday/.test(put.body)&&put.url===null&&put.kind==='page'&&calls(state,'kb_list').length>=2,put);

    await page.locator(`[data-crd-replace="${D1}"]`).click();
    check(scope,'replace: the form takes the document\'s title and URL',await page.inputValue('#crdKbTitle')==='McCluster Sites'&&await page.inputValue('#crdKbUrl')==='https://example.org/sites/'&&/Replace/.test(await page.locator('#crdTeach h2').textContent()));
    await page.fill('#crdKbBody','# Pricing\nA five page site is 2,500 dollars.');
    await page.locator('[data-crd-put-form] button[type="submit"]').click();
    await page.waitForFunction(()=>/Teach it a page/.test(document.querySelector('#crdTeach h2')?.textContent||''),null,{timeout:15000});
    const rep=calls(state,'kb_put')[1]?.body;
    check(scope,'replace: kb_put keeps the url and kind, so the function replaces the same row',rep&&rep.url==='https://example.org/sites/'&&rep.kind==='page'&&state.docs.filter(d=>d.url==='https://example.org/sites/').length===1,rep);

    await page.locator(`[data-crd-drop="${D2}"]`).click();
    check(scope,'drop: the first tap only asks to confirm',calls(state,'kb_drop').length===0&&/Confirm remove/.test(await page.locator(`[data-crd-drop="${D2}"]`).textContent()));
    await page.locator(`[data-crd-drop="${D2}"]`).click();
    await page.waitForFunction(id=>!document.querySelector(`[data-crd-doc="${id}"]`),D2,{timeout:15000});
    check(scope,'drop: kb_drop with the document id, and it leaves the list',calls(state,'kb_drop')[0]?.body.id===D2&&!state.docs.some(d=>d.id===D2));

    await page.fill('#crdShKey','Hours');await page.fill('#crdShVal','Closed until the 8th');
    await page.locator('[data-crd-shared-form] button[type="submit"]').click();
    await page.waitForFunction(()=>/Set hours\./.test(document.querySelector('[data-crd]').textContent),null,{timeout:15000});
    check(scope,'true right now: shared_put sets the key',state.shared.hours==='Closed until the 8th');

    await tab(page,'spend');
    t=await text(page);
    check(scope,'spend: money reads as money and the router posture is named',/\$1\.64/.test(t)&&/\$2\.00/.test(t)&&/three quarters/.test(t)&&/voyage 429/.test(t));
    check(scope,'spend: no horizontal overflow',(await overflow(page))===0);
    await page.screenshot({path:join(OUT,`desk-spend-${vp.width}.png`)});

    await tab(page,'refusals');
    t=await text(page);
    check(scope,'refusals: a refusal is shown with its reason and a paid send is flagged',/window on instagram closed/.test(t)&&/costs money/.test(t));
    await page.locator('[data-crd-rfilter="refused"]').click();
    check(scope,'refusals: the Refused filter leaves only refusals',await page.locator('[data-crd] .cro-list .cro-item').count()===1);
    check(scope,'refusals: no horizontal overflow',(await overflow(page))===0);
    await page.screenshot({path:join(OUT,`desk-refusals-${vp.width}.png`)});

    await tab(page,'channels');
    t=await text(page);
    check(scope,'channels: a missing token and a dead credential are visible',/META_PAGE_TOKEN missing/.test(t)&&/token expired/.test(t)&&await page.locator('[data-crd-poll="bluesky"]').count()===1);
    await page.locator('[data-crd-chan="instagram"]').click();
    await page.waitForFunction(()=>/Turn off/.test(document.querySelector('[data-crd-chan="instagram"]')?.textContent||''),null,{timeout:15000});
    check(scope,'channels: turning one on is set_channel for this org',calls(state,'set_channel')[0]?.body.channel==='instagram'&&calls(state,'set_channel')[0].body.enabled===true);

    await tab(page,'tools');
    t=await text(page);
    check(scope,'tools: what waits on a person is at the top, and only a read tool offers unattended',/Waiting on you/.test(t)&&/west door/.test(t)&&/changes the world/.test(t)&&await page.locator('[data-field="auto"]').count()===1);
    await page.screenshot({path:join(OUT,`desk-tools-${vp.width}.png`)});
    await page.locator('[data-crd-decide][data-yes="1"]').click();
    await page.waitForFunction(()=>/west door is open/.test(document.querySelector('[data-crd]').textContent),null,{timeout:15000});
    check(scope,'tools: an approval is decided through the function',calls(state,'decide')[0]?.body.approve===true);
    check(scope,'tools: no horizontal overflow',(await overflow(page))===0);
    check(scope,'no script errors',app.errors.length===0,app.errors);
    await app.ctx.close();
  }

  {
    /* Staff, not owner: reading works, changing what the bot may say is refused and the refusal is shown. */
    const app=await setup({width:390,height:844},{role:'staff'});const {page,state}=app;
    await page.goto(BASE+'/control.html#work:desk-bot',{waitUntil:'domcontentloaded'});
    await page.waitForSelector(`[data-crd-doc="${D1}"]`,{timeout:30000});
    await page.fill('#crdKbTitle','Anything');await page.fill('#crdKbBody','Anything at all.');
    await page.locator('[data-crd-put-form] button[type="submit"]').click();
    await page.waitForFunction(()=>/owner's to do/.test(document.querySelector('[data-crd]').textContent),null,{timeout:15000});
    check('staff','the function\'s owner gate is shown, not swallowed',/you are staff here/.test(await text(page))&&state.docs.length===2);
    check('staff','the typed page is kept for the owner to retry',await page.inputValue('#crdKbBody')==='Anything at all.');
    await app.ctx.close();
  }

  {
    /* Two desk orgs and neither is the Control workspace: the 403 list becomes the picker. */
    const orgs=[{id:'oa',slug:'acme',name:'Acme'},{id:'ob',slug:'shiloh',name:'Shiloh'}];
    const app=await setup({width:390,height:844},{orgs});const {page,state}=app;
    await page.goto(BASE+'/control.html#work:desk-bot',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('[data-crd-org="shiloh"]',{timeout:30000});
    await page.waitForSelector(`[data-crd-doc="${D1}"]`,{timeout:15000});
    check('multi-org','a refusal with the org list becomes a picker, and the first org is opened',await page.locator('[data-crd-org]').count()===2&&await page.locator('[data-crd-org="acme"]').getAttribute('aria-pressed')==='true');
    await page.locator('[data-crd-org="shiloh"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-crd-org="shiloh"]')?.getAttribute('aria-pressed')==='true'&&!!document.querySelector('[data-crd-doc]'),null,{timeout:15000});
    check('multi-org','switching org re-reads the desk for that org',calls(state,'kb_list').at(-1).body.org==='shiloh');
    check('multi-org','no horizontal overflow',(await overflow(page))===0);
    await page.screenshot({path:join(OUT,'desk-multi-org-390.png')});
    await app.ctx.close();
  }

  {
    /* acme's read is still in flight when the operator switches to shiloh: its late
       answer must not land in shiloh's view, and must not hold shiloh's read back. */
    const orgs=[{id:'oa',slug:'acme',name:'Acme'},{id:'ob',slug:'shiloh',name:'Shiloh'}];
    let release;const held=new Promise(r=>{release=r;});let heldAsked=false;
    const app=await setup({width:390,height:844},{orgs,tagOrg:true,hold:b=>{if(b.action==='kb_list'&&b.org==='acme'){heldAsked=true;return held;}}});const {page,state}=app;
    await page.goto(BASE+'/control.html#work:desk-bot',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!document.querySelector('[data-crd-tab="knowledge"]'),null,{timeout:30000});
    for(let i=0;i<300&&!heldAsked;i++)await page.waitForTimeout(50);
    await page.locator('[data-crd-tab="knowledge"]').click();
    await page.waitForSelector('[data-crd-org="shiloh"]',{timeout:15000});
    await page.locator('[data-crd-org="shiloh"]').click();
    await page.waitForFunction(()=>/Shiloh: McCluster Sites/.test(document.querySelector('[data-crd]')?.textContent||''),null,{timeout:15000});
    check('org-race','shiloh\'s read is not held back by acme\'s request still in flight',heldAsked&&calls(state,'kb_list').some(c=>c.body.org==='shiloh'));
    release();
    for(let i=0;i<100&&!calls(state,'kb_list').some(c=>c.body.org==='acme');i++)await page.waitForTimeout(50);
    await page.waitForTimeout(500);
    const t=await text(page);
    check('org-race','acme\'s late documents never land in shiloh\'s view',/Shiloh: McCluster Sites/.test(t)&&!/Acme:/.test(t),t.slice(0,300));
    check('org-race','the picker still says shiloh',await page.locator('[data-crd-org="shiloh"]').getAttribute('aria-pressed')==='true');
    check('org-race','no script errors',app.errors.length===0,app.errors);
    await app.ctx.close();
  }

  {
    /* The old room's URL is a stub that returns to Control and loads no desk script. */
    const app=await setup({width:390,height:844});const {page,requested}=app;
    await page.goto(BASE+'/inbox.html',{waitUntil:'domcontentloaded'});
    await page.waitForURL(/control\.html#work:inbox$/,{timeout:15000});
    check('inbox.html','the compatibility URL returns to Control and never requests inbox-desk.js',!requested.some(r=>/inbox-desk\.js/.test(r)));
    await app.ctx.close();
  }
}finally{await browser.close();}
const failed=results.filter(r=>!r.pass);
console.log(`\n${results.length-failed.length}/${results.length} desk bot checks passed; screenshots in ${OUT}`);
process.exit(failed.length?1:0);
