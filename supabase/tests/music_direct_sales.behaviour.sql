-- Behaviour tests for supabase/pending/music_direct_sales_v1.sql, as the real API roles.
-- Runs on a scratch database (scripts/test-music-direct-sales-db.sh) after the
-- production shape of the three tables (lifted from the replay migration) and a
-- minimal public.music_catalog_objects. Every check raises on failure. Runs twice:
-- after the first apply, and after rollback + re-apply.
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

-- ---------------------------------------------------------------- offers
-- a public path, a foreign bucket, traversal and an unknown recording are refused
select pg_temp.must_fail($q$insert into public.music_direct_offers(offer_key,catalog_key,title,price_cents,asset_bucket,asset_path,download_name)
  values('here--here','here:here','Here',199,'creator-previews','direct-sales/here/here/a.mp3','Here.mp3')$q$, '%private_asset%');
select pg_temp.must_fail($q$insert into public.music_direct_offers(offer_key,catalog_key,title,price_cents,asset_bucket,asset_path,download_name)
  values('here--here','here:here','Here',199,'mcc-gated-audio','niggy-nigg/niggy-nigg.mp3','Here.mp3')$q$, '%private_asset%');
select pg_temp.must_fail($q$insert into public.music_direct_offers(offer_key,catalog_key,title,price_cents,asset_bucket,asset_path,download_name)
  values('here--here','here:here','Here',199,'mcc-gated-audio','direct-sales/../x.mp3','Here.mp3')$q$, '%private_asset%');
select pg_temp.must_fail($q$insert into public.music_direct_offers(offer_key,catalog_key,title,price_cents,asset_bucket,asset_path,download_name)
  values('nope--nope','nope:nope','Nope',199,'mcc-gated-audio','direct-sales/nope/nope/a.mp3','Nope.mp3')$q$, '%catalog_key_fkey%');
select pg_temp.must_fail($q$insert into public.music_direct_offers(offer_key,catalog_key,title,price_cents,asset_bucket,asset_path,download_name)
  values('here--here','here:here','Here',50001,'mcc-gated-audio','direct-sales/here/here/a.mp3','Here.mp3')$q$, '%price_max%');
select pg_temp.must_fail($q$insert into public.music_direct_offers(offer_key,catalog_key,title,price_cents,asset_bucket,asset_path,download_name,max_downloads)
  values('here--here','here:here','Here',199,'mcc-gated-audio','direct-sales/here/here/a.mp3','Here.mp3',0)$q$, '%max_downloads%');

insert into public.music_direct_offers(offer_key,catalog_key,title,price_cents,currency,asset_bucket,asset_path,download_name,active,max_downloads,download_window_days)
values ('here--here','here:here','Here',199,'USD','mcc-gated-audio','direct-sales/here/here/1-here.mp3','McCluster - Here.mp3',true,2,30),
       ('here--antisocial','here:antisocial','Antisocial',299,'usd','mcc-gated-audio','direct-sales/here/antisocial/1-a.wav','McCluster - Antisocial.wav',false,5,30),
       ('here--lightroom','here:lightroom','Lightroom',299,'usd','mcc-gated-audio','direct-sales/here/lightroom/1-l.mp3','McCluster - Lightroom.mp3',true,5,30);
update public.music_direct_offers set sale_starts_at = now() + interval '1 day' where offer_key = 'here--lightroom';
select pg_temp.check((select currency from public.music_direct_offers where offer_key='here--here') = 'usd', 'currency normalised');
select pg_temp.must_fail($q$update public.music_direct_offers set offer_key='other-key' where offer_key='here--here'$q$, '%offer_key_immutable%');

