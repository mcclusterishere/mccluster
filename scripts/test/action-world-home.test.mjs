import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
test('Human Uprise World tab puts the globe over the live feed',()=>{
 const html=read('mnet.html');
 assert.match(html,/id="mnToWorld" type="button" data-mn-view="feed"/);
 assert.match(html,/id="mnFeedView"[\s\S]*?class="mn__world-home"/);
 assert.match(html,/action-globe\.html\?embedded=1&amp;surface=network/);
 /* the network is under the globe, not hidden behind it */
 assert.doesNotMatch(html,/mn__legacy-feed/);
 assert.match(html,/id="mnWorld"[\s\S]*?id="mnWorldFocus"[\s\S]*?id="mnComposer"[\s\S]*?id="mnFeed"/);
 assert.doesNotMatch(read('css/mnet.css'),/\.mn__legacy-feed/);
});

test("World screen follows the owner's contract: 45-50% globe, ~15% context, 30-35% feed that scrolls on its own",()=>{
 const html=read('mnet.html'), css=read('css/mnet.css'), js=read('js/mnet.js');
 assert.match(html,/id="mnWorld"[\s\S]*?id="mnWorldContext"[\s\S]*?id="mnWorldFeed"/);
 assert.match(css,/\.mn-world-fit \.mn__world-home \{ flex: 49 1 0;/);
 assert.match(css,/\.mn-world-fit \.mn__world-context \{ flex: none; min-height: clamp\(92px, 14dvh, 150px\); \}/);
 assert.match(css,/\.mn-world-fit \.mn__world-feed \{ flex: 30 1 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain;/);
 assert.match(css,/html\.mn-world-fit, html\.mn-world-fit body \{ overflow: hidden;/,'only the feed scrolls, so the globe never leaves the screen');
 assert.match(js,/function sizeWorld\(\)/);
 assert.match(js,/WORLD_FIT_MIN = 440, WORLD_FIT_MIN_PORTRAIT = 340, WORLD_FIT_MIN_SIDE = 200/,'short screens fall back to a stacked, scrolling page instead of hiding content');
 /* a post shows its mission on the Earth without narrowing the feed being read */
 assert.match(js,/filter: !fromFeed/);
 /* one World for everyone: the Globe column and the standalone route both land on it */
 assert.match(read('js/tabbar.js'),/if \(worldDoor\) worldDoor\.href = worldAt\("\?view=feed"\);/);
 assert.match(read('action-globe.html'),/if\(q\.has\('embedded'\)\|\|q\.has\('explore'\)\)return;var song=q\.get\('song'\);location\.replace\('mnet\.html\?view=feed'/);
});

test('guests get the same World, read-only, through the public projection',()=>{
 const js=read('js/mnet.js'), html=read('mnet.html'), css=read('css/mnet.css');
 assert.match(js,/else enterGuestWorld\(\);/,'a signed-out visitor lands on the World, not a wall');
 assert.match(js,/publicRead \? "\/v1\/mnet\/public-feed\?limit=20"/,"a guest, or a member whose profile is unfinished, reads the public projection");
 assert.match(js,/publicRead \? fetch\("https:\/\/api\.mccluster\.org" \+ path\)\.then\(parse\) : api\(path\)/,'a public read sends no session; a member with a profile keeps the authenticated feed');
 assert.match(js,/if \(state\.guest && name !== "feed"\) \{ askToSignIn\(name\); return; \}/);
 assert.match(js,/\[data-take-mission\],\[data-action=save\],\[data-person\],\[data-guest-ask\]/,'every member action is a door to sign in for a guest');
 assert.match(html,/id="mnGuestBar" hidden/);
 assert.match(html,/id="mnGuestCard"/);
 assert.match(css,/\.mn-guest #mnComposer/);
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
 /* one projection for everything the frame tells the page: public pin fields, never coordinates or keys */
 const pub=/function publicMission\(m\)\{[^\n]*/.exec(globe)[0];
 assert.match(pub,/mission_id:m\.mission_id,title:m\.title,description:String\(m\.description\|\|''\)\.slice\(0,280\),region_label:m\.region_label,action_path:m\.action_path/);
 assert.doesNotMatch(pub,/latitude|longitude|m_uid|region_key/);
 assert.match(globe,/function announce\(\)\{const m=missions\[i\];if\(m\)tell\(\{type:'hu:mission-selected',mission:publicMission\(m\)\}\)\}/);
 assert.match(globe,/missions:allMissions\.slice\(0,200\)\.map\(publicMission\)/);
});

test('Cesium imagery is constructed with the provider the runtime actually ships',()=>{
 for(const f of ['js/action-globe.js','guest-globe.html','js/world-news.js']){
  const src=read(f);
  assert.doesNotMatch(src,/OpenStreetMapImageryProvider\.fromUrl/,f+': fromUrl does not exist on this provider and kills the globe');
  assert.match(src,/new Cesium\.ImageryLayer\(new Cesium\.OpenStreetMapImageryProvider\(\{url:/,f);
 }
 for(const f of ['action-globe.html','guest-globe.html','world-news.html'])assert.match(read(f),/openstreetmap\.org\/copyright/,f+': OpenStreetMap tiles carry attribution');
});
test('the Earth has three looks from one button: lit by the real sun, night with city lights, street map; all NASA or OSM, nothing drawn',()=>{
  const js=read('js/action-globe.js'), html=read('action-globe.html');
  assert.match(js,/const DAY_TILES='https:\/\/gibs\.earthdata\.nasa\.gov\/wmts\/epsg3857\/best\/BlueMarble_NextGeneration\//);
  assert.match(js,/const NIGHT_TILES='https:\/\/gibs\.earthdata\.nasa\.gov\/wmts\/epsg3857\/best\/VIIRS_Black_Marble\//);
  assert.match(js,/const CLOUDS='assets\/img\/globe\/nasa-clouds-2048\.webp'/);
  assert.match(js,/sc\.globe\.enableLighting=true/,'the real sun lights the default Earth');
  assert.match(js,/lightingFadeOutDistance=R\+1\.2e6/,'fade distances carry the radius: Cesium measures them from the centre');
  assert.match(js,/on\('ctlLayers',\(\)=>setLayer\(\{auto:'night',night:'map',map:'auto'\}\[layerMode\]\|\|'auto'\)\)/,'Earth -> night -> street -> Earth');
  assert.match(js,/nightLayer\.dayAlpha=night\?1:0/,'night mode shows the city lights everywhere');
  assert.match(js,/g\.enableLighting=!night/);
  assert.match(html,/NASA Blue Marble, Black Marble<\/a>, <a href="https:\/\/visibleearth\.nasa\.gov\/"/,'the imagery credit names its sources');
  assert.ok(require('node:fs').existsSync(new URL('../../assets/img/globe/nasa-clouds-2048.webp',import.meta.url)),'the cloud layer is committed');
});
test('embedded globe remains interactive and has a full-screen exit',()=>{
 const html=read('mnet.html');
 assert.match(html,/class="mn__world-expand" href="action-globe\.html\?explore=1"/);
 const js=read('js/action-globe.js');
 assert.match(js,/globe-embedded/);
 assert.match(js,/ScreenSpaceEventType\.LEFT_CLICK/);
 assert.match(js,/getCurrentPosition/);
});

test('world event card opens filtered, scrollable mission feed',()=>{const html=read('action-globe.html');const js=read('js/action-globe.js');const css=read('css/action-globe.css');assert.match(html,/id="globeMode"/);assert.match(html,/id="feedMode"/);assert.match(html,/id="openFeed"/);assert.match(html,/id="worldSearch"/);assert.match(js,/function setMode\(mode\)/);assert.match(js,/function filterMissions\(\)/);assert.match(js,/function openDetail\(n\)/);assert.match(js,/document\.createElement\('article'\)/);assert.match(css,/#worldFeed\{position:fixed/);});

test('world uses persistent 45/15/35 layout and inline story detail',()=>{const html=read('action-globe.html');const css=read('css/action-globe.css');const js=read('js/action-globe.js');assert.match(css,/--world-map:45dvh/);assert.match(css,/--world-context:15dvh/);assert.match(css,/--world-discover:35dvh/);assert.match(html,/id="worldDetail"/);assert.match(html,/id="feedBack"/);assert.match(js,/function openDetail\(n\)/);assert.match(js,/function closeDetail\(\)/);assert.match(js,/function setSelection\(selected\)/);assert.match(js,/article\.onclick=\(\)=>openDetail\(n\)/);});
