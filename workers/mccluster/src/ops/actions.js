/* ============================================================
   THE EXECUTOR.

   Catalogue entry in, provider call out. Everything between the two —
   who is asking, whether they may, whether a human approved it, what
   gets written down — happened in authority.js before this file runs.

   The one rule this file enforces on its own is target resolution: an
   action declaring `target: 'repo'` gets a repo node from the estate or
   it gets nothing. No handler here accepts a raw repository, hostname
   or zone from the caller.
   ============================================================ */

import { ACTIONS_BY_ID } from './catalog.js';
import { clampInt, opsError, text } from './lib.js';
import { disableNode, listNodes, loadEstate, resolveNode, upsertNode } from './estate.js';
import * as github from './providers/github.js';
import * as cloudflare from './providers/cloudflare.js';
import * as supabase from './providers/supabase-admin.js';
import * as ovh from './providers/ovh.js';
import * as site from './providers/site.js';

/* Which secrets each provider needs before any of its actions can run.
   The catalogue reports this so an operator sees "not configured yet"
   on the board instead of discovering it as a 503 mid-incident. */
export const PROVIDER_REQUIREMENTS = Object.freeze({
  github: { secrets: ['GITHUB_CONTROL_TOKEN'], configured: github.configured },
  cloudflare: { secrets: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'], configured: cloudflare.configured },
  supabase: { secrets: ['SUPABASE_MANAGEMENT_TOKEN'], configured: supabase.configured },
  ovh: {
    secrets: ['OVH_APPLICATION_KEY', 'OVH_APPLICATION_SECRET', 'OVH_CONSUMER_KEY'],
    configured: ovh.configured
  },
  /* Site probes and the estate itself need nothing beyond the Supabase
     service key the Worker already holds to exist at all. */
  site: { secrets: [], configured: () => true },
  estate: { secrets: [], configured: () => true },
  core: { secrets: [], configured: () => true }
});

export function providerStatus(env) {
  return Object.fromEntries(
    Object.entries(PROVIDER_REQUIREMENTS).map(([name, spec]) => [
      name,
      { configured: Boolean(spec.configured(env)), required_secrets: spec.secrets }
    ])
  );
}

/* ---- Core's queue --------------------------------------------------
   Core runs on the host and takes work from ops_agent_jobs. The control
   plane queues into that same table rather than inventing a second one,
   which is the AGENTS.md "no competing backend" rule at the level of a
   single table. */

const CORE_JOB_TYPES = new Set([
  'local_analysis', 'repo_health', 'objective_reflection', 'portfolio_plan',
  'host_health', 'code_patch', 'objective_plan', 'objective_synthesis',
  'game_studio_cycle', 'preview_deploy'
]);

function serviceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

async function listCoreJobs(env, orgId, params) {
  const limit = clampInt(params.limit, 20, 1, 100);
  const query = new URLSearchParams({
    org_id: `eq.${orgId}`,
    select: 'id,job_type,target_type,target_id,status,attempts,priority,last_error,created_at,updated_at',
    order: 'created_at.desc',
    limit: String(limit)
  });
  const status = text(params.status, 40);
  if (status) query.set('status', `eq.${status}`);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ops_agent_jobs?${query}`, { headers: serviceHeaders(env) });
  if (!res.ok) throw opsError('Could not read the Core queue', 502, { code: 'database_error', status: res.status });
  const rows = await res.json().catch(() => []);
  return {
    count: Array.isArray(rows) ? rows.length : 0,
    jobs: Array.isArray(rows) ? rows : []
  };
}

async function enqueueCoreJob(env, orgId, params) {
  const jobType = text(params.job_type, 80);
  if (!CORE_JOB_TYPES.has(jobType)) {
    throw opsError(`Core does not run a job type called ${jobType || '(empty)'}`, 400, {
      code: 'unsupported_job_type', allowed: [...CORE_JOB_TYPES]
    });
  }
  const body = {
    org_id: orgId,
    job_type: jobType,
    target_type: text(params.target_type, 120) || 'portfolio',
    target_id: text(params.target_id, 500) || 'McCluster',
    status: 'queued',
    priority: clampInt(params.priority, 50, 0, 100),
    input: params.input && typeof params.input === 'object' && !Array.isArray(params.input) ? params.input : {},
    max_attempts: 3
  };
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ops_agent_jobs`, {
    method: 'POST',
    headers: { ...serviceHeaders(env), prefer: 'return=representation' },
    body: JSON.stringify(body)
  });
  const rows = await res.json().catch(() => []);
  if (!res.ok || !rows?.length) {
    throw opsError('Could not queue the Core job', 502, { code: 'database_error', detail: rows });
  }
  return { queued: true, job: rows[0] };
}

