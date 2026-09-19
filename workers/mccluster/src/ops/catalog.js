/* ============================================================
   THE INFRASTRUCTURE ACTION CATALOGUE.

   One list of every consequential thing the backend can do to the
   house it runs on: the repositories, the Cloudflare edge, the
   Supabase data plane, the OVH host, the public site and every
   satellite in the registry.

   This file is data only — no fetch, no env, no secrets — so the
   Worker, the tests and the migration that seeds ops_action_policy
   all read the same catalogue instead of three drifting copies.

   Three things decide whether an action may run, and all three must
   agree:

     1. `capability` here says which rung of the control ladder the
        action sits on (infra.read / infra.operate / infra.mutate).
     2. public.ops_action_policy says the same thing in the database,
        and the database wins — a missing or disabled row stops the
        action even though the code still ships it.
     3. control_authorize_service enforces the rung against the
        actor's org role, and forces a bound control_approvals row
        for anything the capability vocabulary marks `high`.

   So `infra.mutate` actions — merging to a default branch, rolling a
   Worker back, changing DNS, applying SQL, stopping the host — cannot
   execute on a model's say-so. They need an approval a human decided.
   That is the AGENTS.md rule ("humans retain consequential authority")
   expressed as a code path rather than as a paragraph.
   ============================================================ */

export const READ = 'infra.read';
export const OPERATE = 'infra.operate';
export const MUTATE = 'infra.mutate';

const str = { type: 'string' };
const bool = { type: 'boolean' };
const int = { type: 'integer' };

function action(id, domain, capability, summary, input = {}, extra = {}) {
  return Object.freeze({
    id,
    domain,
    capability,
    mutates: capability !== READ,
    summary,
    input: Object.freeze(input),
    ...extra
  });
}

