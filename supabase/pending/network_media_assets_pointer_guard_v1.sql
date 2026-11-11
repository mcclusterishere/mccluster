-- NETWORK MEDIA ASSETS POINTER GUARD V1 (pending; NOT applied in production)
--
-- PENDING. Not applied. Needs the owner's explicit OK and the pre-checks in
-- supabase/pending/README.md ("network_media_assets_pointer_guard_v1"). Never
-- run this folder as a whole.
--
-- WHAT IT FIXES
-- public.network_media_assets (supabase/migrations/20260920071811_mnet_real_network_v1.sql)
-- is the record of a member's upload: which object in the private mnet-media
-- bucket a post, a mission proof, an Anti-Social level, an FBI case or a
-- clipping source shows. Until this file the row was written by its owner.
-- The original migration grants authenticated writes and four owner policies
-- on `owner_m_uid = current_m_uid()`, without a pointer trigger or CHECK on
-- bucket_id or object_path. These source-defined pointers are member-writable,
-- not facts about what they uploaded. Current operational state must be
-- verified privately before any separately approved promotion.
--
-- The media function proves a row is its owner's own upload before it signs,
-- finalizes or discards it (supabase/functions/mnet-media/storage-path.mjs,
-- storageBelongsToAsset), and commit 3374dfcb makes the Worker's four signing
-- routes do the same (workers/mccluster/src/lib/media-storage.js). That
-- closes reading somebody else's object. It does not pin the file that was
-- reviewed. A member could still, with their own token:
--   (a) UPDATE object_path to another upload under their own prefix;
--   (b) DELETE the row and INSERT a new one with the same id (the id is
--       insertable; action_proofs.metadata and fbi_cases.media_asset_ids name
--       an asset without a foreign key);
--   (c) overwrite, move or delete the object itself through the Storage
--       policies "mnet media owner upload / update / delete", and, after a
--       delete, put different bytes at the same path by replaying the upload
--       token the function issued for it;
--   (s) set status themselves (staged -> ready with nothing uploaded,
--       attached -> ready to free reserved evidence, blocked/deleted -> ready).
-- So the photo on an approved FBI case, a campaign source handed to clippers,
-- or a proof the desk had reviewed could be swapped after the review.
--
-- WHO WRITES THE TABLE (searched 2026-11-10: js/, native/, workers/, core/,
-- supabase/functions/, every migration, replay and pending file)
--   insert   supabase/functions/mnet-media/index.ts:89 (upload-url)   service role
--   update   supabase/functions/mnet-media/index.ts:124 (finalize)    service role
--   delete   supabase/functions/mnet-media/index.ts:105 (discard)     service role
--   update   workers/mccluster/src/platform-api.js: insertNetworkPost (414),
--            attachPosters (456), releasePosters (460) and handleFbi's
--            reserve and release of evidence (1448, 1449); lines as of
--            main 578e6830                                             service role
--   update   public.action_share_assignment_internal(uuid) and
--            public.publish_antisocial_collaboration(...): post_id, status,
--            updated_at                                                SECURITY DEFINER
--   No browser, native or Edge code writes a row with a member's token. The one
--   member-token call is a read: js/control-room/clipping.js:50.
-- WHO WRITES THE BUCKET with a member's token: nobody deletes, moves, copies or
-- overwrites. Every upload is a PUT to the signed upload URL the function
-- issued (js/mnet.js:2308, js/create.js:240 and 395, js/fbi.js:212,
-- native/src/proofMedia.ts:118). Four of those five call sites keep a
-- fallback that POSTs with the member's token when the grant carries no
-- upload token (js/mnet.js:2309, js/create.js:241 and 396,
-- native/src/proofMedia.ts:119); the function in this repository never
-- answers without one (index.ts:88 fails first).
-- Because nothing a member runs writes the table or needs to write the bucket
-- with their own token, members lose those writes instead of having them
-- filtered.
--
-- WHAT IT DOES
--   0. Takes the table's lock first and REFUSES TO APPLY while any row is not
--      a canonical upload (see 2). Nothing is changed in that case.
--   1. Revokes INSERT/UPDATE/DELETE (and TRUNCATE/REFERENCES/TRIGGER) on the
--      table from public, anon and authenticated, and drops the owner insert,
--      update and delete policies. The owner read policy and SELECT stay.
--      (Any MAINTAIN privilege added by PostgreSQL 17 is left unchanged;
--      this candidate does not decide platform-wide maintenance privileges.)
--   2. Adds CHECK network_media_assets_canonical_upload_check, NOT VALID:
--      bucket_id = 'mnet-media' and object_path is exactly what upload-url
--      issues, <auth user uuid>/<uuid>-<clean name>. It is the SQL twin of
--      storage-path.mjs (scripts/test/network-media-pointer-guard.test.mjs
--      holds them equal case for case). NOT VALID skips only the scan of
--      existing rows: every INSERT and every UPDATE is checked from the moment
--      this file is applied, INCLUDING an update that does not touch the path.
--      A legacy row that is not canonical could then no longer be finalized,
--      attached or released, and deleting a post that such a row is attached
--      to would fail (the foreign key's SET NULL is an update). That is why
--      step 0 refuses: the owner decides such rows first, with
--      scripts/db/media-asset-pointer-guard-precheck.sql (not_canonical there
--      is not_canonical in scripts/db/media-asset-legacy-count.sql). Validate
--      afterwards (README).
--   3. Triggers network_media_assets_guard_trg (BEFORE INSERT OR UPDATE OR
--      DELETE, each row) and network_media_assets_guard_truncate_trg:
--        - a statement run as anon or authenticated is refused outright. The
--          grants are the first lock; this is the second, so a later re-grant
--          cannot reopen (a), (b) or (s) without replacing this function;
--        - INSERT, every role: the login in the path's first segment must be
--          linked to owner_m_uid in public.m_auth_user_links;
--        - UPDATE, every role: id, bucket_id and object_path never change;
--        - UPDATE, every role: owner_m_uid changes only with the merge path's
--          record of that very move (4), and only to the person who holds
--          the login that uploaded the file.
--      "Every role" is every role that cannot switch a trigger off or write
--      the record of moves by hand: the service role and SECURITY DEFINER
--      code are bound, the table's owner is not (it can always drop the
--      trigger). status, post_id and the descriptive columns stay writable by
--      the service role and by SECURITY DEFINER functions, as today. This
--      file does not add a status state machine for them: see RESIDUALS.
--   4. One audited path for an identity merge. public.m_merge_people
--      (supabase/replay_migrations/0049_m_account_people.sql) moves a merged
--      person's logins to the kept person and leaves owner_m_uid behind, so
--      the merged person's uploads stop proving as anybody's. After a merge,
--      public.network_media_assets_follow_merge(p_keep, p_merge, p_reason)
--      moves the merged person's rows whose uploading login reached p_keep
--      THROUGH A MERGE, and writes one append-only row per asset to
--      public.network_media_asset_owner_moves in the same transaction. A row
--      the merged person had pointed at somebody else's upload is never made
--      that person's. Service role only.
--   5. The bytes, against the member's own token: drops the Storage policies
--      "mnet media owner upload", "mnet media owner update" and "mnet media
--      owner delete". "mnet media owner read" stays. Shown on the real
--      Storage API (supabase/storage-api v1.90.2, on PostgreSQL 16 and 17 and
--      on the official supabase/postgres 17 image as its restricted postgres
--      role; scripts/test-network-media-storage-flow.sh) with this bucket and
--      these policies: without the three, a signed-upload PUT of a new object
--      still answers 200, with the member's token and with no Authorization
--      header at all (the signed-upload route does not consult RLS);
--      finalize's listing, view-url's signing and discard's removal still
--      work with the service role; and the member's direct POST, upsert, PUT,
--      resumable upload, copy, move and DELETE are refused. All three go, not
--      two: with only upload and update gone the member still deletes the
--      object and replays the upload token, which then succeeds and changes
--      the bytes under an unchanged row.
--
-- WHAT IT DOES NOT TOUCH
--   The mnet-media Edge Function and the Worker run unchanged on top of it
--   (scripts/test-network-media-pointer-guard-db.sh replays their writes).
--   No trigger is added to storage.objects, and no other table is altered.
--
-- RESIDUALS (owner decisions, in README)
--   - finalize sets status 'ready' whatever the row's status was, with the
--     service role, for the owner of the row. A member can still move their
--     own blocked, deleted or reserved (attached, no post) row back to ready
--     through POST /v1/mnet/media/finalize, and then discard it. The fix is in
--     the function (promote only staged), not in this file; the behaviour
--     test's last block records it so nobody takes it for closed.
--   - discard removes the object and the row of an upload that a pending
--     proof, an Anti-Social level or a clipping source names, when it is not
--     attached. For a clipping source the row survives (ON DELETE RESTRICT)
--     with its object gone, and the upload token, while it lives, can put
--     different bytes there.
--   - the pointer is pinned against UPDATE. The service role, or SECURITY
--     DEFINER code, can still delete a row and insert another under the same
--     id. No shipped code does: upload-url never supplies an id. Closing it in
--     the database means refusing every caller-chosen id, which also refuses
--     an operator restoring rows from a backup under their own ids.
--   - nothing here stops the service role or the dashboard from overwriting
--     or deleting an object a reviewed row names. A storage.objects trigger
--     for every role (the music_storage_object_guard model) would; it also
--     decides how the desk takes a reviewed upload down, so it is not
--     included.
--
-- Test: scripts/test-network-media-pointer-guard-db.sh (PostgreSQL 16 and 17),
--       scripts/test/network-media-pointer-guard.test.mjs, and, with Docker,
--       scripts/test-network-media-storage-flow.sh (the real Storage API; with
--       SUPABASE_DB_IMAGE set, the official Supabase Postgres image)
-- Rollback: network_media_assets_pointer_guard_v1.rollback.sql
begin;
set local lock_timeout = '5s';

