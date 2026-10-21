import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('World member counts use a separate explicit and revocable sharing table', () => {
  const sql = read('supabase/migrations/20261021173902_world_region_sharing_v1.sql');
  assert.match(sql, /create table if not exists public\.world_region_sharing/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /world_region_sharing_set/);
  assert.match(sql, /world_region_sharing_clear/);
  assert.match(sql, /world_public_member_counts/);
  assert.match(sql, /having count\(\*\) >= 5/g);
  assert.doesNotMatch(sql, /action_globe_member_regions/);
});

test('account setting is off by default, coarse, and never asks for precise location', () => {
  const page = read('account.html'), client = read('js/world-region-sharing.js');
  assert.match(page, /id="worldRegionShare"/);
  assert.match(page, /street address, precise location and IP location are never used/);
  assert.match(page, /at least five members/);
  assert.match(client, /world_region_sharing_get/);
  assert.match(client, /world_region_sharing_set/);
  assert.match(client, /world_region_sharing_clear/);
  assert.match(client, /data\/geo\/country-label-points\.json/);
  assert.match(client, /data\/geo\/world-state-areas\//);
  assert.doesNotMatch(client, /geolocation|fnAddr|fan_profiles|MCC_LOCATION/);
});

test('World card member counts come only from the public suppressed sharing aggregate', () => {
  const worker = read('workers/mccluster/src/world-news-discovery.js');
  const countries = read('js/world-countries.js');
  assert.match(worker, /serviceRpc\(env, 'world_public_member_counts'/);
  assert.match(worker, /members: members \? members\.countries : null/);
  assert.match(countries, /st\.members = data && data\.members/);
  assert.match(countries, /Number\(st\.members\[a2\]\) >= 5/);
  assert.match(countries, /Number\(st\.memberRegions\[sp\.key\]\) >= 5/);
  assert.doesNotMatch(countries, /r\.member_count/);
});

test('place scope is enabled only after the exact production migration is reconciled', () => {
  const wrangler = read('workers/mccluster/wrangler.toml');
  const ledger = JSON.parse(read('supabase/production-ledger.json'));
  assert.match(wrangler, /WORLD_PLACE_SCOPE_ENABLED = "true"/);
  assert.ok(ledger.migrations.some((m) => m.version === '20261021173729' && m.name === 'world_place_scope_v1'));
  assert.ok(ledger.migrations.some((m) => m.version === '20261021173902' && m.name === 'world_region_sharing_v1'));
  assert.equal(ledger.migration_count, 339);
});
