/* Control · Work · Desk bot (js/control-room/desk-bot.js): the pure helpers, and
   the contract that the view only ever speaks to the existing `inbox` edge function.
   The browser proof is scripts/e2e/control-desk-bot.e2e.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import '../../js/control-room/desk-bot.js';
const H=globalThis.CR.deskBot.helpers;
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');

test('money reads micro-dollars as dollars, with precision under a cent',()=>{
  assert.equal(H.money(1640000),'$1.64');
  assert.equal(H.money(2000000),'$2.00');
  assert.equal(H.money(12),'$0.0000');
  assert.equal(H.money(41200),'$0.04');assert.equal(H.money(9000),'$0.0090');
  assert.equal(H.money(null),'$0.0000');
});

test('spend posture follows the router thresholds: full, cheapest past 75%, hand-off at 100%',()=>{
  assert.equal(H.spendPosture(100,1000).level,'ok');
  assert.equal(H.spendPosture(750,1000).level,'degraded');
  assert.match(H.spendPosture(1640000,2000000).text,/three quarters/);
  const spent=H.spendPosture(2500,2000);
  assert.equal(spent.level,'spent');assert.equal(spent.pct,100);assert.match(spent.text,/handing off/);
  assert.equal(H.spendPosture(5,0).level,'ok');assert.equal(H.spendPosture(5,0).pct,0);
  assert.match(H.spendPosture(5,0).text,/No budget/);
});

test('document meta calls out unembedded chunks only when there are some',()=>{
  assert.equal(H.docMeta({chunks:4,embedded:4}),'4 chunks');
  assert.equal(H.docMeta({chunks:1,embedded:1}),'1 chunk');
  assert.equal(H.docMeta({chunks:3,embedded:0}),'3 chunks · 3 unembedded');
  assert.equal(H.docMeta({}),'0 chunks');
});

test('outbound rows land in the refusal queue by state or by a stated refusal',()=>{
  assert.equal(H.outboundBucket({state:'sent'}),'sent');
  assert.equal(H.outboundBucket({state:'refused'}),'refused');
  assert.equal(H.outboundBucket({state:'failed'}),'refused');
  assert.equal(H.outboundBucket({state:'queued',refusal:'window closed'}),'refused');
  assert.equal(H.outboundBucket({state:'queued'}),'queued');
  assert.equal(H.outboundBucket(null),'queued');
});

test('kb_put body is trimmed, keeps the kind for a replace, and refuses what the function refuses',()=>{
  assert.deepEqual(H.kbPutBody({title:' Hours ',body:' Open. ',url:' '}),{body:{title:'Hours',body:'Open.',url:null,kind:'page'}});
  assert.deepEqual(H.kbPutBody({title:'A',body:'B',url:'https://x.example/',kind:'faq'}).body,{title:'A',body:'B',url:'https://x.example/',kind:'faq'});
  assert.ok(H.kbPutBody({title:'A',body:'  '}).error);
  assert.ok(H.kbPutBody({title:'',body:'B'}).error);
  assert.ok(H.kbPutBody({title:'A',body:'x'.repeat(200001)}).error);
});

test('org choice prefers the Control workspace, else the first the function lists',()=>{
  const orgs=[{id:'a',slug:'acme'},{id:'b',slug:'mccluster'}];
  assert.equal(H.pickOrg(orgs,'mccluster').slug,'mccluster');
  assert.equal(H.pickOrg(orgs,'b').slug,'mccluster');
  assert.equal(H.pickOrg(orgs,'other').slug,'acme');
  assert.equal(H.pickOrg([],'x'),null);
  assert.equal(H.pickOrg(null,'x'),null);
});

test('one door: the view calls only the inbox function, and only actions it serves',async()=>{
  const [js,fn]=await Promise.all([read('js/control-room/desk-bot.js'),read('supabase/functions/inbox/index.ts')]);
  const urls=[...js.matchAll(/["'](\/[a-z0-9/_-]+)["']/gi)].map(m=>m[1]).filter(u=>/^\/(functions|rest|v1)\//.test(u));
  assert.deepEqual([...new Set(urls)],['/functions/v1/inbox']);
  assert.doesNotMatch(js,/service_role|localStorage\.setItem|sessionStorage/);
  const used=[...new Set([...js.matchAll(/\bfn\("([a-z_]+)"/g)].map(m=>m[1]))];
  for(const a of ['kb_list','kb_put','kb_drop','kb_try','shared_put','ai_spend','outbound','channels','set_channel','tools','approvals','decide','set_tool','set_server','refresh_tools','poll'])assert.ok(used.includes(a),a+' is not offered');
  for(const a of used)assert.match(fn,new RegExp('action === "'+a+'"'),a+' is not an inbox action');
});

test('registered in NAV as People → Inbox → AI reply, in the workspace routes, the registry and the palette',async()=>{
  const [v2,nav,html]=await Promise.all([read('js/control-room-v2.js'),read('js/control-room/nav.js'),read('control.html')]);
  /* the desk bot became the inbox's AI reply settings; its old route still lands there */
  assert.match(nav,/v\("ai-reply", "AI reply", "work\.desk-bot", \["#work:desk-bot", "Desk bot"/);
  assert.match(v2,/window\.CR\.deskBot\.render\(\)/);assert.match(v2,/window\.CR\.deskBot\.bind\(/);assert.match(v2,/"work-desk-bot"/);
  assert.equal(globalThis.CR.workspaceCore,undefined);
  await import('../../js/control-room/nav.js');
  await import('../../js/control-room/workspace-core.js');
  assert.equal(globalThis.CR.workspaceCore.resolve('#work:desk-bot').hash,'#people:inbox:ai-reply');
  assert.equal(globalThis.CR.workspaceCore.resolve('#people:inbox:ai-reply').label,'Inbox · AI reply');
  assert.equal(globalThis.CR.nav.search('desk bot')[0].route,'#people:inbox:ai-reply');
  assert.ok(html.indexOf('js/control-room/desk-bot.js')>0&&html.indexOf('js/control-room/desk-bot.js')<html.indexOf('js/control-room-v2.js'));
});

test('the old room is gone: inbox.html is a stub back to Control and loads no desk script',async()=>{
  const html=await read('inbox.html');
  assert.match(html,/js\/control-compat\.js[^>]*data-control-target="#people:inbox:conversations"/);
  assert.doesNotMatch(html,/inbox-desk\.js|backend\.js|<main/);
  assert.match(html,/noindex,\s?nofollow/);
  await assert.rejects(read('js/inbox-desk.js'));
});

test('an org switch drops the old org\'s late answers: reads, retries and changes never touch the new view',async()=>{
  const B=globalThis.CR.deskBot,D=B.state,flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};
  const pending=[];
  globalThis.MCC_SUPA={url:'https://fixture.supabase.co',key:'anon',token:()=>Promise.resolve('tok')};
  const prevFetch=globalThis.fetch;
  globalThis.fetch=(url,init)=>new Promise(resolve=>pending.push({body:JSON.parse(init.body),answer:(status,j)=>resolve({ok:status<300,status,json:()=>Promise.resolve(j)})}));
  const take=(action,org)=>{const i=pending.findIndex(p=>p.body.action===action&&p.body.org===org);assert.ok(i>=0,action+' for '+org+' was not asked');return pending.splice(i,1)[0];};
  const asked=(action,org)=>pending.some(p=>p.body.action===action&&p.body.org===org);
  try{
    /* Control's workspace is acme: the first render asks for acme's knowledge. */
    B.init({render:()=>{},workspace:()=>({slug:'acme'})});
    B.render();
    D.orgs=[{slug:'acme',name:'Acme'},{slug:'shiloh',name:'Shiloh'}];
    /* A minimal DOM: the org picker, the teach form and the try form, wired by the real bind(). */
    const fields={crdKbTitle:'A page',crdKbUrl:'',crdKbBody:'A body',crdTryQ:'a question'};
    const picker={getAttribute:()=> 'shiloh'},putForm={},tryForm={};
    const el={querySelector:sel=>sel==='[data-crd]'?{}:sel.startsWith('#')?{value:fields[sel.slice(1)]}:null,
      querySelectorAll:sel=>({'[data-crd-org]':[picker],'[data-crd-put-form]':[putForm],'[data-crd-try-form]':[tryForm]}[sel]||[])};
    B.bind(el);
    B.load('spend');
    putForm.onsubmit({preventDefault(){}});tryForm.onsubmit({preventDefault(){}});
    await flush();
    assert.ok(asked('kb_list','acme')&&asked('ai_spend','acme')&&asked('kb_put','acme')&&asked('kb_try','acme'));
    assert.equal(D.loading.knowledge,true);

    picker.onclick();
    assert.equal(D.org,'shiloh');
    assert.equal(D.loading.knowledge,undefined,'A\'s in-flight read must not suppress B\'s');
    assert.equal(D.busy.put,undefined);assert.equal(D.form.body,'');
    B.render();await flush();
    assert.ok(asked('kb_list','shiloh'),'B\'s knowledge load was suppressed');

    take('kb_list','acme').answer(200,{documents:[{id:'a1',title:'Acme secret'}]});await flush();
    assert.equal(D.data.knowledge,undefined,'A\'s documents landed in B\'s view');
    assert.equal(D.loading.knowledge,true,'A\'s completion cleared B\'s loading flag');
    take('kb_list','shiloh').answer(200,{documents:[{id:'b1',title:'Shiloh hours'}]});await flush();
    assert.deepEqual(D.data.knowledge.map(d=>d.title),['Shiloh hours']);
    const html=B.render();
    assert.match(html,/Shiloh hours/);assert.doesNotMatch(html,/Acme secret/);

    /* B starts typing; A's late kb_put (which would clear the form, say "indexed" and re-read) and kb_try land. */
    D.form={title:'B page',url:'',body:'B typing',kind:'page'};
    take('kb_put','acme').answer(200,{indexed:true,chunks:2,embedded:true});
    take('kb_try','acme').answer(200,{hits:[{title:'Acme hit',body:'x'}]});await flush();
    assert.equal(D.form.body,'B typing');assert.equal(D.note,null);assert.equal(D.tryHits,null);
    assert.ok(!asked('kb_list','acme')&&!asked('kb_list','shiloh'),'A\'s change re-read the desk');

    /* A's late 403 with the org list would retry as the picker's current org: it is dropped instead. */
    const orgsBefore=D.orgs;
    take('ai_spend','acme').answer(403,{error:'name which org this is for',orgs:[{slug:'acme'},{slug:'shiloh'}]});await flush();
    assert.equal(pending.length,0,'A\'s refusal was retried: '+JSON.stringify(pending.map(p=>p.body)));
    assert.equal(D.orgs,orgsBefore);assert.equal(D.org,'shiloh');
    assert.equal(D.errors.spend,undefined);assert.equal(D.data.spend,undefined);
  }finally{globalThis.fetch=prevFetch;delete globalThis.MCC_SUPA;}
});
