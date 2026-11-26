-- EQUITY UPRISE FELLOW ONBOARDING v1 (PENDING: not applied in production).
--
-- Owner direction, 2026-11-25: Equity Uprise is an invite-only fellowship.
-- A person becomes a fellow one of two ways, and both end in the same place:
--
--   invite       the owner issues a private, single-use invitation link
--                (eu_fellow_issue_invite). Accepting it IS the acceptance:
--                the enrollment starts at 'accepted'.
--   request      a signed-in member asks for an invitation
--                (eu_fellow_apply) while the cohort's requests are open. The
--                owner or an admin accepts or declines it
--                (eu_fellow_review). Requests ship CLOSED.
--
-- Accepted people then finish three onboarding steps on their own
-- (eu_fellow_onboarding_step): the fellow agreement, a short public intro,
-- and a work plan for "Write the Change". The last step makes them a fellow
-- and seats them in the cohort's existing roster (action_cohort_members), the
-- same private roster admit_fellow_to_cohort() writes.
--
-- This is separate from the Action Network fellowship queue
-- (action_fellowship_applications, three verified missions) and from the
-- HERE client intake (onboard.html). Neither is changed.
--
-- The 2026 cohort is mirrored from how Cohort 1 (2025) is represented:
-- Cohort 1 is the Docket 516R project (data/action/docket-516r-archive.json,
-- 20261017164335_action_archive_cohort_v1) under campaign equity-uprise-003
-- (20261005054036_equity_uprise_group_docket_516r). The 2026 cohort is one
-- action_cohorts row under that same campaign plus one eu_fellow_cohorts row
-- that carries its year, page and request switch. No members are seeded and
-- nothing is claimed about who will join. Its archive project is written only
-- after it completes, the way Cohort 1's was.
--
-- The wall: every table here is RLS-on and forced; the API roles can only
-- read (cohorts publicly, enrollments their own, invites never); every write
-- is one of the security-definer functions below, each of which checks the
-- caller itself. Invitation tokens are never stored, only their sha256.
-- Idempotent: applying twice is harmless. Rollback:
-- eu_fellow_onboarding_v1.rollback.sql.

