\set ON_ERROR_STOP on
begin;
set local role anon;
do $$ declare n int; begin
  select count(*) into n from public.creator_tracks; raise notice 'creator_tracks anon=%', n;
  if n <> 1 then raise exception 'anon should see 1 published track'; end if;
  select count(*) into n from public.music_creator_profiles; if n <> 1 then raise exception 'profiles'; end if;
  select count(*) into n from public.network_profiles; if n <> 1 then raise exception 'anon sees only public profiles'; end if;
  select count(*) into n from public.network_posts; if n <> 1 then raise exception 'posts'; end if;
  select count(*) into n from public.network_activity; select count(*) into n from public.music_license_offers;
  select count(*) into n from public.network_follows; if n <> 0 then raise exception 'anon follows'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
do $$ declare n int; begin
  select count(*) into n from public.creator_tracks; if n <> 1 then raise exception 'member sees published'; end if;
  select count(*) into n from public.network_follows;
end $$;
reset role;
-- music reads
insert into public.events_lean (name, track, device_id, session_id) select 'album_play', t, 'd' || g % 5, 's' || g % 7 from generate_series(1, 60) g, unnest(array['pull up','you the feds','niggy nigg niggr']) t;
insert into public.events_lean (name, track, device_id) values ('rotation_add', 'pull up', 'd1'), ('rotation_add', 'pull up', 'd2');
do $$ declare r record; n int := 0; begin
  for r in select * from public.play_counts() loop n := n + 1; end loop;
  if n <> 3 then raise exception 'play_counts rows %', n; end if;
  select count(*) into n from public.v_track_signals; if n <> 3 then raise exception 'signals %', n; end if;
  select count(*) into n from public.v_track_affinity; if n = 0 then raise exception 'affinity empty'; end if;
end $$;
-- listener state: own row only
insert into auth.users values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
insert into public.listener_state (profile_id, state) values ('11111111-1111-4111-8111-111111111111', '{"src":"a.mp3","t":12}')
  on conflict (profile_id) do update set state = excluded.state;
do $$ begin
  begin
    insert into public.listener_state (profile_id, state) values ('22222222-2222-4222-8222-222222222222', '{}');
    raise exception 'wrote someone else''s row';
  exception when insufficient_privilege or check_violation then null;
    when others then if sqlerrm like '%row-level security%' then null; else raise; end if;
  end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.listener_state; raise exception 'anon read listener_state';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin raise notice 'journey migrations: all assertions passed'; end $$;
rollback;
