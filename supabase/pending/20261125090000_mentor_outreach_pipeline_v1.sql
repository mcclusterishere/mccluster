-- MENTOR OUTREACH PIPELINE v1 (migration name mentor_outreach_pipeline_v1): storage for outreach-pipeline/, the daily
-- mentor outreach research run (Core job type mentor_outreach_research).
-- PENDING. Not applied to production. Owner approval required before any apply.
-- Apply only on Matthew's approval of this exact text, with the Supabase MCP apply_migration (as postgres) under the name
-- mentor_outreach_pipeline_v1. Rollback: 20261125090000_mentor_outreach_pipeline_v1.rollback.sql.
-- Proof before apply (disposable database only): outreach-pipeline/test/migration-pglite.test.mjs.
--
-- What it creates, all additive, all private (RLS on with no policy; service_role only, like ai_context):
--   outreach_runs        one row per research run: counts, rejections, notes.
--   outreach_candidates  one row per person (name_key unique): frame, published email, verification results.
--   outreach_sources     every URL behind a candidate: discovery, published email page, wealth signal, role, recent activity.
--   outreach_drafts      the review queue. Status drafted | pending_review | approved | rejected | sent | seeded.
--   outreach_sends       one row per letter actually sent, from mattmccluster@gmail.com only.
--   outreach_replies     replies matched to a send.
--   outreach_frame_stats view: sent, replied and reply rate per frame (A student, B observation plus question, C power).
-- What the database decides for itself, whatever the caller says:
--   * a draft cannot be approved without approved_by and approved_at, and no draft text may hold an em or en dash;
--   * a send needs its draft to be approved (or seeded history), one send per draft, sent from mattmccluster@gmail.com;
--   * at most 150 sends a day and 50 per frame, counted on the America/New_York calendar day (trigger, row lock per day);
--   * a sent or seeded draft's text can no longer change.
-- It changes no existing object. One transaction, safe to run twice.
begin;
set local lock_timeout = '5s';

create table if not exists public.outreach_runs (
  id uuid primary key default gen_random_uuid(),
  run_id text not null unique,
  day date not null,
  discovered integer not null default 0,
  considered integer not null default 0,
  queued jsonb not null default '{}'::jsonb,
  queued_total integer not null default 0,
  rejected jsonb not null default '{}'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  capacity_at_start jsonb,
  queries integer,
  created_at timestamptz not null default now()
);

create table if not exists public.outreach_candidates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  name text not null check (char_length(name) between 2 and 120),
  name_key text not null unique check (name_key ~ '^[a-z ]{2,120}$'),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  frame text check (frame in ('A', 'B', 'C')),
  category text,
  role text,
  organization text,
  status text not null default 'discovered' check (status in ('discovered', 'verified', 'drafted', 'rejected', 'contacted', 'hold')),
  rejection_reason text,
  wealth jsonb,
  email_source jsonb,
  role_source jsonb,
  hooks jsonb,
  run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_candidates_wealth_frame check (frame is null or frame = 'C' or status in ('rejected', 'hold') or wealth is not null),
  constraint outreach_candidates_email_source check (email is null or (email_source ? 'url' and email_source->>'url' ~ '^https?://'))
);
create unique index if not exists outreach_candidates_email_key on public.outreach_candidates (lower(email)) where email is not null;

create table if not exists public.outreach_sources (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.outreach_candidates (id) on delete cascade,
  kind text not null check (kind in ('discovery', 'email', 'wealth', 'role', 'hook')),
  url text not null check (url ~ '^https?://'),
  title text,
  excerpt text check (excerpt is null or char_length(excerpt) <= 4000),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  fetched_at timestamptz,
  verified boolean not null default false,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists outreach_sources_candidate on public.outreach_sources (candidate_id, kind);

create table if not exists public.outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.outreach_candidates (id) on delete set null,
  recipient_name text not null,
  to_email text not null check (to_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  from_email text not null default 'mattmccluster@gmail.com' check (from_email = 'mattmccluster@gmail.com'),
  frame text not null check (frame in ('A', 'B', 'C')),
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 6000),
  status text not null default 'pending_review' check (status in ('drafted', 'pending_review', 'approved', 'rejected', 'sent', 'seeded')),
  review_day date,
  run_id text,
  guard_report jsonb,
  sources jsonb,
  embedding jsonb,
  approved_by text,
  approved_at timestamptz,
  reviewed_by text,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_drafts_no_dashes check (subject !~ '[\u2010-\u2015\u2212]' and body !~ '[\u2010-\u2015\u2212]'),
  constraint outreach_drafts_approval check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);
