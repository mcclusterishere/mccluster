-- LIVE MISSIONS V1 (pending; not applied in production)
--
-- Owner, 2026-10-15: "Mission completion should be live. You get on camera and
-- do it live; you remain live during the full mission until completion. On the
-- globe it shows users who are live right now doing missions. The video saves
-- and becomes a post." Owner decisions the same day: live is REQUIRED on every
-- mission (the per-mission field stays, so it is data, but every row ships
-- 'required'); "Live now" pins sit at CITY level, never exact coordinates.
--
-- Design: docs/control-plane/LIVE-MISSIONS.md. This file adds:
--   action_mission_live_policies   per-mission live rule (required/allowed/not_allowed)
--                                  and the continuity tolerances, default 'required'
--   action_live_controls           the owner's switches (accepting sessions; enforce
--                                  the required rule on proofs: OFF until enabled)
--   action_live_sessions           one live run of one assignment; Stream input ids
--                                  are column-private (members never read them)
--   action_live_segments           connected intervals, from Stream webhooks or,
--                                  where webhooks are absent, browser heartbeats
--   action_live_webhook_events     replay ledger (one row per delivered event)
--   action_live_recording_chunks   the browser recording, chunk by chunk, hashed
--   action_live_reports            viewers' reports
--   action_live_publishing_consents  the 12 publishing opt-ins (separate from
--                                  submission consent), versioned, revocable
--   action_bounty_live_coverage    coverage-bounty fields beside action_bounties
--
-- Rules enforced here, for ANY writer:
--   * a live session files its proof PENDING; an admin still verifies it
--     (nothing in this file can verify an assignment or a proof);
--   * a coverage-bounty claim becomes approved only behind a completed session
--     that covers the event window continuously (else it is rejected by rule
--     live_coverage_v1), and is never paid without one;
--   * a candidate-related coverage bounty cannot open before counsel clears it;
--     a political one must be funded from the separate political program;
--   * the public "Live now" read returns city cells and counts only.
--
-- Compatible with PR #444 (mission_admin_approval_v1): that file guards
-- 'verified' / 'approved' / 'paid' transitions; this one only adds
-- conditions, never a new way to verify or pay. Apply order does not matter.
--
-- Rollback: supabase/pending/live_missions_v1.rollback.sql
-- Tests: scripts/test-live-missions-db.sh (supabase/tests/live_missions.behaviour.sql)

-- ---------------------------------------------------------------- policies
create table if not exists public.action_mission_live_policies (
  mission_id uuid primary key references public.action_missions(id) on delete cascade,
  live_mode text not null default 'required' check (live_mode in ('required','allowed','not_allowed')),
  min_duration_seconds integer not null default 300 check (min_duration_seconds between 0 and 86400),
  max_duration_minutes integer not null default 240 check (max_duration_minutes between 5 and 1440),
  max_single_gap_seconds integer not null default 60 check (max_single_gap_seconds between 0 and 3600),
  max_total_gap_seconds integer not null default 180 check (max_total_gap_seconds between 0 and 7200),
  max_reconnects integer not null default 5 check (max_reconnects between 0 and 100),
  max_resumes integer not null default 1 check (max_resumes between 0 and 10),
  resume_window_minutes integer not null default 10 check (resume_window_minutes between 1 and 1440),
  pin_delay_seconds integer not null default 120 check (pin_delay_seconds between 0 and 3600),
  third_party_rule text not null default 'consent_on_camera_or_keep_off'
    check (third_party_rule in ('consent_on_camera_or_keep_off','no_third_parties')),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (resume_window_minutes * 60 >= max_single_gap_seconds)
);
comment on table public.action_mission_live_policies is
  'Owner decision 2026-10-15: live REQUIRED on every mission. live_mode stays data so a later owner decision is one UPDATE.';

alter table public.action_mission_live_policies enable row level security;
revoke all on public.action_mission_live_policies from public, anon, authenticated;
grant select on public.action_mission_live_policies to anon, authenticated;
grant insert, update on public.action_mission_live_policies to authenticated; -- admin-only by policy
grant all on public.action_mission_live_policies to service_role;
drop policy if exists "public reads live policies of public missions" on public.action_mission_live_policies;
create policy "public reads live policies of public missions" on public.action_mission_live_policies
  for select to anon, authenticated
  using (exists (select 1 from public.action_missions m where m.id = mission_id and m.status in ('open','paused','closed'))
         or (select public.eu_is_admin()));
drop policy if exists "admins set live policies" on public.action_mission_live_policies;
create policy "admins set live policies" on public.action_mission_live_policies
  for all to authenticated using ((select public.eu_is_admin())) with check ((select public.eu_is_admin()));

-- every existing mission, and every new one, gets the owner's default
insert into public.action_mission_live_policies(mission_id)
select id from public.action_missions
on conflict (mission_id) do nothing;

create or replace function public.action_live_default_policy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.action_mission_live_policies(mission_id) values (new.id) on conflict (mission_id) do nothing;
  return new;
end $$;
revoke all on function public.action_live_default_policy() from public, anon, authenticated;
drop trigger if exists action_live_default_policy on public.action_missions;
create trigger action_live_default_policy after insert on public.action_missions
  for each row execute function public.action_live_default_policy();