-- public read: on sale now only, buy-button columns only
select pg_temp.as_role('anon');
select pg_temp.check((select count(*) from public.music_direct_offers) = 1, 'anon sees only the active, started offer');
select pg_temp.check((select offer_key from public.music_direct_offers) = 'here--here', 'anon sees here--here');
select pg_temp.check((select price_cents from public.music_direct_offers where catalog_key='here:here') = 199, 'anon reads price');
select pg_temp.must_fail('select asset_path from public.music_direct_offers', '%permission denied%');
select pg_temp.must_fail('select * from public.music_direct_offers', '%permission denied%');
select pg_temp.must_fail($q$update public.music_direct_offers set price_cents=50$q$, '%permission denied%');
select pg_temp.must_fail('select id from public.music_direct_orders', '%permission denied%');
select pg_temp.must_fail('select token from public.music_direct_entitlements', '%permission denied%');
select pg_temp.must_fail($q$select public.music_direct_claim_download(gen_random_uuid())$q$, '%permission denied%');
select pg_temp.must_fail($q$select public.music_direct_fulfil(gen_random_uuid(),'cs_test_x',199,'usd','','')$q$, '%permission denied%');
select pg_temp.as_role('authenticated');
select pg_temp.check((select count(*) from public.music_direct_offers) = 1, 'authenticated sees only the on-sale offer');
select pg_temp.must_fail('select id from public.music_direct_orders', '%permission denied%');
select pg_temp.must_fail('select token from public.music_direct_entitlements', '%permission denied%');

-- ---------------------------------------------------------------- orders
select pg_temp.as_role('service_role');
-- price from the offer, a stored session, pending only
select pg_temp.must_fail($q$insert into public.music_direct_orders(offer_key,stripe_checkout_session_id,amount_cents,currency,status)
  values('here--here','cs_test_a',100,'usd','pending')$q$, '%price_mismatch%');
select pg_temp.must_fail($q$insert into public.music_direct_orders(offer_key,stripe_checkout_session_id,amount_cents,currency,status)
  values('here--here','cs_test_a',199,'eur','pending')$q$, '%price_mismatch%');
select pg_temp.must_fail($q$insert into public.music_direct_orders(offer_key,stripe_checkout_session_id,amount_cents,currency,status)
  values('here--here',null,199,'usd','pending')$q$, '%session_required%');
select pg_temp.must_fail($q$insert into public.music_direct_orders(offer_key,stripe_checkout_session_id,amount_cents,currency,status)
  values('here--here','cs_test_a',199,'usd','paid')$q$, '%must_start_pending%');

insert into public.music_direct_orders(id,offer_key,stripe_checkout_session_id,amount_cents,currency,status,paid_at)
values ('50000000-0000-4000-8000-000000000001','here--here','cs_test_a',199,'usd','pending', now()),
       ('50000000-0000-4000-8000-000000000002','here--here','cs_test_b',199,'usd','pending', null),
       ('50000000-0000-4000-8000-000000000003','here--here','cs_test_c',199,'usd','pending', null);
select pg_temp.check((select paid_at from public.music_direct_orders where id='50000000-0000-4000-8000-000000000001') is null, 'paid_at not settable at insert');

-- no entitlement for an unpaid order
select pg_temp.must_fail($q$insert into public.music_direct_entitlements(order_id,offer_key) values('50000000-0000-4000-8000-000000000001','here--here')$q$, '%needs_paid_order%');
-- terms immutable
select pg_temp.must_fail($q$update public.music_direct_orders set amount_cents=50 where id='50000000-0000-4000-8000-000000000001'$q$, '%terms_immutable%');
select pg_temp.must_fail($q$update public.music_direct_orders set currency='eur' where id='50000000-0000-4000-8000-000000000001'$q$, '%terms_immutable%');
select pg_temp.must_fail($q$update public.music_direct_orders set stripe_checkout_session_id='cs_test_z' where id='50000000-0000-4000-8000-000000000001'$q$, '%terms_immutable%');
select pg_temp.must_fail($q$update public.music_direct_orders set status='refunded' where id='50000000-0000-4000-8000-000000000001'$q$, '%bad_transition%');

