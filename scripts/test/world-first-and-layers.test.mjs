/* THE WORLD FIRST, AND THE WORLD'S DATA LAYERS (owner, 2026-10-15).

   "Me as a signed in user … I see no globe in the globe section": a member
   whose profile was unfinished got the form instead of the World. Now the
   World is theirs, the step waits in a card, and the actions that need it
   ask. And the Earth carries demo data: flights for everyone (with the
   owner's Vaunt lead), satellites and launches for members, gated by the
   Worker. The behaviour is proven in a browser by scripts/e2e; these pin
   the contract in the source. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');

test('a member with an unfinished profile or contact step gets the World, with the step in a card', async () => {
  const js = await read('js/mnet.js'), html = await read('mnet.html'), css = await read('css/mnet.css');
  assert.match(js, /function needsStep\(\) \{\n    var s = state\.boot && state\.boot\.next_step;\n    return s === "profile" \|\| s === "contact" \? s : "";/);
  assert.match(js, /if \(needsStep\(\)\) \{[\s\S]{0,400}showGate\("app"\);\n        setView\("feed"\);\n        paintSelf\(\);\n        paintFinishCard\(\);/, 'the World, not the form');
  assert.doesNotMatch(js, /location\.replace\("account\.html\?complete=contact"\)/, 'no redirect away from the World at boot');
  assert.doesNotMatch(js, /if \(boot\.next_step === "profile"\) \{\n        fillProfileForm\(false\);\n        showGate\("profile"\);/, 'the old gate is gone');
  assert.match(js, /var publicRead = state\.guest \|\| !!needsStep\(\);/, 'public posts until the step is done');
  assert.match(js, /if \(askToFinish\("mission"\)\) return;/, 'joining a mission asks to finish');
  assert.match(js, /\$\("mnMissionJoin"\)\.addEventListener\("click",function\(e\)\{if\(askToFinish\("mission"\)\)return;joinMission\(e\);\}\);/, 'the dialog\'s join too: missions may be browsed, the join itself asks');
  assert.match(js, /if \(name !== "feed" && name !== "missions" && askToFinish\(name\)\) return;/, 'the member rooms ask to finish; the feed and the missions stay open');
  assert.match(js, /\$\("mnFinishGo"\)\.onclick = function \(\) \{ askToFinish\("act"\); \};/);
  assert.match(js, /setView\(needsStep\(\) \? "feed" : "profile"\)/, 'a finished profile lands back on the feed');
  assert.doesNotMatch(js, /location\.assign\("account\.html\?complete=contact"\)/, 'the contact step is page 2 of the onboarding in the World, not a redirect to the account page');
  assert.match(js, /\$\("mnFinishTitle"\)\.textContent = contact \? "Complete your details\." : "Finish your profile\.";/);
  assert.match(html, /<aside class="mn__guest-card mn__finish-card" id="mnFinishCard" hidden>/);
  assert.match(html, /<button class="mn__world-go" type="button" id="mnFinishGo">Finish your profile \u2192<\/button>/);
  assert.match(css, /\.mn__finish-card:not\(\[hidden\]\) \{ display: block; \}/);
});

test('on the World\'s host, a link to one of Matthew\'s rooms goes to his site outright, carrying the sign-in', async () => {
  const bar = await read('js/tabbar.js'), host = await read('workers/mccluster/src/world-host.js');
  assert.match(bar, /function houseBound\(url\) \{\n    return ON_WORLD_HOST && url\.origin === location\.origin && !WORLD_HOST_PATHS\.test\(url\.pathname\);/);
  assert.match(bar, /if \(houseBound\(url\)\) url = new URL\(url\.pathname \+ url\.search \+ url\.hash, HOUSE_ORIGIN\);/);
  /* the bar's list and the Worker's agree on what the host serves */
  for (const room of ['action-globe.html', 'action-policy.html', 'world-news.html', 'create.html', 'give.html', 'privacy.html', 'account.html', 'login.html', 'forgot-password.html', 'reset-password.html', 'onboard.html', 'sw.js']) {
    assert.ok(host.includes(`'/${room}'`), `Worker serves ${room}`); assert.ok(bar.includes(room.replace('.', '\\.') + '$'), `bar knows ${room}`);
  }
  for (const prefix of ['/action-network-', '/action/', '/auth/', '/js/', '/css/', '/assets/', '/data/', '/vendor/']) {
    assert.ok(host.includes(`'${prefix}'`), `Worker serves ${prefix}`); assert.ok(bar.includes(prefix.slice(1).replace('/', '\\/')), `bar knows ${prefix}`);
  }
});

