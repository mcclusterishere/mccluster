/* Edge Function deploys must not depend on a migration riding along.
   #370 changed only l3-login and pay-now; the Supabase integration failed on
   that merge ("Remote migration versions not found in local migrations
   directory") and production kept serving the old code until an unrelated
   migration merge. These tests pin the replacement: a function-only push
   plans a deploy, shared code fans out to its importers, an undeclared
   function is refused, and without a deploy token a skipped or failed
   integration turns the run red instead of passing quietly. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseDeclaredFunctions, planDeploy, affectedShared, integrationVerdict, gate, verifyDeployed, chooseBase
} from '../supabase-functions-deploy.mjs';

const read = (p) => readFile(p, 'utf8');

function repo({ toml, files }) {
  const sources = new Map(Object.entries(files));
  const existing = new Set([...sources.keys()].filter((p) => /^supabase\/functions\/[^_/][^/]*\/index\.ts$/.test(p)).map((p) => p.split('/')[2]));
  return { declared: parseDeclaredFunctions(toml), existing, sources };
}

const TOML = `
[api]
enabled = true

[functions.pay-now]
# retired in code
verify_jwt = false

[functions.l3-login]
verify_jwt = false

[functions.eu-worker]
verify_jwt = false

[functions.music-access]
verify_jwt = true

[functions.stale]
`;
const FILES = {
  'supabase/functions/pay-now/index.ts': 'Deno.serve(() => new Response("gone", { status: 410 }));',
  'supabase/functions/l3-login/index.ts': 'Deno.serve(() => new Response("ok"));',
  'supabase/functions/eu-worker/index.ts': 'import { secretMatches } from "../_shared/secret-match.ts";',
  'supabase/functions/music-access/index.ts': "import { owner } from '../_shared/authz.ts';",
  'supabase/functions/undeclared/index.ts': 'Deno.serve(() => new Response("x"));',
  'supabase/functions/_shared/secret-match.ts': 'export function secretMatches() {}',
  'supabase/functions/_shared/authz.ts': 'import { secretMatches } from "./secret-match.ts";',
  'supabase/functions/_shared/unused.ts': 'export const x = 1;'
};

test('config.toml stanzas are read whole, with verify_jwt defaulting to true like the CLI', () => {
  const declared = parseDeclaredFunctions(TOML);
  assert.deepEqual([...declared.keys()], ['pay-now', 'l3-login', 'eu-worker', 'music-access', 'stale']);
  assert.equal(declared.get('pay-now').verify_jwt, false, 'a comment between header and setting does not hide it');
  assert.equal(declared.get('music-access').verify_jwt, true);
  assert.equal(declared.get('stale').verify_jwt, true);
});

test('a function-only push plans a deploy without any migration (the #370 merge)', () => {
  const plan = planDeploy({
    changedPaths: [
      'docs/control-plane/PROGRAM-LEDGER.md', 'docs/control-plane/SECURITY-POSTURE.md', 'scripts/test/security-reaudit.test.mjs',
      'supabase/functions/l3-login/index.ts', 'supabase/functions/pay-now/index.ts'
    ],
    ...repo({ toml: TOML, files: FILES })
  });
  assert.deepEqual(plan.functions, ['l3-login', 'pay-now']);
  assert.deepEqual(plan.undeclared, []);
  assert.deepEqual(plan.reasons['pay-now'], ['own files changed']);
});

test('a migration-only or docs-only push deploys nothing', () => {
  const plan = planDeploy({ changedPaths: ['supabase/migrations/20261005212323_x.sql', 'README.md', 'supabase/production-ledger.json'], ...repo({ toml: TOML, files: FILES }) });
  assert.deepEqual(plan.functions, []);
});

test('shared code redeploys every importer, following shared files that import each other', () => {
  const state = repo({ toml: TOML, files: FILES });
  const shared = affectedShared(['supabase/functions/_shared/secret-match.ts'], state.sources);
  assert.ok(shared.has('supabase/functions/_shared/authz.ts'), 'authz.ts imports ./secret-match.ts');
  const plan = planDeploy({ changedPaths: ['supabase/functions/_shared/secret-match.ts'], ...state });
  assert.deepEqual(plan.functions, ['eu-worker', 'music-access']);
  assert.match(plan.reasons['music-access'][0], /_shared\/authz\.ts/);
  const none = planDeploy({ changedPaths: ['supabase/functions/_shared/unused.ts'], ...state });
  assert.deepEqual(none.functions, [], 'an unimported shared file deploys nothing');
});

test('a config.toml change redeploys every declared function that exists', () => {
  const plan = planDeploy({ changedPaths: ['supabase/config.toml'], ...repo({ toml: TOML, files: FILES }) });
  assert.deepEqual(plan.functions, ['eu-worker', 'l3-login', 'music-access', 'pay-now']);
});

test('an undeclared function is refused and a deleted one is never pruned', () => {
  const plan = planDeploy({
    changedPaths: ['supabase/functions/undeclared/index.ts', 'supabase/functions/gone/index.ts'],
    ...repo({ toml: TOML, files: FILES })
  });
  assert.deepEqual(plan.undeclared, ['undeclared'], 'deploying it would fall back to the CLI default verify_jwt');
  assert.deepEqual(plan.functions, []);
  assert.deepEqual(plan.deleted, ['gone']);
});

test('the real repo: every function is declared, and #369’s shared change reaches all seven secret-match importers', async () => {
  const toml = await read('supabase/config.toml');
  const declared = parseDeclaredFunctions(toml);
  const { readdir } = await import('node:fs/promises');
  const dirs = (await readdir('supabase/functions', { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name);
  assert.deepEqual(dirs.filter((d) => !declared.has(d)), [], 'every function directory has a [functions.<name>] stanza');
  const files = {};
  for (const d of [...dirs, '_shared']) {
    for (const f of await readdir(`supabase/functions/${d}`)) if (/\.ts$/.test(f)) files[`supabase/functions/${d}/${f}`] = await read(`supabase/functions/${d}/${f}`);
  }
  const plan = planDeploy({ changedPaths: ['supabase/functions/_shared/secret-match.ts'], ...repo({ toml, files }) });
  for (const fn of ['eu-worker', 'eu-external-worker', 'eu-monitor', 'eu-ddex-worker', 'eu-crossref-callback', 'eu-google-workspace', 'm-oauth-bootstrap']) {
    assert.ok(plan.functions.includes(fn), `${fn} imports _shared/secret-match.ts`);
  }
});

test('a push plans from the last successful run, so a cancelled or failed push is not skipped', () => {
  /* A deploys; B waits; C arrives and GitHub cancels B. C must cover B's
     functions too, so it plans from A (the last success), not from B. */
  const A = 'a'.repeat(40), B = 'b'.repeat(40);
  const isAncestor = (sha) => sha === A || sha === B;
  assert.deepEqual(chooseBase({ lastSuccess: A, isAncestor }), { base: A, from: 'last successful deploy run' });
  const merged = planDeploy({
    changedPaths: ['supabase/functions/l3-login/index.ts', 'supabase/functions/pay-now/index.ts'],
    ...repo({ toml: TOML, files: FILES })
  });
  assert.deepEqual(merged.functions, ['l3-login', 'pay-now'], 'B’s l3-login and C’s pay-now both deploy in C’s run');
});

