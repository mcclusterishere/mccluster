-- A RECORD YOU EARN, HARDENED (review of music_listen_gate).
--
-- 1. A listen counts on time actually played, not time since it started.
--    Players send a beat every ~15 seconds while the song is playing; each
--    beat (and the finish) credits the real time since the last one, capped
--    at 20 seconds, so a paused song earns nothing beyond one short gap.
-- 2. Starting a song takes a per-listener lock, and a unique index allows
--    only one open listen per listener, so two simultaneous starts cannot
--    leave two listens running.
-- 3. An earned play no longer hands out a storage URL. The Worker streams
--    the master itself against a one-play token that expires after a few
--    minutes and answers only a handful of requests.

alter table public.music_listens
  add column heard_seconds numeric not null default 0,
  add column last_beat_at timestamptz;
update public.music_listens set last_beat_at = coalesce(finished_at, started_at) where last_beat_at is null;
alter table public.music_listens
  alter column last_beat_at set default now(),
  alter column last_beat_at set not null;

create unique index music_listens_one_open_idx
  on public.music_listens (user_id) where finished_at is null;
drop index if exists public.music_listens_open_idx;

alter table public.music_gated_plays
  add column stream_token text unique,
  add column stream_expires_at timestamptz,
  add column stream_hits integer not null default 0;

create or replace function public.music_listen_start(p_user uuid, p_track text, p_min_seconds integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('music_listen:' || p_user::text, 0));
  update public.music_listens
     set finished_at = now(), completed = false
   where user_id = p_user and finished_at is null;
  insert into public.music_listens (user_id, track_key, min_seconds)
  values (p_user, p_track, p_min_seconds)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.music_listen_beat(p_user uuid, p_listen uuid)
returns numeric
language sql
security definer
set search_path = ''
as $$
  update public.music_listens
     set heard_seconds = heard_seconds + least(extract(epoch from now() - last_beat_at), 20),
         last_beat_at = now()
   where id = p_listen and user_id = p_user and finished_at is null
  returning heard_seconds;
$$;

create or replace function public.music_listen_finish(p_user uuid, p_listen uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.music_listens
     set heard_seconds = heard_seconds + least(extract(epoch from now() - last_beat_at), 20),
         last_beat_at = now(),
         finished_at = now(),
         completed = heard_seconds + least(extract(epoch from now() - last_beat_at), 20) >= min_seconds
   where id = p_listen and user_id = p_user and finished_at is null
  returning completed;
$$;

drop function public.music_gate_claim(uuid, text, integer, integer);
create function public.music_gate_claim(p_user uuid, p_track text, p_first integer, p_each integer,
                                        p_token text, p_stream_seconds integer)
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
  insert into public.music_gated_plays (user_id, track_key, stream_token, stream_expires_at)
  values (p_user, p_track, p_token, now() + make_interval(secs => p_stream_seconds))
  returning id into v_play;
  return public.music_gate_state(p_user, p_track, p_first, p_each)
         || jsonb_build_object('claimed', true, 'play_id', v_play);
end;
$$;

-- One request against a play's stream token. Returns the track only while
-- the token is fresh and under its request allowance.
create function public.music_stream_open(p_token text, p_max_hits integer)
returns text
language sql
security definer
set search_path = ''
as $$
  update public.music_gated_plays
     set stream_hits = stream_hits + 1
   where stream_token = p_token
     and stream_expires_at > now()
     and stream_hits < p_max_hits
  returning track_key;
$$;

revoke all on function public.music_listen_start(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.music_listen_beat(uuid, uuid) from public, anon, authenticated;
revoke all on function public.music_listen_finish(uuid, uuid) from public, anon, authenticated;
revoke all on function public.music_gate_claim(uuid, text, integer, integer, text, integer) from public, anon, authenticated;
revoke all on function public.music_stream_open(text, integer) from public, anon, authenticated;
grant execute on function public.music_listen_start(uuid, text, integer) to service_role;
grant execute on function public.music_listen_beat(uuid, uuid) to service_role;
grant execute on function public.music_listen_finish(uuid, uuid) to service_role;
grant execute on function public.music_gate_claim(uuid, text, integer, integer, text, integer) to service_role;
grant execute on function public.music_stream_open(text, integer) to service_role;
