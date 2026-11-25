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
 const page=read('js/mnet.js');
 assert.match(page,/opted in to region sharing/);
 assert.match(page,/sharing: n\(s.sharing\)/);
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
test('the production ledger still lists the region-sharing and place-scope migrations', () => {
 const ledger=JSON.parse(read('supabase/production-ledger.json'));
 const wrangler=read('workers/mccluster/wrangler.toml');
 assert.equal(ledger.migration_count, ledger.migrations.length);
 assert.ok(ledger.migration_count >= 341, 'main\'s later migrations stay; the earlier 341-entry floor is not rolled back');
 assert.ok(ledger.migrations.some(m=>m.version==='20261021173729' && m.name==='world_place_scope_v1'));
 assert.ok(ledger.migrations.some(m=>m.version==='20261021173902' && m.name==='world_region_sharing_v1'));
 assert.match(wrangler,/WORLD_PLACE_SCOPE_ENABLED = "true"/);
});

/* The public member_count on this branch is the number of voluntary opt-ins in
   world_region_sharing, not sign-in visits. A region is listed only at five or more. */
function publicMemberCounts(rows) {
  const countries = new Map(), subdivisions = new Map();
  for (const r of rows) {
    const c = r.country_code, sub = r.subdivision_code || null;
    countries.set(c, (countries.get(c) || 0) + 1);
    if (sub) {
      const k = c + '\0' + sub;
      subdivisions.set(k, (subdivisions.get(k) || 0) + 1);
    }
  }
  const out = [];
  for (const [c, n] of countries) if (n >= 5) out.push({ scope_key: c, country_code: c, subdivision_code: null, member_count: n });
  for (const [k, n] of subdivisions) {
    if (n < 5) continue;
    const [c, sub] = k.split('\0');
    out.push({ scope_key: sub, country_code: c, subdivision_code: sub, member_count: n });
  }
  return out;
}

test('voluntary region shares are the member_count in world_public_member_counts', () => {
  const sql=read('supabase/migrations/20261021173902_world_region_sharing_v1.sql');
  const fn = sql.slice(sql.indexOf('create or replace function public.world_public_member_counts()'), sql.indexOf('revoke all on function public.world_region_sharing_get()'));
  assert.match(fn, /count\(\*\)::bigint as member_count/);
  assert.equal([...fn.matchAll(/from public\.world_region_sharing s/g)].length, 2);
  assert.doesNotMatch(fn, /fan_profiles|sign[_-]?in|last_seen|world_members|network_accounts/i);
  assert.match(fn, /having count\(\*\) >= 5/g);

  const kenya19 = Array.from({ length: 19 }, (_, i) => ({ country_code: 'KE', subdivision_code: i < 6 ? 'KE-30' : null }));
  const france3 = Array.from({ length: 3 }, () => ({ country_code: 'FR', subdivision_code: null }));
  const rows = publicMemberCounts([...kenya19, ...france3]);
  const ke = rows.find((r) => r.country_code === 'KE' && r.subdivision_code === null);
  const ke30 = rows.find((r) => r.subdivision_code === 'KE-30');
  const fr = rows.find((r) => r.country_code === 'FR');
  assert.equal(ke.member_count, 19, 'nineteen voluntary Kenya shares are the public member total');
  assert.equal(ke30.member_count, 6, 'the six who also named a county are counted there too');
  assert.equal(fr, undefined, 'three French opt-ins stay hidden under the five-person floor');

  const page=read('js/mnet.js');
  assert.match(page, /sharing: n\(s.sharing\)/);
  assert.match(page, /opted in to region sharing/);
  const globe=read('js/world-countries.js');
  assert.match(globe, /const sharing = Number\(shared\) >= 5 \? Number\(shared\) : null/);
  assert.match(globe, /opted in to region sharing/);
});
