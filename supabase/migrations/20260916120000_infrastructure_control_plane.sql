-- ============================================================
-- INFRASTRUCTURE CONTROL PLANE
--
-- The house could already see itself — /v1/status counted rows and
-- core/ measured the host — but it could not *act* on itself. Every
-- real change (deploy the site, roll a Worker back, reboot the VPS,
-- apply a migration, open a PR on a satellite) still had to go through
-- a human holding provider dashboards or an agent holding provider
-- tokens. That is the gap this closes: one audited, policy-gated
-- surface on Worker `mccluster` that reaches GitHub, Cloudflare,
-- Supabase, the OVH host, the public site and every satellite.
--
-- It does NOT invent a second authority system. Authorization is the
-- capability ladder from 0047/0066: control_capabilities ->
-- control_role_capabilities -> control_authorize_service, with `high`
-- risk forcing a real control_approvals row. What this migration adds
-- is the infrastructure vocabulary that ladder was missing, the estate
-- it acts on, and the per-action policy table that decides which rung
-- each action sits on — so widening or narrowing the backend's reach
-- is a row, not a deploy.
-- ============================================================

-- ---- 1. The infrastructure capability rungs -----------------

insert into public.control_capabilities(capability, description, risk)
values
  ('infra.read',    'Read live infrastructure state from GitHub, Cloudflare, Supabase, the host and the public estate', 'low'),
  ('infra.operate', 'Make reversible infrastructure changes: dispatch a deploy, purge cache, commit to a working branch, snapshot a host', 'medium'),
  ('infra.mutate',  'Make consequential infrastructure changes: merge to a default branch, roll a Worker back, change DNS, apply SQL, stop or reboot a host', 'high')
on conflict (capability) do update
  set description = excluded.description,
      risk = excluded.risk;

-- Owner and admin hold the whole ladder. Staff may look. Member may not.
-- `infra.mutate` being high risk means even an owner cannot execute one
-- without an approved control_approvals row bound to the exact request.
insert into public.control_role_capabilities(role, capability, allowed)
values
  ('owner', 'infra.read', true),
  ('owner', 'infra.operate', true),
  ('owner', 'infra.mutate', true),
  ('admin', 'infra.read', true),
  ('admin', 'infra.operate', true),
  ('admin', 'infra.mutate', true),
  ('staff', 'infra.read', true),
  ('staff', 'infra.operate', false),
  ('staff', 'infra.mutate', false),
  ('viewer', 'infra.read', true),
  ('viewer', 'infra.operate', false),
  ('viewer', 'infra.mutate', false),
  ('member', 'infra.read', false),
  ('member', 'infra.operate', false),
  ('member', 'infra.mutate', false)
on conflict (role, capability) do update set allowed = excluded.allowed;

-- ---- 2. The estate ------------------------------------------
--
-- What the plane is allowed to act on, and nothing else. An action
-- names a node key; a key that is absent or disabled is a 404, so
-- "control everything" never means "control anything typed into it".

create table if not exists public.ops_estate_nodes (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('repo','site','worker','database','host','zone','bucket','queue')),
  node_key text not null,
  name text not null,
  provider text not null check (provider in ('github','cloudflare','supabase','ovh','http')),
  provider_ref text,
  default_branch text,
  role text,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, node_key)
);
create index if not exists ops_estate_nodes_provider_idx
  on public.ops_estate_nodes(provider, enabled);

-- ---- 3. Per-action policy -----------------------------------
--
-- The action catalogue (schemas, handlers, provider calls) lives in
-- workers/mccluster/src/ops. Which capability and risk each action
-- carries lives here. The Worker fails closed: an action with no row,
-- or a disabled row, cannot run, even if the code still ships it.

create table if not exists public.ops_action_policy (
  action_id text primary key,
  domain text not null,
  capability text not null references public.control_capabilities(capability),
  mutates boolean not null default false,
  enabled boolean not null default true,
  description text not null default '',
  updated_at timestamptz not null default now()
);

-- ---- 4. Estate snapshots ------------------------------------
--
-- Periodic cross-provider readings so drift is visible as history and
-- not only as whatever the dashboard happens to say right now.

create table if not exists public.ops_infra_snapshots (
  id bigint generated always as identity primary key,
  org_id uuid references public.orgs(id) on delete cascade,
  taken_at timestamptz not null default now(),
  source text not null default 'worker',
  ok boolean not null default true,
  snapshot jsonb not null default '{}'::jsonb
);
create index if not exists ops_infra_snapshots_taken_idx
  on public.ops_infra_snapshots(org_id, taken_at desc);