/* ---- the handler table --------------------------------------------- */

const HANDLERS = {
  'ops.estate.list': ({ env, params }) => listNodes(env, params),
  'ops.estate.upsert': ({ env, params }) => upsertNode(env, params),
  'ops.estate.disable': ({ env, params }) => disableNode(env, params),

  'github.repo.state': ({ env, node }) => github.repoState(env, node),
  'github.branches.list': ({ env, node, params }) => github.listBranches(env, node, params),
  'github.commits.list': ({ env, node, params }) => github.listCommits(env, node, params),
  'github.file.read': ({ env, node, params }) => github.readFile(env, node, params),
  'github.pulls.list': ({ env, node, params }) => github.listPulls(env, node, params),
  'github.workflows.list': ({ env, node }) => github.listWorkflows(env, node),
  'github.runs.list': ({ env, node, params }) => github.listRuns(env, node, params),
  'github.branch.create': ({ env, node, params }) => github.createBranch(env, node, params),
  'github.file.write': ({ env, node, params }) => github.writeWorkingFile(env, node, params),
  'github.pr.open': ({ env, node, params }) => github.openPullRequest(env, node, params),
  'github.workflow.dispatch': ({ env, node, params }) => github.dispatchWorkflow(env, node, params),
  'github.run.rerun': ({ env, node, params }) => github.rerunRun(env, node, params),
  'github.file.write.protected': ({ env, node, params }) => github.writeProtectedFile(env, node, params),
  'github.pr.merge': ({ env, node, params }) => github.mergePullRequest(env, node, params),

  'cloudflare.account.state': ({ env }) => cloudflare.accountState(env),
  'cloudflare.worker.state': ({ env, node }) => cloudflare.workerState(env, node),
  'cloudflare.worker.deployments': ({ env, node, params }) => cloudflare.workerDeployments(env, node, params),
  'cloudflare.dns.list': ({ env, node, params }) => cloudflare.listDns(env, node, params),
  'cloudflare.storage.list': ({ env }) => cloudflare.listStorage(env),
  'cloudflare.cache.purge': ({ env, node, params }) => cloudflare.purgeCache(env, node, params),
  'cloudflare.worker.rollback': ({ env, node, params }) => cloudflare.rollbackWorker(env, node, params),
  'cloudflare.dns.upsert': ({ env, node, params }) => cloudflare.upsertDns(env, node, params),

  'supabase.project.state': ({ env }) => supabase.projectState(env),
  'supabase.advisors': ({ env, params }) => supabase.advisors(env, params),
  'supabase.migrations.list': ({ env, params }) => supabase.listMigrations(env, params),
  'supabase.functions.list': ({ env }) => supabase.listFunctions(env),
  'supabase.logs.query': ({ env, params }) => supabase.queryLogs(env, params),
  'supabase.sql.read': ({ env, params }) => supabase.readSql(env, params),
  'supabase.sql.apply': ({ env, params }) => supabase.applySql(env, params),

  'vps.list': ({ env, params, estate }) => ovh.listVps(env, null, params, { estate }),
  'vps.state': ({ env, node }) => ovh.vpsState(env, node),
  'vps.monitoring': ({ env, node, params }) => ovh.monitoring(env, node, params),
  'vps.tasks': ({ env, node }) => ovh.tasks(env, node),
  'vps.snapshot.create': ({ env, node, params }) => ovh.createSnapshot(env, node, params),
  'vps.start': ({ env, node }) => ovh.start(env, node),
  'vps.reboot': ({ env, node }) => ovh.reboot(env, node),
  'vps.stop': ({ env, node }) => ovh.stop(env, node),

  'site.probe': ({ env, node, params }) => site.probe(env, node, params),
  'site.estate.probe': ({ env, params, estate }) => site.probeEstate(env, estate, params),
  'site.deploy': async ({ env, node, params }) => {
    const binding = site.deployBinding(node);
    /* A site deploys through the repository that publishes it, so this
       becomes an ordinary workflow dispatch against a repo node — one
       code path for every deploy on the estate. */
    const repoNode = await resolveNode(env, { kind: 'repo', nodeKey: binding.repository });
    const result = await github.dispatchWorkflow(env, repoNode, {
      workflow: binding.workflow,
      ref: text(params.ref, 250) || binding.branch,
      inputs: params.inputs
    });
    return { site: node.node_key, ...result };
  },

  'core.jobs.list': ({ env, actor, params }) => listCoreJobs(env, actor.orgId, params),
  'core.job.enqueue': ({ env, actor, params }) => enqueueCoreJob(env, actor.orgId, params)
};

