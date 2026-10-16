/* Missions: many pins, an origin, the policy arc, Black business on the map
   (owner mission curation, 2026-10-15). The SQL's behaviour is tested on a
   scratch Postgres (scripts/test-mission-pins-db.sh); this file holds the
   client contract and the pending file's promises. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL(`../../${p}`, import.meta.url), 'utf8');
const SQL_PATH = 'supabase/pending/20261015230000_action_mission_pins_arcs_black_business.sql';

test('the pending SQL names its sources, its rollback and its ordering hazards', async () => {
  const sql = await read(SQL_PATH);
  for (const must of [
    'ROLLBACK', 'Natural Earth', 'v5.1.2', 'Public domain', 'CLASS.xlsx', 'FY27', 'SP.POP.TOTL',
    'action_globe_demo_pins_v1.sql', '20261014170000_action_mission_curated_catalog_resources.sql',
    "join_scope text not null default 'anywhere'", 'Started by the Connecticut cohort',
    "'policy-reform'", 'Buy from a Black business', 'Put your Black business on the map'
  ]) assert.ok(sql.includes(must), `pending SQL mentions ${must}`);
  // never auto-verified: the submit function only ever inserts 'submitted'
  const submit = sql.slice(sql.indexOf('create or replace function public.submit_action_business_listing'), sql.indexOf('create or replace function public.withdraw_action_business_listing'));
  assert.doesNotMatch(submit, /'approved'/);
  assert.match(submit, /return jsonb_build_object\('id', v_id, 'status', 'submitted'\)/);
  // the review is the desk's
  assert.match(sql, /if \(select auth\.uid\(\)\) is null or not \(select public\.eu_is_admin\(\)\) then\s+raise exception 'only the desk reviews business listings'/);
  // no invented coordinates
  assert.match(sql, /p_pin_lat = 0 and p_pin_lon = 0/);
  // fifty countries, each with a label point and a Natural Earth feature id
  const rows = sql.match(/^ {2}\('[A-Z]{2}','[A-Z]{3}','[^']+(?:''[^']*)*','[A-Za-z ]+',-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,'[A-Z]{3}',\d+\),?$/gm) || [];
  assert.equal(rows.length, 50);
  assert.ok(!rows.some((r) => r.startsWith("  ('TW'")), 'Taiwan is an owner decision, not silently added');
});

function loadGroupPins(js) {
  const start = js.indexOf('function groupPins(rows)');
  assert.ok(start > -1, 'groupPins exists');
  const end = js.indexOf('\n/* approved Black businesses', start);
  return new Function(`${js.slice(start, end)}; return groupPins;`)();
}

test('the World draws every pin and lists each mission once', async () => {
  const js = await read('js/action-globe.js');
  const groupPins = loadGroupPins(js);
  const rows = [
    { mission_id: 't', title: 'Trace', region_key: 'US-CT', region_label: 'Connecticut', country_code: 'US', latitude: 41.6, longitude: -73.1, pin_role: 'origin', origin_label: 'Started by the Connecticut cohort' },
    { mission_id: 't', title: 'Trace', region_key: 'US', region_label: 'United States', country_code: 'US', latitude: 39.5, longitude: -97.5, pin_role: 'pin' },
    { mission_id: 't', title: 'Trace', region_key: 'DE', region_label: 'Germany', country_code: 'DE', latitude: 51, longitude: 9.7, pin_role: 'pin' },
    { mission_id: 't', title: 'Trace', region_key: 'CD-HK', region_label: 'Haut-Katanga', country_code: 'CD', latitude: -10.7, longitude: 27.5, pin_role: 'context' },
    { mission_id: 't', title: 'Trace', region_key: 'XX', region_label: 'Nowhere', latitude: null, longitude: null, pin_role: 'pin' },
    { mission_id: 'm', title: 'Memo', region_key: 'US-CT', region_label: 'Connecticut', latitude: 41.6, longitude: -73.1 }
  ];
  const out = groupPins(rows);
  assert.equal(out.length, 2, 'one entry per mission');
  const trace = out.find((m) => m.mission_id === 't');
  assert.equal(trace.pins.length, 4, 'a row without a point is dropped, never put at 0,0');
  assert.equal(trace.latitude, 41.6, 'the deck flies to the first pin: the origin');
  assert.equal(trace.region_label, '2 countries', 'context pins do not count toward reach');
  assert.equal(out.find((m) => m.mission_id === 'm').region_label, 'Connecticut', 'a one-pin mission keeps its region');
  assert.deepEqual(groupPins(null), []);
  // every pin opens its mission; the selection highlights by mission, not by entity order
  assert.match(js, /\(m\.pins\|\|\[m\]\)\.forEach\(p=>/);
  assert.match(js, /p\.properties\?\.missionIndex\?\.getValue\(\)===i\?1\.5:1/);
  assert.match(js, /rpc\('action_globe_public_business_pins'\)\.then\(/);
  assert.match(js, /!\(b\.latitude===0&&b\.longitude===0\)/);
});

test('mission cards: origin, next step and the business CTA come from data, and stay silent until applied', async () => {
  const js = await read('js/mnet.js');
  assert.match(js, /sbRpc\("action_mission_card_extras",\{\}\)\.catch\(function\(\)\{return \[\];\}\)/);
  assert.match(js, /Next in this arc: '\+esc\(x\.next_mission_title\)/);
  assert.match(js, /x\.cta_key==="business_listing"/);
  assert.match(js, /sbRpc\("submit_action_business_listing",/);
  assert.match(js, /A reviewer checks it before it goes on the map\./);
  // the copy never claims the owner's own path as a product promise
  assert.doesNotMatch(js, /Urban Leadership Fellowship/);
  const css = await read('css/mnet.css');
  const block = css.slice(css.indexOf('/* Put your Black business on the map'));
  assert.doesNotMatch(block, /max-width:\s*\d+px\)/, 'no max-width media queries');
});
