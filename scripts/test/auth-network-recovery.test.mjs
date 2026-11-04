import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../../js/mcc-auth.js',import.meta.url),'utf8');
const saved={access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:1};
const reply=(body,status=200)=>({ok:status<400,status,headers:{get:()=>null},text:async()=>JSON.stringify(body)});
function client(fetchImpl,{fast=false}={}) {
 const values=new Map([['mccdb_session',JSON.stringify(saved)],['mcc_sess_keep',JSON.stringify(saved)]]);
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const window={localStorage:storage,sessionStorage:storage,location:{origin:'https://matthew.mccluster.org',search:'',pathname:'/account.html'},dispatchEvent(){}};
 vm.runInNewContext(source,{window,fetch:fetchImpl,AbortController,CustomEvent:class{},URL,URLSearchParams,setTimeout:fast?(fn,ms)=>setTimeout(fn,Math.min(ms,10)):setTimeout,clearTimeout});
 return {api:window.MCC,values,storage,window};
}
test('network refresh failure retains both stored copies but grants no session',async()=>{
 const c=client(async()=>{throw new TypeError('offline');});
 await assert.rejects(c.api.refresh());
 assert.equal(c.storage.getItem('mccdb_session'),JSON.stringify(saved));
 assert.equal(c.storage.getItem('mcc_sess_keep'),JSON.stringify(saved));
});
test('sign-in timeout settles and ignores a late successful response',{timeout:1000},async()=>{
 let resolve;const c=client(()=>new Promise(r=>resolve=r),{fast:true});
 await assert.rejects(c.api.signInWithPassword('fixture@example.test','fixture-password'),/did not respond/);
 resolve(reply({access_token:'too-late',refresh_token:'late'}));await new Promise(r=>setTimeout(r,0));
 assert.equal(c.api.session().access_token,saved.access_token);
});
for(const status of [429,500,503]) test(`refresh HTTP ${status} preserves credentials and fails closed`,async()=>{
 const c=client(async()=>reply({code:'unexpected_failure',msg:'Unavailable'},status));
 await assert.rejects(c.api.refresh());assert.equal(c.api.session().access_token,saved.access_token);
});
for(const code of ['refresh_token_not_found','refresh_token_already_used','session_expired','session_not_found']) test(`explicit ${code} clears only the rejected session`,async()=>{
 const c=client(async()=>reply({code,msg:'Rejected'},400));assert.equal(await c.api.refresh(),null);
 assert.equal(c.storage.getItem('mccdb_session'),null);assert.equal(c.storage.getItem('mcc_sess_keep'),null);
});
test('simultaneous refresh callers share one request and store rotation once',async()=>{
 let finish,calls=0;const c=client(()=>{calls++;return new Promise(r=>finish=r);});
 const first=c.api.refresh(),second=c.api.refreshIfNeeded();assert.equal(first,second);
 await Promise.resolve();finish(reply({access_token:'rotated',refresh_token:'new-refresh',expires_in:3600}));
 await Promise.all([first,second]);assert.equal(calls,1);assert.equal(c.api.session().access_token,'rotated');
});
for(const failure of [false,true]) test(`late ${failure?'rejection':'success'} cannot overwrite a newer account`,async()=>{
 let finish;const c=client(()=>new Promise(r=>finish=r));const pending=c.api.refresh();await Promise.resolve();
 const newer={access_token:'another-account',refresh_token:'other-refresh'};c.storage.setItem('mccdb_session',JSON.stringify(newer));
 finish(failure?reply({code:'refresh_token_not_found'},400):reply({access_token:'old-account-new-token',refresh_token:'old-refresh'}));
 assert.equal(await pending,null);assert.equal(c.api.session().access_token,'another-account');
});
test('late refresh after explicit sign-out cannot resurrect a session',async()=>{
 let finish;const c=client(url=>url.includes('refresh_token')?new Promise(r=>finish=r):Promise.resolve(reply({})));
 const pending=c.api.refresh();await Promise.resolve();await c.api.signOut();
 finish(reply({access_token:'late',refresh_token:'late'}));await pending;assert.equal(c.api.session(),null);
});
test('timeout also covers stalled response-body reads',async()=>{
 const c=client(async()=>({ok:true,status:200,text:()=>new Promise(()=>{})}),{fast:true});
 await assert.rejects(c.api.signInWithPassword('fixture@example.test','fixture-password'),/did not respond/);
});
test('successful password login still persists session and emits auth change',async()=>{
 const c=client(async()=>reply({access_token:'new-login',refresh_token:'new-refresh',user:{id:'fixture'}}));let event;
 c.window.dispatchEvent=e=>{event=e;};await c.api.signInWithPassword('fixture@example.test','fixture-password');
 assert.equal(c.api.session().access_token,'new-login');assert.ok(event);
});
