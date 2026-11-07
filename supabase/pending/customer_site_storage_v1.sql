-- PENDING. Apply after member_fronts_v1; deploy the quota-aware upload Worker
-- and editor together. No storage schema triggers or direct object mutations.
-- 500 MB decimal per M Account, shared by its personal and managed sites.
begin;
create table if not exists public.customer_site_storage_accounts (
 owner_user_id uuid primary key references auth.users(id),
 quota_bytes bigint not null default 500000000 check(quota_bytes>=0)
);
create table if not exists public.customer_site_storage_reservations (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null references public.customer_site_storage_accounts(owner_user_id),
 bucket text not null check(bucket in ('front-media','mnet-media')),
 path text not null,
 bytes bigint not null check(bytes>0 and bytes<=314572800),
 prior_bytes bigint not null default 0 check(prior_bytes>=0),
 state text not null default 'pending' check(state in ('pending','settled','released')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(owner_user_id,bucket,path)
);
alter table public.customer_site_storage_accounts enable row level security;
alter table public.customer_site_storage_accounts force row level security;
alter table public.customer_site_storage_reservations enable row level security;
alter table public.customer_site_storage_reservations force row level security;
revoke all on public.customer_site_storage_accounts,public.customer_site_storage_reservations from public,anon,authenticated;
grant select,insert,update on public.customer_site_storage_accounts,public.customer_site_storage_reservations to service_role;

create or replace function public.customer_site_storage_usage_v1(p_user uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare actual bigint; pending bigint; count_files bigint; unknown bigint; quota bigint; person uuid;
begin
 select m_uid into person from public.m_auth_user_links where auth_user_id=p_user and is_primary;
 if person is null then raise exception 'account required' using errcode='42501';end if;
 select coalesce(sum(case when metadata->>'size'~'^[0-9]{1,15}$' then (metadata->>'size')::bigint else 0 end),0),count(*),count(*) filter(where metadata->>'size' is null or metadata->>'size'!~'^[0-9]{1,15}$')
 into actual,count_files,unknown from storage.objects where (bucket_id='front-media' and starts_with(name,p_user::text||'/')) or (bucket_id='mnet-media' and starts_with(name,'studio/'||person::text||'/'));
 select coalesce(sum(greatest(bytes-prior_bytes,0)),0) into pending from public.customer_site_storage_reservations where owner_user_id=p_user and state='pending';
 select quota_bytes into quota from public.customer_site_storage_accounts where owner_user_id=p_user;
 return jsonb_build_object('used_bytes',actual,'reserved_bytes',pending,'quota_bytes',coalesce(quota,500000000),'files',count_files,'unknown_files',unknown,'available_bytes',greatest(0,coalesce(quota,500000000)-actual-pending));
end $$;

create or replace function public.customer_site_storage_reserve_v1(p_user uuid,p_bucket text,p_path text,p_bytes bigint)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare person uuid; r public.customer_site_storage_reservations; usage jsonb; previous bigint;
begin
 select m_uid into person from public.m_auth_user_links where auth_user_id=p_user and is_primary;
 if person is null or p_bytes is null or p_bytes<1 or p_bytes>314572800 or p_path is null or p_path~'(^|/)\.\.?(/|$)' or length(p_path)>512
 or not ((p_bucket='front-media' and starts_with(p_path,p_user::text||'/')) or (p_bucket='mnet-media' and starts_with(p_path,'studio/'||person::text||'/'))) then raise exception 'invalid owned upload' using errcode='42501';end if;
 insert into public.customer_site_storage_accounts(owner_user_id) values(p_user) on conflict do nothing;
 perform 1 from public.customer_site_storage_accounts where owner_user_id=p_user for update;
 select * into r from public.customer_site_storage_reservations where owner_user_id=p_user and bucket=p_bucket and path=p_path;
 -- A retry cannot start a concurrent writer or overwrite a successful object.
 if found and r.state='pending' then raise exception 'upload already reserved; reconcile it before retrying' using errcode='40001';end if;
 usage:=public.customer_site_storage_usage_v1(p_user);
 if (usage->>'unknown_files')::bigint>0 then raise exception 'storage reconciliation required' using errcode='40001';end if;
 select coalesce((metadata->>'size')::bigint,0) into previous from storage.objects where bucket_id=p_bucket and name=p_path;
 previous:=coalesce(previous,0);
 if (usage->>'available_bytes')::bigint<greatest(p_bytes-previous,0) or (usage->>'files')::bigint+(select count(*) from public.customer_site_storage_reservations where owner_user_id=p_user and state='pending' and prior_bytes=0)>=2500 then raise exception 'website storage full' using errcode='54000';end if;
 insert into public.customer_site_storage_reservations(owner_user_id,bucket,path,bytes,prior_bytes)
 values(p_user,p_bucket,p_path,p_bytes,previous)
 on conflict(owner_user_id,bucket,path) do update set id=gen_random_uuid(),bytes=excluded.bytes,prior_bytes=excluded.prior_bytes,state='pending',created_at=now(),updated_at=now()
 returning * into r;
 return to_jsonb(r);
end $$;

-- Block old direct browser/signed uploads from bypassing the quota service.
-- Existing owner read/delete policies remain; objects are removed through Storage API.
drop policy if exists "front media is written by its owner" on storage.objects;
drop policy if exists "front media is replaced by its owner" on storage.objects;
drop policy if exists "site media writes require quota service" on storage.objects;
create policy "site media writes require quota service" on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'front-media' and not(bucket_id='mnet-media' and starts_with(name,'studio/')));
drop policy if exists "site media updates require quota service" on storage.objects;
create policy "site media updates require quota service" on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'front-media' and not(bucket_id='mnet-media' and starts_with(name,'studio/')))
 with check(bucket_id<>'front-media' and not(bucket_id='mnet-media' and starts_with(name,'studio/')));
revoke all on function public.customer_site_storage_usage_v1(uuid),public.customer_site_storage_reserve_v1(uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.customer_site_storage_usage_v1(uuid),public.customer_site_storage_reserve_v1(uuid,text,text,bigint) to service_role;
commit;
