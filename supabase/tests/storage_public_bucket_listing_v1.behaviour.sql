-- Behaviour of 20261128090000_storage_public_bucket_listing_v1.sql on the stub of
-- production. Run by scripts/test-storage-listing-db.sh. Each check prints "...: ok".
-- Runs in one transaction that rolls back, so it can run again after a re-apply.
begin;
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set Q '''select 1 from storage.objects where bucket_id in (''''creator-artwork'''',''''creator-previews'''',''''cuts'''',''''mnet-avatars'''')'''

select t_as('anon');
select t_eq(t_count(:Q), 0::bigint, 'anon lists nothing in the four public buckets');
reset role;
select 'anon cannot list: ok';

select t_as('authenticated', :'A');
select t_eq(t_count(:Q), 4::bigint, 'a member lists exactly their own four files');
select t_eq(t_count(:Q || ' and name like ''' || :'B' || '/%'''), 0::bigint, 'a member sees none of another member''s files');
reset role;
select 'member sees only own files: ok';

-- remove() is DELETE ... RETURNING, which needs the owner's SELECT policy
select t_as('authenticated', :'A');
with d as (delete from storage.objects where bucket_id = 'cuts' and name = :'A' || '/a.mp4' returning 1) select t_eq((select count(*) from d), 1::bigint, 'owner removes own cut');
with d as (delete from storage.objects where bucket_id = 'creator-artwork' and name = :'A' || '/a.png' returning 1) select t_eq((select count(*) from d), 1::bigint, 'owner removes own artwork');
with d as (delete from storage.objects where bucket_id = 'cuts' and name = :'B' || '/b.mp4' returning 1) select t_eq((select count(*) from d), 0::bigint, 'member cannot remove another member''s cut');
-- an upsert (x-upsert) reads, then updates, the owner's avatar
with u as (update storage.objects set metadata = '{"v":2}' where bucket_id = 'mnet-avatars' and name = :'A' || '/a.webp' returning 1) select t_eq((select count(*) from u), 1::bigint, 'owner replaces own avatar');
reset role;
select 'owner remove and upsert still work: ok';
rollback;
