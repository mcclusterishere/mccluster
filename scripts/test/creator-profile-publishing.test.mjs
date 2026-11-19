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

/* The Studio used to seed a second supabase-js session from the site's (auth.setSession over mccdb_session /
   mcc_sess_keep): it asked signed-in members to sign in, kept acting as a previous account, and spent the shared
   refresh token. Since music slice M4 (accounts lane ACC-6) it uses the site's one session: supabase-js keeps none,
   every call carries the shared auth's token for that call, and the page follows the account signed in on the site. */
test('creator Studio uses the site\'s one session: no second supabase-js session, no refresh of its own',async()=>{
 const js=await read('js/mccluster-creator-account.js');
 assert.match(js,/accessToken:\(\)=>window\.MCC\?window\.MCC\.freshToken\(\)/);
 assert.match(js,/global:\{fetch:\(url,init\)=>window\.MCC\?window\.MCC\.authFetch\(url,init,account\?\{account\}:undefined\)/,'each call is made as the account that began it');
 assert.match(js,/window\.MCC\.onAccountChange\(/);
 assert.doesNotMatch(js,/auth\.(setSession|getSession|getUser|refreshSession|signOut)|onAuthStateChange/);
 assert.doesNotMatch(js,/mccdb_session|mcc_sess_keep|refresh_token/);
 assert.doesNotMatch(js,/persistSession:true|autoRefreshToken:true/);
 const html=await read('mccluster-creator-studio.html');
 assert.ok(html.indexOf('js/mcc-auth.js')>-1&&html.indexOf('js/mcc-auth.js')<html.indexOf('js/mccluster-creator-account.js'),'the shared auth loads before the Studio module');
});
