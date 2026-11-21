import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createEmailSignIn, safeReturn, PENDING, COOLDOWN, MAX_AGE, NOTICE} from '../../js/email-signin.mjs';
const origin = 'https://matthew.mccluster.org';
const session = {access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600,user:{id:'fixture-owner'}};
const ok = value => ({ok:true,status:200,json:async()=>value});
function setup(handler = () => ok({})) {
  const values = new Map(), calls = []; let clock = 1000000, events = 0;
  const storage = {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
  const client = createEmailSignIn({storage,origin,cryptoImpl:webcrypto,now:()=>clock,timeoutMs:20,
    onSignedIn:()=>events++,fetchImpl:async(url,opts)=>{calls.push({url,opts});return handler(url,opts);}});
  return {client, storage, calls, values, tick:ms=>clock+=ms, events:()=>events};
}
const send = f => f.client.send('fixture@example.test','/game-hub.html#m=chem108&play=molecule-rush');
const callback = f => f.client.complete('fixture-code',JSON.parse(f.storage.getItem(PENDING)).id);
test('requests existing account only with S256 and canonical callback, never credentials in redirect',async()=>{
 const f=setup();assert.equal(await send(f),NOTICE);
 const {url,opts}=f.calls[0],body=JSON.parse(opts.body),pending=JSON.parse(f.storage.getItem(PENDING));
 assert.equal(body.create_user,false);assert.equal(body.code_challenge_method,'s256');
 assert.match(body.code_challenge,/^[a-zA-Z0-9_-]{43}$/);
 assert.equal(new URL(url).searchParams.get('redirect_to'),origin+'/auth/email.html?state='+pending.id);
 assert.ok(!url.includes(pending.verifier));assert.ok(!url.includes('example.test'));
 assert.equal(f.storage.getItem('mccdb_session'),null);
});
test('same visible notice for nonexistent account and accepted request; provider body never read',async()=>{
 const f=setup(()=>({ok:false,status:400,json:()=>{throw Error('private provider detail');}}));assert.equal(await send(f),NOTICE);
});
test('cooldown is enforced across clients and 429 gives generic wait',async()=>{
 const f=setup(()=>({ok:false,status:429}));await assert.rejects(send(f),/limited/);
 await assert.rejects(send(f),/Wait/);assert.equal(f.calls.length,1);assert.ok(f.storage.getItem(COOLDOWN));
});
test('timeout bounds request and body reads without automatic retry',async()=>{
 for(const handler of [()=>new Promise(()=>{}),()=>({ok:true,json:()=>new Promise(()=>{})})]){
  const f=setup(handler);await assert.rejects(send(f),/unavailable/);assert.equal(f.calls.length,1);assert.equal(f.storage.getItem('mccdb_session'),null);
 }
});
test('safe returns reject external, control, slash tricks and callback loops',()=>{
 for(const raw of ['https://evil.test','//evil.test','/\\evil.test','/\nevil.test','/auth/email.html?code=x','/auth/','javascript:alert(1)',null])assert.equal(safeReturn(raw,origin),'/account.html?stay=1');
 assert.equal(safeReturn('/game-hub.html#m=chem108&play=molecule-rush',origin),'/game-hub.html#m=chem108&play=molecule-rush');
});
test('one-time exchange validates user before saving canonical session and returns original route',async()=>{
 const f=setup(url=>ok(url.includes('grant_type')?session:url.endsWith('/user')?session.user:{}));
 await send(f);const id=JSON.parse(f.storage.getItem(PENDING)).id;
 assert.equal(await f.client.complete('fixture-code',id),'/game-hub.html#m=chem108&play=molecule-rush');
 assert.equal(f.storage.getItem('mccdb_session'),f.storage.getItem('mcc_sess_keep'));assert.equal(f.events(),1);
 assert.equal(JSON.parse(f.calls[1].opts.body).auth_code,'fixture-code');
 await assert.rejects(f.client.complete('fixture-code',id),/expired|another browser/);assert.equal(f.calls.length,3);
});
test('wrong browser, state and expired local requests cannot exchange or save',async()=>{
 const f=setup();await assert.rejects(f.client.complete('x','no-record'),/expired/);await send(f);
 await assert.rejects(f.client.complete('x','wrong-state'),/expired/);f.tick(MAX_AGE+1);await assert.rejects(callback(f),/expired/);
 assert.equal(f.calls.length,1);assert.equal(f.events(),0);
});
test('provider expired/replayed code and invalid user fail closed',async()=>{
 for(const mode of ['reject','bad-user','missing-token']){
  const f=setup(url=> url.includes('grant_type') ? (mode==='reject'?{ok:false,status:400}:ok(mode==='missing-token'?{}:session)) : ok(url.endsWith('/user')?{id:'different-user'}:{}));
  await send(f);await assert.rejects(callback(f));assert.equal(f.storage.getItem('mccdb_session'),null);assert.equal(f.events(),0);
 }
});
test('sign-out or replacement account during verification is not overwritten',async()=>{
 let release;const f=setup(url=> url.endsWith('/user')?new Promise(resolve=>release=resolve):ok(url.includes('grant_type')?session:{}));
 f.storage.setItem('mccdb_session','old-account');await send(f);const completion=callback(f);
 while(!release)await new Promise(r=>setImmediate(r));
 f.storage.removeItem('mccdb_session');release(ok(session.user));await assert.rejects(completion,/account changed/);assert.equal(f.events(),0);assert.equal(f.storage.getItem('mccdb_session'),null);
});
test('late response after timeout cannot persist a session',async()=>{
 let release;const f=setup(url=>url.includes('grant_type')?new Promise(resolve=>release=resolve):ok({}));
 await send(f);await assert.rejects(callback(f),/timed out/);release(ok(session));await new Promise(r=>setImmediate(r));
 assert.equal(f.storage.getItem('mccdb_session'),null);assert.equal(f.events(),0);
});
test('storage refusal prevents sending a stranded link',async()=>{
 const f=setup();f.storage.setItem=()=>{throw Error('storage denied');};await assert.rejects(send(f),/storage denied/);assert.equal(f.calls.length,0);
});
test('partial session storage failure restores both previous slots',async()=>{
 const f=setup(url=>ok(url.includes('grant_type')?session:url.endsWith('/user')?session.user:{}));
 f.storage.setItem('mccdb_session','old');f.storage.setItem('mcc_sess_keep','old');await send(f);
 const write=f.storage.setItem;f.storage.setItem=(key,value)=>{if(key==='mcc_sess_keep'&&value!=='old')throw Error('quota');write(key,value);};
 await assert.rejects(callback(f),/could not save/);assert.equal(f.storage.getItem('mccdb_session'),'old');assert.equal(f.storage.getItem('mcc_sess_keep'),'old');assert.equal(f.events(),0);
});
test('malformed provider body is never displayed or persisted',async()=>{
 const f=setup(url=>url.includes('grant_type')?{ok:true,json:async()=>{throw Error('sensitive body contents');}}:ok({}));
 await send(f);await assert.rejects(callback(f),error=>/unreadable/.test(error.message)&&!error.message.includes('sensitive'));assert.equal(f.events(),0);
});
