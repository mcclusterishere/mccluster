-- THE FASHION BUREAU OF INVESTIGATION (FBI): the fun front of Be Authentic.
--
-- Three kinds of case file, all about what somebody is wearing, never about
-- who they are:
--   legit_check  - "check my kicks": your own pair, the community votes Legit or Cap
--   sighting     - a fake spotted in the wild: the shoe, not the person
--   most_wanted  - a fashion crime (socks with slides, a fit that broke the law)
--
-- The rules that keep it funny instead of cruel, enforced here and by the
-- owner's review:
--   * nothing is public until the owner approves it (status 'pending');
--   * no faces and no names: the reporter attests the photos show the item or
--     the fit only, unless the case is a self-surrender ("turn yourself in"),
--     where you are the subject and you chose to be;
--   * a city at most, never an address or a place a person could be found;
--   * three reports pull a public case back into review automatically;
--   * votes earn nothing: no points, no rewards, no leaderboard of voters.
--
-- Everything goes through the Worker with the service role. Members have no
-- direct access to these tables.
create table if not exists public.fbi_cases (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('legit_check', 'sighting', 'most_wanted')),
  reporter_m_uid uuid not null references public.m_people(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 80),
  details text not null default '' check (char_length(details) <= 500),
  item text not null default '' check (char_length(item) <= 80),
  charge text not null default '' check (char_length(charge) <= 80),
  city text not null default '' check (char_length(city) <= 40),
  media_asset_ids uuid[] not null check (cardinality(media_asset_ids) between 1 and 4),
  self_surrender boolean not null default false,
  no_faces_attested boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'public', 'removed')),
  removal_reason text check (removal_reason is null or char_length(removal_reason) <= 300),
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  -- a self-surrender may show you; anything else must not show anybody
  constraint fbi_cases_no_faces check (self_surrender or no_faces_attested),
  -- only a Most Wanted case can be a self-surrender
  constraint fbi_cases_surrender_kind check (not self_surrender or kind = 'most_wanted')
);
create index if not exists fbi_cases_board_idx on public.fbi_cases (status, kind, published_at desc);
create index if not exists fbi_cases_reporter_idx on public.fbi_cases (reporter_m_uid, created_at desc);

create table if not exists public.fbi_votes (
  case_id uuid not null references public.fbi_cases(id) on delete cascade,
  m_uid uuid not null references public.m_people(id) on delete cascade,
  vote text not null check (vote in ('legit', 'cap', 'guilty', 'acquitted')),
  created_at timestamptz not null default now(),
  primary key (case_id, m_uid)
);

create table if not exists public.fbi_reports (
  case_id uuid not null references public.fbi_cases(id) on delete cascade,
  m_uid uuid not null references public.m_people(id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 300),
  created_at timestamptz not null default now(),
  primary key (case_id, m_uid)
);

alter table public.fbi_cases enable row level security;
alter table public.fbi_votes enable row level security;
alter table public.fbi_reports enable row level security;
revoke all on table public.fbi_cases, public.fbi_votes, public.fbi_reports from public, anon, authenticated;
grant all on table public.fbi_cases, public.fbi_votes, public.fbi_reports to service_role;

