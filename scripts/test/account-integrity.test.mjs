import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read=(p)=>readFile(p,'utf8');

async function integrity(){
  const src=await read('js/account-integrity.js');
  const context={window:{}};
  vm.createContext(context);
  vm.runInContext(src,context);
  return context.window.MCC_ACCOUNT_INTEGRITY;
}

test('name plausibility rejects obvious junk without pretending to verify identity', async()=>{
  const v=await integrity();
  assert.equal(v.validateName('Dog','Chicken Feet').ok,false);
  assert.equal(v.validateName('test','user').ok,false);
  assert.equal(v.validateName('123','Smith').ok,false);
  assert.equal(v.validateName('https://fake.example','Smith').ok,false);
  assert.equal(v.validateName('José',"O'Neill").ok,true);
  assert.equal(v.validateName('Mary Jane','van der Berg').ok,true);
});

test('a complete member profile requires legal name and a deliverable mailing shape', async()=>{
  const v=await integrity();
  assert.equal(v.completeProfile({
    legal_name:'José O\'Neill',address_line1:'1 Main St',city:'New Haven',
    region:'CT',postal_code:'06510',country:'US'
  }),true);
  assert.equal(v.completeProfile({
    legal_name:'José O\'Neill',city:'New Haven',region:'CT',postal_code:'06510',country:'US'
  }),false);
});

test('password signup requires split first and last names in the shared auth layer', async()=>{
  const auth=await read('js/mcc-auth.js');
  assert.match(auth,/First and last name are required to create an M Account/);
  assert.match(auth,/data\.first_name/);
  assert.match(auth,/data\.last_name/);
  assert.match(auth,/MCC_ACCOUNT_INTEGRITY\.validateName/);
});

test('account and Mnet creation forms require legal first and last names', async()=>{
  const [account,mnet,mnetJs]=await Promise.all([
    read('account.html'),read('mnet.html'),read('js/mnet.js')
  ]);
  for(const html of [account,mnet]){
    assert.match(html,/autocomplete="given-name"[^>]*required/);
    assert.match(html,/autocomplete="family-name"[^>]*required/);
    assert.match(html,/js\/account-integrity\.js/);
  }
  assert.match(account,/id="fnAddr1"[^>]*required/);
  assert.match(account,/id="fnCity"[^>]*required/);
  assert.match(account,/id="fnRegion"[^>]*required/);
  assert.match(account,/id="fnPostal"[^>]*required/);
  assert.match(account,/id="fnCountry"[^>]*required/);
  assert.match(mnetJs,/account\.html\?complete=1/);
  assert.match(mnetJs,/MCC_ACCOUNT_INTEGRITY\.completeProfile/);
});

test('privacy acknowledgement happens before first-party analytics identity is minted', async()=>{
  const [live,analytics]=await Promise.all([
    read('js/live-content.js'),read('js/analytics.js')
  ]);
  assert.match(live,/mcc_privacy_ack/);
  assert.match(live,/I agree and continue/);
  assert.match(live,/PAGE === "privacy\.html"/);
  assert.match(analytics,/MCC_PRIVACY\.acknowledged === false/);
  assert.ok(
    analytics.indexOf('MCC_PRIVACY.acknowledged === false') < analytics.indexOf('var DEVICE_KEY = "mcc_device"'),
    'privacy gate must short-circuit before persistent device identity exists'
  );
});

test('privacy notice stays readable and the gate is not described as OS permission', async()=>{
  const privacy=await read('privacy.html');
  assert.match(privacy,/Entry acknowledgement is separate from optional permissions/);
  assert.match(privacy,/does not grant browser or operating-system permissions/);
  assert.match(privacy,/legal first and last name/i);
  assert.match(privacy,/mailing address/i);
  assert.match(privacy,/No phone IMEI, hardware serial number, SIM serial or factory MAC address/i);
});

test('analytics pages load the privacy gate before the tracker', async()=>{
  for(const page of ['index.html','album.html','listen.html','analytics.html']){
    const html=await read(page);
    const gate=html.indexOf('js/live-content.js');
    const tracker=html.indexOf('js/analytics.js');
    if(tracker<0) continue;
    assert.ok(gate>=0 && gate<tracker, page+' must load the privacy gate before analytics');
  }
});
