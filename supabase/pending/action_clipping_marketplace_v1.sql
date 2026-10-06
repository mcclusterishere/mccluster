-- Clipping marketplace v1: paid music clipping as an Action Network job.
--
-- A clip campaign is an Action Network mission of kind 'clip'. It reuses the
-- network's primitives instead of a parallel system:
--   - action_missions / action_mission_assignments: discovery, the claim and
--     its first-touch origin (join_action_mission);
--   - action_bounty_funding_ledger: the campaign's verified funding, now able
--     to fund a clip campaign as well as a fixed bounty;
--   - music_catalog_objects / creator_tracks: the song;
--   - network_media_assets: the approved source assets;
--   - social_content_items -> social_posts -> social_metric_snapshots: the
--     campaign brief, each clip as its canonical post, and the post's
--     metric history;
--   - events / music_listens: the first-party funnel and verified listens.
-- New here: the campaign's commercial terms, claims, clip submissions, the
-- conversions, and an append-only earnings (payout) ledger.
--
-- Money is server-authoritative. Views come only from platform metric
-- snapshots written by the Worker with source = 'platform_api'; a browser,
-- a screenshot or an owner-typed number can never move money. Settlement is
-- idempotent, serialised per campaign, never accrues past verified funding
-- or the budget, and every write is in control_audit.
--
-- Civic scoring stays separate: a clip mission can never take civic proof
-- or award Action Network points (docs/ACTION-NETWORK-REWARD-SYSTEM.md: no
-- points for views).

-- ---------------------------------------------------------------------------
-- 1. Member-owned platform accounts live in one network org, not in a
--    creator's tenant: a clip belongs to the clipper who posted it.
alter table public.orgs drop constraint if exists orgs_kind_check;
alter table public.orgs add constraint orgs_kind_check
  check (kind in ('studio', 'business', 'building', 'client', 'network'));
insert into public.orgs (slug, name, kind, settings)
values ('action-network', 'Action Network members', 'network',
        '{"purpose": "Member-owned platform accounts and the clips posted from them. No members: read only through campaign-scoped functions."}'::jsonb)
on conflict (slug) do nothing;

create or replace function private.clip_network_org()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$ select id from public.orgs where slug = 'action-network' $$;
revoke all on function private.clip_network_org() from public, anon, authenticated;

alter table public.social_accounts add column if not exists owner_m_uid uuid references public.m_people(id) on delete cascade;
alter table public.social_accounts add column if not exists owner_verified_at timestamptz;
alter table public.social_accounts add column if not exists owner_verification jsonb not null default '{}'::jsonb;
-- one verified owner per platform account, across the whole network
create unique index if not exists social_accounts_member_verified_uidx
  on public.social_accounts (platform, lower(external_account_id))
  where owner_m_uid is not null and owner_verified_at is not null;
create index if not exists social_accounts_owner_idx
  on public.social_accounts (owner_m_uid, platform) where owner_m_uid is not null;

-- Where a metric came from. Only 'platform_api' rows (written by the Worker
-- from the platform's own API) can move clip money.
alter table public.social_metric_snapshots add column if not exists source text not null default 'reported';
alter table public.social_metric_snapshots drop constraint if exists social_metric_snapshots_source_check;
alter table public.social_metric_snapshots add constraint social_metric_snapshots_source_check
  check (source in ('reported', 'platform_api'));
create index if not exists social_metric_snapshots_post_source_idx
  on public.social_metric_snapshots (post_id, source, recorded_at desc);

-- ---------------------------------------------------------------------------
-- 2. Civic missions and clip missions.
alter table public.action_missions add column if not exists kind text not null default 'civic';
alter table public.action_missions drop constraint if exists action_missions_kind_check;
alter table public.action_missions add constraint action_missions_kind_check check (kind in ('civic', 'clip'));
create index if not exists action_missions_kind_status_idx on public.action_missions (kind, status);

create or replace function public.action_civic_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.action_mission_assignments a
    join public.action_missions m on m.id = a.mission_id
    where a.id = new.assignment_id and m.kind = 'clip'
  ) then
    raise exception 'clip work is paid through clip settlement, not civic proof or points';
  end if;
  return new;
end;
$$;
revoke all on function public.action_civic_only() from public, anon, authenticated;
drop trigger if exists action_proofs_civic_only on public.action_proofs;
create trigger action_proofs_civic_only before insert or update of assignment_id on public.action_proofs
  for each row execute function public.action_civic_only();
drop trigger if exists action_points_civic_only on public.action_points_ledger;
create trigger action_points_civic_only before insert on public.action_points_ledger
  for each row when (new.assignment_id is not null) execute function public.action_civic_only();

-- The Action Record is the civic record: it counts and lists civic missions
-- only. A clip claim is paid work and lives in clip_my_work().
create or replace function public.action_record()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as uid, public.current_m_uid() as m_uid)
  select case when (select uid from me) is null then null else jsonb_build_object(
    'verified_actions', (select count(*) from public.action_mission_assignments a join public.action_missions m on m.id = a.mission_id, me
                          where a.user_id = me.uid and a.status = 'verified' and m.kind = 'civic'),
    'points', (select coalesce(sum(l.points), 0) from public.action_points_ledger l, me where l.m_uid = me.m_uid),
    'in_progress', (select count(*) from public.action_mission_assignments a join public.action_missions m on m.id = a.mission_id, me
                     where a.user_id = me.uid and a.status in ('joined','in_progress','submitted') and m.kind = 'civic'),
    'missions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id', a.id, 'mission_id', m.id, 'title', m.title, 'domain', m.domain,
        'skills', m.skills, 'status', a.status, 'joined_at', a.joined_at, 'submitted_at', a.submitted_at,
        'verified_at', a.verified_at, 'points', (select l.points from public.action_points_ledger l where l.assignment_id = a.id and l.kind = 'mission'),
        'review_note', case when a.status in ('verified','rejected') then (select p.review_note from public.action_proofs p where p.assignment_id = a.id) end
      ) order by coalesce(a.verified_at, a.submitted_at, a.joined_at) desc)
      from public.action_mission_assignments a join public.action_missions m on m.id = a.mission_id, me
      where a.user_id = me.uid and a.status <> 'withdrawn' and m.kind = 'civic'), '[]'::jsonb),
    'skills', coalesce((
      select jsonb_agg(jsonb_build_object('skill', s.skill, 'xp', s.xp, 'verified_actions', s.verified_actions) order by s.xp desc)
      from public.action_skill_progress s, me where s.m_uid = me.m_uid), '[]'::jsonb),
    'cohorts', coalesce((
      select jsonb_agg(jsonb_build_object('cohort_id', c.id, 'name', c.name, 'status', c.status, 'goal_points', c.goal_points,
        'points', (select coalesce(sum(l.points), 0) from public.action_points_ledger l join public.action_cohort_members cm2 on cm2.m_uid = l.m_uid where cm2.cohort_id = c.id),
        'members', (select count(*) from public.action_cohort_members cm3 where cm3.cohort_id = c.id)))
      from public.action_cohort_members cm join public.action_cohorts c on c.id = cm.cohort_id, me
      where cm.m_uid = me.m_uid), '[]'::jsonb)
  ) end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The campaign: commercial terms on top of its mission.
