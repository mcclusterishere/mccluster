import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('internal no-JWT shared secrets use the fixed-width helper', async () => {
  const helper = await read('supabase/functions/_shared/secret-match.ts');
  assert.match(helper, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(helper, /diff \|=/);

  const targets = [
    'eu-worker',
    'eu-external-worker',
    'eu-monitor',
    'eu-ddex-worker',
    'eu-crossref-callback',
    'eu-google-workspace',
    'm-oauth-bootstrap',
  ];
  for (const name of targets) {
    const src = await read(`supabase/functions/${name}/index.ts`);
    assert.match(src, /secretMatches/);
    assert.doesNotMatch(
      src,
      /(?:given|u\.searchParams\.get\("nonce"\)|req\.headers\.get\([^)]*\))\s*!==\s*(?:SECRET|WORKER_SECRET|INTERNAL_SECRET|NONCE)/,
    );
  }
});

test('Level 3 login validates and exact-matches McCluster IDs', async () => {
  const src = await read('supabase/functions/l3-login/index.ts');
  assert.match(src, /\^\[a-z0-9\]\[a-z0-9\._-\]\{2,31\}\$/);
  assert.match(src, /mccluster_id=eq\.\$\{encodeURIComponent\(mcclusterId\)\}/);
  assert.doesNotMatch(src, /mccluster_id=ilike/);
});

test('the two live security re-audit migrations are canonical files', async () => {
  const grants = await read('supabase/migrations/20261005082148_security_reaudit_execute_grants_v1.sql');
  const bodies = await read('supabase/migrations/20261005082220_security_reaudit_function_bodies_v1.sql');

  assert.match(grants, /revoke execute on function public\.kb_search\(text, vector, integer, integer\)/i);
  assert.match(grants, /revoke execute on function public\.mnet_follow_admins\(uuid\)/i);
  assert.match(grants, /revoke execute on function public\.mnet_is_blocked_pair\(uuid, uuid\)/i);
  assert.match(grants, /alter function public\.mccluster_id_problem\(text\) set search_path = ''/i);

  assert.match(bodies, /alter function public\.eu_log\(text, text, text, jsonb\) security invoker/i);
  assert.match(bodies, /p_profile = auth\.uid\(\)/i);
  assert.match(bodies, /visibility = 'public' and v\.status = 'active'/i);
});

test('production ledger and Core drift contract agree at migration 263', async () => {
  const ledger = JSON.parse(await read('supabase/production-ledger.json'));
  const drift = JSON.parse(await read('core/drift-contract.json'));
  assert.equal(ledger.migration_count, 263);
  assert.equal(ledger.latest_version, '20261005082220');
  assert.equal(ledger.latest_name, 'security_reaudit_function_bodies_v1');
  assert.equal(ledger.ledger_sha256, 'de94f2ba5ad18e4be2c43dbc78a41411271de2e23341c5d9114d9a746a998f64');
  assert.deepEqual(drift.supabase, {
    project_ref: ledger.project_ref,
    migration_count: ledger.migration_count,
    latest_version: ledger.latest_version,
    latest_name: ledger.latest_name,
    ledger_sha256: ledger.ledger_sha256,
  });
});
