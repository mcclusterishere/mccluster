// C4 regression: the autonomous code_patch executor must inventory the COMPLETE
// change set (index + worktree + untracked, renames, deletions, symlinks,
// submodules) before its path policy runs, and must re-validate the exact
// staged tree before commit/push. Previously `git diff --name-only` (worktree
// vs index only) let a staged forbidden edit reach `git add -A` and the draft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, symlink, unlink, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { codePatch, inventoryChanges, checkPaths } from '../src/executors/code-patch.mjs';

const sh = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'core-code-patch-'));
  const origin = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  sh(root, ['init', '-q', '--bare', '--initial-branch=main', origin]);
  sh(root, ['init', '-q', '--initial-branch=main', seed]);
  sh(seed, ['config', 'user.name', 'fixture']);
  sh(seed, ['config', 'user.email', 'fixture@example.invalid']);
  await mkdir(path.join(seed, '.github/workflows'), { recursive: true });
  await mkdir(path.join(seed, 'docs'), { recursive: true });
  await mkdir(path.join(seed, 'core/src'), { recursive: true });
  await writeFile(path.join(seed, '.github/workflows/check.yml'), 'name: fixture\n');
  await writeFile(path.join(seed, 'docs/note.md'), 'note\n');
  await writeFile(path.join(seed, 'core/src/a.mjs'), 'export const a = 1;\n');
  sh(seed, ['add', '-A']);
  sh(seed, ['commit', '-qm', 'seed']);
  sh(seed, ['remote', 'add', 'origin', origin]);
  sh(seed, ['push', '-q', 'origin', 'main']);
  const repoRoot = path.join(root, 'repos');
  await mkdir(repoRoot);
  sh(repoRoot, ['clone', '-q', origin, 'mccluster']);
  return { root, origin, repoRoot, worktreeRoot: path.join(root, 'worktrees') };
}

function harness(fx, edit) {
  const calls = { push: [], pr: [] };
  const deps = {
    repoRoot: fx.repoRoot,
    worktreeRoot: fx.worktreeRoot,
    runAgent: async ({ worktree }) => { await edit(worktree); return { stdout: 'agent done', stderr: '' }; },
    push: async (x) => { calls.push.push(x); },
    createPr: async (x) => { calls.pr.push(x); return 'https://github.com/example/pr/1'; },
  };
  return { deps, calls };
}

const job = (allowed) => ({ id: 'job-1234-5678-abcd', target_id: 'mcclusterishere/mccluster', input: { task: 'fixture task', ...(allowed ? { allowed_paths: allowed } : {}) } });

const stage = (wt, p) => sh(wt, ['add', '--', p]);

test('C4: a staged forbidden workflow edit is rejected before any push or PR', async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const { deps, calls } = harness(fx, async (wt) => {
    await writeFile(path.join(wt, '.github/workflows/check.yml'), 'name: changed\n');
    stage(wt, '.github/workflows/check.yml');
  });
  await assert.rejects(codePatch(job(), deps), /path policy: \.github\/workflows\/check\.yml \(sensitive path\)/);
  assert.equal(calls.push.length, 0);
  assert.equal(calls.pr.length, 0);
});

test('staged, unstaged and mixed edits of the same file produce identical policy decisions', async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const wt = path.join(fx.root, 'probe');
  sh(fx.root, ['clone', '-q', fx.origin, 'probe']);
  const base = sh(wt, ['rev-parse', 'HEAD']);
  const file = path.join(wt, 'docs/note.md');
  await writeFile(file, 'unstaged\n');
  const unstaged = await inventoryChanges(wt, base);
  stage(wt, 'docs/note.md');
  const staged = await inventoryChanges(wt, base);
  await writeFile(file, 'mixed\n');
  const mixed = await inventoryChanges(wt, base);
  assert.deepEqual(unstaged.files, ['docs/note.md']);
  assert.deepEqual(staged.files, ['docs/note.md']);
  assert.deepEqual(mixed.files, ['docs/note.md']);
  for (const inv of [unstaged, staged, mixed]) {
    assert.deepEqual(checkPaths(inv.files, ['docs']), []);
    assert.deepEqual(checkPaths(inv.files, ['core']), ['docs/note.md (outside allowed_paths)']);
  }
});