create index if not exists outreach_drafts_status on public.outreach_drafts (status, review_day);
create index if not exists outreach_drafts_to on public.outreach_drafts (lower(to_email));

create table if not exists public.outreach_sends (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null unique references public.outreach_drafts (id) on delete restrict,
  to_email text not null,
  frame text not null check (frame in ('A', 'B', 'C')),
  from_email text not null default 'mattmccluster@gmail.com' check (from_email = 'mattmccluster@gmail.com'),
  gmail_message_id text,
  gmail_thread_id text,
  sent_at timestamptz not null default now(),
  sent_day date not null,
  confirmed_by text,
  seeded boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists outreach_sends_day on public.outreach_sends (sent_day, frame);

create table if not exists public.outreach_replies (
  id uuid primary key default gen_random_uuid(),
  send_id uuid not null references public.outreach_sends (id) on delete cascade,
  draft_id uuid references public.outreach_drafts (id) on delete set null,
  frame text not null check (frame in ('A', 'B', 'C')),
  from_email text not null,
  received_at timestamptz not null,
  gmail_message_id text unique,
  snippet text check (snippet is null or char_length(snippet) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists outreach_replies_send on public.outreach_replies (send_id);

-- Sends: the draft must be approved (or seeded history), the day is New York's, and the caps hold.
create or replace function public.outreach_sends_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare d record; n_total integer; n_frame integer;
begin
  select status, frame, to_email into d from public.outreach_drafts where id = new.draft_id for update;
  if not found then raise exception 'outreach send: draft % does not exist', new.draft_id using errcode = '23503'; end if;
  if d.status <> 'approved' and not (new.seeded and d.status = 'seeded') then
    raise exception 'outreach send: draft % is %, not approved', new.draft_id, d.status using errcode = '42501';
  end if;
  new.frame := d.frame;
  new.to_email := lower(d.to_email);
  new.sent_day := (new.sent_at at time zone 'America/New_York')::date;
  perform pg_advisory_xact_lock(hashtext('outreach_sends:' || new.sent_day::text));
  select count(*), count(*) filter (where frame = new.frame) into n_total, n_frame from public.outreach_sends where sent_day = new.sent_day;
  if n_total >= 150 then raise exception 'outreach send: daily cap of 150 reached for %', new.sent_day using errcode = '54000'; end if;
  if n_frame >= 50 then raise exception 'outreach send: frame % cap of 50 reached for %', new.frame, new.sent_day using errcode = '54000'; end if;
  return new;
end $fn$;
drop trigger if exists outreach_sends_guard on public.outreach_sends;
create trigger outreach_sends_guard before insert on public.outreach_sends for each row execute function public.outreach_sends_guard();

-- Drafts: text is frozen once sent or seeded; approval always records who and when.
create or replace function public.outreach_drafts_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $fn$
begin
  if tg_op = 'UPDATE' and old.status in ('sent', 'seeded') and (new.subject is distinct from old.subject or new.body is distinct from old.body or new.to_email is distinct from old.to_email) then
    raise exception 'outreach draft %: % letters cannot change', old.id, old.status using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.status = 'sent' and old.status <> 'approved' and old.status <> 'sent' then
    raise exception 'outreach draft %: only an approved draft can become sent', old.id using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $fn$;
drop trigger if exists outreach_drafts_guard on public.outreach_drafts;
create trigger outreach_drafts_guard before update on public.outreach_drafts for each row execute function public.outreach_drafts_guard();

create or replace view public.outreach_frame_stats with (security_invoker = true) as
select f.frame,
       count(s.id)::integer as sent,
       count(distinct r.send_id)::integer as replied,
       case when count(s.id) = 0 then null else round(count(distinct r.send_id)::numeric / count(s.id), 4) end as reply_rate
  from (values ('A'), ('B'), ('C')) as f(frame)
  left join public.outreach_sends s on s.frame = f.frame
  left join public.outreach_replies r on r.send_id = s.id
 group by f.frame;

do $grants$
declare t text;
begin
  foreach t in array array['outreach_runs', 'outreach_candidates', 'outreach_sources', 'outreach_drafts', 'outreach_sends', 'outreach_replies'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on public.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on public.%I from authenticated', t); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant select, insert, update on public.%I to service_role', t); end if;
  end loop;
  revoke all on public.outreach_frame_stats from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public.outreach_frame_stats from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on public.outreach_frame_stats from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant select on public.outreach_frame_stats to service_role; end if;
  revoke all on function public.outreach_sends_guard() from public;
  revoke all on function public.outreach_drafts_guard() from public;
end $grants$;

commit;