-- The strongest lock this file needs on the table, taken first: nothing below
-- then upgrades a weaker lock while a request that has already read the table
-- waits to write it (an upgrade like that can deadlock). storage.objects is
-- locked only by the last three statements, for as short a time as possible.
lock table public.network_media_assets in access exclusive mode;

------------------------------------------------------------------------------
-- The canonical upload: which login's prefix a row points into, or null when
-- the row does not name an upload this platform issued. The same rule as
-- canonicalMediaUploader() in supabase/functions/mnet-media/storage-path.mjs
-- (upper-case hex included, as there; upload-url itself issues lower case).
-- Character classes are spelled out and the match is case-sensitive, so the
-- answer does not depend on the database's locale.
------------------------------------------------------------------------------
create or replace function public.network_media_canonical_uploader(p_bucket text, p_path text)
returns uuid language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select case
    when p_bucket = 'mnet-media'
     and p_path ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-[A-Za-z0-9._-]{1,180}$'
    then split_part(p_path, '/', 1)::uuid
  end
$$;
revoke all on function public.network_media_canonical_uploader(text, text) from public, anon, authenticated;
grant execute on function public.network_media_canonical_uploader(text, text) to service_role;

------------------------------------------------------------------------------
-- Refuse to apply while a row that is not a canonical upload exists. The
-- CHECK below is NOT VALID, and NOT VALID is not "not enforced": it skips the
-- scan of existing rows and then checks every later UPDATE of them, whatever
-- the update touches. Such a row could no longer be finalized, attached or
-- released, and the post it is attached to could not be deleted (the foreign
-- key's SET NULL is an update of this row). So those rows are decided first,
-- by the owner, with scripts/db/media-asset-pointer-guard-precheck.sql; this
-- file does not decide them. The count and the apply are separate moments,
-- which is why the check is here, under the lock, and not only in the README.
------------------------------------------------------------------------------
do $legacy$
declare v_rows bigint;
begin
  select count(*) into v_rows
    from public.network_media_assets a
   where public.network_media_canonical_uploader(a.bucket_id, a.object_path) is null;
  if v_rows > 0 then
    raise exception 'network_media_assets_pointer_guard_v1 was not applied: % row(s) of network_media_assets are not canonical uploads', v_rows
      using errcode = '23514',
            hint = 'Run scripts/db/media-asset-pointer-guard-precheck.sql and decide those rows first (supabase/pending/README.md). Under a NOT VALID check they could no longer be updated, and a post one is attached to could not be deleted.';
  end if;
end $legacy$;

-- Is this upload its owner's own: does the login whose prefix received the
-- signed upload belong to this M person? public.m_auth_user_links is not
-- writable by members.
create or replace function public.network_media_upload_owned_by(p_bucket text, p_path text, p_owner uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select p_owner is not null and exists (
    select 1 from public.m_auth_user_links l
     where l.auth_user_id = public.network_media_canonical_uploader(p_bucket, p_path)
       and l.m_uid = p_owner)
$$;
revoke all on function public.network_media_upload_owned_by(text, text, uuid) from public, anon, authenticated;
grant execute on function public.network_media_upload_owned_by(text, text, uuid) to service_role;

------------------------------------------------------------------------------
-- 4. The record of every change of owner. Append-only (no update, no delete,
--    no truncate, for any role that cannot disable a trigger), written only by
--    public.network_media_assets_follow_merge. No foreign key to the asset or
--    the people: the record outlives them.
------------------------------------------------------------------------------
create table if not exists public.network_media_asset_owner_moves (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null,
  from_m_uid uuid not null,
  to_m_uid uuid not null,
  uploader_auth_user_id uuid not null,
  bucket_id text not null,
  object_path text not null,
  reason text not null check (char_length(btrim(reason, E' \t\n\r')) between 8 and 500),
  moved_by_role text not null default session_user,
  moved_by_jwt_role text,
  txid bigint not null default txid_current(),
  moved_at timestamptz not null default now(),
  check (from_m_uid <> to_m_uid)
);
create index if not exists network_media_asset_owner_moves_asset_idx
  on public.network_media_asset_owner_moves (asset_id, moved_at desc);
alter table public.network_media_asset_owner_moves enable row level security;
revoke all on public.network_media_asset_owner_moves from public, anon, authenticated, service_role;
grant select on public.network_media_asset_owner_moves to service_role;
comment on table public.network_media_asset_owner_moves is
  'Every change of network_media_assets.owner_m_uid, one row per asset, written in the same transaction by public.network_media_assets_follow_merge after an identity merge. Append-only; read-only even to the service role.';

create or replace function public.network_media_asset_owner_moves_append_only()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'network_media_asset_owner_moves_append_only' using errcode = '42501';
end $$;
revoke all on function public.network_media_asset_owner_moves_append_only() from public, anon, authenticated;
drop trigger if exists network_media_asset_owner_moves_append_only_trg on public.network_media_asset_owner_moves;
create trigger network_media_asset_owner_moves_append_only_trg
  before update or delete on public.network_media_asset_owner_moves
  for each row execute function public.network_media_asset_owner_moves_append_only();
drop trigger if exists network_media_asset_owner_moves_append_only_truncate_trg on public.network_media_asset_owner_moves;
create trigger network_media_asset_owner_moves_append_only_truncate_trg
  before truncate on public.network_media_asset_owner_moves
  for each statement execute function public.network_media_asset_owner_moves_append_only();

-- The guard's question on a change of owner: did the merge path record this
-- exact move, for this asset, in this transaction?
create or replace function public.network_media_owner_move_recorded(p_asset uuid, p_from uuid, p_to uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select exists (
    select 1 from public.network_media_asset_owner_moves m
     where m.asset_id = p_asset and m.from_m_uid = p_from and m.to_m_uid = p_to
       and m.txid = txid_current())
$$;
revoke all on function public.network_media_owner_move_recorded(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.network_media_owner_move_recorded(uuid, uuid, uuid) to service_role;

------------------------------------------------------------------------------
-- 3. The guard. SECURITY INVOKER on purpose: current_user is then the role
--    whose statement fired the trigger. PostgREST runs a member's own request
--    as anon or authenticated; the service role's as service_role; and a
--    SECURITY DEFINER function's writes, like a foreign key's own SET NULL or
--    CASCADE, run as an owner, whoever called. What needs more than the
--    caller's rights is asked through the SECURITY DEFINER helpers above.
--    It serves the row trigger and the TRUNCATE trigger.
------------------------------------------------------------------------------
create or replace function public.network_media_assets_guard()
returns trigger language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'network_media_assets_server_write_only'
      using errcode = '42501',
            hint = 'Upload through POST /v1/mnet/media/upload-url; the media function and the Worker write this table.';
  end if;

  if tg_op = 'TRUNCATE' then
    return null;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'INSERT' then
    if public.network_media_canonical_uploader(new.bucket_id, new.object_path) is null then
      raise exception 'network_media_asset_not_canonical'
        using errcode = '23514',
              hint = 'bucket_id is mnet-media and object_path is <auth user uuid>/<uuid>-<name>, as upload-url issues it.';
    end if;
    if not public.network_media_upload_owned_by(new.bucket_id, new.object_path, new.owner_m_uid) then
      raise exception 'network_media_asset_owner_not_linked'
        using errcode = '23514',
              hint = 'The login in the first path segment is not linked to owner_m_uid in m_auth_user_links.';
    end if;
    return new;
  end if;

  -- UPDATE, every role
  if new.id is distinct from old.id
     or new.bucket_id is distinct from old.bucket_id
     or new.object_path is distinct from old.object_path then
    raise exception 'network_media_asset_pointer_immutable'
      using errcode = '42501', detail = old.id::text,
            hint = 'A different file is a new upload: a new row, a new id, a new path.';
  end if;
  -- the owner changes only with the merge path's record of this very move,
  -- and only to the person who holds the login that uploaded the file
  if new.owner_m_uid is distinct from old.owner_m_uid
     and not (public.network_media_owner_move_recorded(old.id, old.owner_m_uid, new.owner_m_uid)
              and public.network_media_upload_owned_by(new.bucket_id, new.object_path, new.owner_m_uid)) then
    raise exception 'network_media_asset_owner_immutable'
      using errcode = '42501', detail = old.id::text,
            hint = 'After m_merge_people, use public.network_media_assets_follow_merge(p_keep, p_merge, p_reason).';
  end if;
  return new;
end $$;
revoke all on function public.network_media_assets_guard() from public, anon, authenticated;

drop trigger if exists network_media_assets_guard_trg on public.network_media_assets;
create trigger network_media_assets_guard_trg
  before insert or update or delete on public.network_media_assets
  for each row execute function public.network_media_assets_guard();
drop trigger if exists network_media_assets_guard_truncate_trg on public.network_media_assets;
create trigger network_media_assets_guard_truncate_trg
  before truncate on public.network_media_assets
  for each statement execute function public.network_media_assets_guard();

------------------------------------------------------------------------------
-- 4. The one way an upload changes owner: following an identity merge that
--    has already happened. Run it after public.m_merge_people(p_keep, p_merge).
--    A row moves only when the login that uploaded it (its path's first
--    segment) reached p_keep THROUGH A MERGE (link_method 'admin_merge', which
--    only m_merge_people writes). A row the merged person had pointed at
--    somebody else's upload is therefore never made that person's: p_keep's
--    own logins are not merged logins. Anything that does not qualify is left
--    where it is and counted, never guessed. Returns {"moved": n, "left": n}.
--    What it cannot tell: when two people were merged into the same kept
--    person, which of them a merged login came from. They are one person then.
------------------------------------------------------------------------------
create or replace function public.network_media_assets_follow_merge(p_keep uuid, p_merge uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''), E' \t\n\r');
  v_moved integer := 0;
  v_left integer := 0;
  v_uploader uuid;
  r record;
begin
  if p_keep is null or p_merge is null or p_keep = p_merge then
    raise exception 'two distinct M UIDs are required' using errcode = '22023';
  end if;
  if char_length(v_reason) not between 8 and 500 then
    raise exception 'a reason of 8 to 500 characters is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.m_people p where p.id = p_keep and p.status <> 'merged') then
    raise exception 'the kept M person does not exist or was itself merged away' using errcode = '22023';
  end if;
  if not exists (select 1 from public.m_people p where p.id = p_merge and p.status = 'merged') then
    raise exception 'the other M person has not been merged: run public.m_merge_people first' using errcode = '22023';
  end if;
  -- m_merge_people moves every login of the person it merges
  if exists (select 1 from public.m_auth_user_links l where l.m_uid = p_merge) then
    raise exception 'the merged M person still holds a login: public.m_merge_people did not merge it' using errcode = '22023';
  end if;

  for r in
    select a.id, a.bucket_id, a.object_path
      from public.network_media_assets a
     where a.owner_m_uid = p_merge
     order by a.created_at, a.id
       for update
  loop
    v_uploader := public.network_media_canonical_uploader(r.bucket_id, r.object_path);
    if v_uploader is not null and exists (
         select 1 from public.m_auth_user_links l
          where l.auth_user_id = v_uploader and l.m_uid = p_keep and l.link_method = 'admin_merge') then
      insert into public.network_media_asset_owner_moves
        (asset_id, from_m_uid, to_m_uid, uploader_auth_user_id, bucket_id, object_path, reason, moved_by_jwt_role)
      values (r.id, p_merge, p_keep, v_uploader, r.bucket_id, r.object_path, v_reason,
              nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''));
      update public.network_media_assets set owner_m_uid = p_keep, updated_at = now() where id = r.id;
      v_moved := v_moved + 1;
    else
      v_left := v_left + 1;
    end if;
  end loop;
  return jsonb_build_object('moved', v_moved, 'left', v_left);
end $$;
revoke all on function public.network_media_assets_follow_merge(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.network_media_assets_follow_merge(uuid, uuid, text) to service_role;

------------------------------------------------------------------------------
-- 2. The canonical upload, as a constraint. NOT VALID: existing rows are not
--    scanned by this statement (the check above has just counted them),
--    every new and every updated row is checked from now on. Kept as it is
--    on a re-run, so a constraint the owner has validated stays validated.
------------------------------------------------------------------------------
do $c$ begin
  alter table public.network_media_assets add constraint network_media_assets_canonical_upload_check
    check (bucket_id = 'mnet-media'
       and object_path ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-[A-Za-z0-9._-]{1,180}$') not valid;
exception when duplicate_object then null; end $c$;

------------------------------------------------------------------------------
-- 1. Members read their own rows and write none.
------------------------------------------------------------------------------
drop policy if exists network_media_owner_insert on public.network_media_assets;
drop policy if exists network_media_owner_update on public.network_media_assets;
drop policy if exists network_media_owner_delete on public.network_media_assets;
revoke insert, update, delete, truncate, references, trigger
  on public.network_media_assets from public, anon, authenticated;

------------------------------------------------------------------------------
-- 5. The bytes, against the member's own token. A member's token no longer
--    creates, overwrites, moves or deletes an object in mnet-media; it still
--    reads its own. Uploads keep going through the signed upload URL the
--    media function issues, which the Storage API serves without consulting
--    these policies.
------------------------------------------------------------------------------
drop policy if exists "mnet media owner upload" on storage.objects;
drop policy if exists "mnet media owner update" on storage.objects;
drop policy if exists "mnet media owner delete" on storage.objects;

commit;
