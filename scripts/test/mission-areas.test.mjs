/* THIS SITE'S AREAS FOR THE DRAWDOWN CATALOG: data/missions/drawdown-areas.json (tools/build-mission-areas.mjs). The catalog
   folder stays out of the published site (D10, docs/control-plane/WORLD-MISSION-SOURCES.md: a default adopted pending Matthew's
   confirmation); the World's source page reads this small map instead. It holds:
   - the committed map is the catalog's (--check);
   - only the catalog's slugs, all 125, each under its own area; the nine area names in order of size, then name;
   - no other text: no title, description, quotation, credit, address or image; under 8 KB; outside the unpublished folder;
   - the page's grouping of the real catalog: nine areas of 21, 21, 19, 17, 14, 12, 11, 8 and 2, and the credit's counts
     (87 quote, 43 cite CC BY, 40 both, 35 name only).
     node --test scripts/test/mission-areas.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildAreaMap, renderAreaMap, MAP_PATH, CATALOG_PATH } from '../../tools/build-mission-areas.mjs';
import { missionRow, detailsRow } from '../../tools/build-mission-import.mjs';

const require = createRequire(import.meta.url);
const P = require('../../js/world-source-profile.js');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const CATALOG = JSON.parse(read(CATALOG_PATH));
const NAMES = ['Buildings', 'Transportation', 'Food & farming', 'Electricity', 'Industry & waste', 'Oceans & coasts', 'Nature', 'Carbon removal', 'Energy & methane'];

test('the committed map is the catalog\'s: --check passes and the text is what the tool writes', () => {
  assert.equal(MAP_PATH, 'data/missions/drawdown-areas.json');
  const r = spawnSync(process.execPath, ['tools/build-mission-areas.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(read(MAP_PATH), renderAreaMap(buildAreaMap(CATALOG)));
});

test('only the catalog\'s slugs, all 125, each under its own area, and the nine names', () => {
  const map = JSON.parse(read(MAP_PATH));
  assert.deepEqual(Object.keys(map), ['schema', 'catalog', 'generated_from', 'grouping', 'areas', 'slugs']);
  assert.equal(map.schema, 'mission-areas/v1');
  assert.equal(map.catalog, 'drawdown');
  assert.equal(map.generated_from, CATALOG_PATH);
  assert.equal(map.grouping, "This site's own grouping of the missions; not a source's sectors.");
  assert.deepEqual(map.areas, NAMES);
  const slugs = CATALOG.missions.map((m) => m.slug).sort();
  assert.equal(slugs.length, 125);
  assert.deepEqual(Object.keys(map.slugs), slugs, 'every catalog slug, sorted, and nothing else');
  for (const m of CATALOG.missions) assert.equal(map.areas[map.slugs[m.slug]], m.sector, m.slug);
  assert.throws(() => buildAreaMap({ missions: [{ slug: 'drawdown-a', sector: 'Buildings' }, { slug: 'drawdown-a', sector: 'Nature' }] }), /twice/);
  assert.throws(() => buildAreaMap({ missions: [{ slug: 'drawdown-a' }] }), /no usable area/);
  assert.throws(() => buildAreaMap({ missions: [] }), /no missions/);
});

test('no other text: no title, description, quotation, credit, address or picture; small; outside the unpublished folder', () => {
  const text = read(MAP_PATH), map = JSON.parse(text);
  assert.ok(Buffer.byteLength(text) < 8192, `under 8 KB: ${Buffer.byteLength(text)}`);
  assert.doesNotMatch(text, /https?:|drawdown\.org|zenodo|©|\.(png|jpe?g|webp|svg)/i);
  const words = new Set(JSON.stringify(map).match(/"[^"]*"/g).map((s) => JSON.parse(s)));
  const allowed = new Set(['schema', 'catalog', 'generated_from', 'grouping', 'areas', 'slugs', map.schema, map.catalog, map.generated_from, map.grouping, ...NAMES, ...Object.keys(map.slugs)]);
  assert.deepEqual([...words].filter((w) => !allowed.has(w)), [], 'no string beyond the head, the area names and the slugs');
  for (const m of CATALOG.missions) {
    assert.ok(!text.includes(m.title), `no title: ${m.title}`);
    if (m.about) assert.ok(!text.includes(m.about.slice(0, 40)), `no quotation: ${m.slug}`);
  }
  /* the folder the export leaves out (scripts/stage-cloudflare-pages.mjs, forbiddenPrefixes) does not hold the map */
  const stage = read('scripts/stage-cloudflare-pages.mjs');
  const prefixes = /forbiddenPrefixes = new Set\(\[([^\]]*)\]\)/.exec(stage);
  assert.ok(prefixes, 'the stage script still names its forbidden prefixes');
  for (const p of prefixes[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1))) assert.ok(!MAP_PATH.startsWith(p), `${MAP_PATH} is not under ${p}`);
  assert.ok(statSync(new URL(`../../${MAP_PATH}`, import.meta.url)).isFile());
});

test('the page\'s grouping of the real catalog: nine areas, most first, and the credit\'s counts', () => {
  const rows = CATALOG.missions.map((m) => ({ ...missionRow(m), status: 'open', action_mission_details: detailsRow(m) }));
  const missions = P.cleanMissions(rows, 'drawdown');
  assert.equal(missions.length, 125);
  const map = P.readAreaMap(JSON.parse(read(MAP_PATH)), 'drawdown');
  assert.ok(map, 'the page accepts the map');
  const groups = P.groupMissions(missions, map);
  assert.deepEqual(groups.map((g) => [g.name, g.count]), [['Buildings', 21], ['Transportation', 21], ['Food & farming', 19], ['Electricity', 17], ['Industry & waste', 14], ['Oceans & coasts', 12], ['Nature', 11], ['Carbon removal', 8], ['Energy & methane', 2]]);
  assert.ok(groups.every((g) => !g.other && g.sample.length === 2 && g.missions.every((m, i, a) => i === 0 || (a[i - 1].difficulty || 99) <= (m.difficulty || 99))), 'easiest first in every area');
  assert.deepEqual(P.creditCounts(missions), { quote: 87, licence: 43, both: 40, nameOnly: 35, total: 125 });
  /* the drafts as the house owner's session would see them: none drawn */
  assert.equal(P.cleanMissions(CATALOG.missions.map((m) => ({ ...missionRow(m), action_mission_details: detailsRow(m) })), 'drawdown').length, 0, 'the 125 as the import wrote them (drafts)');
});
