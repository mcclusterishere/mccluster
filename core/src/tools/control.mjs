import { randomUUID } from 'node:crypto';
import { repoHealth } from '../executors/repo-health.mjs';
import { enqueueJob } from '../supabase.mjs';

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function text(value, max = 20000) {
  return String(value ?? '').trim().slice(0, max);
}

function requireRepo(value) {
  const repo = text(value, 500);
  if (!REPO.test(repo)) throw Object.assign(new Error('repository must be owner/repo'), { status: 400 });
  return repo;
}

function requireOrg(value) {
  const orgId = text(value, 100);
  if (!orgId) throw Object.assign(new Error('org_id is required'), { status: 400 });
  return orgId;
}

export const CONTROL_TOOLS = Object.freeze([
  {
    name: 'core.repo.inspect',
    title: 'Inspect repository',
    description: 'Read cloned repository state and optionally run already-installed contract tests without modifying source.',
    inputSchema: {
      type: 'object',
      required: ['repository'],
      properties: {
        repository: { type: 'string' },
        tests: { type: 'boolean' },
        dependency_review: { type: 'boolean' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'core.code.build',
    title: 'Build code change',
    description: 'Queue an isolated autonomous code change that can produce a draft branch/PR but never auto-merge.',
    inputSchema: {
      type: 'object',
      required: ['org_id', 'repository', 'task'],
      properties: {
        org_id: { type: 'string' },
        repository: { type: 'string' },
        task: { type: 'string' },
        title: { type: 'string' },
        allowed_paths: { type: 'array', items: { type: 'string' } },
        priority: { type: 'number' }
      }
    }
  },
  {
    name: 'core.game.build',
    title: 'Build game experience',
    description: 'Queue the durable PRIM3 autonomous production loop with budget and owner-review gates.',
    inputSchema: {
      type: 'object',
      required: ['org_id', 'brief'],
      properties: {
        org_id: { type: 'string' },
        brief: { type: 'string' },
        repository: { type: 'string' },
        campaign: { type: 'string' },
        budget_cents: { type: 'number', minimum: 0 },
        preference: { type: 'string', enum: ['quality', 'balanced', 'speed', 'price'] },
        priority: { type: 'number' }
      }
    }
  }
]);

export async function callControlTool(name, args = {}) {
  if (name === 'core.repo.inspect') {
    const repository = requireRepo(args.repository);
    return repoHealth({
      id: `tool-${randomUUID()}`,
      target_id: repository,
      input: {
        tests: args.tests === true,
        dependency_review: args.dependency_review === true
      }
    });
  }

  if (name === 'core.code.build') {
    const orgId = requireOrg(args.org_id);
    const repository = requireRepo(args.repository);
    const task = text(args.task);
    if (!task) throw Object.assign(new Error('task is required'), { status: 400 });
    const job = await enqueueJob({
      orgId,
      jobType: 'code_patch',
      targetType: 'repository',
      targetId: repository,
      priority: Math.min(100, Math.max(0, Number(args.priority ?? 80))),
      maxAttempts: 2,
      input: {
        task,
        title: text(args.title, 500),
        allowed_paths: Array.isArray(args.allowed_paths) ? args.allowed_paths.slice(0, 100) : []
      }
    });
    return {
      queued: true,
      job_id: job.id,
      job_type: job.job_type,
      repository,
      safety: { auto_merge: false, production_deploy: false, isolated_worktree: true }
    };
  }

  if (name === 'core.game.build') {
    const orgId = requireOrg(args.org_id);
    const brief = text(args.brief);
    if (!brief) throw Object.assign(new Error('brief is required'), { status: 400 });
    const repository = requireRepo(args.repository || 'mcclusterishere/hitmans-halo');
    const campaign = text(args.campaign || 'PRIM3', 200);
    const job = await enqueueJob({
      orgId,
      jobType: 'game_studio_cycle',
      targetType: 'campaign',
      targetId: campaign,
      priority: Math.min(100, Math.max(0, Number(args.priority ?? 80))),
      maxAttempts: 3,
      input: {
        brief,
        repository,
        campaign,
        budget_cents: Math.max(0, Number(args.budget_cents || 0)),
        preference: text(args.preference || 'quality', 50),
        iteration: 1
      }
    });
    return {
      queued: true,
      job_id: job.id,
      job_type: job.job_type,
      campaign,
      repository,
      state: 'production_queued',
      safety: { budget_gated: true, owner_review_gated: true, auto_merge: false, production_deploy: false }
    };
  }

  throw Object.assign(new Error(`Unknown control tool: ${name}`), { status: 404 });
}
