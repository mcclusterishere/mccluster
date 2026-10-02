-- ACTION NETWORK FELLOWSHIP v1: three verified actions open the application.
--
-- Points are feedback; access is the reward. The fellowship is the first
-- thing a verified Action Record unlocks: a member with at least three
-- verified missions can apply. The server counts the verified missions
-- itself, so nobody applies on a number they typed. One open application
-- at a time; the desk accepts or declines it with a note the member sees.
create table public.action_fellowship_applications (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 m_uid uuid not null references public.m_people(id) on delete cascade,
 status text not null default 'submitted' check (status in ('submitted','accepted','declined','withdrawn')),
 why text not null check (char_length(why) between 40 and 3000),
 project text not null default '' check (char_length(project) <= 3000),
 hours_per_week smallint check (hours_per_week is null or hours_per_week between 1 and 60),
 verified_actions_at_apply integer not null check (verified_actions_at_apply >= 0),
 review_note text,
 reviewer_uid uuid,
 created_at timestamptz not null default now(),
 reviewed_at timestamptz
);
-- one open application per member
create unique index action_fellowship_one_open on public.action_fellowship_applications(user_id) where status = 'submitted';
create index action_fellowship_status_idx on public.action_fellowship_applications(status, created_at);
create index action_fellowship_m_uid_idx on public.action_fellowship_applications(m_uid);

alter table public.action_fellowship_applications enable row level security;
revoke all on public.action_fellowship_applications from public, anon, authenticated;
grant all on public.action_fellowship_applications to service_role;
grant select on public.action_fellowship_applications to authenticated;
create policy "members read own fellowship applications" on public.action_fellowship_applications
 for select to authenticated using (user_id = (select auth.uid()) or (select public.eu_is_admin()));

-- the threshold lives in one place
create or replace function public.action_fellowship_min_verified()
returns integer language sql immutable set search_path = '' as $$ select 3 $$;

create or replace function public.action_fellowship_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as uid),
  n as (select count(*)::int as verified from public.action_mission_assignments a, me where a.user_id = me.uid and a.status = 'verified'),
  latest as (
    select f.id, f.status, f.created_at, f.reviewed_at, f.review_note
    from public.action_fellowship_applications f, me where f.user_id = me.uid
    order by f.created_at desc limit 1)
  select case when (select uid from me) is null then null else jsonb_build_object(
    'verified_actions', (select verified from n),
    'needed', public.action_fellowship_min_verified(),
    'eligible', (select verified from n) >= public.action_fellowship_min_verified(),
    'application', (select to_jsonb(latest) from latest)
  ) end;
$$;

create or replace function public.apply_for_fellowship(
 p_why text,
 p_project text default '',
 p_hours_per_week integer default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_m_uid uuid := public.current_m_uid();
 v_verified integer;
 v_why text := btrim(coalesce(p_why, ''));
 v_project text := btrim(coalesce(p_project, ''));
 v_id uuid;
begin
 if v_user is null then raise exception 'sign in to apply'; end if;
 if v_m_uid is null then raise exception 'your Action identity is not ready yet'; end if;
 if char_length(v_why) < 40 then raise exception 'tell us why in at least 40 characters'; end if;
 if char_length(v_why) > 3000 or char_length(v_project) > 3000 then raise exception 'keep each answer under 3,000 characters'; end if;
 if p_hours_per_week is not null and (p_hours_per_week < 1 or p_hours_per_week > 60) then raise exception 'hours per week must be between 1 and 60'; end if;

 select count(*) into v_verified from public.action_mission_assignments where user_id = v_user and status = 'verified';
 if v_verified < public.action_fellowship_min_verified() then
   raise exception 'the fellowship opens after % verified actions; you have %', public.action_fellowship_min_verified(), v_verified;
 end if;
 if exists (select 1 from public.action_fellowship_applications where user_id = v_user and status = 'submitted') then
   raise exception 'you already have an application in review';
 end if;
 if exists (select 1 from public.action_fellowship_applications where user_id = v_user and status = 'accepted') then
   raise exception 'you are already a fellow';
 end if;

 insert into public.action_fellowship_applications(user_id, m_uid, why, project, hours_per_week, verified_actions_at_apply)
 values (v_user, v_m_uid, v_why, v_project, p_hours_per_week, v_verified)
 returning id into v_id;
 return jsonb_build_object('application_id', v_id, 'status', 'submitted', 'verified_actions', v_verified);
end;
$$;

create or replace function public.withdraw_fellowship_application(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := (select auth.uid());
begin
 if v_user is null then raise exception 'sign in first'; end if;
 update public.action_fellowship_applications set status = 'withdrawn'
  where id = p_application_id and user_id = v_user and status = 'submitted';
 if not found then raise exception 'no open application to withdraw'; end if;
 return jsonb_build_object('application_id', p_application_id, 'status', 'withdrawn');
end;
$$;

create or replace function public.review_fellowship_application(
 p_application_id uuid,
 p_decision text,
 p_review_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_app public.action_fellowship_applications%rowtype;
begin
 if (select auth.uid()) is null or not (select public.eu_is_admin()) then raise exception 'not authorized'; end if;
 if p_decision not in ('accepted','declined') then raise exception 'decision must be accepted or declined'; end if;
 select * into v_app from public.action_fellowship_applications where id = p_application_id for update;
 if not found then raise exception 'application not found'; end if;
 if v_app.status <> 'submitted' then
   return jsonb_build_object('application_id', v_app.id, 'status', v_app.status, 'idempotent', true);
 end if;
 if v_app.user_id = (select auth.uid()) then raise exception 'you cannot review your own application'; end if;
 update public.action_fellowship_applications
    set status = p_decision, review_note = nullif(btrim(coalesce(p_review_note, '')), ''),
        reviewer_uid = public.current_m_uid(), reviewed_at = now()
  where id = v_app.id;
 return jsonb_build_object('application_id', v_app.id, 'status', p_decision);
end;
$$;

revoke all on function public.action_fellowship_min_verified() from public;
revoke all on function public.action_fellowship_status() from public, anon;
revoke all on function public.apply_for_fellowship(text, text, integer) from public, anon;
revoke all on function public.withdraw_fellowship_application(uuid) from public, anon;
revoke all on function public.review_fellowship_application(uuid, text, text) from public, anon;
grant execute on function public.action_fellowship_min_verified() to anon, authenticated, service_role;
grant execute on function public.action_fellowship_status() to authenticated, service_role;
grant execute on function public.apply_for_fellowship(text, text, integer) to authenticated, service_role;
grant execute on function public.withdraw_fellowship_application(uuid) to authenticated, service_role;
grant execute on function public.review_fellowship_application(uuid, text, text) to authenticated, service_role;
