/* Source-level wiring of the environmental globe slice G1: script order and the legend in action-globe.html, the
   delegation and hold call sites in js/action-globe.js, the pins shim, the notices, and what the new files never
   contain. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const NEW_FILES = ['js/environment-layers.js', 'js/environment-layers-client.js', 'js/globe-render-governor.js', 'js/globe-scene-director.js', 'js/environment-pins.js'];

test('action-globe.html loads the four new scripts, in order, before environment-pins.js, and carries the collapsed legend', () => {
  const html = read('action-globe.html');
  const order = ['js/globe-render-governor.js?v=__STAMP__', 'js/globe-scene-director.js?v=__STAMP__', 'js/environment-layers-client.js?v=__STAMP__', 'js/environment-layers.js?v=__STAMP__', 'js/environment-pins.js?v=__STAMP__', 'js/world-countries.js', 'js/action-globe.js?v=__STAMP__'];
  const at = order.map(src => html.indexOf(`<script src="${src}"></script>`));
  assert.ok(at.every(i => i > 0), 'every tag present with the stamp: ' + JSON.stringify(at));
  for (let i = 1; i < at.length; i++) assert.ok(at[i - 1] < at[i], `${order[i - 1]} before ${order[i]}`);
  assert.ok(html.indexOf('Cesium.js" integrity=') < at[0], 'Cesium first');
  assert.match(html, /<details id="envLegend" class="env-legend" hidden><summary>Legend<\/summary><ul id="envLegendList"><\/ul><\/details>/);
  const legendStyle = /<style id="envLegendStyle">([\s\S]*?)<\/style>/.exec(html);
  assert.ok(legendStyle, 'the legend has its own style block');
  assert.match(legendStyle[1], /#envLegend\s*\{/);
  assert.match(legendStyle[1], /min-height:\s*44px/);
  assert.match(legendStyle[1], /max-width:\s*min\(100%,\s*420px\)/);
  assert.doesNotMatch(legendStyle[1], /@media\s*\(\s*max-width/);
  assert.doesNotMatch(legendStyle[1], /(?<!minmax\(0,\s?)\b1fr/);
  const legendBlock = html.slice(html.indexOf('<details id="envLegend"'), html.indexOf('</details>', html.indexOf('<details id="envLegend"')));
  assert.doesNotMatch(legendBlock, /<img|Equity Uprise|logo/i, 'the legend shows no logo and no brand name');
  /* the redirect script and the Cesium SRI tags are untouched */
  assert.match(html, /location\.replace\('mnet\.html\?view=feed'/);
  assert.match(html, /integrity="sha384-W0LzTQiWiURlw8LASwpRL4\/0B\+MXygEt8\/AY25JrJMhqldeMm3EhD6XY\+1K0LglH"/);
});
test('action-globe.js: delegation before the pins line, governor and director in boot, mount before draw, the legacy hold at its call sites, the pick order unchanged', () => {
  const js = read('js/action-globe.js');
  const delegation = js.indexOf("if(/^hu:environment-/.test(d.type)&&!ANALYTICS&&window.MCC_ENVIRONMENT_LAYERS?.onMessage?.(d))return;");
  const pinsLine = js.indexOf("if(d.type==='hu:environment-pins'&&!ANALYTICS){environmentPins?.set(d);return}");
  assert.ok(delegation > 0 && pinsLine > delegation, 'the delegation line comes first');
  assert.ok(js.indexOf("if(d.type==='hu:hello'){if(readyMessage)tell(readyMessage);return}") < delegation, 'after hello');
  const styled = js.indexOf('styleScene();wireControls();'), governor = js.indexOf('governor=window.MCC_GLOBE_GOVERNOR?.create(viewer'), director = js.indexOf('director=window.MCC_GLOBE_DIRECTOR?.create(');
  const guard = js.indexOf('window.MCC_GLOBE_GOVERNOR?.guardCamera?.(viewer);');
  assert.ok(guard > governor && guard < director, 'the camera guard is wired at boot, right after the governor (review G1R-12)');
  const mount = js.indexOf('window.MCC_ENVIRONMENT_LAYERS?.mount({'), draw = js.indexOf('environmentPins?.draw();');
  assert.ok(styled > 0 && governor > styled && director > governor && mount > director && mount < draw, JSON.stringify({ styled, governor, director, mount, draw }));
  assert.match(js, /function syncLegacyHold\(\)\{/);
  assert.match(js, /MCC_GLOBE_GOVERNOR\.legacyAnimators\(\{pulse:PULSE,halos:missionHalos\.length,livePins:livePins\.length,dataLayersOn:Object\.keys\(DATA_LAYERS\)\.some\(k=>layerState\[k\]\.on\),intelOn:intel\.on,cctvOn:cctv\.on,haloObjects:haloObjects!==null\}\)/);
  const calls = (js.match(/syncLegacyHold\(\)/g) || []).length;
  assert.ok(calls >= 11, 'draw, drawLivePlaces, toggleLayer (on and off), clearLayer, toggleIntel, intelOff, toggleCctv, cctvOff, objects.start, objects.stop: ' + calls);
  for (const site of ['new Cesium.DistanceDisplayCondition(0,2400000)}})));syncLegacyHold()}', 'window.__huLivePlaces=()=>Object.fromEntries(total);syncLegacyHold()', 'L.count=0;if(haloObjects)haloObjects.refresh();syncLegacyHold()', "tell({type:'hu:layer',layer:'intel',on:false,creditHeight:creditHeight()});syncLegacyHold()", "tell({type:'hu:layer',layer:'cctv',on:false,creditHeight:creditHeight()});syncLegacyHold()", 'haloObjects.refresh();syncLegacyHold()},stop(){if(haloObjects)haloObjects.destroy();haloObjects=null;syncLegacyHold()}'])
    assert.ok(js.includes(site), 'call site present: ' + site.slice(0, 60));
  assert.match(js, /governor:\(\)=>governor,environment:\(\)=>environmentLayers/);
  assert.match(js, /if\(window\.HaloConsole&&HaloConsole\.pick\(e\)\)return;if\(environmentPins\?\.pick\(e\)\)return;if\(window\.BridgeportSlice\?\.pick\(e,p\.position\)\)return;/);
  assert.match(js, /document\.addEventListener\('visibilitychange',\(\)=>\{if\(document\.hidden\)director\?\.pause\('hidden'\)\}\)/);
  assert.match(js, /addEventListener\('pagehide',\(\)=>\{environmentLayers\?\.destroy\(\);director\?\.destroy\(\);governor\?\.destroy\(\)\}\)/);
  assert.match(js, /function tell\(msg\)\{if\(EXPLORE\)exploreTell\(msg\);if\(!parentFrame\)return;/, 'tell unchanged');
});
test('environment-pins.js delegates to the typed layers when they are loaded and falls back to the legacy entities otherwise', () => {
  const src = read('js/environment-pins.js');
  const row = { id: 'usgs:one', title: 'Observation', lat: 41, lon: -73, stale: false, category: 'quake', location_kind: 'reported_point', source: { label: 'USGS', url: 'https://earthquake.usgs.gov/x' }, observed_at: '2026-11-17T18:40:00.000Z', fetched_at: '2026-11-17T20:00:00.000Z', facts: [{ label: 'Magnitude', value: '6.2' }], significant: true };
  const calls = [], plain = x => JSON.parse(JSON.stringify(x)); /* vm-realm values copied before strict deep comparison */
  const window = { matchMedia: () => ({ matches: false }), MCC_ENVIRONMENT_LAYERS: { setEvents: (items, o) => calls.push(['setEvents', plain(items.map(i => i.id)), plain(o)]), redraw: () => calls.push(['redraw']), focus: id => calls.push(['focus', id]), pick: picked => { calls.push(['pick', picked]); return picked === 'hit'; } } };
  vm.runInNewContext(src, { window });
  const pins = window.MCC_ENVIRONMENT_PINS.create(() => null, () => null, () => {});
  pins.set({ on: true, selected: 'usgs:one', items: [row] });
  assert.deepEqual(calls[0], ['setEvents', ['usgs:one'], { on: true, selected: 'usgs:one' }]);
  pins.draw(); assert.deepEqual(calls[1], ['redraw']);
  pins.focus('usgs:one'); assert.deepEqual(calls[2], ['focus', 'usgs:one']);
  assert.equal(pins.pick('hit'), true); assert.equal(pins.pick('miss'), false);
  pins.destroy(); assert.deepEqual(calls.at(-1), ['setEvents', [], { on: false, selected: '' }]);
  const normalized = window.MCC_ENVIRONMENT_PINS.normalize([row, { id: 'usgs:bare', lat: 1, lon: 2 }, { ...row, id: 'usgs:http', source: { label: 'x', url: 'http://insecure.example' }, facts: Array.from({ length: 20 }, (_, i) => ({ label: 'L' + i, value: 'v' })), significant: 'yes', observed_at: 'bad', fetched_at: '2026-11-17T20:00:00.000Z', location_kind: 'x'.repeat(40) }]);
  assert.deepEqual(Object.keys(normalized[0]).sort(), ['category', 'facts', 'fetched_at', 'id', 'lat', 'location_kind', 'lon', 'observed_at', 'significant', 'source', 'stale', 'title']);
  assert.equal(normalized[0].significant, true); assert.deepEqual(plain(normalized[0].source), { label: 'USGS', url: 'https://earthquake.usgs.gov/x' });
  assert.deepEqual(Object.keys(normalized[1]).sort(), ['id', 'lat', 'lon', 'stale', 'title'], 'a bare row stays bare');
  assert.equal(normalized[2].source, undefined, 'an http source is dropped'); assert.equal(normalized[2].facts.length, 16); assert.equal(normalized[2].significant, undefined); assert.equal(normalized[2].observed_at, null); assert.equal(normalized[2].location_kind.length, 20);
  /* the fallback: the legacy entity renderer, the path scripts/test/world-environment.test.mjs exercises */
  const entities = new Set(), sent = [];
  const bare = { matchMedia: () => ({ matches: true }) };
  vm.runInNewContext(src, { window: bare });
  const C = { Cartesian3: { fromDegrees: (...args) => args }, Color: { fromCssColorString: x => x, WHITE: 'white', BLACK: 'black' }, LabelStyle: { FILL_AND_OUTLINE: 1 }, Cartesian2: class {}, DistanceDisplayCondition: class {} };
  const viewer = { entities: { add: x => { entities.add(x); return x; }, remove: x => entities.delete(x) }, scene: { requestRender() {} }, camera: { flyTo() {} } };
  const legacy = bare.MCC_ENVIRONMENT_PINS.create(() => viewer, () => C, x => sent.push(x));
  legacy.set({ on: true, items: [row] }); assert.equal(entities.size, 1);
  assert.equal(legacy.pick({ id: { properties: { environmentEventId: { getValue: () => row.id } } } }), true); assert.deepEqual(plain(sent[0]), { type: 'hu:environment-selected', id: row.id });
  legacy.destroy(); assert.equal(entities.size, 0);
});
test('THIRD-PARTY-NOTICES names the three adapted files and each header points back', () => {
  const notices = read('THIRD-PARTY-NOTICES');
  for (const file of ['js/globe-render-governor.js', 'js/globe-scene-director.js', 'js/environment-layers.js']) assert.ok(notices.includes(file), file + ' in the notices');
  assert.match(notices, /src\/renderGovernor\.js/); assert.match(notices, /src\/director\/camera\.js/); assert.match(notices, /src\/director\/playback\.js/); assert.match(notices, /src\/cameraVerbs\.js/); assert.match(notices, /src\/render\/cesium\/draw\.js/);
  for (const file of ['js/globe-render-governor.js', 'js/globe-scene-director.js', 'js/environment-layers.js']) {
    const head = read(file).slice(0, 900);
    assert.match(head, /gods-eye-view/, file); assert.match(head, /Copyright \(c\) 2026 Bilawal Sidhu/, file); assert.match(head, /THIRD-PARTY-NOTICES/, file);
  }
});
test('the new files carry no per-frame geometry callback, no credential, no storage and no model identifier', () => {
  for (const file of NEW_FILES) {
    assert.ok(existsSync(new URL('../../' + file, import.meta.url)), file);
    const src = read(file);
    assert.doesNotMatch(src, /CallbackProperty/, file);
    assert.doesNotMatch(src, /FIRMS/, file);
    assert.doesNotMatch(src, /authorization/i, file);
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/, file);
    assert.doesNotMatch(src, /claude|gpt-|gemini|grok|copilot|anthropic|openai/i, file);
    assert.doesNotMatch(src, /mccluster-core/, file);
  }
  const layers = read('js/environment-layers.js');
  assert.doesNotMatch(layers, /fetch\(/, 'the layers module fetches nothing itself');
  assert.doesNotMatch(layers, /Equity Uprise|Human Uprise/, 'no brand name on the globe');
  assert.match(read('js/environment-layers-client.js'), /credentials:\s*'omit'/);
});
