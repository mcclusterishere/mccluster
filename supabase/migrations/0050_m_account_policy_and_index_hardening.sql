-- Keep M Account policy checks index-friendly and let every linked auth record
-- see the canonical person's devices/apps. This does not weaken identity
-- linking: only rows already linked to the same canonical M UID qualify.

create index if not exists m_devices_last_app_idx on public.m_devices(last_app_id);
create index if not exists m_devices_last_org_idx on public.m_devices(last_org_id);
create index if not exists m_person_apps_app_idx on public.m_person_apps(app_id);
create index if not exists m_person_apps_org_idx on public.m_person_apps(org_id);

drop policy if exists m_devices_read_self on public.m_devices;
create policy m_devices_read_self on public.m_devices
  for select to authenticated
  using (exists (
    select 1 from public.m_auth_user_links l
    where l.m_uid = m_devices.m_uid
      and l.auth_user_id = (select auth.uid())
  ));

drop policy if exists m_people_read_self on public.m_people;
create policy m_people_read_self on public.m_people
  for select to authenticated
  using (exists (
    select 1 from public.m_auth_user_links l
    where l.m_uid = m_people.id
      and l.auth_user_id = (select auth.uid())
  ));

drop policy if exists m_auth_user_links_read_self on public.m_auth_user_links;
create policy m_auth_user_links_read_self on public.m_auth_user_links
  for select to authenticated
  using (m_uid = (
    select l.m_uid
    from public.m_auth_user_links l
    where l.auth_user_id = (select auth.uid())
  ));

drop policy if exists m_person_apps_read_self on public.m_person_apps;
create policy m_person_apps_read_self on public.m_person_apps
  for select to authenticated
  using (exists (
    select 1 from public.m_auth_user_links l
    where l.m_uid = m_person_apps.m_uid
      and l.auth_user_id = (select auth.uid())
  ));
