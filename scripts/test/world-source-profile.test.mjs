/* PROJECT DRAWDOWN'S SOURCE PAGE IN THE WORLD, the pure parts and the static rules (docs/control-plane/WORLD-MISSION-SOURCES.md;
   every decision there a default adopted pending Matthew's confirmation). js/world-source-profile.js is the page; this holds:
   - the address (?source=<slug>, &area, &preview; a ?mission= wins; the World's path by host; Share names mccluster.org on
     every host, the same origin as js/tabbar.js's WORLD_ORIGIN);
   - what is drawn: only the organization a shown link names (the two existing organization rows never, D9), only with this
     catalog's own words, never with a word of js/mission-source-words.js in its name, role line or facts; the open missions
     only (the house owner's session sees drafts through RLS), with their details given as an object or a one-element array;
   - what is computed: areas, counts, search, chips, the polite lines, plurals, calendar dates west of Greenwich, the credit;
   - every read string verbatim, with its filter, and never the creator or verification columns;
   - the words: nothing in the module matches the deny list except the four sentences that say what the page is not, verbatim;
     the module never names the brand, never draws or fetches a picture (no logo, image or monogram);
   - data/missions/drawdown/README.md keeps "the logo appears nowhere" and "nothing implies endorsement", and its name rule
     names only the page heading and its door.
     node --test scripts/test/world-source-profile.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/* west of Greenwich: a date read as UTC midnight shows the day before here */
process.env.TZ = 'America/Los_Angeles';

const require = createRequire(import.meta.url);
const P = require('../../js/world-source-profile.js');
const W = require('../../js/mission-source-words.js');
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const MODULE = 'js/world-source-profile.js';
const PRIVATE_WORD = ['bene', 'factor'].join(''); /* the owner's private word for the role: never in the page */

