import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
test('live checkout requires an explicit opt-in and defaults to Stripe test key',async()=>{
 const s=await read('workers/mccluster/src/creator-billing.js');
 assert.match(s,/CREATOR_BILLING_ALLOW_LIVE!=='true'/);
 assert.match(s,/startsWith\('sk_test_'\)/);
});
test('live webhook events fail closed and invoice subscription links include modern nested shape',async()=>{
 const s=await read('workers/mccluster/src/creator-billing-webhook.js');
 assert.match(s,/event\.livemode!==false/);
 assert.match(s,/CREATOR_BILLING_ALLOW_LIVE!=='true'/);
 assert.match(s,/parent\?\.subscription_details\?\.subscription/);
});
