// The owner's #510 runbook and the mechanism page, held to the scripts and
// workflows they describe. A runbook claim the code does not support is a
// defect in the runbook: each test reads the claim and the code it rests on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const RUNBOOK = 'docs/control-plane/OVH-510-CONTRACT-AND-AUTH-RUNBOOK.md';

// The lines of every ```bash block, as the owner would paste them.
function fencedBashLines(markdown) {
  const lines = [];
  let inside = false;
  for (const line of markdown.split('\n')) {
    if (/^```/.test(line)) { inside = !inside && line.trim() === '```bash'; continue; }
    if (inside) lines.push(line.trim());
  }
  return lines;
}

// One step's run: block from a workflow, dedented as GitHub hands it to bash.
function runBlock(workflow, stepName) {
  const lines = workflow.split('\n');
  const step = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  const run = lines.findIndex((line, index) => index > step && line.trim() === 'run: |');
  assert.ok(step > 0 && run > step, `step ${stepName}`);
  const block = [];
  for (let index = run + 1; index < lines.length && (lines[index].startsWith('          ') || lines[index] === ''); index++) block.push(lines[index].slice(10));
  return block.join('\n');
}

// From a heading that starts with `prefix` to the next heading of the same or a higher level.
function section(markdown, prefix) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith(prefix));
  assert.ok(start >= 0, `section ${prefix}`);
  const level = lines[start].match(/^#+/)[0].length;
  const end = lines.findIndex((line, index) => index > start && /^#+ /.test(line) && line.match(/^#+/)[0].length <= level);
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

test('the runbook names the job that watches a promotion, and says a green run is not acceptance', async () => {
  const [runbook, workflow, verification, collect, reconciler] = await Promise.all([
    read(RUNBOOK),
    read('.github/workflows/promote-ovh-production.yml'),
    read('core/src/health-verification.mjs'),
    read('core/src/executors/host-health-collect.mjs'),
    read('scripts/mccluster-vps-reconcile.sh'),
  ]);
  const step4 = section(runbook, '## Step 4.');
  const job = step4.match(/has the `([a-z_-]+)` job/)?.[1];
  assert.ok(job && workflow.includes(`\n  ${job}:\n`), `the runbook names a job the workflow has: ${job}`);
  assert.match(workflow.slice(workflow.indexOf(`\n  ${job}:\n`)), /^    needs: promote$/m);
  // The broker serves the target from its restart, before the deployer's gate; a deferred rollback keeps it.
  assert.match(step4, /\*\*A green run is not acceptance\.\*\*/);
  assert.match(step4, /a rollback whose producer drain times out is deferred and leaves the failed release live, serving the target/);
  assert.match(step4, /Step 5 is acceptance: `deployed_sha` equal to the serving SHA, and `runtime_verification` = `verified`\./);
  assert.match(runbook, /\| Promotion names the previous head and watches the public serving SHA\. A green run is not acceptance: step 5 is \|/);
  assert.doesNotMatch(runbook, /verifies the runtime|has the `verify` job/);
  // Why step 5 tells them apart: runtime_verification compares the serving SHA with the host's
  // deployment record, which the reconciler writes only after the deployer returned success.
  assert.match(verification, /const verified = \[probes\.local_core,probes\.public_core\]\.every\(probe => access\(probe\) === 'ok' && validSha\(probe\.deployment_sha\) && probe\.deployment_sha === snapshot\.deployment\?\.deployed_sha\);/);
  assert.match(collect, /textFile\('\/var\/lib\/mccluster\/reconcile\/deployed_sha'\)/);
  const deploy = reconciler.indexOf('bash "${CHECKOUT}/scripts/deploy-ovh-core.sh" "${CHECKOUT}" "${TARGET_SHA}"');
  const stamp = reconciler.indexOf('mv "${STATE_FILE}.tmp" "${STATE_FILE}"');
  assert.ok(deploy > 0 && stamp > deploy, 'the deployment record is written only after the deployer succeeded');
});

test('the way back is a forward promotion; allow_rollback is named as the forced move it is (RB-1)', async (t) => {
  const [runbook, workflow, driftCheck] = await Promise.all([
    read(RUNBOOK), read('.github/workflows/promote-ovh-production.yml'), read('scripts/control-plane-drift-contract-check.mjs'),
  ]);
  // What allow_rollback really does: the workflow's own push step, run against a local bare
  // repository standing in for GitHub, moving the ref from X back to the deployed commit.
  const root = mkdtempSync(join(tmpdir(), 'mcc-promote-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { PATH: process.env.PATH, HOME: root, LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@invalid', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@invalid' };
  const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' }); assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
  mkdirSync(join(root, 'work'));
  git(join(root, 'work'), 'init', '-q', '-b', 'main', '.');
  git(join(root, 'work'), 'commit', '-q', '--allow-empty', '-m', 'deployed');
  const deployed = git(join(root, 'work'), 'rev-parse', 'HEAD');
  git(join(root, 'work'), 'commit', '-q', '--allow-empty', '-m', 'promoted');
  const promoted = git(join(root, 'work'), 'rev-parse', 'HEAD');
  git(root, 'init', '-q', '--bare', 'origin.git');
  git(join(root, 'work'), 'push', '-q', join(root, 'origin.git'), `${promoted}:refs/heads/main`, `${promoted}:refs/heads/deploy/ovh-production`);
  git(root, 'clone', '-q', join(root, 'origin.git'), 'runner');
  writeFileSync(join(root, 'push.sh'), `${runBlock(workflow, 'Promote deployment ref')}\n`);
  const back = (allowRollback) => spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', join(root, 'push.sh')], {
    cwd: join(root, 'runner'), encoding: 'utf8', env: { ...env, TARGET_SHA: deployed, EXPECTED_CURRENT: promoted, ALLOW_ROLLBACK: allowRollback } });
  const ref = () => git(join(root, 'origin.git'), 'rev-parse', 'refs/heads/deploy/ovh-production');
  assert.equal(back('false').status, 3, 'without allow_rollback the step refuses to move the ref backward');
  assert.equal(ref(), promoted);
  const forced = back('true');
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stderr, /\(forced update\)/, 'allow_rollback moves the deploy ref by force');
  assert.equal(ref(), deployed);
  git(join(root, 'origin.git'), 'update-ref', 'refs/heads/deploy/ovh-production', promoted);
  git(join(root, 'origin.git'), 'config', 'receive.denyNonFastForwards', 'true');
  const blocked = back('true');
  assert.notEqual(blocked.status, 0, 'and it is refused once force pushes are blocked on the ref');
  assert.match(blocked.stderr, /non-fast-forward/);
  assert.equal(ref(), promoted);

  // So the runbook's way back is forward, and every allow_rollback = true it mentions is named a forced move.
  const step4 = section(runbook, '## Step 4.');
  assert.match(step4, /\*\*To go back, go forward\.\*\* If the promoted release fails because of commit 2, commit on `repair\/ovh-core-contract-363` a revert of commit 2 alone \(`git revert --no-edit <commit 2>`\)/);
  assert.match(step4, /promote that head with `allow_rollback` = false and `expected_current` = the SHA it replaces/);
  assert.doesNotMatch(runbook, /`sha` = `9c5b75032d1794c47d8b6db05acf16e3965faa74`, `allow_rollback` = true|until the ref is moved back/);
  for (const paragraph of runbook.split(/\n\s*\n/).filter((text) => /`allow_rollback` = true/.test(text))) {
    assert.match(paragraph, /by force|forced move/, paragraph);
    assert.match(paragraph, /owner's explicit exception, recorded on #510/, paragraph);
    assert.match(paragraph, /force pushes are blocked on the ref/, paragraph);
  }
  // Never a revert of commit 1 (it deletes applied migration files), and a contract-only revert cannot
  // pass: the drift check holds the contract to the production ledger file.
  assert.match(step4, /Never revert commit 1\. It adds four migration files that production has applied, and the revert would delete them\./);
  for (const field of ['migration_count', 'latest_version', 'latest_name', 'ledger_sha256']) assert.match(driftCheck, new RegExp(`\\['${field}',`));
  assert.match(driftCheck, /does not match drift contract/);
  assert.match(step4, /A revert of `core\/drift-contract\.json` alone does not pass either\./);
  // Acceptance E and the Never list say the same thing.
  assert.match(section(runbook, '## Acceptance'), /\*\*E\. Clean path\.\*\* No break-glass deploy and no forced ref move: every move of `deploy\/ovh-production` was a forward promotion with `allow_rollback` = false\./);
  assert.match(section(runbook, '## Never'), /- Move the deploy ref by hand or by force\. A run with `allow_rollback` = true is a forced move/);
});

test('every bash -n the runbook gives catches a syntax error in each file it names (RB-2)', async (t) => {
  const runbook = await read(RUNBOOK);
  const commands = fencedBashLines(runbook).filter((line) => /^bash -n\s/.test(line));
  const named = commands.flatMap((command) => command.slice('bash -n'.length).trim().split(/\s+/));
  assert.deepEqual([...named].sort(), ['scripts/deploy-ovh-core.sh', 'scripts/mccluster-vps-reconcile.sh', 'scripts/ovh-core-health.sh', 'scripts/ovh-private-repo-ssh.sh'],
    'commit 2 is checked by parsing the reconciler, the deployer, the health library and the setup script');
  const root = mkdtempSync(join(tmpdir(), 'mcc-runbook-bash-n-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [index, command] of commands.entries()) {
    const files = command.slice('bash -n'.length).trim().split(/\s+/);
    // The command as the owner pastes it, run where only `broken` has a syntax error.
    for (const broken of files) {
      const dir = join(root, `${index}-${files.indexOf(broken)}`);
      for (const file of files) {
        mkdirSync(dirname(join(dir, file)), { recursive: true });
        writeFileSync(join(dir, file), `${await read(file)}${file === broken ? '\nif then\n' : ''}`);
      }
      const result = spawnSync('bash', ['-c', command], { cwd: dir, encoding: 'utf8' });
      assert.notEqual(result.status, 0, `"${command}" passes with a syntax error in ${broken}`);
    }
  }
});

test('the activate table states the exit status the setup script really exits with (RB-5)', async () => {
  const [runbook, script] = await Promise.all([read(RUNBOOK), read('scripts/ovh-private-repo-ssh.sh')]);
  const rows = section(runbook, '## Step 6.').split('\n').filter((line) => line.startsWith('| ') && !/^\| (If `activate` says|---)/.test(line));
  assert.ok(rows.length >= 7, 'the table of what activate says');
  // The exit statuses the script documents in its header, and therefore all a row may name.
  const documented = [...script.matchAll(/^# {3}(\d) {2}/gm)].map((match) => match[1]);
  assert.deepEqual(documented, ['0', '1', '2', '3', '4']);
  for (const row of rows) for (const [, code] of row.matchAll(/exit status (\d+)/g)) assert.ok(documented.includes(code), `the script never exits ${code}: ${row}`);
  // Refs that cannot be read: the script's own line, and the status it exits with.
  const unreadable = script.match(/echo "(Cannot read the repository over SSH \([^"]*\)\.)" >&2; exit (\d+); \}/);
  assert.ok(unreadable, 'the script refuses unreadable refs with its own message');
  const row = rows.find((line) => line.includes(unreadable[1]));
  assert.ok(row, 'the table quotes that message');
  assert.match(row, new RegExp(`exit status ${unreadable[2]} \\|`));
});

test('every instruction that removes the SSH drop-in says it works only while the repository is public (RB-6)', async () => {
  const [runbook, unit, reconciler] = await Promise.all([
    read(RUNBOOK), read('core/systemd/mccluster-vps-reconcile.service'), read('scripts/mccluster-vps-reconcile.sh'),
  ]);
  // Without the drop-in the reconciler fetches anonymously over HTTPS, which a private repository refuses.
  assert.match(unit, /^Environment=MCCLUSTER_REPO_URL=https:\/\/github\.com\/mcclusterishere\/mccluster\.git$/m);
  assert.match(reconciler, /^REPO_URL="\$\{MCCLUSTER_REPO_URL:-https:\/\/github\.com\/mcclusterishere\/mccluster\.git\}"$/m);
  const blocks = runbook.split(/\n\s*\n/);
  const removal = /rm \/etc\/systemd\/system\/mccluster-vps-reconcile\.service\.d\/50-github-readonly-ssh\.conf/;
  const removals = blocks.map((block, index) => ({ block, index })).filter(({ block }) => removal.test(block));
  assert.ok(removals.length >= 2, 'the key-rotation note and the way back both remove the drop-in');
  for (const { block, index } of removals) {
    const context = block.startsWith('```') ? blocks[index - 1] : block;
    assert.match(context, /while the repository is (still )?public/i, `removing the drop-in is not limited to a public repository: ${context}`);
  }
  assert.match(section(runbook, '## Step 6.'), /Once it is private, switch visibility back to public first \(step 8\.5\), then remove the drop-in\./);
  assert.match(section(runbook, '## Step 8.'), /\n5\. If a cycle fails, switch back to public at once/);
});

test('the schema freeze covers merges, because a push to main applies supabase/migrations (RB-3)', async () => {
  const [runbook, controls] = await Promise.all([read(RUNBOOK), read('docs/control-plane/DEPLOYMENT-CONTROLS-PROPOSAL.md')]);
  assert.match(controls, /\| \*\*Supabase migrations \+ Edge Functions\*\* \| \*\*Supabase GitHub integration\*\* \(dashboard\) on push to `main` \| Applies `supabase\/migrations`/,
    'the deployment-controls record: merging a migration into main applies it to production');
  const freeze = section(runbook, '## Step 1.');
  assert.match(freeze, /So merge into `main` no pull request that adds or changes a file under `supabase\/migrations` until step 5 passes\./);
  assert.match(freeze, /Step 3's pull request is the one exception: production has applied its four files already, and Q3 guards the merge\./);
  assert.match(section(runbook, '## Step 3.'), /Run Q3 once more immediately before merging\./, 'the guard the exception relies on');
  assert.match(section(runbook, '## Never'), /- Merge into `main` a pull request that adds or changes a file under `supabase\/migrations` before step 5 passes/);
});
