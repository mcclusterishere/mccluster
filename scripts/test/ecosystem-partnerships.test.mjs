import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(p)=>readFile(p,'utf8');

test('Heat Chart has one broad McCluster community room plus its existing authenticity service room',async()=>{
  const [migration,oldMigration,brands,mnet]=await Promise.all([
    read('supabase/migrations/20261006235944_adaptive_production_policy_v1.sql'),
    read('supabase/migrations/20261002173558_action_network_organizations_authenticity_v1.sql'),
    read('data/brands.json'),
    read('js/mnet.js')
  ]);
  assert.match(migration,/'heat-chart','The Heat Chart','brand'/);
  assert.match(migration,/'heat-chart','The Heat Chart'[\s\S]*'community','https:\/\/theheatchart\.com'/);
  assert.match(oldMigration,/'heat-chart-authenticity'/);
  assert.match(brands,/"network_group":\s*"heat-chart"/);
  assert.match(brands,/mnet\.html\?group=heat-chart/);
  assert.match(mnet,/openGroup\(targetSlug\)/);
  assert.match(mnet,/data-ecosystem-exit/);
  assert.match(mnet,/ecosystem_bridge_open/);
});

test('music partner destinations require disclosure for material relationships and stay outside rank',async()=>{
  const [migration,engine,router,protocol]=await Promise.all([
    read('supabase/migrations/20261006235944_adaptive_production_policy_v1.sql'),
    read('js/music-engine.js'),
    read('workers/mccluster/src/music/router.js'),
    read('docs/research/PROTOCOL-002-PRODUCTION-POLICY-V1.md')
  ]);
  assert.match(migration,/create table if not exists public\.music_credit_destinations/);
  assert.match(migration,/check \(not material_connection or char_length\(trim\(disclosure_text\)\) > 0\)/);
  assert.match(router,/\/v1\/music\/credits/);
  assert.match(router,/music_credit_destinations/);
  assert.match(router,/mnet\.html\?group=/);
  assert.match(engine,/musicNowPartners/);
  assert.match(engine,/Sponsored \/ paid relationship/);
  assert.match(engine,/music_partner_open/);
  assert.match(protocol,/paid relationship never adds recommendation score/i);
});

test('Production Policy v1 has no sponsorship input feature',async()=>{
  const [router,migration]=await Promise.all([
    read('workers/mccluster/src/experience/router.js'),
    read('supabase/migrations/20261006235944_adaptive_production_policy_v1.sql')
  ]);
  const vector=router.slice(router.indexOf('function featureVector'),router.indexOf('async function hmacHex'));
  assert.doesNotMatch(vector,/sponsor|material_connection|paid_cents|payment_amount/i);
  assert.match(router,/commercial_relationship_excluded_from_rank/);
  assert.match(migration,/Material sponsorship\/brand connection does not affect ranking score/);
  assert.match(migration,/"business_priority":0\.05/);
});
