-- PROPOSAL ONLY. Not in supabase/pending, not applied, needs the owner's approval and the normal promotion steps.
-- Which hostnames belong to which Equity Uprise tenant. Expand only; reads the production eu_platform_tenants.
begin;
set local lock_timeout = '3s';
create table public.eu_platform_tenant_hosts (
  hostname text primary key check (hostname = lower(hostname) and hostname ~ '^[a-z0-9.-]+$'),
  tenant_org_id uuid not null references public.eu_platform_tenants(org_id) on delete restrict,
  role text not null check (role in ('canonical','alias','door')),
  state text not null default 'planned' check (state in ('planned','routed','retired')),
  cloudflare_custom_hostname_id text,
  created_at timestamptz not null default now()
);
create unique index eu_platform_tenant_hosts_one_canonical on public.eu_platform_tenant_hosts(tenant_org_id) where role = 'canonical';
alter table public.eu_platform_tenant_hosts enable row level security;
create policy eu_platform_tenant_hosts_read on public.eu_platform_tenant_hosts for select to anon, authenticated
  using (exists (select 1 from public.eu_platform_tenants t where t.org_id = tenant_org_id and t.enabled));
revoke all on public.eu_platform_tenant_hosts from public, anon, authenticated;
grant select on public.eu_platform_tenant_hosts to anon, authenticated;
grant select, insert, update, delete on public.eu_platform_tenant_hosts to service_role;
insert into public.eu_platform_tenant_hosts(hostname, tenant_org_id, role, state)
select h.hostname, o.id, h.role, h.state from (values
  ('equityuprise.com','equity-uprise','canonical','planned'),
  ('www.equityuprise.com','equity-uprise','alias','planned'),
  ('humanuprise.com','equity-uprise','door','planned'),
  ('www.humanuprise.com','equity-uprise','door','planned'),
  ('mccluster.org','mccluster','canonical','routed'),
  ('www.mccluster.org','mccluster','alias','routed')
) as h(hostname, slug, role, state) join public.orgs o on o.slug = h.slug;
-- matthew.mccluster.org stays a tenant of the one record (tenants.matthew); it is the mccluster org's profile host,
-- so it is not a second canonical row for that org.
commit;
