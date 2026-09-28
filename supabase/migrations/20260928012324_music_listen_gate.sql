-- A RECORD YOU EARN.
--
-- The owner's rule for one gated record: an account, then five different
-- other songs heard all the way through, then ONE play. Every play after
-- that costs one more full song. The master already sits in the private
-- bucket mcc-gated-audio; until now any signed-in browser could sign its
-- own URL for it (with any lifetime it liked), so no count could hold.
--
-- After this migration:
--   * only the API Worker (service role) writes listens and gated plays;
--   * a listen counts only if the server saw it start and saw it end with
--     at least min_seconds of real time in between (the Worker sets that
--     from the song's measured length), so skipping to the end or playing
--     at double speed does not count;
--   * one listen is open per listener at a time: starting a song closes
--     the last one unfinished, so songs cannot be "heard" in parallel;
--   * the bucket is no longer readable by every signed-in account. The
--     Worker signs one short-lived URL per play it has granted.

create table public.music_listens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  track_key text not null check (track_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  started_at timestamptz not null default now(),
  min_seconds integer not null check (min_seconds between 1 and 3600),
  finished_at timestamptz,
  completed boolean not null default false
);
comment on table public.music_listens is
  'One row per song start by a signed-in listener, written only by the API Worker. completed = the server saw the song end with at least min_seconds of real time since it started.';

create index music_listens_completed_idx
  on public.music_listens (user_id, finished_at) where completed;
create index music_listens_open_idx
  on public.music_listens (user_id) where finished_at is null;

create table public.music_gated_plays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  track_key text not null check (track_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  played_at timestamptz not null default now()
);
comment on table public.music_gated_plays is
  'One row per play of a gated record granted by the API Worker. Each row is one play.';

create index music_gated_plays_user_idx
  on public.music_gated_plays (user_id, track_key, played_at desc);

alter table public.music_listens enable row level security;
alter table public.music_gated_plays enable row level security;

-- Listeners may read their own ledger. Nobody but the service role writes.
create policy "listeners read their own listens" on public.music_listens
  for select to authenticated using (user_id = (select auth.uid()));
create policy "listeners read their own gated plays" on public.music_gated_plays
  for select to authenticated using (user_id = (select auth.uid()));

create function public.music_listen_start(p_user uuid, p_track text, p_min_seconds integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- One open listen at a time: a new start closes the last one unheard.
  update public.music_listens
     set finished_at = now(), completed = false
   where user_id = p_user and finished_at is null;
  insert into public.music_listens (user_id, track_key, min_seconds)
  values (p_user, p_track, p_min_seconds)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.music_listen_finish(p_user uuid, p_listen uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.music_listens
     set finished_at = now(),
         completed = now() - started_at >= make_interval(secs => min_seconds)
   where id = p_listen and user_id = p_user and finished_at is null
  returning completed;
$$;

create function public.music_gate_state(p_user uuid, p_track text, p_first integer, p_each integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with last_play as (
    select max(played_at) as at, count(*) as plays
      from public.music_gated_plays
     where user_id = p_user and track_key = p_track
  ), done as (
    select count(distinct l.track_key) as distinct_songs,
           count(*) filter (where lp.at is null or l.finished_at > lp.at) as since_last
      from public.music_listens l, last_play lp
     where l.user_id = p_user and l.completed and l.track_key <> p_track
  )
  select jsonb_build_object(
    'distinct_songs', d.distinct_songs,
    'need_first', p_first,
    'since_last_play', case when lp.at is null then null else d.since_last end,
    'need_each', p_each,
    'plays', lp.plays,
    'last_play_at', lp.at,
    'allowed', d.distinct_songs >= p_first and (lp.at is null or d.since_last >= p_each)
  )
  from done d, last_play lp;
$$;

create function public.music_gate_claim(p_user uuid, p_track text, p_first integer, p_each integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state jsonb;
  v_play uuid;
begin
  -- Two taps at once must not both spend the same earned play.
  perform pg_advisory_xact_lock(hashtextextended('music_gate:' || p_user::text || ':' || p_track, 0));
  v_state := public.music_gate_state(p_user, p_track, p_first, p_each);
  if not (v_state->>'allowed')::boolean then
    return v_state || jsonb_build_object('claimed', false);
  end if;
  insert into public.music_gated_plays (user_id, track_key)
  values (p_user, p_track)
  returning id into v_play;
  return public.music_gate_state(p_user, p_track, p_first, p_each)
         || jsonb_build_object('claimed', true, 'play_id', v_play);
end;
$$;

revoke all on function public.music_listen_start(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.music_listen_finish(uuid, uuid) from public, anon, authenticated;
revoke all on function public.music_gate_state(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.music_gate_claim(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.music_listen_start(uuid, text, integer) to service_role;
grant execute on function public.music_listen_finish(uuid, uuid) to service_role;
grant execute on function public.music_gate_state(uuid, text, integer, integer) to service_role;
grant execute on function public.music_gate_claim(uuid, text, integer, integer) to service_role;

-- The bucket stops being readable by every signed-in account. The API
-- Worker signs with the service role, one short-lived URL per granted play.
drop policy if exists "gated audio is readable by signed-in listeners" on storage.objects;