-- ---------------------------------------------------------------- controls
create table if not exists public.action_live_controls (
  id boolean primary key default true check (id),
  accepting_sessions boolean not null default true,
  enforce_live_required boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.action_live_controls(id) values (true) on conflict (id) do nothing;
alter table public.action_live_controls enable row level security;
revoke all on public.action_live_controls from public, anon, authenticated;
grant select on public.action_live_controls to anon, authenticated;
grant update on public.action_live_controls to authenticated; -- admin-only by policy
grant all on public.action_live_controls to service_role;
drop policy if exists "anyone reads live controls" on public.action_live_controls;
create policy "anyone reads live controls" on public.action_live_controls for select to anon, authenticated using (true);
drop policy if exists "admins change live controls" on public.action_live_controls;
create policy "admins change live controls" on public.action_live_controls for update to authenticated
  using ((select public.eu_is_admin())) with check ((select public.eu_is_admin()));

-- ---------------------------------------------------------------- coverage bounties
create table if not exists public.action_bounty_live_coverage (
  bounty_id uuid primary key references public.action_bounties(id) on delete cascade,
  event_title text not null check (char_length(event_title) between 1 and 160),
  event_kind text not null default 'public_event'
    check (event_kind in ('public_meeting','speech','rally','community_event','public_event')),
  city_label text not null check (char_length(city_label) between 1 and 120),
  country_code text not null default 'US' check (country_code ~ '^[A-Z]{2}$'),
  cell_lat numeric(5,1) not null check (cell_lat between -90 and 90),
  cell_lng numeric(5,1) not null check (cell_lng between -180 and 180),
  window_starts_at timestamptz not null,
  window_ends_at timestamptz not null,
  start_grace_seconds integer not null default 120 check (start_grace_seconds between 0 and 1800),
  end_grace_seconds integer not null default 0 check (end_grace_seconds between 0 and 1800),
  max_single_gap_seconds integer not null default 30 check (max_single_gap_seconds between 0 and 600),
  max_total_gap_seconds integer not null default 60 check (max_total_gap_seconds between 0 and 1800),
  political boolean not null default false,
  candidate_related boolean not null default false,
  funding_account text not null default 'company_program'
    check (funding_account in ('company_program','separate_political_program')),
  counsel_cleared_at timestamptz,
  counsel_note text not null default '' check (char_length(counsel_note) <= 800),
  created_at timestamptz not null default now(),
  check (window_ends_at > window_starts_at),
  check (window_ends_at - window_starts_at <= interval '12 hours'),
  check (not candidate_related or political),
  check (not political or funding_account = 'separate_political_program')
);
comment on table public.action_bounty_live_coverage is
  'Pay for coverage completeness, never views. Political bounties: separate program funds. Candidate-related: counsel first.';
alter table public.action_bounty_live_coverage enable row level security;
revoke all on public.action_bounty_live_coverage from public, anon, authenticated;
grant select on public.action_bounty_live_coverage to anon, authenticated;
grant insert, update, delete on public.action_bounty_live_coverage to authenticated; -- admin-only by policy
grant all on public.action_bounty_live_coverage to service_role;
drop policy if exists "public reads coverage of published bounties" on public.action_bounty_live_coverage;
create policy "public reads coverage of published bounties" on public.action_bounty_live_coverage
  for select to anon, authenticated
  using (exists (select 1 from public.action_bounties b where b.id = bounty_id and b.status in ('open','paused','closed'))
         or (select public.eu_is_admin()));
drop policy if exists "admins manage coverage" on public.action_bounty_live_coverage;
create policy "admins manage coverage" on public.action_bounty_live_coverage
  for all to authenticated using ((select public.eu_is_admin())) with check ((select public.eu_is_admin()));

-- a candidate-related coverage bounty never opens before counsel clears it
create or replace function public.action_live_bounty_open_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v public.action_bounty_live_coverage%rowtype;
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    select * into v from public.action_bounty_live_coverage where bounty_id = new.id;
    if found and v.candidate_related and v.counsel_cleared_at is null then
      raise exception 'a candidate-related coverage bounty needs counsel clearance before it opens';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.action_live_bounty_open_guard() from public, anon, authenticated;
drop trigger if exists action_live_bounty_open_guard on public.action_bounties;
create trigger action_live_bounty_open_guard before insert or update of status on public.action_bounties
  for each row execute function public.action_live_bounty_open_guard();

-- ---------------------------------------------------------------- sessions
create table if not exists public.action_live_sessions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.action_mission_assignments(id) on delete cascade,
  mission_id uuid not null references public.action_missions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  m_uid uuid,
  bounty_id uuid references public.action_bounties(id) on delete set null,
  status text not null default 'starting'
    check (status in ('starting','live','interrupted','completed','broken','abandoned','killed')),
  -- private to the Worker (column grants below): the Stream input and its playback address
  cf_input_uid text unique,
  whep_url text,
  evidence text not null default 'heartbeat' check (evidence in ('heartbeat','webhook')),
  -- coarse place: a city label and a 0.1-degree cell centre, never a raw coordinate
  city_label text check (char_length(city_label) <= 120),
  region_label text check (char_length(region_label) <= 120),
  country_code text check (country_code ~ '^[A-Z]{2}$'),
  cell_lat numeric(5,1) check (cell_lat between -90 and 90),
  cell_lng numeric(5,1) check (cell_lng between -180 and 180),
  globe_visibility text not null default 'city_pin' check (globe_visibility in ('city_pin','hidden')),
  pin_delay_seconds integer not null default 120 check (pin_delay_seconds between 0 and 3600),
  -- submission consent and the doer's attestations (all required)
  consent_version text not null check (char_length(consent_version) between 1 and 40),
  attest_adult boolean not null check (attest_adult),
  attest_minors_rule boolean not null check (attest_minors_rule),
  attest_recording_rules boolean not null check (attest_recording_rules),
  third_party_mode text not null default 'none_present'
    check (third_party_mode in ('none_present','consented_on_camera','kept_off_camera','audio_only')),
  third_party_marks jsonb not null default '[]'::jsonb check (jsonb_typeof(third_party_marks) = 'array'),
  started_at timestamptz not null default now(),
  first_connected_at timestamptz,
  last_seen_at timestamptz,
  completed_at timestamptz,
  ended_at timestamptz,
  end_reason text check (char_length(end_reason) <= 200),
  continuity jsonb not null default '{}'::jsonb,
  recording_state text not null default 'capturing'
    check (recording_state in ('capturing','pending_assembly','assembling','ready','failed','discarded')),
  recording_video_uid text,
  recording_bytes bigint not null default 0,
  recording_chunks integer not null default 0,
  proof_id uuid references public.action_proofs(id) on delete set null,
  killed_by uuid,
  killed_at timestamptz,
  kill_reason text check (char_length(kill_reason) <= 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists action_live_sessions_one_active
  on public.action_live_sessions(user_id) where status in ('starting','live','interrupted');
create index if not exists action_live_sessions_live_idx on public.action_live_sessions(status, first_connected_at);
create index if not exists action_live_sessions_assignment_idx on public.action_live_sessions(assignment_id, created_at desc);
create index if not exists action_live_sessions_bounty_idx on public.action_live_sessions(bounty_id) where bounty_id is not null;
alter table public.action_live_sessions enable row level security;
revoke all on public.action_live_sessions from public, anon, authenticated;
grant all on public.action_live_sessions to service_role;
-- members read their own sessions WITHOUT the Stream columns
grant select (id, assignment_id, mission_id, user_id, bounty_id, status, evidence, city_label, region_label,
  country_code, cell_lat, cell_lng, globe_visibility, pin_delay_seconds, consent_version, third_party_mode,
  third_party_marks, started_at, first_connected_at, last_seen_at, completed_at, ended_at, end_reason,
  continuity, recording_state, recording_bytes, recording_chunks, proof_id, killed_at, kill_reason,
  created_at, updated_at) on public.action_live_sessions to authenticated;
drop policy if exists "members read own live sessions" on public.action_live_sessions;
create policy "members read own live sessions" on public.action_live_sessions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.eu_is_admin()));