test('with no usable successful run, every declared function is planned (fail closed)', () => {
  /* First run failed or was cancelled, the run history could not be read,
     or history was rewritten: nothing proves an earlier push reached
     production, so the previous push's `before` is not trusted. */
  const isAncestor = (sha) => sha === 'a'.repeat(40);
  for (const lastSuccess of ['', 'c'.repeat(40)]) {
    const choice = chooseBase({ lastSuccess, isAncestor });
    assert.equal(choice.base, '', `lastSuccess=${lastSuccess || '(none)'} must not fall back to this push`);
    assert.match(choice.from, /^no usable baseline/);
  }
  const unknown = gate({ functions: ['l3-login', 'pay-now', 'eu-worker'], verdict: { state: 'failure', summary: 'Remote migration versions not found in local migrations directory.' }, hasToken: false, baseline: 'unknown' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.message, /^UNVERIFIED: no earlier successful run proves/);
  assert.match(unknown.message, /Any of these 3 declared functions may be serving old code/);
  assert.equal(gate({ functions: ['l3-login'], verdict: { state: 'success' }, hasToken: false, baseline: 'unknown' }).ok, true, 'an integration success still establishes a baseline');
  assert.equal(gate({ functions: ['l3-login'], verdict: { state: 'failure' }, hasToken: true, baseline: 'unknown' }).ok, true, 'with a token every declared function is deployed and proven');
});

test('the integration verdict reads the Supabase app’s check, newest first', () => {
  assert.equal(integrationVerdict([]).state, 'missing');
  const runs = [
    { app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' },
    { app: { slug: 'supabase' }, status: 'completed', conclusion: 'failure', started_at: '2026-10-05T21:39:34Z', output: { summary: '```\nRemote migration versions not found in local migrations directory.\n```' } }
  ];
  const v = integrationVerdict(runs);
  assert.equal(v.state, 'failure');
  assert.equal(v.summary, 'Remote migration versions not found in local migrations directory.');
  assert.equal(integrationVerdict([{ app: { slug: 'supabase' }, status: 'in_progress' }]).state, 'pending');
  assert.equal(integrationVerdict([{ app: { slug: 'supabase' }, status: 'completed', conclusion: 'skipped' }]).state, 'skipped');
});

test('without a deploy token, only a successful integration passes; skipped or failed is red and names what is stale', () => {
  const functions = ['l3-login', 'pay-now'];
  const failed = gate({ functions, verdict: { state: 'failure', summary: 'Remote migration versions not found in local migrations directory.' }, hasToken: false });
  assert.equal(failed.ok, false);
  assert.match(failed.message, /NOT DEPLOYED: l3-login, pay-now/);
  assert.match(failed.message, /Remote migration versions not found/);
  assert.match(failed.message, /SUPABASE_ACCESS_TOKEN/);
  for (const state of ['skipped', 'missing', 'timed_out', 'cancelled']) assert.equal(gate({ functions, verdict: { state }, hasToken: false }).ok, false, state);
  const passed = gate({ functions, verdict: { state: 'success' }, hasToken: false });
  assert.equal(passed.ok, true);
  assert.equal(passed.level, 'warning', 'trusted, not verified');
  assert.equal(gate({ functions, verdict: { state: 'failure' }, hasToken: true }).ok, true, 'with a token the workflow deploys itself');
  assert.equal(gate({ functions, verdict: { state: 'missing' }, hasToken: false, manual: true }).ok, false);
  assert.equal(gate({ functions: [], verdict: { state: 'failure' }, hasToken: false }).ok, true);
});

test('a CLI deploy is proven live: listed, updated after the deploy began, verify_jwt as declared', () => {
  const declared = parseDeclaredFunctions(TOML);
  const startedAt = '2026-10-05T22:00:00Z';
  const fresh = Date.parse('2026-10-05T22:00:40Z');
  const ok = verifyDeployed({
    functions: ['pay-now', 'l3-login'], declared, startedAt,
    listed: [{ slug: 'pay-now', status: 'ACTIVE', version: 460, updated_at: fresh, verify_jwt: false }, { slug: 'l3-login', status: 'ACTIVE', version: 7, updated_at: new Date(fresh).toISOString(), verify_jwt: false }]
  });
  assert.equal(ok.ok, true, ok.problems.join('; '));
  assert.equal(ok.proven.length, 2);
  const bad = verifyDeployed({
    functions: ['pay-now', 'l3-login', 'eu-worker'], declared, startedAt,
    listed: [{ slug: 'pay-now', status: 'ACTIVE', updated_at: Date.parse('2026-10-05T21:46:16Z'), verify_jwt: false }, { slug: 'l3-login', status: 'ACTIVE', updated_at: fresh, verify_jwt: true }]
  });
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join('\n'), /pay-now: last updated 2026-10-05T21:46:16\.000Z, before this deploy started/);
  assert.match(bad.problems.join('\n'), /l3-login: verify_jwt is true live but false/);
  assert.match(bad.problems.join('\n'), /eu-worker: not listed/);
});

test('the workflow deploys on function or config changes alone, least-privilege, and never prunes', async () => {
  const yml = await read('.github/workflows/supabase-functions-deploy.yml');
  const on = yml.slice(yml.indexOf('\non:'), yml.indexOf('\npermissions:'));
  assert.match(on, /push:\n\s+branches: \[main\]\n\s+paths:\n\s+- 'supabase\/functions\/\*\*'\n\s+- 'supabase\/config\.toml'/);
  assert.doesNotMatch(on, /supabase\/migrations/, 'a migration must not be needed to trigger a deploy');
  assert.match(on, /workflow_dispatch:/);
  assert.match(yml, /\npermissions:\n\s+contents: read\n\s+checks: read\n/);
  assert.match(yml, /\n\s+actions: read\n/, 'reads its own run history to find the last successful deploy');
  assert.match(yml, /plan --before "\$BEFORE" --after HEAD --base-from-last-success true/, 'push runs plan from the last successful run');
  assert.match(yml, /--baseline "\$BASELINE"/, 'the gate knows when no baseline exists');
  assert.match(yml, /\nconcurrency:\n\s+group: supabase-edge-functions-production\n\s+cancel-in-progress: false\n/, 'production deploy runs are serialized so an older push cannot finish after a newer one');
  assert.doesNotMatch(yml, /git push|contents: write|pull_request:/, 'deploys from main only and never writes to a branch');
  for (const uses of yml.match(/uses: \S+/g)) assert.match(uses, /@[0-9a-f]{40}$/, `${uses} must be pinned to a commit`);
  assert.match(yml, /for function in \$FUNCTIONS; do/);
  assert.match(yml, /supabase functions deploy "\$function" --project-ref "\$SUPABASE_PROJECT_REF" --use-api/, 'the CLI is invoked once per planned function, never with a selected list');
  assert.doesNotMatch(yml, /--prune|--no-verify-jwt/);
  const lines = yml.split('\n');
  let scripts = 0;
  lines.forEach((line, i) => {
    const m = line.match(/^(\s*)run:(.*)$/);
    if (!m) return;
    scripts++;
    const body = [m[2]];
    for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || lines[j].match(/^\s*/)[0].length > m[1].length); j++) body.push(lines[j]);
    assert.doesNotMatch(body.join('\n'), /\$\{\{/, `expressions reach a script only through env: ${body.join(' ').trim().slice(0, 80)}`);
  });
  assert.ok(scripts >= 5);
  const contract = JSON.parse(await read('core/drift-contract.json'));
  assert.match(yml, new RegExp(`SUPABASE_PROJECT_REF: ${contract.supabase.project_ref}\\n`), 'deploys to the canonical project');
  assert.match(yml, /checkout@[0-9a-f]{40} # v4\n\s+with:\n\s+ref: main\n\s+fetch-depth: 0\n\s+persist-credentials: false/, 'a late run deploys main as it is now, never older code');
});
