import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { run } from '../process.mjs';

const REPO_ROOT = process.env.MCCLUSTER_REPO_ROOT || '/srv/mccluster/repos';
const WORKTREE_ROOT = process.env.MCCLUSTER_WORKTREE_ROOT || '/srv/mccluster/worktrees';
const OPENCODE = process.env.MCCLUSTER_OPENCODE_BIN || 'opencode';
const ATTACH = process.env.MCCLUSTER_OPENCODE_ATTACH || 'http://127.0.0.1:4096';
const MODEL = process.env.MCCLUSTER_OPENCODE_MODEL || 'ollama/qwen3:8b';
const TARGET = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DEFAULT_REPOS = new Set(String(process.env.MCCLUSTER_CODE_REPOS || 'mcclusterishere/mccluster').split(',').map((x) => x.trim()).filter(Boolean));
const SENSITIVE = [
  /^\.git(?:\/|$)/,
  /^\.github\/workflows\//,
  /^\.github\/actions\//,
  /^supabase\/migrations\//,
  /^core\/systemd\//,
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)(?:id_rsa|id_ed25519|authorized_keys|known_hosts)$/,
  /credential/i,
  /secret/i,
];

function targetPath(target, repoRoot = REPO_ROOT) {
  if (!TARGET.test(target)) throw new Error('code_patch target_id must be owner/repo');
  if (!DEFAULT_REPOS.has(target)) throw new Error(`code_patch repo is not allowlisted: ${target}`);
  return path.join(repoRoot, target.split('/')[1]);
}

async function git(cwd, args, timeoutMs = 120_000) {
  return run('git', args, { cwd, timeoutMs });
}

const SYMLINK_MODE = '120000';
const SUBMODULE_MODE = '160000';

function splitNul(stdout) {
  return String(stdout || '').split('\0').filter((x) => x.length);
}

/* Parse `git diff --raw -z` output: each record is
   ":<old mode> <new mode> <old sha> <new sha> <status>\0<path>\0"; rename/copy
   records (when rename detection is on) carry a second path. Inventory calls use
   --no-renames so a rename out of a protected path surfaces as D + A and both
   paths are policy-checked. */
function parseRawDiff(stdout) {
  const tokens = splitNul(stdout);
  const entries = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const meta = tokens[i];
    if (!meta.startsWith(':')) throw new Error(`unexpected git raw diff record: ${meta.slice(0, 80)}`);
    const parts = meta.slice(1).split(' ');
    const [oldMode, newMode] = parts;
    const status = parts[4] || '';
    const paths = [tokens[i + 1]];
    i += 1;
    if (/^[RC]/.test(status)) {
      paths.push(tokens[i + 1]);
      i += 1;
    }
    entries.push({ status: status[0], modes: [oldMode, newMode], paths: paths.filter((x) => x !== undefined) });
  }
  return entries;
}

/* Build the complete change inventory of a worktree against the recorded base
   commit: index vs base, worktree vs index, and untracked files. Every path the
   change set touches is returned, including rename/copy sources, deletions and
   entries whose mode is a symlink or submodule. A staged edit can no longer hide
   from the policy by being absent from `git diff --name-only`. Renames are
   reported as delete + add so both source and destination are checked. */
export { checkPaths };
export async function inventoryChanges(worktree, baseCommit, gitRun = git) {
  const files = new Set();
  const special = [];
  const sources = [
    await gitRun(worktree, ['diff', '--raw', '-z', '--no-renames', '--cached', baseCommit]),
    await gitRun(worktree, ['diff', '--raw', '-z', '--no-renames']),
  ];
  for (const result of sources) {
    for (const entry of parseRawDiff(result.stdout)) {
      for (const file of entry.paths) files.add(file);
      for (const mode of entry.modes) {
        if (mode === SYMLINK_MODE || mode === SUBMODULE_MODE) special.push(`${entry.paths.join(' -> ')} (${mode === SYMLINK_MODE ? 'symlink' : 'submodule'})`);
      }
    }
  }
  for (const file of splitNul((await gitRun(worktree, ['ls-files', '-z', '--others', '--exclude-standard'])).stdout)) {
    files.add(file);
  }
  for (const file of files) {
    if (file === '' || file.includes('\n') || file.includes('\r') || /(^|\/)\.\.(\/|$)/.test(file) || file.startsWith('/')) special.push(`${file.replace(/\s/g, ' ')} (unsafe path name)`);
  }
  return { files: [...files].sort(), special: [...new Set(special)] };
}

/* Inspect the staged tree after `git add -A`: symlinks and submodules that only
   appear as untracked entries become visible here. */
export async function stagedSpecialEntries(worktree, baseCommit, gitRun = git) {
  const special = [];
  for (const entry of parseRawDiff((await gitRun(worktree, ['diff', '--raw', '-z', '--no-renames', '--cached', baseCommit])).stdout)) {
    for (const mode of entry.modes) {
      if (mode === SYMLINK_MODE || mode === SUBMODULE_MODE) special.push(`${entry.paths.join(' -> ')} (${mode === SYMLINK_MODE ? 'symlink' : 'submodule'})`);
    }
  }
  return [...new Set(special)];
}