const ORG_ID = '7d0e0000-0000-4000-8000-00000000d0d0';
const ROLE = 'Missions written by McCluster Corp from Project Drawdown’s climate solutions.';
const FACTS = [
  { label: 'Organization', value: '501(c)(3) nonprofit', source: 'https://drawdown.org/about' },
  { label: 'Mailing address', value: 'St. Paul, Minnesota', source: 'https://drawdown.org/contact' },
  { label: 'What it publishes', value: 'Assessments of climate solutions, in the Drawdown Explorer', source: 'https://drawdown.org/explorer' }
];
const LINK = { catalog: 'drawdown', organization_id: ORG_ID, role_line: ROLE, facts: FACTS, facts_read_on: '2026-11-19', shown_at: '2026-12-01T03:30:00+00:00' };
const ORG = { id: ORG_ID, slug: 'project-drawdown', name: 'Project Drawdown', website_url: 'https://drawdown.org/', organization_type: 'nonprofit' };
/* the two organization rows production holds today (map 00, F3): never drawn */
const AUTHENTICITY = { id: '7d0e0000-0000-4000-8000-0000000000a1', slug: 'authenticity-network', name: 'Authenticity Network', website_url: null, organization_type: 'community' };
const BRAND_ROW = { id: '7d0e0000-0000-4000-8000-0000000000a2', slug: ['equity', 'uprise'].join('-'), name: 'E. U.', website_url: 'https://matthew.mccluster.org/docket-516.html', organization_type: 'project' };
const id = (n) => `0e1f0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mission = (n, extra = {}) => ({ id: id(n), title: `Mission ${n}`, description: `Do thing ${n}.`, domain: 'research', kind: 'civic', difficulty: 1, base_points: 100, status: 'open',
  action_mission_details: { slug: `drawdown-m${n}`, catalog: 'drawdown', license_name: null, about_credit: null, source_url: 'https://drawdown.org/explorer/x' }, ...extra });

test('the address: ?source=<slug> with &area and &preview, a ?mission= wins, the World path by host, Share always names mccluster.org', () => {
  assert.deepEqual(P.parseAddress('?source=project-drawdown'), { valid: true, slug: 'project-drawdown', area: '', preview: false });
  assert.deepEqual(P.parseAddress('?source=project-drawdown&area=food-farming&preview=1'), { valid: true, slug: 'project-drawdown', area: 'food-farming', preview: true });
  assert.deepEqual(P.parseAddress('?source=project-drawdown&area=all'), { valid: true, slug: 'project-drawdown', area: 'all', preview: false });
  assert.equal(P.parseAddress('?source=project-drawdown&area=<b>').area, '', 'an area key outside the pattern is ignored');
  for (const bad of ['', 'Project-Drawdown', '-drawdown', 'x', 'project_drawdown', 'a'.repeat(65), 'drawdown%20x']) {
    assert.equal(P.parseAddress('?source=' + bad).valid, false, `slug ${bad} is not asked about`);
  }
  assert.equal(P.parseAddress('?mission=0e1f0000-0000-4000-8000-000000000001&source=project-drawdown'), null, 'a ?mission= in the same address wins');
  assert.equal(P.parseAddress('?view=feed'), null, 'nothing to do without source');
  assert.equal(P.parseAddress('?src=project-drawdown'), null, 'attribution\'s src is not the source key');
  assert.deepEqual(['Buildings', 'Transportation', 'Food & farming', 'Electricity', 'Industry & waste', 'Oceans & coasts', 'Nature', 'Carbon removal', 'Energy & methane'].map(P.areaKey),
    ['buildings', 'transportation', 'food-farming', 'electricity', 'industry-waste', 'oceans-coasts', 'nature', 'carbon-removal', 'energy-methane']);
  for (const host of ['mccluster.org', 'www.mccluster.org', 'humanuprise.com', 'www.humanuprise.com', 'MCCLUSTER.ORG']) assert.equal(P.worldPath(host), '/', host);
  for (const host of ['matthew.mccluster.org', '127.0.0.1', 'api.mccluster.org', 'mccluster.org.example']) assert.equal(P.worldPath(host), '/mnet.html', host);
  assert.equal(P.sourceHref('mccluster.org', 'project-drawdown', 'food-farming', false), '/?source=project-drawdown&area=food-farming');
  assert.equal(P.sourceHref('matthew.mccluster.org', 'project-drawdown', '', true), '/mnet.html?source=project-drawdown&preview=1');
  assert.equal(P.restHref('mccluster.org', '?source=project-drawdown&area=buildings&preview=1&view=feed'), '/?view=feed', 'the page\'s keys go, the rest stay');
  assert.equal(P.restHref('matthew.mccluster.org', '?source=project-drawdown'), '/mnet.html');
  assert.deepEqual(P.withoutSource({ mccSource: 'project-drawdown', mccMission: id(1) }), { mccMission: id(1) });
  assert.equal(P.withoutSource({ mccSource: 'project-drawdown' }), null);
  /* Share: the company's World on every host, the same origin the bar's Globe goes to */
  const origin = /var WORLD_ORIGIN = "([^"]+)";/.exec(read('js/tabbar.js'));
  assert.ok(origin, 'js/tabbar.js still names WORLD_ORIGIN');
  assert.equal(P.SHARE_ORIGIN, origin[1]);
  assert.equal(P.shareLink('project-drawdown'), 'https://mccluster.org/?source=project-drawdown');
  assert.equal(P.shareLink('<x>'), '');
});

test('what is drawn: the organization a shown link names, with its own words, and nothing on the deny list', () => {
  const s = P.cleanSource(LINK, ORG);
  assert.deepEqual(s, {
    catalog: 'drawdown', slug: 'project-drawdown', name: 'Project Drawdown', role: ROLE,
    facts: FACTS.map((f) => ({ label: f.label, value: f.value, href: f.source, where: f.source.replace(/^https:\/\//, '') })),
    factsReadOn: '2026-11-19', shownOn: '2026-12-01'
  });
  assert.equal(P.factsLine(s), '501(c)(3) nonprofit', 'S9: the first fact\'s value only');
  assert.equal(P.factsLine({ facts: [] }), '');
  /* refused: no door, "That page is not available." */
  const refused = {
    'the organization the link does not name': [LINK, { ...ORG, id: AUTHENTICITY.id }],
    'a hostile name': [LINK, { ...ORG, name: 'Project Drawdown (official partner)' }],
    'a name with a line break': [LINK, { ...ORG, name: 'Project\nDrawdown' }],
    'an empty name': [LINK, { ...ORG, name: '' }],
    'a name of 121 characters': [LINK, { ...ORG, name: 'P'.repeat(121) }],
    'a slug outside production\'s check': [LINK, { ...ORG, slug: 'Project Drawdown' }],
    'a role line of two lines': [{ ...LINK, role_line: 'Missions written by McCluster Corp\nfrom its climate solutions.' }, ORG],
    'a role line of 161 characters': [{ ...LINK, role_line: 'M'.repeat(161) }, ORG],
    'an empty role line': [{ ...LINK, role_line: '' }, ORG],
    'a sponsor in the role line': [{ ...LINK, role_line: 'Our sponsor for the environment missions.' }, ORG],
    'endorsement in the role line': [{ ...LINK, role_line: 'Missions endorsed by Project Drawdown.' }, ORG],
    'the private word in the role line': [{ ...LINK, role_line: `Our first ${PRIVATE_WORD}.` }, ORG],
    'a denied word in a fact\'s value': [{ ...LINK, facts: [{ label: 'Organization', value: 'Official partner', source: 'https://drawdown.org/about' }] }, ORG],
    'a denied word in a fact\'s label': [{ ...LINK, facts: [{ label: 'Funded by', value: 'x', source: 'https://drawdown.org/about' }] }, ORG],
    'a denied word in a fact the page would not show': [{ ...LINK, facts: [{ label: 'Account', value: 'x', source: 'http://drawdown.org/' }] }, ORG],
    'a catalog without its own words': [{ ...LINK, catalog: 'other' }, ORG],
    'a malformed catalog': [{ ...LINK, catalog: 'Drawdown!' }, ORG],
    'another organization under these words': [{ ...LINK, organization_id: AUTHENTICITY.id }, AUTHENTICITY],
    'the brand\'s own row under these words': [{ ...LINK, organization_id: BRAND_ROW.id }, BRAND_ROW]
  };
  for (const [why, [link, org]] of Object.entries(refused)) assert.equal(P.cleanSource(link, org), null, why);
  /* the facts: label, value and an https source, at most six, the source shown as host and path */
  assert.deepEqual(P.cleanFacts([
    { label: 'A', value: 'a', source: 'http://drawdown.org/about' },
    { label: 'B', value: 'b', source: 'javascript:alert(1)' },
    { label: 'C', value: 'c', source: ['https://user:pw', 'drawdown.org/'].join(String.fromCharCode(64)) }, /* credentials in the address */
    { label: 'L'.repeat(41), value: 'd', source: 'https://drawdown.org/' },
    { label: 'E', value: 'line\nbreak', source: 'https://drawdown.org/' },
    { label: 'F', value: 'f', source: 'https://drawdown.org/' },
    'not an object', null, ['label', 'value', 'source']
  ]), [{ label: 'F', value: 'f', href: 'https://drawdown.org/', where: 'drawdown.org' }]);
  assert.equal(P.cleanFacts(Array.from({ length: 9 }, (_, i) => ({ label: `L${i}`, value: 'v', source: 'https://drawdown.org/' }))).length, 6);
  assert.deepEqual(P.cleanFacts({ label: 'x' }), []);
  /* only an organization a shown link named is ever drawn: the two existing rows never (D9), whatever the read returned */
  const drawn = P.pairSources([LINK], [AUTHENTICITY, BRAND_ROW, ORG, { ...ORG, name: 'A second row for the same id' }]);
  assert.deepEqual(drawn.map((x) => x.slug), ['project-drawdown']);
  assert.deepEqual(P.pairSources([LINK], [AUTHENTICITY, BRAND_ROW]), []);
  assert.deepEqual(P.pairSources([], [ORG]), []);
  assert.deepEqual(P.linkIds([LINK, LINK, { organization_id: 'not-a-uuid' }]), [ORG_ID]);
});

test('the missions: open only (the owner sees drafts through RLS), details as an object or a one-element array, this catalog only', () => {
  const rows = [
    mission(1),
    mission(2, { action_mission_details: [mission(2).action_mission_details] }),
    mission(3, { status: 'draft' }),
    mission(4, { status: undefined }),
    mission(5, { action_mission_details: [mission(5).action_mission_details, mission(5).action_mission_details] }),
    mission(6, { action_mission_details: { ...mission(6).action_mission_details, catalog: 'other' } }),
    mission(7, { action_mission_details: null }),
    mission(8, { kind: 'clip' }),
    mission(9, { id: 'not-a-uuid' }),
    mission(10, { title: '   ' }),
    mission(1),
    mission(11, { difficulty: 9, base_points: -1, action_mission_details: { ...mission(11).action_mission_details, slug: '<b>', about_credit: 'Solution summary © Project Drawdown, used with permission.', license_name: 'CC BY 4.0' } })
  ];
  const clean = P.cleanMissions(rows, 'drawdown');
  assert.deepEqual(clean.map((m) => m.title), ['Mission 1', 'Mission 2', 'Mission 11']);
  assert.deepEqual(clean[2], { id: id(11), title: 'Mission 11', description: 'Do thing 11.', domain: 'research', slug: '', difficulty: null, points: null, quote: true, licence: true });
  assert.deepEqual(P.cleanMissions('nope', 'drawdown'), []);
});

test('the areas: most open missions first then by name, easiest first then A to Z, a mission the map does not place under Other missions', () => {
  const map = P.readAreaMap({ schema: 'mission-areas/v1', catalog: 'drawdown', areas: ['Buildings', 'Nature', 'Transportation'], slugs: { 'drawdown-m1': 0, 'drawdown-m2': 1, 'drawdown-m3': 1, 'drawdown-m4': 2, 'drawdown-m5': 2, 'drawdown-m6': 7, 'BAD SLUG': 0 } }, 'drawdown');
  assert.deepEqual(map.slugs, { 'drawdown-m1': 0, 'drawdown-m2': 1, 'drawdown-m3': 1, 'drawdown-m4': 2, 'drawdown-m5': 2 }, 'an index out of range or a malformed slug is dropped');
  assert.equal(P.readAreaMap({ schema: 'mission-areas/v1', catalog: 'other', areas: ['A'], slugs: {} }, 'drawdown'), null, 'another catalog\'s map');
  assert.equal(P.readAreaMap({ schema: 'v0', catalog: 'drawdown', areas: ['A'], slugs: {} }, 'drawdown'), null);
  assert.equal(P.readAreaMap({ schema: 'mission-areas/v1', catalog: 'drawdown', areas: ['Sponsored picks'], slugs: {} }, 'drawdown'), null, 'an area name on the deny list');
  const ms = P.cleanMissions([
    mission(1, { title: 'Zeta', difficulty: 2 }), mission(2, { title: 'beta' }), mission(3, { title: 'Alpha' }),
    mission(4, { title: 'Delta', difficulty: 3 }), mission(5, { title: 'Gamma' }), mission(6, { title: 'Off the map' }), mission(7, { title: 'Also off', difficulty: 1 })
  ], 'drawdown');
  const groups = P.groupMissions(ms, map);
  assert.deepEqual(groups.map((g) => [g.name, g.key, g.count]), [['Nature', 'nature', 2], ['Transportation', 'transportation', 2], ['Buildings', 'buildings', 1], ['Other missions', 'other-missions', 2]]);
  assert.deepEqual(groups[0].missions.map((m) => m.title), ['Alpha', 'beta'], 'easiest first, then A to Z ignoring case');
  assert.deepEqual(groups[1].missions.map((m) => m.title), ['Gamma', 'Delta']);
  assert.deepEqual(groups[0].sample, ['Alpha', 'beta'], 'each area carries its first two titles');
  assert.equal(groups[3].other, true);
  assert.deepEqual(P.groupMissions(ms, null).map((g) => g.name), ['Other missions'], 'without the map every mission is in one list');
  assert.deepEqual(P.sortMissions(ms).map((m) => m.title).slice(0, 3), ['Alpha', 'Also off', 'beta']);
});

test('the credit counts, the search, the chips, the lines a visitor hears and the plurals', () => {
  const ms = P.cleanMissions([
    mission(1, { title: 'Find out what heats your home\'s hot water', description: 'Look at the heater label.', domain: 'education', action_mission_details: { ...mission(1).action_mission_details, about_credit: 'q', license_name: 'CC BY 4.0' } }),
    mission(2, { title: 'Ask an elder how your family used to cook', domain: 'research', action_mission_details: { ...mission(2).action_mission_details, about_credit: 'q' } }),
    mission(3, { title: 'Map heat islands', domain: 'mutual_aid', action_mission_details: { ...mission(3).action_mission_details, license_name: 'CC BY 4.0' } }),
    mission(4, { title: 'Count bikes', domain: 'other' })
  ], 'drawdown');
  assert.deepEqual(P.creditCounts(ms), { quote: 2, licence: 2, both: 1, nameOnly: 1, total: 4 });
  assert.deepEqual(P.creditCounts([]), { quote: 0, licence: 0, both: 0, nameOnly: 0, total: 0 });
  assert.deepEqual(P.searchMissions(ms, ' HEAT ').map((m) => m.title), ['Find out what heats your home\'s hot water', 'Map heat islands'], 'title, case and spaces');
  assert.deepEqual(P.searchMissions(ms, 'heater label').map((m) => m.title), ['Find out what heats your home\'s hot water'], 'the description');
  assert.deepEqual(P.searchMissions(ms, 'mutual aid').map((m) => m.title), ['Map heat islands'], 'the field in words');
  assert.deepEqual(P.searchMissions(ms, 'mutual_aid').map((m) => m.title), ['Map heat islands'], 'the field\'s key');
  assert.equal(P.searchMissions(ms, '').length, 4);
  assert.deepEqual(P.highlight('Map heat islands', 'HEAT'), [{ text: 'Map ', mark: false }, { text: 'heat', mark: true }, { text: ' islands', mark: false }]);
  assert.deepEqual(P.highlight('heat and heat', 'heat'), [{ text: 'heat', mark: true }, { text: ' and ', mark: false }, { text: 'heat', mark: true }]);
  assert.deepEqual(P.highlight('İstanbul heat', 'heat'), [{ text: 'İstanbul heat', mark: false }], 'nothing is marked where lower-casing changes the length');
  assert.deepEqual(P.fieldChips(ms).map((c) => [c.label, c.count]), [['All fields', 4], ['Education', 1], ['Mutual aid', 1], ['Research', 1]], 'a field without words is in All fields only');
  /* E2 to E4, E9, E16 to E21 */
  assert.equal(P.placeholder(125, ''), 'Search 125 missions');
  assert.equal(P.placeholder(1, ''), 'Search 1 mission');
  assert.equal(P.placeholder(125, 'Buildings'), 'Search Buildings');
  assert.equal(P.placeholder(0, ''), 'Search these missions', 'before the missions read answers');
  assert.equal(P.areaLabel('Buildings', 21), 'Buildings, 21 missions');
  assert.equal(P.areaLabel('Energy & methane', 1), 'Energy & methane, 1 mission');
  assert.equal(P.statusLine({ count: 21, areaName: 'Buildings' }), '21 missions in Buildings, easiest first.');
  assert.equal(P.statusLine({ count: 8, field: 'Research', areaName: 'Buildings' }), '8 Research missions in Buildings, easiest first.');
  assert.equal(P.statusLine({ count: 125, areas: 9 }), '125 missions in 9 areas, easiest first.');
  assert.equal(P.statusLine({ count: 7, query: 'heat', areas: 3 }), '7 missions match “heat”, in 3 areas.');
  assert.equal(P.statusLine({ count: 4, query: 'heat', areaName: 'Buildings' }), '4 missions in Buildings match “heat”.');
  assert.equal(P.statusLine({ count: 0, query: 'xyz' }), 'No mission here matches “xyz”.');
  assert.equal(P.statusLine({ count: 1, query: 'heat', areas: 1 }), '1 mission matches “heat”, in 1 area.');
  assert.equal(P.statusLine({ count: 1, areaName: 'Energy & methane' }), '1 mission in Energy & methane, easiest first.');
  assert.equal(P.countMissions(1) + ' · ' + P.countAreas(1) + ' · ' + P.countAreas(9), '1 mission · 1 area · 9 areas');
  assert.equal(P.rowMeta({ domain: 'research', difficulty: 1, points: 100 }), 'Research · Difficulty 1 · 100 points');
  assert.equal(P.rowMeta({ domain: 'other', difficulty: 2, points: null }), 'Difficulty 2');
});

test('dates are calendar dates, also west of Greenwich, and the citation is dated by the catalog', () => {
  assert.equal(new Date().getTimezoneOffset() > 0, true, 'this test runs west of Greenwich');
  assert.equal(new Date('2026-11-19').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), 'November 18, 2026', 'the mistake this guards against');
  assert.equal(P.calendarDate('2026-11-19', 'en-US'), 'November 19, 2026');
  assert.equal(P.calendarDate('2026-02-30', 'en-US'), '', 'not a calendar day');
  assert.equal(P.calendarDate('19/11/2026', 'en-US'), '');
  assert.equal(P.cleanSource({ ...LINK, shown_at: '2026-12-01T03:30:00+00:00' }, ORG).shownOn, '2026-12-01', 'shown_at by its date part');
  assert.equal(P.cleanSource({ ...LINK, facts_read_on: 'yesterday' }, ORG).factsReadOn, '');
  /* C8: dated the day this site read the Explorer, the catalog's own date (that folder is not published) */
  const generated = JSON.parse(read('data/missions/drawdown/solutions-catalog.json')).generated;
  assert.equal(P.CITATION_DAY, generated);
  assert.equal(P.citationDate(P.CITATION_DAY), '2026, November 17');
});

test('the credit: the lines drawn by count, and each counted line in the page\'s exact words', () => {
  assert.deepEqual(P.creditPlan(null), ['C1', 'C2', 'NR', 'C6', 'TM', 'C7', 'C8', 'C9', 'C10', 'C11'], 'while the missions are read: nothing counted');
  assert.deepEqual(P.creditPlan({ quote: 0, licence: 0, both: 0, nameOnly: 0, total: 0 }), ['C1', 'C6', 'TM', 'C7', 'C8', 'C9', 'C10', 'C11'], 'none open');
  assert.deepEqual(P.creditPlan({ quote: 87, licence: 43, both: 40, nameOnly: 35, total: 125 }), ['C1', 'C2', 'NR', 'C3', 'C4', 'C5', 'C6', 'TM', 'C7', 'C8', 'C9', 'C10', 'C11']);
  assert.deepEqual(P.creditPlan({ quote: 2, licence: 0, both: 0, nameOnly: 0, total: 2 }), ['C1', 'C2', 'NR', 'C3', 'C6', 'TM', 'C7', 'C8', 'C9', 'C10', 'C11'], 'a line whose count is zero is not drawn');
  assert.deepEqual(P.creditPlan({ quote: 0, licence: 1, both: 0, nameOnly: 1, total: 2 }), ['C1', 'C2', 'NR', 'C4', 'C5', 'C6', 'TM', 'C7', 'C8', 'C9', 'C10', 'C11'], 'no quotation, no quotation line');
  const kit = P.kitFor('drawdown'), counts = { quote: 87, licence: 43, both: 40, nameOnly: 35, total: 125 };
  assert.equal(P.piecesText(P.creditPieces(kit, 'C3', counts)), '87 quote a short summary from drawdown.org (© Project Drawdown, used with permission), always as a quotation with its credit beneath it.');
  assert.equal(P.piecesText(P.creditPieces(kit, 'C4', counts)), '43 cite a Project Drawdown solution assessment published on Zenodo under CC BY 4.0, naming its creators, record, DOI and licence; 40 of them also quote a summary.');
  assert.equal(P.piecesText(P.creditPieces(kit, 'C4', { ...counts, both: 0 })), '43 cite a Project Drawdown solution assessment published on Zenodo under CC BY 4.0, naming its creators, record, DOI and licence.', 'the clause after the semicolon only above zero');
  assert.equal(P.piecesText(P.creditPieces(kit, 'C5', counts)), '35 name the solution and link to its page in the Drawdown Explorer.');
  assert.equal(P.piecesText(P.creditPieces(kit, 'C5', { ...counts, nameOnly: 1 })), '1 names the solution and links to its page in the Drawdown Explorer.');
  const c = kit.credit;
  assert.equal(c.heading, 'Credit');
  assert.equal(c.written, 'Every mission here was written by McCluster Corp from Project Drawdown’s climate solutions; the wording is original. Each mission’s full credit opens with it.');
  assert.equal(c.noImage, 'No Project Drawdown logo or image is used.');
  assert.equal(c.trademark, 'Project Drawdown® is a registered trademark of Project Drawdown, named here only to identify the source of these missions.');
  assert.equal(c.citedAs, 'Cited as Project Drawdown asks, dated the day this site read the Drawdown Explorer');
  assert.equal(`${c.citeWho} (${P.citationDate(P.CITATION_DAY)}). ${c.citeTitle}. ${c.citeAddress}.`, 'Project Drawdown. (2026, November 17). The Drawdown Explorer. http://drawdown.org/explorer.');
  assert.equal(c.citeHref, 'https://drawdown.org/explorer');
  assert.deepEqual(c.links.map((l) => [l.text, l.href]), [['Drawdown Explorer', 'https://drawdown.org/explorer'], ['The assessments on Zenodo', 'https://zenodo.org/communities/pdexplorer'], ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/']]);
  assert.equal(c.inMission, 'Every mission’s full credit is in the mission itself.');
  assert.equal(c.askLead + c.askLink, 'To ask for a change, write to McCluster Corp through its company page');
  assert.equal(c.askHref, 'https://mccluster.org/company');
});

test('the reads, verbatim: shown sources only, the named organizations only, open missions with their status, the area map, the owner\'s route', async () => {
  const asked = [], sbRest = (path) => { asked.push(path); return Promise.resolve([]); };
  await P.readShownSources(sbRest);
  await P.readOrganizations(sbRest, [ORG_ID, AUTHENTICITY.id]);
  await P.readMissions(sbRest, 'drawdown');
  assert.deepEqual(asked, [
    'mission_catalog_sources?state=eq.shown&select=catalog,organization_id,role_line,facts,facts_read_on,shown_at&limit=20',
    `network_organizations?id=in.(${ORG_ID},${AUTHENTICITY.id})&select=id,slug,name,website_url,organization_type`,
    'action_missions?status=eq.open&select=id,title,description,domain,kind,difficulty,base_points,status,action_mission_details!inner(slug,catalog,license_name,about_credit,source_url)&action_mission_details.catalog=eq.drawdown&limit=500'
  ]);
  const fetched = [];
  await P.readAreas((u, init) => { fetched.push([u, init]); return Promise.resolve({}); }, 'drawdown');
  assert.deepEqual(fetched, [['data/missions/drawdown-areas.json', { credentials: 'same-origin' }]]);
  const called = [];
  await P.readOwnerState((p) => { called.push(p); return Promise.resolve({}); });
  assert.deepEqual(called, ['/v1/mission-sources']);
  /* the source: each read is a call the shipped-code scanner sees (scripts/test/rpc-names-exist.test.mjs, supabase/pending/live-callers.json) */
  const src = read(MODULE);
  assert.match(src, /sbRest\("mission_catalog_sources\?state=eq\.shown&select=catalog,organization_id,role_line,facts,facts_read_on,shown_at&limit=20"\)/);
  assert.match(src, /sbRest\("network_organizations\?id=in\.\(" \+ ids\.join\(","\) \+ "\)&select=id,slug,name,website_url,organization_type"\)/);
  assert.match(src, /sbRest\("action_missions\?status=eq\.open&select=id,title,description,domain,kind,difficulty,base_points,status,action_mission_details!inner\(slug,catalog,license_name,about_credit,source_url\)&action_mission_details\.catalog=eq\." \+ catalog \+ "&limit=500"\)/);
  assert.match(src, /fetchImpl\("data\/missions\/" \+ catalog \+ "-areas\.json", \{ credentials: "same-origin" \}\)/);
  assert.match(src, /api\("\/v1\/mission-sources"\)/);
  assert.doesNotMatch(src, /created_by|verification_state/, 'never the creator or the verification columns');
  const reads = src.match(/sbRest\("[^"]*/g);
  assert.equal(reads.length, 3, 'three table reads');
  assert.ok(reads.every((r) => !/action_missions\?/.test(r) || /status=eq\.open&select=[^&]*\bstatus\b/.test(r)), 'every missions read carries status=eq.open and selects status');
  assert.ok(reads.every((r) => !/mission_catalog_sources\?/.test(r) || /state=eq\.shown/.test(r)), 'every link read carries state=eq.shown');
  const callers = JSON.parse(read('supabase/pending/live-callers.json')).pending_only.mission_catalog_sources;
  assert.deepEqual(callers, { kind: 'table', pending: '20261119140000_mission_catalog_sources_v1.sql', callers: [MODULE] });
});

test('the sources are read once: a shown row and its organization, nothing more without one, an absent table remembered for the session', async () => {
  const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
  const fake = (answers) => { const asked = []; return { asked, sbRest: (p) => { asked.push(p.split('?')[0]); const a = answers.shift(); return a instanceof Error ? Promise.reject(a) : Promise.resolve(a); } }; };
  let f = fake([[LINK], [ORG, AUTHENTICITY]]);
  let r = await P.loadSources({ sbRest: f.sbRest, storage: store() });
  assert.deepEqual([r.status, r.sources.map((s) => s.slug)], ['ok', ['project-drawdown']]);
  assert.deepEqual(f.asked, ['mission_catalog_sources', 'network_organizations']);
  f = fake([[]]);
  r = await P.loadSources({ sbRest: f.sbRest, storage: store() });
  assert.deepEqual([r.status, r.sources, f.asked], ['ok', [], ['mission_catalog_sources']], 'no row, no organizations read');
  for (const code of ['PGRST205', '42P01']) {
    const s = store();
    f = fake([Object.assign(new Error('gone'), { status: 404, data: { code } })]);
    r = await P.loadSources({ sbRest: f.sbRest, storage: s });
    assert.equal(r.status, 'absent', code);
    assert.equal(s.m.get(P.ABSENT_KEY), '1', 'remembered for the session');
    f = fake([[LINK], [ORG]]);
    r = await P.loadSources({ sbRest: f.sbRest, storage: s });
    assert.deepEqual([r.status, f.asked], ['absent', []], 'nothing more is asked this session');
  }
  assert.equal(P.ABSENT_KEY, 'mcc.missionSources.absent');
  const s = store();
  f = fake([Object.assign(new Error('boom'), { status: 500, data: { code: 'XX000' } })]);
  r = await P.loadSources({ sbRest: f.sbRest, storage: s });
  assert.deepEqual([r.status, s.m.size], ['failed', 0], 'a failure is not an absence');
  f = fake([[LINK], Object.assign(new Error('boom'), { status: 503 })]);
  assert.equal((await P.loadSources({ sbRest: f.sbRest, storage: null })).status, 'failed', 'the organizations read failed');
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  f = fake([Object.assign(new Error('gone'), { status: 404, data: { code: 'PGRST205' } })]);
  assert.equal((await P.loadSources({ sbRest: f.sbRest, storage: throwing })).status, 'absent', 'storage that throws changes nothing');
});

test('the house owner\'s preview: draft and hidden pages from the owner\'s route; anything else is not available', () => {
  const route = (state, extra = {}) => ({ ok: true, store: 'applied', history: [], sources: [{ catalog: 'drawdown', state, revision: 2, role_line: ROLE, facts: FACTS, facts_read_on: '2026-11-19', shown_at: null, organization: { slug: 'project-drawdown', name: 'Project Drawdown', website_url: 'https://drawdown.org/', organization_type: 'nonprofit' }, open_missions: 125, ...extra }] });
  for (const state of ['draft', 'hidden', 'shown']) {
    const p = P.previewFrom(route(state), 'project-drawdown');
    assert.equal(p.state, state);
    assert.equal(p.source.name, 'Project Drawdown');
  }
  assert.deepEqual(P.previewFrom(route('draft'), 'authenticity-network'), { error: 'none' });
  assert.deepEqual(P.previewFrom(route('draft', { role_line: 'Our sponsor.' }), 'project-drawdown'), { error: 'none' });
  assert.deepEqual(P.previewFrom(route('archived'), 'project-drawdown'), { error: 'none' });
  assert.deepEqual(P.previewFrom({ ok: true, store: 'not_applied', sources: [], history: [] }, 'project-drawdown'), { error: 'none' });
  assert.deepEqual(P.previewFrom({ ok: true, store: 'unavailable', sources: [], history: [] }, 'project-drawdown'), { error: 'unavailable' });
  assert.deepEqual(P.previewFrom(null, 'project-drawdown'), { error: 'unavailable' });
  assert.equal(P.previewError({ status: 401 }), 'signin');
  assert.equal(P.previewError({ status: 403 }), 'none');
  assert.equal(P.previewError({ status: 503 }), 'unavailable');
  assert.equal(P.previewError(new TypeError('Failed to fetch')), 'unavailable');
});

/* every string literal of a script, comments and regular expressions skipped (the module is ES5: no template literals) */
function stringLiterals(src) {
  const out = [];
  let i = 0, prev = '';
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
    if (c === '/' && d === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') { s += src[j + 1]; j += 2; continue; } s += src[j]; j += 1; }
      out.push(s); i = j + 1; prev = 'a'; continue;
    }
    if (c === '/' && (!prev || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || /\b(return|typeof|case)$/.test(src.slice(Math.max(0, i - 8), i).trimEnd()))) {
      let j = i + 1, inClass = false;
      while (j < src.length) { const ch = src[j]; if (ch === '\\') { j += 2; continue; } if (ch === '[') inClass = true; else if (ch === ']') inClass = false; else if (ch === '/' && !inClass) break; j += 1; }
      i = j + 1; while (/[a-z]/i.test(src[i] || '')) i += 1; prev = 'a'; continue;
    }
    assert.notEqual(c, '`', 'no template literal in the module');
    if (!/\s/.test(c)) prev = c;
    i += 1;
  }
  return out;
}
const kitStrings = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(kitStrings) : v && typeof v === 'object' ? Object.values(v).flatMap(kitStrings) : []);

