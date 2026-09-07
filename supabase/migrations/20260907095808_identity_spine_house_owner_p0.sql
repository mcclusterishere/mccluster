-- Applied to production first during the 2026-09-07 incident response.
-- House authority is UUID/org-membership based; JWT email strings are never admin credentials.

create or replace function public.mccluster_is_house_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and exists (
       select 1
       from public.org_members m
       join public.orgs o on o.id = m.org_id
       where o.slug = 'mccluster'
         and m.profile_id = auth.uid()
         and m.role = 'owner'
     );
$$;

create or replace function public.eu_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null then 'visitor'
    when public.mccluster_is_house_owner() then 'admin'
    else coalesce((select p.role from public.eu_profiles p where p.id = auth.uid()), 'visitor')
  end;
$$;

create or replace function public.eu_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.mccluster_is_house_owner();
$$;

drop policy if exists "only the desk reads it" on public.events;
create policy "only the desk reads it" on public.events
for select to public
using (public.eu_is_admin());

drop policy if exists feed_file on public.feed;
create policy feed_file on public.feed
for insert to authenticated
with check (public.eu_is_admin());

drop policy if exists feed_pull on public.feed;
create policy feed_pull on public.feed
for delete to authenticated
using (public.eu_is_admin());

drop policy if exists leads_desk on public.leads;
create policy leads_desk on public.leads
for select to authenticated
using (public.eu_is_admin());

drop policy if exists leads_work on public.leads;
create policy leads_work on public.leads
for update to authenticated
using (public.eu_is_admin());

drop policy if exists of_admin on public.offerings;
create policy of_admin on public.offerings
for all to authenticated
using (public.eu_is_admin())
with check (public.eu_is_admin());

drop policy if exists cp_admin on public.campaigns;
create policy cp_admin on public.campaigns
for all to authenticated
using (public.eu_is_admin())
with check (public.eu_is_admin());

drop policy if exists md_admin on public.modules;
create policy md_admin on public.modules
for all to authenticated
using (public.eu_is_admin())
with check (public.eu_is_admin());

drop policy if exists eng_admin on public.engagements;
create policy eng_admin on public.engagements
for all to authenticated
using (public.eu_is_admin())
with check (public.eu_is_admin());

drop policy if exists engm_admin on public.engagement_modules;
create policy engm_admin on public.engagement_modules
for all to authenticated
using (public.eu_is_admin())
with check (public.eu_is_admin());

drop policy if exists ls_admin on public.licence_scopes;
create policy ls_admin on public.licence_scopes
for all to authenticated
using (public.eu_is_admin())
with check (public.eu_is_admin());
