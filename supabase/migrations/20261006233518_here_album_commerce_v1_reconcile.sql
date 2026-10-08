-- Production reconciliation for the HERE album commerce migration.
-- The original 20261006213626 migration existed in source/ledger but was not present
-- in Supabase migration history. Applied to production as 20261006233518.
-- I AM HERE commerce + artist-custom player v1.
-- Canonical nomenclature: music_video / music_video_url. Legacy "video" readers
-- may remain temporarily for backward compatibility, but new writes use the
-- music-video vocabulary.
--
-- This migration extends existing music identity/track tables; it does not
-- create a second creator/account model.

alter table public.creator_tracks
  add column if not exists music_video_url text not null default '',
  add column if not exists lyrics_url text not null default '',
  add column if not exists experience jsonb not null default '{}'::jsonb;

alter table public.music_catalog_objects
  add column if not exists music_video_url text not null default '',
  add column if not exists lyrics_url text not null default '',
  add column if not exists experience jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.creator_tracks add constraint creator_tracks_music_video_url_len
    check (char_length(music_video_url) <= 2000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.creator_tracks add constraint creator_tracks_lyrics_url_len
    check (char_length(lyrics_url) <= 2000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.creator_tracks add constraint creator_tracks_experience_object
    check (jsonb_typeof(experience) = 'object');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.music_catalog_objects add constraint music_catalog_objects_music_video_url_len
    check (char_length(music_video_url) <= 2000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.music_catalog_objects add constraint music_catalog_objects_lyrics_url_len
    check (char_length(lyrics_url) <= 2000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.music_catalog_objects add constraint music_catalog_objects_experience_object
    check (jsonb_typeof(experience) = 'object');
exception when duplicate_object then null; end $$;

insert into public.event_taxonomy(event_name,stage,note) values
  ('music_videos_view','view','The canonical Music Videos catalog surface was opened.'),
  ('music_videos_armed','engage','A visitor explicitly enabled audio on the Music Videos surface.'),
  ('music_video_view','view','A canonical music-video surface was opened for a track.'),
  ('music_video_share','engage','A visitor shared a canonical music-video track state.'),
  ('lyric_service_cta_view','view','A service-linked lyric phrase became visible.'),
  ('lyric_service_cta_click','engage','A visitor followed a service link embedded in a lyric phrase.'),
  ('track_service_cta_click','engage','A visitor followed the track-level primary service call to action.'),
  ('player_theme_applied','engage','A track/artist experience theme was applied to the player.')
on conflict(event_name) do update set stage=excluded.stage,note=excluded.note;

update public.music_catalog_objects
set
  music_video_url='assets/video/hero.mp4',
  lyrics_url='data/lyrics/who-did-the-shoot.json',
  experience='{
    "theme":{"accent":"#e5383b","background":"#090706","foreground":"#f4efe6","surface":"#17110f"},
    "commerce":{"offer_id":"who-did-the-shoot","label":"Book a shoot","href":"onboard.html?offer=who-did-the-shoot"},
    "lyric_ctas":[
      {"match":"Pay the fee","label":"Book the shoot","href":"onboard.html?offer=who-did-the-shoot","offer_id":"who-did-the-shoot"},
      {"match":"Deposit lock the day in","label":"Lock a shoot date","href":"onboard.html?offer=who-did-the-shoot","offer_id":"who-did-the-shoot"},
      {"match":"the content so engaging","label":"Get content made","href":"onboard.html?offer=who-did-the-shoot","offer_id":"who-did-the-shoot"},
      {"match":"lights, camera, action","label":"Book production","href":"onboard.html?offer=who-did-the-shoot","offer_id":"who-did-the-shoot"},
      {"match":"connect with us","label":"Connect with the studio","href":"onboard.html?offer=who-did-the-shoot","offer_id":"who-did-the-shoot"}
    ]
  }'::jsonb,
  updated_at=now()
where catalog_key='here:who-did-the-shoot';

update public.music_catalog_objects
set
  music_video_url='assets/video/vauntlive.mp4',
  lyrics_url='',
  experience='{
    "theme":{"accent":"#ff5a5c","background":"#0b0809","foreground":"#fff4ef","surface":"#1b0f12"},
    "commerce":{"offer_id":"runway","label":"Get your website live","href":"onboard.html?offer=runway"},
    "lyric_ctas":[]
  }'::jsonb,
  updated_at=now()
where catalog_key='here:runway-walk';

update public.music_catalog_objects
set
  music_video_url='assets/video/studio360.mp4',
  lyrics_url='',
  experience='{
    "theme":{"accent":"#c1121f","background":"#090708","foreground":"#fff4ef","surface":"#190c0e"},
    "commerce":{"offer_id":"write-a-song","label":"Start a song campaign","href":"onboard.html?offer=write-a-song"},
    "lyric_ctas":[]
  }'::jsonb,
  updated_at=now()
where catalog_key='here:write-a-song';

update public.music_catalog_objects
set
  music_video_url='assets/video/keynote.mp4',
  lyrics_url='',
  experience='{
    "theme":{"accent":"#ff3040","background":"#080708","foreground":"#fff6ef","surface":"#170c10"},
    "commerce":{"offer_id":"runway","label":"Build your own front door","href":"onboard.html?offer=runway"},
    "lyric_ctas":[]
  }'::jsonb,
  updated_at=now()
where catalog_key='here:here';

update public.music_catalog_objects
set
  music_video_url='assets/video/nightscroll.mp4',
  lyrics_url='data/lyrics/antisocial.json',
  experience='{
    "theme":{"accent":"#8f0f16","background":"#060708","foreground":"#f8f3ef","surface":"#111217"},
    "commerce":{"offer_id":"anti-social","label":"Get your presence managed","href":"onboard.html?offer=anti-social"},
    "lyric_ctas":[
      {"match":"I can help you get more conversions than the Pope did","label":"Get conversion help","href":"onboard.html?offer=anti-social","offer_id":"anti-social"},
      {"match":"That''s why I offer coaching to get you back focused","label":"Get focused","href":"onboard.html?offer=anti-social","offer_id":"anti-social"},
      {"match":"write a note below this","label":"Start the conversation","href":"onboard.html?offer=anti-social","offer_id":"anti-social"},
      {"match":"After a consultation","label":"Book the consultation","href":"onboard.html?offer=anti-social","offer_id":"anti-social"},
      {"match":"Profile optimization","label":"Optimize your presence","href":"onboard.html?offer=social","offer_id":"social"},
      {"match":"make content, make it","label":"Get content moving","href":"onboard.html?offer=social","offer_id":"social"}
    ]
  }'::jsonb,
  updated_at=now()
where catalog_key='here:antisocial';

update public.music_catalog_objects
set
  music_video_url='assets/video/editors.mp4',
  lyrics_url='',
  experience='{
    "theme":{"accent":"#f0453f","background":"#08090a","foreground":"#f5f4f0","surface":"#121417"},
    "commerce":{"offer_id":"who-did-the-shoot","label":"Book photography + video","href":"onboard.html?offer=who-did-the-shoot"},
    "lyric_ctas":[]
  }'::jsonb,
  updated_at=now()
where catalog_key='here:lightroom';

comment on column public.creator_tracks.music_video_url is
  'Canonical public music-video URL for the track. Do not introduce new film/video naming for this music surface.';
comment on column public.creator_tracks.experience is
  'Artist-configurable presentation + commerce metadata: theme, primary commerce CTA, lyric_ctas.';
comment on column public.music_catalog_objects.experience is
  'House/catalog presentation + commerce metadata using the same contract as creator_tracks.experience.';