test('the words: nothing on the deny list but the four sentences that say what the page is not, verbatim; never the brand or account words', () => {
  const kit = P.kitFor('drawdown');
  const S12 = 'Project Drawdown does not run or pay for this page and has not endorsed this platform.';
  const A1 = 'A page McCluster Corp keeps about the source of some of the missions on this platform. It is not Project Drawdown’s account: no one signs in as Project Drawdown, and nothing here is posted by it.';
  const A3 = 'McCluster Corp. Project Drawdown does not run this page, post on it, answer through it or pay for it. It is not a sponsor or partner of this platform, and this page is not a paid placement.';
  const NR = 'A mission here is not a rating or a recommendation by Project Drawdown. Project Drawdown rates solutions on its own pages; this page shows none of its ratings.';
  assert.equal(kit.trustLead, 'Made by McCluster Corp, which runs this platform.');
  assert.equal(kit.trustRest, S12);
  const about = Object.fromEntries(kit.aboutRows.map((r) => [r.id, r]));
  assert.deepEqual(kit.aboutRows.map((r) => [r.id, r.term]), [['A1', 'What this page is'], ['A2', 'Made by'], ['A3', 'Who runs it'], ['A4', 'The missions'], ['NR', 'Ratings'], ['A5', 'Facts'], ['A6', 'Areas'], ['A7', 'On this platform since']]);
  assert.equal(about.A1.text, A1);
  assert.equal(about.A2.text, 'McCluster Corp, from Project Drawdown’s public pages and the research it publishes under CC BY 4.0.');
  assert.equal(about.A3.text, A3);
  assert.equal(about.A4.text, 'Written by McCluster Corp from Project Drawdown’s climate solutions. Project Drawdown did not write or post them.');
  assert.equal(about.NR.text, NR);
  assert.equal(kit.credit.ratings, NR, 'the same sentence in the credit');
  assert.equal(about.A6.text, 'The areas are this site’s own grouping of the missions, not Project Drawdown’s sectors.');
  assert.equal(kit.factsRead, 'Read from Project Drawdown’s own pages on ');
  assert.deepEqual(kit.changeNote, [
    'Project Drawdown, a creator named in a credit, or anyone acting for them can ask McCluster Corp to correct or remove anything on this page or in these missions’ credits.',
    'Write to McCluster Corp through its company page; its address is at the foot of that page. Say which page and what to correct or remove.'
  ]);
  assert.equal(kit.changeLink, 'McCluster Corp’s company page');
  assert.equal(kit.changeHref, 'https://mccluster.org/company');
  assert.equal(kit.areaNote, 'Grouped by this site; not Project Drawdown’s sectors.');
  const T = P.TEXT;
  assert.deepEqual([T.kicker, T.share, T.copied, T.close, T.back, T.about, T.change], ['Mission source', 'Share this page', 'Copied', 'Close', 'All areas', 'About this page', 'Ask for a change']);
  assert.deepEqual([T.unavailable, T.couldNotLoad, T.missionsFailed, T.tryAgain, T.noneOpen, T.areasFailed], ['That page is not available.', 'That page could not load right now.', 'These missions could not load right now.', 'Try again', 'None of these missions is open right now.', 'The areas could not load, so every mission is in one list, easiest first.']);
  assert.deepEqual([T.previewDraft, T.previewHidden, T.previewSignIn], ['Preview. This page is not public yet; only you can see it.', 'Preview. This page is hidden; only you can see it.', 'Sign in as the house owner to preview this page.']);
  assert.equal(T.doorLine, 'Every mission written from its solutions');
  /* the deny list matches exactly the four sentences, in the words above and in every string literal of the module */
  const allowed = new Set([S12, A1, A3, NR]);
  const hitsInWords = new Set(kitStrings(P.TEXT).concat(kitStrings(P.KITS)).filter((s) => W.denied(s)));
  assert.deepEqual([...hitsInWords].sort(), [...allowed].sort());
  const literals = stringLiterals(read(MODULE));
  assert.ok(literals.length > 150, 'the literals were read: ' + literals.length);
  assert.deepEqual([...new Set(literals.filter((s) => W.denied(s)))].sort(), [...allowed].sort());
  assert.ok(!W.denied(about.A3.term) && !W.denied(about.NR.term), 'every About term passes');
  /* not in the module at all */
  const src = read(MODULE);
  assert.doesNotMatch(src, /equity[\s_-]+uprise|human[\s_-]+uprise/i, 'the brand is never written in the page');
  assert.doesNotMatch(src, /Verified|Follow|Message|Claim/, 'no badge or account words');
  assert.doesNotMatch(src.toLowerCase(), new RegExp(PRIVATE_WORD));
  assert.doesNotMatch(src.toLowerCase(), /missions from this source/);
});

