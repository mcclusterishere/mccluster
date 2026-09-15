import path from 'node:path';
import { access } from 'node:fs/promises';
import { run } from '../process.mjs';

const REPO_ROOT = process.env.MCCLUSTER_REPO_ROOT || '/srv/mccluster/repos';
const TARGET = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function repoPath(target) {
  if (!TARGET.test(String(target || ''))) throw new Error('repo_health target_id must be owner/repo');
  return path.join(REPO_ROOT, target.split('/')[1]);
}

async function exists(file) {
  try { await access(file); return true; }
  catch { return false; }
}

async function git(cwd, args, timeoutMs = 60_000) {
  const result = await run('git', args, { cwd, timeoutMs });
  return result.stdout.trim();
}

export async function repoHealth(job) {
  const target = String(job.target_id || '');
  const cwd = repoPath(target);
  if (!(await exists(path.join(cwd, '.git')))) throw new Error(`repository not cloned at ${cwd}`);

  if (process.env.MCCLUSTER_GIT_FETCH !== '0') {
    await run('git', ['fetch', '--prune', 'origin'], { cwd, timeoutMs: 120_000 });
  }

  const [branch, head, status, remoteMain] = await Promise.all([
    git(cwd, ['branch', '--show-current']).catch(() => ''),
    git(cwd, ['rev-parse', 'HEAD']),
    git(cwd, ['status', '--porcelain=v1']),
    git(cwd, ['rev-parse', '--verify', 'origin/main']).catch(() => ''),
  ]);

  let ahead = null;
  let behind = null;
  if (remoteMain) {
    const counts = await git(cwd, ['rev-list', '--left-right', '--count', `${head}...origin/main`]).catch(() => '');
    const [left, right] = counts.split(/\s+/).map(Number);
    if (Number.isFinite(left) && Number.isFinite(right)) {
      ahead = left;
      behind = right;
    }
  }

  const recent = await git(cwd, ['log', '-5', '--pretty=format:%h\t%aI\t%s']).catch(() => '');
  const output = {
    executor: 'repo_health:v1',
    repo: target,
    path: cwd,
    branch,
    head,
    origin_main: remoteMain || null,
    ahead_of_origin_main: ahead,
    behind_origin_main: behind,
    clean: status.length === 0,
    changes: status ? status.split('\n').slice(0, 100) : [],
    recent_commits: recent ? recent.split('\n').map((line) => {
      const [sha, date, ...subject] = line.split('\t');
      return { sha, date, subject: subject.join('\t') };
    }) : [],
    tests: { requested: Boolean(job.input?.tests), ran: false, ok: null, reason: null },
  };

  if (job.input?.tests) {
    const workerDir = path.join(cwd, 'workers', 'mccluster');
    if (await exists(path.join(workerDir, 'package.json')) && await exists(path.join(workerDir, 'node_modules'))) {
      try {
        const result = await run('npm', ['test'], { cwd: workerDir, timeoutMs: 15 * 60_000 });
        output.tests = {
          requested: true,
          ran: true,
          ok: true,
          duration_ms: result.duration_ms,
          stdout_tail: result.stdout.slice(-12000),
          stderr_tail: result.stderr.slice(-4000),
        };
      } catch (error) {
        output.tests = {
          requested: true,
          ran: true,
          ok: false,
          duration_ms: error.result?.duration_ms ?? null,
          stdout_tail: String(error.result?.stdout || '').slice(-12000),
          stderr_tail: String(error.result?.stderr || '').slice(-8000),
        };
      }
    } else {
      output.tests.reason = 'worker dependencies not installed; Core never runs npm install implicitly during a health check';
    }
  }

  if (job.input?.dependency_review) {
    output.dependency_review = {
      requested: true,
      ran: false,
      reason: 'networked package-audit commands are intentionally not part of repo_health:v1',
    };
  }

  return output;
}
