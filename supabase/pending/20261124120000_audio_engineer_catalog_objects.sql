-- Audio Engineer EP by McCluster, added to the shelf 2026-11-24 with the owner's cover (owner, 2026-11-24: Outta Tune,
-- Studio Trapped, Sound Trust Anthem, Trackout; produced by McCluster, Trackout co-produced by Tazzy Jay and McCluster):
-- its shelf songs become live discovery objects like every other shelf song
-- (supabase/migrations/20261003233747_action_network_live_governance_v1.sql).
-- PENDING: apply with the release of data/albums.json that adds them.
-- Rollback: 20261124120000_audio_engineer_catalog_objects.rollback.sql
insert into public.music_catalog_objects(catalog_key,album_slug,album_title,track_title,artist_name,credit_line,audio_path,artwork_path,canonical_url,source_kind,status)
values ('audio-engineer:outta-tune','audio-engineer','Audio Engineer','Outta Tune','McCluster','Produced by McCluster','assets/audio/outta-tune.mp3','assets/img/audio-engineer-cover.png','https://matthew.mccluster.org/album.html?album=audio-engineer&t=Outta%20Tune','site_catalog','active'),
('audio-engineer:studio-trapped','audio-engineer','Audio Engineer','Studio Trapped','McCluster','Produced by McCluster','assets/audio/studio-trapped.mp3','assets/img/audio-engineer-cover.png','https://matthew.mccluster.org/album.html?album=audio-engineer&t=Studio%20Trapped','site_catalog','active'),
('audio-engineer:sound-trust-anthem','audio-engineer','Audio Engineer','Sound Trust Anthem','McCluster','Produced by McCluster','assets/audio/sound-trust-anthem.mp3','assets/img/audio-engineer-cover.png','https://matthew.mccluster.org/album.html?album=audio-engineer&t=Sound%20Trust%20Anthem','site_catalog','active'),
('audio-engineer:trackout','audio-engineer','Audio Engineer','Trackout','McCluster','Co-produced by Tazzy Jay and McCluster','assets/audio/trackout.mp3','assets/img/audio-engineer-cover.png','https://matthew.mccluster.org/album.html?album=audio-engineer&t=Trackout','site_catalog','active')
on conflict(catalog_key) do update set album_slug=excluded.album_slug,album_title=excluded.album_title,track_title=excluded.track_title,
 artist_name=excluded.artist_name,credit_line=excluded.credit_line,audio_path=excluded.audio_path,artwork_path=excluded.artwork_path,
 canonical_url=excluded.canonical_url,source_kind=excluded.source_kind,status=excluded.status,updated_at=now();