test('no logo, picture or monogram: the module draws nothing but text and the World\'s own icons', () => {
  const src = read(MODULE);
  for (const banned of ['<svg', 'createElementNS', '<canvas', 'getContext', '<picture', '<object', '<embed', '<iframe', '<img', 'background-image', 'url(', 'mask', 'clip-path', 'border-image', 'new Image', 'favicon', 'logo.']) {
    assert.ok(!src.includes(banned), `${banned} is not in the module`);
  }
  assert.doesNotMatch(src, /https?:\/\/[^'"\s]*\.(png|jpe?g|gif|webp|svg|avif)/i, 'no picture address');
});

test('D3: the README keeps the logo nowhere and nothing implying endorsement, and its name bullet names only the page heading and its door', () => {
  const readme = read('data/missions/drawdown/README.md').replace(/\s+/g, ' ');
  assert.match(readme, /The logo appears nowhere, and nothing implies endorsement\./);
  const rule = /- \*\*The name and the logo\.\*\* (.*?)\*\(2026-11-19: [^)]*\)\*/.exec(readme);
  assert.ok(rule, 'the name rule is its own dated bullet');
  assert.match(rule[1], /as the heading of that page and on its door in each Drawdown mission's dialog, only to identify the source\./);
  assert.match(rule[1], /Any other place for the name needs a new dated amendment\./);
  assert.match(rule[1], /a default adopted pending Matthew's confirmation/);
  assert.doesNotMatch(rule[1], /tab|menu|search|share card|company page/i, 'no other place is named');
});

test('the styles: mobile first, no picture of any kind, a gradient only on the sheet\'s own frame, the field at 16 px or more', () => {
  const css = read('css/world-source-profile.css');
  assert.doesNotMatch(css, /@media[^{]*max-width/, 'min-width queries only');
  for (const [, value] of css.matchAll(/grid-template(?:-columns|-rows)?\s*:\s*([^;}]*)/g)) {
    assert.doesNotMatch(value.replace(/minmax\(0,\s*1fr\)/g, ''), /(?<![\w.-])1fr\b/, `a bare 1fr: ${value}`);
  }
  for (const banned of [/url\(/i, /\bmask/i, /clip-path/i, /border-image/i, /background-image/i, /image-set/i, /element\(/i]) assert.doesNotMatch(css, banned, `${banned} is not in the styles`);
  for (const [, value] of css.matchAll(/(?<![\w-])content\s*:\s*([^;}]*)/g)) assert.match(value.trim(), /^(""|none)$/, `content: ${value}`);
  /* a gradient only in the sheet's own frame rule */
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
  const gradients = rules.filter((r) => /gradient\(/i.test(r.body));
  assert.ok(gradients.length >= 1);
  for (const r of gradients) assert.match(r.selector, /^#mnSourceDialog\.mn__thread$/, `a gradient outside the sheet's frame: ${r.selector}`);
  assert.match(css, /\.mn__source-input \{[^}]*font: 400 max\(16px, 1rem\)/, 'the search field never makes iOS zoom');
  assert.match(css, /#mnSourceDialog\.mn__thread\.mn__source\[open\] \{ display: flex; flex-direction: column; overflow: hidden; \}/, 'open, one flex column (the privacy bar stays in view)');
  assert.match(css, /#mnSourceDialog > #mccPrivacyNotice \{ flex: none; \}/);
  assert.match(css, /html\[data-daylight="day"\] #mnSourceDialog, html\[data-daylight="day"\] \.mn__source-door \{[^}]*--mn-gold: #7a5810;/, 'the day sheet\'s focus ring reads 6.5:1');
  assert.doesNotMatch(css, /equity[\s_-]+uprise|human[\s_-]+uprise/i);
});

test('the World wires it: the door after Join\'s status line, the sheet in <main class="mn">, the scripts after js/mnet.js, five small exports and three hook lines', () => {
  const html = read('mnet.html'), js = read('js/mnet.js');
  const dialogStart = html.indexOf('<dialog class="mn__thread" id="mnMissionDialog"'), dialogEnd = html.indexOf('</dialog>', dialogStart);
  const status = html.indexOf('<p class="mn__status" id="mnMissionDialogStatus" role="status"></p>'), door = html.indexOf('<div class="mn__source-door" id="mnMissionSource" hidden></div>');
  assert.ok(dialogStart > 0 && status > dialogStart && door > status && door < dialogEnd, 'the door is the last thing in the mission dialog, after Join and its status line');
  const detail = html.indexOf('<div id="mnMissionDetail"></div>');
  assert.ok(detail > dialogStart && detail < door, 'outside and after the mission\'s detail (and so its credit)');
  const sheet = html.indexOf('<dialog class="mn__thread mn__source" id="mnSourceDialog" aria-labelledby="mnSourceName" aria-describedby="mnSourceTrust"><div class="mn__source-body" id="mnSourceBody"></div></dialog>');
  const main = html.indexOf('<main class="mn">'), mainEnd = html.indexOf('</main>');
  assert.ok(sheet > dialogEnd && sheet > main && sheet < mainEnd, 'the sheet directly after the mission dialog, inside <main class="mn">');
  assert.equal(html.slice(dialogEnd, sheet).replace(/\s+/g, ''), '</dialog>');
  const page = html.indexOf('<script src="js/mnet.js?v=b51ede03a4fa"></script>'), words = html.indexOf('<script src="js/mission-source-words.js?v=b51ede03a4fa"></script>'), mod = html.indexOf('<script src="js/world-source-profile.js?v=b51ede03a4fa"></script>');
  assert.ok(page > 0 && words > page && mod > words, 'the words, then the page, after js/mnet.js');
  assert.ok(html.indexOf('<link rel="stylesheet" href="css/world-source-profile.css?v=b51ede03a4fa">') > html.indexOf('<link rel="stylesheet" href="css/world-gate.css?v=b51ede03a4fa">'));
  assert.equal((html.match(/world-source-profile/g) || []).length, 2, 'one stylesheet, one script');
  /* js/mnet.js: the five exports at the end of window.MCC_MNET */
  const api = js.slice(js.indexOf('  window.MCC_MNET = {'), js.indexOf('  };', js.indexOf('  window.MCC_MNET = {')));
  assert.match(api, /openMission: function \(id\) \{ id = String\(id \|\| ""\); if \(!\/\^\[0-9a-f-\]\{36\}\$\/i\.test\(id\)\) return Promise\.resolve\(\{ opened: false \}\); prepareWorldMission\(id\); return openMission\(id\); \},/);
  assert.match(api, /closeMission: function \(fromHistory\) \{ closeMission\(fromHistory === true\); \},/);
  assert.match(api, /notice: function \(text\) \{ state\.feedNotice = String\(text \|\| ""\); clearFeedStatus\(\); \},/);
  assert.match(api, /icon: function \(name\) \{ return Object\.prototype\.hasOwnProperty\.call\(ICON, name\) \? ICON\[name\] : Object\.prototype\.hasOwnProperty\.call\(PATH_ART, name\) \? PATH_ART\[name\] : ""; \},/);
  assert.match(api, /missionReturning: function \(\) \{ return !!missions\.returnHref; \}\s*$/);
  /* the hook right after the mission's detail is drawn, always through window. and never able to break the dialog */
  assert.match(js, /\$\("mnMissionDetail"\)\.innerHTML=missionDetailHtml\(m,state\.missionFeed\.details\[m\.id\]\|\|null\);\n      try\{if\(window\.MCC_SOURCE_PROFILE\)window\.MCC_SOURCE_PROFILE\.mission\(m,state\.missionFeed\.details\[m\.id\]\|\|null\);\}catch\(_\)\{\}\n/);
  assert.match(js, /    openGuestMissionLink\(\);\n    try \{ if \(window\.MCC_SOURCE_PROFILE\) window\.MCC_SOURCE_PROFILE\.landing\(\); \} catch \(_\) \{\}\n  \}/, 'the guest\'s landing');
  assert.match(js, /      openDeepLinkedMission\(\);\n      try \{ if \(window\.MCC_SOURCE_PROFILE\) window\.MCC_SOURCE_PROFILE\.landing\(\); \} catch \(_\) \{\}\n      openDeepLinkedGroup\(\);/, 'the member\'s landing');
  assert.equal((js.match(/MCC_SOURCE_PROFILE\.(mission|landing)\(/g) || []).length, 3);
  /* the module answers both hooks and draws only with the World's own icon and text */
  assert.equal(typeof P.mission, 'function');
  assert.equal(typeof P.landing, 'function');
});
