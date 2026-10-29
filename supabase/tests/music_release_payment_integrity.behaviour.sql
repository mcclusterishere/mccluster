-- Behaviour tests for supabase/pending/music_release_payment_integrity_v1.sql,
-- as the real API roles with the JWT claims Supabase would set. Runs against a
-- scratch database (scripts/test-music-release-integrity-db.sh) after
-- supabase/tests/music_release_payment_integrity.seed.sql. Every check raises
-- on failure.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  execute 'set role service_role';
end $$;
create or replace function pg_temp.must_fail(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlerrm not ilike p_like then raise exception 'expected error like % from [%], got: %', p_like, p_sql, sqlerrm; end if;
    return;
  end;
  raise exception 'expected failure (%), but it succeeded: %', p_like, p_sql;
end $$;
create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FAILED: %', p_what; end if; end $$;

-- ids
--   Ana auth 00..a1 / M 10..a1      Bo auth 00..b1 / M 10..b1
--   Honest 20..a1 (published)       Borrowed 20..a2 (published, Bo's master)
--   offer 30..a1 on Honest (fee lowered to 1 bp before the file)
\set A '''00000000-0000-4000-8000-0000000000a1'''
\set B '''00000000-0000-4000-8000-0000000000b1'''
\set PUB '''https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/'''

------------------------------------------------------------------------------
-- What the file did to the catalogue it found
------------------------------------------------------------------------------
select pg_temp.as_service();
select pg_temp.check((select count(*) from public.music_creator_assets) = 5, 'every existing creator object is in the registry');
select pg_temp.check((select owner_user_id from public.music_creator_assets
                       where bucket_id='creator-masters' and object_name like '%b1/b-master.wav') = :B::uuid,
                     'Bo''s legacy master is recorded as Bo''s');
select pg_temp.check((select status from public.creator_tracks where id='20000000-0000-4000-8000-0000000000a2') = 'pending_review',
                     'a published release pointing at another creator''s master went back to review');
select pg_temp.check((select published_at is null and rights_status = 'review' from public.creator_tracks
                       where id='20000000-0000-4000-8000-0000000000a2'), 'and is no longer published or cleared');
select pg_temp.check((select status = 'published' and reviewed_digest is not null
                       and reviewed_digest = public.music_review_digest(public.music_track_reviewed_snapshot(t))
                       from public.creator_tracks t where id='20000000-0000-4000-8000-0000000000a1'),
                     'an honest published release keeps its status and has its reviewed snapshot');
-- (e) backfill pinned the live master's exact Storage identity into the review
select pg_temp.check((select v.pinned_via = 'legacy_backfill' and v.object_name = t.master_path
                       and v.identity = public.music_object_identity('creator-masters', t.master_path)
                       and t.reviewed_snapshot->'approved_master' = v.identity
                       from public.creator_tracks t join public.music_asset_versions v on v.id = t.approved_master_version_id
                      where t.id='20000000-0000-4000-8000-0000000000a1'),
                     'backfill pinned an honest release''s master (object id, version, eTag, size) into its reviewed snapshot');
select pg_temp.check((select approved_master_version_id is null from public.creator_tracks where id='20000000-0000-4000-8000-0000000000a2'),
                     'a release sent back to review has no pinned version');
select pg_temp.check(public.music_track_assets_verified('20000000-0000-4000-8000-0000000000a1'), 'honest assets verify');
select pg_temp.check(not public.music_track_assets_verified('20000000-0000-4000-8000-0000000000a2'), 'borrowed assets do not verify');
select pg_temp.check((select platform_fee_bps from public.music_license_offers where id='30000000-0000-4000-8000-0000000000a1') = 1500,
                     'a lowered commission is back to the server''s');

------------------------------------------------------------------------------
-- (a) ownership comes from the server's record, never the path
------------------------------------------------------------------------------
-- music-access records the grants it issues; the objects land with no owner.
insert into public.music_creator_assets(bucket_id, object_name, owner_user_id, owner_m_uid) values
  ('creator-masters',  '00000000-0000-4000-8000-0000000000a1/a2-master.wav', :A, '10000000-0000-4000-8000-0000000000a1'),
  ('creator-previews', '00000000-0000-4000-8000-0000000000a1/a2-preview.mp3', :A, '10000000-0000-4000-8000-0000000000a1'),
  -- a path that LOOKS like Ana's but the server recorded as Bo's
  ('creator-masters',  '00000000-0000-4000-8000-0000000000a1/looks-like-ana.wav', :B, '10000000-0000-4000-8000-0000000000b1'),
  -- a path that looks like Bo's but the server recorded as Ana's
  ('creator-masters',  '00000000-0000-4000-8000-0000000000b1/really-ana.wav', :A, '10000000-0000-4000-8000-0000000000a1');
insert into storage.objects(bucket_id, name, owner, owner_id) values
  ('creator-masters',  '00000000-0000-4000-8000-0000000000a1/a2-master.wav', null, null),
  ('creator-previews', '00000000-0000-4000-8000-0000000000a1/a2-preview.mp3', null, null),
  ('creator-masters',  '00000000-0000-4000-8000-0000000000a1/looks-like-ana.wav', null, null),
  ('creator-masters',  '00000000-0000-4000-8000-0000000000b1/really-ana.wav', null, null);

select pg_temp.as_user(:A);
select pg_temp.must_fail($$insert into public.creator_tracks(title, artist, master_path)
  values ('Theft', 'Ana', '00000000-0000-4000-8000-0000000000b1/b-master.wav')$$, '%creator_asset_not_owned%');
select pg_temp.must_fail($$insert into public.creator_tracks(title, artist, master_path)
  values ('Prefix', 'Ana', '00000000-0000-4000-8000-0000000000a1/looks-like-ana.wav')$$, '%creator_asset_not_owned%');
select pg_temp.must_fail($$insert into public.creator_tracks(title, artist, preview_path)
  values ('Theft', 'Ana', '00000000-0000-4000-8000-0000000000b1/b-preview.mp3')$$, '%creator_asset_not_owned%');
select pg_temp.must_fail($$insert into public.creator_tracks(title, artist, master_path)
  values ('Ghost', 'Ana', '00000000-0000-4000-8000-0000000000a1/never-uploaded.wav')$$, '%creator_asset_not_owned%');
-- a URL is a reference too
select pg_temp.must_fail($$insert into public.creator_tracks(title, artist, preview_path, audio_url)
  values ('Url', 'Ana', '00000000-0000-4000-8000-0000000000a1/a2-preview.mp3',
          'https://evil.example/storage/v1/object/public/creator-previews/00000000-0000-4000-8000-0000000000a1/a2-preview.mp3')$$,
  '%creator_asset_not_owned%');
select pg_temp.must_fail($$insert into public.creator_tracks(title, artist, preview_path, audio_url)
  values ('Url', 'Ana', '00000000-0000-4000-8000-0000000000a1/a2-preview.mp3',
          'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/creator-previews/00000000-0000-4000-8000-0000000000b1/b-preview.mp3')$$,
  '%creator_asset_not_owned%');
select pg_temp.must_fail($$insert into public.creator_tracks(title, artist, poster_url)
  values ('Art', 'Ana', 'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/creator-artwork/00000000-0000-4000-8000-0000000000b1/b-cover.png')$$,
  '%creator_asset_not_owned%');
-- the bucket is not the creator's to choose: the owner's gated bucket is ignored
insert into public.creator_tracks(id, title, artist, master_bucket, master_path)
values ('20000000-0000-4000-8000-0000000000a9', 'Bucket', 'Ana', 'mcc-gated-audio', '00000000-0000-4000-8000-0000000000a1/a2-master.wav');
select pg_temp.check((select master_bucket from public.creator_tracks where id='20000000-0000-4000-8000-0000000000a9') = 'creator-masters',
                     'the master bucket is pinned');
delete from public.creator_tracks where id='20000000-0000-4000-8000-0000000000a9';

-- Ana's own grant uploads, including one in a folder named after Bo
insert into public.creator_tracks(id, title, artist, slug, preview_path, master_path, audio_url)
values ('20000000-0000-4000-8000-0000000000a3', 'Fresh', 'Ana', 'fresh',
        '00000000-0000-4000-8000-0000000000a1/a2-preview.mp3', '00000000-0000-4000-8000-0000000000a1/a2-master.wav',
        :PUB || 'creator-previews/00000000-0000-4000-8000-0000000000a1/a2-preview.mp3');
select pg_temp.check((select master_bucket = 'creator-masters' and preview_bucket = 'creator-previews' and status = 'draft'
                       from public.creator_tracks where id='20000000-0000-4000-8000-0000000000a3'), 'own uploads accepted, buckets pinned');
update public.creator_tracks set master_path = '00000000-0000-4000-8000-0000000000b1/really-ana.wav'
 where id = '20000000-0000-4000-8000-0000000000a3';
select pg_temp.must_fail($$update public.creator_tracks set master_path = '00000000-0000-4000-8000-0000000000b1/b-master.wav'
  where id = '20000000-0000-4000-8000-0000000000a3'$$, '%creator_asset_not_owned%');

-- a direct upload is owned by whoever Storage stamped
insert into storage.objects(bucket_id, name) values ('creator-artwork', '00000000-0000-4000-8000-0000000000a1/cover.png');
update public.creator_tracks set poster_url = :PUB || 'creator-artwork/00000000-0000-4000-8000-0000000000a1/cover.png'
 where id = '20000000-0000-4000-8000-0000000000a3';
update public.creator_tracks set master_path = '00000000-0000-4000-8000-0000000000a1/a2-master.wav'
 where id = '20000000-0000-4000-8000-0000000000a3';

-- storage: Ana reads, changes and removes her own objects only
select pg_temp.check((select count(*) from storage.objects where bucket_id='creator-masters'
                       and name = '00000000-0000-4000-8000-0000000000a1/a2-master.wav') = 1, 'Ana reads her own grant-uploaded master');
select pg_temp.check((select count(*) from storage.objects where bucket_id='creator-masters'
                       and name = '00000000-0000-4000-8000-0000000000b1/b-master.wav') = 0, 'Ana cannot read Bo''s master');
select pg_temp.check((select count(*) from storage.objects where bucket_id='creator-masters'
                       and name = '00000000-0000-4000-8000-0000000000a1/looks-like-ana.wav') = 0,
                     'a folder named after Ana is not Ana''s object');
with d as (delete from storage.objects where bucket_id='creator-masters'
           and name in ('00000000-0000-4000-8000-0000000000b1/b-master.wav', '00000000-0000-4000-8000-0000000000a1/looks-like-ana.wav')
           returning 1)
select pg_temp.check((select count(*) from d) = 0, 'Ana cannot delete Bo''s objects, whatever folder they are in');
select pg_temp.must_fail($$insert into storage.objects(bucket_id, name) values ('creator-masters', '00000000-0000-4000-8000-0000000000b1/x.wav')$$,
  '%row-level security%');

-- publishing is refused for a release whose assets are not its creator's
select pg_temp.as_service();
select pg_temp.must_fail($$update public.creator_tracks set status='published', rights_status='cleared', published_at=now()
  where id='20000000-0000-4000-8000-0000000000a2'$$, '%release_asset_not_owned%');

------------------------------------------------------------------------------
-- (b) a reviewed release cannot change under its review
------------------------------------------------------------------------------
update public.creator_tracks set status='published', rights_status='cleared', published_at=now()
 where id='20000000-0000-4000-8000-0000000000a3';
select pg_temp.check((select reviewed_snapshot->>'title' = 'Fresh' and reviewed_at is not null
                       from public.creator_tracks where id='20000000-0000-4000-8000-0000000000a3'), 'publishing freezes the reviewed snapshot');
insert into public.music_license_offers(id, track_id, creator_m_uid, slug, title, license_type, price_cents, currency, terms_text, active, checkout_enabled)
values ('30000000-0000-4000-8000-0000000000a3', '20000000-0000-4000-8000-0000000000a3', '10000000-0000-4000-8000-0000000000a1',
        'commercial-fresh', 'Commercial', 'commercial_basic', 2000, 'usd', 'Terms.', true, true);

select pg_temp.as_user(:A);
-- metadata
update public.creator_tracks set title = 'Fresh (edited)' where id='20000000-0000-4000-8000-0000000000a3';
select pg_temp.check((select status = 'pending_review' and rights_status = 'review' and published_at is null
                       from public.creator_tracks where id='20000000-0000-4000-8000-0000000000a3'),
                     'editing a published title sends it back to review');
select pg_temp.as_service();
select pg_temp.check((select not active and not checkout_enabled from public.music_license_offers
                       where id='30000000-0000-4000-8000-0000000000a3'), 'and takes its offers off sale');
select pg_temp.check((select reviewed_snapshot->>'title' = 'Fresh' from public.creator_tracks
                       where id='20000000-0000-4000-8000-0000000000a3'), 'the reviewed snapshot still holds what was reviewed');
select pg_temp.check((select count(*) from public.creator_tracks where status='published' and title='Fresh (edited)') = 0,
                     'the unreviewed edit is not published');

-- re-review, then change audio, artwork, rights, access in turn
update public.creator_tracks set status='approved', rights_status='cleared' where id='20000000-0000-4000-8000-0000000000a3';
select pg_temp.as_user(:A);
update public.creator_tracks set master_path = '00000000-0000-4000-8000-0000000000b1/really-ana.wav' where id='20000000-0000-4000-8000-0000000000a3';
select pg_temp.check((select status from public.creator_tracks where id='20000000-0000-4000-8000-0000000000a3') = 'pending_review',
                     'changing approved audio sends it back to review');
select pg_temp.as_service();
update public.creator_tracks set status='published', rights_status='cleared' where id='20000000-0000-4000-8000-0000000000a3';
select pg_temp.as_user(:A);
update public.creator_tracks set poster_url = '' where id='20000000-0000-4000-8000-0000000000a3';
select pg_temp.check((select status from public.creator_tracks where id='20000000-0000-4000-8000-0000000000a3') = 'pending_review',
                     'changing published artwork sends it back to review');
select pg_temp.as_service();
update public.creator_tracks set status='published', rights_status='cleared' where id='20000000-0000-4000-8000-0000000000a3';
select pg_temp.as_user(:A);
update public.creator_tracks set rights_declaration = '{"owns_master":false}' where id='20000000-0000-4000-8000-0000000000a3';
select pg_temp.check((select status from public.creator_tracks where id='20000000-0000-4000-8000-0000000000a3') = 'pending_review',
                     'changing the rights declaration sends it back to review');
select pg_temp.as_service();
update public.creator_tracks set status='published', rights_status='cleared' where id='20000000-0000-4000-8000-0000000000a3';
select pg_temp.as_user(:A);
update public.creator_tracks set access_mode = 'purchase' where id='20000000-0000-4000-8000-0000000000a3';
select pg_temp.check((select status from public.creator_tracks where id='20000000-0000-4000-8000-0000000000a3') = 'pending_review',
                     'changing access sends it back to review');
-- a creator cannot publish or clear by themselves
update public.creator_tracks set status='published', rights_status='cleared', published_at=now() where id='20000000-0000-4000-8000-0000000000a3';
select pg_temp.check((select status = 'pending_review' and rights_status = 'review' from public.creator_tracks
                       where id='20000000-0000-4000-8000-0000000000a3'), 'a creator cannot self-publish');
-- nor forge the reviewed snapshot
update public.creator_tracks set reviewed_digest = 'x', reviewed_snapshot = '{}' where id='20000000-0000-4000-8000-0000000000a3';
select pg_temp.check((select reviewed_digest <> 'x' from public.creator_tracks where id='20000000-0000-4000-8000-0000000000a3'),
                     'a creator cannot write the reviewed snapshot');
-- even the service role cannot change published content without a fresh review
select pg_temp.as_service();
update public.creator_tracks set status='published', rights_status='cleared' where id='20000000-0000-4000-8000-0000000000a3';
update public.creator_tracks set genre = 'changed by an operator' where id='20000000-0000-4000-8000-0000000000a3';
select pg_temp.check((select status from public.creator_tracks where id='20000000-0000-4000-8000-0000000000a3') = 'pending_review',
                     'a service-role content change also needs a fresh review');
-- a status-only change on a published row is not a content change
update public.creator_tracks set status='published', rights_status='cleared' where id='20000000-0000-4000-8000-0000000000a3';
update public.creator_tracks set moderation_note = 'noted' where id='20000000-0000-4000-8000-0000000000a3';
select pg_temp.check((select status from public.creator_tracks where id='20000000-0000-4000-8000-0000000000a3') = 'published',
                     'a moderation note does not unpublish');

------------------------------------------------------------------------------
-- (c) the commission is the server's
------------------------------------------------------------------------------
select pg_temp.as_user(:A);
insert into public.music_license_offers(id, track_id, slug, title, license_type, price_cents, currency, terms_text,
                                        active, checkout_enabled, platform_fee_bps)
values ('30000000-0000-4000-8000-0000000000a4', '20000000-0000-4000-8000-0000000000a3', 'cheap', 'Cheap', 'commercial_basic',
        5000, 'usd', 'Terms.', true, true, 0);
select pg_temp.check((select platform_fee_bps = 1500 and not active and not checkout_enabled
                       from public.music_license_offers where id='30000000-0000-4000-8000-0000000000a4'),
                     'a creator''s offer gets the server''s fee and starts off sale');
update public.music_license_offers set platform_fee_bps = 1, active = true, checkout_enabled = true
 where id='30000000-0000-4000-8000-0000000000a4';
select pg_temp.check((select platform_fee_bps = 1500 and not active and not checkout_enabled
                       from public.music_license_offers where id='30000000-0000-4000-8000-0000000000a4'),
                     'a creator cannot lower the fee or switch checkout on');
select pg_temp.as_service();
update public.music_license_offers set active = true, checkout_enabled = true where id='30000000-0000-4000-8000-0000000000a4';
select pg_temp.as_user(:A);
update public.music_license_offers set price_cents = 1 where id='30000000-0000-4000-8000-0000000000a4';
select pg_temp.check((select not active and not checkout_enabled from public.music_license_offers
                       where id='30000000-0000-4000-8000-0000000000a4'), 'repricing a live offer takes it off sale');
select pg_temp.must_fail($$update public.music_license_offers set track_id='20000000-0000-4000-8000-0000000000a1'
  where id='30000000-0000-4000-8000-0000000000a4'$$, '%license_offer_forbidden%');
select pg_temp.as_user(:B);
select pg_temp.must_fail($$insert into public.music_license_offers(track_id, slug, title, license_type, price_cents, terms_text)
  values ('20000000-0000-4000-8000-0000000000a3', 'bo', 'Bo', 'commercial_basic', 100, 'T')$$, '%license_offer_forbidden%');

select pg_temp.as_service();
select pg_temp.must_fail($$insert into public.music_orders(offer_id, track_id, creator_m_uid, customer_email, stripe_checkout_session_id,
  amount_cents, platform_fee_cents, creator_net_cents, currency) values ('30000000-0000-4000-8000-0000000000a1',
  '20000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'c@test', 'cs_tampered', 1000, 0, 1000, 'usd')$$,
  '%music_order_fee_mismatch%');
insert into public.music_orders(id, offer_id, track_id, creator_m_uid, customer_email, stripe_checkout_session_id,
  amount_cents, platform_fee_cents, creator_net_cents, currency)
values ('40000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1',
        '10000000-0000-4000-8000-0000000000a1', 'c@test', 'cs_order_1', 1000, 150, 850, 'usd'),
       ('40000000-0000-4000-8000-0000000000a2', '30000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1',
        '10000000-0000-4000-8000-0000000000a1', 'c@test', 'cs_order_2', 1000, 150, 850, 'usd');
select pg_temp.must_fail($$insert into public.music_orders(offer_id, track_id, creator_m_uid, customer_email, stripe_checkout_session_id,
  amount_cents, platform_fee_cents, creator_net_cents, currency, status) values ('30000000-0000-4000-8000-0000000000a1',
  '20000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'c@test', 'cs_paid', 1000, 150, 850, 'usd', 'paid')$$,
  '%music_order_must_start_pending%');

------------------------------------------------------------------------------
-- (d) fulfilment is bound to its order
------------------------------------------------------------------------------
select pg_temp.must_fail($$insert into public.music_entitlements(order_id, offer_id, track_id, customer_email)
  values ('40000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', 'c@test')$$,
  '%music_entitlement_order_not_paid%');
select pg_temp.must_fail($$update public.music_orders set stripe_checkout_session_id='cs_attacker', status='paid'
  where id='40000000-0000-4000-8000-0000000000a1'$$, '%music_order_session_immutable%');
select pg_temp.must_fail($$update public.music_orders set amount_cents=1, platform_fee_cents=0, creator_net_cents=1
  where id='40000000-0000-4000-8000-0000000000a1'$$, '%music_order_terms_immutable%');
select pg_temp.must_fail($$update public.music_orders set currency='eur' where id='40000000-0000-4000-8000-0000000000a1'$$,
  '%music_order_terms_immutable%');
update public.music_orders set status='paid', paid_at=now() where id='40000000-0000-4000-8000-0000000000a1';
select pg_temp.must_fail($$insert into public.music_entitlements(order_id, offer_id, track_id, customer_email)
  values ('40000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a3', 'c@test')$$,
  '%music_entitlement_order_mismatch%');
insert into public.music_entitlements(order_id, offer_id, track_id, customer_email)
values ('40000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', 'c@test');
-- replay: the same order fulfils once
select pg_temp.must_fail($$insert into public.music_entitlements(order_id, offer_id, track_id, customer_email)
  values ('40000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', 'c@test')$$,
  '%duplicate key%');
select pg_temp.must_fail($$update public.music_orders set status='pending' where id='40000000-0000-4000-8000-0000000000a1'$$,
  '%music_order_paid_is_final%');
update public.music_orders set status='refunded', refunded_at=now() where id='40000000-0000-4000-8000-0000000000a1';
select pg_temp.must_fail($$update public.music_orders set status='paid' where id='40000000-0000-4000-8000-0000000000a1'$$,
  '%music_order_not_payable%');
select pg_temp.must_fail($$update public.music_orders set status='canceled' where id='40000000-0000-4000-8000-0000000000a1'$$,
  '%music_order_refund_is_final%');
update public.music_orders set status='canceled' where id='40000000-0000-4000-8000-0000000000a2';
select pg_temp.must_fail($$update public.music_orders set status='paid' where id='40000000-0000-4000-8000-0000000000a2'$$,
  '%music_order_not_payable%');

------------------------------------------------------------------------------
-- (e) approved audio is immutable; purchasers get the version they bought
------------------------------------------------------------------------------
-- Fresh (20..a3) is published at this point; its master is Ana's
-- 00..b1/really-ana.wav, pinned when it was last approved.
\set A3 '''20000000-0000-4000-8000-0000000000a3'''
\set PINNED '''00000000-0000-4000-8000-0000000000b1/really-ana.wav'''
select pg_temp.as_service();
select pg_temp.check((select t.status = 'published' and v.object_name = :PINNED and v.pinned_via = 'review_approval'
                       and t.reviewed_snapshot->'approved_master' = v.identity
                       and t.reviewed_digest = public.music_review_digest(public.music_track_reviewed_snapshot(t))
                       from public.creator_tracks t join public.music_asset_versions v on v.id = t.approved_master_version_id
                      where t.id = :A3), 'approval pinned the exact master object and the digest covers it');
create temp table e_pin as
  select t.approved_master_version_id as v1, public.music_object_identity('creator-masters', :PINNED) as ident
    from public.creator_tracks t where t.id = :A3;
grant select on e_pin to authenticated, service_role;

-- REGRESSION: same-path overwrite of an approved master.
-- The creator, through RLS (a direct upsert with her own token):
select pg_temp.as_user(:A);
with u as (update storage.objects set version = 'overwritten', metadata = '{"eTag":"evil","size":9}'
            where bucket_id = 'creator-masters' and name = :PINNED returning 1)
select pg_temp.check((select count(*) from u) = 0, 'same-path overwrite: a creator cannot overwrite her own approved master');
with d as (delete from storage.objects where bucket_id = 'creator-masters' and name = :PINNED returning 1)
select pg_temp.check((select count(*) from d) = 0, 'a creator cannot delete her own approved master');
with u as (update storage.objects set version = 'overwritten'
            where bucket_id = 'creator-previews' and name = '00000000-0000-4000-8000-0000000000a1/a2-preview.mp3' returning 1)
select pg_temp.check((select count(*) from u) = 0, 'a creator cannot overwrite a published preview');
-- an unreferenced upload of her own stays hers to replace
insert into storage.objects(bucket_id, name) values ('creator-masters', '00000000-0000-4000-8000-0000000000a1/scratch.wav');
with u as (update storage.objects set version = 'v2' where bucket_id = 'creator-masters'
            and name = '00000000-0000-4000-8000-0000000000a1/scratch.wav' returning 1)
select pg_temp.check((select count(*) from u) = 1, 'a draft upload nobody reviewed can still be replaced');
-- Every role (a signed upload URL with upsert, the service key, a move): the trigger.
select pg_temp.as_service();
select pg_temp.must_fail($$update storage.objects set version = 'overwritten', metadata = '{"eTag":"evil","size":9}'
  where bucket_id = 'creator-masters' and name = '00000000-0000-4000-8000-0000000000b1/really-ana.wav'$$, '%music_asset_immutable%');
select pg_temp.must_fail($$update storage.objects set name = '00000000-0000-4000-8000-0000000000b1/moved.wav'
  where bucket_id = 'creator-masters' and name = '00000000-0000-4000-8000-0000000000b1/really-ana.wav'$$, '%music_asset_immutable%');
select pg_temp.must_fail($$delete from storage.objects
  where bucket_id = 'creator-masters' and name = '00000000-0000-4000-8000-0000000000b1/really-ana.wav'$$, '%music_asset_immutable%');
-- metadata the bytes do not depend on may still be touched
update storage.objects set last_accessed_at = now() where bucket_id = 'creator-masters' and name = :PINNED;
select pg_temp.check((select public.music_object_identity('creator-masters', :PINNED) = (select ident from e_pin)
                         and t.status = 'published' and t.approved_master_version_id = (select v1 from e_pin)
                         from public.creator_tracks t where t.id = :A3),
                     'same-path overwrite: refused, the reviewed bytes and the approval are unchanged (never approved over new bytes)');

-- REGRESSION: replacement after purchase.
insert into public.music_orders(id, offer_id, track_id, creator_m_uid, customer_email, stripe_checkout_session_id,
  amount_cents, platform_fee_cents, creator_net_cents, currency, asset_version_id)
values ('40000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000a3', :A3,
        '10000000-0000-4000-8000-0000000000a1', 'buyer@test', 'cs_order_e1', 2000, 300, 1700, 'usd',
        (select approved_master_version_id from public.creator_tracks where id = '20000000-0000-4000-8000-0000000000a1'));
select pg_temp.check((select asset_version_id = (select v1 from e_pin) from public.music_orders
                       where id = '40000000-0000-4000-8000-0000000000e1'),
                     'an order records the version on sale, whatever the caller sent');
update public.music_orders set status = 'paid', paid_at = now() where id = '40000000-0000-4000-8000-0000000000e1';
insert into public.music_entitlements(id, order_id, offer_id, track_id, customer_email, asset_version_id)
values ('50000000-0000-4000-8000-0000000000e1', '40000000-0000-4000-8000-0000000000e1', '30000000-0000-4000-8000-0000000000a3',
        :A3, 'buyer@test', null);
select pg_temp.check((select asset_version_id = (select v1 from e_pin) from public.music_entitlements
                       where id = '50000000-0000-4000-8000-0000000000e1'), 'the entitlement inherits the order''s pinned version');
select pg_temp.must_fail($$update public.music_entitlements set asset_version_id = null
  where id = '50000000-0000-4000-8000-0000000000e1'$$, '%music_entitlement_immutable%');
select pg_temp.must_fail($$update public.music_orders set asset_version_id = null
  where id = '40000000-0000-4000-8000-0000000000e1'$$, '%music_order_terms_immutable%');
-- the creator uploads a replacement master and points the release at it
insert into public.music_creator_assets(bucket_id, object_name, owner_user_id, owner_m_uid)
values ('creator-masters', '00000000-0000-4000-8000-0000000000a1/replacement.wav', :A, '10000000-0000-4000-8000-0000000000a1');
insert into storage.objects(bucket_id, name, owner, owner_id)
values ('creator-masters', '00000000-0000-4000-8000-0000000000a1/replacement.wav', null, null);
select pg_temp.as_user(:A);
update public.creator_tracks set master_path = '00000000-0000-4000-8000-0000000000a1/replacement.wav' where id = :A3;
select pg_temp.as_service();
select pg_temp.check((select status = 'pending_review' and approved_master_version_id is null from public.creator_tracks where id = :A3),
                     'replacement after purchase: the release goes back to review and nothing is pinned on sale');
select pg_temp.check((select d.object_name = :PINNED and d.intact and not d.revoked and d.order_status = 'paid'
                       and d.asset_version_id = (select v1 from e_pin)
                       from public.music_purchase_delivery(:A3, '30000000-0000-4000-8000-0000000000a3', null, 'BUYER@test') d),
                     'replacement after purchase: the purchaser is still delivered ONLY the originally purchased bytes');
select pg_temp.check((select count(*) from public.music_track_delivery(:A3) d where d.object_name is not null) = 0,
                     'listeners get no master while the replacement is unreviewed');
select pg_temp.must_fail($$insert into public.music_orders(offer_id, track_id, creator_m_uid, customer_email, stripe_checkout_session_id,
  amount_cents, platform_fee_cents, creator_net_cents, currency) values ('30000000-0000-4000-8000-0000000000a3',
  '20000000-0000-4000-8000-0000000000a3', '10000000-0000-4000-8000-0000000000a1', 'x@test', 'cs_unreviewed', 2000, 300, 1700, 'usd')$$,
  '%music_order_track_not_on_sale%');
-- the purchased master stays locked although no release references it now
select pg_temp.must_fail($$delete from storage.objects
  where bucket_id = 'creator-masters' and name = '00000000-0000-4000-8000-0000000000b1/really-ana.wav'$$, '%music_asset_immutable%');
-- re-approval pins the replacement as a NEW version; the purchaser keeps theirs
update public.creator_tracks set status = 'published', rights_status = 'cleared', published_at = now() where id = :A3;
select pg_temp.check((select approved_master_version_id <> (select v1 from e_pin) from public.creator_tracks where id = :A3),
                     're-approval pins the replacement as a new version');
select pg_temp.check((select d.object_name like '%replacement.wav' and d.intact from public.music_track_delivery(:A3) d),
                     'listeners now get the newly reviewed version');
select pg_temp.check((select d.object_name = :PINNED from public.music_purchase_delivery(:A3, '30000000-0000-4000-8000-0000000000a3', null, 'buyer@test') d),
                     'the earlier purchaser still gets the version bought');
-- taken down: the purchaser keeps the version bought (owner policy)
update public.creator_tracks set status = 'archived' where id = :A3;
select pg_temp.check((select d.object_name = :PINNED and d.intact and d.track_status = 'archived'
                       from public.music_purchase_delivery(:A3, '30000000-0000-4000-8000-0000000000a3', null, 'buyer@test') d),
                     'a taken-down release still delivers the purchased version');
-- if the bytes ever differ from the pin (a path outside the database), delivery is not intact
reset role;
alter table storage.objects disable trigger music_storage_object_guard_upd;
update storage.objects set version = 'tampered' where bucket_id = 'creator-masters' and name = :PINNED;
alter table storage.objects enable trigger music_storage_object_guard_upd;
select pg_temp.as_service();
select pg_temp.check((select not d.intact from public.music_purchase_delivery(:A3, '30000000-0000-4000-8000-0000000000a3', null, 'buyer@test') d),
                     'bytes that no longer match the pin are reported not intact (music-access refuses)');
-- revoked: refused, not mistaken for no purchase
update public.music_entitlements set revoked_at = now() where id = '50000000-0000-4000-8000-0000000000e1';
select pg_temp.check((select d.revoked from public.music_purchase_delivery(:A3, '30000000-0000-4000-8000-0000000000a3', null, 'buyer@test') d),
                     'a revoked licence is reported revoked');
-- the pinned record itself is immutable
select pg_temp.must_fail($$update public.music_asset_versions set object_name = 'x/y.wav'$$, '%music_asset_version_immutable%');
select pg_temp.must_fail($$delete from public.music_asset_versions$$, '%music_asset_version_immutable%');
update public.music_asset_versions set content_sha256 = repeat('a', 64) where id = (select v1 from e_pin);
select pg_temp.must_fail($$update public.music_asset_versions set content_sha256 = repeat('b', 64)
  where id = (select v1 from e_pin)$$, '%music_asset_version_immutable%');
-- and creators cannot write the pin
select pg_temp.as_user(:A);
update public.creator_tracks set approved_master_version_id = (select v1 from e_pin) where id = :A3;
select pg_temp.as_service();
select pg_temp.check((select approved_master_version_id is null from public.creator_tracks where id = :A3),
                     'a creator cannot set the pinned version');

-- nobody but the service role reaches the asset registry
select pg_temp.as_user(:A);
select pg_temp.must_fail($$select count(*) from public.music_asset_versions$$, '%permission denied%');
select pg_temp.must_fail($$select * from public.music_purchase_delivery('20000000-0000-4000-8000-0000000000a3',
  '30000000-0000-4000-8000-0000000000a3', null, 'buyer@test')$$, '%permission denied%');
select pg_temp.must_fail($$select count(*) from public.music_creator_assets$$, '%permission denied%');
select pg_temp.must_fail($$insert into public.music_creator_assets(bucket_id, object_name, owner_user_id)
  values ('creator-masters', '00000000-0000-4000-8000-0000000000b1/b-master.wav', '00000000-0000-4000-8000-0000000000a1')$$,
  '%permission denied%');
select pg_temp.must_fail($$select public.music_track_assets_verified('20000000-0000-4000-8000-0000000000a1')$$, '%permission denied%');

reset role;
select 'music_release_payment_integrity: all checks passed' as result;
