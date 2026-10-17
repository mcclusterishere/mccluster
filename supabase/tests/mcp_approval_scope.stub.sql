-- Disposable PostgreSQL fixture only, never production.
create role anon;
create role authenticated;
create role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create table public.mcp_approvals (
  id uuid primary key,
  org_id uuid not null,
  server_id uuid,
  conv_id uuid,
  tool text not null,
  arguments jsonb not null default '{}'::jsonb,
  reason text,
  state text not null,
  decided_by uuid,
  decided_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);
alter table public.mcp_approvals enable row level security;
grant select, update on public.mcp_approvals to authenticated;
grant all on public.mcp_approvals to service_role;
create policy mcp_approvals_read on public.mcp_approvals for select to public using (true);
create policy mcp_approvals_decide on public.mcp_approvals for update to public using (true) with check (true);