test('a rename out of a protected path, a deletion, odd names, new directories and outside-allowlist edits are all inventoried', async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const wt = path.join(fx.root, 'probe');
  sh(fx.root, ['clone', '-q', fx.origin, 'probe']);
  const base = sh(wt, ['rev-parse', 'HEAD']);
  // rename out of a protected path, staged (git sees D + A)
  sh(wt, ['mv', '.github/workflows/check.yml', 'docs/check.yml']);
  // staged deletion
  sh(wt, ['rm', '-q', 'core/src/a.mjs']);
  // odd filename with spaces, untracked
  await writeFile(path.join(wt, 'docs/odd name  here.md'), 'x\n');
  // new directory, untracked
  await mkdir(path.join(wt, 'brand/new/dir'), { recursive: true });
  await writeFile(path.join(wt, 'brand/new/dir/file.txt'), 'y\n');
  const inv = await inventoryChanges(wt, base);
  assert.deepEqual(inv.files, [
    '.github/workflows/check.yml',
    'brand/new/dir/file.txt',
    'core/src/a.mjs',
    'docs/check.yml',
    'docs/odd name  here.md',
  ]);
  const forbidden = checkPaths(inv.files, ['docs']);
  assert.ok(forbidden.includes('.github/workflows/check.yml (sensitive path)'));
  assert.ok(forbidden.includes('.github/workflows/check.yml (outside allowed_paths)'));
  assert.ok(forbidden.includes('brand/new/dir/file.txt (outside allowed_paths)'));
  assert.ok(forbidden.includes('core/src/a.mjs (outside allowed_paths)'));
  assert.ok(!forbidden.some((x) => x.startsWith('docs/odd name  here.md')));
});

test('a staged rename of a protected file is rejected end to end with no remote call', async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const { deps, calls } = harness(fx, async (wt) => {
    sh(wt, ['mv', '.github/workflows/check.yml', 'docs/check.yml']);
  });
  await assert.rejects(codePatch(job(['docs']), deps), /\.github\/workflows\/check\.yml/);
  assert.equal(calls.push.length + calls.pr.length, 0);
});

test('an untracked symlink and a staged edit outside allowed_paths are rejected before push', async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const link = harness(fx, async (wt) => {
    await symlink('/etc/hostname', path.join(wt, 'docs/link'));
  });
  await assert.rejects(codePatch(job(['docs']), link.deps), /symlink/);
  assert.equal(link.calls.push.length + link.calls.pr.length, 0);

  const outside = harness(fx, async (wt) => {
    await writeFile(path.join(wt, 'core/src/a.mjs'), 'export const a = 2;\n');
    stage(wt, 'core/src/a.mjs');
  });
  await assert.rejects(codePatch({ ...job(['docs']), id: 'job-2222-3333-4444' }, outside.deps), /core\/src\/a\.mjs \(outside allowed_paths\)/);
  assert.equal(outside.calls.push.length + outside.calls.pr.length, 0);
});

test('a HEAD moved by the agent is rejected before publication', async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const { deps, calls } = harness(fx, async (wt) => {
    await writeFile(path.join(wt, 'docs/note.md'), 'sneaky\n');
    sh(wt, ['-c', 'user.name=x', '-c', 'user.email=x@example.invalid', 'commit', '-qam', 'agent commit']);
    await writeFile(path.join(wt, 'docs/note.md'), 'more\n');
  });
  await assert.rejects(codePatch(job(['docs']), deps), /HEAD or branch changed unexpectedly/);
  assert.equal(calls.push.length + calls.pr.length, 0);
});

