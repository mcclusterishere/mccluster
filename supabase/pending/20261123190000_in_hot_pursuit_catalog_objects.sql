-- Shared music-platform support used by Equity Uprise; no building capability is added.
-- In Hot Pursuit by Benji Chase, added to the shelf 2026-11-23 with the owner's cover: its shelf songs become live
-- discovery objects like every other shelf song (supabase/migrations/20261003233747_action_network_live_governance_v1.sql).
-- PENDING: apply with the release of data/albums.json that adds them.
-- Rollback: 20261123190000_in_hot_pursuit_catalog_objects.rollback.sql
insert into public.music_catalog_objects(catalog_key,album_slug,album_title,track_title,artist_name,credit_line,audio_path,artwork_path,canonical_url,source_kind,status)
values ('in-hot-pursuit:hitshake','in-hot-pursuit','In Hot Pursuit','HitShake','Benji Chase','','assets/audio/hitshake.m4a','assets/img/in-hot-pursuit-cover.jpg','https://matthew.mccluster.org/album.html?album=in-hot-pursuit&t=HitShake','site_catalog','active'),
('in-hot-pursuit:hitlist','in-hot-pursuit','In Hot Pursuit','Hitlist','Benji Chase','','assets/audio/hitlist.mp3','assets/img/in-hot-pursuit-cover.jpg','https://matthew.mccluster.org/album.html?album=in-hot-pursuit&t=Hitlist','site_catalog','active'),
('in-hot-pursuit:hit-mode','in-hot-pursuit','In Hot Pursuit','Hit Mode','Benji Chase','','assets/audio/hit-mode.m4a','assets/img/in-hot-pursuit-cover.jpg','https://matthew.mccluster.org/album.html?album=in-hot-pursuit&t=Hit%20Mode','site_catalog','active'),
('in-hot-pursuit:see-me-up','in-hot-pursuit','In Hot Pursuit','See Me Up','Benji Chase','','assets/audio/see-me-up.mp3','assets/img/in-hot-pursuit-cover.jpg','https://matthew.mccluster.org/album.html?album=in-hot-pursuit&t=See%20Me%20Up','site_catalog','active'),
('in-hot-pursuit:other-side','in-hot-pursuit','In Hot Pursuit','Other Side','Benji Chase','','assets/audio/other-side.mp3','assets/img/in-hot-pursuit-cover.jpg','https://matthew.mccluster.org/album.html?album=in-hot-pursuit&t=Other%20Side','site_catalog','active'),
('in-hot-pursuit:new-phone','in-hot-pursuit','In Hot Pursuit','New Phone','Benji Chase','','assets/audio/new-phone.mp3','assets/img/in-hot-pursuit-cover.jpg','https://matthew.mccluster.org/album.html?album=in-hot-pursuit&t=New%20Phone','site_catalog','active'),
('in-hot-pursuit:block-so-hot','in-hot-pursuit','In Hot Pursuit','Block So Hot','Benji Chase','','assets/audio/block-so-hot.mp3','assets/img/in-hot-pursuit-cover.jpg','https://matthew.mccluster.org/album.html?album=in-hot-pursuit&t=Block%20So%20Hot','site_catalog','active'),
('in-hot-pursuit:up-for-days','in-hot-pursuit','In Hot Pursuit','Up For Days','Benji Chase','','assets/audio/up-for-days.mp3','assets/img/in-hot-pursuit-cover.jpg','https://matthew.mccluster.org/album.html?album=in-hot-pursuit&t=Up%20For%20Days','site_catalog','active')
on conflict(catalog_key) do update set album_slug=excluded.album_slug,album_title=excluded.album_title,track_title=excluded.track_title,
 artist_name=excluded.artist_name,credit_line=excluded.credit_line,audio_path=excluded.audio_path,artwork_path=excluded.artwork_path,
 canonical_url=excluded.canonical_url,source_kind=excluded.source_kind,status=excluded.status,updated_at=now();