-- fulfil: wrong session / amount / currency refused, nothing paid
select pg_temp.check((public.music_direct_fulfil('50000000-0000-4000-8000-000000000001','cs_test_b',199,'usd','pi_1','a@x.test')->>'reason') = 'session_mismatch', 'other session refused');
select pg_temp.check((public.music_direct_fulfil('50000000-0000-4000-8000-000000000001','cs_test_a',1,'usd','pi_1','a@x.test')->>'reason') = 'amount_mismatch', 'amount swap refused');
select pg_temp.check((public.music_direct_fulfil('50000000-0000-4000-8000-000000000001','cs_test_a',199,'eur','pi_1','a@x.test')->>'reason') = 'currency_mismatch', 'currency swap refused');
select pg_temp.check((public.music_direct_fulfil(gen_random_uuid(),'cs_test_a',199,'usd','pi_1','a@x.test')->>'reason') = 'order_not_found', 'unknown order');
select pg_temp.check((select status from public.music_direct_orders where id='50000000-0000-4000-8000-000000000001') = 'pending', 'still pending after refusals');

-- the real one, then a replay: one paid order, one entitlement
select pg_temp.check((public.music_direct_fulfil('50000000-0000-4000-8000-000000000001','cs_test_a',199,'USD','pi_1','A@X.test')->>'newly_paid') = 'true', 'fulfil pays');
select pg_temp.check((public.music_direct_fulfil('50000000-0000-4000-8000-000000000001','cs_test_a',199,'usd','pi_1','a@x.test')->>'newly_paid') = 'false', 'replay is a no-op');
select pg_temp.check((select count(*) from public.music_direct_entitlements where order_id='50000000-0000-4000-8000-000000000001') = 1, 'one entitlement per order');
select pg_temp.check((select status from public.music_direct_orders where id='50000000-0000-4000-8000-000000000001') = 'paid', 'paid');
select pg_temp.check((select paid_at from public.music_direct_orders where id='50000000-0000-4000-8000-000000000001') is not null, 'paid_at stamped');
select pg_temp.check((select customer_email from public.music_direct_orders where id='50000000-0000-4000-8000-000000000001') = 'a@x.test', 'email lowercased');
select pg_temp.check((select max_downloads = 2 and expires_at > now() + interval '29 days' from public.music_direct_entitlements where order_id='50000000-0000-4000-8000-000000000001'), 'limit and window snapshotted');
select pg_temp.must_fail($q$update public.music_direct_orders set stripe_payment_intent_id='pi_other' where id='50000000-0000-4000-8000-000000000001'$q$, '%payment_immutable%');
select pg_temp.must_fail($q$update public.music_direct_orders set status='pending' where id='50000000-0000-4000-8000-000000000001'$q$, '%bad_transition%');
select pg_temp.must_fail($q$insert into public.music_direct_entitlements(order_id,offer_key) values('50000000-0000-4000-8000-000000000001','here--here')$q$, '%duplicate key%');

-- token: server-random, immutable
insert into public.music_direct_orders(id,offer_key,stripe_checkout_session_id,amount_cents,currency,status)
values ('50000000-0000-4000-8000-000000000004','here--here','cs_test_d',199,'usd','pending');
update public.music_direct_orders set status='paid' where id='50000000-0000-4000-8000-000000000004';
insert into public.music_direct_entitlements(order_id,offer_key,token) values('50000000-0000-4000-8000-000000000004','here--here','00000000-0000-4000-8000-00000000beef');
select pg_temp.check((select token from public.music_direct_entitlements where order_id='50000000-0000-4000-8000-000000000004') <> '00000000-0000-4000-8000-00000000beef', 'caller cannot choose the token');
select pg_temp.must_fail($q$update public.music_direct_entitlements set token=gen_random_uuid() where order_id='50000000-0000-4000-8000-000000000004'$q$, '%immutable%');
select pg_temp.must_fail($q$update public.music_direct_entitlements set max_downloads=1 where order_id='50000000-0000-4000-8000-000000000004'$q$, '%limit_shrink%');
select pg_temp.must_fail($q$update public.music_direct_entitlements set expires_at=now() where order_id='50000000-0000-4000-8000-000000000004'$q$, '%expiry_shrink%');
select pg_temp.must_fail($q$update public.music_direct_entitlements set download_count=99 where order_id='50000000-0000-4000-8000-000000000004'$q$, '%over_limit%');

