import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
test('creator site publishing checks authenticated owner, scoped org and Stripe live subscription',async()=>{
 const src=await read('workers/mccluster/src/creator-site-publish.js');
 assert.match(src,/\/auth\/v1\/user/);
 assert.match(src,/owner_user_id','eq\.'\+userId/);
 assert.match(src,/org_id','eq\.'\+orgId/);
 assert.match(src,/stripeRequest\(env,'subscriptions\//);
 assert.match(src,/stripe\.metadata\?\.mccluster_user_id===user\.id/);
 assert.match(src,/stripe\.status==='active'/);
 assert.match(src,/Publishing storage is not configured/);
});
test('paid publish gate is registered in platform Worker',async()=>{
 const entry=await read('workers/mccluster/src/entry-platform.js');
 assert.match(entry,/handleCreatorPublish\(request, env\)/);
});