export const ACTION_LIST = Object.freeze([
  /* ---- the estate itself ---- */
  action('ops.estate.list', 'estate', READ,
    'List every node the control plane is allowed to act on.',
    { kind: str, provider: str, enabled: bool }),
  action('ops.estate.upsert', 'estate', OPERATE,
    'Register or update one estate node (a new satellite, a host service name, a deploy binding).',
    { kind: str, node_key: str, name: str, provider: str, provider_ref: str, default_branch: str, role: str, metadata: { type: 'object' } },
    { required: ['kind', 'node_key'] }),
  action('ops.estate.disable', 'estate', MUTATE,
    'Take a node out of reach of every action. Consequential: it is how a satellite stops being deployable.',
    { kind: str, node_key: str }, { required: ['kind', 'node_key'] }),

  /* ---- GitHub: the code and what ships from it ---- */
  action('github.repo.state', 'github', READ,
    'Repository head state: default branch, latest commit, open pull requests, last workflow conclusion.',
    { node_key: str }, { required: ['node_key'], target: 'repo' }),
  action('github.branches.list', 'github', READ,
    'List branches on an estate repository.',
    { node_key: str, limit: int }, { required: ['node_key'], target: 'repo' }),
  action('github.commits.list', 'github', READ,
    'List recent commits on a ref.',
    { node_key: str, ref: str, limit: int }, { required: ['node_key'], target: 'repo' }),
  action('github.file.read', 'github', READ,
    'Read one file at a ref.',
    { node_key: str, path: str, ref: str }, { required: ['node_key', 'path'], target: 'repo' }),
  action('github.pulls.list', 'github', READ,
    'List pull requests.',
    { node_key: str, state: str, limit: int }, { required: ['node_key'], target: 'repo' }),
  action('github.workflows.list', 'github', READ,
    'List Actions workflows and whether each is dispatchable.',
    { node_key: str }, { required: ['node_key'], target: 'repo' }),
  action('github.runs.list', 'github', READ,
    'List recent Actions runs with conclusions.',
    { node_key: str, workflow: str, branch: str, limit: int }, { required: ['node_key'], target: 'repo' }),
  action('github.branch.create', 'github', OPERATE,
    'Create a working branch from a ref.',
    { node_key: str, branch: str, from_ref: str }, { required: ['node_key', 'branch'], target: 'repo' }),
  action('github.file.write', 'github', OPERATE,
    'Commit a file to a working branch. Refuses the default branch — that is github.file.write.protected.',
    { node_key: str, path: str, branch: str, content: str, message: str, encoding: str },
    { required: ['node_key', 'path', 'branch', 'content', 'message'], target: 'repo' }),
  action('github.pr.open', 'github', OPERATE,
    'Open a pull request from a working branch.',
    { node_key: str, head: str, base: str, title: str, body: str, draft: bool },
    { required: ['node_key', 'head', 'title'], target: 'repo' }),
  action('github.workflow.dispatch', 'github', OPERATE,
    'Run a workflow_dispatch workflow on a ref.',
    { node_key: str, workflow: str, ref: str, inputs: { type: 'object' } },
    { required: ['node_key', 'workflow'], target: 'repo' }),
  action('github.run.rerun', 'github', OPERATE,
    'Re-run one Actions run, or only its failed jobs.',
    { node_key: str, run_id: int, failed_only: bool }, { required: ['node_key', 'run_id'], target: 'repo' }),
  action('github.file.write.protected', 'github', MUTATE,
    'Commit straight to a repository default branch. On the control repo this is a live site deploy.',
    { node_key: str, path: str, content: str, message: str, encoding: str },
    { required: ['node_key', 'path', 'content', 'message'], target: 'repo' }),
  action('github.pr.merge', 'github', MUTATE,
    'Merge a pull request.',
    { node_key: str, number: int, method: str, title: str }, { required: ['node_key', 'number'], target: 'repo' }),

  /* ---- Cloudflare: the edge ---- */
  action('cloudflare.account.state', 'cloudflare', READ,
    'Account reachability plus the Workers the account actually has.',
    {}),
  action('cloudflare.worker.state', 'cloudflare', READ,
    'One Worker: its script metadata, bindings and current deployment.',
    { node_key: str }, { target: 'worker' }),
  action('cloudflare.worker.deployments', 'cloudflare', READ,
    'Deployment history for a Worker, newest first.',
    { node_key: str, limit: int }, { target: 'worker' }),
  action('cloudflare.dns.list', 'cloudflare', READ,
    'DNS records on a zone.',
    { node_key: str, name: str, type: str }, { target: 'zone' }),
  action('cloudflare.storage.list', 'cloudflare', READ,
    'KV namespaces, R2 buckets and D1 databases on the account.',
    {}),
  action('cloudflare.cache.purge', 'cloudflare', OPERATE,
    'Purge cached files on a zone, or everything on it.',
    { node_key: str, files: { type: 'array', items: str }, everything: bool }, { target: 'zone' }),
  action('cloudflare.worker.rollback', 'cloudflare', MUTATE,
    'Point a Worker back at an earlier version. This changes what api.mccluster.org serves.',
    { node_key: str, version_id: str, message: str }, { required: ['version_id'], target: 'worker' }),
  action('cloudflare.dns.upsert', 'cloudflare', MUTATE,
    'Create or update one DNS record. This can move a public domain.',
    { node_key: str, name: str, type: str, content: str, ttl: int, proxied: bool },
    { required: ['name', 'type', 'content'], target: 'zone' }),

  /* ---- Supabase: durable truth ---- */
  action('supabase.project.state', 'supabase', READ,
    'Project status, region and Postgres version from the management API.',
    {}),
  action('supabase.advisors', 'supabase', READ,
    'Security and performance advisories for the project.',
    { type: str }),
  action('supabase.migrations.list', 'supabase', READ,
    'Applied migration versions, newest first.',
    { limit: int }),
  action('supabase.functions.list', 'supabase', READ,
    'Edge functions with status and version.',
    {}),
  action('supabase.logs.query', 'supabase', READ,
    'Query the project log service for a recent window.',
    { service: str, limit: int }),
  action('supabase.sql.read', 'supabase', READ,
    'Run one read-only statement. Anything that could write is rejected before it is sent.',
    { sql: str }, { required: ['sql'] }),
  action('supabase.sql.apply', 'supabase', MUTATE,
    'Apply SQL that writes: DDL, DML, or a migration. Consequential and irreversible by default.',
    { sql: str, name: str }, { required: ['sql'] }),

  /* ---- OVH: the VPS that runs Core ---- */
  action('vps.list', 'ovh', READ,
    'Every VPS on the OVH account, with the estate host matched to it.',
    {}),
  action('vps.state', 'ovh', READ,
    'One VPS: power state, offer, datacentre, current image, disks.',
    { node_key: str }, { target: 'host' }),
  action('vps.monitoring', 'ovh', READ,
    'CPU, memory and network readings over a period.',
    { node_key: str, period: str, type: str }, { target: 'host' }),
  action('vps.tasks', 'ovh', READ,
    'In-flight and recent OVH tasks for the host.',
    { node_key: str }, { target: 'host' }),
  action('vps.snapshot.create', 'ovh', OPERATE,
    'Take a snapshot before doing something risky. Reversible by construction.',
    { node_key: str, description: str }, { target: 'host' }),
  action('vps.start', 'ovh', OPERATE,
    'Start a stopped VPS.',
    { node_key: str }, { target: 'host' }),
  action('vps.reboot', 'ovh', MUTATE,
    'Reboot the host. Core stops executing until it comes back.',
    { node_key: str }, { target: 'host' }),
  action('vps.stop', 'ovh', MUTATE,
    'Stop the host. Everything Core runs goes with it.',
    { node_key: str }, { target: 'host' }),

  /* ---- the sites, including every satellite ---- */
  action('site.probe', 'site', READ,
    'Fetch a site node over HTTPS and report status, redirect chain, build stamp and timing.',
    { node_key: str, path: str }, { required: ['node_key'], target: 'site' }),
  action('site.estate.probe', 'site', READ,
    'Probe every enabled site node at once and report which ones are answering.',
    { limit: int }),
  action('site.deploy', 'site', OPERATE,
    'Ship a site: dispatch the deploy workflow bound to its node, on the branch that node names.',
    { node_key: str, ref: str, inputs: { type: 'object' } }, { required: ['node_key'], target: 'site' }),

  /* ---- Core on the host, through the queue it already has ---- */
  action('core.jobs.list', 'core', READ,
    'Recent Core jobs with status, so the queue is visible from the same board as everything else.',
    { status: str, limit: int }),
  action('core.job.enqueue', 'core', OPERATE,
    'Queue bounded work for Core on the host. Uses ops_agent_jobs — there is no second queue.',
    { job_type: str, target_type: str, target_id: str, input: { type: 'object' }, priority: int },
    { required: ['job_type'] })
]);

export const ACTIONS_BY_ID = Object.freeze(
  Object.fromEntries(ACTION_LIST.map((item) => [item.id, item]))
);

export const DOMAINS = Object.freeze([...new Set(ACTION_LIST.map((item) => item.domain))]);

export function getAction(id) {
  return ACTIONS_BY_ID[String(id || '')] || null;
}
