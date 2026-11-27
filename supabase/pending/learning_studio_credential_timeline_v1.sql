-- Pending only. Private owner planning notes, not institutional records.
begin;

create table public.learning_studio_timelines (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision integer not null check (revision >= 1),
  plan jsonb not null,
  updated_at timestamptz not null default now(),
  constraint learning_studio_timeline_plan_envelope check ((
    jsonb_typeof(plan) = 'object'
    and plan->'version' = '1'::jsonb
    and jsonb_typeof(plan->'goals') = 'array'
    and jsonb_typeof(plan->'items') = 'array'
    and (not plan ? 'budget' or jsonb_typeof(plan->'budget') = 'object')
    and octet_length(plan::text) <= 524288
  ) is true)
);

alter table public.learning_studio_timelines enable row level security;
revoke all on public.learning_studio_timelines from public, anon, authenticated, service_role;
grant select, insert, update on public.learning_studio_timelines to service_role;

-- Invoker privileges: the trusted service supplies the verified session UUID;
-- browser roles can neither call this function nor read/write the table.
-- No append-only copy of personal data and no queue/notification side effects.
create function public.learning_studio_save_timeline(p_owner uuid, p_expected integer, p_plan jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  saved_revision integer;
begin
  if not exists (
    select 1 from public.orgs o join public.org_members m on m.org_id = o.id
    where o.slug = 'mccluster' and o.enabled is true and m.profile_id = p_owner and m.role = 'owner'
  ) then
    raise exception 'House owner required' using errcode = '42501';
  end if;

  -- Never allow a rejected payload to reach a table CHECK that might report
  -- its private contents as the PostgreSQL error DETAIL.
  if (
    p_expected >= 0
    and jsonb_typeof(p_plan) = 'object'
    and p_plan->'version' = '1'::jsonb
    and jsonb_typeof(p_plan->'goals') = 'array'
    and jsonb_typeof(p_plan->'items') = 'array'
    and (not p_plan ? 'budget' or jsonb_typeof(p_plan->'budget') = 'object')
    and octet_length(p_plan::text) <= 524288
  ) is not true then
    raise exception 'Invalid timeline save request' using errcode = '22023';
  end if;
  if (p_plan - array['version', 'goals', 'items', 'budget']) <> '{}'::jsonb then
    raise exception 'Invalid timeline save request' using errcode = '22023';
  end if;

  if p_expected = 0 then
    insert into public.learning_studio_timelines(owner_id, revision, plan)
      select p_owner, 1, p_plan
      where exists (
        select 1 from public.orgs o join public.org_members m on m.org_id = o.id
        where o.slug = 'mccluster' and o.enabled is true and m.profile_id = p_owner and m.role = 'owner'
      )
      on conflict (owner_id) do nothing
      returning revision into saved_revision;
  else
    update public.learning_studio_timelines t
      set plan = p_plan, revision = t.revision + 1, updated_at = clock_timestamp()
      where t.owner_id = p_owner and t.revision = p_expected and t.revision < 2147483647
        and exists (
          select 1 from public.orgs o join public.org_members m on m.org_id = o.id
          where o.slug = 'mccluster' and o.enabled is true and m.profile_id = p_owner and m.role = 'owner'
        )
      returning t.revision into saved_revision;
  end if;

  -- Do not read another owner's data or return the current revision on conflict.
  return coalesce(saved_revision, 0);
end $$;

revoke all on function public.learning_studio_save_timeline(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.learning_studio_save_timeline(uuid, integer, jsonb) to service_role;

commit;
