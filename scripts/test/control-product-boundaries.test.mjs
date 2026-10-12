import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('operator redirects require owner-gated capability rather than generic status',async()=>{
 const redirect=await readFile('js/owner-control-redirect.js','utf8');
 assert.match(redirect,/\/v1\/status/);
 assert.doesNotMatch(redirect,/\/v1\/analytics\/users\?limit=1/);
});

test('Control owns artist and fan intelligence as distinct operator sections',async()=>{
 const source=await readFile('js/control-room/analytics.js','utf8');
 assert.match(source,/\["fans","Fans"\]/);
 assert.match(source,/function fans\(\)/);
 assert.match(source,/function artistCards\(\)/);
 assert.match(source,/\/v1\/analytics\/users\?limit=100&page=/);
 assert.match(source,/\/v1\/analytics\/artist-rankings\?days=/);
});

test('self-service fan and creator endpoints are distinct from owner explorer',async()=>{
 const router=await readFile('workers/mccluster/src/analytics/router.js','utf8');
 assert.match(router,/path === '\/v1\/analytics\/my-listening'/);
 assert.match(router,/path === '\/v1\/analytics\/my-creator'/);
 assert.match(router,/await requireHouseOwner\(env, user\)/);
 const self=await readFile('js/music-self-analytics.js','utf8');
 assert.match(self,/creator\?'my-creator':'my-listening'/);
});