create table if not exists public.action_clip_campaigns (
  mission_id                 uuid primary key references public.action_missions(id) on delete restrict,
  org_id                     uuid not null references public.orgs(id) on delete restrict,
  creator_m_uid              uuid not null references public.m_people(id) on delete restrict,
  content_id                 uuid references public.social_content_items(id) on delete set null,
  music_object_id            uuid references public.music_catalog_objects(id) on delete restrict,
  creator_track_id           uuid references public.creator_tracks(id) on delete restrict,
  platforms                  text[] not null
                             check (cardinality(platforms) between 1 and 3
                                    and platforms <@ array['instagram', 'tiktok', 'youtube']::text[]),
  rules                      text not null default '' check (char_length(rules) <= 4000),
  required_tags              text[] not null default '{}' check (cardinality(required_tags) <= 10),
  currency                   text not null default 'usd' check (currency = 'usd'),
  budget_cents               bigint not null check (budget_cents between 1000 and 100000000),
  base_cpm_cents             integer not null check (base_cpm_cents between 1 and 100000),
  min_views                  integer not null default 1000 check (min_views between 0 and 10000000),
  per_clip_cap_cents         integer check (per_clip_cap_cents is null or per_clip_cap_cents >= 100),
  per_clipper_cap_cents      integer check (per_clipper_cap_cents is null or per_clipper_cap_cents >= 100),
  max_payable_views_per_clip bigint check (max_payable_views_per_clip is null or max_payable_views_per_clip > 0),
  max_clips_per_clipper      integer not null default 10 check (max_clips_per_clipper between 1 and 100),
  earning_window_days        integer not null default 30 check (earning_window_days between 1 and 365),
  keep_live_days             integer not null default 14 check (keep_live_days between 0 and 365),
  hold_days                  integer not null default 7 check (hold_days between 0 and 90),
  bonus_account_cents        integer not null default 0 check (bonus_account_cents between 0 and 10000),
  bonus_listen_cents         integer not null default 0 check (bonus_listen_cents between 0 and 10000),
  approval_mode              text not null default 'creator' check (approval_mode in ('auto', 'creator')),
  status                     text not null default 'draft' check (status in ('draft', 'live', 'paused', 'ended')),
  status_reason              text,
  launched_at                timestamptz,
  ended_at                   timestamptz,
  budget_exhausted_at        timestamptz,
  created_by                 uuid references auth.users(id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  check (music_object_id is not null or creator_track_id is not null)
);
create index if not exists action_clip_campaigns_org_idx on public.action_clip_campaigns (org_id, status);
create index if not exists action_clip_campaigns_song_idx on public.action_clip_campaigns (music_object_id, status);

create table if not exists public.action_clip_assets (
  id                      uuid primary key default gen_random_uuid(),
  mission_id              uuid not null references public.action_clip_campaigns(mission_id) on delete cascade,
  kind                    text not null check (kind in ('audio', 'video', 'image', 'moment')),
  label                   text not null check (char_length(label) between 1 and 120),
  network_media_asset_id  uuid references public.network_media_assets(id) on delete restrict,
  start_ms                integer,
  end_ms                  integer,
  sort                    smallint not null default 0,
  created_at              timestamptz not null default now(),
  check (kind = 'moment' or network_media_asset_id is not null),
  check ((start_ms is null and end_ms is null) or (start_ms >= 0 and end_ms > start_ms))
);
create index if not exists action_clip_assets_mission_idx on public.action_clip_assets (mission_id, sort);

create table if not exists public.action_clip_claims (
  id               uuid primary key default gen_random_uuid(),
  mission_id       uuid not null references public.action_clip_campaigns(mission_id) on delete cascade,
  assignment_id    uuid not null unique references public.action_mission_assignments(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  m_uid            uuid not null references public.m_people(id) on delete cascade,
  ref_code         text not null unique check (ref_code ~ '^clip-[a-z0-9]{10}$'),
  status           text not null default 'active' check (status in ('active', 'withdrawn', 'suspended')),
  status_reason    text,
  claimed_at       timestamptz not null default now(),
  unique (mission_id, m_uid)
);
create index if not exists action_clip_claims_muid_idx on public.action_clip_claims (m_uid, claimed_at desc);

create table if not exists public.action_clip_submissions (
  id                 uuid primary key default gen_random_uuid(),
  mission_id         uuid not null references public.action_clip_campaigns(mission_id) on delete cascade,
  claim_id           uuid not null references public.action_clip_claims(id) on delete cascade,
  m_uid              uuid not null references public.m_people(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  platform           text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  external_media_id  text not null check (external_media_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  submitted_url      text not null check (submitted_url ~* '^https://' and char_length(submitted_url) <= 2000),
  ref_code           text not null unique check (ref_code ~ '^clip-[a-z0-9]{10}$'),
  moment_id          uuid references public.action_clip_assets(id) on delete set null,
  social_account_id  uuid references public.social_accounts(id) on delete set null,
  social_post_id     uuid references public.social_posts(id) on delete set null,
  status             text not null default 'submitted'
                     check (status in ('submitted', 'tracking', 'held', 'rejected', 'removed', 'closed')),
  review_state       text not null default 'pending' check (review_state in ('not_required', 'pending', 'approved', 'rejected')),
  reviewed_by        uuid references public.m_people(id) on delete set null,
  reviewed_at        timestamptz,
  review_note        text check (review_note is null or char_length(review_note) <= 1000),
  fraud_flags        text[] not null default '{}',
  hold_reason        text,
  rejection_reason   text,
  waiting_reason     text,
  posted_at          timestamptz,
  verified_at        timestamptz,
  last_metrics_at    timestamptz,
  next_metrics_at    timestamptz not null default now(),
  live_checked_at    timestamptz,
  removed_at         timestamptz,
  verified_views     bigint not null default 0,
  payable_views      bigint not null default 0,
  earned_view_cents  bigint not null default 0,
  caption_snapshot   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- a clip is one post: it cannot be submitted twice, to any campaign
  unique (platform, external_media_id)
);
create index if not exists action_clip_submissions_mission_idx on public.action_clip_submissions (mission_id, status);
create index if not exists action_clip_submissions_claim_idx on public.action_clip_submissions (claim_id);
create index if not exists action_clip_submissions_due_idx
  on public.action_clip_submissions (next_metrics_at) where status in ('submitted', 'tracking', 'held');

create table if not exists public.action_clip_payouts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete restrict,
  m_uid         uuid not null references public.m_people(id) on delete restrict,
  amount_cents  bigint not null check (amount_cents > 0),
  provider      text not null check (provider in ('stripe', 'paypal', 'square', 'manual', 'other')),
  provider_ref  text not null check (char_length(provider_ref) between 1 and 200),
  note          text check (note is null or char_length(note) <= 800),
  recorded_by   uuid references auth.users(id) on delete set null,
  recorded_at   timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index if not exists action_clip_payouts_muid_idx on public.action_clip_payouts (m_uid, recorded_at desc);

-- The payout ledger: append-only earnings. Amounts are never edited; a
-- decrease is a negative 'reversal', a disqualification voids held rows.
create table if not exists public.action_clip_earnings (
  id               uuid primary key default gen_random_uuid(),
  mission_id       uuid not null references public.action_clip_campaigns(mission_id) on delete restrict,
  org_id           uuid not null references public.orgs(id) on delete restrict,
  claim_id         uuid not null references public.action_clip_claims(id) on delete restrict,
  submission_id    uuid references public.action_clip_submissions(id) on delete restrict,
  m_uid            uuid not null references public.m_people(id) on delete restrict,
  kind             text not null check (kind in ('views', 'bonus_account', 'bonus_listen', 'reversal')),
  amount_cents     bigint not null check (amount_cents <> 0),
  state            text not null default 'held' check (state in ('held', 'payable', 'paid', 'void')),
  hold_until       timestamptz not null,
  basis            jsonb not null default '{}'::jsonb check (jsonb_typeof(basis) = 'object'),
  idempotency_key  text not null unique,
  payout_id        uuid references public.action_clip_payouts(id) on delete restrict,
  created_at       timestamptz not null default now(),
  released_at      timestamptz,
  paid_at          timestamptz,
  voided_at        timestamptz,
  void_reason      text,
  check ((kind = 'reversal') = (amount_cents < 0)),
  check ((state = 'paid') = (payout_id is not null))
);
create index if not exists action_clip_earnings_mission_idx on public.action_clip_earnings (mission_id, state);
create index if not exists action_clip_earnings_claim_idx on public.action_clip_earnings (claim_id, state);
create index if not exists action_clip_earnings_submission_idx on public.action_clip_earnings (submission_id) where submission_id is not null;
create index if not exists action_clip_earnings_payable_idx on public.action_clip_earnings (org_id, m_uid) where state = 'payable';

create table if not exists public.action_clip_conversions (
  id                   uuid primary key default gen_random_uuid(),
  mission_id           uuid not null references public.action_clip_campaigns(mission_id) on delete cascade,
  claim_id             uuid not null references public.action_clip_claims(id) on delete cascade,
  submission_id        uuid references public.action_clip_submissions(id) on delete set null,
  kind                 text not null check (kind in ('account', 'listen')),
  converted_user_id    uuid not null references auth.users(id) on delete cascade,
  occurred_at          timestamptz not null,
  qualified            boolean not null,
  disqualified_reason  text,
  earning_id           uuid references public.action_clip_earnings(id) on delete set null,
  created_at           timestamptz not null default now(),
  unique (mission_id, kind, converted_user_id)
);
-- an account is attributed to one clip, ever: its first touch
create unique index if not exists action_clip_conversions_account_once_uidx
  on public.action_clip_conversions (converted_user_id) where kind = 'account';
create index if not exists action_clip_conversions_claim_idx on public.action_clip_conversions (claim_id, kind);

-- Funding: the bounty ledger funds either a fixed bounty or a clip campaign.
alter table public.action_bounty_funding_ledger alter column bounty_id drop not null;
alter table public.action_bounty_funding_ledger
  add column if not exists clip_mission_id uuid references public.action_clip_campaigns(mission_id) on delete restrict;
alter table public.action_bounty_funding_ledger drop constraint if exists action_funding_one_target;
alter table public.action_bounty_funding_ledger add constraint action_funding_one_target
  check ((bounty_id is null) <> (clip_mission_id is null));
create index if not exists action_funding_clip_idx
  on public.action_bounty_funding_ledger (clip_mission_id, state, created_at) where clip_mission_id is not null;

-- First-party funnel lookups by clip code (?utm_source=clip&utm_campaign=clip-xxxxxxxxxx).
create index if not exists events_clip_acq_idx
  on public.events ((split_part(props->>'acq', '/', 3)), at) where (props->>'acq') like 'clip/%';
create index if not exists events_clip_signup_idx
  on public.events ((props->>'campaign'), at) where name = 'account_created' and (props->>'campaign') like 'clip-%';

-- Every new table is server-only: reads go through the functions below.
do $$
declare t text;
begin
  foreach t in array array['action_clip_campaigns', 'action_clip_assets', 'action_clip_claims', 'action_clip_submissions',
                           'action_clip_payouts', 'action_clip_earnings', 'action_clip_conversions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Helpers.
create or replace function private.clip_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'clip-' || string_agg(substr('abcdefghijkmnpqrstuvwxyz23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 10)
$$;

/* Parse a clip URL into the platform's media id. Returns null when the URL
   is not a single post on that platform. */
create or replace function private.clip_parse_url(p_platform text, p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_url, ''));
  m text[];
begin
  if v !~* '^https://' or char_length(v) > 2000 then return null; end if;
  if p_platform = 'youtube' then
    m := regexp_match(v, '^https://(?:www\.|m\.)?youtube\.com/shorts/([A-Za-z0-9_-]{11})(?:[/?#].*)?$', 'i');
    if m is null then m := regexp_match(v, '^https://(?:www\.|m\.)?youtube\.com/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})(?:[&#].*)?$', 'i'); end if;
    if m is null then m := regexp_match(v, '^https://youtu\.be/([A-Za-z0-9_-]{11})(?:[/?#].*)?$', 'i'); end if;
  elsif p_platform = 'tiktok' then
    m := regexp_match(v, '^https://(?:www\.|m\.)?tiktok\.com/@[A-Za-z0-9._]{1,64}/video/([0-9]{6,32})(?:[/?#].*)?$', 'i');
  elsif p_platform = 'instagram' then
    m := regexp_match(v, '^https://(?:www\.)?instagram\.com/(?:[A-Za-z0-9._]{1,64}/)?(?:reel|reels|p)/([A-Za-z0-9_-]{5,64})/?(?:[?#].*)?$', 'i');
  end if;
  return m[1];
end;
$$;

create or replace function private.clip_canonical_url(p_platform text, p_media text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_platform
    when 'youtube' then 'https://www.youtube.com/shorts/' || p_media
    when 'instagram' then 'https://www.instagram.com/reel/' || p_media || '/'
    else null end
$$;

/* Which platforms can be verified server-side today. Instagram can: the
   Worker reads a clip's metrics through the Graph API with the account's own
   stored credential (the same path Instagram insights already use). YouTube
   and TikTok cannot until real provider integrations exist, so they are
   refused rather than accepted on trust. */
create or replace function private.clip_platform_enabled(p_platform text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_platform = 'instagram' $$;

create or replace function private.clip_audit(p_org uuid, p_event text, p_type text, p_id text, p_detail jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.control_audit (org_id, actor_user_id, actor_kind, event, resource_type, resource_id, detail)
  values (p_org, (select auth.uid()), case when (select auth.uid()) is null then 'system' else 'user' end,
          p_event, p_type, p_id, coalesce(p_detail, '{}'::jsonb))
$$;

/* The campaign's money position. funded = verified funding; committed =
   every non-void earning, whatever its state. Nothing may accrue past
   least(budget, funded). */
create or replace function private.clip_money(p_mission uuid)
returns table (budget_cents bigint, funded_cents bigint, committed_cents bigint, paid_cents bigint,
               payable_cents bigint, held_cents bigint, available_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select budget_cents from public.action_clip_campaigns where mission_id = p_mission),
  f as (select greatest(0, coalesce(sum(delta_cents), 0))::bigint funded
          from public.action_bounty_funding_ledger where clip_mission_id = p_mission and state = 'verified'),
  e as (select coalesce(sum(amount_cents) filter (where state <> 'void'), 0)::bigint committed,
               coalesce(sum(amount_cents) filter (where state = 'paid'), 0)::bigint paid,
               coalesce(sum(amount_cents) filter (where state = 'payable'), 0)::bigint payable,
               coalesce(sum(amount_cents) filter (where state = 'held'), 0)::bigint held
          from public.action_clip_earnings where mission_id = p_mission)
  select c.budget_cents, f.funded, e.committed, e.paid, e.payable, e.held,
         greatest(0, least(c.budget_cents, f.funded) - e.committed)
  from c, f, e
$$;

create or replace function private.clip_require_owner(p_mission uuid)
returns public.action_clip_campaigns
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.action_clip_campaigns%rowtype;
begin
  select * into v from public.action_clip_campaigns where mission_id = p_mission;
  if not found then raise exception 'campaign not found'; end if;
  if (select auth.uid()) is null or not private.is_org_owner(v.org_id) then raise exception 'not authorized'; end if;
  return v;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['private.clip_code()', 'private.clip_parse_url(text, text)', 'private.clip_platform_enabled(text)', 'private.clip_canonical_url(text, text)',
                           'private.clip_audit(uuid, text, text, text, jsonb)', 'private.clip_money(uuid)',
                           'private.clip_require_owner(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Creator side. The caller must own the campaign's org (the desk may act
--    for any org). Matthew's org is tenant zero; any org can run campaigns
--    on its own creator tracks.

/* p: org_id, title, description, music_object_id | creator_track_id,
   platforms[], rules, required_tags[], budget_cents, base_cpm_cents,
   min_views, per_clip_cap_cents, per_clipper_cap_cents,
   max_payable_views_per_clip, max_clips_per_clipper, starts_at, ends_at,
   earning_window_days, keep_live_days, hold_days, bonus_account_cents,
   bonus_listen_cents, approval_mode, assets[{kind,label,asset_id,start_ms,end_ms}] */
create or replace function public.clip_campaign_create(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_muid     uuid := public.current_m_uid();
  v_org      uuid := nullif(p->>'org_id', '')::uuid;
  v_title    text := btrim(coalesce(p->>'title', ''));
  v_music    uuid := nullif(p->>'music_object_id', '')::uuid;
  v_track    uuid := nullif(p->>'creator_track_id', '')::uuid;
  v_starts   timestamptz := coalesce(nullif(p->>'starts_at', '')::timestamptz, now());
  v_ends     timestamptz := nullif(p->>'ends_at', '')::timestamptz;
  v_mission  uuid;
  v_content  uuid;
  v_song     record;
  v_asset    jsonb;
  v_owner    uuid;
  v_type     text;
  v_sort     int := 0;
begin
  if v_user is null or v_muid is null then raise exception 'sign in with your M account to create a campaign'; end if;
  if v_org is null or not private.is_org_owner(v_org) then raise exception 'not authorized for this organization'; end if;
  if char_length(v_title) not between 1 and 160 then raise exception 'a campaign needs a title of 1 to 160 characters'; end if;
  if v_ends is not null and v_ends <= v_starts then raise exception 'the campaign must end after it starts'; end if;
  if exists (select 1 from jsonb_array_elements_text(coalesce(p->'platforms', '[]'::jsonb)) x where not private.clip_platform_enabled(lower(x))) then
    raise exception 'only Instagram clips can be verified today; YouTube and TikTok are not connected yet';
  end if;

  -- the song must be this creator's: their own creator track, or the house catalogue for the house org
  if v_track is not null then
    if not exists (select 1 from public.creator_tracks t where t.id = v_track and t.m_uid = v_muid) then
      raise exception 'that track is not yours';
    end if;
  elsif v_music is not null then
    select o.id, o.status, o.creator_track_id into v_song from public.music_catalog_objects o where o.id = v_music;
    if v_song.id is null or v_song.status <> 'active' then raise exception 'that song is not in the active catalogue'; end if;
    if v_song.creator_track_id is not null then
      if not exists (select 1 from public.creator_tracks t where t.id = v_song.creator_track_id and t.m_uid = v_muid) then
        raise exception 'that song belongs to another creator';
      end if;
    elsif v_org <> public.commerce_resolve_org(null) then
      raise exception 'the house catalogue can only be clipped by the house organization';
    end if;
  else
    raise exception 'pick the song to clip';
  end if;

  insert into public.action_missions (title, description, domain, difficulty, base_points, proof_required,
                                      verification_mode, skills, status, starts_at, ends_at, kind)
  values (v_title, left(coalesce(p->>'description', ''), 4000), 'music', 1, 10, false,
          'automatic', array['media'], 'draft', v_starts, v_ends, 'clip')
  returning id into v_mission;

  insert into public.social_content_items (org_id, created_by, publisher_m_uid, title, master_caption,
                                           action_mission_id, status, metadata)
  values (v_org, v_user, v_muid, v_title, left(coalesce(p->>'rules', ''), 4000), v_mission, 'ready',
          jsonb_build_object('kind', 'clip_campaign'))
  returning id into v_content;

  insert into public.action_clip_campaigns (
    mission_id, org_id, creator_m_uid, content_id, music_object_id, creator_track_id, platforms, rules, required_tags,
    budget_cents, base_cpm_cents, min_views, per_clip_cap_cents, per_clipper_cap_cents, max_payable_views_per_clip,
    max_clips_per_clipper, earning_window_days, keep_live_days, hold_days, bonus_account_cents, bonus_listen_cents,
    approval_mode, created_by)
  values (
    v_mission, v_org, v_muid, v_content, v_music, v_track,
    coalesce(array(select lower(x) from jsonb_array_elements_text(coalesce(p->'platforms', '[]'::jsonb)) x), '{}'),
    left(coalesce(p->>'rules', ''), 4000),
    coalesce(array(select left(lower(btrim(x)), 64) from jsonb_array_elements_text(coalesce(p->'required_tags', '[]'::jsonb)) x
                    where btrim(x) <> ''), '{}'),
    (p->>'budget_cents')::bigint, (p->>'base_cpm_cents')::integer,
    coalesce((p->>'min_views')::integer, 1000),
    nullif(p->>'per_clip_cap_cents', '')::integer, nullif(p->>'per_clipper_cap_cents', '')::integer,
    nullif(p->>'max_payable_views_per_clip', '')::bigint,
    coalesce((p->>'max_clips_per_clipper')::integer, 10), coalesce((p->>'earning_window_days')::integer, 30),
    coalesce((p->>'keep_live_days')::integer, 14), coalesce((p->>'hold_days')::integer, 7),
    coalesce((p->>'bonus_account_cents')::integer, 0), coalesce((p->>'bonus_listen_cents')::integer, 0),
    coalesce(nullif(p->>'approval_mode', ''), 'creator'), v_user);

  for v_asset in select * from jsonb_array_elements(coalesce(p->'assets', '[]'::jsonb)) loop
    v_type := coalesce(v_asset->>'kind', '');
    if v_type <> 'moment' then
      select a.owner_m_uid into v_owner from public.network_media_assets a
       where a.id = nullif(v_asset->>'asset_id', '')::uuid and a.status = 'ready';
      if v_owner is distinct from v_muid then raise exception 'source assets must be your own ready uploads'; end if;
    end if;
    insert into public.action_clip_assets (mission_id, kind, label, network_media_asset_id, start_ms, end_ms, sort)
    values (v_mission, v_type, left(btrim(coalesce(v_asset->>'label', '')), 120),
            case when v_type = 'moment' then null else nullif(v_asset->>'asset_id', '')::uuid end,
            nullif(v_asset->>'start_ms', '')::integer, nullif(v_asset->>'end_ms', '')::integer, v_sort);
    v_sort := v_sort + 1;
  end loop;

  perform private.clip_audit(v_org, 'clip.campaign.created', 'clip_campaign', v_mission::text,
                             jsonb_build_object('title', v_title, 'budget_cents', p->>'budget_cents', 'base_cpm_cents', p->>'base_cpm_cents'));
  return jsonb_build_object('mission_id', v_mission, 'content_id', v_content, 'status', 'draft');
end;
$$;

/* Before launch every term can change; after launch the economics a
   clipper relied on are fixed: the budget, caps and end date may only grow. */
create or replace function public.clip_campaign_update(p_mission uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.action_clip_campaigns%rowtype := private.clip_require_owner(p_mission);
  v_new public.action_clip_campaigns%rowtype;
begin
  select * into v from public.action_clip_campaigns where mission_id = p_mission for update;
  v_new := v;
  if p ? 'rules' then v_new.rules := left(coalesce(p->>'rules', ''), 4000); end if;
  if p ? 'budget_cents' then v_new.budget_cents := (p->>'budget_cents')::bigint; end if;
  if p ? 'per_clip_cap_cents' then v_new.per_clip_cap_cents := nullif(p->>'per_clip_cap_cents', '')::integer; end if;
  if p ? 'per_clipper_cap_cents' then v_new.per_clipper_cap_cents := nullif(p->>'per_clipper_cap_cents', '')::integer; end if;
  if v.status = 'draft' then
    if p ? 'platforms' then
      v_new.platforms := array(select lower(x) from jsonb_array_elements_text(p->'platforms') x);
      if exists (select 1 from unnest(v_new.platforms) x where not private.clip_platform_enabled(x)) then
        raise exception 'only Instagram clips can be verified today; YouTube and TikTok are not connected yet';
      end if;
    end if;
    if p ? 'required_tags' then v_new.required_tags := array(select left(lower(btrim(x)), 64) from jsonb_array_elements_text(p->'required_tags') x where btrim(x) <> ''); end if;
    if p ? 'base_cpm_cents' then v_new.base_cpm_cents := (p->>'base_cpm_cents')::integer; end if;
    if p ? 'min_views' then v_new.min_views := (p->>'min_views')::integer; end if;
    if p ? 'max_payable_views_per_clip' then v_new.max_payable_views_per_clip := nullif(p->>'max_payable_views_per_clip', '')::bigint; end if;
    if p ? 'max_clips_per_clipper' then v_new.max_clips_per_clipper := (p->>'max_clips_per_clipper')::integer; end if;
    if p ? 'earning_window_days' then v_new.earning_window_days := (p->>'earning_window_days')::integer; end if;
    if p ? 'keep_live_days' then v_new.keep_live_days := (p->>'keep_live_days')::integer; end if;
    if p ? 'hold_days' then v_new.hold_days := (p->>'hold_days')::integer; end if;
    if p ? 'bonus_account_cents' then v_new.bonus_account_cents := (p->>'bonus_account_cents')::integer; end if;
    if p ? 'bonus_listen_cents' then v_new.bonus_listen_cents := (p->>'bonus_listen_cents')::integer; end if;
    if p ? 'approval_mode' then v_new.approval_mode := p->>'approval_mode'; end if;
  else
    if v_new.budget_cents < v.budget_cents
       or coalesce(v_new.per_clip_cap_cents, 2147483647) < coalesce(v.per_clip_cap_cents, 2147483647)
       or coalesce(v_new.per_clipper_cap_cents, 2147483647) < coalesce(v.per_clipper_cap_cents, 2147483647) then
      raise exception 'after launch the budget and caps can only grow';
    end if;
    if (p - array['rules', 'budget_cents', 'per_clip_cap_cents', 'per_clipper_cap_cents', 'ends_at']) <> '{}'::jsonb then
      raise exception 'after launch only the rules, budget, caps and end date can change';
    end if;
  end if;
  if p ? 'ends_at' then
    if v.status <> 'draft' and (select ends_at from public.action_missions where id = p_mission) > nullif(p->>'ends_at', '')::timestamptz then
      raise exception 'after launch the end date can only move later';
    end if;
    update public.action_missions set ends_at = nullif(p->>'ends_at', '')::timestamptz, updated_at = now() where id = p_mission;
  end if;
  update public.action_clip_campaigns set
    rules = v_new.rules, budget_cents = v_new.budget_cents, per_clip_cap_cents = v_new.per_clip_cap_cents,
    per_clipper_cap_cents = v_new.per_clipper_cap_cents, platforms = v_new.platforms, required_tags = v_new.required_tags,
    base_cpm_cents = v_new.base_cpm_cents, min_views = v_new.min_views,
    max_payable_views_per_clip = v_new.max_payable_views_per_clip, max_clips_per_clipper = v_new.max_clips_per_clipper,
    earning_window_days = v_new.earning_window_days, keep_live_days = v_new.keep_live_days, hold_days = v_new.hold_days,
    bonus_account_cents = v_new.bonus_account_cents, bonus_listen_cents = v_new.bonus_listen_cents,
    approval_mode = v_new.approval_mode,
    budget_exhausted_at = case when v_new.budget_cents > v.budget_cents then null else budget_exhausted_at end,
    updated_at = now()
  where mission_id = p_mission;
  if p ? 'rules' then update public.social_content_items set master_caption = v_new.rules, updated_at = now() where id = v.content_id; end if;
  perform private.clip_audit(v.org_id, 'clip.campaign.updated', 'clip_campaign', p_mission::text, p);
  return jsonb_build_object('mission_id', p_mission, 'updated', true);
end;
$$;

create or replace function public.clip_campaign_set_status(p_mission uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.action_clip_campaigns%rowtype := private.clip_require_owner(p_mission);
  v_money record;
begin
  select * into v from public.action_clip_campaigns where mission_id = p_mission for update;
  if p_status not in ('live', 'paused', 'ended') then raise exception 'status must be live, paused or ended'; end if;
  if v.status = 'ended' then raise exception 'an ended campaign stays ended'; end if;
  if p_status = 'live' then
    select * into v_money from private.clip_money(p_mission);
    if v_money.available_cents <= 0 then raise exception 'fund the campaign before it goes live'; end if;
  end if;
  update public.action_clip_campaigns
     set status = p_status, status_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         launched_at = case when p_status = 'live' then coalesce(launched_at, now()) else launched_at end,
         ended_at = case when p_status = 'ended' then now() else ended_at end, updated_at = now()
   where mission_id = p_mission;
  update public.action_missions
     set status = case p_status when 'live' then 'open' when 'paused' then 'paused' else 'closed' end, updated_at = now()
   where id = p_mission;
  perform private.clip_audit(v.org_id, 'clip.campaign.' || p_status, 'clip_campaign', p_mission::text,
                             jsonb_build_object('from', v.status, 'reason', p_reason));
  return jsonb_build_object('mission_id', p_mission, 'status', p_status);
end;
$$;

/* Record funding. The org owner attests an allocation or a payment with
   its provider reference; a refund returns only money nothing is committed
   against. Real-money escrow through Stripe is not wired yet. */
create or replace function public.clip_campaign_fund(p_mission uuid, p_amount_cents bigint, p_kind text,
                                                     p_provider text default 'internal', p_provider_ref text default null,
                                                     p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.action_clip_campaigns%rowtype := private.clip_require_owner(p_mission);
  v_money record;
  v_delta bigint;
  v_id uuid;
begin
  select * into v from public.action_clip_campaigns where mission_id = p_mission for update;
  if p_kind not in ('program_allocation', 'contribution', 'refund') then raise exception 'unknown funding kind'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000 then raise exception 'invalid amount'; end if;
  if p_provider not in ('internal', 'stripe', 'square', 'manual') then raise exception 'unknown provider'; end if;
  if p_provider <> 'internal' and nullif(btrim(coalesce(p_provider_ref, '')), '') is null then
    raise exception 'a payment needs its provider reference';
  end if;
  v_delta := case when p_kind = 'refund' then -p_amount_cents else p_amount_cents end;
  if v_delta < 0 then
    select * into v_money from private.clip_money(p_mission);
    if v_money.funded_cents - v_money.committed_cents < p_amount_cents then
      raise exception 'only uncommitted funding can be returned';
    end if;
  end if;
  insert into public.action_bounty_funding_ledger (clip_mission_id, delta_cents, kind, provider, provider_ref, state, note, created_by, verified_at)
  values (p_mission, v_delta, p_kind, p_provider, nullif(btrim(coalesce(p_provider_ref, '')), ''), 'verified',
          left(coalesce(p_note, ''), 800), (select auth.uid()), now())
  returning id into v_id;
  update public.action_clip_campaigns set budget_exhausted_at = null, updated_at = now()
   where mission_id = p_mission and v_delta > 0;
  perform private.clip_audit(v.org_id, 'clip.campaign.funded', 'clip_campaign', p_mission::text,
                             jsonb_build_object('delta_cents', v_delta, 'kind', p_kind, 'provider', p_provider, 'ledger_id', v_id));
  return jsonb_build_object('ledger_id', v_id, 'money', (select to_jsonb(m) from private.clip_money(p_mission) m));
end;
$$;

/* The creator's (or desk's) content decision on one clip. approve lets its
   held earnings release; reject voids them; hold stops release; release
   clears a fraud hold after review. */
create or replace function public.clip_review_submission(p_submission uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.action_clip_submissions%rowtype;
  v public.action_clip_campaigns%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_sub from public.action_clip_submissions where id = p_submission;
  if not found then raise exception 'clip not found'; end if;
  v := private.clip_require_owner(v_sub.mission_id);
  if p_decision not in ('approve', 'reject', 'hold', 'release') then raise exception 'decision must be approve, reject, hold or release'; end if;
  perform 1 from public.action_clip_campaigns where mission_id = v_sub.mission_id for update;
  select * into v_sub from public.action_clip_submissions where id = p_submission for update;
  if v_sub.user_id = (select auth.uid()) then raise exception 'you cannot review your own clip'; end if;
  if v_sub.status in ('rejected', 'removed') then raise exception 'this clip is already %', v_sub.status; end if;

  if p_decision = 'approve' then
    update public.action_clip_submissions
       set review_state = 'approved', reviewed_by = public.current_m_uid(), reviewed_at = now(), review_note = v_note, updated_at = now()
     where id = p_submission;
  elsif p_decision = 'reject' then
    if exists (select 1 from public.action_clip_earnings where submission_id = p_submission and state = 'paid') then
      raise exception 'this clip has paid earnings; hold it instead';
    end if;
    update public.action_clip_earnings set state = 'void', voided_at = now(), void_reason = coalesce(v_note, 'clip rejected')
     where submission_id = p_submission and state in ('held', 'payable');
    update public.action_clip_submissions
       set status = 'rejected', review_state = 'rejected', reviewed_by = public.current_m_uid(), reviewed_at = now(),
           review_note = v_note, rejection_reason = coalesce(v_note, 'Rejected in review'), updated_at = now()
     where id = p_submission;
  elsif p_decision = 'hold' then
    update public.action_clip_earnings set state = 'held' where submission_id = p_submission and state = 'payable';
    update public.action_clip_submissions
       set status = 'held', hold_reason = coalesce(v_note, 'Held in review'), updated_at = now()
     where id = p_submission;
  else
    if v_sub.status <> 'held' then raise exception 'only a held clip can be released'; end if;
    update public.action_clip_submissions
       set status = 'tracking', hold_reason = null, reviewed_by = public.current_m_uid(), reviewed_at = now(),
           review_note = coalesce(v_note, review_note), updated_at = now()
     where id = p_submission;
  end if;
  perform private.clip_audit(v.org_id, 'clip.submission.' || p_decision, 'clip_submission', p_submission::text,
                             jsonb_build_object('note', v_note, 'previous_status', v_sub.status, 'fraud_flags', to_jsonb(v_sub.fraud_flags)));
  return jsonb_build_object('submission_id', p_submission, 'decision', p_decision);
end;
$$;

/* Pay a clipper everything payable to them in this org, once. The payout
   reference is unique per provider, so a repeated call is recognised. */
create or replace function public.clip_record_payout(p_org uuid, p_m_uid uuid, p_provider text, p_provider_ref text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref text := nullif(btrim(coalesce(p_provider_ref, '')), '');
  v_existing public.action_clip_payouts%rowtype;
  v_total bigint;
  v_payout uuid;
begin
  if (select auth.uid()) is null or not private.is_org_owner(p_org) then raise exception 'not authorized'; end if;
  if p_provider not in ('stripe', 'paypal', 'square', 'manual', 'other') or v_ref is null then
    raise exception 'a payout needs its provider and reference';
  end if;
  select * into v_existing from public.action_clip_payouts where provider = p_provider and provider_ref = v_ref;
  if found then
    if v_existing.org_id <> p_org or v_existing.m_uid <> p_m_uid then raise exception 'that payout reference is already used'; end if;
    return jsonb_build_object('payout_id', v_existing.id, 'amount_cents', v_existing.amount_cents, 'idempotent', true);
  end if;
  perform pg_advisory_xact_lock(hashtext('clip:payout:' || p_org || ':' || p_m_uid));
  select coalesce(sum(amount_cents), 0) into v_total from public.action_clip_earnings
   where org_id = p_org and m_uid = p_m_uid and state = 'payable';
  if v_total <= 0 then raise exception 'nothing is payable to this clipper'; end if;
  insert into public.action_clip_payouts (org_id, m_uid, amount_cents, provider, provider_ref, note, recorded_by)
  values (p_org, p_m_uid, v_total, p_provider, v_ref, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()))
  returning id into v_payout;
  update public.action_clip_earnings set state = 'paid', paid_at = now(), payout_id = v_payout
   where org_id = p_org and m_uid = p_m_uid and state = 'payable';
  perform private.clip_audit(p_org, 'clip.payout.recorded', 'clip_payout', v_payout::text,
                             jsonb_build_object('m_uid', p_m_uid, 'amount_cents', v_total, 'provider', p_provider, 'provider_ref', v_ref));
  return jsonb_build_object('payout_id', v_payout, 'amount_cents', v_total);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Clipper side.

create or replace function public.clip_campaigns_open(p_song text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x->>'launched_at' desc), '[]'::jsonb)
  from (
    select jsonb_strip_nulls(jsonb_build_object(
      'mission_id', c.mission_id, 'title', m.title, 'description', m.description, 'status', c.status,
      'platforms', to_jsonb(c.platforms), 'rules', c.rules, 'required_tags', to_jsonb(c.required_tags),
      'base_cpm_cents', c.base_cpm_cents, 'min_views', c.min_views, 'per_clip_cap_cents', c.per_clip_cap_cents,
      'per_clipper_cap_cents', c.per_clipper_cap_cents, 'max_payable_views_per_clip', c.max_payable_views_per_clip,
      'max_clips_per_clipper', c.max_clips_per_clipper, 'earning_window_days', c.earning_window_days,
      'keep_live_days', c.keep_live_days, 'hold_days', c.hold_days, 'bonus_account_cents', c.bonus_account_cents,
      'bonus_listen_cents', c.bonus_listen_cents, 'approval_mode', c.approval_mode,
      'starts_at', m.starts_at, 'ends_at', m.ends_at, 'launched_at', c.launched_at,
      'song', case when o.id is not null then jsonb_build_object('id', o.id, 'key', o.catalog_key, 'title', o.track_title,
                    'artist', o.artist_name, 'url', o.canonical_url, 'artwork', o.artwork_path) end,
      'track', case when t.id is not null then jsonb_build_object('id', t.id, 'title', t.title, 'artist', t.artist) end,
      'creator', (select jsonb_build_object('handle', cp.handle, 'artist_name', cp.artist_name)
                    from public.music_creator_profiles cp where cp.m_uid = c.creator_m_uid),
      'budget_left_cents', (select available_cents from private.clip_money(c.mission_id)),
      'clippers', (select count(*) from public.action_clip_claims k where k.mission_id = c.mission_id and k.status = 'active'),
      'moments', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label, 'start_ms', a.start_ms, 'end_ms', a.end_ms) order by a.sort), '[]'::jsonb)
                    from public.action_clip_assets a where a.mission_id = c.mission_id and a.kind = 'moment')
    )) x
    from public.action_clip_campaigns c
    join public.action_missions m on m.id = c.mission_id
    left join public.music_catalog_objects o on o.id = c.music_object_id
    left join public.creator_tracks t on t.id = c.creator_track_id
    where c.status = 'live' and m.status = 'open'
      and (m.starts_at is null or m.starts_at <= now()) and (m.ends_at is null or m.ends_at > now())
      and (p_song is null or o.catalog_key = p_song or o.id::text = p_song)
  ) s
$$;

create or replace function public.clip_campaign_claim(p_mission uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := (select auth.uid());
  v_muid   uuid := public.current_m_uid();
  v        public.action_clip_campaigns%rowtype;
  v_join   jsonb;
  v_claim  public.action_clip_claims%rowtype;
  v_money  record;
begin
  if v_user is null or v_muid is null then raise exception 'sign in with your M account to clip'; end if;
  select * into v from public.action_clip_campaigns where mission_id = p_mission;
  if not found or v.status <> 'live' then raise exception 'this campaign is not taking clippers'; end if;
  if v.creator_m_uid = v_muid then raise exception 'you cannot clip your own campaign for pay'; end if;
  select * into v_money from private.clip_money(p_mission);
  if v_money.available_cents <= 0 then raise exception 'this campaign''s budget is spoken for'; end if;

  v_join := public.join_action_mission(p_mission);
  select * into v_claim from public.action_clip_claims where mission_id = p_mission and m_uid = v_muid for update;
  if found then
    if v_claim.status = 'suspended' then raise exception 'your clipping on this campaign is suspended'; end if;
    if v_claim.status = 'withdrawn' then
      update public.action_clip_claims set status = 'active', status_reason = null where id = v_claim.id returning * into v_claim;
    end if;
    return jsonb_build_object('claim_id', v_claim.id, 'ref_code', v_claim.ref_code, 'status', v_claim.status, 'idempotent', true);
  end if;
  insert into public.action_clip_claims (mission_id, assignment_id, user_id, m_uid, ref_code)
  values (p_mission, (v_join->>'assignment_id')::uuid, v_user, v_muid, private.clip_code())
  returning * into v_claim;
  perform private.clip_audit(v.org_id, 'clip.claimed', 'clip_claim', v_claim.id::text, jsonb_build_object('mission_id', p_mission));
  return jsonb_build_object('claim_id', v_claim.id, 'ref_code', v_claim.ref_code, 'status', v_claim.status);
end;
$$;

/* Leaving the mission withdraws the claim; rejoining through the claim
   reactivates it. */
create or replace function public.action_clip_sync_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'withdrawn' and old.status <> 'withdrawn' then
    update public.action_clip_claims set status = 'withdrawn' where assignment_id = new.id and status = 'active';
  end if;
  return new;
end;
$$;
revoke all on function public.action_clip_sync_claim() from public, anon, authenticated;
drop trigger if exists action_clip_sync_claim_trg on public.action_mission_assignments;
create trigger action_clip_sync_claim_trg after update of status on public.action_mission_assignments
  for each row execute function public.action_clip_sync_claim();

/* Register a platform account to clip from. Returns the code to put in the
   account's bio / channel description; the Worker checks it there. */
create or replace function public.clip_account_register(p_platform text, p_handle text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_muid   uuid := public.current_m_uid();
  v_handle text := lower(regexp_replace(btrim(coalesce(p_handle, '')), '^@', ''));
  v_acct   public.social_accounts%rowtype;
  v_code   text;
begin
  if (select auth.uid()) is null or v_muid is null then raise exception 'sign in with your M account'; end if;
  if p_platform not in ('instagram', 'tiktok', 'youtube') then raise exception 'unknown platform'; end if;
  if not private.clip_platform_enabled(p_platform) then raise exception '% accounts cannot be verified yet', p_platform; end if;
  if v_handle !~ '^[a-z0-9._-]{2,64}$' then raise exception 'enter your handle, like @yourname'; end if;
  select * into v_acct from public.social_accounts
   where owner_m_uid = v_muid and platform = p_platform and lower(coalesce(handle, '')) = v_handle;
  if found then
    return jsonb_build_object('account_id', v_acct.id, 'code', v_acct.owner_verification->>'code',
                              'verified', v_acct.owner_verified_at is not null);
  end if;
  if (select count(*) from public.social_accounts where owner_m_uid = v_muid) >= 12 then
    raise exception 'that is enough accounts for one member';
  end if;
  v_code := 'MCC-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
  insert into public.social_accounts (org_id, platform, external_account_id, handle, display_name, status, owner_m_uid, owner_verification)
  values (private.clip_network_org(), p_platform, 'pending:' || v_handle || ':' || v_muid, v_handle, v_handle, 'disconnected', v_muid,
          jsonb_build_object('code', v_code, 'requested_at', now()))
  returning * into v_acct;
  return jsonb_build_object('account_id', v_acct.id, 'code', v_code, 'verified', false);
end;
$$;

/* The desk attaches the stored Instagram credential (a Worker env name or a
   vault secret, the same shapes org accounts use) for a member's account.
   Only an account with a credential can be read server-side, and only a
   read with it can verify ownership or move money. */
create or replace function public.clip_account_attach_credential(p_account uuid, p_credential_ref text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_acct public.social_accounts%rowtype;
begin
  if (select auth.uid()) is null or not (select public.eu_is_admin()) then raise exception 'not authorized'; end if;
  select * into v_acct from public.social_accounts where id = p_account and owner_m_uid is not null for update;
  if not found then raise exception 'member account not found'; end if;
  if v_acct.platform <> 'instagram' then raise exception 'only Instagram credentials can be attached'; end if;
  update public.social_accounts set credential_ref = nullif(btrim(coalesce(p_credential_ref, '')), ''), updated_at = now()
   where id = p_account;
  perform private.clip_audit(private.clip_network_org(), 'clip.account.credential_attached', 'social_account', p_account::text,
                             jsonb_build_object('attached', nullif(btrim(coalesce(p_credential_ref, '')), '') is not null));
  return jsonb_build_object('account_id', p_account, 'credential', nullif(btrim(coalesce(p_credential_ref, '')), '') is not null);
end;
$$;

create or replace function public.clip_submit(p_mission uuid, p_platform text, p_url text, p_moment uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := (select auth.uid());
  v_muid   uuid := public.current_m_uid();
  v        public.action_clip_campaigns%rowtype;
  v_claim  public.action_clip_claims%rowtype;
  v_media  text;
  v_id     uuid;
  v_code   text;
begin
  if v_user is null or v_muid is null then raise exception 'sign in with your M account'; end if;
  select * into v from public.action_clip_campaigns where mission_id = p_mission;
  if not found then raise exception 'campaign not found'; end if;
  if v.status not in ('live', 'paused') then raise exception 'this campaign is not taking clips'; end if;
  if exists (select 1 from public.action_missions where id = p_mission and ends_at is not null and ends_at <= now()) then
    raise exception 'submissions for this campaign have closed';
  end if;
  select * into v_claim from public.action_clip_claims where mission_id = p_mission and m_uid = v_muid;
  if not found or v_claim.status <> 'active' then raise exception 'claim this campaign before you submit'; end if;
  if not (p_platform = any (v.platforms)) then raise exception 'this campaign does not pay for % clips', p_platform; end if;
  if not private.clip_platform_enabled(p_platform) then raise exception '% clips cannot be verified yet', p_platform; end if;
  v_media := private.clip_parse_url(p_platform, p_url);
  if v_media is null then raise exception 'paste the link to one public % post', p_platform; end if;
  if p_moment is not null and not exists (select 1 from public.action_clip_assets where id = p_moment and mission_id = p_mission and kind = 'moment') then
    raise exception 'that moment is not part of this campaign';
  end if;
  if (select count(*) from public.action_clip_submissions where claim_id = v_claim.id and status <> 'rejected') >= v.max_clips_per_clipper then
    raise exception 'you have submitted the most clips this campaign allows';
  end if;
  if exists (select 1 from public.action_clip_submissions where platform = p_platform and external_media_id = v_media) then
    raise exception 'that clip has already been submitted';
  end if;
  v_code := private.clip_code();
  insert into public.action_clip_submissions (mission_id, claim_id, m_uid, user_id, platform, external_media_id, submitted_url,
                                              ref_code, moment_id, review_state)
  values (p_mission, v_claim.id, v_muid, v_user, p_platform, v_media, btrim(p_url), v_code, p_moment,
          case when v.approval_mode = 'creator' then 'pending' else 'not_required' end)
  returning id into v_id;
  perform private.clip_audit(v.org_id, 'clip.submitted', 'clip_submission', v_id::text,
                             jsonb_build_object('platform', p_platform, 'media', v_media, 'claim_id', v_claim.id));
  return jsonb_build_object('submission_id', v_id, 'status', 'submitted', 'ref_code', v_code, 'media_id', v_media);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Settlement (service role only: the Worker after a platform fetch).

/* Bring one clip's earnings to what its verified views are worth now.
   Serialised per campaign; never past budget or verified funding; never
   from anything but platform_api snapshots. Idempotent: a repeat call with
   the same snapshots writes nothing. */
create or replace function public.clip_settle_submission(p_submission uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub       public.action_clip_submissions%rowtype;
  v           public.action_clip_campaigns%rowtype;
  v_views     bigint;
  v_latest    bigint;
  v_payable   bigint;
  v_target    bigint;
  v_accrued   bigint;
  v_other     bigint;
  v_delta     bigint;
  v_money     record;
  v_hold      timestamptz;
  v_entry     uuid;
begin
  select mission_id into v_sub.mission_id from public.action_clip_submissions where id = p_submission;
  if v_sub.mission_id is null then raise exception 'clip not found'; end if;
  select * into v from public.action_clip_campaigns where mission_id = v_sub.mission_id for update;
  select * into v_sub from public.action_clip_submissions where id = p_submission for update;
  if v_sub.status not in ('tracking', 'held', 'closed') or v_sub.social_post_id is null or v_sub.posted_at is null then
    return jsonb_build_object('submission_id', p_submission, 'settled', false, 'reason', 'not tracking');
  end if;

  select max(s.views) filter (where s.recorded_at <= v_sub.posted_at + make_interval(days => v.earning_window_days)),
         (array_agg(s.views order by s.recorded_at desc))[1]
    into v_views, v_latest
    from public.social_metric_snapshots s
   where s.post_id = v_sub.social_post_id and s.source = 'platform_api';
  v_views := coalesce(v_views, 0);
  v_payable := case when v_views >= v.min_views then least(v_views, coalesce(v.max_payable_views_per_clip, v_views)) else 0 end;
  v_target := floor(v_payable::numeric * v.base_cpm_cents / 1000);
  if v.per_clip_cap_cents is not null then v_target := least(v_target, v.per_clip_cap_cents); end if;
  if v.per_clipper_cap_cents is not null then
    select coalesce(sum(amount_cents), 0) into v_other from public.action_clip_earnings
     where claim_id = v_sub.claim_id and state <> 'void' and submission_id is distinct from p_submission;
    v_target := least(v_target, greatest(0, v.per_clipper_cap_cents - v_other));
  end if;

  select coalesce(sum(amount_cents), 0) into v_accrued from public.action_clip_earnings
   where submission_id = p_submission and kind in ('views', 'reversal') and state <> 'void';
  v_delta := v_target - v_accrued;
  v_hold := greatest(now() + make_interval(days => v.hold_days), v_sub.posted_at + make_interval(days => v.keep_live_days));

  if v_delta > 0 then
    select * into v_money from private.clip_money(v.mission_id);
    if v_money.available_cents < v_delta then
      v_delta := v_money.available_cents;
      update public.action_clip_campaigns set budget_exhausted_at = coalesce(budget_exhausted_at, now()),
             status = case when status = 'live' then 'paused' else status end,
             status_reason = case when status = 'live' then 'Budget or funding reached' else status_reason end, updated_at = now()
       where mission_id = v.mission_id;
      update public.action_missions set status = 'paused', updated_at = now() where id = v.mission_id and status = 'open';
    end if;
    if v_delta > 0 then
      insert into public.action_clip_earnings (mission_id, org_id, claim_id, submission_id, m_uid, kind, amount_cents, hold_until, basis, idempotency_key)
      values (v.mission_id, v.org_id, v_sub.claim_id, p_submission, v_sub.m_uid, 'views', v_delta, v_hold,
              jsonb_build_object('payable_views', v_payable, 'verified_views', v_views, 'cpm_cents', v.base_cpm_cents,
                                 'target_cents', v_target, 'previously_accrued_cents', v_accrued),
              'views:' || p_submission || ':' || (v_accrued + v_delta))
      on conflict (idempotency_key) do nothing
      returning id into v_entry;
    end if;
  elsif v_delta < 0 then
    insert into public.action_clip_earnings (mission_id, org_id, claim_id, submission_id, m_uid, kind, amount_cents, hold_until, basis, idempotency_key)
    values (v.mission_id, v.org_id, v_sub.claim_id, p_submission, v_sub.m_uid, 'reversal', v_delta, v_hold,
            jsonb_build_object('payable_views', v_payable, 'verified_views', v_views, 'target_cents', v_target,
                               'previously_accrued_cents', v_accrued),
            'reversal:' || p_submission || ':' || v_target)
    on conflict (idempotency_key) do nothing
    returning id into v_entry;
  end if;

  update public.action_clip_submissions
     set verified_views = greatest(coalesce(v_latest, 0), 0), payable_views = v_payable,
         earned_view_cents = v_accrued + case when v_entry is not null then v_delta else 0 end, updated_at = now()
   where id = p_submission;
  return jsonb_build_object('submission_id', p_submission, 'settled', true, 'payable_views', v_payable,
                            'target_cents', v_target, 'delta_cents', case when v_entry is not null then v_delta else 0 end);
end;
$$;

/* Submissions the Worker should check now: new ones to verify, tracked ones
   whose metrics are due. Leases each row for 10 minutes. */
create or replace function public.clip_work_due(p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows jsonb;
begin
  with due as (
    select s.id from public.action_clip_submissions s
     where s.status in ('submitted', 'tracking', 'held') and s.next_metrics_at <= now()
     order by s.next_metrics_at
     limit greatest(1, least(coalesce(p_limit, 25), 100))
     for update skip locked
  ), leased as (
    update public.action_clip_submissions s set next_metrics_at = now() + interval '10 minutes'
      from due where s.id = due.id
    returning s.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'submission_id', l.id, 'status', l.status, 'platform', l.platform, 'external_media_id', l.external_media_id,
      'posted_at', l.posted_at, 'm_uid', l.m_uid,
      'platform_media_id', (select sp.metadata->>'platform_media_id' from public.social_posts sp where sp.id = l.social_post_id),
      'post_account', (select a.external_account_id from public.social_posts sp join public.social_accounts a on a.id = sp.account_id
                        where sp.id = l.social_post_id),
      'accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'external_account_id', a.external_account_id,
                                                                  'handle', a.handle, 'credential_ref', a.credential_ref)), '[]'::jsonb)
                     from public.social_accounts a
                    where a.owner_m_uid = l.m_uid and a.platform = l.platform and a.owner_verified_at is not null))), '[]'::jsonb)
    into v_rows
  from leased l;
  return v_rows;
end;
$$;

/* The Worker's verification of a new clip. p: available (false when the
   platform cannot be read server-side yet), found, live, owner_account_id
   (the platform's account id for the post), caption, posted_at, views,
   likes, comments, shares, raw. */
create or replace function public.clip_record_verification(p_submission uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub     public.action_clip_submissions%rowtype;
  v         public.action_clip_campaigns%rowtype;
  v_claim   public.action_clip_claims%rowtype;
  v_mission public.action_missions%rowtype;
  v_acct    public.social_accounts%rowtype;
  v_posted  timestamptz := nullif(p->>'posted_at', '')::timestamptz;
  v_caption text := coalesce(p->>'caption', '');
  v_tag     text;
  v_reason  text;
  v_post    uuid;
begin
  select * into v_sub from public.action_clip_submissions where id = p_submission for update;
  if not found then raise exception 'clip not found'; end if;
  if v_sub.status <> 'submitted' then return jsonb_build_object('submission_id', p_submission, 'status', v_sub.status, 'idempotent', true); end if;
  select * into v from public.action_clip_campaigns where mission_id = v_sub.mission_id;
  select * into v_claim from public.action_clip_claims where id = v_sub.claim_id;
  select * into v_mission from public.action_missions where id = v_sub.mission_id;

  if coalesce((p->>'available')::boolean, false) = false then
    update public.action_clip_submissions
       set waiting_reason = left(coalesce(p->>'reason', 'This platform cannot be verified server-side yet'), 300),
           next_metrics_at = now() + interval '6 hours', updated_at = now()
     where id = p_submission;
    return jsonb_build_object('submission_id', p_submission, 'status', 'submitted', 'waiting', true);
  end if;

  if not coalesce((p->>'found')::boolean, false) or not coalesce((p->>'live')::boolean, false) then
    v_reason := 'The post could not be found as a public post.';
  end if;
  if v_reason is null then
    select * into v_acct from public.social_accounts
     where owner_m_uid = v_sub.m_uid and platform = v_sub.platform and owner_verified_at is not null
       and external_account_id = p->>'owner_account_id';
    if not found then v_reason := 'The post is not on a platform account you have verified.'; end if;
  end if;
  if v_reason is null and (v_posted is null or v_posted < v_claim.claimed_at - interval '5 minutes'
                           or v_posted < coalesce(v_mission.starts_at, v.launched_at, v_claim.claimed_at)) then
    v_reason := 'The post was published before you claimed this campaign.';
  end if;
  if v_reason is null and v_mission.ends_at is not null and v_posted > v_mission.ends_at then
    v_reason := 'The post was published after the campaign closed.';
  end if;
  if v_reason is null then
    foreach v_tag in array v.required_tags loop
      if position(lower(v_tag) in lower(v_caption)) = 0 then
        v_reason := 'The caption is missing ' || v_tag || '.';
        exit;
      end if;
    end loop;
  end if;

  if v_reason is not null then
    update public.action_clip_submissions
       set status = 'rejected', rejection_reason = v_reason, waiting_reason = null, verified_at = now(),
           caption_snapshot = left(v_caption, 2200), updated_at = now()
     where id = p_submission;
    perform private.clip_audit(v.org_id, 'clip.submission.rejected', 'clip_submission', p_submission::text,
                               jsonb_build_object('reason', v_reason));
    return jsonb_build_object('submission_id', p_submission, 'status', 'rejected', 'reason', v_reason);
  end if;

  insert into public.social_posts (org_id, account_id, external_media_id, permalink, publish_mode, caption, published_at,
                                   content_id, metadata, next_insights_sync_at)
  values (private.clip_network_org(), v_acct.id, v_sub.external_media_id,
          coalesce(private.clip_canonical_url(v_sub.platform, v_sub.external_media_id), v_sub.submitted_url),
          'clip', left(v_caption, 2200), v_posted, v.content_id,
          jsonb_strip_nulls(jsonb_build_object('clip_submission_id', p_submission, 'mission_id', v_sub.mission_id,
                                               'platform_media_id', nullif(p->>'platform_media_id', ''))), 'infinity')
  on conflict (account_id, external_media_id) do update set updated_at = now()
  returning id into v_post;

  insert into public.social_metric_snapshots (org_id, post_id, recorded_at, views, likes, comments, shares, raw, source)
  values (private.clip_network_org(), v_post, clock_timestamp(), greatest(0, coalesce((p->>'views')::bigint, 0)),
          greatest(0, coalesce((p->>'likes')::bigint, 0)), greatest(0, coalesce((p->>'comments')::bigint, 0)),
          greatest(0, coalesce((p->>'shares')::bigint, 0)), coalesce(p->'raw', '{}'::jsonb), 'platform_api');

  update public.action_clip_submissions
     set status = 'tracking', social_account_id = v_acct.id, social_post_id = v_post, posted_at = v_posted,
         verified_at = now(), live_checked_at = now(), last_metrics_at = now(), waiting_reason = null,
         caption_snapshot = left(v_caption, 2200), next_metrics_at = now() + interval '1 hour', updated_at = now()
   where id = p_submission;
  perform private.clip_audit(v.org_id, 'clip.submission.verified', 'clip_submission', p_submission::text,
                             jsonb_build_object('post_id', v_post, 'posted_at', v_posted));
  perform public.clip_check_fraud(p_submission);
  return jsonb_build_object('submission_id', p_submission, 'status', 'tracking', 'post_id', v_post,
                            'settlement', public.clip_settle_submission(p_submission));
end;
$$;

/* Explainable fraud signals over the server-verified metric history. A new
   flag holds the clip: its earnings keep accruing within budget but cannot
   release until the creator or desk reviews it. */
create or replace function public.clip_check_fraud(p_submission uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub   public.action_clip_submissions%rowtype;
  v_last  record;
  v_prev  record;
  v_flags text[] := '{}';
  v_new   text[];
begin
  select * into v_sub from public.action_clip_submissions where id = p_submission;
  if v_sub.social_post_id is null then return '{}'; end if;
  select views, likes, comments, shares, recorded_at into v_last from public.social_metric_snapshots
   where post_id = v_sub.social_post_id and source = 'platform_api' order by recorded_at desc limit 1;
  select views, recorded_at into v_prev from public.social_metric_snapshots
   where post_id = v_sub.social_post_id and source = 'platform_api' order by recorded_at desc offset 1 limit 1;
  if v_last.views >= 10000 and (v_last.likes + v_last.comments + v_last.shares)::numeric / v_last.views < 0.002 then
    v_flags := array_append(v_flags, 'low_engagement');
  end if;
  if v_prev.views is not null and v_prev.views >= 1000 and v_last.views > v_prev.views * 20
     and v_last.recorded_at - v_prev.recorded_at < interval '2 hours' then
    v_flags := array_append(v_flags, 'view_spike');
  end if;
  if v_prev.views is not null and v_last.views < v_prev.views * 0.8 then
    v_flags := array_append(v_flags, 'views_fell');
  end if;
  v_new := array(select unnest(v_flags) except select unnest(v_sub.fraud_flags));
  if cardinality(v_new) > 0 then
    update public.action_clip_submissions
       set fraud_flags = array(select distinct unnest(fraud_flags || v_new)),
           status = case when status = 'tracking' then 'held' else status end,
           hold_reason = coalesce(hold_reason, 'Automatic hold: ' || array_to_string(v_new, ', ')), updated_at = now()
     where id = p_submission;
    update public.action_clip_earnings set state = 'held' where submission_id = p_submission and state = 'payable';
    perform private.clip_audit((select org_id from public.action_clip_campaigns where mission_id = v_sub.mission_id),
                               'clip.submission.flagged', 'clip_submission', p_submission::text,
                               jsonb_build_object('flags', to_jsonb(v_new)));
  end if;
  return v_new;
end;
$$;

/* A metric refresh from the platform. p: available, found, live, views,
   likes, comments, shares, raw. A clip that disappears before its keep-live
   period loses its held earnings. */
create or replace function public.clip_record_metrics(p_submission uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub   public.action_clip_submissions%rowtype;
  v       public.action_clip_campaigns%rowtype;
  v_keep  timestamptz;
  v_end   timestamptz;
begin
  select * into v_sub from public.action_clip_submissions where id = p_submission for update;
  if not found then raise exception 'clip not found'; end if;
  if v_sub.status not in ('tracking', 'held') then return jsonb_build_object('submission_id', p_submission, 'status', v_sub.status, 'idempotent', true); end if;
  select * into v from public.action_clip_campaigns where mission_id = v_sub.mission_id;
  v_keep := v_sub.posted_at + make_interval(days => v.keep_live_days);
  v_end := v_sub.posted_at + make_interval(days => greatest(v.earning_window_days, v.keep_live_days));

  if coalesce((p->>'available')::boolean, false) = false then
    update public.action_clip_submissions set next_metrics_at = now() + interval '3 hours', updated_at = now() where id = p_submission;
    return jsonb_build_object('submission_id', p_submission, 'deferred', true);
  end if;

  if not coalesce((p->>'found')::boolean, false) or not coalesce((p->>'live')::boolean, false) then
    if now() < v_keep then
      update public.action_clip_earnings set state = 'void', voided_at = now(), void_reason = 'Clip removed before its keep-live period'
       where submission_id = p_submission and state in ('held', 'payable');
    end if;
    update public.action_clip_submissions
       set status = case when now() < v_keep then 'removed' else 'closed' end, removed_at = now(), updated_at = now()
     where id = p_submission;
    perform private.clip_audit(v.org_id, 'clip.submission.removed', 'clip_submission', p_submission::text,
                               jsonb_build_object('before_keep_live', now() < v_keep));
    return jsonb_build_object('submission_id', p_submission, 'status', case when now() < v_keep then 'removed' else 'closed' end);
  end if;

  insert into public.social_metric_snapshots (org_id, post_id, recorded_at, views, likes, comments, shares, raw, source)
  values (private.clip_network_org(), v_sub.social_post_id, clock_timestamp(), greatest(0, coalesce((p->>'views')::bigint, 0)),
          greatest(0, coalesce((p->>'likes')::bigint, 0)), greatest(0, coalesce((p->>'comments')::bigint, 0)),
          greatest(0, coalesce((p->>'shares')::bigint, 0)), coalesce(p->'raw', '{}'::jsonb), 'platform_api');
  update public.action_clip_submissions
     set live_checked_at = now(), last_metrics_at = now(),
         next_metrics_at = case
           when now() - v_sub.posted_at < interval '2 days' then now() + interval '1 hour'
           when now() - v_sub.posted_at < interval '7 days' then now() + interval '6 hours'
           else now() + interval '1 day' end,
         updated_at = now()
   where id = p_submission;
  perform public.clip_check_fraud(p_submission);
  perform public.clip_settle_submission(p_submission);
  if now() >= v_end then
    update public.action_clip_submissions set status = 'closed', updated_at = now() where id = p_submission and status = 'tracking';
  end if;
  return jsonb_build_object('submission_id', p_submission, 'status', (select status from public.action_clip_submissions where id = p_submission));
end;
$$;

/* Held earnings become payable when their hold has passed, the clip was
   confirmed live after its keep-live period, its review allows it, and the
   clipper is in good standing. */
create or replace function public.clip_release_due()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  with ok as (
    select e.id from public.action_clip_earnings e
      join public.action_clip_claims k on k.id = e.claim_id and k.status = 'active'
      join public.action_clip_campaigns c on c.mission_id = e.mission_id
      left join public.action_clip_submissions s on s.id = e.submission_id
     where e.state = 'held' and e.hold_until <= now()
       and (e.submission_id is null
            or (s.status in ('tracking', 'closed')
                and s.review_state in ('approved', 'not_required')
                and s.live_checked_at >= s.posted_at + make_interval(days => c.keep_live_days)))
     for update of e skip locked
  )
  update public.action_clip_earnings e set state = 'payable', released_at = now() from ok where e.id = ok.id;
  get diagnostics v_count = row_count;
  return jsonb_build_object('released', v_count);
end;
$$;

/* Conversions from the first-party record. An account counts when a new,
   email-confirmed M account was created by a device that arrived through a
   clip code, and it was not the clipper. A listen counts when such a fan,
   or a signed-in fan who arrived through the code, completes a
   server-measured listen of the campaign's song. Each fan counts once per
   campaign; bonuses stop at a plausible rate (one per 200 verified views). */
create or replace function public.clip_attribute_conversions(p_since timestamptz default now() - interval '2 days')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          record;
  v          public.action_clip_campaigns%rowtype;
  v_claim    public.action_clip_claims%rowtype;
  v_sub      uuid;
  v_claim_id uuid;
  v_ok       boolean;
  v_why      text;
  v_views    bigint;
  v_paid     integer;
  v_money    record;
  v_bonus    integer;
  v_conv     uuid;
  v_entry    uuid;
  v_new      integer := 0;
  v_song     text;
begin
  for r in
    with coded as (
      select e.uid, e.at, coalesce(nullif(e.props->>'campaign', ''), split_part(e.props->>'acq', '/', 3)) code, e.name
        from public.events e
       where e.at >= p_since and e.uid is not null
         and ((e.name = 'account_created' and (e.props->>'campaign') like 'clip-%')
           or ((e.props->>'acq') like 'clip/%'))
    )
    select distinct on (code, uid, kind) code, uid, kind, at from (
      select code, uid, 'account' kind, at from coded where name = 'account_created'
      union all
      select code, uid, 'listen' kind, at from coded
    ) x
    where code ~ '^clip-[a-z0-9]{10}$'
    order by code, uid, kind, at
  loop
    v_claim := null; v_sub := null; v_claim_id := null;
    select * into v_claim from public.action_clip_claims where ref_code = r.code;
    if v_claim.id is null then
      select s.id, s.claim_id into v_sub, v_claim_id from public.action_clip_submissions s where s.ref_code = r.code;
      if v_claim_id is not null then select * into v_claim from public.action_clip_claims where id = v_claim_id; end if;
    end if;
    continue when v_claim.id is null;
    select * into v from public.action_clip_campaigns where mission_id = v_claim.mission_id;

    if r.kind = 'account' then
      continue when exists (select 1 from public.action_clip_conversions where kind = 'account' and converted_user_id = r.uid);
      v_ok := true; v_why := null;
      if exists (select 1 from public.m_auth_user_links l where l.auth_user_id = r.uid and l.m_uid = v_claim.m_uid) then
        v_ok := false; v_why := 'the clipper''s own account';
      elsif not exists (select 1 from auth.users u where u.id = r.uid and u.email_confirmed_at is not null
                          and u.created_at >= v_claim.claimed_at) then
        v_ok := false; v_why := 'not a new, confirmed account';
      end if;
    else
      -- listens carry a plain song slug ('pull-up'); the catalogue keys songs as album:slug
      v_song := coalesce((select regexp_replace(o.catalog_key, '^[^:]*:', '') from public.music_catalog_objects o where o.id = v.music_object_id),
                         (select t.slug from public.creator_tracks t where t.id = v.creator_track_id));
      continue when v_song is null;
      continue when exists (select 1 from public.action_clip_conversions where mission_id = v.mission_id and kind = 'listen' and converted_user_id = r.uid);
      continue when not exists (select 1 from public.music_listens l where l.user_id = r.uid and regexp_replace(l.track_key, '^[^:]*:', '') = v_song
                                   and l.completed and l.finished_at >= r.at);
      v_ok := not exists (select 1 from public.m_auth_user_links l where l.auth_user_id = r.uid and l.m_uid = v_claim.m_uid);
      v_why := case when v_ok then null else 'the clipper''s own account' end;
    end if;

    perform 1 from public.action_clip_campaigns where mission_id = v.mission_id for update;
    v_bonus := case r.kind when 'account' then v.bonus_account_cents else v.bonus_listen_cents end;
    if v_ok and v_bonus > 0 then
      select coalesce(sum(verified_views), 0) into v_views from public.action_clip_submissions
       where claim_id = v_claim.id and status in ('tracking', 'held', 'closed');
      select count(*) into v_paid from public.action_clip_conversions
       where claim_id = v_claim.id and kind = r.kind and qualified and earning_id is not null;
      if v_paid + 1 > greatest(1, v_views / 200) then v_ok := false; v_why := 'above a plausible conversion rate for verified views'; end if;
    end if;

    insert into public.action_clip_conversions (mission_id, claim_id, submission_id, kind, converted_user_id, occurred_at, qualified, disqualified_reason)
    values (v.mission_id, v_claim.id, v_sub, r.kind, r.uid, r.at, v_ok, v_why)
    on conflict do nothing
    returning id into v_conv;
    continue when v_conv is null;
    v_new := v_new + 1;

    if v_ok and v_bonus > 0 then
      select * into v_money from private.clip_money(v.mission_id);
      if v.per_clipper_cap_cents is not null then
        v_bonus := least(v_bonus, greatest(0, v.per_clipper_cap_cents - coalesce((select sum(amount_cents) from public.action_clip_earnings
                                                                                   where claim_id = v_claim.id and state <> 'void'), 0)));
      end if;
      v_bonus := least(v_bonus, v_money.available_cents);
      if v_bonus > 0 then
        insert into public.action_clip_earnings (mission_id, org_id, claim_id, submission_id, m_uid, kind, amount_cents, hold_until, basis, idempotency_key)
        values (v.mission_id, v.org_id, v_claim.id, v_sub, v_claim.m_uid, 'bonus_' || r.kind, v_bonus,
                now() + make_interval(days => v.hold_days),
                jsonb_build_object('conversion_id', v_conv, 'code', r.code), 'bonus:' || v_conv)
        on conflict (idempotency_key) do nothing
        returning id into v_entry;
        update public.action_clip_conversions set earning_id = v_entry where id = v_conv;
      end if;
    end if;
  end loop;
  return jsonb_build_object('conversions', v_new);
end;
$$;

/* Mark a member account verified after the Worker found its code on the
   platform. p: external_account_id (the platform's stable id), handle. */
create or replace function public.clip_account_mark_verified(p_account uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_acct public.social_accounts%rowtype;
begin
  select * into v_acct from public.social_accounts where id = p_account and owner_m_uid is not null for update;
  if not found then raise exception 'account not found'; end if;
  if nullif(p->>'external_account_id', '') is null then raise exception 'the platform account id is required'; end if;
  if exists (select 1 from public.social_accounts a where a.platform = v_acct.platform and a.owner_verified_at is not null
               and lower(a.external_account_id) = lower(p->>'external_account_id') and a.owner_m_uid <> v_acct.owner_m_uid) then
    raise exception 'another member already verified this account';
  end if;
  update public.social_accounts
     set external_account_id = p->>'external_account_id', handle = coalesce(nullif(p->>'handle', ''), handle),
         display_name = coalesce(nullif(p->>'display_name', ''), display_name), status = 'connected',
         owner_verified_at = now(), last_synced_at = now(),
         owner_verification = owner_verification || jsonb_build_object('verified_at', now(), 'method', 'code_in_profile'),
         updated_at = now()
   where id = p_account;
  return jsonb_build_object('account_id', p_account, 'verified', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Reading: the creator's dashboard and the clipper's work.

create or replace function public.clip_campaigns_for_org(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_org_owner(p_org) then raise exception 'not authorized'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'mission_id', c.mission_id, 'title', m.title, 'status', c.status, 'status_reason', c.status_reason,
      'platforms', to_jsonb(c.platforms), 'base_cpm_cents', c.base_cpm_cents, 'launched_at', c.launched_at,
      'ends_at', m.ends_at, 'song', o.track_title, 'money', (select to_jsonb(x) from private.clip_money(c.mission_id) x),
      'clips', (select count(*) from public.action_clip_submissions s where s.mission_id = c.mission_id),
      'pending_review', (select count(*) from public.action_clip_submissions s where s.mission_id = c.mission_id
                          and (s.status = 'held' or (s.review_state = 'pending' and s.status = 'tracking'))))
      order by c.created_at desc), '[]'::jsonb)
    from public.action_clip_campaigns c
    join public.action_missions m on m.id = c.mission_id
    left join public.music_catalog_objects o on o.id = c.music_object_id
    where c.org_id = p_org);
end;
$$;

create or replace function public.clip_campaign_dashboard(p_mission uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.action_clip_campaigns%rowtype := private.clip_require_owner(p_mission);
  v_since timestamptz;
  v_out jsonb;
begin
  v_since := coalesce((select starts_at from public.action_missions where id = p_mission), v.created_at);
  with codes as (
    select k.id claim_id, null::uuid submission_id, k.ref_code code from public.action_clip_claims k where k.mission_id = p_mission
    union all
    select s.claim_id, s.id, s.ref_code from public.action_clip_submissions s where s.mission_id = p_mission
  ),
  ev as (
    select c.claim_id, c.submission_id, e.device_id, e.uid, e.name
      from codes c
      join public.events e on (e.props->>'acq') like 'clip/%' and split_part(e.props->>'acq', '/', 3) = c.code and e.at >= v_since
  ),
  funnel_claim as (
    select claim_id,
           count(distinct device_id) filter (where name = 'page_view') visits,
           count(distinct device_id) filter (where name in ('album_play', 'music_play', 'song_start', 'music_full_play')) plays,
           count(distinct device_id) filter (where name = 'account_created') signups,
           count(distinct device_id) filter (where name in ('mission_join', 'checkout_go', 'offer_buy_click')) actions,
           count(distinct device_id) filter (where name in ('album_play', 'music_play', 'song_start', 'music_full_play', 'account_created')) converted
      from ev group by claim_id
  ),
  funnel_sub as (
    select submission_id,
           count(distinct device_id) filter (where name = 'page_view') visits,
           count(distinct device_id) filter (where name in ('album_play', 'music_play', 'song_start', 'music_full_play')) plays,
           count(distinct device_id) filter (where name = 'account_created') signups
      from ev where submission_id is not null group by submission_id
  ),
  earn as (
    select claim_id, submission_id, kind, state, sum(amount_cents) cents from public.action_clip_earnings
     where mission_id = p_mission group by claim_id, submission_id, kind, state
  ),
  conv as (
    select claim_id, kind, count(*) filter (where qualified) qualified, count(*) total
      from public.action_clip_conversions where mission_id = p_mission group by claim_id, kind
  ),
  clippers as (
    select k.id, k.m_uid, k.status, k.claimed_at, k.ref_code,
           coalesce((select display_name from public.network_profiles np where np.m_uid = k.m_uid), 'Member') display_name,
           coalesce(sum(s.verified_views), 0) views, coalesce(sum(s.payable_views), 0) payable_views,
           count(s.id) clips,
           coalesce(f.visits, 0) visits, coalesce(f.plays, 0) plays, coalesce(f.signups, 0) signups,
           coalesce(f.actions, 0) actions, coalesce(f.converted, 0) converted
      from public.action_clip_claims k
      left join public.action_clip_submissions s on s.claim_id = k.id and s.status in ('tracking', 'held', 'closed')
      left join funnel_claim f on f.claim_id = k.id
     where k.mission_id = p_mission
     group by k.id, f.visits, f.plays, f.signups, f.actions, f.converted
  )
  select jsonb_build_object(
    'campaign', jsonb_build_object('mission_id', v.mission_id, 'org_id', v.org_id, 'status', v.status, 'status_reason', v.status_reason,
      'title', (select title from public.action_missions where id = p_mission),
      'starts_at', (select starts_at from public.action_missions where id = p_mission),
      'ends_at', (select ends_at from public.action_missions where id = p_mission),
      'platforms', to_jsonb(v.platforms), 'rules', v.rules, 'required_tags', to_jsonb(v.required_tags),
      'base_cpm_cents', v.base_cpm_cents, 'min_views', v.min_views, 'per_clip_cap_cents', v.per_clip_cap_cents,
      'per_clipper_cap_cents', v.per_clipper_cap_cents, 'max_payable_views_per_clip', v.max_payable_views_per_clip,
      'max_clips_per_clipper', v.max_clips_per_clipper, 'earning_window_days', v.earning_window_days,
      'keep_live_days', v.keep_live_days, 'hold_days', v.hold_days, 'bonus_account_cents', v.bonus_account_cents,
      'bonus_listen_cents', v.bonus_listen_cents, 'approval_mode', v.approval_mode, 'budget_exhausted_at', v.budget_exhausted_at,
      'song', (select jsonb_build_object('title', o.track_title, 'key', o.catalog_key, 'url', o.canonical_url)
                 from public.music_catalog_objects o where o.id = v.music_object_id)),
    'money', (select to_jsonb(x) from private.clip_money(p_mission) x),
    'funding', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'delta_cents', f.delta_cents, 'kind', f.kind, 'provider', f.provider,
                                                             'provider_ref', f.provider_ref, 'state', f.state, 'note', f.note, 'at', f.created_at)
                                          order by f.created_at desc), '[]'::jsonb)
                  from public.action_bounty_funding_ledger f where f.clip_mission_id = p_mission),
    'totals', jsonb_build_object(
      'clips', (select count(*) from public.action_clip_submissions where mission_id = p_mission),
      'clips_by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from
                            (select status, count(*) n from public.action_clip_submissions where mission_id = p_mission group by status) x),
      'clippers', (select count(*) from public.action_clip_claims where mission_id = p_mission and status = 'active'),
      'verified_views', (select coalesce(sum(verified_views), 0) from public.action_clip_submissions where mission_id = p_mission and status in ('tracking', 'held', 'closed')),
      'payable_views', (select coalesce(sum(payable_views), 0) from public.action_clip_submissions where mission_id = p_mission and status in ('tracking', 'held', 'closed')),
      'view_earnings_cents', (select coalesce(sum(cents), 0) from earn where kind in ('views', 'reversal') and state <> 'void'),
      'bonus_cents', (select coalesce(sum(cents), 0) from earn where kind like 'bonus_%' and state <> 'void'),
      'visits', (select coalesce(sum(visits), 0) from funnel_claim), 'plays', (select coalesce(sum(plays), 0) from funnel_claim),
      'signups', (select coalesce(sum(signups), 0) from funnel_claim), 'actions', (select coalesce(sum(actions), 0) from funnel_claim),
      'verified_accounts', (select coalesce(sum(qualified), 0) from conv where kind = 'account'),
      'verified_listens', (select coalesce(sum(qualified), 0) from conv where kind = 'listen')),
    'clippers', (select coalesce(jsonb_agg(jsonb_build_object(
        'claim_id', c.id, 'm_uid', c.m_uid, 'name', c.display_name, 'status', c.status, 'ref_code', c.ref_code, 'clips', c.clips,
        'verified_views', c.views, 'payable_views', c.payable_views, 'visits', c.visits, 'plays', c.plays, 'signups', c.signups,
        'actions', c.actions,
        'verified_accounts', coalesce((select qualified from conv where conv.claim_id = c.id and kind = 'account'), 0),
        'verified_listens', coalesce((select qualified from conv where conv.claim_id = c.id and kind = 'listen'), 0),
        'quality', round(private.live_wilson_lower_bound(c.converted, c.visits), 4),
        'conversions_per_1k_views', case when c.views > 0 then round(c.converted::numeric * 1000 / c.views, 3) end,
        'earned_cents', coalesce((select sum(cents) from earn where earn.claim_id = c.id and state <> 'void'), 0),
        'payable_cents', coalesce((select sum(cents) from earn where earn.claim_id = c.id and state = 'payable'), 0),
        'paid_cents', coalesce((select sum(cents) from earn where earn.claim_id = c.id and state = 'paid'), 0))
        order by c.views desc), '[]'::jsonb) from clippers c),
    'clips', (select coalesce(jsonb_agg(jsonb_build_object(
        'submission_id', s.id, 'claim_id', s.claim_id, 'platform', s.platform, 'url', s.submitted_url, 'status', s.status,
        'review_state', s.review_state, 'fraud_flags', to_jsonb(s.fraud_flags), 'hold_reason', s.hold_reason,
        'rejection_reason', s.rejection_reason, 'waiting_reason', s.waiting_reason, 'posted_at', s.posted_at,
        'verified_views', s.verified_views, 'payable_views', s.payable_views, 'earned_view_cents', s.earned_view_cents,
        'moment', (select a.label from public.action_clip_assets a where a.id = s.moment_id),
        'visits', coalesce(fs.visits, 0), 'plays', coalesce(fs.plays, 0), 'signups', coalesce(fs.signups, 0),
        'last_metrics_at', s.last_metrics_at, 'created_at', s.created_at)
        order by s.verified_views desc, s.created_at desc), '[]'::jsonb)
      from public.action_clip_submissions s left join funnel_sub fs on fs.submission_id = s.id where s.mission_id = p_mission),
    'moments', (select coalesce(jsonb_agg(jsonb_build_object('moment_id', a.id, 'label', a.label, 'start_ms', a.start_ms, 'end_ms', a.end_ms,
        'clips', (select count(*) from public.action_clip_submissions s where s.moment_id = a.id),
        'verified_views', (select coalesce(sum(s.verified_views), 0) from public.action_clip_submissions s
                            where s.moment_id = a.id and s.status in ('tracking', 'held', 'closed')))
        order by a.sort), '[]'::jsonb) from public.action_clip_assets a where a.mission_id = p_mission and a.kind = 'moment'),
    'assets', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'label', a.label,
        'asset_id', a.network_media_asset_id, 'start_ms', a.start_ms, 'end_ms', a.end_ms) order by a.sort), '[]'::jsonb)
        from public.action_clip_assets a where a.mission_id = p_mission),
    'payouts', (select coalesce(jsonb_agg(jsonb_build_object('payout_id', p.id, 'm_uid', p.m_uid, 'amount_cents', p.amount_cents,
        'provider', p.provider, 'provider_ref', p.provider_ref, 'recorded_at', p.recorded_at) order by p.recorded_at desc), '[]'::jsonb)
        from public.action_clip_payouts p where p.org_id = v.org_id
          and exists (select 1 from public.action_clip_earnings e where e.payout_id = p.id and e.mission_id = p_mission)))
  into v_out;
  return v_out;
end;
$$;

create or replace function public.clip_my_work()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_muid uuid := public.current_m_uid();
begin
  if (select auth.uid()) is null or v_muid is null then raise exception 'sign in with your M account'; end if;
  return jsonb_build_object(
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('account_id', a.id, 'platform', a.platform, 'handle', a.handle,
        'verified', a.owner_verified_at is not null, 'code', case when a.owner_verified_at is null then a.owner_verification->>'code' end)
        order by a.created_at), '[]'::jsonb) from public.social_accounts a where a.owner_m_uid = v_muid),
    'claims', (select coalesce(jsonb_agg(jsonb_build_object(
        'claim_id', k.id, 'mission_id', k.mission_id, 'title', m.title, 'status', k.status, 'ref_code', k.ref_code,
        'campaign_status', c.status, 'platforms', to_jsonb(c.platforms), 'base_cpm_cents', c.base_cpm_cents, 'min_views', c.min_views,
        'link', (select o.canonical_url from public.music_catalog_objects o where o.id = c.music_object_id),
        'submissions', (select coalesce(jsonb_agg(jsonb_build_object('submission_id', s.id, 'platform', s.platform, 'url', s.submitted_url,
              'status', s.status, 'review_state', s.review_state, 'rejection_reason', s.rejection_reason, 'waiting_reason', s.waiting_reason,
              'hold_reason', case when s.status = 'held' then 'Under review' end, 'ref_code', s.ref_code,
              'verified_views', s.verified_views, 'payable_views', s.payable_views, 'earned_view_cents', s.earned_view_cents,
              'posted_at', s.posted_at, 'created_at', s.created_at) order by s.created_at desc), '[]'::jsonb)
            from public.action_clip_submissions s where s.claim_id = k.id),
        'earnings', (select jsonb_build_object(
              'held_cents', coalesce(sum(amount_cents) filter (where state = 'held'), 0),
              'payable_cents', coalesce(sum(amount_cents) filter (where state = 'payable'), 0),
              'paid_cents', coalesce(sum(amount_cents) filter (where state = 'paid'), 0))
            from public.action_clip_earnings e where e.claim_id = k.id)) order by k.claimed_at desc), '[]'::jsonb)
      from public.action_clip_claims k
      join public.action_clip_campaigns c on c.mission_id = k.mission_id
      join public.action_missions m on m.id = k.mission_id
      where k.m_uid = v_muid),
    'totals', (select jsonb_build_object(
        'held_cents', coalesce(sum(amount_cents) filter (where state = 'held'), 0),
        'payable_cents', coalesce(sum(amount_cents) filter (where state = 'payable'), 0),
        'paid_cents', coalesce(sum(amount_cents) filter (where state = 'paid'), 0))
      from public.action_clip_earnings where m_uid = v_muid),
    'payouts', (select coalesce(jsonb_agg(jsonb_build_object('amount_cents', p.amount_cents, 'provider', p.provider,
        'recorded_at', p.recorded_at) order by p.recorded_at desc), '[]'::jsonb)
      from public.action_clip_payouts p where p.m_uid = v_muid)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Who may call what.
do $$
declare f text;
begin
  -- members and creators (each function checks the caller itself)
  foreach f in array array[
    'public.clip_campaign_create(jsonb)', 'public.clip_campaign_update(uuid, jsonb)',
    'public.clip_campaign_set_status(uuid, text, text)',
    'public.clip_campaign_fund(uuid, bigint, text, text, text, text)', 'public.clip_review_submission(uuid, text, text)',
    'public.clip_record_payout(uuid, uuid, text, text, text)', 'public.clip_campaign_claim(uuid)',
    'public.clip_account_register(text, text)', 'public.clip_account_attach_credential(uuid, text)',
    'public.clip_submit(uuid, text, text, uuid)',
    'public.clip_campaigns_for_org(uuid)', 'public.clip_campaign_dashboard(uuid)', 'public.clip_my_work()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- discovery is public
  execute 'revoke all on function public.clip_campaigns_open(text) from public';
  execute 'grant execute on function public.clip_campaigns_open(text) to anon, authenticated, service_role';
  -- settlement is the Worker's alone
  foreach f in array array[
    'public.clip_settle_submission(uuid)', 'public.clip_work_due(integer)', 'public.clip_record_verification(uuid, jsonb)',
    'public.clip_check_fraud(uuid)', 'public.clip_record_metrics(uuid, jsonb)', 'public.clip_release_due()',
    'public.clip_attribute_conversions(timestamptz)', 'public.clip_account_mark_verified(uuid, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

comment on table public.action_clip_earnings is
  'Clip payout ledger: append-only, server-written. Views come only from platform_api metric snapshots; never past verified funding or budget.';
