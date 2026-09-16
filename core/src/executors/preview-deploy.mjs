import path from 'node:path';
import { access, cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { run } from '../process.mjs';

const REPO_ROOT = process.env.MCCLUSTER_REPO_ROOT || '/srv/mccluster/repos';
const WORKTREE_ROOT = process.env.MCCLUSTER_WORKTREE_ROOT || '/srv/mccluster/worktrees';
const PREVIEW_ROOT = process.env.MCCLUSTER_PREVIEW_ROOT || '/var/lib/mccluster-core/previews';
const PREVIEW_PUBLIC_BASE = String(process.env.MCCLUSTER_PREVIEW_PUBLIC_BASE || 'https://preview.mccluster.org/p').replace(/\/+$/, '');
const PREVIEW_TIMEOUT_MS = Number(process.env.MCCLUSTER_PREVIEW_TIMEOUT_MS || 20 * 60_000);
const PREVIEW_TTL_HOURS = Number(process.env.MCCLUSTER_PREVIEW_TTL_HOURS || 24);
const PREVIEW_MAX_TTL_HOURS = Number(process.env.MCCLUSTER_PREVIEW_MAX_TTL_HOURS || 168);
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF = /^[A-Za-z0-9._/-]{1,240}$/;

function text(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function repoPath(target) {
  if (!REPO.test(target)) throw new Error('preview_deploy target_id must be owner/repo');
  return path.join(REPO_ROOT, target.split('/')[1]);
}

function relativeDirectory(value, label = 'preview directory') {
  const raw = text(value || '.', 1000).replace(/^\.\//, '');
  if (path.isAbsolute(raw) || raw.split('/').some((part) => part === '..')) {
    throw new Error(`${label} must stay inside repository`);
  }
  return raw || '.';
}

function previewSlug(target, commit, jobId) {
  const repo = target.split('/')[1].toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const job = String(jobId || Date.now()).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  return `${repo}-${commit.slice(0, 8)}-${job}`.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 72);
}

function ttlHours(value) {
  const requested = Number(value ?? PREVIEW_TTL_HOURS);
  const finite = Number.isFinite(requested) ? requested : PREVIEW_TTL_HOURS;
  return Math.max(1, Math.min(PREVIEW_MAX_TTL_HOURS, finite));
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function git(cwd, args, timeoutMs = 120_000) {
  return run('git', args, { cwd, timeoutMs });
}

async function cleanup(repo, worktree) {
  await git(repo, ['worktree', 'remove', '--force', worktree], 60_000).catch(() => {});
  await rm(worktree, { recursive: true, force: true }).catch(() => {});
  await git(repo, ['worktree', 'prune'], 30_000).catch(() => {});
}

async function resolveCommit(repo, ref) {
  await git(repo, ['fetch', '--prune', '--tags', 'origin'], 120_000);
  const candidates = [
    ref,
    `origin/${ref.replace(/^origin\//, '')}`,
    `refs/remotes/origin/${ref.replace(/^origin\//, '')}`,
    `refs/tags/${ref}`
  ];
  for (const candidate of candidates) {
    try {
      const result = await git(repo, ['rev-parse', '--verify', `${candidate}^{commit}`], 30_000);
      const commit = result.stdout.trim();
      if (commit) return commit;
    } catch {
      // Try the next valid ref shape.
    }
  }
  throw new Error(`Unable to resolve preview ref: ${ref}`);
}

async function readPackageJson(projectRoot) {
  const file = path.join(projectRoot, 'package.json');
  if (!await exists(file)) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid package.json: ${error.message}`);
  }
}

async function installDependencies(projectRoot) {
  if (await exists(path.join(projectRoot, 'pnpm-lock.yaml'))) {
    return run('pnpm', ['install', '--frozen-lockfile'], { cwd: projectRoot, timeoutMs: PREVIEW_TIMEOUT_MS, env: { CI: '1', NODE_ENV: 'development' } });
  }
  if (await exists(path.join(projectRoot, 'yarn.lock'))) {
    return run('yarn', ['install', '--frozen-lockfile'], { cwd: projectRoot, timeoutMs: PREVIEW_TIMEOUT_MS, env: { CI: '1', NODE_ENV: 'development' } });
  }
  if (await exists(path.join(projectRoot, 'bun.lockb')) || await exists(path.join(projectRoot, 'bun.lock'))) {
    return run('bun', ['install', '--frozen-lockfile'], { cwd: projectRoot, timeoutMs: PREVIEW_TIMEOUT_MS, env: { CI: '1', NODE_ENV: 'development' } });
  }
  if (await exists(path.join(projectRoot, 'package-lock.json'))) {
    return run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: projectRoot, timeoutMs: PREVIEW_TIMEOUT_MS, env: { CI: '1', NODE_ENV: 'development' } });
  }
  return run('npm', ['install', '--no-audit', '--no-fund'], { cwd: projectRoot, timeoutMs: PREVIEW_TIMEOUT_MS, env: { CI: '1', NODE_ENV: 'development' } });
}

async function findStaticOutput(projectRoot, explicitOutput) {
  const candidates = explicitOutput
    ? [relativeDirectory(explicitOutput, 'preview output directory')]
    : ['dist', 'build', 'out', '.output/public', 'public', '.'];

  for (const candidate of candidates) {
    const absolute = path.resolve(projectRoot, candidate);
    if (!(absolute === projectRoot || absolute.startsWith(`${projectRoot}${path.sep}`))) continue;
    if (!await exists(absolute)) continue;
    const info = await lstat(absolute);
    if (!info.isDirectory()) continue;
    if (candidate === '.' && !await exists(path.join(absolute, 'index.html'))) continue;
    if (candidate !== '.' && !await exists(path.join(absolute, 'index.html'))) continue;
    return { absolute, relative: candidate };
  }

  throw new Error('Preview build produced no static site. Expected index.html in dist, build, out, .output/public, public, or an explicit output_dir.');
}

async function rejectSymlinks(root) {
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const info = await lstat(full);
      if (info.isSymbolicLink()) throw new Error(`Preview output contains a symbolic link and was refused: ${path.relative(root, full)}`);
      if (info.isDirectory()) pending.push(full);
    }
  }
}

async function buildStaticPreview(projectRoot, explicitOutput) {
  const pkg = await readPackageJson(projectRoot);
  let install = null;
  let build = null;

  if (pkg) {
    install = await installDependencies(projectRoot);
    if (pkg.scripts?.build) {
      build = await run('npm', ['run', 'build'], {
        cwd: projectRoot,
        timeoutMs: PREVIEW_TIMEOUT_MS,
        env: { CI: '1', NODE_ENV: 'production' }
      });
    }
  }

  const output = await findStaticOutput(projectRoot, explicitOutput);
  await rejectSymlinks(output.absolute);
  return { output, install, build, package_name: pkg?.name || null };
}

export async function previewDeploy(job) {
  const target = String(job.target_id || job.input?.repository || '');
  const repo = repoPath(target);
  const ref = text(job.input?.ref || 'main', 240);
  if (!REF.test(ref) || ref.includes('..')) throw new Error('preview ref is invalid');
  const directory = relativeDirectory(job.input?.directory || '.');
  const outputDir = job.input?.output_dir ? relativeDirectory(job.input.output_dir, 'preview output directory') : null;
  const hours = ttlHours(job.input?.ttl_hours);

  await mkdir(WORKTREE_ROOT, { recursive: true });
  await mkdir(PREVIEW_ROOT, { recursive: true });
  await access(repo);

  const commit = await resolveCommit(repo, ref);
  const slug = previewSlug(target, commit, job.id);
  const worktree = path.join(WORKTREE_ROOT, `preview-${slug}`);
  const previewDir = path.join(PREVIEW_ROOT, slug);
  const publicDir = path.join(previewDir, 'public');

  await cleanup(repo, worktree);
  await git(repo, ['worktree', 'add', '--detach', worktree, commit], 120_000);

  const projectRoot = path.resolve(worktree, directory);
  if (!(projectRoot === worktree || projectRoot.startsWith(`${worktree}${path.sep}`))) {
    await cleanup(repo, worktree);
    throw new Error('preview directory escaped worktree');
  }

  let result;
  try {
    await access(projectRoot);
    result = await buildStaticPreview(projectRoot, outputDir);
    await rm(previewDir, { recursive: true, force: true });
    await mkdir(publicDir, { recursive: true });
    await cp(result.output.absolute, publicDir, { recursive: true, force: true, errorOnExist: false });

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + hours * 60 * 60 * 1000);
    const metadata = {
      schema_version: 1,
      slug,
      repository: target,
      ref,
      commit,
      directory,
      output_dir: result.output.relative,
      created_at: createdAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      provider: 'mccluster-core',
      hosting: 'owned',
      production: false
    };
    await writeFile(path.join(previewDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o640 });

    return {
      executor: 'preview_deploy:v2-selfhosted',
      summary: `Created self-hosted non-production preview for ${target}@${ref}.`,
      ...metadata,
      preview_url: `${PREVIEW_PUBLIC_BASE}/${slug}/`,
      ttl_hours: hours,
      build: {
        package_name: result.package_name,
        install_duration_ms: result.install?.duration_ms ?? null,
        build_duration_ms: result.build?.duration_ms ?? null,
        output_dir: result.output.relative
      },
      safety: {
        production_flag_used: false,
        auto_merge: false,
        source_ref_mutated: false,
        inherited_core_secrets: false,
        symlink_output_allowed: false
      }
    };
  } finally {
    await cleanup(repo, worktree);
  }
}
