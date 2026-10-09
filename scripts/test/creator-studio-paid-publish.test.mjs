import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
test('Creator Studio exposes real paid website controls',async()=>{
 const html=await read('mccluster-creator-studio.html');
 for(const id of ['checkWebsiteAccess','websiteWorkspace','publishWebsite','websiteStatus','websiteLink'])
  assert.match(html,new RegExp('id="'+id+'"'));
});
test('Creator Studio authenticates paid publishing and renders returned URL safely',async()=>{
 const src=await read('js/mccluster-creator-account.js');
 assert.match(src,/session\.access_token/);
 assert.match(src,/\/v1\/creator-billing\/entitlement/);
 assert.match(src,/\/v1\/creator-sites\/publish/);
 assert.match(src,/url\.origin!==apiOrigin/);
 assert.match(src,/link\.replaceChildren\(\)/);
 assert.doesNotMatch(src,/innerHTML/);
});
