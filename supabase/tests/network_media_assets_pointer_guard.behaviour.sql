-- Behaviour of supabase/pending/network_media_assets_pointer_guard_v1.sql,
-- AFTER it is applied, on the rows of network_media_assets_pointer_guard.seed.sql.
-- Run by scripts/test-network-media-pointer-guard-db.sh with
--   psql -v cases="$(cat supabase/tests/network_media_assets_pointer_guard.cases.json)"
-- Each block replays, as the role that runs it in production, what the named
-- code does. Scratch database only.
\set ON_ERROR_STOP on

------------------------------------------------------------------------------
-- 1. The media function (supabase/functions/mnet-media/index.ts), service role:
--    upload-url inserts, finalize updates, view-url reads, discard deletes.
------------------------------------------------------------------------------
do $$
declare v_id uuid; v_row public.network_media_assets;
begin
  perform t.as_service();
  -- upload-url (index.ts:89): the caller's primary M uid, the caller's login as prefix
  insert into public.network_media_assets (owner_m_uid, bucket_id, object_path, media_type, mime_type, byte_size, alt_text, status)
  values ('a0000000-0000-4000-8000-00000000000a', 'mnet-media',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/20000000-0000-4000-8000-000000000001-new-upload.png', 'image', 'image/png', 4321, '', 'staged')
  returning id into v_id;
  -- finalize (index.ts:124)
  update public.network_media_assets
     set status = 'ready', updated_at = now(), width = 640, height = 480
   where id = v_id
  returning * into v_row;
  if v_row.status <> 'ready' or v_row.width <> 640 then raise exception 'finalize did not land'; end if;
  -- view-url (index.ts:131)
  perform 1 from public.network_media_assets where id = v_id and status <> 'deleted';
  if not found then raise exception 'view-url cannot read the row'; end if;
  -- discard (index.ts:105)
  delete from public.network_media_assets
   where id = v_id and owner_m_uid = 'a0000000-0000-4000-8000-00000000000a' and post_id is null;
  if not found then raise exception 'discard did not delete'; end if;
  raise notice '1. the media function''s insert, finalize, read and discard work as the service role';
end $$;

------------------------------------------------------------------------------
-- 2. The Worker (workers/mccluster/src/platform-api.js), service role:
--    attach a post's media, swap a poster, reserve and release FBI evidence.
------------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  perform t.as_service();
  -- insertNetworkPost: attach by id and owner
  update public.network_media_assets
     set post_id = 'd0000000-0000-4000-8000-0000000000a3', status = 'attached', updated_at = now()
   where id in ('e0000000-0000-4000-8000-0000000000f9') and owner_m_uid = 'a0000000-0000-4000-8000-00000000000a';
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'attach changed % rows', v_n; end if;
  -- releasePosters: free it again
  update public.network_media_assets
     set post_id = null, status = 'ready', updated_at = now()
   where id in ('e0000000-0000-4000-8000-0000000000f9') and owner_m_uid = 'a0000000-0000-4000-8000-00000000000a'
     and post_id = 'd0000000-0000-4000-8000-0000000000a3';
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'release changed % rows', v_n; end if;
  -- attachPosters: only when unattached
  update public.network_media_assets
     set post_id = 'd0000000-0000-4000-8000-0000000000a3', status = 'attached', updated_at = now()
   where id in ('e0000000-0000-4000-8000-0000000000f9') and owner_m_uid = 'a0000000-0000-4000-8000-00000000000a' and post_id is null;
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'attachPosters changed % rows', v_n; end if;
  update public.network_media_assets set post_id = null, status = 'ready', updated_at = now()
   where id = 'e0000000-0000-4000-8000-0000000000f9';
  -- handleFbi: reserve ready evidence, then release it
  update public.network_media_assets set status = 'attached', updated_at = now()
   where id in ('e0000000-0000-4000-8000-0000000000f9') and owner_m_uid = 'a0000000-0000-4000-8000-00000000000a'
     and status = 'ready' and post_id is null;
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'reserve changed % rows', v_n; end if;
  update public.network_media_assets set status = 'ready', updated_at = now()
   where id in ('e0000000-0000-4000-8000-0000000000f9') and owner_m_uid = 'a0000000-0000-4000-8000-00000000000a'
     and status = 'attached' and post_id is null;
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'release of evidence changed % rows', v_n; end if;
  raise notice '2. the Worker''s attach, release, reserve and release-evidence work as the service role';
end $$;

------------------------------------------------------------------------------
-- 3. A SECURITY DEFINER function attaches for a member, as
--    public.publish_antisocial_collaboration does: the JWT is the member's,
--    the write runs as the function's owner. The same write without definer
--    rights is the member's own and is refused.
------------------------------------------------------------------------------
do $$
begin
  perform t.as_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  perform t.must_fail(
    $q$select public.test_invoker_attach('e0000000-0000-4000-8000-0000000000f9', 'd0000000-0000-4000-8000-0000000000a3')$q$,
    '42501', 'permission denied for table network_media_assets');
  perform public.test_definer_attach('e0000000-0000-4000-8000-0000000000f9', 'd0000000-0000-4000-8000-0000000000a3');
  -- a member still reads their own rows, and only theirs
  if not exists (select 1 from public.network_media_assets where id = 'e0000000-0000-4000-8000-0000000000f9')
     or exists (select 1 from public.network_media_assets where owner_m_uid <> 'a0000000-0000-4000-8000-00000000000a') then
    raise exception 'a member must read their own rows and nobody else''s';
  end if;
  if not exists (select 1 from public.network_media_assets where id = 'e0000000-0000-4000-8000-0000000000f9' and status = 'attached'
                    and post_id = 'd0000000-0000-4000-8000-0000000000a3') then
    raise exception 'the definer attach did not land';
  end if;
  -- another member cannot use the definer path on A's upload either
  perform t.as_member('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  perform t.must_fail(
    $q$select public.test_definer_attach('e0000000-0000-4000-8000-0000000000f2', 'd0000000-0000-4000-8000-0000000000a3')$q$,
    'P0001', 'that upload is not yours or is not ready');
  raise notice '3. a SECURITY DEFINER function attaches for a member; the same write as the member is refused; reads are own rows only';
end $$;

------------------------------------------------------------------------------
-- 4. A member deletes their own post. The foreign key's ON DELETE SET NULL
--    updates the media row; that update is the table owner's, not the
--    member's, and the pointer does not move, so it passes.
------------------------------------------------------------------------------
do $$
begin
  perform t.as_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  perform t.must_change($q$delete from public.network_posts where id = 'd0000000-0000-4000-8000-0000000000a3'$q$, 1);
  execute 'reset role';
  if not exists (select 1 from public.network_media_assets where id = 'e0000000-0000-4000-8000-0000000000f9'
                    and post_id is null and status = 'attached') then
    raise exception 'the post was deleted but its media row did not lose post_id';
  end if;
  update public.network_media_assets set status = 'ready' where id = 'e0000000-0000-4000-8000-0000000000f9';
  raise notice '4. a member deleting their own post still clears post_id on its media row';
end $$;

------------------------------------------------------------------------------
-- 5. EVERY ROLE: id, bucket_id and object_path never change, and owner_m_uid
--    does not change outside the merge path. The service role and the table
--    owner are refused exactly as a member is.
------------------------------------------------------------------------------
do $$
declare v_role text; v_before text := t.rows_digest();
begin
  foreach v_role in array array['service_role', 'owner'] loop
    if v_role = 'service_role' then perform t.as_service(); else execute 'reset role'; end if;
    perform t.must_fail($q$update public.network_media_assets
        set object_path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-0000000000ff-swapped.jpg'
      where id = 'e0000000-0000-4000-8000-0000000000f1'$q$, '42501', 'network_media_asset_pointer_immutable');
    perform t.must_fail($q$update public.network_media_assets set bucket_id = 'mcc-gated-audio'
      where id = 'e0000000-0000-4000-8000-0000000000f1'$q$, '42501', 'network_media_asset_pointer_immutable');
    perform t.must_fail($q$update public.network_media_assets set id = gen_random_uuid()
      where id = 'e0000000-0000-4000-8000-0000000000f6'$q$, '42501', 'network_media_asset_pointer_immutable');
    perform t.must_fail($q$update public.network_media_assets set owner_m_uid = 'b0000000-0000-4000-8000-00000000000b'
      where id = 'e0000000-0000-4000-8000-0000000000f1'$q$, '42501', 'network_media_asset_owner_immutable');
    -- an upsert that lands on an existing id is an update: the pointer still does not move
    perform t.must_fail($q$insert into public.network_media_assets (id, owner_m_uid, bucket_id, object_path, media_type, mime_type, status)
      values ('e0000000-0000-4000-8000-0000000000f2', 'a0000000-0000-4000-8000-00000000000a', 'mnet-media',
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-0000000000fe-different.mp4', 'video', 'video/mp4', 'ready')
      on conflict (id) do update set object_path = excluded.object_path$q$, '42501', 'network_media_asset_pointer_immutable');
    -- writing the same pointer back is not a change
    perform t.must_change($q$update public.network_media_assets set object_path = object_path, bucket_id = bucket_id, alt_text = 'described'
      where id = 'e0000000-0000-4000-8000-0000000000f1'$q$, 1);
    perform t.must_change($q$update public.network_media_assets set alt_text = '' where id = 'e0000000-0000-4000-8000-0000000000f1'$q$, 1);
  end loop;
  execute 'reset role';
  if t.rows_digest() <> v_before then raise exception 'a refused pointer change moved a row'; end if;
  raise notice '5. the service role and the table owner cannot move id, bucket_id, object_path or owner_m_uid either';
end $$;

-- What "every role" cannot mean: the table's owner can write the record of
-- moves by hand and can switch triggers off. A hand-written record still does
-- not move an upload to a person who does not hold the login that uploaded it.
do $$
begin
  insert into public.network_media_asset_owner_moves (asset_id, from_m_uid, to_m_uid, uploader_auth_user_id, bucket_id, object_path, reason)
  values ('e0000000-0000-4000-8000-0000000000f9', 'a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'mnet-media', 'hand-written', 'a record written by hand');
  perform t.must_fail($q$update public.network_media_assets set owner_m_uid = 'b0000000-0000-4000-8000-00000000000b'
    where id = 'e0000000-0000-4000-8000-0000000000f9'$q$, '42501', 'network_media_asset_owner_immutable');
  raise exception using errcode = 'T0001', message = 'undo the hand-written record';
exception when sqlstate 'T0001' then
  raise notice '5b. a record of a move written by hand does not move an upload to a person who does not hold its login';
end $$;

-- TRUNCATE fires no row trigger. A member is refused by privilege and, with
-- the privilege handed back, by the statement trigger; the record of moves
-- cannot be truncated by anyone who cannot switch its trigger off.
do $$
declare v_n bigint := (select count(*) from public.network_media_assets);
begin
  perform t.as_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  perform t.must_fail($q$truncate public.network_media_assets cascade$q$, '42501', 'permission denied for table %');
  execute 'reset role';
  execute 'grant truncate on public.network_media_assets, public.action_antisocial_levels, public.action_clip_assets, public.action_collaboration_posts to authenticated';
  perform t.as_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  perform t.must_fail($q$truncate public.network_media_assets, public.action_antisocial_levels, public.action_clip_assets, public.action_collaboration_posts$q$,
    '42501', 'network_media_assets_server_write_only');
  execute 'reset role';
  execute 'revoke truncate on public.network_media_assets, public.action_antisocial_levels, public.action_clip_assets, public.action_collaboration_posts from authenticated';
  perform t.must_fail($q$truncate public.network_media_asset_owner_moves$q$, '42501', 'network_media_asset_owner_moves_append_only');
  if (select count(*) from public.network_media_assets) <> v_n then raise exception 'a refused truncate removed rows'; end if;
  raise notice '5c. TRUNCATE: a member is refused by privilege and by the statement trigger; the record of moves cannot be truncated';
end $$;

------------------------------------------------------------------------------
-- 6. INSERT, every role: only a canonical upload whose login is the owner's.
------------------------------------------------------------------------------
do $$
declare v_role text;
begin
  foreach v_role in array array['service_role', 'owner'] loop
    if v_role = 'service_role' then perform t.as_service(); else execute 'reset role'; end if;
    perform t.must_fail($q$insert into public.network_media_assets (owner_m_uid, bucket_id, object_path, media_type, mime_type)
      values ('a0000000-0000-4000-8000-00000000000a', 'mnet-media', 'regress/another-hand-made-path.mp3', 'audio', 'audio/mpeg')$q$,
      '23514', 'network_media_asset_not_canonical');
    perform t.must_fail($q$insert into public.network_media_assets (owner_m_uid, bucket_id, object_path, media_type, mime_type)
      values ('a0000000-0000-4000-8000-00000000000a', 'mcc-gated-audio',
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/20000000-0000-4000-8000-000000000002-right-shape-wrong-bucket.wav', 'audio', 'audio/wav')$q$,
      '23514', 'network_media_asset_not_canonical');
    -- canonical, but the login in the path belongs to B, not to the owner named
    perform t.must_fail($q$insert into public.network_media_assets (owner_m_uid, bucket_id, object_path, media_type, mime_type)
      values ('a0000000-0000-4000-8000-00000000000a', 'mnet-media',
              'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/20000000-0000-4000-8000-000000000003-in-b-prefix.png', 'image', 'image/png')$q$,
      '23514', 'network_media_asset_owner_not_linked');
    -- canonical, but a login nobody has
    perform t.must_fail($q$insert into public.network_media_assets (owner_m_uid, bucket_id, object_path, media_type, mime_type)
      values ('a0000000-0000-4000-8000-00000000000a', 'mnet-media',
              '99999999-9999-4999-8999-999999999999/20000000-0000-4000-8000-000000000004-nobody.png', 'image', 'image/png')$q$,
      '23514', 'network_media_asset_owner_not_linked');
  end loop;
  execute 'reset role';
  raise notice '6. no role can insert a row that is not a canonical upload under a login linked to its owner';
end $$;

------------------------------------------------------------------------------
-- 7. The canonical rule in three places, case for case: the helper function,
--    the CHECK as the catalog holds it, and (in
--    scripts/test/network-media-pointer-guard.test.mjs) the media function's
--    storage-path.mjs. The cases are one file.
------------------------------------------------------------------------------
-- psql does not substitute variables inside a dollar-quoted block
create temp table check_cases as select :'cases'::jsonb as cases;
do $$
declare
  v_cases jsonb := (select cases from check_cases);
  v_def text;
  c jsonb; v_expect uuid; v_got uuid; v_accept boolean; v_n integer := 0;
begin
  select pg_get_constraintdef(k.oid) into v_def from pg_constraint k
   where k.conrelid = 'public.network_media_assets'::regclass and k.conname = 'network_media_assets_canonical_upload_check';
  if v_def is null then raise exception 'the canonical CHECK is missing'; end if;
  -- the constraint exactly as stored, on a scratch table of the two columns it reads
  execute 'create temp table check_probe (bucket_id text, object_path text, constraint probe '
          || regexp_replace(v_def, '\s+NOT VALID$', '') || ') on commit drop';
  for c in select * from jsonb_array_elements(v_cases) loop
    v_expect := (c ->> 'uploader')::uuid;
    v_got := public.network_media_canonical_uploader(c ->> 'bucket', c ->> 'path');
    if v_got is distinct from v_expect then
      raise exception 'canonical_uploader(%): expected %, got %', c ->> 'note', v_expect, v_got;
    end if;
    begin
      insert into check_probe values (c ->> 'bucket', c ->> 'path');
      v_accept := true;
    exception when check_violation then v_accept := false;
    end;
    -- a CHECK passes on NULL; the columns themselves are NOT NULL
    if (c ->> 'bucket') is not null and (c ->> 'path') is not null and v_accept <> (v_expect is not null) then
      raise exception 'CHECK(%): expected %, got %', c ->> 'note', (v_expect is not null), v_accept;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n < 30 then raise exception 'only % cases ran', v_n; end if;
  raise notice '7. the helper function and the stored CHECK agree with all % shared cases', v_n;
end $$;

------------------------------------------------------------------------------
-- 8. The constraint arrives NOT VALID and, because the guard refuses to apply
--    while a non-canonical row exists (the driver script shows the refusal),
--    there is nothing it could fail on: it validates at once. Every row that
--    was there is canonical; the two that name B's uploads are among them.
------------------------------------------------------------------------------
do $$
begin
  if (select convalidated from pg_constraint where conrelid = 'public.network_media_assets'::regclass
        and conname = 'network_media_assets_canonical_upload_check') then
    raise exception 'the constraint must be added NOT VALID';
  end if;
  if (select count(*) from public.network_media_assets
       where id in ('e0000000-0000-4000-8000-00000000001c', 'e0000000-0000-4000-8000-00000000001e')) <> 2 then
    raise exception 'applying the guard must not remove the rows that name somebody else''s upload';
  end if;
  -- such a row passes the CHECK and stays writable by the service role (nothing signs it)
  perform t.as_service();
  perform t.must_change($q$update public.network_media_assets set alt_text = 'legacy, canonical shape'
    where id = 'e0000000-0000-4000-8000-00000000001c'$q$, 1);
  execute 'reset role';
  alter table public.network_media_assets validate constraint network_media_assets_canonical_upload_check;
  if not (select convalidated from pg_constraint where conrelid = 'public.network_media_assets'::regclass
            and conname = 'network_media_assets_canonical_upload_check') then
    raise exception 'the constraint did not validate';
  end if;
  raise notice '8. the constraint is added NOT VALID and validates at once: no non-canonical row can be there';
end $$;

------------------------------------------------------------------------------
-- 9. The one audited path for an identity merge.
------------------------------------------------------------------------------
do $$
declare v_out jsonb; v_moves integer;
begin
  -- before any merge: nobody may be moved
  perform t.as_service();
  perform t.must_fail($q$select public.network_media_assets_follow_merge('a0000000-0000-4000-8000-00000000000a',
    'c0000000-0000-4000-8000-00000000000c', 'duplicate account, ticket 4417')$q$, '22023', '%has not been merged%');
  perform t.must_fail($q$select public.network_media_assets_follow_merge('a0000000-0000-4000-8000-00000000000a',
    'a0000000-0000-4000-8000-00000000000a', 'duplicate account, ticket 4417')$q$, '22023', 'two distinct M UIDs are required');

  -- the merge itself, as production runs it (0049): C's login now belongs to A
  perform public.m_merge_people('a0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-00000000000c');
  if (select m_uid from public.m_auth_user_links where auth_user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
       <> 'a0000000-0000-4000-8000-00000000000a' then raise exception 'm_merge_people did not move the login'; end if;
  -- ...and it left owner_m_uid behind: C's uploads now prove as nobody's
  if (select count(*) from public.network_media_assets where owner_m_uid = 'c0000000-0000-4000-8000-00000000000c') <> 3 then
    raise exception 'expected C''s three rows to still be owned by the merged person';
  end if;
  if public.network_media_upload_owned_by('mnet-media',
       'cccccccc-cccc-4ccc-8ccc-cccccccccccc/10000000-0000-4000-8000-0000000000c1-one.png', 'c0000000-0000-4000-8000-00000000000c') then
    raise exception 'after the merge C''s login must no longer prove as C''s';
  end if;

  -- a person only MARKED merged still holds its login: m_merge_people did not run for it
  execute 'reset role';
  update public.m_people set status = 'merged' where id = 'b0000000-0000-4000-8000-00000000000b';
  perform t.as_service();
  perform t.must_fail($q$select public.network_media_assets_follow_merge('a0000000-0000-4000-8000-00000000000a',
    'b0000000-0000-4000-8000-00000000000b', 'marked merged by hand, ticket 4417')$q$, '22023', '%still holds a login%');
  execute 'reset role';
  update public.m_people set status = 'active' where id = 'b0000000-0000-4000-8000-00000000000b';
  perform t.as_service();

  -- no shortcut: a plain UPDATE of the owner is refused for the service role and the owner
  perform t.must_fail($q$update public.network_media_assets set owner_m_uid = 'a0000000-0000-4000-8000-00000000000a'
    where owner_m_uid = 'c0000000-0000-4000-8000-00000000000c'$q$, '42501', 'network_media_asset_owner_immutable');
  execute 'reset role';
  perform t.must_fail($q$update public.network_media_assets set owner_m_uid = 'a0000000-0000-4000-8000-00000000000a'
    where id = 'e0000000-0000-4000-8000-0000000000c1'$q$, '42501', 'network_media_asset_owner_immutable');

  -- who may call it, and how
  perform t.as_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  perform t.must_fail($q$select public.network_media_assets_follow_merge('a0000000-0000-4000-8000-00000000000a',
    'c0000000-0000-4000-8000-00000000000c', 'duplicate account, ticket 4417')$q$, '42501', 'permission denied for function %');
  perform t.as_service();
  perform t.must_fail($q$select public.network_media_assets_follow_merge('a0000000-0000-4000-8000-00000000000a',
    'c0000000-0000-4000-8000-00000000000c', 'short')$q$, '22023', 'a reason of 8 to 500 characters is required');
  perform t.must_fail($q$select public.network_media_assets_follow_merge('c0000000-0000-4000-8000-00000000000c',
    'a0000000-0000-4000-8000-00000000000a', 'the wrong way round, ticket 4417')$q$, '22023', '%itself merged away%');
  -- a person who was not merged gives up nothing, whatever the reason says
  perform t.must_fail($q$select public.network_media_assets_follow_merge('a0000000-0000-4000-8000-00000000000a',
    'b0000000-0000-4000-8000-00000000000b', 'take B''s uploads, ticket 4417')$q$, '22023', '%has not been merged%');
  -- a reason nobody can read is no reason
  perform t.must_fail($q$select public.network_media_assets_follow_merge('a0000000-0000-4000-8000-00000000000a',
    'c0000000-0000-4000-8000-00000000000c', E'\t\t\t\t\n\n\n\n')$q$, '22023', 'a reason of 8 to 500 characters is required');

  -- THE WRONG KEPT PERSON. C was merged into A, not into B. C once wrote a row
  -- naming B's upload (seed row 1e). B holds that login, but as B's own, not
  -- through a merge: nothing moves, and the pointer does not become B's row.
  v_out := public.network_media_assets_follow_merge('b0000000-0000-4000-8000-00000000000b',
             'c0000000-0000-4000-8000-00000000000c', 'tidy the unlinked rows, ticket 5521');
  if v_out <> '{"moved": 0, "left": 3}'::jsonb then raise exception 'follow_merge to the wrong person answered %', v_out; end if;
  if (select owner_m_uid from public.network_media_assets where id = 'e0000000-0000-4000-8000-00000000001e')
       <> 'c0000000-0000-4000-8000-00000000000c' then
    raise exception 'a row naming somebody else''s upload became that person''s';
  end if;

  -- the path: the two uploads made with C's login follow it. C's row naming
  -- B's upload does not: B's login is not A's.
  v_out := public.network_media_assets_follow_merge('a0000000-0000-4000-8000-00000000000a',
             'c0000000-0000-4000-8000-00000000000c', 'duplicate account, ticket 4417');
  if v_out <> '{"moved": 2, "left": 1}'::jsonb then raise exception 'follow_merge answered %', v_out; end if;
  if (select count(*) from public.network_media_assets
       where id in ('e0000000-0000-4000-8000-0000000000c1', 'e0000000-0000-4000-8000-0000000000c2')
         and owner_m_uid = 'a0000000-0000-4000-8000-00000000000a'
         and object_path like 'cccccccc-cccc-4ccc-8ccc-cccccccccccc/%') <> 2 then
    raise exception 'the uploads did not follow the merge, or their paths moved';
  end if;
  if not public.network_media_upload_owned_by('mnet-media',
       'cccccccc-cccc-4ccc-8ccc-cccccccccccc/10000000-0000-4000-8000-0000000000c1-one.png', 'a0000000-0000-4000-8000-00000000000a') then
    raise exception 'after the move the upload must prove as A''s';
  end if;
  if (select owner_m_uid from public.network_media_assets where id = 'e0000000-0000-4000-8000-00000000001e')
       <> 'c0000000-0000-4000-8000-00000000000c' then
    raise exception 'a row whose login is not the kept person''s must be left where it is';
  end if;

  -- the record: one row per asset, readable by the service role, written by nobody else
  select count(*) into v_moves from public.network_media_asset_owner_moves
   where from_m_uid = 'c0000000-0000-4000-8000-00000000000c' and to_m_uid = 'a0000000-0000-4000-8000-00000000000a'
     and uploader_auth_user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and reason = 'duplicate account, ticket 4417'
     and moved_by_jwt_role = 'service_role' and txid = txid_current();
  if v_moves <> 2 then raise exception 'expected 2 audit rows, found %', v_moves; end if;
  perform t.must_fail($q$insert into public.network_media_asset_owner_moves
      (asset_id, from_m_uid, to_m_uid, uploader_auth_user_id, bucket_id, object_path, reason)
    values ('e0000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'mnet-media', 'x', 'a forged record')$q$,
    '42501', 'permission denied for table network_media_asset_owner_moves');
  perform t.must_fail($q$delete from public.network_media_asset_owner_moves$q$,
    '42501', 'permission denied for table network_media_asset_owner_moves');
  -- a second run has nothing left to move
  v_out := public.network_media_assets_follow_merge('a0000000-0000-4000-8000-00000000000a',
             'c0000000-0000-4000-8000-00000000000c', 'duplicate account, ticket 4417 (again)');
  if v_out <> '{"moved": 0, "left": 1}'::jsonb then raise exception 'second follow_merge answered %', v_out; end if;

  perform t.as_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  perform t.must_fail($q$select count(*) from public.network_media_asset_owner_moves$q$,
    '42501', 'permission denied for table network_media_asset_owner_moves');
  execute 'reset role';
  -- even the table's owner cannot rewrite the record
  perform t.must_fail($q$update public.network_media_asset_owner_moves set reason = 'rewritten afterwards'$q$,
    '42501', 'network_media_asset_owner_moves_append_only');
  perform t.must_fail($q$delete from public.network_media_asset_owner_moves$q$,
    '42501', 'network_media_asset_owner_moves_append_only');
  -- ...and the table itself refuses a record nobody can read, or a move to the same person
  perform t.must_fail($q$insert into public.network_media_asset_owner_moves
      (asset_id, from_m_uid, to_m_uid, uploader_auth_user_id, bucket_id, object_path, reason)
    values ('e0000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'mnet-media', 'x', E'\t\t\t\t\n\n\n\n')$q$,
    '23514', '%network_media_asset_owner_moves_reason_check%');
  perform t.must_fail($q$insert into public.network_media_asset_owner_moves
      (asset_id, from_m_uid, to_m_uid, uploader_auth_user_id, bucket_id, object_path, reason)
    values ('e0000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'mnet-media', 'x', 'a move to the same person')$q$,
    '23514', '%network_media_asset_owner_moves_check%');
  raise notice '9. after m_merge_people, follow_merge moved 2 uploads with 2 audit rows, moved nothing to the wrong person, left the row naming B''s upload, and nothing else can move an owner';
end $$;

-- Each change of owner needs its own record, written in its own transaction.
-- Put one moved upload back under the merged person behind the guard's back
-- (the table owner, trigger off), then repeat the very move the record of the
-- earlier transaction describes: the old record authorizes nothing.
alter table public.network_media_assets disable trigger network_media_assets_guard_trg;
update public.network_media_assets set owner_m_uid = 'c0000000-0000-4000-8000-00000000000c'
 where id = 'e0000000-0000-4000-8000-0000000000c1';
alter table public.network_media_assets enable trigger network_media_assets_guard_trg;
do $$
begin
  if not exists (select 1 from public.network_media_asset_owner_moves
                  where asset_id = 'e0000000-0000-4000-8000-0000000000c1'
                    and from_m_uid = 'c0000000-0000-4000-8000-00000000000c' and to_m_uid = 'a0000000-0000-4000-8000-00000000000a'
                    and txid <> txid_current()) then
    raise exception 'expected the earlier transaction''s record of this exact move';
  end if;
  perform t.as_service();
  perform t.must_fail($q$update public.network_media_assets set owner_m_uid = 'a0000000-0000-4000-8000-00000000000a'
    where id = 'e0000000-0000-4000-8000-0000000000c1'$q$, '42501', 'network_media_asset_owner_immutable');
  -- the path itself does it again, with a record of its own
  if public.network_media_assets_follow_merge('a0000000-0000-4000-8000-00000000000a',
       'c0000000-0000-4000-8000-00000000000c', 'restored row, ticket 4417') <> '{"moved": 1, "left": 1}'::jsonb then
    raise exception 'the merge path did not move the restored row';
  end if;
  execute 'reset role';
  if (select count(*) from public.network_media_asset_owner_moves where asset_id = 'e0000000-0000-4000-8000-0000000000c1') <> 2 then
    raise exception 'two moves of one upload must leave two records';
  end if;
  raise notice '9b. a record from an earlier transaction authorizes nothing: the same move needs the path, and a record, again';
end $$;

------------------------------------------------------------------------------
-- 10. An account is removed: its uploads go with it (ON DELETE CASCADE), the
--     guard does not stand in the way.
------------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  insert into auth.users (id, email) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'd@example.test');
  insert into public.m_people (id) values ('d0000000-0000-4000-8000-00000000000d');
  insert into public.m_auth_user_links (auth_user_id, m_uid, link_method, is_primary)
  values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'd0000000-0000-4000-8000-00000000000d', 'signup', true);
  perform t.as_service();
  insert into public.network_media_assets (owner_m_uid, bucket_id, object_path, media_type, mime_type, status)
  values ('d0000000-0000-4000-8000-00000000000d', 'mnet-media',
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd/20000000-0000-4000-8000-0000000000d1-mine.png', 'image', 'image/png', 'ready');
  delete from public.m_people where id = 'd0000000-0000-4000-8000-00000000000d';
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'the person was not deleted'; end if;
  if exists (select 1 from public.network_media_assets where owner_m_uid = 'd0000000-0000-4000-8000-00000000000d') then
    raise exception 'the deleted person''s uploads were not removed';
  end if;
  execute 'reset role';
  delete from auth.users where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  raise notice '10. deleting a person still removes their upload rows';
end $$;

------------------------------------------------------------------------------
-- 11. NOT closed by this file, on purpose, and written down so nobody takes
--     it for closed (README, owner decisions). The service role may still set
--     any status, and the mnet-media function does exactly that for the row's
--     owner: finalize writes status 'ready' whatever the status was
--     (index.ts:120-124), and discard then deletes a row that is ready and has
--     no post (index.ts:102-105). So through POST /v1/mnet/media/finalize and
--     /discard a member still un-blocks an upload and frees and removes the
--     evidence reserved for a public FBI case. The fix is in the function.
------------------------------------------------------------------------------
do $$
begin
  perform t.as_service();
  -- finalize's patch, on a blocked row, a deleted row and reserved evidence
  perform t.must_change($q$update public.network_media_assets set status = 'ready', updated_at = now()
    where id = 'e0000000-0000-4000-8000-0000000000f7' and status = 'blocked'$q$, 1);
  perform t.must_change($q$update public.network_media_assets set status = 'ready', updated_at = now()
    where id = 'e0000000-0000-4000-8000-0000000000f8' and status = 'deleted'$q$, 1);
  perform t.must_change($q$update public.network_media_assets set status = 'ready', updated_at = now()
    where id = 'e0000000-0000-4000-8000-0000000000f1' and status = 'attached' and post_id is null$q$, 1);
  -- discard's delete, on that evidence: the public case now names a row that is gone
  perform t.must_change($q$delete from public.network_media_assets
    where id = 'e0000000-0000-4000-8000-0000000000f1' and owner_m_uid = 'a0000000-0000-4000-8000-00000000000a' and post_id is null$q$, 1);
  if not exists (select 1 from public.fbi_cases c where 'e0000000-0000-4000-8000-0000000000f1' = any (c.media_asset_ids) and c.status = 'public') then
    raise exception 'the seeded public case should still name the removed evidence';
  end if;
  raise notice '11. residual, as documented: the service role (finalize, discard) can still un-block an upload and remove reserved FBI evidence';
end $$;
