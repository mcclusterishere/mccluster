-- PRIM3: the twelve study tapes added 2026-10-31 become live discovery objects,
-- like every other shelf song (supabase/migrations/20261003233747_action_network_live_governance_v1.sql).
-- Three are drafts ("(Draft)" in the title); when a final replaces one, its key changes with its title.
-- PENDING: apply with the release of data/albums.json that adds them.
-- Rollback: 20261031190000_prim3_catalog_objects.rollback.sql
insert into public.music_catalog_objects(catalog_key,album_slug,album_title,track_title,artist_name,credit_line,audio_path,artwork_path,canonical_url,source_kind,status)
values ('prim3:high-alert','prim3','PRIM3','High Alert','McCluster','Music to build to.','assets/audio/high-alert.m4a','assets/frames/prim3_0001.jpg','https://matthew.mccluster.org/album.html?album=prim3&t=High%20Alert','site_catalog','active'),
('prim3:osint','prim3','PRIM3','OSINT','McCluster','Music to build to.','assets/audio/osint.mp3','assets/frames/prim3_0001.jpg','https://matthew.mccluster.org/album.html?album=prim3&t=OSINT','site_catalog','active'),
('prim3:anti-social-engineering-draft','prim3','PRIM3','Anti-Social Engineering (Draft)','McCluster','Music to build to.','assets/audio/anti-social-engineering.mp3','assets/frames/prim3_0001.jpg','https://matthew.mccluster.org/album.html?album=prim3&t=Anti-Social%20Engineering%20(Draft)','site_catalog','active'),
('prim3:red-blue-purple-white-team','prim3','PRIM3','Red, Blue, Purple, White Team','McCluster','Music to build to.','assets/audio/red-blue-purple-white-team.mp3','assets/frames/prim3_0001.jpg','https://matthew.mccluster.org/album.html?album=prim3&t=Red%2C%20Blue%2C%20Purple%2C%20White%20Team','site_catalog','active'),
('prim3:data-breach','prim3','PRIM3','Data Breach','McCluster','Music to build to.','assets/audio/data-breach.mp3','assets/frames/prim3_0001.jpg','https://matthew.mccluster.org/album.html?album=prim3&t=Data%20Breach','site_catalog','active'),
('prim3:app-attacks','prim3','PRIM3','App Attacks','McCluster','Music to build to.','assets/audio/app-attacks.mp3','assets/frames/prim3_0001.jpg','https://matthew.mccluster.org/album.html?album=prim3&t=App%20Attacks','site_catalog','active'),
('prim3:dive-in','prim3','PRIM3','Dive In','McCluster','Music to build to.','assets/audio/dive-in.mp3','assets/frames/prim3_0001.jpg','https://matthew.mccluster.org/album.html?album=prim3&t=Dive%20In','site_catalog','active'),
('prim3:iot-draft','prim3','PRIM3','IOT (Draft)','McCluster','Music to build to.','assets/audio/iot.mp3','assets/frames/prim3_0001.jpg','https://matthew.mccluster.org/album.html?album=prim3&t=IOT%20(Draft)','site_catalog','active'),
('prim3:per-diem-draft','prim3','PRIM3','Per Diem (Draft)','McCluster','Music to build to.','assets/audio/per-diem.mp3','assets/frames/prim3_0001.jpg','https://matthew.mccluster.org/album.html?album=prim3&t=Per%20Diem%20(Draft)','site_catalog','active'),
('prim3:raid-hot-site','prim3','PRIM3','RAID (Hot Site)','McCluster','Music to build to.','assets/audio/raid-hot-site.mp3','assets/frames/prim3_0001.jpg','https://matthew.mccluster.org/album.html?album=prim3&t=RAID%20(Hot%20Site)','site_catalog','active'),
('prim3:evil-twin-middle-man','prim3','PRIM3','Evil Twin (Middle Man)','McCluster','Music to build to.','assets/audio/evil-twin-middle-man.mp3','assets/frames/prim3_0001.jpg','https://matthew.mccluster.org/album.html?album=prim3&t=Evil%20Twin%20(Middle%20Man)','site_catalog','active'),
('prim3:ghost-in-the-wires','prim3','PRIM3','Ghost in the Wires','McCluster','Music to build to.','assets/audio/ghost-in-the-wires.mp3','assets/frames/prim3_0001.jpg','https://matthew.mccluster.org/album.html?album=prim3&t=Ghost%20in%20the%20Wires','site_catalog','active')
on conflict(catalog_key) do update set album_slug=excluded.album_slug,album_title=excluded.album_title,track_title=excluded.track_title,
 artist_name=excluded.artist_name,credit_line=excluded.credit_line,audio_path=excluded.audio_path,artwork_path=excluded.artwork_path,
 canonical_url=excluded.canonical_url,source_kind=excluded.source_kind,status=excluded.status,updated_at=now();
