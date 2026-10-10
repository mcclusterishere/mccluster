import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
test('creator publishing uses account-scoped identity and visibility',async()=>{
 const js=await read('js/mccluster-creator-account.js');
 assert.match(js,/rpc\('current_m_uid'\)/);
 assert.match(js,/\.eq\('m_uid',identity\.data\)/);
 assert.match(js,/\['private','network','public'\]/);
 assert.match(js,/discoverable:visibility==='public'/);
});
test('public profile filters public records and renders untrusted fields as text',async()=>{
 const js=await read('js/mccluster-public-profile.js');
 assert.match(js,/\.eq\('visibility','public'\)/);
 assert.match(js,/\.textContent=data\.display_name/);
 assert.match(js,/\.textContent=data\.bio/);
 assert.match(js,/url\.protocol==='https:'/);
 assert.doesNotMatch(js,/innerHTML|service_role/i);
});
test('creator profile page retains shared navigation and inaccessible default',async()=>{
 const html=await read('mccluster-creator.html');
 assert.match(html,/js\/tabbar\.js/);
 assert.match(html,/id="profile" hidden/);
 assert.match(html,/js\/mccluster-public-profile\.js/);
});

test('creator Studio recognizes existing McCluster login and avoids auth callback reentrancy',async()=>{
 const js=await read('js/mccluster-creator-account.js');
 assert.match(js,/mccdb_session/);
 assert.match(js,/mcc_sess_keep/);
 assert.match(js,/auth\.setSession/);
 assert.match(js,/setTimeout\(refresh,0\)/);
});