test('a permitted mixed edit passes, is committed on the recorded base and reports the checked tree', async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const { deps, calls } = harness(fx, async (wt) => {
    await writeFile(path.join(wt, 'docs/note.md'), 'staged\n');
    stage(wt, 'docs/note.md');
    await writeFile(path.join(wt, 'docs/note.md'), 'staged then edited\n');
    await writeFile(path.join(wt, 'docs/new.md'), 'new\n');
  });
  const out = await codePatch(job(['docs']), deps);
  assert.equal(out.changed, true);
  assert.deepEqual(out.files, ['docs/new.md', 'docs/note.md']);
  assert.match(out.verification.checked_tree, /^[0-9a-f]{40}$/);
  assert.equal(out.verification.staged_tree_revalidated, true);
  assert.equal(calls.push.length, 1);
  assert.equal(calls.pr.length, 1);
  assert.equal(out.draft_pr, 'https://github.com/example/pr/1');
  assert.ok(calls.pr[0].body.includes(`Checked tree: ${out.verification.checked_tree}`));
  // The branch commit sits exactly on the base and contains exactly the inventoried files.
  const repo = path.join(fx.repoRoot, 'mccluster');
  assert.equal(sh(repo, ['rev-parse', `${out.commit}^`]), out.base_commit);
  assert.equal(sh(repo, ['diff', '--name-only', out.base_commit, out.commit]), 'docs/new.md\ndocs/note.md');
  assert.equal(sh(repo, ['show', `${out.commit}:docs/note.md`]), 'staged then edited');
});

test('a clean worktree returns changed:false without publication', async (t) => {
  const fx = await fixture();
  t.after(() => rm(fx.root, { recursive: true, force: true }));
  const { deps, calls } = harness(fx, async () => {});
  const out = await codePatch(job(), deps);
  assert.equal(out.changed, false);
  assert.equal(calls.push.length + calls.pr.length, 0);
});

test('C3: a lost lease stops the job before the coding agent, the push or the pull request', async (t) => {
  /* already lost when the job starts: the agent never runs */
  const fx1 = await fixture();
  t.after(() => rm(fx1.root, { recursive: true, force: true }));
  let runs = 0;
  const h1 = harness(fx1, async () => { runs += 1; });
  await assert.rejects(codePatch(job(['docs']), { ...h1.deps, signal: AbortSignal.abort() }), (e) => e.code === 'LEASE_LOST' && /before running the coding agent/.test(e.message));
  assert.equal(runs, 0);
  assert.deepEqual(h1.calls, { push: [], pr: [] });
  /* lost while the agent runs: its permitted edit is not pushed */
  const fx2 = await fixture();
  t.after(() => rm(fx2.root, { recursive: true, force: true }));
  const lease2 = new AbortController();
  const h2 = harness(fx2, async (wt) => { await writeFile(path.join(wt, 'docs/note.md'), 'changed\n'); lease2.abort(); });
  await assert.rejects(codePatch(job(['docs']), { ...h2.deps, signal: lease2.signal }), (e) => e.code === 'LEASE_LOST' && /before pushing the branch/.test(e.message));
  assert.deepEqual(h2.calls, { push: [], pr: [] });
  /* lost after the push: the newer attempt, not this one, opens the pull request */
  const fx3 = await fixture();
  t.after(() => rm(fx3.root, { recursive: true, force: true }));
  const lease3 = new AbortController();
  const h3 = harness(fx3, async (wt) => { await writeFile(path.join(wt, 'docs/note.md'), 'changed again\n'); });
  const push = h3.deps.push;
  h3.deps.push = async (x) => { await push(x); lease3.abort(); };
  await assert.rejects(codePatch(job(['docs']), { ...h3.deps, signal: lease3.signal }), (e) => e.code === 'LEASE_LOST' && /before opening the pull request/.test(e.message));
  assert.equal(h3.calls.push.length, 1);
  assert.equal(h3.calls.pr.length, 0);
});