create table if not exists public.action_live_segments (
  id bigserial primary key,
  session_id uuid not null references public.action_live_sessions(id) on delete cascade,
  connected_at timestamptz not null,
  disconnected_at timestamptz,
  source text not null check (source in ('webhook','heartbeat','completion','sweep')),
  check (disconnected_at is null or disconnected_at >= connected_at)
);
create unique index if not exists action_live_segments_one_open on public.action_live_segments(session_id) where disconnected_at is null;
create index if not exists action_live_segments_session_idx on public.action_live_segments(session_id, connected_at);
alter table public.action_live_segments enable row level security;
revoke all on public.action_live_segments from public, anon, authenticated;
grant all on public.action_live_segments to service_role;
grant select on public.action_live_segments to authenticated;
drop policy if exists "members read own segments" on public.action_live_segments;
create policy "members read own segments" on public.action_live_segments for select to authenticated
  using (exists (select 1 from public.action_live_sessions s where s.id = session_id
                 and (s.user_id = (select auth.uid()) or (select public.eu_is_admin()))));

create table if not exists public.action_live_webhook_events (
  event_key text primary key check (char_length(event_key) between 8 and 300),
  session_id uuid references public.action_live_sessions(id) on delete cascade,
  event_type text not null check (char_length(event_type) <= 60),
  event_at timestamptz not null,
  received_at timestamptz not null default now()
);
alter table public.action_live_webhook_events enable row level security;
revoke all on public.action_live_webhook_events from public, anon, authenticated;
grant all on public.action_live_webhook_events to service_role;

create table if not exists public.action_live_recording_chunks (
  session_id uuid not null references public.action_live_sessions(id) on delete cascade,
  seq integer not null check (seq between 0 and 100000),
  object_path text not null check (char_length(object_path) <= 300),
  bytes integer not null check (bytes between 1 and 26214400),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  primary key (session_id, seq)
);
alter table public.action_live_recording_chunks enable row level security;
revoke all on public.action_live_recording_chunks from public, anon, authenticated;
grant all on public.action_live_recording_chunks to service_role;
grant select on public.action_live_recording_chunks to authenticated;
drop policy if exists "desk reads recording chunks" on public.action_live_recording_chunks;
create policy "desk reads recording chunks" on public.action_live_recording_chunks for select to authenticated
  using ((select public.eu_is_admin()));

create table if not exists public.action_live_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.action_live_sessions(id) on delete cascade,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('minor_on_camera','no_consent','private_place','harassment',
    'doxxing','violence','sexual_content','dangerous','misleading','other')),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at timestamptz not null default now(),
  unique (session_id, reporter_user_id)
);
alter table public.action_live_reports enable row level security;
revoke all on public.action_live_reports from public, anon, authenticated;
grant all on public.action_live_reports to service_role;
grant select on public.action_live_reports to authenticated;
drop policy if exists "reporters and desk read reports" on public.action_live_reports;
create policy "reporters and desk read reports" on public.action_live_reports for select to authenticated
  using (reporter_user_id = (select auth.uid()) or (select public.eu_is_admin()));

