-- Behaviour tests for supabase/pending/20261109120000_music_direct_asset_versions_v1.sql
-- (COM-1 pinned purchases, COM-2 reserve/settle downloads). Runs on the scratch
-- database after music_direct_sales.behaviour.sql, as the service role. Every check
-- raises on failure. Against the v1 schema alone these fail: that is the regression.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.as_role(p_role text) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, false);
  execute 'set role ' || p_role;
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

reset role;
delete from public.music_direct_entitlements;
delete from public.music_direct_orders;
delete from public.music_direct_offers;
select pg_temp.as_role('service_role');

insert into public.music_direct_offers(offer_key,catalog_key,title,price_cents,currency,asset_bucket,asset_path,download_name,active,max_downloads,download_window_days)
values ('here--here','here:here','Here',199,'usd','mcc-gated-audio','direct-sales/here/here/original.wav','McCluster - Here.wav',true,2,30);

-- ---------------------------------------------------------------- COM-1: the purchase pins its file
select pg_temp.check((select count(*) from public.music_direct_asset_versions where offer_key='here--here') = 1, 'one version after the first write');
select pg_temp.check((select current_version_id is not null from public.music_direct_offers where offer_key='here--here'), 'offer points at its version');
select pg_temp.must_fail($q$update public.music_direct_asset_versions set asset_path='direct-sales/here/here/x.wav'$q$, '%asset_version_immutable%');

insert into public.music_direct_orders(id,offer_key,stripe_checkout_session_id,amount_cents,currency,status)
values ('60000000-0000-4000-8000-000000000001','here--here','cs_test_v1',199,'usd','pending');
select pg_temp.check((select o.asset_version_id = f.current_version_id from public.music_direct_orders o join public.music_direct_offers f using (offer_key) where o.id='60000000-0000-4000-8000-000000000001'), 'order snapshots the current version');
select pg_temp.must_fail($q$update public.music_direct_orders set asset_version_id=gen_random_uuid() where id='60000000-0000-4000-8000-000000000001'$q$, '%asset_immutable%');
select pg_temp.check((public.music_direct_fulfil('60000000-0000-4000-8000-000000000001','cs_test_v1',199,'usd','pi_v1','v@x.test')->>'newly_paid') = 'true', 'paid');
select pg_temp.check((select e.asset_version_id = o.asset_version_id from public.music_direct_entitlements e join public.music_direct_orders o on o.id=e.order_id where o.id='60000000-0000-4000-8000-000000000001'), 'entitlement inherits the pin');

do $v$
declare v_token uuid; r jsonb; v_old uuid;
begin
  select token, asset_version_id into v_token, v_old from public.music_direct_entitlements where order_id='60000000-0000-4000-8000-000000000001';
  r := public.music_direct_claim_download(v_token);
  perform pg_temp.check((r->>'ok')::boolean and r->>'path' = 'direct-sales/here/here/original.wav', 'first download: the original');
  /* the owner uploads a replacement and retitles: a NEW version, future sales only */
  update public.music_direct_offers set asset_path='direct-sales/here/here/replacement.flac', download_name='McCluster - Here.flac', title='Here (2026 master)' where offer_key='here--here';
  perform pg_temp.check((select count(*) from public.music_direct_asset_versions where offer_key='here--here') = 2, 'edit made a second version');
  perform pg_temp.check((select current_version_id <> v_old from public.music_direct_offers where offer_key='here--here'), 'offer moved to the new version');
  perform pg_temp.check((select asset_version_id = v_old from public.music_direct_entitlements where token=v_token), 'old entitlement keeps its pin');
  r := public.music_direct_claim_download(v_token);
  perform pg_temp.check((r->>'ok')::boolean and r->>'path' = 'direct-sales/here/here/original.wav' and r->>'title' = 'Here' and r->>'download_name' = 'McCluster - Here.wav', 'second download after the edit: STILL the original (COM-1)');
  perform pg_temp.check((public.music_direct_claim_download(v_token)->>'reason') = 'download_limit', 'limit holds');
  /* a new buyer gets the replacement */
  insert into public.music_direct_orders(id,offer_key,stripe_checkout_session_id,amount_cents,currency,status)
  values ('60000000-0000-4000-8000-000000000002','here--here','cs_test_v2',199,'usd','pending');
  perform public.music_direct_fulfil('60000000-0000-4000-8000-000000000002','cs_test_v2',199,'usd','pi_v2','w@x.test');
  select token into v_token from public.music_direct_entitlements where order_id='60000000-0000-4000-8000-000000000002';
  r := public.music_direct_claim_download(v_token);
  perform pg_temp.check(r->>'path' = 'direct-sales/here/here/replacement.flac' and r->>'title' = 'Here (2026 master)', 'new purchase delivers the new version');
  /* switching the offer back to the first file reuses that version, no duplicate row */
  update public.music_direct_offers set asset_path='direct-sales/here/here/original.wav', download_name='McCluster - Here.wav', title='Here' where offer_key='here--here';
  perform pg_temp.check((select count(*) from public.music_direct_asset_versions where offer_key='here--here') = 2, 'reverting reuses the old version');
  perform pg_temp.check((select current_version_id = v_old from public.music_direct_offers where offer_key='here--here'), 'offer back on the old version');
