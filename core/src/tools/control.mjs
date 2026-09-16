import { randomUUID } from 'node:crypto';
import { repoHealth } from '../executors/repo-health.mjs';
import { enqueueJob } from '../supabase.mjs';
import { researchWeb } from './research.mjs';

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

const BASE_TOOLS = [
  {
    name: 'core.repo.inspect', title: 'Inspect repository',
    description: 'Read cloned repository state and optionally run already-installed contract tests without modifying source.',
    inputSchema: { type: 'object', required: ['repository'], properties: { repository: { type: 'string' }, tests: { type: 'boolean' }, dependency_review: { type: 'boolean' } }, additionalProperties: false }
  },
  {
    name: 'core.objective.plan', title: 'Plan bounded objective DAG',
    description: 'Queue a dependency-aware plan of safe unattended analysis/inspection work. The planner cannot create code, deploy, communicate, spend, or mutate production.',
    inputSchema: { type: 'object', required: ['org_id', 'objective'], properties: { org_id: { type: 'string' }, objective: { type: 'string' }, target_id: { type: 'string' }, max_steps: { type: 'integer', minimum: 1, maximum: 12 }, since_hours: { type: 'integer', minimum: 1, maximum: 168 }, priority: { type: 'number' } }, additionalProperties: false }
  },
  {
    name: 'core.code.build', title: 'Build code change',
    description: 'Queue an isolated autonomous code change that can produce a draft branch/PR but never auto-merge.',
    inputSchema: { type: 'object', required: ['org_id', 'repository', 'task'], properties: { org_id: { type: 'string' }, repository: { type: 'string' }, task: { type: 'string' }, title: { type: 'string' }, allowed_paths: { type: 'array', items: { type: 'string' } }, priority: { type: 'number' } } }
  },
  {
    name: 'core.game.build', title: 'Build game experience',
    description: 'Queue the durable PRIM3 autonomous production loop with budget and owner-review gates.',
    inputSchema: { type: 'object', required: ['org_id', 'brief'], properties: { org_id: { type: 'string' }, brief: { type: 'string' }, repository: { type: 'string' }, campaign: { type: 'string' }, budget_cents: { type: 'number', minimum: 0 }, preference: { type: 'string', enum: ['quality', 'balanced', 'speed', 'price'] }, priority: { type: 'number' } } }
  },
  {
    name: 'core.world.generate', title: 'Generate navigable world',
    description: 'Queue a world-focused PRIM3 production workflow that generates environment direction plus reusable 3D modules and requires owner approval before Godot implementation.',
    inputSchema: { type: 'object', required: ['org_id', 'prompt'], properties: { org_id: { type: 'string' }, prompt: { type: 'string' }, repository: { type: 'string' }, campaign: { type: 'string' }, budget_cents: { type: 'number', minimum: 0 }, preference: { type: 'string', enum: ['quality', 'balanced', 'speed', 'price'] }, references: { type: 'array' }, priority: { type: 'number' } } }
  },
  {
    name: 'core.research.web', title: 'Research the public web',
    description: 'Run bounded public web discovery with timestamped provenance, preferring a configured search API and falling back to no-key public search.',
    inputSchema: { type: 'object', required: ['objective'], properties: { objective: { type: 'string' }, source_constraints: { type: 'object' }, limit: { type: 'integer', minimum: 1, maximum: 10 } } }
  },
  {
    name: 'core.deploy.preview', title: 'Deploy self-hosted preview',
    description: 'Build an approved repository ref on McCluster-owned compute and publish a temporary non-production preview without a third-party deployment provider.',
    inputSchema: {
      type: 'object',
      required: ['org_id', 'repository', 'ref'],
      properties: {
        org_id: { type: 'string' },
        repository: { type: 'string' },
        ref: { type: 'string' },
        directory: { type: 'string' },
        output_dir: { type: 'string' },
        ttl_hours: { type: 'number', minimum: 1, maximum: 168 },
        priority: { type: 'number' }
      }
    }
  }
];

export const CONTROL_TOOLS = Object.freeze(BASE_TOOLS);

