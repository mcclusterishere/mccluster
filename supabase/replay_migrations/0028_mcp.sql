-- TOOLS: the part where the bot stops only knowing things and starts
-- doing them.
--
-- Retrieval can tell somebody what the thermostat is set to, if a
-- document says so. It cannot tell them what it is set to RIGHT NOW, and
-- it certainly cannot change it. That needs a tool, and a tool needs to
-- live where the hardware is — on the customer's own machine, behind
-- their own network — not in this function.
--
-- MCP is how that works: the customer runs a server, this calls it. The
-- protocol is 2026-07-28, which is stateless — no initialize handshake,
-- no session id, no GET stream. One POST per call, with the routing
-- fields mirrored into headers so the customer's own load balancer can
-- see them without opening the body.
--
-- ---- THE DISTINCTION THIS SCHEMA EXISTS TO MAKE -----------------------
--
-- "What is the sanctuary temperature" and "set the sanctuary to 68" are
-- not the same authority, and no amount of prompt engineering makes them
-- the same authority. So every tool carries a RISK, and what may happen
-- without a person saying yes is a per-tool decision written in a table
-- rather than a judgement made in a sentence:
--
--   read     no side effect. Answer with it.
--   write    changes something that can be changed back. A booking, a
--            note, a setpoint.
--   act      changes the physical world in a way a person would notice
--            walking in: unlocking a door, starting a stream, sounding
--            something. Never automatic. Not once.
--
-- A tool is also OFF until somebody turns it on. A server that advertises
-- forty tools does not thereby get forty new abilities; it gets forty
-- rows a person can enable one at a time.

create table if not exists public.mcp_servers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  -- what a person calls it: "the church building", "the booking system"
  name        text not null,
  -- the MCP endpoint. One URL, POST only, per the 2026-07-28 transport.
  url         text not null,
  transport   text not null default 'http' check (transport in ('http')),
  protocol_version text not null default '2026-07-28',

  -- How we prove who we are to it. Same rule as everywhere else in this
  -- schema: the row names where the secret is, never what it is.
  auth_kind   text not null default 'bearer' check (auth_kind in ('none', 'bearer', 'header')),
  -- for auth_kind='header': which header the token goes in
  auth_header text,
  token_env   text,
  secret_id   uuid,

  enabled     boolean not null default false,
  -- how long a cached tool list stays good, before asking again
  tools_ttl_s int not null default 300,
  tools_refreshed_at timestamptz,

  last_ok_at  timestamptz,
  last_error  text,
  last_error_at timestamptz,
  created_at  timestamptz not null default now(),

  unique (org_id, name),
  constraint mcp_servers_one_credential check (token_env is null or secret_id is null)
);

create index if not exists mcp_servers_org on public.mcp_servers (org_id) where enabled;

comment on column public.mcp_servers.url is
  'The MCP endpoint. Reached from this function, so it has to be publicly resolvable — a building on a home connection needs a tunnel, not a LAN address.';

-- ============================================================

create table if not exists public.mcp_tools (
  id          uuid primary key default gen_random_uuid(),
  server_id   uuid not null references public.mcp_servers(id) on delete cascade,
  org_id      uuid not null references public.orgs(id) on delete cascade,
  name        text not null,
  title       text,
  description text,
  input_schema jsonb not null default '{}'::jsonb,

  -- OFF until a person turns it on. A server advertising forty tools
  -- gets forty rows to approve, not forty new abilities.
  enabled     boolean not null default false,

  -- read | write | act — see the header. Defaults to the most cautious
  -- thing it could be, because the alternative default is a door.
  risk        text not null default 'act' check (risk in ('read', 'write', 'act')),

  -- May the bot use this without a person saying yes to that specific
  -- call? Only ever true for 'read', enforced below.
  auto        boolean not null default false,

  -- rejected tool definitions are KEPT, with the reason, rather than
  -- silently dropped: "why can't it see the tool" needs an answer
  rejected    text,

  refreshed_at timestamptz not null default now(),
  unique (server_id, name),
  constraint mcp_tools_auto_is_read_only
    check (not auto or risk = 'read')
);

create index if not exists mcp_tools_server on public.mcp_tools (server_id);
create index if not exists mcp_tools_live on public.mcp_tools (org_id) where enabled and rejected is null;

comment on constraint mcp_tools_auto_is_read_only on public.mcp_tools is
  'Automatic use is only ever allowed for a tool with no side effect. Unlocking a door on the model''s own judgement is not a feature.';

comment on column public.mcp_tools.rejected is
  'Why this tool is unusable — a malformed x-mcp-header annotation, usually. Kept rather than dropped so "why can''t it see the tool" has an answer.';

-- ============================================================
-- EVERY CALL, WRITTEN DOWN
--
-- Not for debugging. For the question a person will actually ask, which
-- is "why is the heating on" — and the answer has to be a row naming
-- what was called, with what, by whose instruction, and what came back.
-- ============================================================