end $v$;

-- ---------------------------------------------------------------- COM-2: signing failures do not spend downloads
insert into public.music_direct_orders(id,offer_key,stripe_checkout_session_id,amount_cents,currency,status)
values ('60000000-0000-4000-8000-000000000003','here--here','cs_test_v3',199,'usd','pending');
select public.music_direct_fulfil('60000000-0000-4000-8000-000000000003','cs_test_v3',199,'usd','pi_v3','s@x.test');
do $a$
declare v_token uuid; r jsonb; s jsonb; a1 uuid; a2 uuid; i int;
begin
  select token into v_token from public.music_direct_entitlements where order_id='60000000-0000-4000-8000-000000000003';
  /* three signing failures: reserve, then release */
  for i in 1..3 loop
    r := public.music_direct_reserve_download(v_token, 'fail-attempt-' || i);
    perform pg_temp.check((r->>'ok')::boolean and r->>'state' = 'reserved' and r->>'path' = 'direct-sales/here/here/original.wav', 'reservation ' || i || ' holds and names the pinned file');
    s := public.music_direct_settle_download((r->>'attempt_id')::uuid, 'released');
    perform pg_temp.check((s->>'ok')::boolean and s->>'state' = 'released', 'release ' || i);
  end loop;
  perform pg_temp.check((select download_count from public.music_direct_entitlements where token=v_token) = 0, 'three failed signings spent nothing (COM-2)');
  perform pg_temp.check((select count(*) from public.music_direct_download_attempts a join public.music_direct_entitlements e on e.id=a.entitlement_id where e.token=v_token and a.state='released') = 3, 'three released attempts recorded');
  /* a spent key cannot be replayed into a fresh slot */
  perform pg_temp.check((public.music_direct_reserve_download(v_token, 'fail-attempt-1')->>'reason') = 'attempt_spent', 'released key is spent');

  /* success, lost response, retry with the same key: same attempt, one slot */
  r := public.music_direct_reserve_download(v_token, 'retry-key-00000001');
  a1 := (r->>'attempt_id')::uuid;
  perform pg_temp.check((r->>'downloads_left')::int = 1, 'one left while held');
  s := public.music_direct_settle_download(a1, 'issued');
  perform pg_temp.check((s->>'ok')::boolean and (s->>'downloads_left')::int = 1, 'issued counts one');
  r := public.music_direct_reserve_download(v_token, 'retry-key-00000001');
  perform pg_temp.check((r->>'ok')::boolean and (r->>'attempt_id')::uuid = a1 and r->>'state' = 'issued' and (r->>'replay')::boolean, 'retry returns the same issued attempt');
  s := public.music_direct_settle_download(a1, 'issued');
  perform pg_temp.check((s->>'ok')::boolean and (s->>'replay')::boolean, 'settling issued twice is a no-op');
  perform pg_temp.check((select download_count from public.music_direct_entitlements where token=v_token) = 1, 'still one download counted');
  perform pg_temp.check((public.music_direct_settle_download(a1, 'released')->>'reason') = 'attempt_final', 'an issued attempt cannot be released');

  /* capacity: a live hold blocks the last slot until settled */
  r := public.music_direct_reserve_download(v_token, 'hold-key-000000001');
  a2 := (r->>'attempt_id')::uuid;
  perform pg_temp.check((r->>'ok')::boolean, 'last slot reserved');
  perform pg_temp.check((public.music_direct_reserve_download(v_token, 'other-key-00000001')->>'reason') = 'download_limit', 'a live hold counts against the limit');
  s := public.music_direct_settle_download(a2, 'released');
  r := public.music_direct_reserve_download(v_token, 'other-key-00000001');
  perform pg_temp.check((r->>'ok')::boolean, 'released hold frees the slot');
  s := public.music_direct_settle_download((r->>'attempt_id')::uuid, 'issued');
  perform pg_temp.check((select download_count from public.music_direct_entitlements where token=v_token) = 2, 'both real downloads counted');
  perform pg_temp.check((public.music_direct_reserve_download(v_token, 'late-key-000000001')->>'reason') = 'download_limit', 'limit reached');
  perform pg_temp.check((public.music_direct_reserve_download(gen_random_uuid(), null)->>'reason') = 'not_found', 'unknown token');
  perform pg_temp.check((public.music_direct_settle_download(gen_random_uuid(), 'issued')->>'reason') = 'attempt_not_found', 'unknown attempt');
  perform pg_temp.check((public.music_direct_settle_download(a1, 'bogus')->>'reason') = 'bad_outcome', 'bad outcome refused');
  perform pg_temp.must_fail(format('update public.music_direct_download_attempts set state=''reserved'' where id=%L', a1), '%attempt_final%');
  perform pg_temp.must_fail(format('update public.music_direct_entitlements set download_count=0 where token=%L', v_token), '%count_decrease%');

  /* a lapsed hold is released by the next reservation, and settling it issued fails closed when the slot is gone */
  update public.music_direct_entitlements set max_downloads = 3 where token = v_token;
  r := public.music_direct_reserve_download(v_token, 'lapse-key-00000001', 10);
  a1 := (r->>'attempt_id')::uuid;
  execute 'reset role';
  alter table public.music_direct_download_attempts disable trigger music_direct_download_attempt_guard_trg;
  update public.music_direct_download_attempts set reservation_expires_at = now() - interval '1 second' where id = a1;
  alter table public.music_direct_download_attempts enable trigger music_direct_download_attempt_guard_trg;
  perform pg_temp.as_role('service_role');
  r := public.music_direct_reserve_download(v_token, 'after-lapse-000001');
  perform pg_temp.check((r->>'ok')::boolean, 'lapsed hold gave its slot back');
  perform pg_temp.check((select state from public.music_direct_download_attempts where id = a1) = 'released', 'lapsed hold marked released');
  perform pg_temp.check((public.music_direct_settle_download(a1, 'issued')->>'reason') = 'attempt_final', 'a lapsed hold cannot be issued');
  s := public.music_direct_settle_download((r->>'attempt_id')::uuid, 'issued');
  perform pg_temp.check((select download_count from public.music_direct_entitlements where token=v_token) = 3, 'three counted, none from failures');

  /* revoked and refunded refuse at reservation, nothing held */
  update public.music_direct_orders set status='refunded' where id='60000000-0000-4000-8000-000000000003';
  perform pg_temp.check((public.music_direct_reserve_download(v_token, null)->>'reason') = 'revoked', 'revoked refuses');
