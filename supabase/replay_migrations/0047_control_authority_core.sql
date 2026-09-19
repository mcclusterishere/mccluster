-- Recovered control-plane authority core.
--
-- Production records a `control_authority` migration before the capability
-- reconciliation in 0059, but that migration file was missing from Git. 0059
-- documents the expected pre-state exactly: 16 capabilities and 47 role
-- grants. Recreate that historical core so a fresh database follows the same
-- evolution as production instead of seeding today's superset.

create extension if not exists pgcrypto;

create table if not exists public.control_capabilities (
  capability text primary key,
  description text not null,
  risk text not null default 'low' check (risk in ('low','medium','high')),
  created_at timestamptz not null default now()
);

create table if not exists public.control_role_capabilities (
  role text not null,
  capability text not null references public.control_capabilities(capability) on delete cascade,
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (role, capability)
);

create table if not exists public.control_approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  capability text not null references public.control_capabilities(capability),
  resource_type text not null,
  resource_id text not null,
  request_hash text not null,
  reason text,
  state text not null default 'pending' check (state in ('pending','approved','denied','expired')),
  requested_by uuid not null references auth.users(id) on delete cascade,
  decided_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  expires_at timestamptz not null default now() + interval '30 minutes'
);
create index if not exists control_approvals_lookup_idx
  on public.control_approvals(org_id, capability, resource_type, resource_id, state, expires_at);

create table if not exists public.control_commands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  actor_user_id uuid not null,
  capability text not null,
  resource_type text,
  resource_id text,
  status text not null default 'allowed' check (status in ('allowed','denied','executed','failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  actor_kind text not null default 'human',
  action text,
  request_hash text,
  idempotency_key text,
  approval_id uuid references public.control_approvals(id) on delete set null,
  result jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists control_commands_actor_created_idx
  on public.control_commands(actor_user_id, created_at desc);
create index if not exists control_commands_org_created_idx
  on public.control_commands(org_id, created_at desc);
create index if not exists control_commands_resource_idx
  on public.control_commands(org_id, resource_type, resource_id, created_at desc);
create unique index if not exists control_commands_idempotency_idx
  on public.control_commands(org_id, idempotency_key) where idempotency_key is not null;

create table if not exists public.control_audit (
  id bigint generated always as identity primary key,
  org_id uuid references public.orgs(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_kind text not null default 'system',
  event text not null,
  capability text,
  resource_type text,
  resource_id text,
  command_id uuid,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists control_audit_org_at_idx
  on public.control_audit(org_id, at desc);

create table if not exists public.control_leases (
  org_id uuid not null references public.orgs(id) on delete cascade,
  resource_key text not null,
  lease_id uuid not null default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_kind text not null default 'system',
  purpose text,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (org_id, resource_key)
);

-- Control-plane state is service/authorized-function territory. RLS is enabled
-- from the first migration; later authority migrations add the operational
-- functions used by Edge Functions/Workers.
do $$
declare t text;
begin
  foreach t in array array[
    'control_capabilities','control_role_capabilities','control_approvals',
    'control_commands','control_audit','control_leases'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Historical 16-capability vocabulary documented by 0059.
insert into public.control_capabilities(capability, description, risk)
values
  ('campaign.pause',      'Pause a campaign',                                      'medium'),
  ('campaign.prepare',    'Build or modify a campaign without sending it',         'medium'),
  ('campaign.read',       'Read campaign state and delivery statistics',           'low'),
  ('campaign.send',       'Send an outbound campaign',                             'high'),
  ('control.approve',     'Approve a high-risk control-plane command',              'high'),
  ('control.read',        'Read control-plane state for an organisation',           'low'),
  ('deployment.promote',  'Promote code or schema changes into production',         'high'),
  ('deployment.read',     'Read deployment and drift state',                       'low'),
  ('media.generate',      'Create a media-generation job',                         'medium'),
  ('media.spend',         'Execute a media action that spends provider funds',      'high'),
  ('ops.use',             'Use the organisation operations agent',                 'medium'),
  ('payments.execute',    'Create, capture, transfer, refund, or otherwise move money','high'),
  ('payments.read',       'Read payment and connected-account state',               'low'),
  ('social.publish',      'Publish queued social content externally',               'high'),
  ('social.queue',        'Queue social content without publishing it',             'medium'),
  ('social.read',         'Read social-channel state and statistics',               'low')
on conflict (capability) do nothing;

-- 47 historical grants: admin=16, owner=16, staff=10, member=5.
insert into public.control_role_capabilities(role, capability, allowed)
select 'admin', capability, true from public.control_capabilities
where capability in (
  'campaign.pause','campaign.prepare','campaign.read','campaign.send',
  'control.approve','control.read','deployment.promote','deployment.read',
  'media.generate','media.spend','ops.use','payments.execute','payments.read',
  'social.publish','social.queue','social.read'
)
on conflict (role, capability) do nothing;

insert into public.control_role_capabilities(role, capability, allowed)
select 'owner', capability, true from public.control_capabilities
where capability in (
  'campaign.pause','campaign.prepare','campaign.read','campaign.send',
  'control.approve','control.read','deployment.promote','deployment.read',
  'media.generate','media.spend','ops.use','payments.execute','payments.read',
  'social.publish','social.queue','social.read'
)
on conflict (role, capability) do nothing;

insert into public.control_role_capabilities(role, capability, allowed)
values
  ('staff','campaign.pause',true),
  ('staff','campaign.prepare',true),
  ('staff','campaign.read',true),
  ('staff','control.read',true),
  ('staff','deployment.read',true),
  ('staff','media.generate',true),
  ('staff','ops.use',true),
  ('staff','payments.read',true),
  ('staff','social.queue',true),
  ('staff','social.read',true),
  ('member','campaign.read',true),
  ('member','control.read',true),
  ('member','deployment.read',true),
  ('member','payments.read',true),
  ('member','social.read',true)
on conflict (role, capability) do nothing;

-- Assert the historical precondition cited by migration 0059.
do $$
declare c integer; g integer;
begin
  select count(*) into c from public.control_capabilities;
  select count(*) into g from public.control_role_capabilities;
  if c <> 16 or g <> 47 then
    raise exception 'recovered control authority pre-state drifted: capabilities %, grants % (expected 16/47)', c, g;
  end if;
end $$;