-- ---- 5. Containment -----------------------------------------
--
-- Infrastructure state is service-role territory. Browsers reach it
-- through the Worker, which has already proved house-owner membership
-- and run the capability gate; they never read these tables directly.

do $$
declare t text;
begin
  foreach t in array array['ops_estate_nodes','ops_action_policy','ops_infra_snapshots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

-- ---- 6. Seed: the plane itself ------------------------------

insert into public.ops_estate_nodes(kind, node_key, name, provider, provider_ref, default_branch, role, enabled, metadata)
values
  ('site',     'matthew.mccluster.org', 'McCluster public edge', 'http', 'https://matthew.mccluster.org', null, 'public-edge', true,
   '{"deploy":{"provider":"github-actions","repository":"mcclusterishere/mccluster","workflow":"deploy-pages.yml","branch":"main"},"apex_alias":"mccluster.org"}'::jsonb),
  ('site',     'mccluster.org', 'McCluster apex', 'http', 'https://mccluster.org', null, 'apex-alias', true,
   '{"alias_of":"matthew.mccluster.org"}'::jsonb),
  ('site',     'api.mccluster.org', 'McCluster API', 'http', 'https://api.mccluster.org', null, 'api', true,
   '{"worker":"mccluster","health_path":"/health"}'::jsonb),
  ('worker',   'mccluster', 'Cloudflare Worker mccluster', 'cloudflare', 'mccluster', null, 'api-worker', true,
   '{"source":"workers/mccluster","durable_object_class":"HereTenantAgent","forbidden_siblings":["mccluster-core"],"deploy":{"provider":"github-actions","repository":"mcclusterishere/mccluster","workflow":"deploy-mccluster-worker.yml","branch":"main"}}'::jsonb),
  ('zone',     'mccluster.org', 'Cloudflare zone mccluster.org', 'cloudflare', 'mccluster.org', null, 'zone', true, '{}'::jsonb),
  ('database', 'zmnhbrjyhxzhkxmhkexs', 'Supabase control-plane project', 'supabase', 'zmnhbrjyhxzhkxmhkexs', null, 'durable-truth', true,
   '{"url":"https://zmnhbrjyhxzhkxmhkexs.supabase.co"}'::jsonb),
  ('host',     'ovh-core', 'OVH McCluster Core', 'ovh', null, null, 'persistent-execution', true,
   '{"source":"core/","promotion_ref":"deploy/ovh-production","deploy":{"provider":"github-actions","repository":"mcclusterishere/mccluster","workflow":"promote-ovh-production.yml","branch":"main"},"note":"provider_ref is the OVH serviceName; set it with ops.estate.upsert after vps.list names the account"}'::jsonb)
on conflict (kind, node_key) do update
  set name = excluded.name,
      provider = excluded.provider,
      role = excluded.role,
      metadata = public.ops_estate_nodes.metadata || excluded.metadata,
      updated_at = now();

-- ---- 7. Seed: the satellites --------------------------------
--
-- Mirrors docs/control-plane/registry.json. `Here` is seeded disabled
-- because it publishes nothing and must not be written to; a disabled
-- node cannot be named by any action, so the rule is enforced by the
-- data rather than by every agent remembering it.

insert into public.ops_estate_nodes(kind, node_key, name, provider, provider_ref, default_branch, role, enabled, metadata)
values
  ('repo', 'mcclusterishere/mccluster', 'mccluster', 'github', 'mcclusterishere/mccluster', 'main', 'control-plane', true, '{"role":"control-plane","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/Mnet', 'Mnet', 'github', 'mcclusterishere/Mnet', 'main', 'social-plane', true, '{"role":"social-plane","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/Here', 'Here', 'github', 'mcclusterishere/Here', 'main', 'archive-old-website', false, '{"role":"archive-old-website","branch":"main","do_not_deploy":true}'::jsonb),
  ('repo', 'mcclusterishere/Whip-Equipped', 'Whip-Equipped', 'github', 'mcclusterishere/Whip-Equipped', 'main', 'product', true, '{"role":"product","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/Whip-Equipped-Driver', 'Whip-Equipped-Driver', 'github', 'mcclusterishere/Whip-Equipped-Driver', 'main', 'product', true, '{"role":"product","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/Whip-Equipped-Rentals', 'Whip-Equipped-Rentals', 'github', 'mcclusterishere/Whip-Equipped-Rentals', 'main', 'product', true, '{"role":"product","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/We-manufacture', 'We-manufacture', 'github', 'mcclusterishere/We-manufacture', 'main', 'product', true, '{"role":"product","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/smartchurch', 'smartchurch', 'github', 'mcclusterishere/smartchurch', 'main', 'product', true, '{"role":"product","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/Shiloh-Church-BPT-App', 'Shiloh-Church-BPT-App', 'github', 'mcclusterishere/Shiloh-Church-BPT-App', 'claude/shiloh-church-bpt-design-x9lnin', 'client', true, '{"role":"client","branch":"claude/shiloh-church-bpt-design-x9lnin"}'::jsonb),
  ('repo', 'mcclusterishere/esmer', 'esmer', 'github', 'mcclusterishere/esmer', 'main', 'client', true, '{"role":"client","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/street-credit-bureau', 'street-credit-bureau', 'github', 'mcclusterishere/street-credit-bureau', 'production', 'product', true, '{"role":"product","branch":"production"}'::jsonb),
  ('repo', 'mcclusterishere/Welgen', 'Welgen', 'github', 'mcclusterishere/Welgen', 'main', 'product', true, '{"role":"product","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/Prim3', 'Prim3', 'github', 'mcclusterishere/Prim3', 'main', 'internal', true, '{"role":"internal","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/Lvl-3-Media', 'Lvl-3-Media', 'github', 'mcclusterishere/Lvl-3-Media', 'main', 'product', true, '{"role":"product","branch":"main"}'::jsonb),
  ('repo', 'McCluster-Corp/Equity-Uprise', 'Equity-Uprise', 'github', 'McCluster-Corp/Equity-Uprise', 'main', 'product', true, '{"role":"product","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/nicole-messiah', 'nicole-messiah', 'github', 'mcclusterishere/nicole-messiah', 'claude/commissioner-personal-app-xsk92h', 'client', true, '{"role":"client","branch":"claude/commissioner-personal-app-xsk92h"}'::jsonb),
  ('repo', 'mcclusterishere/Yohana-The-Realtor', 'Yohana-The-Realtor', 'github', 'mcclusterishere/Yohana-The-Realtor', 'main', 'client', true, '{"role":"client","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/MOG-Men-Of-God', 'MOG-Men-Of-God', 'github', 'mcclusterishere/MOG-Men-Of-God', 'main', 'product', true, '{"role":"product","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/Faith-And-Results', 'Faith-And-Results', 'github', 'mcclusterishere/Faith-And-Results', 'main', 'product', true, '{"role":"product","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/Apex-tactical-corporation', 'Apex-tactical-corporation', 'github', 'mcclusterishere/Apex-tactical-corporation', 'claude/apex-tactical-ledger-nxef56', 'internal', true, '{"role":"internal","branch":"claude/apex-tactical-ledger-nxef56"}'::jsonb),
  ('repo', 'mcclusterishere/designer-kicks-platform', 'designer-kicks-platform', 'github', 'mcclusterishere/designer-kicks-platform', 'claude/designer-kicks-platform-80a9o2', 'product', true, '{"role":"product","branch":"claude/designer-kicks-platform-80a9o2"}'::jsonb),
  ('repo', 'mcclusterishere/WARRANT-TRACER', 'WARRANT-TRACER', 'github', 'mcclusterishere/WARRANT-TRACER', 'claude/financial-instruments-app-44141s', 'product', true, '{"role":"product","branch":"claude/financial-instruments-app-44141s"}'::jsonb),
  ('repo', 'mcclusterishere/Dekota-Customs', 'Dekota-Customs', 'github', 'mcclusterishere/Dekota-Customs', 'main', 'client', true, '{"role":"client","branch":"main"}'::jsonb),
  ('repo', 'McCluster-Corp/English-101', 'English-101', 'github', 'McCluster-Corp/English-101', 'main', 'client', true, '{"role":"client","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/McCluster-OS', 'McCluster-OS', 'github', 'mcclusterishere/McCluster-OS', 'claude/product-integration-4o3p2j', 'archive-os', true, '{"role":"archive-os","branch":"claude/product-integration-4o3p2j"}'::jsonb),
  ('repo', 'mcclusterishere/McCluster-Portfolio', 'McCluster-Portfolio', 'github', 'mcclusterishere/McCluster-Portfolio', 'main', 'archive', true, '{"role":"archive","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/soap', 'soap', 'github', 'mcclusterishere/soap', 'main', 'internal', true, '{"role":"internal","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/prim3-frontend', 'prim3-frontend', 'github', 'mcclusterishere/prim3-frontend', 'main', 'archive', true, '{"role":"archive","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/prim3-backend', 'prim3-backend', 'github', 'mcclusterishere/prim3-backend', 'main', 'archive', true, '{"role":"archive","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/Akoma-Test', 'Akoma-Test', 'github', 'mcclusterishere/Akoma-Test', 'main', 'archive', true, '{"role":"archive","branch":"main"}'::jsonb),
  ('repo', 'mcclusterishere/Designer-Kicks-Backup-Point', 'Designer-Kicks-Backup-Point', 'github', 'mcclusterishere/Designer-Kicks-Backup-Point', 'main', 'archive', true, '{"role":"archive","branch":"main"}'::jsonb)

on conflict (kind, node_key) do update
  set name = excluded.name,
      provider = excluded.provider,
      provider_ref = excluded.provider_ref,
      default_branch = excluded.default_branch,
      role = excluded.role,
      enabled = excluded.enabled,
      metadata = public.ops_estate_nodes.metadata || excluded.metadata,
      updated_at = now();

-- ---- 8. Seed: the action policy -----------------------------
--
-- Generated from workers/mccluster/src/ops/catalog.js. The Worker
-- refuses any action without an enabled row here, so this table is
-- the live switchboard: revoke one row and that reach is gone without
-- a deploy, and a code-only action that never reached review cannot
-- execute at all.

insert into public.ops_action_policy(action_id, domain, capability, mutates, enabled, description)
values
  ('ops.estate.list', 'estate', 'infra.read', false, true, 'List every node the control plane is allowed to act on.'),
  ('ops.estate.upsert', 'estate', 'infra.operate', true, true, 'Register or update one estate node (a new satellite, a host service name, a deploy binding).'),
  ('ops.estate.disable', 'estate', 'infra.mutate', true, true, 'Take a node out of reach of every action. Consequential: it is how a satellite stops being deployable.'),
  ('github.repo.state', 'github', 'infra.read', false, true, 'Repository head state: default branch, latest commit, open pull requests, last workflow conclusion.'),
  ('github.branches.list', 'github', 'infra.read', false, true, 'List branches on an estate repository.'),
  ('github.commits.list', 'github', 'infra.read', false, true, 'List recent commits on a ref.'),
  ('github.file.read', 'github', 'infra.read', false, true, 'Read one file at a ref.'),
  ('github.pulls.list', 'github', 'infra.read', false, true, 'List pull requests.'),
  ('github.workflows.list', 'github', 'infra.read', false, true, 'List Actions workflows and whether each is dispatchable.'),
  ('github.runs.list', 'github', 'infra.read', false, true, 'List recent Actions runs with conclusions.'),
  ('github.branch.create', 'github', 'infra.operate', true, true, 'Create a working branch from a ref.'),
  ('github.file.write', 'github', 'infra.operate', true, true, 'Commit a file to a working branch. Refuses the default branch — that is github.file.write.protected.'),
  ('github.pr.open', 'github', 'infra.operate', true, true, 'Open a pull request from a working branch.'),
  ('github.workflow.dispatch', 'github', 'infra.operate', true, true, 'Run a workflow_dispatch workflow on a ref.'),
  ('github.run.rerun', 'github', 'infra.operate', true, true, 'Re-run one Actions run, or only its failed jobs.'),
  ('github.file.write.protected', 'github', 'infra.mutate', true, true, 'Commit straight to a repository default branch. On the control repo this is a live site deploy.'),
  ('github.pr.merge', 'github', 'infra.mutate', true, true, 'Merge a pull request.'),
  ('cloudflare.account.state', 'cloudflare', 'infra.read', false, true, 'Account reachability plus the Workers the account actually has.'),
  ('cloudflare.worker.state', 'cloudflare', 'infra.read', false, true, 'One Worker: its script metadata, bindings and current deployment.'),
  ('cloudflare.worker.deployments', 'cloudflare', 'infra.read', false, true, 'Deployment history for a Worker, newest first.'),
  ('cloudflare.dns.list', 'cloudflare', 'infra.read', false, true, 'DNS records on a zone.'),
  ('cloudflare.storage.list', 'cloudflare', 'infra.read', false, true, 'KV namespaces, R2 buckets and D1 databases on the account.'),
  ('cloudflare.cache.purge', 'cloudflare', 'infra.operate', true, true, 'Purge cached files on a zone, or everything on it.'),
  ('cloudflare.worker.rollback', 'cloudflare', 'infra.mutate', true, true, 'Point a Worker back at an earlier version. This changes what api.mccluster.org serves.'),
  ('cloudflare.dns.upsert', 'cloudflare', 'infra.mutate', true, true, 'Create or update one DNS record. This can move a public domain.'),
  ('supabase.project.state', 'supabase', 'infra.read', false, true, 'Project status, region and Postgres version from the management API.'),
  ('supabase.advisors', 'supabase', 'infra.read', false, true, 'Security and performance advisories for the project.'),
  ('supabase.migrations.list', 'supabase', 'infra.read', false, true, 'Applied migration versions, newest first.'),
  ('supabase.functions.list', 'supabase', 'infra.read', false, true, 'Edge functions with status and version.'),
  ('supabase.logs.query', 'supabase', 'infra.read', false, true, 'Query the project log service for a recent window.'),
  ('supabase.sql.read', 'supabase', 'infra.read', false, true, 'Run one read-only statement. Anything that could write is rejected before it is sent.'),
  ('supabase.sql.apply', 'supabase', 'infra.mutate', true, true, 'Apply SQL that writes: DDL, DML, or a migration. Consequential and irreversible by default.'),
  ('vps.list', 'ovh', 'infra.read', false, true, 'Every VPS on the OVH account, with the estate host matched to it.'),
  ('vps.state', 'ovh', 'infra.read', false, true, 'One VPS: power state, offer, datacentre, current image, disks.'),
  ('vps.monitoring', 'ovh', 'infra.read', false, true, 'CPU, memory and network readings over a period.'),
  ('vps.tasks', 'ovh', 'infra.read', false, true, 'In-flight and recent OVH tasks for the host.'),
  ('vps.snapshot.create', 'ovh', 'infra.operate', true, true, 'Take a snapshot before doing something risky. Reversible by construction.'),
  ('vps.start', 'ovh', 'infra.operate', true, true, 'Start a stopped VPS.'),
  ('vps.reboot', 'ovh', 'infra.mutate', true, true, 'Reboot the host. Core stops executing until it comes back.'),
  ('vps.stop', 'ovh', 'infra.mutate', true, true, 'Stop the host. Everything Core runs goes with it.'),
  ('site.probe', 'site', 'infra.read', false, true, 'Fetch a site node over HTTPS and report status, redirect chain, build stamp and timing.'),
  ('site.estate.probe', 'site', 'infra.read', false, true, 'Probe every enabled site node at once and report which ones are answering.'),
  ('site.deploy', 'site', 'infra.operate', true, true, 'Ship a site: dispatch the deploy workflow bound to its node, on the branch that node names.'),
  ('core.jobs.list', 'core', 'infra.read', false, true, 'Recent Core jobs with status, so the queue is visible from the same board as everything else.'),
  ('core.job.enqueue', 'core', 'infra.operate', true, true, 'Queue bounded work for Core on the host. Uses ops_agent_jobs — there is no second queue.')
on conflict (action_id) do update
  set domain = excluded.domain,
      capability = excluded.capability,
      mutates = excluded.mutates,
      description = excluded.description,
      updated_at = now();

comment on table public.ops_estate_nodes is
  'Everything the McCluster control plane may act on. An action naming a missing or disabled node fails closed.';
comment on table public.ops_action_policy is
  'Live capability binding for every infrastructure action. Missing or disabled row = the action cannot run.';
comment on table public.ops_infra_snapshots is
  'Periodic cross-provider readings of the estate, so infrastructure drift has a history.';

-- ---- 9. Proof ------------------------------------------------

do $$
declare v_actions integer; v_nodes integer; v_caps integer;
begin
  select count(*) into v_actions from public.ops_action_policy;
  select count(*) into v_nodes from public.ops_estate_nodes;
  select count(*) into v_caps from public.control_capabilities where capability like 'infra.%';
  if v_actions < 40 then raise exception 'action policy seed incomplete: %', v_actions; end if;
  if v_nodes < 30 then raise exception 'estate seed incomplete: %', v_nodes; end if;
  if v_caps <> 3 then raise exception 'infrastructure capability ladder incomplete: %', v_caps; end if;
end $$;