create table if not exists public.eu_fellow_cohorts (
 cohort_id uuid primary key references public.action_cohorts(id) on delete cascade,
 slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
 year smallint not null check (year between 2025 and 2100),
 title text not null check (char_length(title) between 1 and 120),
 mission_title text not null default '' check (char_length(mission_title) <= 120),
 page_url text not null default '' check (page_url = '' or page_url like 'https://%'),
 forms_by date,
 requests_open boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
comment on table public.eu_fellow_cohorts is 'Invite-only Equity Uprise fellowship cohorts. requests_open lets signed-in members ask for an invitation; invitations work either way.';

create table if not exists public.eu_fellow_enrollments (
 id uuid primary key default gen_random_uuid(),
 cohort_id uuid not null references public.eu_fellow_cohorts(cohort_id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 m_uid uuid not null references public.m_people(id) on delete cascade,
 path text not null check (path in ('invite','request')),
 status text not null default 'requested' check (status in ('requested','accepted','declined','withdrawn','fellow')),
 display_name text not null check (char_length(display_name) between 1 and 120),
 discipline text not null default '' check (char_length(discipline) <= 120),
 statement text not null check (char_length(statement) between 40 and 3000),
 work_links text[] not null default '{}' check (cardinality(work_links) <= 5),
 agreement_at timestamptz,
 intro text not null default '' check (char_length(intro) <= 600),
 intro_at timestamptz,
 work_plan text not null default '' check (char_length(work_plan) <= 3000),
 work_plan_at timestamptz,
 review_note text,
 reviewer_m_uid uuid,
 reviewed_at timestamptz,
 fellow_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (cohort_id, user_id)
);
create index if not exists eu_fellow_enrollments_status_idx on public.eu_fellow_enrollments(cohort_id, status, created_at);
create index if not exists eu_fellow_enrollments_user_idx on public.eu_fellow_enrollments(user_id);
create index if not exists eu_fellow_enrollments_m_uid_idx on public.eu_fellow_enrollments(m_uid);

create table if not exists public.eu_fellow_invites (
 token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
 cohort_id uuid not null references public.eu_fellow_cohorts(cohort_id) on delete cascade,
 label text not null default '' check (char_length(label) <= 120),
 issued_by uuid,
 expires_at timestamptz not null,
 revoked_at timestamptz,
 consumed_at timestamptz,
 consumed_by uuid references public.eu_fellow_enrollments(id) on delete set null,
 created_at timestamptz not null default now(),
 check (expires_at > created_at)
);
comment on table public.eu_fellow_invites is 'Single-use fellowship invitations. Only the sha256 of the token is stored; the label is a private desk note, never shown publicly.';
create index if not exists eu_fellow_invites_cohort_idx on public.eu_fellow_invites(cohort_id, created_at);
create index if not exists eu_fellow_invites_consumer_idx on public.eu_fellow_invites(consumed_by) where consumed_by is not null;

alter table public.eu_fellow_cohorts enable row level security;
alter table public.eu_fellow_enrollments enable row level security;
alter table public.eu_fellow_invites enable row level security;
alter table public.eu_fellow_cohorts force row level security;
alter table public.eu_fellow_enrollments force row level security;
alter table public.eu_fellow_invites force row level security;
revoke all on public.eu_fellow_cohorts, public.eu_fellow_enrollments, public.eu_fellow_invites from public, anon, authenticated;
grant all on public.eu_fellow_cohorts, public.eu_fellow_enrollments, public.eu_fellow_invites to service_role;
grant select on public.eu_fellow_cohorts to anon, authenticated;
grant select on public.eu_fellow_enrollments to authenticated;

drop policy if exists eu_fellow_cohorts_public on public.eu_fellow_cohorts;
create policy eu_fellow_cohorts_public on public.eu_fellow_cohorts for select to anon, authenticated
 using (exists (select 1 from public.action_cohorts c where c.id = cohort_id and c.status in ('active','complete')));
drop policy if exists eu_fellow_enrollments_own on public.eu_fellow_enrollments;
create policy eu_fellow_enrollments_own on public.eu_fellow_enrollments for select to authenticated
 using (user_id = (select auth.uid()) or (select public.eu_is_admin()));
-- eu_fellow_invites: no policy for anon or authenticated at all. The desk
-- reads invitations through eu_fellow_desk().

-- ---------------------------------------------------------------- helpers
create or replace function public.eu_fellow_token_hash(p_token text)
returns text language sql immutable set search_path = '' as $$
 select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;
revoke all on function public.eu_fellow_token_hash(text) from public, anon, authenticated;
grant execute on function public.eu_fellow_token_hash(text) to service_role;

create or replace function public.eu_fellow_clean_links(p_links text[])
returns text[] language plpgsql immutable set search_path = '' as $$
declare v text; v_out text[] := '{}';
begin
 foreach v in array coalesce(p_links, '{}'::text[]) loop
  v := btrim(v);
  continue when v = '';
  if v !~ '^https://\S+$' or char_length(v) > 2048 then raise exception 'links must start with https:// and fit in 2,048 characters'; end if;
  v_out := v_out || v;
 end loop;
 if cardinality(v_out) > 5 then raise exception 'share up to five links'; end if;
 return v_out;
end $$;
revoke all on function public.eu_fellow_clean_links(text[]) from public, anon, authenticated;
grant execute on function public.eu_fellow_clean_links(text[]) to service_role;

create or replace function public.eu_fellow_enrollment_json(p_row public.eu_fellow_enrollments)
returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object(
  'id', p_row.id, 'cohort_id', p_row.cohort_id, 'path', p_row.path, 'status', p_row.status,
  'display_name', p_row.display_name, 'discipline', p_row.discipline,
  'statement', p_row.statement, 'work_links', to_jsonb(p_row.work_links),
  'steps', jsonb_build_object(
    'agreement', p_row.agreement_at is not null,
    'intro', p_row.intro_at is not null,
    'work_plan', p_row.work_plan_at is not null),
  'intro', p_row.intro, 'work_plan', p_row.work_plan,
  'review_note', p_row.review_note, 'reviewed_at', p_row.reviewed_at,
  'fellow_at', p_row.fellow_at, 'created_at', p_row.created_at)
$$;
revoke all on function public.eu_fellow_enrollment_json(public.eu_fellow_enrollments) from public, anon, authenticated;
grant execute on function public.eu_fellow_enrollment_json(public.eu_fellow_enrollments) to service_role;

create or replace function public.eu_fellow_cohort_json(p_cohort_id uuid)
returns jsonb language sql stable set search_path = '' as $$
 select jsonb_build_object('cohort_id', f.cohort_id, 'slug', f.slug, 'year', f.year, 'title', f.title,
  'mission_title', f.mission_title, 'page_url', f.page_url, 'forms_by', f.forms_by,
  'requests_open', f.requests_open, 'status', c.status)
 from public.eu_fellow_cohorts f join public.action_cohorts c on c.id = f.cohort_id
 where f.cohort_id = p_cohort_id
$$;
revoke all on function public.eu_fellow_cohort_json(uuid) from public, anon, authenticated;
grant execute on function public.eu_fellow_cohort_json(uuid) to service_role;

-- ---------------------------------------------------------------- anyone
-- What the onboarding page paints: the cohorts that are forming, and, for a
-- signed-in member, their own enrollment. Never anyone else's.
create or replace function public.eu_fellow_status()
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object(
  'signed_in', (select auth.uid()) is not null,
  'is_desk', coalesce((select public.eu_is_admin()), false) and (select auth.uid()) is not null,
  'cohorts', coalesce((select jsonb_agg(public.eu_fellow_cohort_json(f.cohort_id) order by f.year desc)
     from public.eu_fellow_cohorts f join public.action_cohorts c on c.id = f.cohort_id
     where c.status = 'active'), '[]'::jsonb),
  'enrollment', (select public.eu_fellow_enrollment_json(e) from public.eu_fellow_enrollments e
     where e.user_id = (select auth.uid()) and (select auth.uid()) is not null
     order by e.created_at desc limit 1))
$$;

create or replace function public.eu_fellow_invite_preview(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('cohort', public.eu_fellow_cohort_json(i.cohort_id), 'expires_at', i.expires_at)
 from public.eu_fellow_invites i
 join public.action_cohorts c on c.id = i.cohort_id and c.status = 'active'
 where i.token_hash = public.eu_fellow_token_hash(p_token)
   and p_token ~ '^[a-f0-9]{64}$'
   and i.consumed_at is null and i.revoked_at is null and i.expires_at > now()
$$;

-- ---------------------------------------------------------------- members
create or replace function public.eu_fellow_apply(
 p_cohort_id uuid, p_display_name text, p_discipline text, p_statement text, p_work_links text[] default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_user uuid := (select auth.uid());
 v_m_uid uuid := public.current_m_uid();
 v_cohort public.eu_fellow_cohorts%rowtype;
 v_status text;
 v_row public.eu_fellow_enrollments%rowtype;
begin
 if v_user is null then raise exception 'sign in to ask for an invitation'; end if;
 if v_m_uid is null then raise exception 'your M Account is not ready yet'; end if;
 select * into v_cohort from public.eu_fellow_cohorts where cohort_id = p_cohort_id;
 if not found then raise exception 'cohort not found'; end if;
 select status into v_status from public.action_cohorts where id = p_cohort_id;
 if v_status is distinct from 'active' then raise exception 'that cohort is not forming'; end if;
 if not v_cohort.requests_open then raise exception 'this cohort is invite only right now; requests are closed'; end if;
 if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 120 then raise exception 'add the name you create under'; end if;
 if char_length(btrim(coalesce(p_statement, ''))) < 40 then raise exception 'tell us the change you want to see in at least 40 characters'; end if;
 if char_length(btrim(coalesce(p_statement, ''))) > 3000 then raise exception 'keep your statement under 3,000 characters'; end if;
 if char_length(btrim(coalesce(p_discipline, ''))) > 120 then raise exception 'keep your discipline under 120 characters'; end if;
 if exists (select 1 from public.eu_fellow_enrollments where cohort_id = p_cohort_id and user_id = v_user) then
  raise exception 'you already have a place in this cohort''s queue';
 end if;
 insert into public.eu_fellow_enrollments(cohort_id, user_id, m_uid, path, status, display_name, discipline, statement, work_links)
 values (p_cohort_id, v_user, v_m_uid, 'request', 'requested', btrim(p_display_name), btrim(coalesce(p_discipline, '')),
         btrim(p_statement), public.eu_fellow_clean_links(p_work_links))
 returning * into v_row;
 return public.eu_fellow_enrollment_json(v_row);
end $$;

create or replace function public.eu_fellow_accept_invite(
 p_token text, p_display_name text, p_discipline text, p_statement text, p_work_links text[] default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_user uuid := (select auth.uid());
 v_m_uid uuid := public.current_m_uid();
 v_inv public.eu_fellow_invites%rowtype;
 v_status text;
 v_row public.eu_fellow_enrollments%rowtype;
begin
 if v_user is null then raise exception 'sign in to accept your invitation'; end if;
 if v_m_uid is null then raise exception 'your M Account is not ready yet'; end if;
 if coalesce(p_token, '') !~ '^[a-f0-9]{64}$' then raise exception 'INVITATION_UNAVAILABLE'; end if;
 select * into v_inv from public.eu_fellow_invites where token_hash = public.eu_fellow_token_hash(p_token) for update;
 if not found or v_inv.revoked_at is not null or v_inv.consumed_at is not null or v_inv.expires_at <= now() then
  raise exception 'INVITATION_UNAVAILABLE';
 end if;
 select status into v_status from public.action_cohorts where id = v_inv.cohort_id;
 if v_status is distinct from 'active' then raise exception 'that cohort is not forming'; end if;
 if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 120 then raise exception 'add the name you create under'; end if;
 if char_length(btrim(coalesce(p_statement, ''))) not between 40 and 3000 then raise exception 'tell us the change you want to see in 40 to 3,000 characters'; end if;
 if char_length(btrim(coalesce(p_discipline, ''))) > 120 then raise exception 'keep your discipline under 120 characters'; end if;

 select * into v_row from public.eu_fellow_enrollments where cohort_id = v_inv.cohort_id and user_id = v_user for update;
 if found then
  if v_row.status in ('accepted','fellow') then raise exception 'you are already accepted into this cohort'; end if;
  -- an invitation lifts an open, declined or withdrawn request to accepted
  update public.eu_fellow_enrollments set path = 'invite', status = 'accepted', display_name = btrim(p_display_name),
    discipline = btrim(coalesce(p_discipline, '')), statement = btrim(p_statement),
    work_links = public.eu_fellow_clean_links(p_work_links), reviewer_m_uid = null, review_note = null,
    reviewed_at = now(), updated_at = now()
   where id = v_row.id returning * into v_row;
 else
  insert into public.eu_fellow_enrollments(cohort_id, user_id, m_uid, path, status, display_name, discipline, statement, work_links, reviewed_at)
  values (v_inv.cohort_id, v_user, v_m_uid, 'invite', 'accepted', btrim(p_display_name), btrim(coalesce(p_discipline, '')),
          btrim(p_statement), public.eu_fellow_clean_links(p_work_links), now())
  returning * into v_row;
 end if;
 update public.eu_fellow_invites set consumed_at = now(), consumed_by = v_row.id where token_hash = v_inv.token_hash;
 return public.eu_fellow_enrollment_json(v_row);
end $$;

create or replace function public.eu_fellow_withdraw()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_row public.eu_fellow_enrollments%rowtype;
begin
 if v_user is null then raise exception 'sign in first'; end if;
 update public.eu_fellow_enrollments set status = 'withdrawn', updated_at = now()
  where user_id = v_user and status in ('requested','accepted') returning * into v_row;
 if not found then raise exception 'nothing to withdraw'; end if;
 return public.eu_fellow_enrollment_json(v_row);
end $$;

-- The three onboarding steps. Only an accepted person can take them, and the
-- third one taken makes them a fellow and seats them in the cohort roster.
create or replace function public.eu_fellow_onboarding_step(p_step text, p_value text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_user uuid := (select auth.uid());
 v_row public.eu_fellow_enrollments%rowtype;
 v_value text := btrim(coalesce(p_value, ''));
begin
 if v_user is null then raise exception 'sign in first'; end if;
 select * into v_row from public.eu_fellow_enrollments
  where user_id = v_user and status = 'accepted' order by created_at desc limit 1 for update;
 if not found then raise exception 'onboarding opens once you are accepted'; end if;
 if p_step = 'agreement' then
  if v_value <> 'I agree' then raise exception 'type I agree to accept the fellow agreement'; end if;
  update public.eu_fellow_enrollments set agreement_at = coalesce(agreement_at, now()), updated_at = now() where id = v_row.id;
 elsif p_step = 'intro' then
  if char_length(v_value) not between 20 and 600 then raise exception 'write your intro in 20 to 600 characters'; end if;
  update public.eu_fellow_enrollments set intro = v_value, intro_at = now(), updated_at = now() where id = v_row.id;
 elsif p_step = 'work_plan' then
  if char_length(v_value) not between 40 and 3000 then raise exception 'write your work plan in 40 to 3,000 characters'; end if;
  update public.eu_fellow_enrollments set work_plan = v_value, work_plan_at = now(), updated_at = now() where id = v_row.id;
 else
  raise exception 'unknown onboarding step';
 end if;

 select * into v_row from public.eu_fellow_enrollments where id = v_row.id;
 if v_row.agreement_at is not null and v_row.intro_at is not null and v_row.work_plan_at is not null then
  update public.eu_fellow_enrollments set status = 'fellow', fellow_at = now(), updated_at = now()
   where id = v_row.id returning * into v_row;
  insert into public.action_cohort_members(cohort_id, m_uid) values (v_row.cohort_id, v_row.m_uid)
  on conflict (cohort_id, m_uid) do nothing;
 end if;
 return public.eu_fellow_enrollment_json(v_row);
end $$;

-- ---------------------------------------------------------------- the desk
create or replace function public.eu_fellow_review(p_enrollment_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.eu_fellow_enrollments%rowtype;
begin
 if (select auth.uid()) is null or not (select public.eu_is_admin()) then raise exception 'not authorized'; end if;
 if p_decision not in ('accepted','declined') then raise exception 'decision must be accepted or declined'; end if;
 select * into v_row from public.eu_fellow_enrollments where id = p_enrollment_id for update;
 if not found then raise exception 'request not found'; end if;
 if v_row.user_id = (select auth.uid()) then raise exception 'you cannot review your own request'; end if;
 if v_row.status <> 'requested' then
  return public.eu_fellow_enrollment_json(v_row) || jsonb_build_object('idempotent', true);
 end if;
 update public.eu_fellow_enrollments set status = p_decision, review_note = nullif(btrim(coalesce(p_note, '')), ''),
   reviewer_m_uid = public.current_m_uid(), reviewed_at = now(), updated_at = now()
  where id = v_row.id returning * into v_row;
 return public.eu_fellow_enrollment_json(v_row);
end $$;

-- Returns the raw token exactly once. Only its hash is stored, so a lost
-- link is replaced, never recovered.
create or replace function public.eu_fellow_issue_invite(p_cohort_id uuid, p_label text default '', p_days integer default 14)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_token text; v_expires timestamptz;
begin
 if (select auth.uid()) is null or not (select public.eu_is_admin()) then raise exception 'not authorized'; end if;
 if not exists (select 1 from public.eu_fellow_cohorts f join public.action_cohorts c on c.id = f.cohort_id
                where f.cohort_id = p_cohort_id and c.status = 'active') then raise exception 'that cohort is not forming'; end if;
 if p_days is null or p_days < 1 or p_days > 30 then raise exception 'invitations last 1 to 30 days'; end if;
 if char_length(coalesce(p_label, '')) > 120 then raise exception 'keep the label under 120 characters'; end if;
 v_token := encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex');
 v_expires := now() + make_interval(days => p_days);
 insert into public.eu_fellow_invites(token_hash, cohort_id, label, issued_by, expires_at)
 values (public.eu_fellow_token_hash(v_token), p_cohort_id, btrim(coalesce(p_label, '')), public.current_m_uid(), v_expires);
 return jsonb_build_object('token', v_token, 'token_hash', public.eu_fellow_token_hash(v_token),
   'cohort_id', p_cohort_id, 'expires_at', v_expires);
end $$;

create or replace function public.eu_fellow_revoke_invite(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 if (select auth.uid()) is null or not (select public.eu_is_admin()) then raise exception 'not authorized'; end if;
 update public.eu_fellow_invites set revoked_at = now()
  where token_hash = p_token_hash and consumed_at is null and revoked_at is null;
 if not found then raise exception 'no open invitation with that id'; end if;
 return jsonb_build_object('token_hash', p_token_hash, 'revoked', true);
end $$;

create or replace function public.eu_fellow_set_requests_open(p_cohort_id uuid, p_open boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 if (select auth.uid()) is null or not (select public.eu_is_admin()) then raise exception 'not authorized'; end if;
 update public.eu_fellow_cohorts set requests_open = coalesce(p_open, false), updated_at = now() where cohort_id = p_cohort_id;
 if not found then raise exception 'cohort not found'; end if;
 return public.eu_fellow_cohort_json(p_cohort_id);
end $$;

create or replace function public.eu_fellow_desk(p_cohort_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 if (select auth.uid()) is null or not (select public.eu_is_admin()) then raise exception 'not authorized'; end if;
 return jsonb_build_object(
  'cohorts', coalesce((select jsonb_agg(public.eu_fellow_cohort_json(f.cohort_id) order by f.year desc)
     from public.eu_fellow_cohorts f where p_cohort_id is null or f.cohort_id = p_cohort_id), '[]'::jsonb),
  'enrollments', coalesce((select jsonb_agg(public.eu_fellow_enrollment_json(e) order by e.created_at desc)
     from public.eu_fellow_enrollments e where p_cohort_id is null or e.cohort_id = p_cohort_id), '[]'::jsonb),
  'invites', coalesce((select jsonb_agg(jsonb_build_object('token_hash', i.token_hash, 'cohort_id', i.cohort_id,
       'label', i.label, 'expires_at', i.expires_at, 'revoked_at', i.revoked_at, 'consumed_at', i.consumed_at,
       'state', case when i.consumed_at is not null then 'accepted' when i.revoked_at is not null then 'revoked'
                     when i.expires_at <= now() then 'expired' else 'open' end) order by i.created_at desc)
     from public.eu_fellow_invites i where p_cohort_id is null or i.cohort_id = p_cohort_id), '[]'::jsonb));
end $$;

revoke all on function public.eu_fellow_status() from public;
revoke all on function public.eu_fellow_invite_preview(text) from public;
revoke all on function public.eu_fellow_apply(uuid, text, text, text, text[]) from public, anon;
revoke all on function public.eu_fellow_accept_invite(text, text, text, text, text[]) from public, anon;
revoke all on function public.eu_fellow_withdraw() from public, anon;
revoke all on function public.eu_fellow_onboarding_step(text, text) from public, anon;
revoke all on function public.eu_fellow_review(uuid, text, text) from public, anon;
revoke all on function public.eu_fellow_issue_invite(uuid, text, integer) from public, anon;
revoke all on function public.eu_fellow_revoke_invite(text) from public, anon;
revoke all on function public.eu_fellow_set_requests_open(uuid, boolean) from public, anon;
revoke all on function public.eu_fellow_desk(uuid) from public, anon;
grant execute on function public.eu_fellow_status() to anon, authenticated, service_role;
grant execute on function public.eu_fellow_invite_preview(text) to anon, authenticated, service_role;
grant execute on function public.eu_fellow_apply(uuid, text, text, text, text[]) to authenticated, service_role;
grant execute on function public.eu_fellow_accept_invite(text, text, text, text, text[]) to authenticated, service_role;
grant execute on function public.eu_fellow_withdraw() to authenticated, service_role;
grant execute on function public.eu_fellow_onboarding_step(text, text) to authenticated, service_role;
grant execute on function public.eu_fellow_review(uuid, text, text) to authenticated, service_role;
grant execute on function public.eu_fellow_issue_invite(uuid, text, integer) to authenticated, service_role;
grant execute on function public.eu_fellow_revoke_invite(text) to authenticated, service_role;
grant execute on function public.eu_fellow_set_requests_open(uuid, boolean) to authenticated, service_role;
grant execute on function public.eu_fellow_desk(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- the 2026 cohort
-- One cohort row under Cohort 1's campaign (equity-uprise-003), active so the
-- desk can invite into it, requests closed. No members. Skipped quietly if the
-- campaign is not there (a fresh database without the 20261005 seed).
insert into public.action_cohorts (id, campaign_id, name, description, status)
select 'a8813ab5-f066-47c2-976c-c19581b3cb71', 'equity-uprise-003',
  'Equity Uprise · Cohort 2026',
  'Invite only. The 2026 cohort of Equity Uprise fellows, forming before December 31, 2026. Fellows join by invitation, or by asking for one and being accepted by the desk, then write the change they want to see.',
  'active'
where exists (select 1 from public.action_campaigns where id = 'equity-uprise-003')
on conflict (id) do nothing;

insert into public.eu_fellow_cohorts (cohort_id, slug, year, title, mission_title, page_url, forms_by, requests_open)
select 'a8813ab5-f066-47c2-976c-c19581b3cb71', 'equity-uprise-2026', 2026, 'Equity Uprise · Cohort 2026',
  'Write the Change', 'https://matthew.mccluster.org/equity-uprise-cohort-2026.html', date '2026-12-31', false
where exists (select 1 from public.action_cohorts where id = 'a8813ab5-f066-47c2-976c-c19581b3cb71')
on conflict (cohort_id) do nothing;
