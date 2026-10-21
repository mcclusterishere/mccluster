-- THE SONG TEST — "Was this song racist? Why?"
--
-- APPLIED TO PRODUCTION 2026-10-02 as migration 20261002015418_song_test,
-- after a rolled-back run covering signed-out, unheard, no-reason, direct
-- insert, change-of-mind, earned-record and owner-read paths.
--
-- CIA Mind Control is a test as much as an album: after a listener has
-- heard a song all the way through, they answer one question about it,
-- with their reasons. The owner's rules:
--   * only someone the server counted as hearing the whole song answers
--     (a completed row in music_listens; for the earned record, a play
--     the gate granted in music_gated_plays)
--   * after answering, the listener sees how everyone voted on that song
--   * the written reasons are private to the owner
--
-- Which songs carry the test is data (song_tests), so another record can
-- become a test without a deploy.

create table public.song_tests (
  track_key text primary key check (track_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  album text not null,
  label text not null check (char_length(label) between 1 and 120),
  question text not null default 'Was this song racist?',
  gated boolean not null default false,
  sort integer not null default 0,
  active boolean not null default true
);
comment on table public.song_tests is
  'Songs that carry the listening test. label is how public pages name the song; gated songs unlock on a granted play instead of a counted listen.';

create table public.song_verdicts (
  user_id uuid not null references auth.users(id) on delete cascade,
  track_key text not null references public.song_tests(track_key) on delete cascade,
  verdict text not null check (verdict in ('yes','no','unsure')),
  why text not null check (char_length(btrim(why)) between 3 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, track_key)
);
create index song_verdicts_track_idx on public.song_verdicts (track_key, verdict);

alter table public.song_tests enable row level security;
alter table public.song_verdicts enable row level security;

create policy "anyone reads active tests" on public.song_tests
  for select to anon, authenticated using (active or (select public.eu_is_admin()));
create policy "owner writes tests" on public.song_tests
  for all to authenticated
  using ((select public.eu_is_admin())) with check ((select public.eu_is_admin()));
-- a listener reads their own answers; the owner reads every answer
create policy "listeners read their own verdicts" on public.song_verdicts
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.eu_is_admin()));
-- no insert/update policy: answers go through song_test_answer() only

create function public.song_test_heard(p_user uuid, p_track text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when t.gated
    then exists (select 1 from public.music_gated_plays g where g.user_id = p_user and g.track_key = t.track_key)
    else exists (select 1 from public.music_listens l where l.user_id = p_user and l.track_key = t.track_key and l.completed)
  end
  from public.song_tests t where t.track_key = p_track and t.active;
$$;

-- Where the caller stands on every test in an album, in one call.
-- The split is only returned for a song the caller has answered.
create function public.song_test_state(p_album text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'track', t.track_key, 'label', t.label, 'question', t.question, 'gated', t.gated,
    'heard', coalesce(public.song_test_heard(auth.uid(), t.track_key), false),
    'answer', case when v.user_id is null then null
                   else jsonb_build_object('verdict', v.verdict, 'why', v.why) end,
    'split', case when v.user_id is null then null else (
      select jsonb_build_object(
        'yes', count(*) filter (where a.verdict = 'yes'),
        'no', count(*) filter (where a.verdict = 'no'),
        'unsure', count(*) filter (where a.verdict = 'unsure'),
        'total', count(*))
      from public.song_verdicts a where a.track_key = t.track_key) end
  ) order by t.sort, t.track_key), '[]'::jsonb)
  from public.song_tests t
  left join public.song_verdicts v on v.track_key = t.track_key and v.user_id = auth.uid()
  where t.album = p_album and t.active;
$$;

create function public.song_test_answer(p_track text, p_verdict text, p_why text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_album text;
begin
  if v_user is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  select album into v_album from public.song_tests where track_key = p_track and active;
  if v_album is null then
    raise exception 'no test for that song' using errcode = 'P0002';
  end if;
  if not public.song_test_heard(v_user, p_track) then
    raise exception 'hear the whole song first' using errcode = '42501';
  end if;
  if p_verdict is null or p_verdict not in ('yes','no','unsure') then
    raise exception 'answer yes, no or not sure' using errcode = '22023';
  end if;
  if p_why is null or char_length(btrim(p_why)) < 3 then
    raise exception 'say why' using errcode = '22023';
  end if;
  insert into public.song_verdicts (user_id, track_key, verdict, why)
  values (v_user, p_track, p_verdict, left(btrim(p_why), 1000))
  on conflict (user_id, track_key) do update
    set verdict = excluded.verdict, why = excluded.why, updated_at = now();
  return public.song_test_state(v_album);
end;
$$;

revoke all on function public.song_test_heard(uuid, text) from public, anon, authenticated;
revoke all on function public.song_test_state(text) from public, anon;
revoke all on function public.song_test_answer(text, text, text) from public, anon;
grant execute on function public.song_test_state(text) to authenticated;
grant execute on function public.song_test_answer(text, text, text) to authenticated;

insert into public.song_tests (track_key, album, label, gated, sort) values
  ('pull-up', 'cia-mind-control', 'Pull Up', false, 1),
  ('niggy-nigg', 'cia-mind-control', 'The earned track', true, 2),
  ('you-the-feds', 'cia-mind-control', 'You the Feds', false, 3);
