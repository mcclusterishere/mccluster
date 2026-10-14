import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
test('Human Uprise World tab puts the globe over the live feed',()=>{
 const html=read('mnet.html');
 assert.match(html,/data-mn-view="feed">🌐 World<\/button>/);
 assert.match(html,/id="mnFeedView"[\s\S]*?class="mn__world-home"/);
 assert.match(html,/action-globe\.html\?embedded=1&amp;surface=network/);
 /* the network is under the globe, not hidden behind it */
 assert.doesNotMatch(html,/mn__legacy-feed/);
 assert.match(html,/id="mnWorld"[\s\S]*?id="mnWorldFocus"[\s\S]*?id="mnComposer"[\s\S]*?id="mnFeed"/);
 assert.doesNotMatch(read('css/mnet.css'),/\.mn__legacy-feed/);
});

test('globe and feed talk over same-origin messages carrying public mission fields only',()=>{
 const js=read('js/mnet.js'), globe=read('js/action-globe.js');
 assert.match(js,/ev\.origin !== location\.origin \|\| ev\.source !== frame\.contentWindow/);
 assert.match(js,/postMessage\(msg, location\.origin\)/);
 assert.match(js,/function postMissionId\(item\)/);
 assert.match(js,/!state\.world\.pins\[missionId\]/,'a post only points at the map when its mission has a public pin');
 assert.match(globe,/e\.source!==parentFrame\|\|e\.origin!==location\.origin/);
 assert.match(globe,/postMessage\(msg,location\.origin\)/);
 assert.doesNotMatch(js+globe,/postMessage\([^)]*['"]\*['"]\)/,'never broadcast to any origin');
 const announce=/function announce\(\)\{[^\n]*/.exec(globe)[0];
 assert.match(announce,/mission_id:m\.mission_id,title:m\.title,region_label:m\.region_label,action_path:m\.action_path/);
 assert.doesNotMatch(announce,/latitude|longitude|m_uid/);
});

test('Cesium imagery is constructed with the provider the runtime actually ships',()=>{
 for(const f of ['js/action-globe.js','guest-globe.html','js/world-news.js']){
  const src=read(f);
  assert.doesNotMatch(src,/OpenStreetMapImageryProvider\.fromUrl/,f+': fromUrl does not exist on this provider and kills the globe');
  assert.match(src,/new Cesium\.ImageryLayer\(new Cesium\.OpenStreetMapImageryProvider\(\{url:/,f);
 }
 for(const f of ['action-globe.html','guest-globe.html','world-news.html'])assert.match(read(f),/openstreetmap\.org\/copyright/,f+': OpenStreetMap tiles carry attribution');
});
test('embedded globe remains interactive and has a full-screen exit',()=>{
 const html=read('mnet.html');
 assert.match(html,/class="mn__world-expand" href="action-globe\.html"/);
 const js=read('js/action-globe.js');
 assert.match(js,/globe-embedded/);
 assert.match(js,/ScreenSpaceEventType\.LEFT_CLICK/);
 assert.match(js,/getCurrentPosition/);
});

test('world event card opens filtered, scrollable mission feed',()=>{const html=read('action-globe.html');const js=read('js/action-globe.js');const css=read('css/action-globe.css');assert.match(html,/id="globeMode"/);assert.match(html,/id="feedMode"/);assert.match(html,/id="openFeed"/);assert.match(html,/id="worldSearch"/);assert.match(js,/function setMode\(mode\)/);assert.match(js,/function filterMissions\(\)/);assert.match(js,/function openDetail\(n\)/);assert.match(js,/document\.createElement\('article'\)/);assert.match(css,/#worldFeed\{position:fixed/);});

test('world uses persistent 45/20/35 layout and inline story detail',()=>{const html=read('action-globe.html');const css=read('css/action-globe.css');const js=read('js/action-globe.js');assert.match(css,/--world-map:45dvh/);assert.match(css,/--world-context:20dvh/);assert.match(css,/--world-discover:35dvh/);assert.match(html,/id="worldDetail"/);assert.match(html,/id="feedBack"/);assert.match(js,/function openDetail\(n\)/);assert.match(js,/function closeDetail\(\)/);assert.match(js,/function setSelection\(selected\)/);assert.match(js,/article\.onclick=\(\)=>openDetail\(n\)/);});
