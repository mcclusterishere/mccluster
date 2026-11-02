-- Rollback for 20261031190000_prim3_catalog_objects.sql: the twelve objects stop being live.
-- (Rows are kept and set archived so any live-room reference to them stays resolvable.)
update public.music_catalog_objects set status='archived', updated_at=now()
 where catalog_key in ('prim3:high-alert','prim3:osint','prim3:anti-social-engineering-draft','prim3:red-blue-purple-white-team','prim3:data-breach','prim3:app-attacks','prim3:dive-in','prim3:iot-draft','prim3:per-diem-draft','prim3:raid-hot-site','prim3:evil-twin-middle-man','prim3:ghost-in-the-wires');