end $a$;

-- ---------------------------------------------------------------- unresolved legacy purchase fails closed, owner resolves once
insert into public.music_direct_orders(id,offer_key,stripe_checkout_session_id,amount_cents,currency,status)
values ('60000000-0000-4000-8000-000000000004','here--here','cs_test_v4',199,'usd','pending');
select public.music_direct_fulfil('60000000-0000-4000-8000-000000000004','cs_test_v4',199,'usd','pi_v4','l@x.test');
reset role;
alter table public.music_direct_orders disable trigger music_direct_order_guard_trg;
alter table public.music_direct_entitlements disable trigger music_direct_entitlement_guard_trg;
update public.music_direct_orders set asset_version_id = null where id='60000000-0000-4000-8000-000000000004';
update public.music_direct_entitlements set asset_version_id = null where order_id='60000000-0000-4000-8000-000000000004';
alter table public.music_direct_orders enable trigger music_direct_order_guard_trg;
alter table public.music_direct_entitlements enable trigger music_direct_entitlement_guard_trg;
select pg_temp.as_role('service_role');
select pg_temp.check((select count(*) from public.music_direct_asset_review where order_id='60000000-0000-4000-8000-000000000004') = 1, 'unresolved paid order is listed for review');
do $l$
declare v_token uuid; v_other uuid;
begin
  select token into v_token from public.music_direct_entitlements where order_id='60000000-0000-4000-8000-000000000004';
  perform pg_temp.check((public.music_direct_reserve_download(v_token, null)->>'reason') = 'asset_unresolved', 'unresolved purchase refuses, never today''s file');
  perform pg_temp.check((public.music_direct_claim_download(v_token)->>'reason') = 'asset_unresolved', 'legacy claim refuses too');
  /* a version of another offer cannot be assigned */
  insert into public.music_direct_offers(offer_key,catalog_key,title,price_cents,asset_bucket,asset_path,download_name,active)
  values ('here--antisocial','here:antisocial','Antisocial',299,'mcc-gated-audio','direct-sales/here/antisocial/a.wav','McCluster - Antisocial.wav',true);
  select current_version_id into v_other from public.music_direct_offers where offer_key='here--antisocial';
  perform pg_temp.must_fail(format('update public.music_direct_orders set asset_version_id=%L where id=''60000000-0000-4000-8000-000000000004''', v_other), '%asset_offer_mismatch%');
  /* the owner resolves it to a real version of this offer, once; the entitlement follows */
  update public.music_direct_orders set asset_version_id = (select min(id::text)::uuid from public.music_direct_asset_versions where offer_key='here--here' and asset_path='direct-sales/here/here/original.wav')
   where id='60000000-0000-4000-8000-000000000004';
  perform pg_temp.check((select asset_version_id is not null from public.music_direct_entitlements where token=v_token), 'resolution reaches the entitlement');
  perform pg_temp.check((select count(*) from public.music_direct_asset_review) = 0, 'review list empty');
  perform pg_temp.check((public.music_direct_reserve_download(v_token, null)->>'path') = 'direct-sales/here/here/original.wav', 'resolved purchase delivers the chosen file');
  perform pg_temp.must_fail('update public.music_direct_orders set asset_version_id=gen_random_uuid() where id=''60000000-0000-4000-8000-000000000004''', '%asset_immutable%');
end $l$;

-- public roles see nothing of the new tables
select pg_temp.as_role('anon');
select pg_temp.must_fail('select id from public.music_direct_asset_versions', '%permission denied%');
select pg_temp.must_fail('select id from public.music_direct_download_attempts', '%permission denied%');
select pg_temp.must_fail('select order_id from public.music_direct_asset_review', '%permission denied%');
select pg_temp.must_fail($q$select public.music_direct_reserve_download(gen_random_uuid(), null)$q$, '%permission denied%');
select pg_temp.must_fail($q$select public.music_direct_settle_download(gen_random_uuid(), 'issued')$q$, '%permission denied%');
select pg_temp.must_fail('select current_version_id from public.music_direct_offers', '%permission denied%');

reset role;
delete from public.music_direct_entitlements;
delete from public.music_direct_orders;
delete from public.music_direct_offers;
select pg_temp.check((select count(*) from public.music_direct_asset_versions) = 0, 'versions cascade with their offers');
select 'music direct asset versions behaviour: ok';
