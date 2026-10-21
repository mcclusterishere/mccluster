import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
test('paid creator entitlement verifies user identity and only returns own active, unexpired workspaces',async()=>{
 const src=await read('workers/mccluster/src/creator-entitlement.js');
 assert.match(src,/\/auth\/v1\/user/);
 assert.match(src,/owner_user_id','eq\.'\+user\.id/);
 assert.match(src,/r\.status==='active'/);
 assert.match(src,/Date\.parse\(r\.current_period_end\)>now/);
 assert.match(src,/cache-control','no-store'/);
 assert.doesNotMatch(src,/request\.headers\.get\('x-mccluster-org-id'\)/);
});
test('deployed Worker routes entitlement requests',async()=>{
 const src=await read('workers/mccluster/src/entry-platform.js');
 assert.match(src,/handleCreatorEntitlement\(request, env\)/);
});