export function handlerFor(actionId) {
  return HANDLERS[actionId] || null;
}

export const HANDLED_ACTIONS = Object.freeze(Object.keys(HANDLERS));

/* The target kind an action declares is also the node kind it may
   resolve, which is why a `site.deploy` cannot be aimed at a database
   and a `vps.reboot` cannot be aimed at a satellite repository. */
export async function resolveTarget(env, action, params) {
  if (!action.target) return null;
  return resolveNode(env, {
    kind: action.target,
    nodeKey: params.node_key,
    fallbackKey: defaultNodeKey(action, env)
  });
}

/* The key an action will actually aim at, given what the caller asked
   for and the plane's defaults. Approvals and runs both bind to this,
   so an approval for the Worker rollback is an approval for the Worker
   that would really be rolled back. */
export function targetKey(action, params, env) {
  return text(params?.node_key, 250) || defaultNodeKey(action, env) || action.domain;
}

function defaultNodeKey(action, env) {
  if (action.target === 'worker') return text(env.CLOUDFLARE_WORKER_NAME, 120) || 'mccluster';
  if (action.target === 'zone') return text(env.CLOUDFLARE_ZONE_NAME, 200) || 'mccluster.org';
  if (action.target === 'host') return 'ovh-core';
  return null;
}

export async function execute(action, { env, actor, params, node: preResolved }) {
  const handler = handlerFor(action.id);
  if (!handler) {
    throw opsError('That action has no implementation on this Worker', 501, { code: 'action_not_implemented', action: action.id });
  }
  const requirement = PROVIDER_REQUIREMENTS[action.domain === 'ovh' ? 'ovh' : action.domain];
  if (requirement && !requirement.configured(env)) {
    throw opsError(`${action.domain} control is not configured on this Worker`, 503, {
      code: 'provider_not_configured', provider: action.domain, required_secrets: requirement.secrets
    });
  }
  const node = preResolved !== undefined ? preResolved : await resolveTarget(env, action, params);
  /* Only the fan-out actions need the whole estate, and they get a
     read-through of the cache rather than their own query. */
  const estate = action.id === 'site.estate.probe' || action.id === 'vps.list' ? await loadEstate(env) : null;
  return handler({ env, actor, params, node, estate, action });
}

export function actionOrThrow(actionId) {
  const action = ACTIONS_BY_ID[String(actionId || '')];
  if (!action) {
    throw opsError('Unknown control action', 404, { code: 'unknown_action', action: String(actionId || '') });
  }
  return action;
}
