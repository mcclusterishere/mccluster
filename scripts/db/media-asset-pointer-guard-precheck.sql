-- Read-only. One SELECT, one row, counts only: no ids, paths or file names.
--
-- What the owner decides before
-- supabase/pending/network_media_assets_pointer_guard_v1.sql is applied, and
-- again before its CHECK is validated. It is the breakdown of
-- scripts/db/media-asset-legacy-count.sql (the count the media-signing fix
-- brought: rows the signing rule will not sign, and how many of them a reviewed
-- surface names). The two agree on their first numbers: total_rows is its
-- assets, not_canonical its not_canonical, prefix_not_linked its
-- prefix_not_linked_to_owner (scripts/test-network-media-pointer-guard-db.sh
-- reads both on the same rows and compares). This file adds what the guard
-- needs to know and that count does not tell apart:
--   - which legacy rows something still names, surface by surface, and how
--     many of the NOT canonical ones are in use at all. The guard refuses to
--     apply while not_canonical is above 0: its CHECK is NOT VALID, which still
--     checks every later UPDATE of a row, so a row counted there could no
--     longer be finalized, attached or released, and a post it is attached to
--     could not be deleted. The owner decides each such row first;
--   - of the rows whose prefix is not linked, which wait for an identity merge
--     to be followed and which name somebody else's upload;
--   - the status of every row.
-- Run it in production (Supabase MCP execute_sql or the SQL Editor) before the
-- apply, and again before `alter table public.network_media_assets validate
-- constraint network_media_assets_canonical_upload_check;` (not_canonical must
-- be 0). It needs nothing the guard creates, so it runs before and after it.
--
-- canonical: bucket_id = 'mnet-media' and object_path is
--   <auth user uuid>/<uuid>-<name of 1..180 of A-Z a-z 0-9 . _ ->, the same
--   rule as supabase/functions/mnet-media/storage-path.mjs and the guard's
--   CHECK (scripts/test/network-media-pointer-guard.test.mjs holds the three
--   patterns equal).
-- linked: the login in the first path segment is linked to the row's
--   owner_m_uid in public.m_auth_user_links (any link, primary or not), which
--   is what the media function and the Worker require before they sign.
-- legacy = not canonical, or canonical with a prefix that is not linked.
--   prefix_not_linked rows pass the CHECK; they are the rows nothing will sign.
--   They are of two kinds, counted apart:
--     prefix_not_linked_after_a_merge  the owner is a merged person and the
--       login in the path reached a living person through a merge. These are
--       what public.network_media_assets_follow_merge moves.
--     prefix_not_linked_other  everything else: a row its member pointed at
--       somebody else's upload while the table was theirs to write, or a row
--       whose login is gone. Nothing will ever sign or move these; deleting
--       them is the owner's call.
--
-- named_by_*: of the LEGACY rows, how many are named by
--   action_proofs.metadata->>'asset_id'           a mission proof's upload
--   action_antisocial_levels.media_asset_id       an Anti-Social level's clip
--   fbi_cases.media_asset_ids                     an FBI case's photos
--   action_clip_assets.network_media_asset_id     a clipping campaign's source
-- and, beyond the four, by a proof's poster (metadata->>'poster_asset_id'), a
-- joint post (action_collaboration_posts.media_asset_id) or a post (post_id).
-- legacy_named_by_any counts a row once however many things name it.
-- The archive copies in schema archive_missions_20261030 are not read.
with assets as (
  select a.id, a.owner_m_uid, a.status, a.post_id, a.object_path,
         (a.bucket_id = 'mnet-media'
          and a.object_path ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-[A-Za-z0-9._-]{1,180}$'
         ) as canonical
    from public.network_media_assets a
), bound as (
  select s.*,
         case when s.canonical then exists (
           select 1 from public.m_auth_user_links l
            where l.auth_user_id = split_part(s.object_path, '/', 1)::uuid
              and l.m_uid = s.owner_m_uid)
         else false end as linked,
         case when s.canonical then exists (
           select 1 from public.m_auth_user_links l
             join public.m_people kept on kept.id = l.m_uid and kept.status <> 'merged'
             join public.m_people gone on gone.id = s.owner_m_uid and gone.status = 'merged'
            where l.auth_user_id = split_part(s.object_path, '/', 1)::uuid
              and l.link_method = 'admin_merge')
         else false end as follows_a_merge
    from assets s
), named as (
  select b.id, b.status, b.post_id, b.canonical, b.linked, b.follows_a_merge,
         (not b.canonical or not b.linked) as legacy,
         exists (select 1 from public.action_proofs p where lower(p.metadata ->> 'asset_id') = b.id::text) as by_proof,
         exists (select 1 from public.action_proofs p where lower(p.metadata ->> 'poster_asset_id') = b.id::text) as by_proof_poster,
         exists (select 1 from public.action_antisocial_levels l where l.media_asset_id = b.id) as by_level,
         exists (select 1 from public.fbi_cases c where b.id = any (c.media_asset_ids)) as by_fbi,
         exists (select 1 from public.action_clip_assets c where c.network_media_asset_id = b.id) as by_clip,
         exists (select 1 from public.action_collaboration_posts c where c.media_asset_id = b.id) as by_joint_post
    from bound b
)
select
  count(*)                                                                as total_rows,
  count(*) filter (where canonical and linked)                            as canonical_and_linked,
  count(*) filter (where not canonical)                                   as not_canonical,
  count(*) filter (where canonical and not linked)                        as prefix_not_linked,
  count(*) filter (where legacy)                                          as legacy_rows,
  count(*) filter (where legacy and by_proof)                             as legacy_named_by_action_proofs,
  count(*) filter (where legacy and by_level)                             as legacy_named_by_antisocial_levels,
  count(*) filter (where legacy and by_fbi)                               as legacy_named_by_fbi_cases,
  count(*) filter (where legacy and by_clip)                              as legacy_named_by_clip_assets,
  count(*) filter (where legacy and (by_proof or by_level or by_fbi or by_clip)) as legacy_named_by_any,
  count(*) filter (where legacy and by_proof_poster)                      as legacy_named_as_proof_poster,
  count(*) filter (where legacy and by_joint_post)                        as legacy_named_by_joint_posts,
  count(*) filter (where legacy and post_id is not null)                  as legacy_attached_to_a_post,
  count(*) filter (where not canonical and (by_proof or by_level or by_fbi or by_clip
                                            or by_proof_poster or by_joint_post or post_id is not null))
                                                                          as not_canonical_and_in_use,
  count(*) filter (where status = 'staged')                               as status_staged,
  count(*) filter (where status = 'ready')                                as status_ready,
  count(*) filter (where status = 'attached')                             as status_attached,
  count(*) filter (where status = 'blocked')                              as status_blocked,
  count(*) filter (where status = 'deleted')                              as status_deleted,
  count(*) filter (where canonical and not linked and follows_a_merge)    as prefix_not_linked_after_a_merge,
  count(*) filter (where canonical and not linked and not follows_a_merge) as prefix_not_linked_other
from named;
