import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const authSource = readFileSync(new URL('../../js/mcc-auth.js', import.meta.url), 'utf8');
const netSource = readFileSync(new URL('../../js/mnet.js', import.meta.url), 'utf8');
function client(response, analytics) {
  const window = {location: {origin: 'https://mccluster.org'}, MCC_ANALYTICS_CONTEXT: analytics};
  vm.runInNewContext(authSource, {window, setTimeout, clearTimeout, fetch: async () => response});
  return window.MCC;
}
const response = (data, status=200) => ({ok: status < 400, status, headers: {get: () => null}, text: async () => JSON.stringify(data)});
test('confirmation-required raw GoTrue user is preserved and empty identities detected', async () => {
  const user = {id: 'test-user', identities: [{id: 'identity'}]};
  const result = await client(response(user)).signUpWithPassword('test@example.org', 'fixture-password');
  assert.equal(result.confirm, true);
  assert.equal(result.user.id, user.id);
  assert.equal((await client(response({...user, identities: []})).signUpWithPassword('test@example.org', 'fixture-password')).existing, true);
});
test('rejected attribution and throwing conversion telemetry cannot fail signup', async () => {
  const analytics = {prepareSignupAttribution: () => Promise.reject(new Error('offline')), recordAccountCreated: () => {throw new Error('offline');}};
  const result = await client(response({id: 'test-user', identities: [{}]}), analytics).signUpWithPassword('test@example.org', 'fixture-password');
  assert.equal(result.confirm, true);
});
test('unanswered telemetry cannot keep a successful signup pending', async () => {
  const analytics = {prepareSignupAttribution: () => new Promise(() => {}), recordAccountCreated: () => new Promise(() => {})};
  const result = await client(response({id: 'test-user', identities: [{}]}), analytics).signUpWithPassword('test@example.org', 'fixture-password');
  assert.equal(result.confirm, true);
});
test('same-email cooldown preserves its actual 55 second wait and code', async () => {
  await assert.rejects(client(response({code:'over_email_send_rate_limit', msg:'For security purposes, you can only request this after 55 seconds.'},429)).signUpWithPassword('test@example.org','fixture-password'), e => e.retryAfter === 55);
  await assert.rejects(client(response({code:'over_request_rate_limit', msg:'For security purposes, you can only request this after 55 seconds.'},429)).signUpWithPassword('test@example.org','fixture-password'), e => e.retryAfter === 55 && e.code === 'over_request_rate_limit');
});
function lift(name) {
 const start=netSource.indexOf('  function '+name+'('); let i=netSource.indexOf('{',start), depth=0;
 for(;i<netSource.length;i++){if(netSource[i]==='{')depth++;else if(netSource[i]==='}'&&!--depth)break;}
 return netSource.slice(start,i+1);
}
function flow(signup) {
 const elements = new Map();
 const $=id=>{if(!elements.has(id))elements.set(id,{value:'',disabled:false,hidden:true,textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},scrollIntoView(){}});return elements.get(id);};
 $('mnSignedOut').attrs['data-auth-mode']='create';$('mnEmail').value='test@example.org';$('mnPassword').value=$('mnPassword2').value='fixture-password';
 const state={}, holds=[];
 const context={$ ,state, MCC:{signUpWithPassword:signup,holdButton:(button,seconds,label)=>{button.disabled=true;holds.push({seconds,label});}},MCC_PRIVACY:{version:'test'},privacyAgreed:()=>true,track(){},rememberJoin(){},setAuthMode:mode=>{$('mnSignedOut').attrs['data-auth-mode']=mode;},setStatus:(el,msg)=>{el.textContent=msg;},authFail:msg=>{$('mnAuthStatus').textContent=msg;},enterAfterAuth(){throw Error('must verify first');}};
 vm.createContext(context);vm.runInContext(lift('showSignupVerification')+'\n'+lift('submitPasswordAuth'),context);
 return {...context,holds};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('successful signup switches to sign-in, keeps verification guidance, and blocks duplicate creation', async()=>{
 let calls=0;const f=flow(async()=>{calls++;return {confirm:true};});
 f.submitPasswordAuth();f.submitPasswordAuth();await settle();
 assert.equal(calls,1);assert.equal(f.$('mnSignedOut').attrs['data-auth-mode'],'signin');
 assert.equal(f.$('mnAuthGo').textContent,'Sign in');assert.match(f.$('mnAuthStatus').textContent,/Check your email/);
 assert.equal(f.$('mnResend').hidden,false);assert.equal(f.holds[0].seconds,60);
 f.setAuthMode('create');f.submitPasswordAuth();assert.equal(calls,1);
});
test('429 shows the wait and disables retry instead of claiming a site-wide signup overload',async()=>{
 const f=flow(async()=>{throw Object.assign(new Error('For security purposes, you can only request this after 55 seconds.'),{status:429,code:'over_request_rate_limit',retryAfter:55});});
 f.submitPasswordAuth();await settle();
 assert.match(f.$('mnAuthStatus').textContent,/55 seconds/);assert.doesNotMatch(f.$('mnAuthStatus').textContent,/Too many sign-ups/);
 assert.equal(f.$('mnAuthGo').disabled,true);assert.equal(f.holds[0].seconds,55);
});
