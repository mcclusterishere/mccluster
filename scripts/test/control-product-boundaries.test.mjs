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

test('owner status is not a public health endpoint',async()=>{
 const worker=await readFile('workers/mccluster/src/index.js','utf8');
 const start=worker.indexOf("if (path === '/v1/status' && request.method === 'GET')");
 assert.ok(start>=0,'status route missing');
 const route=worker.slice(start,start+300);
 assert.match(route,/await requireHouseOwner\(request, env\)/);
 const auth=worker.slice(worker.indexOf('async function requireHouseOwner(req, env)'),worker.indexOf('async function appByKey'));
 assert.match(auth,/role=eq\.owner/);
 assert.match(auth,/Authentication required/);
});
test('owner user explorer enforces house owner and self endpoints bind identity to bearer',async()=>{
 const router=await readFile('workers/mccluster/src/analytics/router.js','utf8');
 const users=router.slice(router.indexOf('async function handleUserExplorer('),router.indexOf('/* Self-service dashboards'));
 assert.match(users,/await requireHouseOwner\(env, user\)/);
 const self=router.slice(router.indexOf('async function handleSelfMusicAnalytics('),router.indexOf('async function handleSelfMusicAnalytics(')+1700);
 assert.match(self,/user\.id/);
 assert.doesNotMatch(self,/url\.searchParams\.get\(['"]uid['"]\)/);
});

test('Whip mobility worker never trusts caller-provided demo identity or operator role',async()=>{
 const worker=await readFile('workers/mccluster/src/whip/worker.js','utf8');
 assert.doesNotMatch(worker,/ALLOW_DEMO_IDENTITIES/);
 assert.doesNotMatch(worker,/req\.headers\.get\('x-we-role'\)/);
 assert.doesNotMatch(worker,/req\.headers\.get\('x-we-user-id'\)/);
 assert.match(worker,/operator_members\?tenant_id=eq/);
});

test('Whip sales lead writes are restricted to operator membership',async()=>{
 const router=await readFile('workers/mccluster/src/whip/router.js','utf8');
 const start=router.indexOf("if(path==='/api/sales/leads'&&req.method==='POST')");
 assert.ok(start>=0);
 const handler=router.slice(start,start+800);
 assert.match(handler,/operator_members\?auth_user_id=eq/);
 assert.match(handler,/Operator access required/);
 assert.ok(handler.indexOf('operator_members')<handler.indexOf("sb(env,'sales_leads"),'authorization must precede privileged write');
});
