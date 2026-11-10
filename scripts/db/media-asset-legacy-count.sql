-- READ-ONLY. One SELECT, counts only, no row data.
--
-- Rows of public.network_media_assets that the Worker's signing rule
-- (workers/mccluster/src/lib/media-storage.js) and the media function's rule
-- (supabase/functions/mnet-media/storage-path.mjs) will not sign, overall and among
-- the rows that a mission proof, an Anti-Social level, an FBI case or a clip campaign
-- names. Run it before a Worker deploy that carries the rule and decide per row if
-- named_and_no_longer_signed is not zero: such a row would answer "Proof has no
-- upload", lose its photo on a case, or become an unavailable source file.
--
-- A row is signable when its bucket is mnet-media, its path is
-- <auth user uuid>/<uuid>-<name>, and that auth user is linked to the row's owner in
-- public.m_auth_user_links. An identity merge moves the login and leaves owner_m_uid,
-- which is the case prefix_not_linked_to_owner counts.
--
-- Result on production zmnhbrjyhxzhkxmhkexs, 2026-11-09 23:51 UTC: assets 4,
-- not_canonical 0, prefix_not_linked_to_owner 0, named 1, named_and_no_longer_signed 0,
-- named_ids 1, named_ids_without_a_row 0.
with a as (
  select m.id, m.owner_m_uid, m.object_path,
         (m.bucket_id = 'mnet-media'
          and m.object_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,180}$') as canonical
    from public.network_media_assets m
), named as (
  select (p.metadata->>'asset_id')::uuid as id from public.action_proofs p
   where p.metadata->>'asset_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  union select l.media_asset_id from public.action_antisocial_levels l where l.media_asset_id is not null
  union select unnest(c.media_asset_ids) from public.fbi_cases c
  union select s.network_media_asset_id from public.action_clip_assets s where s.network_media_asset_id is not null
), judged as (
  select a.*, (a.id in (select id from named)) as named_by_a_reviewed_surface,
         (a.canonical and exists (select 1 from public.m_auth_user_links k
                                   where k.auth_user_id::text = lower(split_part(a.object_path, '/', 1)) and k.m_uid = a.owner_m_uid)) as signable
    from a
)
select count(*) as assets,
       count(*) filter (where not canonical) as not_canonical,
       count(*) filter (where canonical and not signable) as prefix_not_linked_to_owner,
       count(*) filter (where named_by_a_reviewed_surface) as named,
       count(*) filter (where named_by_a_reviewed_surface and not signable) as named_and_no_longer_signed,
       (select count(*) from named) as named_ids,
       (select count(*) from named n where not exists (select 1 from public.network_media_assets m where m.id = n.id)) as named_ids_without_a_row
  from judged;