create table if not exists public.mcp_calls (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  server_id   uuid references public.mcp_servers(id) on delete set null,
  tool        text not null,
  arguments   jsonb not null default '{}'::jsonb,
  -- which conversation asked for it, and which model call decided to
  conv_id     uuid references public.inbox_conversations(id) on delete set null,
  ai_call_id  uuid references public.ai_calls(id) on delete set null,
  -- 'auto' the tool was marked safe and automatic
  -- 'staff' a person at the desk pressed it
  -- 'approved' the model asked and a person said yes
  authority   text not null check (authority in ('auto', 'staff', 'approved')),
  approved_by uuid,
  ok          boolean not null default true,
  result      jsonb,
  error       text,
  latency_ms  int,
  at          timestamptz not null default now()
);

create index if not exists mcp_calls_org on public.mcp_calls (org_id, at desc);
create index if not exists mcp_calls_conv on public.mcp_calls (conv_id, at desc);

-- Something the model wants to do and may not do on its own.
create table if not exists public.mcp_approvals (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  server_id   uuid not null references public.mcp_servers(id) on delete cascade,
  conv_id     uuid references public.inbox_conversations(id) on delete set null,
  tool        text not null,
  arguments   jsonb not null default '{}'::jsonb,
  -- what the model said it was for, in its own words, for the person deciding
  reason      text,
  state       text not null default 'pending'
              check (state in ('pending', 'approved', 'denied', 'expired', 'done')),
  decided_by  uuid,
  decided_at  timestamptz,
  -- an approval nobody answered is not an approval. It lapses.
  expires_at  timestamptz not null default now() + interval '1 hour',
  created_at  timestamptz not null default now()
);

create index if not exists mcp_approvals_pending
  on public.mcp_approvals (org_id, created_at desc) where state = 'pending';

comment on column public.mcp_approvals.expires_at is
  'An approval nobody answered lapses rather than waiting forever. A yes pressed tomorrow for a request made today is a yes to something that is no longer true.';

-- ============================================================
-- WHO MAY SEE AND CHANGE THIS
-- ============================================================

alter table public.mcp_servers   enable row level security;
alter table public.mcp_tools     enable row level security;
alter table public.mcp_calls     enable row level security;
alter table public.mcp_approvals enable row level security;

drop policy if exists mcp_servers_read on public.mcp_servers;
create policy mcp_servers_read on public.mcp_servers
  for select using (public.is_org_member(org_id));
drop policy if exists mcp_servers_owner on public.mcp_servers;
create policy mcp_servers_owner on public.mcp_servers
  for all using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));

drop policy if exists mcp_tools_read on public.mcp_tools;
create policy mcp_tools_read on public.mcp_tools
  for select using (public.is_org_member(org_id));
-- Enabling a tool is granting an ability. That is the owner's.
drop policy if exists mcp_tools_owner on public.mcp_tools;
create policy mcp_tools_owner on public.mcp_tools
  for all using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));

drop policy if exists mcp_calls_read on public.mcp_calls;
create policy mcp_calls_read on public.mcp_calls
  for select using (public.is_org_member(org_id));

-- Staff may answer an approval; that is the point of them being at a desk.
drop policy if exists mcp_approvals_read on public.mcp_approvals;
create policy mcp_approvals_read on public.mcp_approvals
  for select using (public.is_org_member(org_id));
drop policy if exists mcp_approvals_decide on public.mcp_approvals;
create policy mcp_approvals_decide on public.mcp_approvals
  for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

revoke all on public.mcp_servers, public.mcp_tools, public.mcp_calls, public.mcp_approvals
  from anon, authenticated;
grant select on public.mcp_servers, public.mcp_tools, public.mcp_calls, public.mcp_approvals
  to authenticated;
grant insert, update, delete on public.mcp_servers, public.mcp_tools to authenticated;
grant update on public.mcp_approvals to authenticated;

-- ============================================================
-- DECIDING ONE, ATOMICALLY
--
-- Two people at the desk pressing approve on the same request must
-- produce one call, not two. The state change is the lock.
-- ============================================================

create or replace function public.mcp_decide(
  p_id uuid, p_approve boolean, p_by uuid
) returns public.mcp_approvals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare row public.mcp_approvals;
begin
  update public.mcp_approvals a
     set state = case when p_approve then 'approved' else 'denied' end,
         decided_by = p_by,
         decided_at = now()
   where a.id = p_id
     and a.state = 'pending'
     and a.expires_at > now()
  returning a.* into row;
  return row;                 -- null when it was already decided or lapsed
end $$;

revoke all on function public.mcp_decide(uuid, boolean, uuid) from public, anon, authenticated;

comment on function public.mcp_decide(uuid, boolean, uuid) is
  'Decide one pending approval. Returns null if it was already decided or has lapsed — two people pressing approve produce one call, not two.';