export async function callControlTool(name, args = {}) {
  if (name === 'core.repo.inspect') {
    const repository = requireRepo(args.repository);
    return repoHealth({ id: `tool-${randomUUID()}`, target_id: repository, input: { tests: args.tests === true, dependency_review: args.dependency_review === true } });
  }

  if (name === 'core.research.web') return researchWeb(args);

  if (name === 'core.objective.plan') {
    const orgId = requireOrg(args.org_id);
    const objective = text(args.objective, 12_000);
    if (!objective) throw Object.assign(new Error('objective is required'), { status: 400 });
    const targetId = text(args.target_id || 'McCluster', 500) || 'McCluster';
    const maxSteps = Math.min(12, Math.max(1, Number(args.max_steps || 8)));
    const sinceHours = Math.min(168, Math.max(1, Number(args.since_hours || 48)));
    const job = await enqueueJob({
      orgId,
      jobType: 'objective_plan',
      targetType: 'objective',
      targetId,
      priority: Math.min(100, Math.max(0, Number(args.priority ?? 70))),
      maxAttempts: 3,
      input: { objective, max_steps: maxSteps, since_hours: sinceHours },
    });
    return {
      queued: true,
      job_id: job.id,
      job_type: job.job_type,
      objective,
      max_steps: maxSteps,
      safety: {
        child_job_types: ['repo_health', 'local_analysis'],
        code_changes: false,
        deploys: false,
        communications: false,
        spending: false,
        production_mutation: false,
      },
    };
  }

  if (name === 'core.code.build') {
    const orgId = requireOrg(args.org_id);
    const repository = requireRepo(args.repository);
    const task = text(args.task);
    if (!task) throw Object.assign(new Error('task is required'), { status: 400 });
    const job = await enqueueJob({ orgId, jobType: 'code_patch', targetType: 'repository', targetId: repository, priority: Math.min(100, Math.max(0, Number(args.priority ?? 80))), maxAttempts: 2, input: { task, title: text(args.title, 500), allowed_paths: Array.isArray(args.allowed_paths) ? args.allowed_paths.slice(0, 100) : [] } });
    return { queued: true, job_id: job.id, job_type: job.job_type, repository, safety: { auto_merge: false, production_deploy: false, isolated_worktree: true } };
  }

  if (name === 'core.game.build') {
    const orgId = requireOrg(args.org_id);
    const brief = text(args.brief);
    if (!brief) throw Object.assign(new Error('brief is required'), { status: 400 });
    const repository = requireRepo(args.repository || 'mcclusterishere/hitmans-halo');
    const campaign = text(args.campaign || 'PRIM3', 200);
    const job = await enqueueJob({ orgId, jobType: 'game_studio_cycle', targetType: 'campaign', targetId: campaign, priority: Math.min(100, Math.max(0, Number(args.priority ?? 80))), maxAttempts: 3, input: { brief, repository, campaign, budget_cents: Math.max(0, Number(args.budget_cents || 0)), preference: text(args.preference || 'quality', 50), iteration: 1 } });
    return { queued: true, job_id: job.id, job_type: job.job_type, campaign, repository, state: 'production_queued', safety: { budget_gated: true, owner_review_gated: true, auto_merge: false, production_deploy: false } };
  }

  if (name === 'core.world.generate') {
    const orgId = requireOrg(args.org_id);
    const prompt = text(args.prompt);
    if (!prompt) throw Object.assign(new Error('prompt is required'), { status: 400 });
    const repository = requireRepo(args.repository || 'mcclusterishere/hitmans-halo');
    const campaign = text(args.campaign || 'PRIM3', 200);
    const deliverables = [
      { id: 'world-keyframe', label: 'World environment keyframe', capability: 'text-to-image', prompt_suffix: 'wide cinematic environment concept, clear traversal routes, landmarks, cover, verticality and navigable tactical composition, no text' },
      { id: 'world-module-a', label: 'World modular 3D kit A', capability: 'text-to-3d', prompt_suffix: 'single modular architectural/environment kit piece, fully textured, realistic, clean topology intent, suitable for repeated Godot placement as GLB' },
      { id: 'world-module-b', label: 'World modular 3D kit B', capability: 'text-to-3d', prompt_suffix: 'single complementary modular world prop or structure, fully textured, realistic, gameplay-readable silhouette, suitable for Godot import as GLB' }
    ];
    const job = await enqueueJob({ orgId, jobType: 'game_studio_cycle', targetType: 'world', targetId: campaign, priority: Math.min(100, Math.max(0, Number(args.priority ?? 85))), maxAttempts: 3, input: { brief: prompt, repository, campaign, budget_cents: Math.max(0, Number(args.budget_cents || 0)), preference: text(args.preference || 'quality', 50), references: Array.isArray(args.references) ? args.references.slice(0, 20) : [], deliverables, phase: 'world_generation', iteration: 1 } });
    return { queued: true, job_id: job.id, job_type: job.job_type, campaign, repository, state: 'world_generation_queued', expected_flow: ['generate concept + GLBs', 'owner review', 'isolated Godot implementation', 'build/playtest evidence'], safety: { budget_gated: true, owner_review_gated: true, auto_merge: false, production_deploy: false } };
  }

  if (name === 'core.deploy.preview') {
    const orgId = requireOrg(args.org_id);
    const repository = requireRepo(args.repository);
    const ref = text(args.ref, 240);
    if (!ref) throw Object.assign(new Error('ref is required'), { status: 400 });
    const job = await enqueueJob({
      orgId,
      jobType: 'preview_deploy',
      targetType: 'repository',
      targetId: repository,
      priority: Math.min(100, Math.max(0, Number(args.priority ?? 90))),
      maxAttempts: 2,
      input: {
        repository,
        ref,
        directory: text(args.directory || '.', 1000),
        output_dir: args.output_dir ? text(args.output_dir, 1000) : null,
        ttl_hours: Math.max(1, Math.min(168, Number(args.ttl_hours || 24)))
      }
    });
    return {
      queued: true,
      job_id: job.id,
      job_type: job.job_type,
      repository,
      ref,
      provider: 'mccluster-core',
      hosting: 'owned',
      production: false
    };
  }

  throw Object.assign(new Error(`Unknown control tool: ${name}`), { status: 404 });
}
