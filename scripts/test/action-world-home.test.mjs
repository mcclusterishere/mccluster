import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
test('Action Network world replaces feed as visible primary view',()=>{
 const html=read('mnet.html');
 assert.match(html,/data-mn-view="feed">🌐 World<\/button>/);
 assert.match(html,/id="mnFeedView"[\s\S]*?class="mn__world-home"/);
 assert.match(html,/action-globe\.html\?embedded=1/);
 assert.match(html,/class="mn__legacy-feed" hidden/);
 const css=read('css/mnet.css');
 assert.match(css,/\.mn__legacy-feed\{display:none!important\}/);
});
test('embedded globe remains interactive and has a full-screen exit',()=>{
 const html=read('mnet.html');
 assert.match(html,/class="mn__world-expand" href="action-globe\.html"/);
 const js=read('js/action-globe.js');
 assert.match(js,/globe-embedded/);
 assert.match(js,/ScreenSpaceEventType\.LEFT_CLICK/);
 assert.match(js,/getCurrentPosition/);
});
