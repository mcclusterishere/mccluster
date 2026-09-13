import path from 'node:path';
import { readdir, access, mkdir, rm } from 'node:fs/promises';
import { run } from '../process.mjs';
import { addSignal } from '../supabase.mjs';

const REPO_ROOT = process.env.MCCLUSTER_REPO_ROOT || '/srv/mccluster/repos';
const WORKTREE_ROOT = process.env.MCCLUSTER_WORKTREE_ROOT || '/srv/mccluster/worktrees';
const GODOT = process.env.MCCLUSTER_GODOT_BIN || 'godot';
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF = /^[A-Za-z0-9._/-]{1,240}$/;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.godot', 'vendor', 'dist', 'build']);

function text(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function repoPath(target) {
  if (!REPO.test(target)) throw new Error('game_branch_smoke target_id must be owner/repo');
  return path.join(REPO_ROOT, target.split('/')[1]);
}

async function git(cwd, args, timeoutMs = 120_000) {
  return run('git', args, { cwd, timeoutMs });
}

async function cleanup(repo, worktree) {
  await git(repo, ['worktree', 'remove', '--force', worktree], 60_000).catch(() => {});
  await rm(worktree, { recursive: true, force: true }).catch(() => {});
  await git(repo, ['worktree', 'prune'], 30_000).catch(() => {});
}

async function findGodotProject(root, depth = 0) {
  if (depth > 5) return null;
  try {
    await access(path.join(root, 'project.godot'));
    return root;
  } catch {}
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const found = await findGodotProject(path.join(root, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

export async function gameBranchSmoke(job) {
  const input = job.input || {};
  const orgId = job.org_id || input.org_id;
  const target = String(job.target_id || input.repository || '');
  const repo = repoPath(target);
  const branch = text(input.branch, 240);
  if (!REF.test(branch) || branch.includes('..')) throw new Error('game_branch_smoke branch is invalid');
  const short = String(job.id || Date.now()).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  const worktree = path.join(WORKTREE_ROOT, `game-smoke-${short}`);
  await mkdir(WORKTREE_ROOT, { recursive: true });

  await git(repo, ['fetch', '--prune', 'origin'], 120_000);
  await cleanup(repo, worktree);
  const remoteRef = `origin/${branch.replace(/^origin\//, '')}`;
  await git(repo, ['worktree', 'add', '--detach', worktree, remoteRef], 120_000);

  let evidence;
  try {
    const project = await findGodotProject(worktree);
    if (!project) throw new Error(`No project.godot found on ${target}@${branch}`);
    const commit = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
    const importResult = await run(GODOT, ['--headless', '--path', project, '--editor', '--quit'], {
      cwd: project,
      timeoutMs: Number(process.env.MCCLUSTER_GODOT_IMPORT_TIMEOUT_MS || 5 * 60_000)
    });

    let launchResult = null;
    try {
      launchResult = await run(GODOT, ['--headless', '--path', project, '--quit-after', '120'], {
        cwd: project,
        timeoutMs: Number(process.env.MCCLUSTER_GODOT_SMOKE_TIMEOUT_MS || 60_000)
      });
    } catch (error) {
      launchResult = error.result || { stdout: '', stderr: error.message, code: null, duration_ms: null };
      throw Object.assign(new Error(`Godot branch launch smoke failed: ${String(launchResult.stderr || error.message).slice(-2000)}`), {
        smoke_evidence: { commit, project, import_result: importResult, launch_result: launchResult }
      });
    }

    evidence = {
      repository: target,
      branch,
      commit,
      project_path: path.relative(worktree, project) || '.',
      godot_binary: GODOT,
      import: {
        ok: true,
        duration_ms: importResult.duration_ms,
        stdout_tail: importResult.stdout.slice(-8000),
        stderr_tail: importResult.stderr.slice(-8000)
      },
      launch: {
        ok: true,
        duration_ms: launchResult.duration_ms,
        stdout_tail: launchResult.stdout.slice(-8000),
        stderr_tail: launchResult.stderr.slice(-8000)
      }
    };
  } finally {
    await cleanup(repo, worktree);
  }

  if (orgId) {
    await addSignal({
      orgId,
      kind: 'game_studio.implementation_validated',
      severity: 'info',
      body: `${input.campaign || 'PRIM3'} autonomous implementation branch ${branch} imported and launched successfully in Godot.`,
      metadata: {
        campaign: input.campaign || 'PRIM3',
        iteration: input.iteration || null,
        approval_packet: input.approval_packet || null,
        evidence,
        next_decision: 'Review branch/evidence; approve for preview deployment or reject with revision notes.'
      }
    });
  }

  return {
    executor: 'game_branch_smoke:v1',
    summary: `Validated ${target}@${branch} with Godot import + launch smoke.`,
    state: 'implementation_validated',
    evidence,
    safety: { production_mutation: false, merge: false, deploy: false }
  };
}
