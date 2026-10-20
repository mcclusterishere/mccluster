/* THE WORLD'S GLOBE (owner, 2026-10-20: "Replace the filter button with the button that zooms you all the way back out from the
   globe"). node --test scripts/test/world-globe-zoom-out.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('in the World, World (back to the whole Earth) takes the controls menu\'s corner; the full-screen globe keeps the menu', () => {
  const js = read('js/action-globe.js');
  const start = js.indexOf('function wireEditorialTools(){'), body = js.slice(start, js.indexOf('\nfunction ', start + 10));
  const world = body.indexOf("if(document.documentElement.classList.contains('globe-surface-network')){"), menu = body.indexOf("const tools=document.createElement('details')");
  assert.ok(world > 0 && menu > world, 'the World branch comes first and returns before the menu is built');
  const branch = body.slice(world, menu);
  assert.match(branch, /corner\.className='globe-editorial-world';const world=\$\('ctlWorld'\);if\(world\)corner\.appendChild\(world\)/);
  assert.match(branch, /shelf\.hidden=true;if\(nav\)shelf\.appendChild\(nav\);if\(row\)shelf\.appendChild\(row\)/, 'the other controls stay in the page, out of sight');
  assert.match(branch, /setTravelMode\(travelMode\);\s*return;/, 'Travel keeps its own rail');
  /* World still does what it did: the whole Earth, the selection let go */
  assert.match(js, /on\('ctlWorld',\(\)=>\{selectionShown=false;[\s\S]{0,200}viewer\.camera\.flyTo\(\{destination:homePosition\(\),duration:1\.4\}\);tell\(\{type:'hu:selection-cleared'\}\)\}\)/);
  const css = read('css/globe-editorial.css');
  assert.match(css, /\.globe-editorial \.globe-editorial-world \{position:fixed;bottom:24px;right:8px;z-index:12;\}/, 'the same place the menu was');
  assert.match(css, /\.globe-editorial \.globe-editorial-world \.globe-ctl \{[^}]*min-width:44px;height:44px;/, 'a 44px target');
  assert.match(css, /\.globe-travel \.globe-editorial-world/);
});