function checkPaths(files, allowedPaths = []) {
  const prefixes = Array.isArray(allowedPaths) ? allowedPaths.map((x) => String(x).replace(/^\.\//, '').replace(/\/$/, '')) : [];
  const forbidden = [];
  for (const file of files) {
    if (prefixes.length && !prefixes.some((prefix) => file === prefix || file.startsWith(`${prefix}/`))) forbidden.push(`${file} (outside allowed_paths)`);
    if (SENSITIVE.some((rule) => rule.test(file))) forbidden.push(`${file} (sensitive path)`);
  }
  return [...new Set(forbidden)];
}

function promptFor(job) {
  const task = String(job.input?.task || '').trim();
  if (!task) throw new Error('code_patch requires input.task');
  return [
    'You are the low-privilege McCluster Core coding worker in a disposable Git worktree.',
    'Complete the requested task by editing files in this worktree only.',
    'Run relevant local tests or static checks when practical.',
    'Do not commit, push, create pull requests, change git remotes, read credentials, access secrets, deploy, or contact production systems.',
    'Do not edit CI workflows, database migrations, systemd units, credential files, or .env files unless the task explicitly names those files; the parent policy may still reject them.',
    'At the end, summarize changed files and tests run.',
    '',
    `TASK: ${task.slice(0, 20_000)}`,
  ].join('\n');
}

async function assertUnchangedHead(worktree, baseCommit, branch, repo) {
  const head = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  const current = (await git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
  if (head !== baseCommit || current !== branch) {
    await cleanWorktree(repo, worktree);
    throw new Error(`worktree HEAD or branch changed unexpectedly (${current}@${head.slice(0, 12)})`);
  }
}

async function defaultRunAgent({ worktree, prompt }) {
  return run(OPENCODE, [
    'run',
    '--attach', ATTACH,
    '--dir', worktree,
    '--model', MODEL,
    '--agent', process.env.MCCLUSTER_OPENCODE_AGENT || 'build',
    '--format', 'json',
    '--auto',
    prompt,
  ], {
    timeoutMs: Number(process.env.MCCLUSTER_CODE_TIMEOUT_MS || 45 * 60_000),
    env: {
      OPENCODE_SERVER_PASSWORD: process.env.OPENCODE_SERVER_PASSWORD || '',
      OPENCODE_SERVER_USERNAME: process.env.OPENCODE_SERVER_USERNAME || 'opencode',
    },
  });
}

async function defaultPush({ worktree, branch }) {
  await git(worktree, ['push', '-u', 'origin', branch], 180_000);
}

async function defaultCreatePr({ worktree, branch, title, body }) {
  const pr = await run('gh', [
    'pr', 'create', '--draft', '--base', 'main', '--head', branch,
    '--title', title, '--body', body,
  ], { cwd: worktree, timeoutMs: 120_000 });
  return pr.stdout.trim().split('\n').find((line) => /^https:\/\/github\.com\//.test(line)) || null;
}

async function cleanWorktree(repo, worktree) {
  await git(repo, ['worktree', 'remove', '--force', worktree], 60_000).catch(() => {});
  await rm(worktree, { recursive: true, force: true }).catch(() => {});
  await git(repo, ['worktree', 'prune'], 30_000).catch(() => {});
}

/* deps lets tests substitute the coding agent, remote publication and roots
   without touching real services. Production callers pass nothing. */
export async function codePatch(job, deps = {}) {
  const repoRoot = deps.repoRoot || REPO_ROOT;
  const worktreeRoot = deps.worktreeRoot || WORKTREE_ROOT;
  const runAgent = deps.runAgent || defaultRunAgent;
  const push = deps.push || defaultPush;
  const createPr = deps.createPr || defaultCreatePr;
  const target = String(job.target_id || '');
  const repo = targetPath(target, repoRoot);
  const short = String(job.id).replace(/-/g, '').slice(0, 12);
  const branch = `core/job-${short}`;
  const worktree = path.join(worktreeRoot, `job-${short}`);
  await mkdir(worktreeRoot, { recursive: true });

  await git(repo, ['fetch', '--prune', 'origin'], 120_000);
  await cleanWorktree(repo, worktree);
  await git(repo, ['branch', '-D', branch], 30_000).catch(() => {});
  await git(repo, ['worktree', 'add', '-b', branch, worktree, 'origin/main'], 120_000);
  const baseCommit = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();

  // Worktrees are shared with the separate mccluster-agent service account.
  await run('chmod', ['-R', 'g+rwX', worktree], { timeoutMs: 30_000 }).catch(() => {});

  let agent;
  try {
    agent = await runAgent({ worktree, prompt: promptFor(job) });
  } catch (error) {
    await cleanWorktree(repo, worktree);
    throw error;
  }

  const status = (await git(worktree, ['status', '--porcelain=v1', '-z'])).stdout;
  if (!splitNul(status).length) {
    await cleanWorktree(repo, worktree);
    return {
      executor: 'code_patch:v1',
      repo: target,
      branch,
      base_commit: baseCommit,
      changed: false,
      verification: { git_status_clean: true },
      model: MODEL,
      agent_output_tail: agent.stdout.slice(-12000),
    };
  }

  // The agent must not have moved HEAD or the branch while it ran.
  await assertUnchangedHead(worktree, baseCommit, branch, repo);

  const inventory = await inventoryChanges(worktree, baseCommit);
  const files = inventory.files;
  if (files.length > Number(process.env.MCCLUSTER_CODE_MAX_FILES || 75)) {
    await cleanWorktree(repo, worktree);
    throw new Error(`agent changed too many files (${files.length})`);
  }

  const forbidden = [...inventory.special, ...checkPaths(files, job.input?.allowed_paths)];
  if (forbidden.length) {
    await cleanWorktree(repo, worktree);
    throw new Error(`agent diff rejected by path policy: ${forbidden.slice(0, 12).join(', ')}`);
  }

  await git(worktree, ['add', '-A']);
  // Re-validate the exact tree that will be committed: the staged set must be
  // precisely the inventoried set and must contain no symlink/submodule entry.
  const staged = await inventoryChanges(worktree, baseCommit);
  const stagedSpecial = await stagedSpecialEntries(worktree, baseCommit);
  const stagedForbidden = [...staged.special, ...stagedSpecial, ...checkPaths(staged.files, job.input?.allowed_paths)];
  if (stagedForbidden.length || JSON.stringify(staged.files) !== JSON.stringify(files)) {
    await cleanWorktree(repo, worktree);
    throw new Error(`staged tree rejected by path policy: ${[...stagedForbidden, ...staged.files.filter((f) => !files.includes(f))].slice(0, 12).join(', ') || 'staged set differs from inventory'}`);
  }
  const stat = (await git(worktree, ['diff', '--cached', '--stat', baseCommit])).stdout.trim();
  await assertUnchangedHead(worktree, baseCommit, branch, repo);
  await run('git', [
    '-c', 'user.name=McCluster Core',
    '-c', 'user.email=core@mccluster.org',
    'commit', '-m', `core: autonomous job ${short}`,
  ], { cwd: worktree, timeoutMs: 120_000 });
  const commit = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  const parent = (await git(worktree, ['rev-parse', 'HEAD^'])).stdout.trim();
  if (parent !== baseCommit) {
    await cleanWorktree(repo, worktree);
    throw new Error(`produced commit does not sit on the recorded base (${parent} != ${baseCommit})`);
  }
  const committed = splitNul((await git(worktree, ['diff', '--name-only', '-z', '--no-renames', baseCommit, commit])).stdout).sort();
  if (JSON.stringify(committed) !== JSON.stringify(files)) {
    await cleanWorktree(repo, worktree);
    throw new Error('committed tree differs from the checked inventory');
  }
  const checkedTree = (await git(worktree, ['rev-parse', `${commit}^{tree}`])).stdout.trim();
  await git(worktree, ['diff', '--check', baseCommit, commit], 60_000).catch(() => {});

  let pushed = false;
  let prUrl = null;
  if (process.env.MCCLUSTER_PUSH_BRANCHES !== '0') {
    await push({ worktree, branch });
    pushed = true;
    try {
      const title = String(job.input?.title || job.input?.task || `Core job ${short}`).replace(/\s+/g, ' ').slice(0, 120);
      const body = [
        'Automated draft from McCluster Core.',
        '',
        `Job: ${job.id}`,
        `Model: ${MODEL}`,
        `Base commit: ${baseCommit}`,
        `Produced commit: ${commit}`,
        `Checked tree: ${checkedTree}`,
        '',
        'This PR is intentionally draft-only. Core does not auto-merge autonomous code.',
        '',
        'Agent-reported tail:',
        '```',
        agent.stdout.slice(-5000),
        '```',
      ].join('\n');
      prUrl = await createPr({ worktree, branch, title, body });
    } catch (error) {
      // A pushed branch is still durable progress. The digest will report that
      // PR creation needs attention rather than throwing away the work.
      prUrl = null;
    }
  }

  const output = {
    executor: 'code_patch:v1',
    repo: target,
    branch,
    base_commit: baseCommit,
    commit,
    changed: true,
    files,
    stat,
    pushed,
    draft_pr: prUrl,
    verification: { path_policy: 'complete-change-set:v2', checked_tree: checkedTree, staged_tree_revalidated: true },
    model: MODEL,
    agent_output_tail: agent.stdout.slice(-12000),
  };

  await cleanWorktree(repo, worktree);
  return output;
}
