/* DEPLOY TOOLING IS PINNED, AND DEPLOYS WAIT FOR CI.
   docs/control-plane/DEPLOYMENT-CONTROLS-PROPOSAL.md is the narrative. This
   test holds the source to it:
   - Wrangler is an exact devDependency of workers/mccluster, locked in its
     package-lock.json, and every Wrangler a workflow or deploy script runs
     is that locked binary (`npx --no-install` / `npm exec --prefix … --no`),
     never `npx --yes wrangler@…` or a bare `npx` that may download one;
   - deploy-path workflows take Node from the one pinned .node-version;
   - every action is pinned by commit SHA;
   - the CI gate's required checks exist and always run on a push to main;
   - the gated paths are wired, and stay inert until the owner opts in. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { evaluate, GATE } from '../require-green-ci.mjs';

const root = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');
const WF = '.github/workflows/';
const workflows = readdirSync(new URL(WF, root)).filter((f) => /\.ya?ml$/.test(f)).map((f) => WF + f);
const code = (text) => text.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => !/^\s*#/.test(l));

const DEPLOY_PATHS = [
  `${WF}deploy-mccluster-worker.yml`,
  `${WF}deploy-mccluster-mcp.yml`,
  `${WF}deploy-pages.yml`,
  `${WF}deploy-ovh-core.yml`,
  `${WF}promote-ovh-production.yml`,
  `${WF}bootstrap-ovh-self-management.yml`,
  `${WF}bootstrap-ovh-game-workstation.yml`,
  `${WF}reconcile-worker-triggers.yml`,
  `${WF}supabase-functions-deploy.yml`,
  `${WF}mcp-continuity-ci.yml`,
  'scripts/deploy-cloudflare-pages.sh',
  'scripts/deploy-ovh-core.sh',
  'scripts/mccluster-vps-reconcile.sh',
  'scripts/bootstrap-vps-self-management.sh',
  'scripts/worker-triggers.py',
];

test('wrangler is an exact devDependency of the Worker and locked at that version', () => {
  const pkg = JSON.parse(read('workers/mccluster/package.json'));
  const lock = JSON.parse(read('workers/mccluster/package-lock.json'));
  const pinned = pkg.devDependencies?.wrangler;
  assert.match(pinned ?? '', /^\d+\.\d+\.\d+$/, 'wrangler must be an exact x.y.z devDependency (no ^, ~, range or tag)');
  assert.equal(lock.packages[''].devDependencies?.wrangler, pinned, 'lockfile root records the same exact pin');
  assert.equal(lock.packages['node_modules/wrangler']?.version, pinned, 'lockfile resolves wrangler to the pinned version');
  assert.match(lock.packages['node_modules/wrangler']?.integrity ?? '', /^sha512-/, 'locked wrangler carries an integrity hash');
});

test('no workflow or script names a registry-fetched wrangler@version', () => {
  const offenders = [];
  for (const f of [...workflows, ...DEPLOY_PATHS.filter((p) => p.startsWith('scripts/'))]) {
    for (const [n, l] of code(read(f))) if (/\bwrangler@/.test(l)) offenders.push(`${f}:${n}: ${l.trim()}`);
  }
  assert.deepEqual(offenders, [], 'use the locked binary from workers/mccluster/package-lock.json');
});

test('deploy paths never run an npx that may download a package', () => {
  const offenders = [];
  for (const f of DEPLOY_PATHS) {
    for (const [n, l] of code(read(f))) {
      if (/\bnpx\b(?!\s+--no-install\b)/.test(l)) offenders.push(`${f}:${n}: ${l.trim()}`);
      if (/\bnpm\s+exec\b/.test(l) && !/\s--no\s+--\s/.test(l)) offenders.push(`${f}:${n}: ${l.trim()}`);
      if (/['"]npx['"]/.test(l)) offenders.push(`${f}:${n}: ${l.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], 'use `npx --no-install` or `npm exec --prefix <dir> --no --` after `npm ci`');
});

test('every wrangler command a workflow runs is the locked binary', () => {
  const invoke = /\bwrangler\s+(deploy|versions|deployments|dev|triggers|secret|rollback|pages|--version)\b/;
  const locked = /(npx --no-install|npm exec --prefix \S+ --no --) wrangler /;
  const offenders = [];
  let seen = 0;
  for (const f of workflows) {
    for (const [n, l] of code(read(f))) {
      if (!invoke.test(l) || /\becho\b/.test(l) || /^\s*-?\s*name:/.test(l)) continue;
      seen += 1;
      if (!locked.test(l)) offenders.push(`${f}:${n}: ${l.trim()}`);
    }
  }
  assert.ok(seen >= 10, `expected the Worker deploy paths to invoke wrangler (saw ${seen})`);
  assert.deepEqual(offenders, []);
  assert.match(read('scripts/worker-triggers.py'), /WRANGLER = \['npm', 'exec', '--prefix', str\(WORKER_PACKAGE\), '--no', '--', 'wrangler'\]/);
});

test('every job that runs the locked wrangler installs it from the lockfile first', () => {
  for (const f of [`${WF}deploy-mccluster-worker.yml`, `${WF}deploy-mccluster-mcp.yml`, `${WF}mcp-continuity-ci.yml`, `${WF}reconcile-worker-triggers.yml`]) {
    const text = read(f);
    const install = text.search(/npm ci (--prefix \S+ )?--ignore-scripts/);
    const firstUse = text.search(/(npx --no-install|--no --) wrangler|worker-triggers\.py "\$mode"/);
    assert.ok(install > 0 && install < firstUse, `${f}: npm ci before the first wrangler use`);
  }
});

test('Node is pinned to one exact version for the Worker and every deploy path', () => {
  const version = read('workers/mccluster/.node-version').trim();
  assert.match(version, /^\d+\.\d+\.\d+$/);
  for (const f of DEPLOY_PATHS.filter((p) => p.startsWith(WF))) {
    const text = read(f);
    if (!text.includes('actions/setup-node@')) continue;
    assert.ok(!/node-version:\s/.test(text), `${f}: use node-version-file, not a floating node-version`);
    assert.match(text, /node-version-file: workers\/mccluster\/\.node-version/, f);
  }
  assert.match(read(`${WF}deploy-pages.yml`), /actions\/setup-node@[0-9a-f]{40}/, 'the Pages build no longer uses the runner image Node');
});

test('every action is pinned by a full commit SHA', () => {
  const offenders = [];
  for (const f of workflows) {
    for (const [n, l] of code(read(f))) {
      const m = l.match(/uses:\s+([^\s#]+)/);
      if (m && !m[1].startsWith('./') && !/@[0-9a-f]{40}$/.test(m[1])) offenders.push(`${f}:${n}: ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the deploy gate only names checks that always run on a push to main', () => {
  assert.ok(GATE.required_checks_on_main_sha.length >= 4);
  for (const name of GATE.required_checks_on_main_sha) {
    const file = GATE.check_sources[name];
    assert.ok(file, `${name}: source workflow recorded`);
    const text = read(file);
    const on = text.slice(text.search(/^on:/m), text.search(/^(permissions|jobs|concurrency|env):/m));
    assert.match(on, /\n  push:\n    branches: \[main\]/, `${file}: runs on push to main`);
    assert.ok(!/paths/.test(on), `${file}: no path filter, so ${name} runs on every main commit`);
    assert.ok(new RegExp(`^  ${name}:\\s*$`, 'm').test(text) || new RegExp(`^    name: ${name}\\s*$`, 'm').test(text), `${file}: job ${name}`);
  }
});

test('the Worker workflow deploys only a CI-green tip of main, and only when opted in', () => {
  const text = read(`${WF}deploy-mccluster-worker.yml`);
  assert.match(text, /workflow_run:\n\s+workflows: \['MCP Continuity and Preview'\]\n\s+types: \[completed\]\n\s+branches: \[main\]/);
  assert.match(text, /vars\.WORKER_DEPLOY_MODE == 'github-gated'/, 'inert until the owner sets WORKER_DEPLOY_MODE');
  assert.match(text, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(text, /verify-git-deploy:[\s\S]*?vars\.WORKER_DEPLOY_MODE != 'github-gated'/, 'the Cloudflare Git observer stands down in gated mode');
  const deploy = text.slice(text.indexOf('\n  deploy:'));
  const gate = deploy.indexOf('require-green-ci.mjs --sha "$TARGET_SHA"');
  const tip = deploy.indexOf('no longer the tip of main');
  const upload = deploy.indexOf('wrangler versions upload');
  assert.ok(gate > 0 && tip > 0 && gate < upload && tip < upload, 'tip-of-main and green-CI checks precede the upload');
  assert.ok(!/\$GITHUB_SHA|\$\{GITHUB_SHA\}/.test(deploy), 'the deploy job ships TARGET_SHA, never the workflow_run default-branch SHA');
});

test('the MCP transport and the opt-in Pages/Supabase gates are wired', () => {
  const mcp = read(`${WF}deploy-mccluster-mcp.yml`);
  assert.ok(mcp.indexOf('require-green-ci.mjs') < mcp.indexOf('wrangler versions upload'), 'MCP deploy waits for green CI');
  for (const f of [`${WF}deploy-pages.yml`, `${WF}supabase-functions-deploy.yml`]) {
    const text = read(f);
    assert.match(text, /vars\.DEPLOY_REQUIRE_GREEN_CI == 'true'[\s\S]*?require-green-ci\.mjs/, `${f}: opt-in gate`);
    assert.match(text, /checks: read/, `${f}: may read check runs`);
  }
});

const run = (name, status, conclusion, id = 1, started_at = '2026-10-28T00:00:00Z') => ({ name, status, conclusion, id, started_at });
const req = ['a', 'b'];

test('gate: all required checks green passes; unrelated checks are ignored', () => {
  const v = evaluate([run('a', 'completed', 'success'), run('b', 'completed', 'success'), run('x', 'completed', 'failure')], req);
  assert.equal(v.state, 'success');
});

test('gate: a missing or running check is pending, never a pass', () => {
  assert.equal(evaluate([run('a', 'completed', 'success')], req).state, 'pending');
  assert.deepEqual(evaluate([run('a', 'completed', 'success')], req).missing, ['b']);
  assert.equal(evaluate([run('a', 'completed', 'success'), run('b', 'in_progress', null)], req).state, 'pending');
});

test('gate: any other conclusion fails, including skipped and cancelled', () => {
  for (const c of ['failure', 'cancelled', 'skipped', 'timed_out', 'neutral', 'action_required']) {
    assert.equal(evaluate([run('a', 'completed', 'success'), run('b', 'completed', c)], req).state, 'failure', c);
  }
});

test('gate: the newest run of a check decides it', () => {
  const rerunPassed = [run('a', 'completed', 'success'), run('b', 'completed', 'failure', 1, '2026-10-28T00:00:00Z'), run('b', 'completed', 'success', 2, '2026-10-28T00:10:00Z')];
  assert.equal(evaluate(rerunPassed, req).state, 'success');
  const rerunFailed = [run('a', 'completed', 'success'), run('b', 'completed', 'success', 1, '2026-10-28T00:00:00Z'), run('b', 'completed', 'failure', 2, '2026-10-28T00:10:00Z')];
  assert.equal(evaluate(rerunFailed, req).state, 'failure');
});
