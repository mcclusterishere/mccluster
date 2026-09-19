create table public.analytics_sites (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  org_id uuid references public.orgs(id) on delete set null,
  site_account_id uuid unique references public.site_accounts(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  public_key text not null unique default ('mca_' || replace(gen_random_uuid()::text, '-', '')),
  status text not null default 'active' check (status in ('active','paused','disabled')),
  consent_mode text not null default 'required' check (consent_mode in ('required','managed','cookieless')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index analytics_sites_owner_idx on public.analytics_sites(owner_user_id);
create index analytics_sites_org_idx on public.analytics_sites(org_id) where org_id is not null;

create table public.analytics_site_domains (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.analytics_sites(id) on delete cascade,
  hostname text not null unique check (
    hostname = lower(hostname)
    and hostname ~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$'
    and position('.' in hostname) > 0
  ),
  verification_token text not null unique default ('mc_verify_' || replace(gen_random_uuid()::text, '-', '')),
  verified_at timestamptz,
  verification_method text not null default 'dns' check (verification_method in ('dns','managed')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index analytics_site_domains_site_idx on public.analytics_site_domains(site_id);

alter table public.events
  add column site_id uuid references public.analytics_sites(id) on delete set null,
  add column source_host text;

create index events_site_at_idx on public.events(site_id, at desc) where site_id is not null;
create index events_site_session_idx on public.events(site_id, session_id) where site_id is not null and session_id is not null;
create index events_site_device_idx on public.events(site_id, device_id) where site_id is not null and device_id is not null;

alter table public.analytics_sites enable row level security;
alter table public.analytics_site_domains enable row level security;

create policy analytics_sites_select on public.analytics_sites
for select to authenticated
using (
  owner_user_id = (select auth.uid())
  or (org_id is not null and private.is_org_member(org_id))
);
create policy analytics_sites_insert on public.analytics_sites
for insert to authenticated
with check (owner_user_id = (select auth.uid()));
create policy analytics_sites_update on public.analytics_sites
for update to authenticated
using (owner_user_id = (select auth.uid()))
with check (owner_user_id = (select auth.uid()));
create policy analytics_sites_delete on public.analytics_sites
for delete to authenticated
using (owner_user_id = (select auth.uid()));

create policy analytics_domains_select on public.analytics_site_domains
for select to authenticated
using (exists (
  select 1 from public.analytics_sites s
  where s.id = analytics_site_domains.site_id
));
create policy analytics_domains_insert on public.analytics_site_domains
for insert to authenticated
with check (exists (
  select 1 from public.analytics_sites s
  where s.id = analytics_site_domains.site_id
    and s.owner_user_id = (select auth.uid())
));
create policy analytics_domains_update on public.analytics_site_domains
for update to authenticated
using (exists (
  select 1 from public.analytics_sites s
  where s.id = analytics_site_domains.site_id
    and s.owner_user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.analytics_sites s
  where s.id = analytics_site_domains.site_id
    and s.owner_user_id = (select auth.uid())
));
create policy analytics_domains_delete on public.analytics_site_domains
for delete to authenticated
using (exists (
  select 1 from public.analytics_sites s
  where s.id = analytics_site_domains.site_id
    and s.owner_user_id = (select auth.uid())
));

grant select, insert, update, delete on public.analytics_sites to authenticated;
grant select, insert, update, delete on public.analytics_site_domains to authenticated;
revoke all on public.analytics_sites from anon;
revoke all on public.analytics_site_domains from anon;

drop policy if exists "anyone writes the exhaust" on public.events;
revoke insert on public.events from anon, authenticated;

create policy "analytics owners read site events" on public.events
for select to authenticated
using (
  site_id is not null
  and exists (
    select 1 from public.analytics_sites s
    where s.id = events.site_id
  )
);

create or replace view public.analytics_site_daily
with (security_invoker = true) as
select
  site_id,
  date_trunc('day', at)::date as day,
  count(*) filter (where name='page_view' and is_bot is not true) as pageviews,
  count(distinct session_id) filter (where is_bot is not true) as sessions,
  count(distinct device_id) filter (where is_bot is not true) as visitors,
  count(*) filter (where is_bot is true) as bot_events,
  count(*) filter (where name in ('js_error','js_rejection')) as error_events,
  count(*) filter (where name='form_submit') as form_submits
from public.events
where site_id is not null
group by site_id, date_trunc('day', at)::date;

grant select on public.analytics_site_daily to authenticated;
revoke all on public.analytics_site_daily from anon;

create or replace function private.provision_site_analytics()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_site_id uuid;
  v_host text;
begin
  insert into public.analytics_sites(owner_user_id, site_account_id, name, consent_mode, settings)
  values (
    new.user_id,
    new.id,
    new.site_name,
    'required',
    jsonb_build_object('provisioned_by','site_accounts')
  )
  on conflict (site_account_id) do update
  set owner_user_id = excluded.owner_user_id,
      name = excluded.name,
      updated_at = now()
  returning id into v_site_id;

  v_host := lower(split_part(regexp_replace(coalesce(new.site_url,''), '^[A-Za-z][A-Za-z0-9+.-]*://', ''), '/', 1));
  v_host := split_part(v_host, ':', 1);

  if v_host ~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$' and position('.' in v_host) > 0 then
    insert into public.analytics_site_domains(site_id, hostname, verified_at, verification_method)
    values (v_site_id, v_host, now(), 'managed')
    on conflict (hostname) do update
    set verified_at = case
          when public.analytics_site_domains.site_id = excluded.site_id
          then coalesce(public.analytics_site_domains.verified_at, now())
          else public.analytics_site_domains.verified_at
        end,
        verification_method = case
          when public.analytics_site_domains.site_id = excluded.site_id
          then 'managed'
          else public.analytics_site_domains.verification_method
        end,
        enabled = case
          when public.analytics_site_domains.site_id = excluded.site_id
          then true
          else public.analytics_site_domains.enabled
        end,
        updated_at = now()
    where public.analytics_site_domains.site_id = excluded.site_id;
  end if;

  return new;
end
$$;
revoke all on function private.provision_site_analytics() from public, anon, authenticated;

create trigger site_accounts_provision_analytics
after insert or update of site_name, site_url, user_id on public.site_accounts
for each row execute function private.provision_site_analytics();
