// Native PostgreSQL + signed PostgREST JWTs in disposable containers. No live access.
import {execFileSync,spawn} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHmac,randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const prefix='analytics-layout-test-'+process.pid,db=prefix+'-db',api=prefix+'-api',net=prefix+'-net';
const secret=randomBytes(40).toString('hex'),owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',viewer='33333333-3333-4333-8333-333333333333';
const house='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',scope='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',foreign='cccccccc-cccc-4ccc-8ccc-cccccccccccc',disabled='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const sql=text=>execFileSync('docker',['exec','-i',db,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1','-At'],{input:text,encoding:'utf8'}).trim();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const results=[];function check(name,ok){results.push({name,pass:!!ok});assert.ok(ok,name);console.log('PASS '+name);}
function token(sub,role='authenticated',extra={}){const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),body=Buffer.from(JSON.stringify({...extra,role,sub,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return head+'.'+body+'.'+createHmac('sha256',secret).update(head+'.'+body).digest('base64url');}
let base,browser,server;
async function rpc(name,args,who=owner){const r=await fetch(base+'/rpc/'+name,{method:'POST',headers:{'content-type':'application/json',...(who?{authorization:'Bearer '+token(who)}:{})},body:JSON.stringify(args)});return {status:r.status,body:await r.json()};}
const read=(org=scope,who=owner)=>rpc('owner_analytics_layout_read_v1',{p_org_id:org},who);
const save=(revision,layout,org=scope,who=owner)=>rpc('owner_analytics_layout_save_v1',{p_org_id:org,p_expected_revision:revision,p_layout:layout},who);
const out=process.env.ANALYTICS_LAYOUT_PROOF||'/tmp/analytics-layout-native-proof';await mkdir(out,{recursive:true});
try{
 docker('network','create',net);
 docker('run','-d','--name',db,'--network',net,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:16@sha256:f9a7b9ebf6f56201f949db745e47bc423c0f0f8294bafe991cc10bf74b029657');
 for(let i=0;i<80;i++){try{docker('exec',db,'pg_isready','-h','127.0.0.1','-U','postgres');break;}catch{await delay(100);}}
 sql(await readFile('supabase/tests/owner_analytics_layout.stub.sql','utf8'));
 const foundation=await readFile('supabase/replay_migrations/0072_org_helper_replay_foundation.sql','utf8');
 const admin=await readFile('supabase/migrations/20260921050000_mnet_profile_save_autofollow_admin.sql','utf8');
 for(const [source,name] of [[foundation,'is_org_owner'],[foundation,'mccluster_is_house_owner'],[admin,'mnet_is_admin']]){
  const start=source.indexOf('create or replace function public.'+name+'('),end=source.indexOf('$$;',start)+3;assert.ok(start>=0&&end>start);sql(source.slice(start,end));
 }
 const migration=await readFile('supabase/pending/owner_analytics_layout_v1.sql','utf8');sql(migration);
 docker('run','-d','--name',api,'--network',net,'-p','127.0.0.1::3000','-e','PGRST_DB_URI=postgres://authenticator@'+db+':5432/postgres','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_JWT_SECRET='+secret,'postgrest/postgrest:v13.0.7@sha256:0a46780309a604cdc8b56c776c6e5e15788ce58174d709e40459ab5a2d44d228');
 base='http://'+docker('port',api,'3000/tcp');
 for(let i=0;i<100;i++){try{if((await read()).status===200)break;}catch{}await delay(100);}
 let first=await read();check('native owner read returns scope and virtual revision zero',first.status===200&&first.body.org_id===scope&&first.body.revision==='0');
 const defaults=first.body.layout;check('reading defaults does not write a row',sql('select count(*) from owner_analytics_layouts')==='0');
 for(const [name,org,user] of [['anonymous',scope,null],['viewer',scope,viewer],['tenant owner without house',foreign,other],['cross-scope viewer',foreign,owner],['disabled org',disabled,owner],['unknown org','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',owner]]){
  const r=await read(org,user),w=await save('0',defaults,org,user);check(name+' cannot read or save', [401,403].includes(r.status)&&[401,403].includes(w.status));
 }
 for(const [name,bearer] of [['service role has no editor grant',token(owner,'service_role')],['editable metadata cannot elevate viewer',token(viewer,'authenticated',{user_metadata:{role:'owner',is_admin:true}})],['invalid JWT signature rejected',token(owner).slice(0,-4)+'xxxx']]){
  const r=await fetch(base+'/rpc/owner_analytics_layout_read_v1',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+bearer},body:JSON.stringify({p_org_id:scope})});check(name,[401,403].includes(r.status));
 }
 check('raw layout table is not exposed',![200,201,204].includes((await fetch(base+'/owner_analytics_layouts',{headers:{authorization:'Bearer '+token(owner)}})).status));
 check('private helper has no authenticated execution grant',sql("select has_function_privilege('authenticated','private.analytics_layout_scope_v1(uuid,boolean)','execute')") ==='f');
 const bad=[null,[],{...defaults,version:2},{...defaults,extra:true},{...defaults,order:defaults.order.slice(1)},{...defaults,order:['overview','audience','audience','action','intelligence','inventory']},{...defaults,order:[...defaults.order.slice(1),'overview']},{...defaults,defaults:{...defaults.defaults,content:'forensics'}},{...defaults,defaults:{...defaults.defaults,hidden:'overview'}}];
 for(const [i,value] of bad.entries())check('server rejects malformed layout '+i,(await save('0',value)).status===400);
 check('request cannot supply an actor or alternate authority',(await rpc('owner_analytics_layout_save_v1',{p_org_id:scope,p_expected_revision:'0',p_layout:defaults,p_actor:other})).status===404);
 let changed=structuredClone(defaults);changed.order=['overview','inventory','content','action','intelligence','audience'];changed.defaults.inventory='forensics';
 let saved=await save('0',changed);check('native save and readback persist layout',saved.status===200&&JSON.stringify((await read()).body.layout)===JSON.stringify(saved.body.layout));
 check('stale revision is HTTP 409',(await save('0',defaults)).status===409);
 check('cross-scope revision cannot overwrite house',(await save(saved.body.revision,defaults,house)).status===409);
 // Hold the canonical scope row, then launch two HTTP saves against the same revision.
 const lock=spawn('docker',['exec','-i',db,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1'],{stdio:['pipe','ignore','inherit']});
 const locked=new Promise((resolve,reject)=>lock.on('exit',code=>code?reject(Error('lock failed')):resolve()));
 lock.stdin.end("begin;set application_name='layout-lock-proof';select id from orgs where id='"+scope+"' for update;select pg_sleep(1);commit;");
 for(let i=0;i<40;i++){if(sql("select count(*) from pg_stat_activity where application_name='layout-lock-proof' and wait_event='PgSleep'")==='1')break;await delay(20);}
 const concurrent=await Promise.all([save(saved.body.revision,defaults),save(saved.body.revision,changed)]);await locked;
 check('two native concurrent saves yield one commit and one conflict',concurrent.map(x=>x.status).sort().join(',')==='200,409');
 const current=await read();check('each successful revision has atomic audit evidence',sql('select count(*) from owner_analytics_layout_history')==='2'&&sql('select count(*) from owner_analytics_layouts l join owner_analytics_layout_history h using(revision) where h.layout=l.layout')==='1');
 // Actual commit, then transport loss at the adapter boundary; reload reconciles it.
 const w={CR:{},atob:s=>Buffer.from(s,'base64').toString(),fetch:async(url,opts)=>fetch(url.replace('/rest/v1',''),opts)};vm.createContext(w);w.window=w;
 for(const file of ['analytics-layout','analytics-layout-adapter'])vm.runInContext(await readFile('js/control-room/'+file+'.js','utf8'),w);
 let drop=true;const adapter=w.CR.analyticsLayoutAdapter.create({orgId:scope,supa:{url:base,key:'fixture',token:async()=>token(owner)},fetch:async(url,opts)=>{const r=await w.fetch(url,opts);if(drop&&url.endsWith('_save_v1')){drop=false;throw Error('simulated lost response after real commit');}return r;}});
 await assert.rejects(adapter.save({expectedRevision:current.body.revision,layout:defaults}),e=>e.status===503);
 const recovered=await adapter.load();check('uncertain committed write recovers by readback',recovered.revision!==current.body.revision&&recovered.layout.order[1]==='audience');
 await assert.rejects(adapter.save({expectedRevision:current.body.revision,layout:defaults}),e=>e.status===409);check('uncertain write cannot replay stale revision',true);
 // Scoped ownership revoked after a successful read must block the next request.
 sql("update org_members set role='viewer' where org_id='"+scope+"' and profile_id='"+owner+"'");
 check('revoked owner denied on next read and write',(await read()).status===403&&(await save(recovered.revision,defaults)).status===403);
 sql("update org_members set role='owner' where org_id='"+scope+"' and profile_id='"+owner+"'");
 sql("update orgs set enabled=false where id='"+house+"'");check('disabled house denies target scope',(await read()).status===403);sql("update orgs set enabled=true where id='"+house+"'");
 if(process.env.PLAYWRIGHT_DIR){
  const {chromium}=createRequire(join(process.env.PLAYWRIGHT_DIR,'x'))('playwright');browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox']});
  const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/control-admin-layout.css"><style>body{margin:12px;font:16px system-ui}*{box-sizing:border-box}</style><main></main><script src="/js/control-room/analytics-layout.js"></script><script src="/js/control-room/analytics-layout-adapter.js"></script><script>const a=CR.analyticsLayoutAdapter.create({orgId:'+JSON.stringify(scope)+',supa:{url:'+JSON.stringify(base+'/rest-proxy')+',key:"fixture",token:async()=>window.TEST_TOKEN}});document.querySelector("main").innerHTML=CR.analyticsLayout.render();CR.analyticsLayout.bind(document,{adapter:a,identity:a.identity});</script>';
  server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://fixture').pathname;if(path==='/'){res.setHeader('content-type','text/html');res.end(html);return;}const allowed=['/css/control-admin-layout.css','/js/control-room/analytics-layout.js','/js/control-room/analytics-layout-adapter.js'];if(!allowed.includes(path)){res.writeHead(404);res.end();return;}res.setHeader('content-type',path.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile('.'+path));}catch{res.writeHead(500);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  for(const width of [390,1280]){
   const context=await browser.newContext({viewport:{width,height:900}});await context.addInitScript(t=>window.TEST_TOKEN=t,token(owner));
   // Forward only the local fixture URL to the actual isolated PostgREST process.
   let dropNextSave=false;await context.route(base+'/rest-proxy/rest/v1/rpc/**',async route=>{const r=await fetch(route.request().url().replace('/rest-proxy/rest/v1',''),{method:'POST',headers:route.request().headers(),body:route.request().postData()});if(dropNextSave&&route.request().url().endsWith('_save_v1')){dropNextSave=false;await r.text();await route.abort('failed');return;}await route.fulfill({status:r.status,contentType:'application/json',body:await r.text()});});
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);const status=page.locator('[data-layout-status]');await status.filter({hasText:'Saved layout loaded'}).waitFor();
   await page.getByRole('button',{name:'Use default arrangement'}).click();await page.getByRole('button',{name:'Move Content earlier',exact:true}).click();await page.locator('[data-layout-default="content"]').selectOption('adaptive');await page.getByRole('button',{name:'Save layout',exact:true}).click();await status.filter({hasText:'Layout saved'}).waitFor();
   await page.reload();await status.filter({hasText:'Saved layout loaded'}).waitFor();check(width+' full page reload reads native persisted choice',await page.locator('[data-layout-default="content"]').inputValue()==='adaptive'&&await page.locator('[data-layout-body] li').nth(1).locator('b').textContent()==='Content');
   dropNextSave=true;await page.getByRole('button',{name:'Save layout',exact:true}).click();await status.filter({hasText:'outcome is unknown'}).waitFor();check(width+' lost native commit disables save until reload',await page.getByRole('button',{name:'Save layout',exact:true}).isDisabled());await page.getByRole('button',{name:'Reload saved layout'}).click();await status.filter({hasText:'Saved layout loaded'}).waitFor();check(width+' lost native commit reconciles from database',await page.locator('[data-layout-default="content"]').inputValue()==='adaptive');
   const external=await read();await save(external.body.revision,defaults);await page.getByRole('button',{name:'Save layout',exact:true}).click();await status.filter({hasText:'changed elsewhere'}).waitFor();check(width+' native stale conflict disables UI saving',await page.getByRole('button',{name:'Save layout',exact:true}).isDisabled());
   await page.getByRole('button',{name:'Reload saved layout'}).click();await status.filter({hasText:'Saved layout loaded'}).waitFor();
   sql("update org_members set role='viewer' where org_id='"+scope+"' and profile_id='"+owner+"'");await page.getByRole('button',{name:'Save layout',exact:true}).click();await status.filter({hasText:'Access or account changed'}).waitFor();check(width+' native revocation clears editor',await page.locator('[data-layout-body] li').count()===0);sql("update org_members set role='owner' where org_id='"+scope+"' and profile_id='"+owner+"'");
   await page.reload();await status.filter({hasText:'Saved layout loaded'}).waitFor();check(width+' no overflow or script error',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth)&&errors.length===0);await page.screenshot({path:join(out,'native-'+width+'.png'),fullPage:true});await context.close();
  }
 }
 sql(await readFile('supabase/pending/owner_analytics_layout_v1.rollback.sql','utf8'));
 check('rollback revokes API access and retains records',(await read()).status===403&&Number(sql('select count(*) from owner_analytics_layout_history'))>0);
 sql(migration);check('reapply restores API without resetting revisions',(await read()).status===200&&(await read()).body.revision!=='0');
}finally{
 await browser?.close();if(server)await new Promise(r=>server.close(r));
 for(const name of [api,db])try{docker('rm','-f',name);}catch{}
 try{docker('network','rm',net);}catch{}
 await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));
}
