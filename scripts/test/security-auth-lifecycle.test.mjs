import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const src=await readFile(new URL('../../js/mcc-auth.js',import.meta.url),'utf8');
function harness() {
  const store=new Map(), tab=new Map(), calls=[], events=[];
  const storage=m=>({getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)});
  const root={localStorage:storage(store),sessionStorage:storage(tab),crypto:webcrypto,location:{origin:'https://mccluster.org',hostname:'mccluster.org',pathname:'/reset-password.html',search:'',hash:'',assign(){}},history:{replaceState(_a,_b,url){const u=new URL(url,'https://mccluster.org');root.location.search=u.search;root.location.hash=u.hash;}},dispatchEvent:e=>events.push(e)};
  let network=async()=>new Response('{}',{headers:{'content-type':'application/json'}});
  const context={window:root,fetch:async(url,init)=>{calls.push({url,init});return network(url,init);},URL,URLSearchParams,Date,Number,JSON,Uint8Array,TextEncoder,Promise,Error,Object,String,Math,Array,Set,console,btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail;}}};
  vm.runInNewContext(src,context);
  return {root,store,calls,events,setNetwork(fn){network=fn;}};
}
const response=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
const recovery={access_token:'fresh-session',refresh_token:'new-refresh',user:{id:'same-user',email:'person@example.test'}};
test('unrequested recovery fragments never establish a session or reach auth',async()=>{
  const h=harness();h.root.location.hash='#type=recovery&access_token=attacker&refresh_token=attacker-refresh';
  await assert.rejects(h.root.MCC.acceptRecoveryFromUrl(),/same browser/);
  assert.equal(h.calls.length,0);assert.equal(h.store.has('mccdb_session'),false);assert.equal(h.root.location.hash,'');
});
test('recovery uses a dedicated S256 proof and exchanges only the browser-bound code',async()=>{
  const h=harness();await h.root.MCC.requestPasswordReset('Person@Example.Test');
  const intent=JSON.parse(h.store.get('mcc.recovery.pkce.v1'));assert.ok(intent.verifier.length>=43);
  const outbound=JSON.parse(h.calls[0].init.body);assert.equal(outbound.code_challenge_method,'s256');
  assert.equal(outbound.code_challenge,Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(intent.verifier))).toString('base64url'));
  assert.equal(new URL(h.calls[0].url).searchParams.get('redirect_to'),'https://mccluster.org/reset-password.html');
  h.root.location.search='?code=one-time-code';h.setNetwork(()=>response(recovery));
  const result=await h.root.MCC.acceptRecoveryFromUrl();assert.equal(result.access_token,'fresh-session');
  const sent=JSON.parse(h.calls.at(-1).init.body);assert.deepEqual(sent,{auth_code:'one-time-code',code_verifier:intent.verifier});
  assert.equal(h.store.has('mcc.recovery.pkce.v1'),false);assert.equal(h.root.location.search,'');
  h.root.location.search='?code=one-time-code';const count=h.calls.length;
  await assert.rejects(h.root.MCC.acceptRecoveryFromUrl(),/same browser/);assert.equal(h.calls.length,count);
});
test('recovery rejects foreign redirects and unrelated account exchange responses',async()=>{
  const h=harness();await assert.rejects(h.root.MCC.requestPasswordReset('person@example.test','https://other.example/reset'),/this site/);assert.equal(h.calls.length,0);
  await h.root.MCC.requestPasswordReset('person@example.test');h.root.location.search='?code=code';
  h.setNetwork(()=>response({...recovery,user:{id:'attacker',email:'attacker@example.test'}}));
  await assert.rejects(h.root.MCC.acceptRecoveryFromUrl(),/match/);assert.equal(h.store.has('mccdb_session'),false);
});
test('a delayed refresh cannot resurrect a logged-out account',async()=>{
  const h=harness();h.store.set('mccdb_session',JSON.stringify({access_token:'old',refresh_token:'old-refresh'}));h.store.set('mcc_sess_keep',h.store.get('mccdb_session'));
  let release;h.setNetwork(()=>new Promise(resolve=>{release=resolve;}));
  const pending=h.root.MCC.refresh();h.store.delete('mccdb_session');h.store.delete('mcc_sess_keep');
  release(response(recovery));await pending;assert.equal(h.store.has('mccdb_session'),false);assert.equal(h.store.has('mcc_sess_keep'),false);
});
test('a delayed failed refresh cannot delete a newer login',async()=>{
  const h=harness();h.store.set('mccdb_session',JSON.stringify({access_token:'old',refresh_token:'old-refresh'}));
  let release;h.setNetwork(()=>new Promise(resolve=>{release=resolve;}));const pending=h.root.MCC.refresh();
  const next=JSON.stringify(recovery);h.store.set('mccdb_session',next);h.store.set('mcc_sess_keep',next);
  release(new Response('{"error":"expired"}',{status:401}));await pending;assert.equal(h.store.get('mccdb_session'),next);
});