test('the globe carries three data layers: flights for everyone, satellites and launches for members', async () => {
  const globe = await read('js/action-globe.js'), page = await read('action-globe.html'), css = await read('css/action-globe.css');
  assert.match(page, /<div class="globe-data" role="group" aria-label="Data layers"><button id="ctlFlights"[^>]*aria-pressed="false">[\s\S]*?<button id="ctlSats"[^>]*data-members="1">[\s\S]*?<button id="ctlLaunch"[^>]*data-members="1">/);
  assert.match(page, /<span id="layerCredits"><\/span>Imagery: /, 'each source is credited on the imagery line while it is on');
  assert.match(globe, /const API='https:\/\/api\.mccluster\.org';/);
  assert.match(globe, /flights:\{id:'ctlFlights',members:false/); assert.match(globe, /satellites:\{id:'ctlSats',members:true/); assert.match(globe, /launches:\{id:'ctlLaunch',members:true/);
  assert.match(globe, /if\(spec\.members&&!sessionToken\(\)\)\{tell\(\{type:'hu:ask-sign-in',reason:'layers'\}\);return\}/, 'a guest\'s lock opens sign-in and sends nothing');
  assert.match(globe, /if\(r\.status===401\)throw Error\('members'\)/, 'the Worker\'s refusal, not the page\'s flag, is the gate');
  assert.match(globe, /headers\.authorization='Bearer '\+t/);
  assert.match(globe, /new Cesium\.PointPrimitiveCollection\(\)/, 'thousands of points, one primitive');
  assert.match(globe, /t\.src='vendor\/satellite\.min\.js'/, 'SGP4 loads only when the layer is on');
  assert.match(globe, /L\.timer=setInterval\(stepSatellites,1500\)/, 'satellites move');
  assert.match(globe, /window\.__huLayerCounts=\(\)=>/);
  assert.match(css, /\.globe-data\{position:absolute;z-index:6;left:10px;bottom:34px;display:flex;gap:8px\}/);
  assert.match(css, /\.globe-ctl\.is-locked::after\{content:"";/, 'the lock is a red dot, drawn in CSS');
  await access(join(ROOT, 'vendor/satellite.min.js'));
  assert.match(await read('vendor/satellite.LICENSE.txt'), /satellite\.js 5\.0\.0[\s\S]*MIT/);
  assert.match((await read('vendor/satellite.min.js')).slice(0, 200), /satellite-js v5\.0\.0/);
});

test('the page writes the layers\' line over the Earth, and Flights carries the owner\'s Vaunt lead', async () => {
  const js = await read('js/mnet.js'), html = await read('mnet.html'), css = await read('css/mnet.css');
  assert.match(html, /<p class="mn__world-layers" id="mnWorldLayers" aria-live="polite" hidden><\/p>/);
  assert.match(js, /var VAUNT_LEAD = "https:\/\/vauntapi\.flyvaunt\.com\/referral\/nuao1K";/, 'the referral link the front page\'s VR wall already carries');
  assert.equal((await read('index.html')).includes('https://vauntapi.flyvaunt.com/referral/nuao1K'), true, 'the same link, not a new one');
  assert.match(js, /aircraft in the air right now/);
  assert.match(js, /<a class="mn__world-lead" href="' \+ VAUNT_LEAD \+ '" target="_blank" rel="noopener sponsored">Fly Vaunt \\u2192<\/a>/, 'simple and shorter (owner, 2026-10-15)');
  assert.match(js, /satellites overhead, moving live/);
  assert.match(js, /launches coming up/);
  assert.match(js, /d\.type === "hu:ask-sign-in"/); assert.match(js, /d\.type === "hu:layer" && typeof d\.layer === "string"/);
  assert.match(js, /layers:"Sign in to see satellites and space missions on the Earth\."/);
  assert.match(css, /\.mn__world-layers \{ position: absolute; z-index: 4; left: 12px; bottom: 82px;/);
});

test('the Worker serves the three layers, members only for two, and the pins SQL waits for the owner', async () => {
  const w = await read('workers/mccluster/src/world-layers.js');
  assert.match(w, /flights: \{ public: true, ttl: 600/); assert.match(w, /satellites: \{ public: false, ttl: 7200/); assert.match(w, /launches: \{ public: false, ttl: 1800/);
  assert.match(w, /const user = await bearerUser\(request, env, fetchImpl\);\n    if \(!user\) return fail\(/);
  assert.match(w, /OpenSky's data is for non-commercial research/, 'the licence caveat is written where the code is');
  await access(join(ROOT, 'workers/mccluster/test/world-layers.test.mjs'));
  const sql = await read('supabase/pending/action_globe_demo_pins_v1.sql');
  assert.match(sql, /insert into public\.action_globe_regions \(region_key, country_code, subdivision_code, region_label, centroid_lat, centroid_lon\)/);
  assert.match(sql, /\('US-CT', 'US', 'CT', 'Connecticut', 41\.6032, -73\.0877\)/);
  assert.match(sql, /when m\.campaign_id = 'critical-minerals-drc-001' then 'CD-HK'/);
  assert.match(sql, /on conflict \(mission_id\) do update/);
  assert.match(await read('supabase/pending/README.md'), /action_globe_demo_pins_v1\.sql/);
});

test('the onboarding is three pages: this, that, that, boom (owner, 2026-10-15)', async () => {
  const html = await read('mnet.html'), js = await read('js/mnet.js'), css = await read('css/mnet.css');
  assert.match(html, /<section class="mn__gate mn__onboard" id="mnProfileGate" hidden>/);
  assert.match(html, /<ol class="mn__steps" id="mnSteps" aria-label="Three steps"><li data-step="1" class="is-current"><\/li><li data-step="2"><\/li><li data-step="3"><\/li><\/ol>/);
  assert.match(html, /id="mnStep1" data-step="1">\s*<h1 class="mn__onboard-h" id="mnProfileTitle">Make it yours<em>\.<\/em><\/h1>/);
  assert.match(html, /id="mnStep2" data-step="2" hidden>\s*<h1 class="mn__onboard-h">Where to reach you<em>\.<\/em><\/h1>/);
  assert.match(html, /id="mnStep3" data-step="3" hidden>\s*<h1 class="mn__onboard-h">Lock it in<em>\.<\/em><\/h1>/);
  assert.match(html, /<details class="mn__about" id="mnAbout">[\s\S]*?<strong>About you<\/strong><small>Optional · Private<\/small>/, 'the demographics ride along, collapsed, optional, private');
  assert.match(html, /<button class="mn__cta" id="mnProfileSave" type="submit"><span id="mnCtaLabel">Save &amp; continue<\/span><i class="mn__cta-arrow"/);
  assert.match(html, /<p class="mn__onboard-note">[\s\S]*?<span>You can update this anytime\.<\/span><\/p>/);
  assert.match(html, /<script src="js\/fan-intake\.js\?v=__STAMP__"><\/script>/, 'the contact step writes through the fan intake, the only writer of fan_profiles');
  assert.doesNotMatch(html, /mn__brand-plate/, 'no plate the artwork does not contain');
  assert.match(js, /var HANDLE_RE = \/\^\[a-z0-9\]\[a-z0-9\._-\]\{2,31\}\$\/i;/);
  assert.match(js, /api\("\/v1\/mnet\/people\/" \+ encodeURIComponent\(v\)\)/, 'the handle is checked live: a person nobody can find is free');
  assert.match(js, /if \(e && e\.status === 404\) \{ onboard\.handleOk = mine; paintHandleState\("ok"/);
  assert.match(js, /function saveContact\(\)/); assert.match(js, /return MCC_FAN\.save\(values\)/);
  assert.match(js, /function normalizePhone\(dial, raw\)/); assert.doesNotMatch(js, /"\+1" \+ digits/, 'no country is assumed: people come from anywhere (owner, 2026-10-15)');
  assert.match(html, /<input class="mn__input mn__dial" id="mnDial" inputmode="tel" autocomplete="tel-country-code" maxlength="5" placeholder="\+ code" aria-label="Country code"><input class="mn__input" id="mnPhone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="Your number">/);
  assert.match(js, /if \(n === 3\) fillDial\(\);/, 'the code follows the country on page 2'); assert.match(js, /if \(!cur \|\| cur === onboard\.dialAuto\) \{ onboard\.dialAuto = dialFor/, 'until the member types a code of their own');
  assert.match(js, /if \(!\/\^\[1-9\]\[0-9\]\{0,2\}\$\/\.test\(code\)\) return null;/, 'no impossible country codes (00, 011, four digits)');
  assert.match(js, /function splitE164\(phone\)/, 'a stored number comes back as its code and its number');
  assert.match(js, /function enterTheWorld\(\)/); assert.match(js, /return api\("\/v1\/mnet\/bootstrap\?app_key=" \+ encodeURIComponent\(APP\)\)\.then\(function \(boot\) \{\n      state\.boot = boot;/);
  assert.match(js, /\$\("mnCtaLabel"\)\.textContent = editing \? "Save changes" : n === 3 \? "Enter the World" : "Save & continue";/);
  assert.doesNotMatch(js, /location\.assign\("account\.html\?complete=contact"\)/, 'the contact step is page 2, not a redirect');
  assert.match(css, /\.mn__onboard-h \{ max-width: 12ch; margin: 0; font-family: var\(--mn-ui\); font-weight: 900;/);
  assert.match(css, /\.mn__cta \{ position: relative; display: flex;[^}]*border-radius: 999px;/);
  assert.match(css, /@media \(min-width: 600px\) \{\n  \.mn__onboard \{ padding-top: 32px; \}\n  \.mn__onboard::before \{ inset: -40px -24px 0; \}/, 'mobile first; wider screens only add room');
  assert.match(css, /\.mn__onboard \{ position: relative; isolation: isolate; padding: 18px 0 calc\(var\(--mn-bar-clear, 96px\) \+ 16px\); \}/, 'the gate carries the bar\'s clearance itself');
  assert.match(css, /\.mn-gate-on \.mn, \.mn-gate-on body \{ padding-bottom: 0; \}\n\.mn-gate-on \.mn \{ display: flex; flex-direction: column; min-height: 100dvh; \}\n\.mn-gate-on \.mn__gate:not\(\[hidden\]\) \{ flex: 1 0 auto; \}/, 'the page runs to the bottom of the screen, under the bar');
  assert.match(css, /\.mn__onboard::after \{[^}]*left: 0; right: 0;/, 'nothing wider than the phone: the slanted line stays inside');
  assert.doesNotMatch(css.slice(css.indexOf('THE ONBOARDING, THREE PAGES')), /max-width\s*:\s*\d+px\)/, 'no max-width queries');
});

test('Full world is a full pane: the Earth edge to edge, the World\'s chrome at home, the layer line painted on its own (owner, 2026-10-15)', async () => {
  const html = await read('action-globe.html'), js = await read('js/action-globe.js'), css = await read('css/action-globe.css'), world = await read('mnet.html');
  assert.match(world, /class="mn__world-expand" href="action-globe\.html\?explore=1">Full world \u2197<\/a>/);
  assert.match(html, /<header><a id="worldBack" href="mnet\.html\?view=feed">\u2190 World<\/a>/, 'the way back is the World');
  assert.match(html, /<p class="explore-line" id="exploreLine" aria-live="polite" hidden><\/p>/);
  assert.match(js, /const EXPLORE=!embedded&&new URLSearchParams\(location\.search\)\.has\('explore'\);if\(EXPLORE\)document\.documentElement\.classList\.add\('globe-explore'\);/);
  assert.match(js, /function tell\(msg\)\{if\(EXPLORE\)exploreTell\(msg\);if\(!parentFrame\)return;/, 'the same messages, painted here when there is no parent');
  assert.match(js, /const VAUNT_LEAD='https:\/\/vauntapi\.flyvaunt\.com\/referral\/nuao1K'/);
  assert.match(js, /' aircraft in the air right now'\+\(f\.stale\?' \(last snapshot\)':''\)\+'\.<\/span> <a class="explore-lead" href="'\+VAUNT_LEAD\+'" target="_blank" rel="noopener sponsored">Fly Vaunt \\u2192<\/a>'/, 'the World\'s own words, and the lead reads Fly Vaunt');
  assert.match(js, /if\(d\.type==='hu:ask-sign-in'\)\{box\.innerHTML='<span>Sign in to see satellites and space missions on the Earth\.<\/span> <a class="explore-lead" href="account\.html\?stay=1">Sign in \\u2192<\/a>';box\.hidden=false;return\}/);
  assert.match(js, /barH=bar\?Math\.max\(0,Math\.ceil\(innerHeight-bar\.getBoundingClientRect\(\)\.top\)\):0;document\.documentElement\.style\.setProperty\('--hu-bar-h',barH\+'px'\);document\.documentElement\.style\.setProperty\('--hu-sheet-h',px\(deck\)\+'px'\)/, 'the bar (where its top is) and the sheet are measured so nothing stands under anything a hand needs');
  assert.match(css, /\.globe-explore #globe\{position:fixed;inset:0;height:auto;z-index:0\}/);
  assert.match(css, /\.globe-explore \.world-mode,\.globe-explore \.world-tools,\.globe-explore #worldFeed,[^}]*display:none!important\}/);
  assert.match(css, /\.globe-explore #deck\{position:fixed;inset:auto 0 var\(--hu-bar-h\) 0;/, 'the mission rides in a sheet on the bar');
  assert.match(css, /\.globe-explore \.globe-data\{bottom:calc\(var\(--hu-bar-h\) \+ var\(--hu-sheet-h\) \+ var\(--hu-sheet-gap\) \+ var\(--hu-credit-h,26px\) \+ 14px\)\}/);
  assert.match(css, /\.globe-explore \.mcc-auth-chip\{display:none!important\}/, 'the bar\'s sign-in chip stays off the sheet, as on the World');
  const explore = css.slice(css.indexOf('THE FULL WORLD'));
  assert.doesNotMatch(explore, /max-width\s*:\s*\d+px\)/, 'mobile first: min-width queries only');
  assert.match(explore, /@media\(min-width:700px\)\{\.globe-explore\{--hu-sheet-gap:12px\}\.globe-explore #deck\{left:50%;right:auto;width:min\(620px,calc\(100% - 32px\)\)/, 'wider screens only narrow and centre the sheet');
  assert.match(css, /\.globe-explore #deck\{position:fixed;inset:auto 0 var\(--hu-bar-h\) 0;z-index:6;height:auto;/, 'the sheet grows to the mission, not the old 15dvh strip');
});
