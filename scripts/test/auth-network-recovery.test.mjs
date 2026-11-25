import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../../js/mcc-auth.js',import.meta.url),'utf8');
const saved={access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:1};
const reply=(body,status=200)=>({ok:status<400,status,headers:{get:()=>null},text:async()=>JSON.stringify(body)});
// now: this device's clock, when it is not the test runner's. session: what an earlier visit stored (null: nothing).
function client(fetchImpl,{fast=false,now,session=saved}={}) {
 const values=new Map(session?[['mccdb_session',JSON.stringify(session)],['mcc_sess_keep',JSON.stringify(session)]]:[]);
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const window={localStorage:storage,sessionStorage:storage,crypto:globalThis.crypto,location:{origin:'https://matthew.mccluster.org',search:'',pathname:'/account.html'},dispatchEvent(){}};
 vm.runInNewContext(source,{window,fetch:fetchImpl,AbortController,CustomEvent:class{},URL,URLSearchParams,setTimeout:fast?(fn,ms)=>setTimeout(fn,Math.min(ms,10)):setTimeout,clearTimeout,
  ...(now?{Date:class extends Date{static now(){return now();}}}:{})});
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

/* ---------- ONE CLOCK: a device whose clock is not the auth server's (js/mcc-auth.js stampExpiry) ----------
   The auth server and the API keep the server's clock and refuse a token past its exp; the client runs on a device
   `ahead` seconds off it (negative: behind). later(s) moves both clocks on together. Tokens last an hour. */
const HOUR=3600;
const claims=t=>{try{return JSON.parse(Buffer.from(String(t).split('.')[1],'base64url'));}catch{return {};}};
function device(ahead,{session=null}={}) {
 let elapsed=0,serial=0;
 const serverNow=()=>Math.floor(Date.now()/1000)+elapsed;
 const counts={refresh:0,writes:0,refused:0};
 const issue=()=>{const iat=serverNow(),n=++serial;
  return {access_token:'fixture.'+Buffer.from(JSON.stringify({sub:'fixture-member',iat,exp:iat+HOUR,n})).toString('base64url')+'.fixture',
   refresh_token:'fixture-refresh-'+n,token_type:'bearer',expires_in:HOUR,expires_at:iat+HOUR,user:{id:'fixture-member'}};};
 const fetchImpl=async(url,init={})=>{
  const u=new URL(url);
  if(u.pathname==='/auth/v1/token'){if(u.searchParams.get('grant_type')==='refresh_token')counts.refresh++;return reply(issue());}
  const bearer=String((init.headers||{}).authorization||'').replace(/^Bearer /,'');
  if(!(claims(bearer).exp>serverNow())){counts.refused++;return reply({code:'bad_jwt',msg:'JWT expired'},401);}
  return reply(u.pathname==='/auth/v1/user'?{id:'fixture-member'}:u.pathname.endsWith('/m_my_identities')?[]:{ok:true});
 };
 const c=client(fetchImpl,{now:()=>Date.now()+(ahead+elapsed)*1000,session:session&&session(issue)});
 const write=c.storage.setItem;c.storage.setItem=(k,v)=>{if(k==='mccdb_session')counts.writes++;return write(k,v);};
 return {...c,counts,serverNow,deviceNow:()=>serverNow()+ahead,later:s=>{elapsed+=s;},
  signIn:()=>c.api.signInWithPassword('fixture@example.test','fixture-password'),
  /* every call that decides whether the session is fresh, once each; true when each was answered */
  async everyCall(){
   const answers=[await c.api.user(),(await c.api.api('/v1/status')).status,await c.api.mUid(),await c.api.touch('fixture-app'),await c.api.identities(),await c.api.refreshIfNeeded()];
   return answers[0]?.id==='fixture-member'&&answers[1]===200&&answers.every(a=>a!=null);
  }};
}

test('a device an hour ahead refreshes once per token lifetime, not once per call',async()=>{
 const d=device(HOUR);await d.signIn();
 const stored=d.api.session();
 assert.ok(Math.abs(stored.expires_at-(d.deviceNow()+HOUR))<=2,`expiry measured on this device's clock: ${stored.expires_at-d.deviceNow()}s from now`);
 assert.equal(stored.server_expires_at,d.serverNow()+HOUR,'the server\'s own expiry is kept beside it');
 for(let round=0;round<3;round++)assert.ok(await d.everyCall());
 assert.deepEqual(d.counts,{refresh:0,writes:1,refused:0},'no call refreshed: one write, the sign-in, so other tabs heard one storage event');
 d.later(HOUR-59);                                   // 59 seconds left on both clocks: inside the one-minute margin
 for(let round=0;round<3;round++)assert.ok(await d.everyCall());
 assert.deepEqual(d.counts,{refresh:1,writes:2,refused:0},'one refresh for that token\'s whole life, before the server expired it');
 d.later(HOUR-59);
 for(let round=0;round<3;round++)assert.ok(await d.everyCall());
 assert.deepEqual(d.counts,{refresh:2,writes:3,refused:0});
});

test('a device an hour behind refreshes a token the server has expired before using it',async()=>{
 const d=device(-HOUR);await d.signIn();
 assert.ok(await d.everyCall());
 assert.equal(d.counts.refresh,0);
 d.later(HOUR+5);                                    // the server expired it five seconds ago; its own expires_at is an hour off on this clock
 assert.equal((await d.api.api('/v1/status')).status,200,'the API got a token it accepts');
 assert.ok(await d.everyCall());
 assert.deepEqual(d.counts,{refresh:1,writes:2,refused:0},'refreshed once, and no expired token was ever sent');
});

for(const [clock,ahead] of [['an hour ahead',HOUR],['an honest clock',0],['an hour behind',-HOUR]]) test(`a genuinely expired session still refreshes before use, on ${clock}`,async()=>{
 const d=device(ahead);await d.signIn();
 d.later(2*HOUR);
 assert.ok(await d.everyCall(),'every call answered');
 assert.deepEqual(d.counts,{refresh:1,writes:2,refused:0},'the first call refreshed, before any request carried the expired token');
});

test('a session an older client stored with the server\'s expiry is refreshed once on a clock ahead, then kept fresh',async()=>{
 const d=device(HOUR,{session:issue=>issue()});    // as stored before: expires_at on the server's clock, which looks spent here
 for(let round=0;round<3;round++)assert.ok(await d.everyCall());
 assert.deepEqual(d.counts,{refresh:1,writes:1,refused:0});
 assert.ok(d.api.session().server_expires_at>0,'stored again with its expiry on this device\'s clock');
});

test('an answer without expires_in keeps the server\'s expires_at; one with neither is given an hour',async()=>{
 let answer;const c=client(async()=>reply(answer),{session:null});
 answer={access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:4102444800};await c.api.signInWithPassword('fixture@example.test','fixture-password');
 assert.equal(c.api.session().expires_at,4102444800);assert.equal('server_expires_at' in c.api.session(),false);
 answer={access_token:'fixture-access-2',refresh_token:'fixture-refresh-2'};await c.api.signInWithPassword('fixture@example.test','fixture-password');
 assert.ok(Math.abs(c.api.session().expires_at-(Math.floor(Date.now()/1000)+3600))<=2);
});