-- PACE: two new actions on the network's own limits (network_rate_limits_v2).
create or replace function public.network_rate_take(p_m_uid uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new boolean;
  v_min integer; v_hour integer; v_day integer;
  v_cap_min integer; v_cap_hour integer; v_cap_day integer;
  v_noun text;
  n_min integer; n_hour integer; n_day integer;
begin
  if p_m_uid is null or public.network_rate_exempt(p_m_uid) then return; end if;
  v_new := coalesce((select created_at > now() - interval '24 hours' from public.m_people where id = p_m_uid), false);
  select case when v_new then l.new_min else l.per_min end,
         case when v_new then l.new_hour else l.per_hour end,
         case when v_new then l.new_day else l.per_day end,
         l.noun
    into v_cap_min, v_cap_hour, v_cap_day, v_noun
    from (values
      ('post',          6,  25,   50,  2,   5,  10, 'posts'),
      ('reply',        20, 100,  200,  5,  20,  50, 'replies'),
      ('message',      20, 100,  500,  5,  20,  50, 'messages'),
      ('conversation',  5,  20,   50,  1,   3,  10, 'new conversations'),
      ('follow',       20, 100,  400,  5,  20,  50, 'follows'),
      ('reaction',     60, 500, 1000, 20, 100, 200, 'likes'),
      ('report',        5,  10,   50,  2,   5,  10, 'reports'),
      ('fbi_case',      2,   5,   10,  1,   2,   3, 'case files'),
      ('fbi_vote',     30, 200,  500, 10,  50, 100, 'votes')
    ) as l(action, per_min, per_hour, per_day, new_min, new_hour, new_day, noun)
   where l.action = p_action;
  if v_noun is null then raise exception 'unknown rate action %', p_action; end if;
  -- one count at a time per member and action, so parallel requests cannot
  -- all read the same count and all pass
  perform pg_advisory_xact_lock(hashtextextended('network_rate:' || p_m_uid::text || ':' || p_action, 0));
  select count(*) filter (where at > now() - interval '1 minute'),
         count(*) filter (where at > now() - interval '1 hour'),
         count(*)
    into n_min, n_hour, n_day
    from public.network_rate_events
   where m_uid = p_m_uid and action = p_action and at > now() - interval '24 hours';
  if n_day >= v_cap_day then
    raise exception 'That is the limit for today: % % a day%.', v_cap_day, v_noun,
      case when v_new then ' while your account is new' else '' end using errcode = 'MN429';
  elsif n_hour >= v_cap_hour then
    raise exception 'That is the limit for this hour: % % an hour. Try again later.', v_cap_hour, v_noun using errcode = 'MN429';
  elsif n_min >= v_cap_min then
    raise exception 'Slow down. Give it a minute.' using errcode = 'MN429';
  end if;
  insert into public.network_rate_events (m_uid, action) values (p_m_uid, p_action);
end;
$$;
revoke all on function public.network_rate_take(uuid, text) from public, anon, authenticated;

create or replace function public.fbi_cases_limits()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.network_rate_take(new.reporter_m_uid, 'fbi_case');
  return new;
end;
$$;
revoke all on function public.fbi_cases_limits() from public, anon, authenticated;
create or replace trigger fbi_cases_limits_trg
  before insert on public.fbi_cases
  for each row execute function public.fbi_cases_limits();

-- A vote matches its case: Legit or Cap on a check or a sighting, Guilty or
-- Acquitted on a Most Wanted. Votes count only on public cases, and only
-- the first vote on a case takes from the pace limit, not every change.
create or replace function public.fbi_votes_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_status text;
begin
  select kind, status into v_kind, v_status from public.fbi_cases where id = new.case_id;
  if v_status is distinct from 'public' then
    raise exception 'That case is not open for votes.' using errcode = 'MN409';
  end if;
  if (v_kind = 'most_wanted') <> (new.vote in ('guilty', 'acquitted')) then
    raise exception 'That vote does not fit this case.' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then perform public.network_rate_take(new.m_uid, 'fbi_vote'); end if;
  return new;
end;
$$;
revoke all on function public.fbi_votes_guard() from public, anon, authenticated;
create or replace trigger fbi_votes_guard_trg
  before insert or update of vote on public.fbi_votes
  for each row execute function public.fbi_votes_guard();

-- Three reports send a public case back to the owner.
create or replace function public.fbi_reports_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.network_rate_take(new.m_uid, 'report');
  if (select count(*) from public.fbi_reports where case_id = new.case_id) >= 3 then
    update public.fbi_cases set status = 'pending', reviewed_at = null
     where id = new.case_id and status = 'public';
  end if;
  return new;
end;
$$;
revoke all on function public.fbi_reports_after() from public, anon, authenticated;
create or replace trigger fbi_reports_after_trg
  after insert on public.fbi_reports
  for each row execute function public.fbi_reports_after();

-- The board, with tallies, for the Worker to read in one call.
create or replace view public.fbi_board
with (security_invoker = true) as
select c.id, c.kind, c.title, c.details, c.item, c.charge, c.city, c.media_asset_ids,
       c.self_surrender, c.published_at,
       count(v.*) filter (where v.vote = 'legit') as legit,
       count(v.*) filter (where v.vote = 'cap') as cap,
       count(v.*) filter (where v.vote = 'guilty') as guilty,
       count(v.*) filter (where v.vote = 'acquitted') as acquitted
  from public.fbi_cases c
  left join public.fbi_votes v on v.case_id = c.id
 where c.status = 'public'
 group by c.id;
revoke all on public.fbi_board from public, anon, authenticated;
grant select on public.fbi_board to service_role;
