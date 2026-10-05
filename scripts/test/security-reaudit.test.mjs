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
  const password = src.indexOf('grant_type=password');
  const access = src.indexOf("error:'not_authorized'");
  assert.ok(password > 0 && access > password,
    'app access is checked after the password, so a 403 cannot confirm that an account exists');
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

test('production ledger and Core drift contract agree, and carry the re-audit migrations', async () => {
  /* Not pinned to a count or hash: the next migration must be able to land
     without editing this file. drift-contract-check recomputes the hash. */
  const ledger = JSON.parse(await read('supabase/production-ledger.json'));
  const drift = JSON.parse(await read('core/drift-contract.json'));
  const names = ledger.migrations.map((m) => `${m.version}_${m.name}`);
  assert.ok(names.includes('20261005082148_security_reaudit_execute_grants_v1'));
  assert.ok(names.includes('20261005082220_security_reaudit_function_bodies_v1'));
  assert.equal(ledger.migration_count, ledger.migrations.length);
  assert.deepEqual(drift.supabase, {
    project_ref: ledger.project_ref,
    migration_count: ledger.migration_count,
    latest_version: ledger.latest_version,
    latest_name: ledger.latest_name,
    ledger_sha256: ledger.ledger_sha256,
  });
});

/* Run the helper rather than only grepping for it. secret-match.ts is plain
   WebCrypto once its type annotations are dropped, so the body is lifted out
   and executed under Node. */
async function loadSecretMatches() {
  const src = await read('supabase/functions/_shared/secret-match.ts');
  const start = src.indexOf('export async function secretMatches(');
  assert.ok(start >= 0, 'the shared constant-time helper exists');
  const open = src.indexOf('{', src.indexOf('): Promise<boolean>', start));
  const close = src.lastIndexOf('\n}');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  return new AsyncFunction('provided', 'expected', src.slice(open + 1, close));
}

test('secretMatches accepts only the exact secret and refuses an unset one', async () => {
  const secretMatches = await loadSecretMatches();
  assert.equal(await secretMatches('s3cret-value', 's3cret-value'), true);
  assert.equal(await secretMatches('s3cret-valuf', 's3cret-value'), false);
  assert.equal(await secretMatches('s3cret', 's3cret-value'), false);
  assert.equal(await secretMatches('', ''), false, 'an unset secret must not match an empty header');
  assert.equal(await secretMatches(null, 'x'), false);
  assert.equal(await secretMatches('x', undefined), false);
  assert.equal(await secretMatches('x'.repeat(5000), 'x'.repeat(5000)), false, 'oversized input is refused before hashing');
});

test('every verify_jwt=false function has a recorded compensating control', async () => {
  const config = await read('supabase/config.toml');
  const open = [...config.matchAll(/\[functions\.([a-z0-9-]+)\]\s*\nverify_jwt = false/g)].map((m) => m[1]);
  assert.ok(open.length >= 27, `expected the full public/webhook set, saw ${open.length}`);
  const posture = await read('docs/control-plane/SECURITY-POSTURE.md');
  const start = posture.indexOf('## Compensating controls, function by function');
  assert.ok(start >= 0, 'the posture doc keeps a per-function table');
  const table = posture.slice(start, posture.indexOf('\n## ', start + 4));
  for (const fn of open) {
    assert.match(table, new RegExp('`' + fn + '`'),
      `${fn} runs without a gateway JWT; record its control in SECURITY-POSTURE.md`);
  }
});
