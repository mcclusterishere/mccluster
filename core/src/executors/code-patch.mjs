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

function targetPath(target) {
  if (!TARGET.test(target)) throw new Error('code_patch target_id must be owner/repo');
  if (!DEFAULT_REPOS.has(target)) throw new Error(`code_patch repo is not allowlisted: ${target}`);
  return path.join(REPO_ROOT, target.split('/')[1]);
}

async function git(cwd, args, timeoutMs = 120_000) {
  return run('git', args, { cwd, timeoutMs });
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

async function cleanWorktree(repo, worktree) {
  await git(repo, ['worktree', 'remove', '--force', worktree], 60_000).catch(() => {});
  await rm(worktree, { recursive: true, force: true }).catch(() => {});
  await git(repo, ['worktree', 'prune'], 30_000).catch(() => {});
}

export async function codePatch(job) {
  const target = String(job.target_id || '');
  const repo = targetPath(target);
  const short = String(job.id).replace(/-/g, '').slice(0, 12);
  const branch = `core/job-${short}`;
  const worktree = path.join(WORKTREE_ROOT, `job-${short}`);
  await mkdir(WORKTREE_ROOT, { recursive: true });

  await git(repo, ['fetch', '--prune', 'origin'], 120_000);
  await cleanWorktree(repo, worktree);
  await git(repo, ['branch', '-D', branch], 30_000).catch(() => {});
  await git(repo, ['worktree', 'add', '-b', branch, worktree, 'origin/main'], 120_000);

  // Worktrees are shared with the separate mccluster-agent service account.
  await run('chmod', ['-R', 'g+rwX', worktree], { timeoutMs: 30_000 }).catch(() => {});

  let agent;
  try {
    agent = await run(OPENCODE, [
      'run',
      '--attach', ATTACH,
      '--dir', worktree,
      '--model', MODEL,
      '--agent', process.env.MCCLUSTER_OPENCODE_AGENT || 'build',
      '--format', 'json',
      '--auto',
      promptFor(job),
    ], {
      timeoutMs: Number(process.env.MCCLUSTER_CODE_TIMEOUT_MS || 45 * 60_000),
      env: {
        OPENCODE_SERVER_PASSWORD: process.env.OPENCODE_SERVER_PASSWORD || '',
        OPENCODE_SERVER_USERNAME: process.env.OPENCODE_SERVER_USERNAME || 'opencode',
      },
    });
  } catch (error) {
    await cleanWorktree(repo, worktree);
    throw error;
  }

  const status = (await git(worktree, ['status', '--porcelain=v1'])).stdout.trim();
  if (!status) {
    await cleanWorktree(repo, worktree);
    return {
      executor: 'code_patch:v1',
      repo: target,
      branch,
      changed: false,
      model: MODEL,
      agent_output_tail: agent.stdout.slice(-12000),
    };
  }

  const names = (await git(worktree, ['diff', '--name-only'])).stdout.trim().split('\n').filter(Boolean);
  const untracked = status.split('\n').filter((line) => line.startsWith('?? ')).map((line) => line.slice(3));
  const files = [...new Set([...names, ...untracked])];
  if (files.length > Number(process.env.MCCLUSTER_CODE_MAX_FILES || 75)) {
    await cleanWorktree(repo, worktree);
    throw new Error(`agent changed too many files (${files.length})`);
  }

  const forbidden = checkPaths(files, job.input?.allowed_paths);
  if (forbidden.length) {
    await cleanWorktree(repo, worktree);
    throw new Error(`agent diff rejected by path policy: ${forbidden.slice(0, 12).join(', ')}`);
  }

  const stat = (await git(worktree, ['diff', '--stat'])).stdout.trim();
  await git(worktree, ['add', '-A']);
  await run('git', [
    '-c', 'user.name=McCluster Core',
    '-c', 'user.email=core@mccluster.org',
    'commit', '-m', `core: autonomous job ${short}`,
  ], { cwd: worktree, timeoutMs: 120_000 });
  const commit = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();

  let pushed = false;
  let prUrl = null;
  if (process.env.MCCLUSTER_PUSH_BRANCHES !== '0') {
    await git(worktree, ['push', '-u', 'origin', branch], 180_000);
    pushed = true;
    try {
      const title = String(job.input?.title || job.input?.task || `Core job ${short}`).replace(/\s+/g, ' ').slice(0, 120);
      const body = [
        'Automated draft from McCluster Core.',
        '',
        `Job: ${job.id}`,
        `Model: ${MODEL}`,
        '',
        'This PR is intentionally draft-only. Core does not auto-merge autonomous code.',
        '',
        'Agent-reported tail:',
        '```',
        agent.stdout.slice(-5000),
        '```',
      ].join('\n');
      const pr = await run('gh', [
        'pr', 'create', '--draft', '--base', 'main', '--head', branch,
        '--title', title, '--body', body,
      ], { cwd: worktree, timeoutMs: 120_000 });
      prUrl = pr.stdout.trim().split('\n').find((line) => /^https:\/\/github\.com\//.test(line)) || null;
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
    commit,
    changed: true,
    files,
    stat,
    pushed,
    draft_pr: prUrl,
    model: MODEL,
    agent_output_tail: agent.stdout.slice(-12000),
  };

  await cleanWorktree(repo, worktree);
  return output;
}
