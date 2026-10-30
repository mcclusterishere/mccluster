-- Behaviour of supabase/pending/merch_marketplace_v1.sql, as the real API
-- roles, on a scratch database (scripts/test-merch-marketplace-db.sh).
-- Every check raises on failure; psql runs with ON_ERROR_STOP.
\set ON_ERROR_STOP 1

create function public.t_err(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not like p_like then raise exception 'expected error like % for [%], got: %', p_like, p_sql, sqlerrm; end if;
    return;
  end;
  raise exception 'expected error like % for [%], but it succeeded', p_like, p_sql;
end $$;
create function public.t_eq(p_got anyelement, p_want anyelement, p_what text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then raise exception '% : got %, want %', p_what, p_got, p_want; end if;
end $$;
grant execute on function public.t_err(text, text), public.t_eq(anyelement, anyelement, text) to anon, authenticated, service_role;

insert into auth.users (id, email) values
  ('a1111111-1111-4111-8111-111111111111', 'alice@example.com'),
  ('b2222222-2222-4222-8222-222222222222', 'bob@example.com'),
  ('e5555555-5555-4555-8555-555555555555', 'eve@example.com'),
  ('0aaaaaaa-0000-4000-8000-000000000000', 'matthew@mccluster.org');

-- ---------- fee constant ----------
select t_eq(public.marketplace_platform_fee_bps(), 1500, 'fee bps');
select t_eq(public.marketplace_platform_fee_cents(5500), 825, 'fee on 55.00');
select t_eq(public.marketplace_platform_fee_cents(1), 0, 'fee rounds');
select t_eq(public.marketplace_platform_fee_cents(10), 2, 'fee rounds half up (1.5 -> 2)');

-- ---------- sellers apply (service role) ----------
set role service_role;
select t_eq((public.marketplace_seller_apply('a1111111-1111-4111-8111-111111111111', 'alpha', 'Alpha Goods', 'We print shirts.', false))->>'created', 'true', 'alice applies');
select t_eq((public.marketplace_seller_apply('a1111111-1111-4111-8111-111111111111', 'alpha-two', 'Again', '', false))->>'created', 'false', 'one seller per owner: the same row comes back');
select t_eq((public.marketplace_seller_apply('b2222222-2222-4222-8222-222222222222', 'bravo', 'Bravo Merch', '', false))->>'status', 'applied', 'bob applies');
select t_err($$select public.marketplace_seller_apply('e5555555-5555-4555-8555-555555555555', 'alpha', 'Copycat', '', false)$$, '%slug_taken%');
select t_err($$select public.marketplace_seller_apply('e5555555-5555-4555-8555-555555555555', 'X!', 'Bad', '', false)$$, '%invalid_slug%');
reset role;

create temp table ids as
  select (select org_id from public.marketplace_sellers where slug = 'alpha') as a,
         (select org_id from public.marketplace_sellers where slug = 'bravo') as b;
grant select on ids to anon, authenticated, service_role;
select t_eq((select role from public.org_members m, ids where m.org_id = ids.a and m.profile_id = 'a1111111-1111-4111-8111-111111111111'), 'owner', 'applicant owns the org');
select t_eq((select account_reference from public.org_stripe_accounts r, ids where r.org_id = ids.a), 'merch-alpha', 'the Connect rail row exists');

-- browser roles cannot run the money functions
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
select t_err($$select public.marketplace_seller_set_status((select a from ids), 'approved', null, null)$$, '%permission denied%');
select t_err($$select public.marketplace_order_create(gen_random_uuid(), gen_random_uuid(), 1, false, repeat('a', 64))$$, '%permission denied%');
select t_err($$select public.marketplace_order_mark_paid('{}'::jsonb)$$, '%permission denied%');
select t_err($$update public.marketplace_sellers set status = 'approved'$$, '%permission denied%');
reset role;

-- Alice's Stripe account is ready; Bob's is not
update public.org_stripe_accounts r set stripe_account_id = 'acct_1Alpha', charges_enabled = true, payouts_enabled = true,
  details_submitted = true, onboarding_status = 'ready' from ids where r.org_id = ids.a;
update public.org_stripe_accounts r set stripe_account_id = 'acct_1Bravo' from ids where r.org_id = ids.b;

-- images: only objects the server recorded for this seller
insert into public.marketplace_assets (object_name, seller_org_id, uploaded_by, content_type)
select ids.a::text || '/11111111-1111-4111-8111-111111111111.jpg', ids.a, 'a1111111-1111-4111-8111-111111111111', 'image/jpeg' from ids;
insert into public.marketplace_assets (object_name, seller_org_id, uploaded_by, content_type)
select ids.b::text || '/22222222-2222-4222-8222-222222222222.png', ids.b, 'b2222222-2222-4222-8222-222222222222', 'image/png' from ids;

-- ---------- listings as the seller's own browser ----------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
insert into public.marketplace_listings (seller_org_id, title, description, images, price_cents, shipping_cents)
select ids.a, 'Alpha Tee', 'Heavy cotton.', jsonb_build_array(ids.a::text || '/11111111-1111-4111-8111-111111111111.jpg'), 2500, 500 from ids;
select t_err($$insert into public.marketplace_listings (seller_org_id, title, images, price_cents) select a, 'Stolen image', jsonb_build_array(b::text || '/22222222-2222-4222-8222-222222222222.png'), 1000 from ids$$, '%image_not_owned%');
select t_err($$insert into public.marketplace_listings (seller_org_id, title, price_cents, status) select a, 'Self-published', 1000, 'published' from ids$$, '%only the server publishes%');
select t_err($$insert into public.marketplace_listings (seller_org_id, title, price_cents) select b, 'Into Bob''s shop', 1000 from ids$$, '%row-level security%');
insert into public.marketplace_variants (listing_id, seller_org_id, label, options, sku, inventory_count, position)
select l.id, ids.a, 'M / Black', '{"size":"M","colour":"Black"}', 'ALPHA-M-BLK', 2, 0 from public.marketplace_listings l, ids where l.title = 'Alpha Tee';
insert into public.marketplace_variants (listing_id, seller_org_id, label, options, sku, price_cents, inventory_count, position)
select l.id, ids.a, 'XL / Black', '{"size":"XL","colour":"Black"}', 'ALPHA-XL-BLK', 2800, 0, 1 from public.marketplace_listings l, ids where l.title = 'Alpha Tee';
select t_err($$insert into public.marketplace_variants (listing_id, seller_org_id, label) select l.id, ids.b, 'Wrong seller' from public.marketplace_listings l, ids where l.title = 'Alpha Tee'$$, '%variant_seller_mismatch%');
select t_eq((select count(*) from public.marketplace_orders), 0::bigint, 'a seller reads orders (none yet)');
-- Bob reads none of Alice's drafts
select set_config('request.jwt.claims', '{"sub":"b2222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
select t_eq((select count(*) from public.marketplace_listings), 0::bigint, 'another seller sees no draft');
select t_eq((select count(*) from public.marketplace_assets), 1::bigint, 'a seller reads only its own asset records');
reset role;

create temp table lst as select l.id as listing,
  (select id from public.marketplace_variants where sku = 'ALPHA-M-BLK') as vm,
  (select id from public.marketplace_variants where sku = 'ALPHA-XL-BLK') as vxl
  from public.marketplace_listings l where l.title = 'Alpha Tee';
grant select on lst to anon, authenticated, service_role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"b2222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
select t_err($$insert into public.marketplace_variants (listing_id, seller_org_id, label) select listing, (select a from ids), 'Bob into Alice' from lst$$, '%variant_seller_mismatch%');
select t_err($$insert into public.marketplace_listings (seller_org_id, title, price_cents) select a, 'Bob into Alice''s shop', 1000 from ids$$, '%row-level security%');
reset role;

-- nothing public before the owner approves the seller
set role service_role;
select t_eq((public.marketplace_listing_request_publish((select listing from lst), 'a1111111-1111-4111-8111-111111111111'))->>'status', 'pending_review', 'unapproved seller waits');
select t_eq(jsonb_array_length(public.marketplace_public_listings(null, null)), 0, 'nothing public yet');
select t_err($$update public.marketplace_listings set status = 'published' where id = (select listing from lst)$$, '%seller_not_approved%');
select t_eq((public.marketplace_seller_set_status((select a from ids), 'approved', '0aaaaaaa-0000-4000-8000-000000000000', null))->>'published', '1', 'approval publishes what waited');
select t_eq((select status from public.marketplace_listings where id = (select listing from lst)), 'published', 'listing is live');
-- Bob is approved but Stripe cannot pay him yet: nothing of his goes live
insert into public.marketplace_listings (seller_org_id, title, price_cents) select b, 'Bravo Cap', 1500 from ids;
insert into public.marketplace_variants (listing_id, seller_org_id, label, inventory_count)
select l.id, l.seller_org_id, 'One size', 5 from public.marketplace_listings l where title = 'Bravo Cap';
select public.marketplace_seller_set_status((select b from ids), 'approved', '0aaaaaaa-0000-4000-8000-000000000000', null);
select t_eq((public.marketplace_listing_request_publish((select id from public.marketplace_listings where title = 'Bravo Cap'), null))->>'waiting_for', 'seller_connect_not_ready', 'Connect not ready');
-- POD is not publishable in v1
insert into public.marketplace_listings (seller_org_id, title, price_cents, fulfilment_mode, pod_provider) select a, 'POD Hoodie', 4000, 'pod', 'printful' from ids;
select t_err($$update public.marketplace_listings set status = 'published' where title = 'POD Hoodie'$$, '%marketplace_listings_v1_seller_ships%');
select t_err($$select public.marketplace_listing_request_publish((select id from public.marketplace_listings where title = 'POD Hoodie'), null)$$, '%pod_not_available_in_v1%');
select t_err($$insert into public.marketplace_listings (seller_org_id, title, price_cents, fulfilment_mode) select a, 'Bad POD', 4000, 'pod' from ids$$, '%marketplace_listings_pod_shape%');
reset role;

-- the public sees the published listing, public fields only
set role anon;
select set_config('request.jwt.claims', '', false);
select t_eq(jsonb_array_length(public.marketplace_public_listings(null, null)), 1, 'one public listing');
select t_eq(public.marketplace_public_listings('alpha', null)->0->'seller'->>'display_name', 'Alpha Goods', 'shop page by slug');
select t_eq((public.marketplace_public_listings(null, (select listing from lst))->0->'variants'->1->>'price_cents')::int, 2800, 'variant price override');
select t_eq((public.marketplace_public_listings(null, (select listing from lst))->0->'variants'->1->>'in_stock')::boolean, false, 'XL is sold out');
select t_eq((select count(*) from public.marketplace_listings), 1::bigint, 'anon reads only published rows');
select t_eq((select count(*) from public.marketplace_sellers), 2::bigint, 'anon reads approved sellers');
select t_err($$select approved_by from public.marketplace_sellers$$, '%permission denied%');
select t_err($$select * from public.marketplace_orders$$, '%permission denied%');
select t_err($$select * from public.marketplace_seller_providers$$, '%permission denied%');
reset role;

-- a published listing is locked to the seller's browser
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
update public.marketplace_listings set price_cents = 100 where id = (select listing from lst);
select t_err($$update public.marketplace_variants set inventory_count = 999 where id = (select vm from lst)$$, '%listing_locked%');
reset role;
select t_eq((select price_cents from public.marketplace_listings where id = (select listing from lst)), 2500, 'published price unchanged by the browser');

-- ---------- orders ----------
set role service_role;
select t_err($$select public.marketplace_order_create((select listing from lst), (select vm from lst), 0, false, repeat('a', 64))$$, '%invalid_quantity%');
select t_err($$select public.marketplace_order_create((select listing from lst), (select vm from lst), 1, false, 'short')$$, '%invalid_token%');
select t_err($$select public.marketplace_order_create((select listing from lst), (select vxl from lst), 1, false, repeat('a', 64))$$, '%out_of_stock%');
select t_err($$select public.marketplace_order_create((select id from public.marketplace_listings where title = 'Bravo Cap'), (select id from public.marketplace_variants where label = 'One size'), 1, false, repeat('a', 64))$$, '%listing_unavailable%');
select t_err($$select public.marketplace_order_create((select listing from lst), (select id from public.marketplace_variants where label = 'One size'), 1, false, repeat('a', 64))$$, '%variant_unavailable%');
select t_err($$select public.marketplace_order_create((select listing from lst), (select vm from lst), 1, true, repeat('a', 64))$$, '%seller_not_ready%');
create temp table o1 as select public.marketplace_order_create((select listing from lst), (select vm from lst), 2, false,
  encode(sha256(convert_to('tok_' || repeat('1', 40), 'UTF8')), 'hex')) as j;
select t_eq((select (j->>'platform_fee_cents')::int from o1), 825, 'fee on (2 x 25.00 + 5.00)');
select t_eq((select (j->>'fee_basis_cents')::int from o1), 5500, 'fee basis is subtotal + shipping');
select t_eq((select j->>'stripe_account_id' from o1), 'acct_1Alpha', 'charged on the seller''s account');
select t_eq((select inventory_count from public.marketplace_variants where sku = 'ALPHA-M-BLK'), 0, 'stock taken at checkout');
select t_err($$select public.marketplace_order_create((select listing from lst), (select vm from lst), 1, false, repeat('b', 64))$$, '%out_of_stock%');
select t_eq(public.marketplace_order_attach_session((select (j->>'id')::uuid from o1), 'cs_test_Alpha00001'), true, 'session attached');
select t_eq(public.marketplace_order_attach_session((select (j->>'id')::uuid from o1), 'cs_test_Other00002'), false, 'a second session is refused');
select t_eq(public.marketplace_order_release((select (j->>'id')::uuid from o1), 'cs_test_Other00002'), false, 'another session cannot expire it');
select t_eq(public.marketplace_order_release((select (j->>'id')::uuid from o1), null), false, 'an attached order is not released without its session');
reset role;

create temp table good as select jsonb_build_object(
  'order_id', (select j->>'id' from o1), 'session_id', 'cs_test_Alpha00001', 'account', 'acct_1Alpha', 'livemode', false,
  'currency', 'usd', 'amount_subtotal', 5000, 'amount_shipping', 500, 'amount_discount', 0, 'amount_tax', 350,
  'amount_total', 5850, 'payment_intent', 'pi_Alpha1', 'email', 'Buyer@Example.com',
  'shipping', jsonb_build_object('name', 'Buyer', 'line1', '1 Main St', 'city', 'Bridgeport', 'state', 'CT', 'postal_code', '06604', 'country', 'US')) as p;
grant select on good to service_role;
set role service_role;
select t_eq(public.marketplace_order_mark_paid((select p || '{"account":"acct_1Bravo"}' from good))->>'refused', 'account_mismatch', 'wrong connected account');
select t_eq(public.marketplace_order_mark_paid((select p || '{"session_id":"cs_test_Other00002"}' from good))->>'refused', 'session_mismatch', 'other session');
select t_eq(public.marketplace_order_mark_paid((select p || '{"livemode":true}' from good))->>'refused', 'mode_mismatch', 'live event for a test order');
select t_eq(public.marketplace_order_mark_paid((select p || '{"currency":"eur"}' from good))->>'refused', 'currency_mismatch', 'currency swap');
select t_eq(public.marketplace_order_mark_paid((select p || '{"amount_subtotal":100,"amount_total":950}' from good))->>'refused', 'amount_mismatch', 'amount swap');
select t_eq(public.marketplace_order_mark_paid((select p || '{"amount_discount":500,"amount_total":5350}' from good))->>'refused', 'amount_mismatch', 'a discount changes the fee basis');
select t_eq(public.marketplace_order_mark_paid((select p || '{"amount_total":99999}' from good))->>'refused', 'amount_mismatch', 'total is basis + tax');
select t_eq(public.marketplace_order_mark_paid((select p || jsonb_build_object('order_id', gen_random_uuid()) from good))->>'refused', 'order_not_found', 'unknown order');
select t_eq(public.marketplace_order_mark_paid((select p from good))->>'changed', 'true', 'the bound payment marks it paid');
select t_eq(public.marketplace_order_mark_paid((select p from good))->>'changed', 'false', 'a replay changes nothing');
select t_eq((select status || ':' || tax_cents || ':' || total_cents || ':' || buyer_email from public.marketplace_orders where id = (select (j->>'id')::uuid from o1)), 'paid:350:5850:buyer@example.com', 'paid facts');
select t_eq(public.marketplace_order_release((select (j->>'id')::uuid from o1), 'cs_test_Alpha00001'), false, 'a paid order is never released');
reset role;

-- the terms never change, for any role
select t_err($$update public.marketplace_orders set quantity = 1$$, '%order terms are immutable%');
select t_err($$update public.marketplace_orders set platform_fee_cents = 0, platform_fee_bps = 0$$, '%immutable%');
select t_err($$update public.marketplace_orders set stripe_account_id = 'acct_1Evil'$$, '%order terms are immutable%');
select t_err($$update public.marketplace_orders set total_cents = 1, tax_cents = 0$$, '%payment facts are immutable%');
select t_err($$update public.marketplace_orders set status = 'pending'$$, '%cannot move from paid to pending%');
select t_err($$delete from public.marketplace_orders$$, '%never deleted%');

-- the seller ships
set role service_role;
select t_err($$select public.marketplace_order_seller_update((select (j->>'id')::uuid from o1), (select b from ids), 'shipped', 'USPS', '9400111', null)$$, '%unknown_order%');
select t_err($$select public.marketplace_order_seller_update((select (j->>'id')::uuid from o1), (select a from ids), 'shipped', '', '', null)$$, '%tracking_required%');
select t_eq(public.marketplace_order_seller_update((select (j->>'id')::uuid from o1), (select a from ids), 'shipped', 'USPS', '9400 1000 0000', 'a1111111-1111-4111-8111-111111111111')->>'status', 'shipped', 'shipped with tracking');
-- refunds only grow; full refund closes it; no restock
select t_eq(public.marketplace_order_record_refund(jsonb_build_object('order_id', (select j->>'id' from o1), 'account', 'acct_1Bravo', 'payment_intent', 'pi_Alpha1', 'amount_refunded', 100, 'livemode', false))->>'refused', 'account_mismatch', 'refund from another account');
select t_eq(public.marketplace_order_record_refund(jsonb_build_object('order_id', (select j->>'id' from o1), 'account', 'acct_1Alpha', 'payment_intent', 'pi_Other', 'amount_refunded', 100, 'livemode', false))->>'refused', 'payment_mismatch', 'refund of another payment');
select t_eq(public.marketplace_order_record_refund(jsonb_build_object('order_id', (select j->>'id' from o1), 'account', 'acct_1Alpha', 'payment_intent', 'pi_Alpha1', 'amount_refunded', 1000, 'livemode', false))->>'status', 'shipped', 'partial refund');
select t_eq(public.marketplace_order_record_refund(jsonb_build_object('order_id', (select j->>'id' from o1), 'account', 'acct_1Alpha', 'payment_intent', 'pi_Alpha1', 'amount_refunded', 500, 'livemode', false))->>'amount_refunded_cents', '1000', 'an older event never lowers it');
select t_eq(public.marketplace_order_record_refund(jsonb_build_object('order_id', (select j->>'id' from o1), 'account', 'acct_1Alpha', 'payment_intent', 'pi_Alpha1', 'amount_refunded', 5850, 'livemode', false))->>'status', 'refunded', 'full refund');
select t_eq((select inventory_count from public.marketplace_variants where sku = 'ALPHA-M-BLK'), 0, 'a refund does not restock');
reset role;

-- an expired checkout gives the unit back
update public.marketplace_variants set inventory_count = 1 where sku = 'ALPHA-M-BLK';
set role service_role;
create temp table o2 as select public.marketplace_order_create((select listing from lst), (select vm from lst), 1, false,
  encode(sha256(convert_to('tok_' || repeat('2', 40), 'UTF8')), 'hex')) as j;
select public.marketplace_order_attach_session((select (j->>'id')::uuid from o2), 'cs_test_Alpha00003');
select t_eq(public.marketplace_order_release((select (j->>'id')::uuid from o2), 'cs_test_Alpha00003'), true, 'expired');
select t_eq((select inventory_count from public.marketplace_variants where sku = 'ALPHA-M-BLK'), 1, 'restocked on expiry');
select t_eq(public.marketplace_order_mark_paid(jsonb_build_object('order_id', (select j->>'id' from o2), 'session_id', 'cs_test_Alpha00003', 'account', 'acct_1Alpha', 'livemode', false, 'currency', 'usd', 'amount_subtotal', 2500, 'amount_shipping', 500, 'amount_tax', 0, 'amount_total', 3000, 'payment_intent', 'pi_Late'))->>'refused', 'order_not_payable', 'a canceled order is not paid');
-- a checkout Stripe refused to open gives its unit back too
create temp table o3 as select public.marketplace_order_create((select listing from lst), (select vm from lst), 1, false,
  encode(sha256(convert_to('tok_' || repeat('3', 40), 'UTF8')), 'hex')) as j;
select t_eq(public.marketplace_order_release((select (j->>'id')::uuid from o3), null), true, 'never-opened checkout released');
select t_eq((select inventory_count from public.marketplace_variants where sku = 'ALPHA-M-BLK'), 1, 'restocked');
reset role;

-- members read their own orders only; buyers by token
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
select t_eq((select count(*) from public.marketplace_orders), 3::bigint, 'alice reads her orders');
select t_err($$select buyer_token_hash from public.marketplace_orders$$, '%permission denied%');
select set_config('request.jwt.claims', '{"sub":"b2222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
select t_eq((select count(*) from public.marketplace_orders), 0::bigint, 'bob reads none of alice''s');
reset role;
set role anon;
select t_eq(public.marketplace_order_by_token('tok_' || repeat('1', 40))->>'status', 'refunded', 'buyer reads status by token');
select t_eq(public.marketplace_order_by_token('tok_' || repeat('1', 40))->'ship_to'->>'city', 'Bridgeport', 'city only');
select t_eq(public.marketplace_order_by_token('tok_' || repeat('1', 40))->'ship_to' ? 'line1', false, 'no street address');
select t_eq(public.marketplace_order_by_token('tok_' || repeat('9', 40)), null::jsonb, 'wrong token');
select t_eq(public.marketplace_order_by_token('short'), null::jsonb, 'short token');
reset role;

-- moderation: suspend hides everything; a removed listing stays down
set role service_role;
select public.marketplace_seller_set_status((select a from ids), 'suspended', '0aaaaaaa-0000-4000-8000-000000000000', 'policy');
select t_eq(jsonb_array_length(public.marketplace_public_listings(null, null)), 0, 'suspension hides the shop');
select t_err($$select public.marketplace_order_create((select listing from lst), (select vm from lst), 1, false, repeat('c', 64))$$, '%listing_unavailable%');
select public.marketplace_seller_set_status((select a from ids), 'approved', '0aaaaaaa-0000-4000-8000-000000000000', null);
select t_eq(jsonb_array_length(public.marketplace_public_listings(null, null)), 1, 'reinstated');
select public.marketplace_listing_set_removed((select listing from lst), '0aaaaaaa-0000-4000-8000-000000000000', true, 'counterfeit');
select t_eq(jsonb_array_length(public.marketplace_public_listings(null, null)), 0, 'removed listing is gone');
select t_err($$select public.marketplace_listing_request_publish((select listing from lst), null)$$, '%listing_removed%');
-- Connect losing payouts hides the shop at once
select public.marketplace_listing_set_removed((select listing from lst), '0aaaaaaa-0000-4000-8000-000000000000', false, null);
select public.marketplace_listing_request_publish((select listing from lst), null);
select t_eq(jsonb_array_length(public.marketplace_public_listings(null, null)), 1, 'restored and republished');
reset role;
update public.org_stripe_accounts r set payouts_enabled = false from ids where r.org_id = ids.a;
select t_eq(jsonb_array_length(public.marketplace_public_listings(null, null)), 0, 'unready Connect hides the shop');

-- audit trail written
select t_eq((select count(*) > 5 from public.control_audit where event like 'marketplace.%'), true, 'audited');

drop function public.t_err(text, text);
drop function public.t_eq(anyelement, anyelement, text);
