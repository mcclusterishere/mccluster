import path from 'node:path';
import { access, mkdir, rm } from 'node:fs/promises';
import { run } from '../process.mjs';

const REPO_ROOT = process.env.MCCLUSTER_REPO_ROOT || '/srv/mccluster/repos';
const WORKTREE_ROOT = process.env.MCCLUSTER_WORKTREE_ROOT || '/srv/mccluster/worktrees';
const VERCEL = process.env.MCCLUSTER_VERCEL_BIN || 'vercel';
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF = /^[A-Za-z0-9._/-]{1,240}$/;

function text(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function repoPath(target) {
  if (!REPO.test(target)) throw new Error('preview_deploy target_id must be owner/repo');
  return path.join(REPO_ROOT, target.split('/')[1]);
}

function relativeDirectory(value) {
  const raw = text(value || '.', 1000).replace(/^\.\//, '');
  if (path.isAbsolute(raw) || raw.split('/').some((part) => part === '..')) throw new Error('preview directory must stay inside repository');
  return raw || '.';
}

async function git(cwd, args, timeoutMs = 120_000) {
  return run('git', args, { cwd, timeoutMs });
}

async function cleanup(repo, worktree) {
  await git(repo, ['worktree', 'remove', '--force', worktree], 60_000).catch(() => {});
  await rm(worktree, { recursive: true, force: true }).catch(() => {});
  await git(repo, ['worktree', 'prune'], 30_000).catch(() => {});
}

function previewUrl(stdout) {
  return String(stdout || '').split(/\r?\n/).map((line) => line.trim()).find((line) => /^https:\/\/[a-z0-9.-]+\.vercel\.app(?:\/.*)?$/i.test(line)) || null;
}

export async function previewDeploy(job) {
  if (!process.env.VERCEL_TOKEN) {
    throw Object.assign(new Error('deploy.preview is implemented but unavailable: VERCEL_TOKEN is not configured on this Core host'), { code: 'PREVIEW_PROVIDER_NOT_CONFIGURED' });
  }

  const target = String(job.target_id || job.input?.repository || '');
  const repo = repoPath(target);
  const ref = text(job.input?.ref || 'main', 240);
  if (!REF.test(ref) || ref.includes('..')) throw new Error('preview ref is invalid');
  const directory = relativeDirectory(job.input?.directory || '.');
  const short = String(job.id || Date.now()).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  const worktree = path.join(WORKTREE_ROOT, `preview-${short}`);
  await mkdir(WORKTREE_ROOT, { recursive: true });

  await git(repo, ['fetch', '--prune', 'origin'], 120_000);
  await cleanup(repo, worktree);
  const candidate = ref === 'main' ? 'origin/main' : `origin/${ref.replace(/^origin\//, '')}`;
  await git(repo, ['worktree', 'add', '--detach', worktree, candidate], 120_000);

  const deployDir = path.resolve(worktree, directory);
  if (!(deployDir === worktree || deployDir.startsWith(`${worktree}${path.sep}`))) {
    await cleanup(repo, worktree);
    throw new Error('preview directory escaped worktree');
  }
  await access(deployDir);

  let result;
  try {
    result = await run(VERCEL, ['deploy', deployDir, '--yes'], {
      cwd: worktree,
      timeoutMs: Number(process.env.MCCLUSTER_PREVIEW_TIMEOUT_MS || 20 * 60_000),
      env: {
        VERCEL_TOKEN: process.env.VERCEL_TOKEN,
        VERCEL_ORG_ID: process.env.VERCEL_ORG_ID || '',
        VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID || ''
      }
    });
  } finally {
    await cleanup(repo, worktree);
  }

  const url = previewUrl(result.stdout) || previewUrl(result.stderr);
  if (!url) throw new Error('Vercel preview deployment completed without a verifiable preview URL');

  return {
    executor: 'preview_deploy:v1',
    summary: `Created non-production preview for ${target}@${ref}.`,
    repository: target,
    ref,
    directory,
    provider: 'vercel',
    preview_url: url,
    production: false,
    safety: {
      production_flag_used: false,
      auto_merge: false,
      source_ref_mutated: false
    }
  };
}
