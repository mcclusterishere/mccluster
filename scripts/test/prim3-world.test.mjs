/* PRIM3 World (owner, 2026-11-02): the owner's mission globe and World builder. These checks hold the mission file to
   the Prim3 cast, the canon it cites, the owner gate, the Day look without purple, mobile-first CSS and the game hook.

   The canon checks read the Prim3 repository at origin/main without checking anything out:
   PRIM3_REPO=<path> (default: a sibling checkout ../prim3). Without it they are skipped, not passed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, missionErrors, castNations, deployHref, parseImport, uniqueId, blankMission } from '../../js/prim3-world/missions.mjs';
import { checkOwner } from '../../js/prim3-world/owner-gate.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const DOC = JSON.parse(read('data/prim3/world-missions.json'));
const PAGE = read('prim3-world.html');
const PRIM3 = process.env.PRIM3_REPO || resolve(ROOT, '../prim3');
const HAS_PRIM3 = existsSync(join(PRIM3, '.git')) && (() => { try { execFileSync('git', ['-C', PRIM3, 'rev-parse', '--verify', '-q', 'origin/main'], { stdio: 'ignore' }); return true; } catch (e) { return false; } })();
const prim3 = (file) => execFileSync('git', ['-C', PRIM3, 'show', 'origin/main:' + file], { encoding: 'utf8', maxBuffer: 1 << 26 });
const FEATURED = { 'us-road-kit': ['McCluster', 'US'], 'jp-bad-input': ['Aya Shinoda', 'JP'], 'kr-fails-safely': ['Hana Lee', 'KR'] };

test('one mission for each of the 24 CAST-NATIONS mains, from that nation\'s main character', { skip: !HAS_PRIM3 && 'Prim3 checkout not found' }, () => {
  const heads = [...prim3('story/CAST-NATIONS.md').matchAll(/^## (\d\d) — (.+?) — (.+?) — (.+)$/gm)].map((m) => ({ n: Number(m[1]), name: m[2], nation: m[3] }));
  assert.equal(heads.length, 24, 'CAST-NATIONS lists 24 mains');
  const mains = DOC.cast.filter((c) => c.main);
  assert.equal(mains.length, 24);
  for (const h of heads) {
    const c = mains.find((x) => x.order === h.n);
    assert.ok(c, `cast #${h.n} ${h.name}`);
    assert.equal(c.name, h.name); assert.equal(c.country.name, h.nation);
    const ms = DOC.missions.filter((m) => m.country.code === c.country.code);
    assert.equal(ms.length, 1, `exactly one mission in ${h.nation}`);
    assert.equal(ms[0].character.name, h.name, `${h.nation}'s mission belongs to ${h.name}`);
  }
});

test('24 main-nation missions plus Hana Lee\'s South Korea pin; one mission per country', () => {
  assert.equal(castNations(DOC).length, 24);
  const codes = DOC.missions.map((m) => m.country.code);
  assert.equal(new Set(codes).size, codes.length, 'no country twice');
  assert.equal(DOC.missions.length, 25);
  const extra = DOC.missions.filter((m) => !castNations(DOC).some((n) => n.code === m.country.code));
  assert.deepEqual(extra.map((m) => m.id), ['kr-fails-safely'], 'the only pin beyond the 24 is Hana\'s');
  const hana = DOC.cast.find((c) => c.name === 'Hana Lee');
  assert.equal(hana.main, false); assert.equal(hana.attached_to, 'Aya Shinoda');
});

test('the featured three are present, in three countries, and the only featured missions', () => {
  const feat = DOC.missions.filter((m) => m.featured);
  assert.deepEqual(feat.map((m) => m.id).sort(), Object.keys(FEATURED).sort());
  for (const [id, [name, code]] of Object.entries(FEATURED)) {
    const m = DOC.missions.find((x) => x.id === id);
    assert.equal(m.character.name, name); assert.equal(m.country.code, code);
    assert.ok(m.sources.length >= 5, `${id} is written closely from several canon sections`);
  }
  assert.equal(new Set(feat.map((m) => m.country.code)).size, 3, 'three different countries');
  const kr = DOC.missions.find((m) => m.id === 'kr-fails-safely'), jp = DOC.missions.find((m) => m.id === 'jp-bad-input');
  assert.equal(kr.place, 'Ulsan'); assert.equal(jp.place, 'Kariya, Aichi');
});

test('every mission is draft, complete, on a playable level, and validates', () => {
  const v = validate(DOC);
  assert.ok(v.ok, JSON.stringify(v));
  for (const m of DOC.missions) {
    assert.equal(m.status, 'draft', m.id);
    assert.equal(m.level, 'transit-relay', m.id);
    const sentences = m.briefing.split(/(?<=[.!?])\s+(?=["A-Z])/).length;
    assert.ok(sentences >= 2 && sentences <= 4, `${m.id} briefing has ${sentences} sentences`);
    assert.ok(Array.isArray(m.sources) && m.sources.length, `${m.id} cites canon`);
    assert.equal(deployHref(m), `prim3-transit.html?mission=${encodeURIComponent(m.id)}&new=1`);
  }
});

test('every cited source file exists in Prim3 origin/main, and every section is a heading in it', { skip: !HAS_PRIM3 && 'Prim3 checkout not found' }, () => {
  const files = new Map();
  for (const m of DOC.missions) for (const s of m.sources) {
    if (!files.has(s.file)) {
      execFileSync('git', ['-C', PRIM3, 'cat-file', '-e', 'origin/main:' + s.file]); // throws when the file is missing
      files.set(s.file, prim3(s.file).split('\n').filter((l) => /^#+\s/.test(l)).map((l) => l.replace(/^#+\s+/, '').trim()));
    }
    assert.ok(files.get(s.file).includes(s.section), `${m.id}: "${s.section}" is a heading in ${s.file}`);
  }
});

test('the builder\'s validation catches missing fields, a duplicate id and an uncovered cast nation', () => {
  const doc = structuredClone(DOC);
  doc.missions[1].id = doc.missions[0].id;
  doc.missions[2].briefing = '';
  doc.missions[3].lat = 123;
  doc.missions = doc.missions.filter((m) => m.country.code !== 'FR');
  const v = validate(doc);
  assert.equal(v.ok, false);
  assert.ok(Object.values(v.records).flat().some((e) => /used more than once/.test(e)));
  assert.ok(Object.values(v.records).flat().includes('Briefing is required.'));
  assert.ok(Object.values(v.records).flat().some((e) => /Latitude/.test(e)));
  assert.ok(v.general.some((e) => /France/.test(e)));
  const blank = blankMission(DOC);
  assert.ok(missionErrors(blank, DOC).length > 0, 'a new record starts incomplete');
  assert.notEqual(uniqueId(DOC, 'us-road-kit'), 'us-road-kit');
  assert.equal(parseImport('{').ok, false);
  assert.equal(parseImport('{"missions":[]}').ok, true);
});

test('missions are settings, not enemies: no real-world operational instructions or state antagonists', () => {
  for (const m of DOC.missions) {
    const t = `${m.title} ${m.briefing} ${m.objective}`;
    assert.doesNotMatch(t, /\b(government|regime|army|military|ministry|police)\b/i, m.id);
  }
});

test('the page is noindex, mobile first, and uses the whole PRIM3 lockup', () => {
  assert.match(PAGE, /<meta name="robots" content="noindex, nofollow">/);
  assert.doesNotMatch(PAGE, /user-scalable|maximum-scale/);
  assert.doesNotMatch(PAGE, /@media[^{]*max-width/);
  assert.doesNotMatch(PAGE, /(?<!minmax\(0,\s*)\b1fr\b(?!\))/, 'minmax(0,1fr), never a bare 1fr');
  assert.match(PAGE, /input,select,textarea\{font-size:max\(16px/);
  assert.match(PAGE, /src="assets\/img\/prim3-lockup-512\.png" alt="PRIM3" width="62" height="44"/, '512 x 366 scaled whole');
  assert.match(PAGE, /\.pw-lockup\{display:block;height:44px;width:auto\}/);
  assert.doesNotMatch(PAGE, /<h1>PRIM3/i, 'the name is the artwork, never typed as a logo');
  for (const f of readdirSync(join(ROOT, 'js/prim3-world'))) assert.doesNotMatch(read('js/prim3-world/' + f), /max-width/, f);
});

/* hue of a CSS colour, or null for greys */
function hue(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 16) return null;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; return h < 0 ? h + 360 : h;
}
test('no purple anywhere in the new page, scripts or styles (owner rule)', () => {
  const files = ['prim3-world.html', ...readdirSync(join(ROOT, 'js/prim3-world')).map((f) => 'js/prim3-world/' + f)];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /\b(purple|violet|indigo|magenta|lavender|orchid|plum)\b/i, f);
    for (const m of src.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
      const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
      const H = hue(...[0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)));
      assert.ok(H === null || H < 260 || H > 300, `${f}: ${m[0]} has hue ${H}`);
    }
    for (const m of src.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)) {
      const H = hue(+m[1], +m[2], +m[3]);
      assert.ok(H === null || H < 260 || H > 300, `${f}: ${m[0]} has hue ${H}`);
    }
    for (const m of src.matchAll(/0x([0-9a-f]{6})\b/gi)) {
      const H = hue(...[0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)));
      assert.ok(H === null || H < 260 || H > 300, `${f}: ${m[0]} has hue ${H}`);
    }
  }
});