-- ---------------------------------------------------------------- downloads
do $d$
declare v_token uuid; r jsonb;
begin
  select token into v_token from public.music_direct_entitlements where order_id='50000000-0000-4000-8000-000000000001';
  r := public.music_direct_claim_download(v_token);
  perform pg_temp.check((r->>'ok')::boolean and r->>'path' = 'direct-sales/here/here/1-here.mp3' and r->>'bucket' = 'mcc-gated-audio', 'first download signs the private object');
  perform pg_temp.check((r->>'downloads_left')::int = 1, 'one left');
  -- taking the offer off sale does not take back what was bought
  update public.music_direct_offers set active=false where offer_key='here--here';
  r := public.music_direct_claim_download(v_token);
  perform pg_temp.check((r->>'ok')::boolean and (r->>'downloads_left')::int = 0, 'second download after off-sale');
  r := public.music_direct_claim_download(v_token);
  perform pg_temp.check(r->>'reason' = 'download_limit', 'over the limit refused');
  perform pg_temp.check((select download_count from public.music_direct_entitlements where token=v_token) = 2, 'count stops at the limit');
  update public.music_direct_offers set active=true where offer_key='here--here';
  perform pg_temp.check((public.music_direct_claim_download(gen_random_uuid())->>'reason') = 'not_found', 'unknown token');
  perform pg_temp.must_fail(format('update public.music_direct_entitlements set download_count=0 where token=%L', v_token), '%count_decrease%');

  -- refund: entitlement revoked in the same transaction, downloads refused, revocation final
  select token into v_token from public.music_direct_entitlements where order_id='50000000-0000-4000-8000-000000000004';
  update public.music_direct_orders set status='refunded' where id='50000000-0000-4000-8000-000000000004';
  perform pg_temp.check((select revoked_at is not null from public.music_direct_entitlements where token=v_token), 'refund revokes');
  perform pg_temp.check((select refunded_at is not null from public.music_direct_orders where id='50000000-0000-4000-8000-000000000004'), 'refunded_at stamped');
  perform pg_temp.check((public.music_direct_claim_download(v_token)->>'reason') = 'revoked', 'revoked refuses');
  perform pg_temp.must_fail(format('update public.music_direct_entitlements set revoked_at=null where token=%L', v_token), '%revocation_final%');
  perform pg_temp.check((public.music_direct_fulfil('50000000-0000-4000-8000-000000000004','cs_test_d',199,'usd','','')->>'reason') = 'order_not_payable', 'refunded order cannot be re-paid');
  perform pg_temp.must_fail($q$update public.music_direct_orders set status='paid' where id='50000000-0000-4000-8000-000000000004'$q$, '%bad_transition%');

  -- expired
  update public.music_direct_orders set status='paid' where id='50000000-0000-4000-8000-000000000002';
  insert into public.music_direct_entitlements(order_id,offer_key) values('50000000-0000-4000-8000-000000000002','here--here');
  select token into v_token from public.music_direct_entitlements where order_id='50000000-0000-4000-8000-000000000002';
  /* the clock moves on: only the table owner can step around the guard */
  execute 'reset role';
  alter table public.music_direct_entitlements disable trigger music_direct_entitlement_guard_trg;
  update public.music_direct_entitlements set expires_at = now() - interval '1 minute' where token=v_token;
  alter table public.music_direct_entitlements enable trigger music_direct_entitlement_guard_trg;
  perform pg_temp.as_role('service_role');
  perform pg_temp.check((public.music_direct_claim_download(v_token)->>'reason') = 'expired', 'expired refuses');

  -- expired session (canceled) cannot be paid afterwards
  update public.music_direct_orders set status='canceled' where id='50000000-0000-4000-8000-000000000003';
  perform pg_temp.check((public.music_direct_fulfil('50000000-0000-4000-8000-000000000003','cs_test_c',199,'usd','','')->>'reason') = 'order_not_payable', 'canceled order cannot be paid');
end $d$;

-- an offer with orders cannot be deleted from under them
select pg_temp.must_fail($q$delete from public.music_direct_offers where offer_key='here--here'$q$, '%foreign key%');

reset role;
delete from public.music_direct_entitlements;
delete from public.music_direct_orders;
delete from public.music_direct_offers;
select 'music direct sales behaviour: ok';
