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

test('registered as a Work view, in the workspace routes, the registry and the palette',async()=>{
  const [v2,core,reg,html]=await Promise.all([read('js/control-room-v2.js'),read('js/control-room/workspace-core.js'),read('js/control-registry.js'),read('control.html')]);
  assert.match(v2,/var WORK_VIEWS = \[[^\]]*"desk-bot"/);
  assert.match(v2,/window\.CR\.deskBot\.render\(\)/);assert.match(v2,/window\.CR\.deskBot\.bind\(/);assert.match(v2,/"work-desk-bot"/);
  assert.equal(globalThis.CR.workspaceCore,undefined);
  await import('../../js/control-room/workspace-core.js');
  assert.equal(globalThis.CR.workspaceCore.resolve('#work:desk-bot').hash,'#work:desk-bot');
  assert.match(core,/'desk-bot':'Desk bot'/);
  assert.match(reg,/href:"control\.html#work:desk-bot"/);
  assert.ok(html.indexOf('js/control-room/desk-bot.js')>0&&html.indexOf('js/control-room/desk-bot.js')<html.indexOf('js/control-room-v2.js'));
});

test('the old room is gone: inbox.html is a stub back to Control and loads no desk script',async()=>{
  const html=await read('inbox.html');
  assert.match(html,/js\/control-compat\.js[^>]*data-control-target="#work:inbox"/);
  assert.doesNotMatch(html,/inbox-desk\.js|backend\.js|<main/);
  assert.match(html,/noindex, nofollow/);
  await assert.rejects(read('js/inbox-desk.js'));
});