test('the owner gate: nothing but "Owner only" ships in the page, and the app and mission file load only after a yes', () => {
  assert.match(PAGE, /<h1>Owner only<\/h1>/);
  assert.match(PAGE, /<template id="pwTpl"><div id="pwApp" hidden><\/div><\/template>/);
  assert.match(PAGE, /data-owner-gate data-owner-template="pwTpl" data-owner-load="js\/prim3-world\/news-desk\.mjs js\/prim3-world\/app\.mjs"/);
  assert.doesNotMatch(PAGE, /<script[^>]+src="js\/prim3-world\//, 'no app module is a page script: js/owner-only.mjs imports them after a yes');
  assert.match(PAGE, /<script type="module" src="js\/owner-only\.mjs\?v=__STAMP__"><\/script>/);
  for (const m of DOC.missions) {
    assert.ok(!PAGE.includes(m.title), `page source holds no mission title (${m.title})`);
    assert.ok(!PAGE.includes(m.briefing.slice(0, 40)), 'page source holds no briefing');
  }
  for (const name of ['Aya Shinoda', 'Hana Lee', 'world-missions.json']) assert.ok(!PAGE.includes(name), name);
  const app = read('js/prim3-world/app.mjs');
  const unlock = app.slice(app.indexOf('async function unlock()'), app.indexOf('/* ---------- shell'));
  assert.match(unlock, /fetch\(DATA_URL/, 'the mission file is requested inside unlock()');
  assert.equal(app.split('fetch(DATA_URL').length, 2, 'and nowhere else');
  assert.match(app, /\nunlock\(\);\n$/, 'the module runs only behind the gate, so it opens straight away');
});

test('checkOwner asks GET /v1/status with the session token and only a 2xx is the owner', async () => {
  const store = (v) => ({ getItem: () => (v ? JSON.stringify({ access_token: v }) : null) });
  let calls = [];
  const fake = (status) => async (url, init) => { calls.push({ url, auth: init.headers.authorization }); if (status === 'throw') throw Error('offline'); return { ok: status >= 200 && status < 300, status }; };
  assert.deepEqual(await checkOwner({ storage: store(null), fetchImpl: fake(200), auth: null }), { owner: false, reason: 'signed-out' });
  assert.equal(calls.length, 0, 'no session, no request');
  assert.equal((await checkOwner({ storage: store('t1'), fetchImpl: fake(200), auth: null })).owner, true);
  assert.deepEqual(calls.at(-1), { url: 'https://api.mccluster.org/v1/status', auth: 'Bearer t1' });
  assert.deepEqual(await checkOwner({ storage: store('t1'), fetchImpl: fake(403), auth: null }), { owner: false, reason: 'not-owner' });
  assert.deepEqual(await checkOwner({ storage: store('t1'), fetchImpl: fake(401), auth: null }), { owner: false, reason: 'not-owner' });
  assert.deepEqual(await checkOwner({ storage: store('t1'), fetchImpl: fake(503), auth: null }), { owner: false, reason: 'unavailable' });
  assert.deepEqual(await checkOwner({ storage: store('t1'), fetchImpl: fake('throw'), auth: null }), { owner: false, reason: 'unavailable' });
});

test('the transit page reads ?mission=<id> from the mission file and shows it; rules and saves are untouched', () => {
  const tx = read('js/prim3-tactics/transit.mjs');
  assert.match(tx, /const MISSION_ID = PARAMS\.get\('mission'\);/);
  assert.match(tx, /import \{ DATA_URL as WORLD_MISSIONS, DRAFT_KEY as WORLD_DRAFTS, findMission \} from '\.\.\/prim3-world\/missions\.mjs';/);
  assert.match(tx, /fetch\(WORLD_MISSIONS\)/);
  assert.match(tx, /if \(MISSION\) return \{ small, title: esc\(MISSION\.title\)/, 'the mission title leads the objective strip');
  assert.match(tx, /const brief = MISSION \? esc\(MISSION\.briefing\)/, 'its briefing is in the strip\'s details');
  assert.match(tx, /if \(!m \|\| typeof m\.title !== 'string'/, 'an unknown mission is ignored');
  assert.match(tx, /const SAVE_KEY = 'prim3\.transit\.v1';/, 'save key unchanged');
  assert.match(tx, /log\.unshift\(missionLine\(m\)\)/, 'the briefing is the first log line');
});

test('World is an owner-only door: the Control panel lists it, the tactics menu offers it only to the owner, the bar keeps five tabs', () => {
  const nav = read('js/site-navigation.js');
  assert.match(nav, /\{label:'PRIM3 World', group:'Products', href:new URL\('prim3-world\.html', house\)\.href, context:'Missions · World builder'\}/);
  const pv = read('js/prim3-tactics/preview.mjs');
  assert.match(pv, /ownerWorld && \{ key: 'world', label: 'World'/);
  assert.match(pv, /if \(menuSel === 'world' && ownerWorld\) \{ location\.href = 'prim3-world\.html'; return; \}/);
  assert.match(pv, /addEventListener\('mcc:appbar-admin'/);
  const bar = read('js/tabbar.js');
  assert.ok(!bar.includes('prim3-world'), 'no sixth tab: the owner bar is untouched');
  assert.match(bar, /data-appnav="halo" aria-label="Open Hitman’s Halo"/, 'the owner globe still opens Hitman\'s Halo');
});

test('no pins on the globe; a country card names the stationed agent and holds the News \u2192 mission hook', async () => {
  const globe = read('js/prim3-world/globe.mjs'), app = read('js/prim3-world/app.mjs');
  assert.doesNotMatch(globe, /setPins|pw-pin|createElement\('button'\)/, 'the globe draws no pins');
  assert.doesNotMatch(PAGE, /\.pw-pin/);
  assert.match(app, /Agent on assignment here/);
  assert.match(app, /<section class="pw-news" id="pwNews" data-country="\$\{esc\(code\)\}"/);
  assert.match(app, /data-news-placeholder disabled/);
  assert.match(app, /emitCountryCard\(code, \$\('pwNews'\), name\)/);
  assert.doesNotMatch(app, /v1\/world\/news/, 'the news build is not implemented here');
  // node's global is not an EventTarget; give it one for this check, as a browser window is
  if (typeof globalThis.dispatchEvent !== 'function') { const t = new EventTarget(); for (const k of ['addEventListener', 'removeEventListener', 'dispatchEvent']) globalThis[k] = t[k].bind(t); }
  const { onCountryCard, emitCountryCard, COUNTRY_CARD_EVENT } = await import('../../js/prim3-world/hooks.mjs');
  assert.equal(COUNTRY_CARD_EVENT, 'prim3:country-card');
  const seen = [], el = {};
  const off = onCountryCard((c, e, meta) => seen.push([c, e, meta.name]));
  let evt = null; const listen = (e) => { evt = e.detail; };
  globalThis.addEventListener(COUNTRY_CARD_EVENT, listen);
  emitCountryCard('JP', el, 'Japan');
  off(); emitCountryCard('KR', el, 'South Korea');
  globalThis.removeEventListener(COUNTRY_CARD_EVENT, listen);
  assert.deepEqual(seen, [['JP', el, 'Japan']]);
  assert.deepEqual(evt, { country: 'KR', name: 'South Korea', el });
});

test('canon guardrails: non-canon side operations, no spoilers, no disclaimers, McCluster only calls his mission in', () => {
  assert.equal(DOC.canon_status, 'side-operation-draft');
  for (const m of DOC.missions) {
    assert.equal(m.side_operation, true, m.id);
    const shown = [m.title, m.briefing, m.objective, m.note, m.character.name, m.character.role, m.place, m.episode || ''].join(' ');
    assert.doesNotMatch(shown, /\bNIS\b|intelligence (officer|service)|GLASSHOUSE|PRIM2|Hitman|Benji|Royce|Whip Equipped/i, m.id);
  }
  assert.doesNotMatch(DOC.cast.find((c) => c.name === 'Hana Lee').role, /legacy|deceased|NIS|intelligence/i);
  const hana = DOC.missions.find((m) => m.id === 'kr-fails-safely');
  assert.equal(hana.needs_owner_review, true);
  assert.doesNotMatch(hana.briefing, /\b(died|dead|death|alive|killed|late)\b/i, 'neutral about where Hana is now');
  assert.match(hana.briefing, /engineer and robotics researcher from Ulsan and Aya Shinoda's mentor/);
  const mc = DOC.missions.find((m) => m.id === 'us-road-kit');
  assert.equal(mc.deployment, 'wildcard-call');
  assert.match(mc.briefing, /calls it in from HQ as a scripted Wildcard call/);
  assert.match(mc.objective, /The squad \(Entry, Recon, Technical\)/);
  assert.match(DOC.notes.join(' '), /on assignment there from HQ/);
  const app = read('js/prim3-world/app.mjs');
  /* owner, 2026-11-03: "ditch the, oh, this is fictional ... Let this platform be itself. Don't disclaimer it just for existing" */
  for (const src of [app, PAGE, read('js/prim3-world/news-desk.mjs'), DOC.notes.join(' ')]) assert.doesNotMatch(src, /\bfiction(al)?\b/i);
  assert.match(DOC.notes.join(' '), /Real countries are settings, never enemies/, 'the real-world rule stays');
  assert.match(app, /he is not a deployable unit\. The squad \(Entry, Recon, Technical\) deploys\./);
  assert.match(app, /on assignment from HQ in the United States/);
  assert.doesNotMatch(app, /<code>\$\{esc\(s\.file\)\}/, 'cards list no source file names (they can carry spoilers); Edit does');
  const bad = structuredClone(DOC); bad.missions[0].side_operation = false;
  assert.ok(Object.values(validate(bad).records).flat().some((e) => /Side operation/.test(e)));
});

/* News desk in the country card (owner, 2026-11-03). */
import { deskHtml, loadDesk, ago } from '../../js/prim3-world/news-desk.mjs';
test('news desk card: brief and reactions are escaped, links are http(s) only, empty state is honest', () => {
  const html = deskHtml({ brief: { text: 'Japan <b>news</b>', headline_count: 12, created_at: '2026-11-03T00:00:00Z' }, comments: [
    { headline: 'Launch <script>', comment: 'Relay "up".', url: 'https://news.example/a' },
    { headline: 'Bad link', comment: 'x', url: 'javascript:alert(1)' },
  ] }, { name: 'Japan', now: Date.parse('2026-11-03T02:00:00Z') });
  assert.ok(html.includes('Japan &lt;b&gt;news&lt;/b&gt;'));
  assert.ok(html.includes('Launch &lt;script&gt;'));
  assert.ok(html.includes('href="https://news.example/a"'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('2 h ago') && html.includes('12 headlines'));
  assert.ok(html.includes('Headlines link to their publishers.'), 'attribution stays');
  assert.ok(!/fiction/i.test(html), 'no disclaimer');
  assert.match(deskHtml({ brief: null, comments: [] }, { name: 'Ethiopia' }), /has not filed/);
  assert.equal(ago('2026-11-03T00:00:30Z', Date.parse('2026-11-03T00:00:40Z')), 'just now');
});
test('news desk card: asks the owner-only route with the session and never without one', async () => {
  const storage = { getItem: () => JSON.stringify({ access_token: 'tok' }) };
  let seen = null;
  const ok = await loadDesk('JP', { storage, fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ brief: null, comments: [] }) }; } });
  assert.equal(seen.url, 'https://api.mccluster.org/v1/prim3/news-desk?country=JP');
  assert.equal(seen.init.headers.authorization, 'Bearer tok');
  assert.ok(ok.data);
  assert.deepEqual(await loadDesk('JP', { storage, fetchImpl: async () => ({ ok: false, status: 403 }) }), { error: 'not-owner' });
  let called = false;
  assert.deepEqual(await loadDesk('JP', { storage: { getItem: () => null }, fetchImpl: async () => { called = true; } }), { error: 'signed-out' });
  assert.equal(called, false);
});
