-- PLAY THE ALBUM IN ORDER TO HEAR THE LAST SONG.
--
-- The owner's rule for the closer of an album: it plays only for someone
-- who has just heard the songs before it, in album order, each one all the
-- way through, with nothing else in between. Every play needs a fresh run.
-- "All the way through" is the existing ledger's judgement (music_listen_*:
-- real playing time, beats capped at 20 seconds, one open listen at a time),
-- so skipping, scrubbing or double speed breaks the run.
--
-- progress = how many songs of the sequence the listener's most recent
-- finished listens complete, in order, ending now. A skipped or
-- out-of-order song resets it. allowed = the whole sequence, finished within
-- the window, since the last play of the closer.
create or replace function public.music_gate_sequence_state(p_user uuid, p_track text, p_sequence text[], p_window_minutes integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n integer := coalesce(array_length(p_sequence, 1), 0);
  v_last_play timestamptz;
  v_plays integer;
  v_keys text[];
  v_done boolean[];
  v_newest timestamptz;
  v_progress integer := 0;
  k integer;
  i integer;
  v_ok boolean;
begin
  select max(played_at), count(*) into v_last_play, v_plays
    from public.music_gated_plays where user_id = p_user and track_key = p_track;
  -- newest first: the listener's finished listens since the closer last played
  select array_agg(track_key order by started_at desc), array_agg(completed order by started_at desc), max(finished_at)
    into v_keys, v_done, v_newest
    from (select track_key, completed, started_at, finished_at
            from public.music_listens
           where user_id = p_user and finished_at is not null and track_key <> p_track
             and (v_last_play is null or started_at > v_last_play)
           order by started_at desc
           limit greatest(v_n, 1)) recent;
  -- the longest start of the sequence that the most recent listens finish
  for k in reverse v_n..1 loop
    v_ok := coalesce(array_length(v_keys, 1), 0) >= k;
    if v_ok then
      for i in 1..k loop
        -- the i-th song of the run is the (k - i + 1)-th newest listen
        if v_keys[k - i + 1] is distinct from p_sequence[i] or not coalesce(v_done[k - i + 1], false) then
          v_ok := false; exit;
        end if;
      end loop;
    end if;
    if v_ok then v_progress := k; exit; end if;
  end loop;
  return jsonb_build_object(
    'mode', 'sequence',
    'sequence', to_jsonb(p_sequence),
    'progress', v_progress,
    'need', v_n,
    'next', case when v_progress < v_n then p_sequence[v_progress + 1] end,
    'plays', v_plays,
    'last_play_at', v_last_play,
    'allowed', v_n > 0 and v_progress = v_n and v_newest > now() - make_interval(mins => p_window_minutes)
  );
end;
$$;

create or replace function public.music_gate_claim_sequence(p_user uuid, p_track text, p_sequence text[], p_window_minutes integer,
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
  -- two taps at once must not both spend the same run of the album
  perform pg_advisory_xact_lock(hashtextextended('music_gate:' || p_user::text || ':' || p_track, 0));
  v_state := public.music_gate_sequence_state(p_user, p_track, p_sequence, p_window_minutes);
  if not (v_state->>'allowed')::boolean then
    return v_state || jsonb_build_object('claimed', false);
  end if;
  insert into public.music_gated_plays (user_id, track_key, stream_token, stream_expires_at)
  values (p_user, p_track, p_token, now() + make_interval(secs => p_stream_seconds))
  returning id into v_play;
  return public.music_gate_sequence_state(p_user, p_track, p_sequence, p_window_minutes)
         || jsonb_build_object('claimed', true, 'play_id', v_play);
end;
$$;

revoke all on function public.music_gate_sequence_state(uuid, text, text[], integer) from public, anon, authenticated;
revoke all on function public.music_gate_claim_sequence(uuid, text, text[], integer, text, integer) from public, anon, authenticated;
grant execute on function public.music_gate_sequence_state(uuid, text, text[], integer) to service_role;
grant execute on function public.music_gate_claim_sequence(uuid, text, text[], integer, text, integer) to service_role;
