import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
test('creator Checkout is routed through deployed platform entrypoint',async()=>{
 const entry=await read('workers/mccluster/src/entry-platform.js');
 assert.match(entry,/handleCreatorCheckout\(request, env\)/);
});
test('creator Checkout authenticates, selects only server-owned prices and fails closed',async()=>{
 const code=await read('workers/mccluster/src/creator-billing.js');
 assert.match(code,/\/auth\/v1\/user/);
 assert.match(code,/PRICE_ENV\[plan\]\?\.\[period\]/);
 assert.match(code,/CREATOR_STARTER_MONTHLY_PRICE_ID/);
 assert.match(code,/CREATOR_STARTER_ANNUAL_PRICE_ID/);
 assert.match(code,/Selected subscription is not available/);
 assert.match(code,/client_reference_id:user\.id/);
 assert.doesNotMatch(code,/body\.(?:price|amount|success_url|cancel_url)/);
});
