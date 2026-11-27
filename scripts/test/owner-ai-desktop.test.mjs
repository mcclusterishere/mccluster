/* Actual Control page bridge and authentication/render plumbing, synthetic private responses. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openControl, ready, session, flush } from './support/control-room-page.mjs';

const company = 'https://mccluster.org', org = 'org-avocado', principal = 'owner-a';
const nodeId = 'node_' + '8'.repeat(32), implementation = 'qwen3-vl.4b.local', model = 'qwen3-vl:4b';
const plain = value => JSON.parse(JSON.stringify(value));
const wrapped = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const rpc = (e, result) => ({ jsonrpc: '2.0', id: e.rpc.id, result });
const oldFlag = process.env.CORE_OWNER_AI_WORKSPACE_ENABLED;
process.env.CORE_OWNER_AI_WORKSPACE_ENABLED = '1';
const { CONTROL_TOOLS } = await import('../../core/src/tools/control.mjs?desktop');
if (oldFlag === undefined) delete process.env.CORE_OWNER_AI_WORKSPACE_ENABLED;
else process.env.CORE_OWNER_AI_WORKSPACE_ENABLED = oldFlag;

function fixture() {
  const f = { threads: new Map(), submitted: [], creates: 0, stops: 0, history: [], tools: CONTROL_TOOLS, ready: true, reply: null };
  f.device = { node_id: nodeId, target: 'prime', display_name: 'Prime fixture', last_seen_at: new Date().toISOString(),
    eligible: true, target_ready: true, models: [{ model, implementation, ready: true, target_ready: true }] };
  f.overrides = [
    { match: e => e.path === '/rest/v1/ops_ai_threads', body: (_, e) => {
      if (e.method === 'POST') {
        f.creates++; const { id, org_id } = e.rpc;
        if (!f.threads.has(id)) f.threads.set(id, { id, org_id, title: 'New chat', status: 'active', created_by: principal });
        return [];
      }
      const id = new URL(e.url).searchParams.get('id');
      return id ? [f.threads.get(id.slice(3))].filter(Boolean) : [...f.threads.values()];
    } },
    { match: e => e.path === '/rest/v1/ops_ai_messages', body: () => f.history },
    { match: e => e.path === '/v1/core/mcp', body: (_, e) => {
      if (e.rpc.method === 'tools/list') return rpc(e, { tools: f.tools });
      const {name, arguments: args} = e.rpc.params;
      if (name === 'core.compute.devices.list') return rpc(e, wrapped({ devices: [{ ...f.device, target_ready: f.ready }], secret: 'hidden-inventory' }));
      if (name === 'core.compute.pairs.list') return rpc(e, wrapped({ pairs: [] }));
      if (name === 'core.ai.turn.submit') {
        f.submitted.push(args);
        const aid = randomUUID(), node = { route: 'fabric', node_id: nodeId, node_name: 'Prime fixture', model, implementation, hardware_mode: 'gpu-verified' };
        f.reply = { turn: { id: args.message_id, org_id: org, job_type: 'resident_ai_turn', status: 'done', input: { assistant_message_id: aid } },
          user_message: { role: 'user', id: args.message_id, org_id: org, thread_id: args.thread_id, content: args.content,
            metadata: { actor_kind: 'owner', actor_user_id: principal, agent_job_id: args.message_id, workspace_route: args.route } },
          assistant_message: { role: 'assistant', id: aid, org_id: org, thread_id: args.thread_id, content: 'Bounded fixture answer', model, implementation,
            compute_task_id: randomUUID(), metadata: { task_status: 'done', agent_job_id: args.message_id, requested_route: args.route, node, private_fixture: 'hidden-private' } } };
        return rpc(e, wrapped({ queued: true, thread_id: args.thread_id, turn_id: args.message_id, user_message_id: args.message_id, route: args.route }));
      }
      if (name === 'core.ai.turn.stop') { f.stops++; f.lastStop = args; return rpc(e, wrapped(f.stopResult)); }
      return rpc(e, wrapped(name === 'core.ai.turn.get' ? f.reply : {}));
    } }
  ];
  return f;
}
async function open(f, t, extra = {}) {
  const p = await openControl({ hash: '#home:ask', origin: company, storage: new Map([['mccdb_session', session(principal)]]), initialOverrides: f.overrides, ...extra });
  t.after(() => p.close()); await ready(p, 'McCluster'); await p.settle();
  return p;
}
async function call(p, op, args) {
  const api = p.win.McClusterOwnerChatV1, id = randomUUID();
  let answer = api.begin(id, op, args);
  const deadline = Date.now() + 5000;
  while (answer.status === 'pending') {
    assert.ok(Date.now() < deadline, 'page operation reached a terminal result');
    await flush(); answer = api.take(id);
  }
  return plain(answer);
}
const request = sid => ({ session_id: sid, thread_id: randomUUID(), message_id: randomUUID(), target: 'prime', node_id: nodeId, implementation, content: 'Return one word.' });
const forGet = ({session_id,thread_id,message_id:turn_id,target,node_id,implementation}) => ({session_id,thread_id,turn_id,target,node_id,implementation});

test('desktop discovers verified pins, sends a stable turn and returns only matching terminal evidence', async t => {
  const f = fixture(), page = await open(f, t);
  const {result} = await call(page, 'discover', {});
  assert.deepEqual(result.targets, [{target:'prime',node_id:nodeId,name:'Prime fixture',implementation,model}]);
  const send = request(result.session_id);
  const receipt = await call(page, 'submit', send);
  assert.deepEqual(receipt, {status:'ok',result:{status:'pending',thread_id:send.thread_id,turn_id:send.message_id}});
  assert.deepEqual(f.submitted[0], { org_id:org, thread_id:send.thread_id, message_id:send.message_id, content:send.content, input_mode:'text', route:{mode:'node',node_id:nodeId,implementation,target:'prime'} });
  assert.equal((await call(page,'submit',send)).result.turn_id,send.message_id);
  assert.equal(f.creates,1);
  f.ready = false;
  assert.equal((await call(page,'submit',send)).code,'UNAVAILABLE');
  const get = forGet(send), answer = await call(page,'get',get);
  assert.deepEqual(answer.result, {thread_id:send.thread_id,turn_id:send.message_id,status:'done',target:'prime',node_id:nodeId,node_name:'Prime fixture',implementation,model,hardware_mode:'gpu-verified',compute_task_id:f.reply.assistant_message.compute_task_id,content:'Bounded fixture answer'});
  f.reply.turn.status='running'; assert.deepEqual((await call(page,'get',get)).result,{thread_id:get.thread_id,turn_id:get.turn_id,status:'pending'});
  f.reply.turn.status='failed'; assert.equal((await call(page,'get',get)).result.status,'failed');
  f.reply.turn.status='done'; f.reply.assistant_message.metadata.node.node_id='node_'+'f'.repeat(32);
  assert.equal((await call(page,'get',get)).code,'REJECTED');
  f.reply.assistant_message.metadata.node.node_id=nodeId;
  f.reply.assistant_message.metadata.node.hardware_mode='cpu-only'; assert.equal((await call(page,'get',get)).code,'REJECTED');
  f.reply.user_message.metadata.actor_user_id='other'; assert.equal((await call(page,'get',get)).code,'REJECTED');
});
test('desktop rejects extra operations, stale sessions, foreign chats and unsupported Core', async t => {
  const f = fixture(), page = await open(f,t), {result} = await call(page,'discover',{});
  const send = request(result.session_id);
  assert.equal((await call(page,'tools/call',{})).code,'REJECTED');
  assert.equal((await call(page,'submit',{...send,allow_browser:true})).code,'REJECTED');
  assert.equal((await call(page,'submit',{...send,session_id:randomUUID()})).code,'CHANGED');
  f.threads.set(send.thread_id,{id:send.thread_id,org_id:org,created_by:'another-owner',status:'active'});
  assert.equal((await call(page,'submit',send)).code,'REJECTED'); assert.equal(f.creates,0);
  f.tools=f.tools.filter(tool=>tool.name!=='core.ai.turn.submit'); assert.equal((await call(page,'discover',{})).code,'UNSUPPORTED');
  assert.equal(f.submitted.length,0);
  await page.go('#home:today'); assert.equal((await call(page,'discover',{})).code,'OWNER_REQUIRED');
});
test('desktop history scopes both lists; Stop validates the saved pin and confirmed cancellation', async t => {
  const f = fixture(), page = await open(f,t), {result} = await call(page,'discover',{});
  assert.equal(result.can_stop,true);
  const sent = request(result.session_id), args = forGet(sent);
  await call(page,'submit',sent);
  const other = randomUUID(); f.threads.set(other,{id:other,org_id:org,status:'active',created_by:'other',title:'private fixture'});
  const threads = await call(page,'history',{session_id:result.session_id});
  assert.deepEqual(threads.result.threads,[{thread_id:sent.thread_id,title:'New chat'}]);
  assert.equal((await call(page,'history',{session_id:result.session_id,thread_id:other})).code,'REJECTED');
  const row = {id:sent.message_id,thread_id:sent.thread_id,org_id:org,role:'user',content:sent.content,
    actor:principal,actor_kind:'owner',job:sent.message_id,status:'running',route:f.submitted[0].route};
  f.history = [row,{...row,actor:'other',content:'hidden history'}];
  const history = await call(page,'history',{session_id:result.session_id,thread_id:sent.thread_id});
  assert.deepEqual(history.result.turns,[{turn_id:sent.message_id,target:'prime',node_id:nodeId,name:nodeId,implementation,model,prompt:sent.content,status:'pending'}]);
  assert.equal((await call(page,'stop',args)).code,'REJECTED'); // already completed
  f.reply.turn.status='running';
  assert.equal((await call(page,'stop',{...args,target:'ovh'})).code,'REJECTED');
  assert.equal(f.stops,0);
  f.stopResult = { stopped:false,status:'done' };
  assert.equal((await call(page,'stop',args)).code,'REJECTED');
  f.stopResult = {stopped:true,status:'canceled',turn_id:args.turn_id};
  assert.deepEqual((await call(page,'stop',args)).result,{thread_id:sent.thread_id,turn_id:args.turn_id,status:'canceled'});
  assert.deepEqual(f.lastStop,{org_id:org,turn_id:sent.message_id});
  f.tools=f.tools.filter(tool=>tool.name!=='core.ai.turn.stop');
  assert.deepEqual((await call(page,'discover',{})).result,{session_id:result.session_id,can_stop:false,targets:[]});
  assert.equal((await call(page,'submit',sent)).code,'UNSUPPORTED');
});

test('desktop authority must hold at collection and is unavailable to members and personal-host pages', async t => {
  const f = fixture(), page = await open(f,t);
  const id=randomUUID(), api=page.win.McClusterOwnerChatV1;
  assert.equal(api.begin(id,'discover',{}).status,'pending'); await page.settle();
  await page.otherTab(storage => storage.delete('mccdb_session'));
  assert.equal(api.take(id).code,'OWNER_REQUIRED');
  const denied = { match: e => e.path === '/v1/workspaces/me', body: () => ({ok:true,default_org_id:org,workspaces:[{org_id:org,slug:'mccluster',kind:'studio',role:'viewer',enabled:true}]}) };
  const member = await open(f,t,{initialOverrides:[...f.overrides,denied]});
  assert.equal((await call(member,'discover',{})).code,'OWNER_REQUIRED');
  const personal = await open(f,t,{origin:'https://matthew.mccluster.org'});
  assert.equal(personal.win.McClusterOwnerChatV1,undefined);
});
