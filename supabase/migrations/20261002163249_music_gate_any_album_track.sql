-- CIA MIND CONTROL: ONE QUALIFYING ALBUM LISTEN UNLOCKS THE CLOSER.
--
-- The gated track cannot be played cold. A completed listen to any explicitly
-- eligible track earns one play. After the gated track is played, another
-- eligible completed listen is required before it can be earned again.
create or replace function public.music_gate_any_state(p_user uuid, p_track text, p_eligible text[])
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
  ), heard as (
    select l.track_key, l.finished_at
      from public.music_listens l, last_play lp
     where l.user_id = p_user
       and l.completed
       and l.track_key = any(p_eligible)
       and (lp.at is null or l.finished_at > lp.at)
     order by l.finished_at desc
     limit 1
  )
  select jsonb_build_object(
    'mode', 'any',
    'eligible', to_jsonb(p_eligible),
    'need', 1,
    'progress', case when exists(select 1 from heard) then 1 else 0 end,
    'heard', (select track_key from heard limit 1),
    'plays', lp.plays,
    'last_play_at', lp.at,
    'allowed', exists(select 1 from heard)
  )
  from last_play lp;
$$;

create or replace function public.music_gate_claim_any(p_user uuid, p_track text, p_eligible text[],
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
  perform pg_advisory_xact_lock(hashtextextended('music_gate:' || p_user::text || ':' || p_track, 0));
  v_state := public.music_gate_any_state(p_user, p_track, p_eligible);
  if not (v_state->>'allowed')::boolean then
    return v_state || jsonb_build_object('claimed', false);
  end if;
  insert into public.music_gated_plays (user_id, track_key, stream_token, stream_expires_at)
  values (p_user, p_track, p_token, now() + make_interval(secs => p_stream_seconds))
  returning id into v_play;
  return public.music_gate_any_state(p_user, p_track, p_eligible)
         || jsonb_build_object('claimed', true, 'play_id', v_play);
end;
$$;

revoke all on function public.music_gate_any_state(uuid, text, text[]) from public, anon, authenticated;
revoke all on function public.music_gate_claim_any(uuid, text, text[], text, integer) from public, anon, authenticated;
grant execute on function public.music_gate_any_state(uuid, text, text[]) to service_role;
grant execute on function public.music_gate_claim_any(uuid, text, text[], text, integer) to service_role;
