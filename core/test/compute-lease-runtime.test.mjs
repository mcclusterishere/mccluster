import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { LeaseAuthority, runLease } from '../src/compute/lease-runtime.mjs';
import { requestJson, readBoundedText } from '../src/compute/request-json.mjs';

const identity = { lease_id: 'lease-A', task_id: 'task-A', org_id: 'org-A', node_id: 'node-A', attempt: 1 };
const baseTime = Date.parse('2026-10-20T07:00:00Z');
function receipt(at = 0, duration = 120_000, extra = {}) {
  return { ...identity, status: 'running', server_time: new Date(baseTime + at).toISOString(), expires_at: new Date(baseTime + at + duration).toISOString(), ...extra };
}
function harness() {
  let mono = 0; let wall = baseTime;
  const clock = () => ({ mono, wall });
  const timers = new Map(); let next = 1;
  const options = { clock, setIntervalImpl: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; }, clearIntervalImpl: (id) => timers.delete(id) };
  return { clock, options, advance(ms, wallMs = ms) { mono += ms; wall += wallMs; }, fire(ms) { for (const timer of [...timers.values()]) if (timer.ms === ms) timer.fn(); }, timers };
}
function claim() { return { ...receipt(0, 120_000, { status: 'leased' }), lease_token: 'secret', task: { id: 'task-A', org_id: 'org-A' } }; }
function deferred() { let resolve; let reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
async function flush() { for (let i=0;i<5;i++) await Promise.resolve(); }

test('a delayed response subtracts the whole round trip; requested duration never grants authority', () => {
  const h = harness(); const sentAt = h.clock(); h.advance(60_000);
  const guard = new LeaseAuthority({ lease: claim(), nodeId: 'node-A', sentAt, clock: h.clock });
  h.advance(58_999); guard.assertCurrent();
  h.advance(1); assert.throws(() => guard.assertCurrent(), /deadline passed/);
});

test('renewal received after previous authority expired cannot revive a lease', () => {
  const h=harness(); const guard=new LeaseAuthority({ lease: claim(), nodeId:'node-A', sentAt:h.clock(), clock:h.clock });
  h.advance(90_000); const sent=h.clock(); h.advance(30_000);
  assert.throws(()=>guard.confirm(receipt(90_000),sent), /deadline passed/);
  assert.equal(guard.controller.signal.aborted,true);
});

for (const [name, extra] of [['node',{node_id:'other'}],['org',{org_id:'other'}],['task',{task_id:'other'}],['attempt',{attempt:2}],['lease',{lease_id:'other'}]]) {
  test(`renewal cannot change ${name} ownership`, () => {
    const h=harness(); const guard=new LeaseAuthority({ lease:claim(),nodeId:'node-A',sentAt:h.clock(),clock:h.clock });
    h.advance(10_000); assert.throws(()=>guard.confirm(receipt(10_000,120_000,extra),h.clock()),/mismatched/);
  });
}

test('replayed receipt is rejected even when still within the local deadline', () => {
  const h=harness(); const guard=new LeaseAuthority({ lease:claim(),nodeId:'node-A',sentAt:h.clock(),clock:h.clock });
  h.advance(100); const first=receipt(100); guard.confirm(first,h.clock());
  h.advance(100); assert.throws(()=>guard.confirm(first,h.clock()),/stale/);
});

for (const [name, mono, wall] of [['sleep',10,180_000],['wall clock rollback',100,-60_000],['wall clock forward',100,60_000]]) {
  test(`${name} invalidates existing authority`, () => {
    const h=harness(); const guard=new LeaseAuthority({lease:claim(),nodeId:'node-A',sentAt:h.clock(),clock:h.clock});
    h.advance(mono,wall); assert.throws(()=>guard.assertCurrent(),/Clock discontinuity/);
  });
}

test('valid start and completion persist exactly one result', async () => {
  const h=harness(); const calls=[];
  const outcome=await runLease({lease:claim(),nodeId:'node-A',sentAt:h.clock(),...h.options,
    request:async(path,body)=>{calls.push({path,body}); h.advance(10); return path.endsWith('/start')?{ok:true,result:receipt(10)}:{ok:true,result:true};},
    execute:async()=>({answer:42})});
  assert.equal(outcome.status,'committed'); assert.equal(calls.filter(c=>c.path.endsWith('/complete')).length,1);
  assert.equal(calls.at(-1).body.result.answer,42); assert.equal(h.timers.size,0);
});

test('hung renewal expires, aborts inference, and rejects its late result', async () => {
  const h=harness(); const work=deferred(); const renewal=deferred(); const calls=[]; let signal;
  const run=runLease({lease:claim(),nodeId:'node-A',sentAt:h.clock(),...h.options,
    request:async(path)=>{calls.push(path); if(path.endsWith('/start')){h.advance(10);return {ok:true,result:receipt(10)};} return renewal.promise;},
    execute:async(_,s)=>{signal=s; return work.promise;}});
  await flush(); h.advance(30_000); h.fire(30_000); await flush(); h.advance(90_000); h.fire(250);
  assert.equal(signal.aborted,true);
  renewal.resolve({ok:true,result:receipt(120_000)}); work.resolve({late:true});
  assert.equal((await run).status,'authority_lost'); assert.equal(calls.some(p=>p.endsWith('/complete')),false);
});

for(const status of [401,403,409]) {
  test(`renewal HTTP ${status} aborts inference without reporting completion or failure`,async()=>{
    const h=harness();const work=deferred();let signal;const calls=[];
    const run=runLease({lease:claim(),nodeId:'node-A',sentAt:h.clock(),...h.options,
      request:async(path)=>{calls.push(path); if(path.endsWith('/start')){h.advance(10);return {ok:true,result:receipt(10)};}throw Object.assign(new Error('revoked'),{status});},
      execute:async(_,s)=>{signal=s;return work.promise;}});
    await flush();h.advance(30_000);h.fire(30_000);await flush();assert.equal(signal.aborted,true);work.resolve({late:true});
    assert.equal((await run).status,'authority_lost');assert.equal(calls.some(p=>/\/(complete|fail)$/.test(p)),false);
  });
}

test('shutdown propagates cancellation and cannot publish late output',async()=>{
  const h=harness();const stop=new AbortController();const work=deferred();const calls=[];let signal;
  const run=runLease({lease:claim(),nodeId:'node-A',sentAt:h.clock(),signal:stop.signal,...h.options,
    request:async(path)=>{calls.push(path);h.advance(10);return {ok:true,result:receipt(10)};},execute:async(_,s)=>{signal=s;return work.promise;}});
  await flush();stop.abort(new Error('shutdown'));assert.equal(signal.aborted,true);work.resolve({late:true});
  assert.equal((await run).status,'authority_lost');assert.equal(calls.length,1);
});

test('lost completion response never sends a failure that could undo committed work',async()=>{
  const h=harness();const calls=[];
  const result=await runLease({lease:claim(),nodeId:'node-A',sentAt:h.clock(),...h.options,
    request:async(path)=>{calls.push(path);if(path.endsWith('/start')){h.advance(10);return {ok:true,result:receipt(10)};}throw new Error('socket closed after commit');},execute:async()=>({answer:42})});
  assert.equal(result.status,'unconfirmed');assert.equal(calls.some(p=>p.endsWith('/fail')),false);
});

test('gateway timeout includes stalled response bodies and aborts the real HTTP request',async()=>{
  const server=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('{');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {await assert.rejects(requestJson(`http://127.0.0.1:${server.address().port}`,{timeoutMs:1000}),/abort|timeout/i);}
  finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('response byte bounds reject declared and chunked oversized bodies',async()=>{
  await assert.rejects(readBoundedText(new Response('small',{headers:{'content-length':'9000'}}),20),error=>error.code==='RESPONSE_TOO_LARGE');
  let canceled=false;
  const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(30));},cancel(){canceled=true;}});
  await assert.rejects(readBoundedText(new Response(body),20),error=>error.code==='RESPONSE_TOO_LARGE');
  assert.equal(canceled,true);
  assert.equal(await readBoundedText(new Response('{"ok":true}'),20),'{"ok":true}');
});
