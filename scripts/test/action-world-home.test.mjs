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

test('world event card opens filtered, scrollable mission feed',()=>{const html=read('action-globe.html');const js=read('js/action-globe.js');const css=read('css/action-globe.css');assert.match(html,/id="globeMode"/);assert.match(html,/id="feedMode"/);assert.match(html,/id="openFeed"/);assert.match(html,/id="worldSearch"/);assert.match(js,/function setMode\(mode\)/);assert.match(js,/function filterMissions\(\)/);assert.match(js,/scrollIntoView/);assert.match(js,/document\.createElement\('article'\)/);assert.match(css,/#worldFeed\{position:fixed/);});
