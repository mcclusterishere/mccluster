import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
test('region opt-in stays separate from latest-sign-in account counts', () => {
 const sql=read('supabase/migrations/20261021173902_world_region_sharing_v1.sql');
 const ui=read('account.html'),client=read('js/world-region-sharing.js');
 const worker=read('workers/mccluster/src/world-news-discovery.js'),globe=read('js/world-countries.js');
 assert.match(sql,/force row level security/);
 assert.match(sql,/world_region_sharing_clear/);
 assert.match(sql,/having count\(\*\) >= 5/g);
 assert.match(ui,/id="worldRegionShare"/);
 assert.match(ui,/separate from the account counts based on sign-ins/);
 assert.match(client,/world_region_sharing_set/);
 assert.match(client,/world_region_sharing_clear/);
 assert.doesNotMatch(client.replace(/\/\*[\s\S]*?\*\//g,''),/geolocation|fnAddr|fan_profiles|MCC_LOCATION/);
 assert.match(worker,/serviceRpc\(env, 'world_public_member_counts'/);
 assert.match(worker,/shared_countries:/);
 assert.match(globe,/opted in to region sharing/);
 assert.match(globe,/\/v1\/world\/members/);
});
test('named legacy subdivisions have stable, bounded scoped identifiers', () => {
 const w={};vm.runInNewContext(read('js/world-region-scope.js'),{window:w});
 const f=w.MCC_WORLD_REGION_SCOPE.code;
 assert.equal(f('US','US-CT'),'US-CT');
 for(const [c,k] of [['GB','GB:England'],['FR','FR:Bretagne'],['IT','IT:Emilia-Romagna']]){
  assert.match(f(c,k),/^[A-Z]{2}-[A-Z0-9]{1,8}$/);
  assert.equal(f(c,k),f(c,k));
 }
 assert.equal(f('AE','AE-~0'),null);
 assert.equal(f('GB','US-CT'),null);
});
test('current canonical migrations and 341-entry ledger are preserved', () => {
 const ledger=JSON.parse(read('supabase/production-ledger.json'));
 const wrangler=read('workers/mccluster/wrangler.toml');
 assert.equal(ledger.migration_count,341);
 assert.equal(ledger.latest_version,'20261022005028');
 assert.ok(ledger.migrations.some(m=>m.version==='20261021173729' && m.name==='world_place_scope_v1'));
 assert.ok(ledger.migrations.some(m=>m.version==='20261021173902' && m.name==='world_region_sharing_v1'));
 assert.match(wrangler,/WORLD_PLACE_SCOPE_ENABLED = "true"/);
});
