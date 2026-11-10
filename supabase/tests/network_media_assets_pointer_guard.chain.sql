-- A second merge on top of the first, run by
-- scripts/test-network-media-pointer-guard-db.sh after the behaviour test:
-- C was merged into A there, and now A is merged into B.
--   psql -v follow=false   public.m_merge_people(B, A), as production runs it
--   psql -v follow=true    public.network_media_assets_follow_merge(B, A, ...)
-- Between the two the driver reads scripts/db/media-asset-pointer-guard-precheck.sql:
-- the uploads waiting to follow a merge are counted apart from rows that name
-- somebody else's upload. Scratch database only.
\set ON_ERROR_STOP on
\if :follow

do $$
declare v_out jsonb;
begin
  perform t.as_service();
  v_out := public.network_media_assets_follow_merge('b0000000-0000-4000-8000-00000000000b',
             'a0000000-0000-4000-8000-00000000000a', 'second account merged, ticket 6001');
  -- A's own eight uploads (login A) and the two that had followed C's merge
  -- (login C) reached B through a merge. A's row naming B's upload did not:
  -- that login is B's own, so the pointer A once wrote is not made B's row.
  if v_out <> '{"moved": 10, "left": 1}'::jsonb then raise exception 'follow_merge(B, A) answered %', v_out; end if;
  if (select owner_m_uid from public.network_media_assets where id = 'e0000000-0000-4000-8000-00000000001c')
       <> 'a0000000-0000-4000-8000-00000000000a' then
    raise exception 'a row naming the kept person''s own upload was made that person''s row';
  end if;
  -- One upload's record moves no other upload. This transaction now holds ten
  -- records "from A to B", and B does hold the login in the left row's path:
  -- a plain UPDATE of that row is still refused, there is no record of ITS move.
  perform t.must_fail($q$update public.network_media_assets set owner_m_uid = 'b0000000-0000-4000-8000-00000000000b'
    where id = 'e0000000-0000-4000-8000-00000000001c'$q$, '42501', 'network_media_asset_owner_immutable');
  if exists (select 1 from public.network_media_assets a
              where a.owner_m_uid = 'b0000000-0000-4000-8000-00000000000b'
                and not public.network_media_upload_owned_by(a.bucket_id, a.object_path, a.owner_m_uid)) then
    raise exception 'B owns a row that does not prove as B''s';
  end if;
  if (select count(*) from public.network_media_assets where owner_m_uid = 'b0000000-0000-4000-8000-00000000000b') <> 11 then
    raise exception 'B should own its own upload and the ten that followed';
  end if;
  -- C's leftover, asked again through the person who now holds everything: still not moved
  v_out := public.network_media_assets_follow_merge('b0000000-0000-4000-8000-00000000000b',
             'c0000000-0000-4000-8000-00000000000c', 'first merge, asked again, ticket 6001');
  if v_out <> '{"moved": 0, "left": 1}'::jsonb then raise exception 'follow_merge(B, C) answered %', v_out; end if;
  raise notice 'a second merge: 10 uploads followed A into B; the two rows that name B''s own uploads stayed where they were';
end $$;

-- Two merges with no follow in between (X into Y, then Y into Z): one call per
-- merged person, each naming the person who holds the logins NOW. Naming the
-- person in the middle is refused: that person was merged away. Rolled back,
-- so the driver's counts do not see these three people.
begin;
do $$
declare v_out jsonb;
begin
  insert into auth.users (id, email) values
    ('11111111-1111-4111-8111-111111111111', 'x@example.test'),
    ('22222222-2222-4222-8222-222222222222', 'y@example.test'),
    ('33333333-3333-4333-8333-333333333333', 'z@example.test');
  insert into public.m_people (id) values
    ('10000000-0000-4000-8000-000000000001'), ('20000000-0000-4000-8000-000000000002'), ('30000000-0000-4000-8000-000000000003');
  insert into public.m_auth_user_links (auth_user_id, m_uid, link_method, is_primary) values
    ('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-000000000001', 'signup', true),
    ('22222222-2222-4222-8222-222222222222', '20000000-0000-4000-8000-000000000002', 'signup', true),
    ('33333333-3333-4333-8333-333333333333', '30000000-0000-4000-8000-000000000003', 'signup', true);
  perform t.as_service();
  insert into public.network_media_assets (id, owner_m_uid, bucket_id, object_path, media_type, mime_type, status) values
    ('e0000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-000000000001', 'mnet-media',
     '11111111-1111-4111-8111-111111111111/40000000-0000-4000-8000-0000000000a1-x.png', 'image', 'image/png', 'ready'),
    ('e0000000-0000-4000-8000-0000000000a2', '20000000-0000-4000-8000-000000000002', 'mnet-media',
     '22222222-2222-4222-8222-222222222222/40000000-0000-4000-8000-0000000000a2-y.png', 'image', 'image/png', 'ready');
  perform public.m_merge_people('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');
  perform public.m_merge_people('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002');

  perform t.must_fail($q$select public.network_media_assets_follow_merge('20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001', 'first merge of the chain, ticket 6002')$q$, '22023', '%itself merged away%');
  v_out := public.network_media_assets_follow_merge('30000000-0000-4000-8000-000000000003',
             '10000000-0000-4000-8000-000000000001', 'first merge of the chain, ticket 6002');
  if v_out <> '{"moved": 1, "left": 0}'::jsonb then raise exception 'follow_merge(Z, X) answered %', v_out; end if;
  v_out := public.network_media_assets_follow_merge('30000000-0000-4000-8000-000000000003',
             '20000000-0000-4000-8000-000000000002', 'second merge of the chain, ticket 6002');
  if v_out <> '{"moved": 1, "left": 0}'::jsonb then raise exception 'follow_merge(Z, Y) answered %', v_out; end if;
  if (select count(*) from public.network_media_assets a
       where a.id in ('e0000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-0000000000a2')
         and a.owner_m_uid = '30000000-0000-4000-8000-000000000003'
         and public.network_media_upload_owned_by(a.bucket_id, a.object_path, a.owner_m_uid)) <> 2 then
    raise exception 'after a chain of merges both uploads must be the last kept person''s, and prove so';
  end if;
  if (select count(*) from public.network_media_asset_owner_moves
       where to_m_uid = '30000000-0000-4000-8000-000000000003' and txid = txid_current()) <> 2 then
    raise exception 'a chain of merges must leave one record per upload';
  end if;
  raise notice 'two merges before any follow: each merged person''s uploads go straight to the person who holds the logins now';
end $$;
rollback;

\else

do $$
begin
  perform t.as_service();
  perform public.m_merge_people('b0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-00000000000a');
  if exists (select 1 from public.m_auth_user_links where m_uid = 'a0000000-0000-4000-8000-00000000000a') then
    raise exception 'm_merge_people left a login with the merged person';
  end if;
end $$;

\endif