-- The 12 publishing opt-ins (docs/control-plane/LIVE-MISSIONS.md section 9;
-- research §5.1). Every one defaults to the most private choice. Submission
-- consent (review by the desk) is the session's own attestations, not this.
create table if not exists public.action_live_publishing_consents (
  session_id uuid primary key references public.action_live_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_version text not null check (char_length(consent_version) between 1 and 40),
  consent_text_sha256 text not null check (consent_text_sha256 ~ '^[0-9a-f]{64}$'),
  edit_clip boolean not null default false,          -- 1 use in an edited clip
  repost_own_channels boolean not null default false, -- 2 McCluster Corp's own channels
  clipper_share boolean not null default false,       -- 3 paid clippers on their channels
  paid_ads boolean not null default false,            -- 4 paid ads
  face text not null default 'blur' check (face in ('show','blur')),                                  -- 5
  voice text not null default 'captions_only' check (voice in ('use','altered','captions_only')),     -- 6
  name_display text not null default 'none' check (name_display in ('full','first','handle','none')), -- 7
  tag_handles boolean not null default false,         -- 8
  location_display text not null default 'none' check (location_display in ('none','state','city')), -- 9 (never exact)
  term text not null default '90d' check (term in ('90d','1y','until_revoked')),                     -- 10
  revoked_at timestamptz,                              -- 11 revocation
  attribution boolean not null default false,          -- 12 credit me
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.action_live_publishing_consents enable row level security;
revoke all on public.action_live_publishing_consents from public, anon, authenticated;
grant all on public.action_live_publishing_consents to service_role;
grant select on public.action_live_publishing_consents to authenticated;
drop policy if exists "owner and desk read publishing consents" on public.action_live_publishing_consents;
create policy "owner and desk read publishing consents" on public.action_live_publishing_consents for select to authenticated
  using (user_id = (select auth.uid()) or (select public.eu_is_admin()));

-- ---------------------------------------------------------------- continuity
-- One rule set, mirrored in workers/mccluster/src/live/continuity.js:
--   1. any gap longer than the resume window             -> broken
--   2. gaps longer than max_single_gap ("resumes") > max_resumes -> broken
--   3. short gaps: total > max_total_gap, or count of all gaps > max_reconnects -> broken
--   4. otherwise 'resumed' if any long gap, else 'continuous'
--   while not finished: no open segment and silence longer than the resume window -> broken
create or replace function public.action_live_eval(p_session uuid, p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.action_live_sessions%rowtype;
  p public.action_mission_live_policies%rowtype;
  v_first timestamptz; v_last timestamptz; v_open boolean;
  v_connected numeric := 0; v_short_total numeric := 0; v_short int := 0; v_long int := 0;
  v_gaps int := 0; v_max_gap numeric := 0; v_state text; v_reason text := null;
  r record; v_prev timestamptz := null; v_gap numeric;
begin
  select * into s from public.action_live_sessions where id = p_session;
  if not found then return null; end if;
  select * into p from public.action_mission_live_policies where mission_id = s.mission_id;
  if not found then
    p.min_duration_seconds := 300; p.max_single_gap_seconds := 60; p.max_total_gap_seconds := 180;
    p.max_reconnects := 5; p.max_resumes := 1; p.resume_window_minutes := 10;
  end if;
  for r in select connected_at, disconnected_at from public.action_live_segments
           where session_id = p_session order by connected_at, id loop
    if v_first is null then v_first := r.connected_at; end if;
    if v_prev is not null then
      v_gap := greatest(0, extract(epoch from r.connected_at - v_prev));
      v_gaps := v_gaps + 1;
      v_max_gap := greatest(v_max_gap, v_gap);
      if v_gap > p.max_single_gap_seconds then v_long := v_long + 1;
      else v_short := v_short + 1; v_short_total := v_short_total + v_gap; end if;
    end if;
    v_open := r.disconnected_at is null;
    v_prev := greatest(coalesce(v_prev, r.connected_at), coalesce(r.disconnected_at, p_now));
    v_connected := v_connected + greatest(0, extract(epoch from coalesce(r.disconnected_at, p_now) - r.connected_at));
  end loop;
  v_last := v_prev;
  if v_first is null then
    v_state := 'not_started';
  elsif v_max_gap > p.resume_window_minutes * 60 then
    v_state := 'broken'; v_reason := 'gap_longer_than_resume_window';
  elsif v_long > p.max_resumes then
    v_state := 'broken'; v_reason := 'too_many_resumes';
  elsif v_short_total > p.max_total_gap_seconds then
    v_state := 'broken'; v_reason := 'total_gap_over_tolerance';
  elsif v_gaps > p.max_reconnects then
    v_state := 'broken'; v_reason := 'too_many_reconnects';
  elsif s.status not in ('completed') and not coalesce(v_open, false)
        and extract(epoch from p_now - v_last) > p.resume_window_minutes * 60 then
    v_state := 'broken'; v_reason := 'not_resumed_in_time';
  elsif v_long > 0 then
    v_state := 'resumed';
  else
    v_state := 'continuous';
  end if;
  return jsonb_build_object(
    'state', v_state, 'reason', v_reason,
    'first_connected_at', v_first, 'last_seen_at', v_last, 'open', coalesce(v_open, false),
    'duration_seconds', case when v_first is null then 0 else round(extract(epoch from v_last - v_first)) end,
    'connected_seconds', round(v_connected), 'gaps', v_gaps, 'resumes', v_long,
    'short_gap_seconds', round(v_short_total), 'longest_gap_seconds', round(v_max_gap),
    'min_duration_seconds', p.min_duration_seconds, 'evidence', s.evidence);
end $$;
revoke all on function public.action_live_eval(uuid, timestamptz) from public, anon;
grant execute on function public.action_live_eval(uuid, timestamptz) to authenticated, service_role;

-- Strict coverage of a window (bounties): the session must be connected from
-- no later than start+grace to no earlier than end-grace, with every gap
-- inside the window within the bounty's tolerance. Resumes do not count.
create or replace function public.action_live_window_covered(
  p_session uuid, p_from timestamptz, p_to timestamptz,
  p_start_grace integer, p_end_grace integer, p_max_gap integer, p_max_total integer)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare r record; v_prev timestamptz := null; v_first timestamptz := null; v_total numeric := 0; v_gap numeric;
begin
  for r in select greatest(connected_at, p_from) c, least(coalesce(disconnected_at, connected_at), p_to) d
           from public.action_live_segments
           where session_id = p_session and disconnected_at is not null
             and disconnected_at > p_from and connected_at < p_to
           order by connected_at, id loop
    if v_first is null then v_first := r.c; end if;
    if v_prev is not null and r.c > v_prev then
      v_gap := extract(epoch from r.c - v_prev);
      if v_gap > p_max_gap then return false; end if;
      v_total := v_total + v_gap;
    end if;
    v_prev := greatest(coalesce(v_prev, r.d), r.d);
  end loop;
  if v_first is null then return false; end if;
  if v_first > p_from + make_interval(secs => p_start_grace) then return false; end if;
  if v_prev < p_to - make_interval(secs => p_end_grace) then return false; end if;
  return v_total <= p_max_total;
end $$;
revoke all on function public.action_live_window_covered(uuid, timestamptz, timestamptz, integer, integer, integer, integer) from public, anon;
grant execute on function public.action_live_window_covered(uuid, timestamptz, timestamptz, integer, integer, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------- lifecycle
-- The member opens a session for their own assignment. The Worker then makes
-- the Stream input and attaches it with action_live_attach (service role).
create or replace function public.action_live_open(
  p_assignment uuid, p_consent_version text, p_attest jsonb,
  p_third_party_mode text default 'none_present', p_globe_visibility text default 'city_pin',
  p_bounty uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  a public.action_mission_assignments%rowtype;
  m public.action_missions%rowtype;
  p public.action_mission_live_policies%rowtype;
  c public.action_live_controls%rowtype;
  cov public.action_bounty_live_coverage%rowtype;
  v_id uuid;
begin
  if v_user is null then raise exception 'sign in to go live'; end if;
  select * into c from public.action_live_controls where id;
  if not coalesce(c.accepting_sessions, false) then raise exception 'live missions are paused'; end if;
  select * into a from public.action_mission_assignments where id = p_assignment for update;
  if not found or a.user_id <> v_user then raise exception 'assignment not found'; end if;
  if a.status not in ('joined','in_progress','rejected') then raise exception 'this mission is not taking a live run'; end if;
  select * into m from public.action_missions where id = a.mission_id;
  if m.status <> 'open' then raise exception 'this mission is not open'; end if;
  select * into p from public.action_mission_live_policies where mission_id = m.id;
  if found and p.live_mode = 'not_allowed' then raise exception 'this mission is not done live'; end if;
  if p_third_party_mode not in ('none_present','consented_on_camera','kept_off_camera','audio_only') then
    raise exception 'unknown third-party mode';
  end if;
  if found and p.third_party_rule = 'no_third_parties' and p_third_party_mode <> 'none_present' then
    raise exception 'this mission is done without other people on the stream';
  end if;
  if p_globe_visibility not in ('city_pin','hidden') then raise exception 'unknown globe visibility'; end if;
  if p_attest is null or jsonb_typeof(p_attest) <> 'object'
     or coalesce((p_attest->>'adult')::boolean, false) is not true
     or coalesce((p_attest->>'minors_rule')::boolean, false) is not true
     or coalesce((p_attest->>'recording_rules')::boolean, false) is not true then
    raise exception 'confirm the three live rules before going live';
  end if;
  if p_bounty is not null then
    if not exists (select 1 from public.action_bounty_claims cl where cl.bounty_id = p_bounty
                   and cl.assignment_id = a.id and cl.status in ('reserved','submitted')) then
      raise exception 'claim this bounty before going live for it';
    end if;
    select * into cov from public.action_bounty_live_coverage where bounty_id = p_bounty;
    if not found then raise exception 'this bounty is not a live coverage bounty'; end if;
    if now() > cov.window_ends_at or now() < cov.window_starts_at - interval '30 minutes' then
      raise exception 'this event window is not open for going live';
    end if;
  end if;
  insert into public.action_live_sessions(assignment_id, mission_id, user_id, m_uid, bounty_id, consent_version,
    attest_adult, attest_minors_rule, attest_recording_rules, third_party_mode, globe_visibility, pin_delay_seconds)
  values (a.id, m.id, v_user, coalesce(a.m_uid, public.current_m_uid()), p_bounty, left(p_consent_version, 40),
    true, true, true, p_third_party_mode, p_globe_visibility, coalesce(p.pin_delay_seconds, 120))
  returning id into v_id;
  update public.action_mission_assignments set status = 'in_progress' where id = a.id and status in ('joined','rejected');
  return jsonb_build_object('session_id', v_id, 'mission_id', m.id, 'live_mode', coalesce(p.live_mode, 'required'),
    'policy', to_jsonb(p) - 'updated_by');
exception when unique_violation then
  raise exception 'you already have a live mission running; finish or end it first';
end $$;
revoke all on function public.action_live_open(uuid, text, jsonb, text, text, uuid) from public, anon;
grant execute on function public.action_live_open(uuid, text, jsonb, text, text, uuid) to authenticated;

-- Worker only: the Stream input and the coarse place (from the request's
-- Cloudflare city, snapped to a 0.1-degree cell; never browser GPS).
create or replace function public.action_live_attach(
  p_session uuid, p_input_uid text, p_whep_url text,
  p_city text, p_region text, p_country text, p_lat numeric, p_lng numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.action_live_sessions
     set cf_input_uid = p_input_uid, whep_url = p_whep_url,
         city_label = nullif(left(coalesce(p_city, ''), 120), ''), region_label = nullif(left(coalesce(p_region, ''), 120), ''),
         country_code = case when p_country ~ '^[A-Z]{2}$' then p_country else null end,
         cell_lat = case when p_lat is null then null else round(p_lat, 1) end,
         cell_lng = case when p_lng is null then null else round(p_lng, 1) end,
         updated_at = now()
   where id = p_session and status = 'starting' and cf_input_uid is null;
  if not found then raise exception 'session is not waiting for an input'; end if;
end $$;
revoke all on function public.action_live_attach(uuid, text, text, text, text, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.action_live_attach(uuid, text, text, text, text, text, numeric, numeric) to service_role;

-- Worker only: one observation (connected / disconnected / heartbeat). An
-- event key makes each webhook delivery count once (replay ledger).
create or replace function public.action_live_observe(
  p_session uuid, p_kind text, p_at timestamptz, p_source text, p_event_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.action_live_sessions%rowtype; v_open public.action_live_segments%rowtype; v_new boolean;
begin
  if p_kind not in ('connected','disconnected','heartbeat') or p_source not in ('webhook','heartbeat') then
    raise exception 'unknown observation';
  end if;
  select * into s from public.action_live_sessions where id = p_session for update;
  if not found then raise exception 'session not found'; end if;
  if p_event_key is not null then
    insert into public.action_live_webhook_events(event_key, session_id, event_type, event_at)
    values (p_event_key, p_session, p_kind, p_at) on conflict (event_key) do nothing;
    get diagnostics v_new = row_count;
    if not v_new then return jsonb_build_object('duplicate', true, 'status', s.status); end if;
  end if;
  if s.status not in ('starting','live','interrupted') then
    return jsonb_build_object('ignored', true, 'status', s.status);
  end if;
  if p_source = 'webhook' and s.evidence <> 'webhook' then
    update public.action_live_sessions set evidence = 'webhook' where id = p_session;
    s.evidence := 'webhook';
  end if;
  select * into v_open from public.action_live_segments where session_id = p_session and disconnected_at is null;
  if p_kind = 'connected' or (p_kind = 'heartbeat' and s.evidence = 'heartbeat') then
    if v_open.id is null then
      insert into public.action_live_segments(session_id, connected_at, source)
      values (p_session, greatest(p_at, coalesce((select max(disconnected_at) from public.action_live_segments where session_id = p_session), p_at)), p_source);
    end if;
    update public.action_live_sessions
       set status = 'live', first_connected_at = coalesce(first_connected_at, p_at),
           last_seen_at = greatest(coalesce(last_seen_at, p_at), p_at), updated_at = now()
     where id = p_session;
  elsif p_kind = 'heartbeat' then
    update public.action_live_sessions set last_seen_at = greatest(coalesce(last_seen_at, p_at), p_at), updated_at = now()
     where id = p_session;
  else
    if v_open.id is not null then
      update public.action_live_segments set disconnected_at = greatest(p_at, connected_at) where id = v_open.id;
    end if;
    update public.action_live_sessions set status = case when status = 'starting' then status else 'interrupted' end,
           last_seen_at = greatest(coalesce(last_seen_at, p_at), p_at), updated_at = now()
     where id = p_session;
  end if;
  select * into s from public.action_live_sessions where id = p_session;
  return jsonb_build_object('status', s.status, 'continuity', public.action_live_eval(p_session, greatest(p_at, now())));
end $$;
revoke all on function public.action_live_observe(uuid, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.action_live_observe(uuid, text, timestamptz, text, text) to service_role;

-- "Mission complete", by the member. Closes the run, judges continuity, and
-- files the proof PENDING. Nothing here verifies: an admin still does.
create or replace function public.action_live_complete(p_session uuid, p_statement text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  s public.action_live_sessions%rowtype; c jsonb; v_proof uuid; v_existing public.action_proofs%rowtype;
  v_statement text := left(btrim(coalesce(p_statement, '')), 4000);
begin
  if v_user is null then raise exception 'sign in to finish'; end if;
  select * into s from public.action_live_sessions where id = p_session for update;
  if not found or s.user_id <> v_user then raise exception 'session not found'; end if;
  if s.status not in ('live','interrupted') then raise exception 'this live run is not running'; end if;
  update public.action_live_segments set disconnected_at = greatest(now(), connected_at)
   where session_id = p_session and disconnected_at is null;
  c := public.action_live_eval(p_session, now());
  if c->>'state' not in ('continuous','resumed') then
    update public.action_live_sessions set status = 'broken', ended_at = now(), end_reason = coalesce(c->>'reason', c->>'state'),
           continuity = c, updated_at = now() where id = p_session;
    return jsonb_build_object('status', 'broken', 'continuity', c);
  end if;
  if (c->>'duration_seconds')::numeric < (c->>'min_duration_seconds')::numeric then
    raise exception 'stay live a little longer: this mission needs % minutes on camera',
      ceil((c->>'min_duration_seconds')::numeric / 60);
  end if;
  perform set_config('mccluster.live_completing', s.id::text, true);
  select * into v_existing from public.action_proofs where assignment_id = s.assignment_id for update;
  if found then
    if v_existing.status not in ('pending','rejected') then raise exception 'this proof has already been reviewed'; end if;
    update public.action_proofs set proof_type = 'video', proof_url = null, statement = v_statement,
           metadata = jsonb_build_object('live_session_id', s.id, 'continuity', c->>'state'),
           status = 'pending', reviewer_uid = null, review_note = null, reviewed_at = null, created_at = now()
     where id = v_existing.id;
    v_proof := v_existing.id;
  else
    insert into public.action_proofs(assignment_id, user_id, proof_type, statement, metadata, status)
    values (s.assignment_id, v_user, 'video', v_statement,
            jsonb_build_object('live_session_id', s.id, 'continuity', c->>'state'), 'pending')
    returning id into v_proof;
  end if;
  update public.action_mission_assignments set status = 'submitted', submitted_at = now(), verified_at = null
   where id = s.assignment_id;
  update public.action_live_sessions
     set status = 'completed', completed_at = now(), ended_at = now(), end_reason = 'mission_complete',
         continuity = c, proof_id = v_proof,
         recording_state = case when recording_chunks > 0 then 'pending_assembly' else recording_state end,
         updated_at = now()
   where id = p_session;
  return jsonb_build_object('status', 'completed', 'proof_id', v_proof, 'proof_status', 'pending', 'continuity', c);
end $$;
revoke all on function public.action_live_complete(uuid, text) from public, anon;
grant execute on function public.action_live_complete(uuid, text) to authenticated;

-- The member stops without completing.
create or replace function public.action_live_abandon(p_session uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); s public.action_live_sessions%rowtype;
begin
  select * into s from public.action_live_sessions where id = p_session for update;
  if not found or s.user_id is distinct from v_user then raise exception 'session not found'; end if;
  if s.status not in ('starting','live','interrupted') then return jsonb_build_object('status', s.status); end if;
  update public.action_live_segments set disconnected_at = greatest(now(), connected_at)
   where session_id = p_session and disconnected_at is null;
  update public.action_live_sessions set status = 'abandoned', ended_at = now(), end_reason = 'ended_by_member',
         continuity = public.action_live_eval(p_session, now()), updated_at = now()
   where id = p_session;
  return jsonb_build_object('status', 'abandoned');
end $$;
revoke all on function public.action_live_abandon(uuid) from public, anon;
grant execute on function public.action_live_abandon(uuid) to authenticated;

-- The member marks how other people are handled, mid-run (e.g. the helped
-- person agrees on camera; or the doer turns the camera away).
create or replace function public.action_live_mark_third_party(p_session uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); s public.action_live_sessions%rowtype;
begin
  if p_mode not in ('none_present','consented_on_camera','kept_off_camera','audio_only') then raise exception 'unknown mode'; end if;
  select * into s from public.action_live_sessions where id = p_session for update;
  if not found or s.user_id is distinct from v_user then raise exception 'session not found'; end if;
  if s.status not in ('starting','live','interrupted') then raise exception 'this live run is not running'; end if;
  update public.action_live_sessions
     set third_party_mode = p_mode,
         third_party_marks = case when jsonb_array_length(third_party_marks) >= 50 then third_party_marks
                                  else third_party_marks || jsonb_build_array(jsonb_build_object('at', now(), 'mode', p_mode)) end,
         updated_at = now()
   where id = p_session;
  return jsonb_build_object('third_party_mode', p_mode);
end $$;
revoke all on function public.action_live_mark_third_party(uuid, text) from public, anon;
grant execute on function public.action_live_mark_third_party(uuid, text) to authenticated;

-- The owner's kill switch for one run (the Worker deletes the Stream input first).
create or replace function public.action_live_kill(p_session uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.action_live_sessions%rowtype;
begin
  if (select auth.uid()) is null or not public.eu_is_admin() then raise exception 'only the desk can stop a live run'; end if;
  select * into s from public.action_live_sessions where id = p_session for update;
  if not found then raise exception 'session not found'; end if;
  update public.action_live_segments set disconnected_at = greatest(now(), connected_at)
   where session_id = p_session and disconnected_at is null;
  update public.action_live_sessions
     set status = case when status in ('starting','live','interrupted') then 'killed' else status end,
         killed_by = (select auth.uid()), killed_at = now(), kill_reason = left(coalesce(p_reason, ''), 400),
         ended_at = coalesce(ended_at, now()), globe_visibility = 'hidden', updated_at = now()
   where id = p_session;
  update public.action_live_reports set status = 'actioned' where session_id = p_session and status = 'open';
  return jsonb_build_object('status', (select status from public.action_live_sessions where id = p_session));
end $$;
revoke all on function public.action_live_kill(uuid, text) from public, anon;
grant execute on function public.action_live_kill(uuid, text) to authenticated;

create or replace function public.action_live_report(p_session uuid, p_reason text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_id uuid;
begin
  if v_user is null then raise exception 'sign in to report'; end if;
  if not exists (select 1 from public.action_live_sessions where id = p_session) then raise exception 'session not found'; end if;
  insert into public.action_live_reports(session_id, reporter_user_id, reason, note)
  values (p_session, v_user, p_reason, left(coalesce(p_note, ''), 500))
  on conflict (session_id, reporter_user_id) do update set reason = excluded.reason, note = excluded.note, created_at = now()
  returning id into v_id;
  return jsonb_build_object('report_id', v_id);
end $$;
revoke all on function public.action_live_report(uuid, text, text) from public, anon;
grant execute on function public.action_live_report(uuid, text, text) to authenticated;

create or replace function public.action_live_set_publishing_consent(
  p_session uuid, p_version text, p_text_sha256 text, p_choices jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); k text;
begin
  if v_user is null then raise exception 'sign in first'; end if;
  if not exists (select 1 from public.action_live_sessions where id = p_session and user_id = v_user) then raise exception 'session not found'; end if;
  if p_choices is null or jsonb_typeof(p_choices) <> 'object' then raise exception 'invalid choices'; end if;
  for k in select jsonb_object_keys(p_choices) loop
    if k not in ('edit_clip','repost_own_channels','clipper_share','paid_ads','face','voice','name_display',
                 'tag_handles','location_display','term','attribution','revoke') then
      raise exception 'unknown publishing choice %', k;
    end if;
  end loop;
  insert into public.action_live_publishing_consents as x(session_id, user_id, consent_version, consent_text_sha256,
    edit_clip, repost_own_channels, clipper_share, paid_ads, face, voice, name_display, tag_handles,
    location_display, term, attribution, revoked_at)
  values (p_session, v_user, p_version, p_text_sha256,
    coalesce((p_choices->>'edit_clip')::boolean, false), coalesce((p_choices->>'repost_own_channels')::boolean, false),
    coalesce((p_choices->>'clipper_share')::boolean, false), coalesce((p_choices->>'paid_ads')::boolean, false),
    coalesce(p_choices->>'face', 'blur'), coalesce(p_choices->>'voice', 'captions_only'),
    coalesce(p_choices->>'name_display', 'none'), coalesce((p_choices->>'tag_handles')::boolean, false),
    coalesce(p_choices->>'location_display', 'none'), coalesce(p_choices->>'term', '90d'),
    coalesce((p_choices->>'attribution')::boolean, false),
    case when coalesce((p_choices->>'revoke')::boolean, false) then now() else null end)
  on conflict (session_id) do update set consent_version = excluded.consent_version,
    consent_text_sha256 = excluded.consent_text_sha256, edit_clip = excluded.edit_clip,
    repost_own_channels = excluded.repost_own_channels, clipper_share = excluded.clipper_share,
    paid_ads = excluded.paid_ads, face = excluded.face, voice = excluded.voice, name_display = excluded.name_display,
    tag_handles = excluded.tag_handles, location_display = excluded.location_display, term = excluded.term,
    attribution = excluded.attribution,
    revoked_at = case when excluded.revoked_at is not null then excluded.revoked_at else null end,
    updated_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.action_live_set_publishing_consent(uuid, text, text, jsonb) from public, anon;
grant execute on function public.action_live_set_publishing_consent(uuid, text, text, jsonb) to authenticated;

-- Worker only (cron): close heartbeat-only runs whose heartbeats stopped,
-- break runs not resumed in time, abandon inputs never connected, end
-- over-long runs. Returns the Stream inputs to delete.
create or replace function public.action_live_sweep(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v_out jsonb := '[]'::jsonb; c jsonb; p public.action_mission_live_policies%rowtype;
begin
  for r in select s.* from public.action_live_sessions s where s.status in ('starting','live','interrupted') for update skip locked loop
    select * into p from public.action_mission_live_policies where mission_id = r.mission_id;
    if r.evidence = 'heartbeat' and r.last_seen_at is not null and r.last_seen_at < p_now - interval '45 seconds' then
      update public.action_live_segments set disconnected_at = greatest(r.last_seen_at, connected_at)
       where session_id = r.id and disconnected_at is null;
      update public.action_live_sessions set status = 'interrupted', updated_at = now() where id = r.id and status = 'live';
    end if;
    if r.status = 'starting' and r.first_connected_at is null and r.started_at < p_now - interval '10 minutes' then
      update public.action_live_sessions set status = 'abandoned', ended_at = p_now, end_reason = 'never_connected', updated_at = now() where id = r.id;
      v_out := v_out || jsonb_build_array(jsonb_build_object('session_id', r.id, 'input_uid', r.cf_input_uid, 'status', 'abandoned'));
      continue;
    end if;
    if r.first_connected_at is not null and r.first_connected_at < p_now - make_interval(mins => coalesce(p.max_duration_minutes, 240)) then
      update public.action_live_segments set disconnected_at = greatest(p_now, connected_at) where session_id = r.id and disconnected_at is null;
      update public.action_live_sessions set status = 'broken', ended_at = p_now, end_reason = 'max_duration_exceeded',
             continuity = public.action_live_eval(r.id, p_now), updated_at = now() where id = r.id;
      v_out := v_out || jsonb_build_array(jsonb_build_object('session_id', r.id, 'input_uid', r.cf_input_uid, 'status', 'broken'));
      continue;
    end if;
    c := public.action_live_eval(r.id, p_now);
    if c->>'state' = 'broken' then
      update public.action_live_segments set disconnected_at = greatest(p_now, connected_at) where session_id = r.id and disconnected_at is null;
      update public.action_live_sessions set status = 'broken', ended_at = p_now, end_reason = c->>'reason', continuity = c, updated_at = now() where id = r.id;
      v_out := v_out || jsonb_build_array(jsonb_build_object('session_id', r.id, 'input_uid', r.cf_input_uid, 'status', 'broken'));
    end if;
  end loop;
  return v_out;
end $$;
revoke all on function public.action_live_sweep(timestamptz) from public, anon, authenticated;
grant execute on function public.action_live_sweep(timestamptz) to service_role;

-- Worker only: the receipt for one recording chunk (hash and size as the
-- Worker measured them on arrival), counted once per sequence number.
create or replace function public.action_live_record_chunk(
  p_session uuid, p_seq integer, p_path text, p_bytes integer, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.action_live_sessions%rowtype; v_new boolean; v_have text;
begin
  select * into s from public.action_live_sessions where id = p_session for update;
  if not found then raise exception 'session not found'; end if;
  if s.status not in ('starting','live','interrupted') or s.recording_state <> 'capturing' then
    raise exception 'this run is not recording';
  end if;
  if s.recording_chunks >= 5000 or s.recording_bytes + p_bytes > 8589934592 then raise exception 'recording is too large'; end if;
  insert into public.action_live_recording_chunks(session_id, seq, object_path, bytes, sha256)
  values (p_session, p_seq, p_path, p_bytes, p_sha256) on conflict (session_id, seq) do nothing;
  get diagnostics v_new = row_count;
  if not v_new then
    select sha256 into v_have from public.action_live_recording_chunks where session_id = p_session and seq = p_seq;
    if v_have <> p_sha256 then raise exception 'chunk % was already received with different content', p_seq; end if;
    return jsonb_build_object('seq', p_seq, 'duplicate', true);
  end if;
  update public.action_live_sessions set recording_chunks = recording_chunks + 1, recording_bytes = recording_bytes + p_bytes,
         updated_at = now() where id = p_session;
  return jsonb_build_object('seq', p_seq, 'duplicate', false);
end $$;
revoke all on function public.action_live_record_chunk(uuid, integer, text, integer, text) from public, anon, authenticated;
grant execute on function public.action_live_record_chunk(uuid, integer, text, integer, text) to service_role;

-- Worker only: the recording's assembly state. 'assembling' is taken only
-- from 'pending_assembly' (so two cron runs never assemble the same run).
create or replace function public.action_live_set_recording(p_session uuid, p_state text, p_video_uid text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  if p_state not in ('assembling','ready','failed','discarded') then raise exception 'unknown recording state'; end if;
  update public.action_live_sessions
     set recording_state = p_state, recording_video_uid = coalesce(p_video_uid, recording_video_uid), updated_at = now()
   where id = p_session
     and ((p_state = 'assembling' and recording_state = 'pending_assembly')
       or (p_state <> 'assembling' and recording_state in ('assembling','pending_assembly')));
  get diagnostics v_ok = row_count;
  return v_ok;
end $$;
revoke all on function public.action_live_set_recording(uuid, text, text) from public, anon, authenticated;
grant execute on function public.action_live_set_recording(uuid, text, text) to service_role;

-- ---------------------------------------------------------------- the globe
-- Public "Live now": city cells and counts only. No session, member or
-- input ids; no names; nothing until the pin delay has passed.
create or replace function public.action_live_now_public()
returns jsonb language sql stable security definer set search_path = '' as $$
  with live as (
    select s.city_label, s.region_label, s.country_code, s.cell_lat, s.cell_lng, m.title
    from public.action_live_sessions s
    join public.action_missions m on m.id = s.mission_id
    where s.status = 'live' and s.globe_visibility = 'city_pin'
      and s.cell_lat is not null and s.cell_lng is not null
      and s.first_connected_at <= now() - make_interval(secs => s.pin_delay_seconds)
  ), cells as (
    select city_label, region_label, country_code, cell_lat, cell_lng, count(*)::int as live_count,
           (array_agg(distinct title order by title))[1:3] as missions
    from live group by 1,2,3,4,5
  )
  select jsonb_build_object('generated_at', now(), 'precision', 'city',
    'cells', coalesce(jsonb_agg(jsonb_build_object('city', city_label, 'region', region_label, 'country', country_code,
      'lat', cell_lat, 'lng', cell_lng, 'live_count', live_count, 'missions', to_jsonb(missions))
      order by live_count desc, city_label), '[]'::jsonb),
    'total_live', coalesce(sum(live_count), 0))
  from cells;
$$;
revoke all on function public.action_live_now_public() from public;
grant execute on function public.action_live_now_public() to anon, authenticated, service_role;

-- The event database (owner: "building a database of those locations"):
-- finished live runs with their city cell, times, mission, bounty event and
-- review state. Desk only. Public projections come later and only from runs
-- whose streamer opted in (action_live_publishing_consents.location_display).
create or replace function public.action_live_event_log(p_from timestamptz, p_to timestamptz)
returns table (session_id uuid, mission_title text, event_title text, event_kind text, city text, region text,
  country text, cell_lat numeric, cell_lng numeric, started_at timestamptz, ended_at timestamptz,
  status text, continuity_state text, recording_state text, proof_status text, location_opt_in text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not public.eu_is_admin() then raise exception 'desk only'; end if;
  return query
  select s.id, m.title, cov.event_title, cov.event_kind, s.city_label, s.region_label, s.country_code, s.cell_lat, s.cell_lng,
         s.first_connected_at, s.ended_at, s.status, s.continuity->>'state', s.recording_state, p.status,
         coalesce(pc.location_display, 'none')
  from public.action_live_sessions s
  join public.action_missions m on m.id = s.mission_id
  left join public.action_bounty_live_coverage cov on cov.bounty_id = s.bounty_id
  left join public.action_proofs p on p.id = s.proof_id
  left join public.action_live_publishing_consents pc on pc.session_id = s.id and pc.revoked_at is null
  where s.status in ('completed','broken','killed') and s.first_connected_at >= p_from and s.first_connected_at < p_to
  order by s.first_connected_at;
end $$;
revoke all on function public.action_live_event_log(timestamptz, timestamptz) from public, anon;
grant execute on function public.action_live_event_log(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------- guards
-- Coverage bounties pay only behind continuous coverage of the window.
create or replace function public.action_live_claim_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cov public.action_bounty_live_coverage%rowtype; v_ok boolean;
begin
  if new.status not in ('approved','paid') or new.status is not distinct from old.status then return new; end if;
  select * into cov from public.action_bounty_live_coverage where bounty_id = new.bounty_id;
  if not found then return new; end if;
  select exists (
    select 1 from public.action_live_sessions s
    where s.assignment_id = new.assignment_id and s.bounty_id = new.bounty_id and s.status = 'completed'
      and public.action_live_window_covered(s.id, cov.window_starts_at, cov.window_ends_at,
            cov.start_grace_seconds, cov.end_grace_seconds, cov.max_single_gap_seconds, cov.max_total_gap_seconds)
  ) into v_ok;
  if v_ok then return new; end if;
  if new.status = 'paid' then
    raise exception 'a live coverage bounty is paid only behind continuous coverage of the event window';
  end if;
  new.status := 'rejected';
  new.approved_at := null;
  new.review_note := concat_ws(' ', nullif(new.review_note, ''), 'Live coverage did not span the event window (rule live_coverage_v1).');
  return new;
end $$;
revoke all on function public.action_live_claim_guard() from public, anon, authenticated;
drop trigger if exists action_live_claim_guard on public.action_bounty_claims;
create trigger action_live_claim_guard before update of status on public.action_bounty_claims
  for each row execute function public.action_live_claim_guard();

-- When the owner turns enforcement on, a mission whose live_mode is
-- 'required' takes proof only from a completed live run of that assignment
-- (or the run completing in this same transaction: action_live_complete
-- writes the proof, then marks the run completed).
create or replace function public.action_live_required_proof_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_mission uuid; v_mode text; v_enforce boolean;
begin
  if new.status <> 'pending' then return new; end if;
  select enforce_live_required into v_enforce from public.action_live_controls where id;
  if not coalesce(v_enforce, false) then return new; end if;
  select a.mission_id into v_mission from public.action_mission_assignments a where a.id = new.assignment_id;
  select live_mode into v_mode from public.action_mission_live_policies where mission_id = v_mission;
  if coalesce(v_mode, 'required') <> 'required' then return new; end if;
  if (new.metadata->>'live_session_id') is not null and exists (
       select 1 from public.action_live_sessions s
       where s.id::text = new.metadata->>'live_session_id' and s.assignment_id = new.assignment_id
         and (s.status = 'completed'
              or (s.status in ('live','interrupted') and current_setting('mccluster.live_completing', true) = s.id::text))) then
    return new;
  end if;
  raise exception 'this mission is completed live: go live and finish on camera';
end $$;
revoke all on function public.action_live_required_proof_guard() from public, anon, authenticated;
drop trigger if exists action_live_required_proof_guard on public.action_proofs;
create trigger action_live_required_proof_guard before insert or update on public.action_proofs
  for each row execute function public.action_live_required_proof_guard();

-- the private bucket for the browser's recording chunks and nothing else
do $b$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
    values ('live-mission-recordings', 'live-mission-recordings', false, 26214400, array['video/webm','video/mp4'])
    on conflict (id) do nothing;
  end if;
end $b$;
