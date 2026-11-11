import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
test('live checkout requires an explicit opt-in and defaults to Stripe test key',async()=>{
 const s=await read('workers/mccluster/src/creator-billing.js');
 assert.match(s,/CREATOR_BILLING_ALLOW_LIVE!=='true'/);
 assert.ok(s.includes('/^(sk|rk)_test_/'));
 for(const key of ['sk_test_fixture','rk_test_fixture'])assert.equal(/^(sk|rk)_test_/.test(key),true);
 for(const key of ['sk_live_fixture','rk_live_fixture','unknown'])assert.equal(/^(sk|rk)_test_/.test(key),false);
});
test('live webhook events fail closed and invoice subscription links include modern nested shape',async()=>{
 const s=await read('workers/mccluster/src/creator-billing-webhook.js');
 assert.match(s,/event\.livemode!==false/);
 assert.match(s,/CREATOR_BILLING_ALLOW_LIVE!=='true'/);
 assert.match(s,/parent\?\.subscription_details\?\.subscription/);
});
