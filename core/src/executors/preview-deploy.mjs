import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { run } from '../process.mjs';
import { PREVIEW_ROOT, PUBLIC_BASE, previewConfigured, confinedPath, relativeDirectory, publishAssets, rejectBuildSymlinks } from '../preview-policy.mjs';

const REPO_ROOT = process.env.MCCLUSTER_REPO_ROOT || '/srv/mccluster/repos';
const WORKTREE_ROOT = process.env.MCCLUSTER_WORKTREE_ROOT || '/srv/mccluster/worktrees';
const ALLOWED = new Set(String(process.env.MCCLUSTER_CODE_REPOS || 'mcclusterishere/mccluster').split(',').map(s => s.trim()));
const git = (cwd, args) => run('git', args, { cwd, timeoutMs: 120000 });
async function exists(file) { try { await access(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }

export async function previewDeploy(job) {
  if (!previewConfigured()) throw new Error('Self-hosted preview is not configured: enable it and set an HTTPS public base');
  const repository = String(job.target_id || job.input?.repository || '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !ALLOWED.has(repository)) throw new Error('Preview repository is not allowlisted');
  const ref = String(job.input?.ref || '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,239}$/.test(ref) || ref.includes('..')) throw new Error('preview ref is invalid');
  const directory = relativeDirectory(job.input?.directory || '.');
  const ttl = Number(job.input?.ttl_hours ?? 24);
  if (!Number.isFinite(ttl) || ttl < 1 || ttl > 168) throw new Error('Preview TTL must be between 1 and 168 hours');
  const repo = await confinedPath(REPO_ROOT, repository.split('/')[1]);
  await git(repo, ['fetch', '--prune', 'origin']);
  // Resolve fetched branches before local branches, and pin work to one immutable commit.
  const candidate = /^[a-f0-9]{40}$/.test(ref) ? ref : `refs/remotes/origin/${ref.replace(/^origin\//, '')}`;
  const commit = (await git(repo, ['rev-parse', '--verify', `${candidate}^{commit}`])).stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Preview ref did not resolve to an exact commit');
  if (!job.id) throw new Error('Durable preview job id is required');
  const slug = 'preview-' + createHash('sha256').update(`${job.id}:${repository}:${commit}`).digest('hex').slice(0, 40);
  const final = path.join(PREVIEW_ROOT, slug);
  // Repeated delivery of the same durable job is idempotent.
  if (await exists(path.join(final, 'metadata.json'))) {
    const existing = JSON.parse(await readFile(path.join(final, 'metadata.json'), 'utf8'));
    if (existing.commit === commit && existing.job_id === job.id && Date.parse(existing.expires_at) > Date.now()) return existing;
    throw new Error('Preview already exists but is expired or invalid; submit a new job');
  }
  await mkdir(WORKTREE_ROOT, { recursive: true });
  await mkdir(PREVIEW_ROOT, { recursive: true });
  const buildId = randomUUID().replaceAll('-', '');
  const worktree = path.join(WORKTREE_ROOT, `preview-${buildId}`);
  const stage = await mkdtemp(path.join(PREVIEW_ROOT, '.staging-'));
  let attached = false;
  try {
    await git(repo, ['worktree', 'add', '--detach', worktree, commit]); attached = true;
    const project = await confinedPath(worktree, directory);
    const packagePath = path.join(project, 'package.json');
    if (await exists(packagePath)) {
      const pkg = JSON.parse(await readFile(await confinedPath(project, 'package.json'), 'utf8'));
      if (pkg.scripts?.build) {
        // The systemd template is root-controlled and runs as a different user.
        // Polkit permits only starting a 32-hex build instance; Core retains NoNewPrivileges.
        if (WORKTREE_ROOT !== '/srv/mccluster/worktrees') throw new Error('Build worktree root must match the installed sandbox unit');
        await rejectBuildSymlinks(worktree);
        await writeFile(path.join(worktree, '.mccluster-preview-build.json'), JSON.stringify({ directory }));
        await run('chgrp', ['-R', 'mccluster-work', worktree]);
        await run('chmod', ['-R', 'g+rwX', worktree]);
        await run('systemctl', ['start', `mccluster-preview-build@${buildId}.service`], { timeoutMs: 21 * 60000 });
      }
    }
    const choices = job.input?.output_dir ? [relativeDirectory(job.input.output_dir)] : ['dist','build','out','.output/public','public','.'];
    let source, outputDir;
    for (const choice of choices) {
      if (!await exists(path.join(project, choice, 'index.html'))) continue;
      source = await confinedPath(project, choice);
      await confinedPath(source, 'index.html'); outputDir = choice; break;
    }
    if (!source) throw new Error('Preview requires static index.html output; dynamic server output is unsupported');
    const publicDir = path.join(stage, 'public');
    await mkdir(publicDir);
    const published = await publishAssets(source, publicDir);
    const created = new Date();
    const metadata = {
      executor: 'preview_deploy:v2-selfhosted', schema_version: 1, job_id: job.id, slug, repository, ref, commit,
      directory, output_dir: outputDir, created_at: created.toISOString(),
      expires_at: new Date(created.getTime() + ttl * 3600000).toISOString(), ttl_hours: ttl,
      provider: 'mccluster-core', hosting: 'owned', production: false, preview_url: `${PUBLIC_BASE}/${slug}/`,
      published, safety: { auto_merge: false, source_ref_mutated: false, inherited_core_secrets: false, symlink_output_allowed: false }
    };
    await writeFile(path.join(stage, 'metadata.json'), JSON.stringify(metadata) + '\n', { mode: 0o640 });
    await rename(stage, final); // Publish complete files and metadata together.
    return metadata;
  } finally {
    if (attached) await git(repo, ['worktree', 'remove', '--force', worktree]);
    await rm(stage, { recursive: true, force: true });
  }
}
